'use strict';

const fs = require('node:fs');
const {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
} = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const semver = require('semver');
const yauzl = require('yauzl');
const { isPathInside, normalizeArchivePath } = require('./path-policy');

const GAME_ARCHIVE_URL =
  'https://codeload.github.com/pokeclicker/pokeclicker/zip/master';
const GAME_MANIFEST_URL =
  'https://raw.githubusercontent.com/pokeclicker/pokeclicker/master/package.json';
const GAME_DIRECTORY_NAME = 'pokeclicker-master';
const GAME_ARCHIVE_PREFIX = `${GAME_DIRECTORY_NAME}/docs`;

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 1536 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100_000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function getGamePaths(userDataPath) {
  const root = path.join(userDataPath, GAME_DIRECTORY_NAME);
  const docs = path.join(root, 'docs');

  return {
    docs,
    index: path.join(docs, 'index.html'),
    manifest: path.join(docs, 'package.json'),
    root,
  };
}

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseVersionManifest(rawManifest, sourceName) {
  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error(`Invalid JSON in ${sourceName}`, { cause: error });
  }

  if (typeof manifest.version !== 'string' || !semver.valid(manifest.version)) {
    throw new Error(`Invalid game version in ${sourceName}`);
  }

  return manifest.version;
}

async function readInstalledVersion(userDataPath) {
  const gamePaths = getGamePaths(userDataPath);

  try {
    const [manifestContents, indexStats] = await Promise.all([
      readFile(gamePaths.manifest, 'utf8'),
      stat(gamePaths.index),
    ]);
    if (!indexStats.isFile()) {
      return null;
    }
    return parseVersionManifest(manifestContents, gamePaths.manifest);
  } catch {
    return null;
  }
}

function isNewerVersion(candidateVersion, installedVersion) {
  return Boolean(
    semver.valid(candidateVersion) &&
      semver.valid(installedVersion) &&
      semver.gt(candidateVersion, installedVersion),
  );
}

function createRequestTimeout(timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  return {
    clear: () => clearTimeout(timeout),
    signal: controller.signal,
  };
}

async function fetchLatestVersion({
  fetchImpl = globalThis.fetch,
  manifestUrl = GAME_MANIFEST_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  const requestTimeout = createRequestTimeout(timeoutMs);

  try {
    const response = await fetchImpl(manifestUrl, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Pokeclicker-Desktop' },
      redirect: 'follow',
      signal: requestTimeout.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Game update check failed with HTTP ${response.status}`,
      );
    }

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
      throw new Error('Game update manifest is unexpectedly large');
    }

    const responseBody = await response.text();
    if (Buffer.byteLength(responseBody, 'utf8') > 1024 * 1024) {
      throw new Error('Game update manifest is unexpectedly large');
    }

    return parseVersionManifest(responseBody, manifestUrl);
  } catch (error) {
    if (requestTimeout.signal.aborted) {
      throw new Error('Game update check timed out', { cause: error });
    }
    throw error;
  } finally {
    requestTimeout.clear();
  }
}

function reportProgress(onProgress, progress) {
  try {
    onProgress?.(progress);
  } catch (error) {
    console.warn('Unable to report update progress:', error);
  }
}

async function downloadFile(
  sourceUrl,
  destinationPath,
  {
    fetchImpl = globalThis.fetch,
    maxBytes = MAX_ARCHIVE_BYTES,
    onProgress,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = {},
) {
  const requestTimeout = createRequestTimeout(timeoutMs);

  try {
    const response = await fetchImpl(sourceUrl, {
      cache: 'no-store',
      headers: { 'User-Agent': 'Pokeclicker-Desktop' },
      redirect: 'follow',
      signal: requestTimeout.signal,
    });
    if (!response.ok) {
      throw new Error(`Game download failed with HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error('Game download returned an empty response');
    }

    const contentLength = Number(response.headers.get('content-length'));
    const totalBytes =
      Number.isSafeInteger(contentLength) && contentLength >= 0
        ? contentLength
        : null;
    if (totalBytes !== null && totalBytes > maxBytes) {
      throw new Error('Game download is larger than the configured safety limit');
    }

    await mkdir(path.dirname(destinationPath), { recursive: true });

    let downloadedBytes = 0;
    let lastReportAt = 0;
    const limitStream = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (downloadedBytes > maxBytes) {
          callback(
            new Error('Game download exceeded the configured safety limit'),
          );
          return;
        }

        const now = Date.now();
        if (now - lastReportAt >= 100) {
          lastReportAt = now;
          reportProgress(onProgress, { downloadedBytes, totalBytes });
        }
        callback(null, chunk);
      },
    });

    const sourceStream =
      typeof response.body.getReader === 'function'
        ? Readable.fromWeb(response.body)
        : response.body;
    await pipeline(
      sourceStream,
      limitStream,
      fs.createWriteStream(destinationPath, { flags: 'wx' }),
    );
    reportProgress(onProgress, { downloadedBytes, totalBytes });

    return downloadedBytes;
  } catch (error) {
    await rm(destinationPath, { force: true }).catch(() => {});
    if (requestTimeout.signal.aborted) {
      throw new Error('Game download timed out', { cause: error });
    }
    throw error;
  } finally {
    requestTimeout.clear();
  }
}

function openZipFile(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        autoClose: true,
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
      },
      (error, zipFile) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(zipFile);
      },
    );
  });
}

function openZipEntry(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, readStream) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(readStream);
    });
  });
}

function validateEntryType(entry, isDirectory) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const fileType = unixMode & 0xf000;
  const regularFile = fileType === 0 || fileType === 0x8000;
  const directory = fileType === 0x4000;

  if ((isDirectory && !directory && fileType !== 0) || (!isDirectory && !regularFile)) {
    throw new Error(`Unsupported archive entry type: ${entry.fileName}`);
  }
}

async function extractGameArchive(
  archivePath,
  destinationRoot,
  {
    maxEntries = MAX_ARCHIVE_ENTRIES,
    maxEntryBytes = MAX_ENTRY_BYTES,
    maxExtractedBytes = MAX_EXTRACTED_BYTES,
    onProgress,
  } = {},
) {
  await mkdir(destinationRoot, { recursive: true });
  const zipFile = await openZipFile(archivePath);
  const extractedPaths = new Set();
  let archiveEntries = 0;
  let extractedBytes = 0;
  let extractedFiles = 0;

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('error', fail);
    zipFile.on('end', () => {
      if (settled) {
        return;
      }
      settled = true;
      if (extractedFiles === 0) {
        reject(new Error('The archive does not contain the PokéClicker game'));
        return;
      }
      resolve({ extractedBytes, extractedFiles });
    });

    zipFile.on('entry', (entry) => {
      const handleEntry = async () => {
        archiveEntries += 1;
        if (archiveEntries > maxEntries) {
          throw new Error('Game archive contains too many entries');
        }

        const entryPath = normalizeArchivePath(entry.fileName);
        const isGameEntry =
          entryPath === GAME_ARCHIVE_PREFIX ||
          entryPath.startsWith(`${GAME_ARCHIVE_PREFIX}/`);
        if (!isGameEntry) {
          return;
        }

        const isDirectory = entry.fileName.endsWith('/');
        validateEntryType(entry, isDirectory);

        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
          throw new Error(`Invalid archive entry size: ${entry.fileName}`);
        }
        if (entry.uncompressedSize > maxEntryBytes) {
          throw new Error(`Archive entry is too large: ${entry.fileName}`);
        }

        extractedBytes += entry.uncompressedSize;
        if (extractedBytes > maxExtractedBytes) {
          throw new Error('Extracted game exceeds the configured safety limit');
        }

        const destinationPath = path.join(destinationRoot, ...entryPath.split('/'));
        if (!isPathInside(destinationRoot, destinationPath)) {
          throw new Error(`Archive entry escapes its destination: ${entry.fileName}`);
        }
        if (extractedPaths.has(destinationPath)) {
          throw new Error(`Duplicate archive entry: ${entry.fileName}`);
        }
        extractedPaths.add(destinationPath);

        if (isDirectory) {
          await mkdir(destinationPath, { recursive: true });
          return;
        }

        await mkdir(path.dirname(destinationPath), { recursive: true });
        const readStream = await openZipEntry(zipFile, entry);
        await pipeline(
          readStream,
          fs.createWriteStream(destinationPath, {
            flags: 'wx',
            mode: 0o644,
          }),
        );
        extractedFiles += 1;
        reportProgress(onProgress, { extractedBytes, extractedFiles });
      };

      handleEntry()
        .then(() => {
          if (!settled) {
            zipFile.readEntry();
          }
        })
        .catch(fail);
    });

    zipFile.readEntry();
  });
}

async function validateGameDirectory(gameRoot) {
  const docsPath = path.join(gameRoot, 'docs');
  const indexPath = path.join(docsPath, 'index.html');
  const manifestPath = path.join(docsPath, 'package.json');
  const [indexStats, manifestContents] = await Promise.all([
    stat(indexPath),
    readFile(manifestPath, 'utf8'),
  ]);

  if (!indexStats.isFile() || indexStats.size === 0) {
    throw new Error('The downloaded game is missing docs/index.html');
  }

  return parseVersionManifest(manifestContents, manifestPath);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function renameWithRetry(sourcePath, destinationPath, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      lastError = error;
      if (
        attempt === attempts ||
        !['EACCES', 'EBUSY', 'EPERM'].includes(error.code)
      ) {
        throw error;
      }
      await wait(attempt * 100);
    }
  }
  throw lastError;
}

async function swapGameDirectory(
  userDataPath,
  stagedGameRoot,
  { onWarning } = {},
) {
  const currentGameRoot = getGamePaths(userDataPath).root;
  const backupRoot = path.join(
    userDataPath,
    `.pokeclicker-backup-${randomUUID()}`,
  );
  const hadCurrentGame = await pathExists(currentGameRoot);

  if (hadCurrentGame) {
    await renameWithRetry(currentGameRoot, backupRoot);
  }

  try {
    await renameWithRetry(stagedGameRoot, currentGameRoot);
  } catch (installError) {
    if (hadCurrentGame) {
      try {
        await renameWithRetry(backupRoot, currentGameRoot);
      } catch (rollbackError) {
        throw new AggregateError(
          [installError, rollbackError],
          'Unable to install the game update or restore the previous version',
        );
      }
    }
    throw installError;
  }

  if (hadCurrentGame) {
    try {
      await rm(backupRoot, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100,
      });
    } catch (error) {
      onWarning?.(`Unable to remove old game files at ${backupRoot}`, error);
    }
  }
}

class GameUpdater {
  constructor({
    archiveUrl = GAME_ARCHIVE_URL,
    fetchImpl = globalThis.fetch,
    manifestUrl = GAME_MANIFEST_URL,
    userDataPath,
  }) {
    this.archiveUrl = archiveUrl;
    this.fetchImpl = fetchImpl;
    this.manifestUrl = manifestUrl;
    this.userDataPath = userDataPath;
    this.installPromise = null;
  }

  get paths() {
    return getGamePaths(this.userDataPath);
  }

  getInstalledVersion() {
    return readInstalledVersion(this.userDataPath);
  }

  getLatestVersion() {
    return fetchLatestVersion({
      fetchImpl: this.fetchImpl,
      manifestUrl: this.manifestUrl,
    });
  }

  install({ onProgress, onWarning } = {}) {
    if (this.installPromise) {
      return this.installPromise;
    }

    this.installPromise = this.installInternal({ onProgress, onWarning }).finally(
      () => {
        this.installPromise = null;
      },
    );
    return this.installPromise;
  }

  async installInternal({ onProgress, onWarning }) {
    await mkdir(this.userDataPath, { recursive: true });
    const stagingRoot = await mkdtemp(
      path.join(this.userDataPath, '.pokeclicker-update-'),
    );
    const archivePath = path.join(stagingRoot, 'game.zip');
    const stagedGameRoot = path.join(stagingRoot, GAME_DIRECTORY_NAME);

    try {
      reportProgress(onProgress, { phase: 'download' });
      await downloadFile(this.archiveUrl, archivePath, {
        fetchImpl: this.fetchImpl,
        onProgress: (progress) =>
          reportProgress(onProgress, { phase: 'download', ...progress }),
      });

      reportProgress(onProgress, { phase: 'extract' });
      await extractGameArchive(archivePath, stagingRoot, {
        onProgress: (progress) =>
          reportProgress(onProgress, { phase: 'extract', ...progress }),
      });

      reportProgress(onProgress, { phase: 'validate' });
      const installedVersion = await validateGameDirectory(stagedGameRoot);

      reportProgress(onProgress, { phase: 'install' });
      await swapGameDirectory(this.userDataPath, stagedGameRoot, { onWarning });
      reportProgress(onProgress, { phase: 'complete', installedVersion });

      return installedVersion;
    } finally {
      await rm(stagingRoot, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 100,
      }).catch((error) => {
        onWarning?.(`Unable to remove temporary update files at ${stagingRoot}`, error);
      });
    }
  }
}

module.exports = {
  GAME_ARCHIVE_PREFIX,
  GAME_ARCHIVE_URL,
  GAME_DIRECTORY_NAME,
  GAME_MANIFEST_URL,
  GameUpdater,
  downloadFile,
  extractGameArchive,
  fetchLatestVersion,
  getGamePaths,
  isNewerVersion,
  normalizeArchivePath,
  parseVersionManifest,
  readInstalledVersion,
  swapGameDirectory,
  validateGameDirectory,
};
