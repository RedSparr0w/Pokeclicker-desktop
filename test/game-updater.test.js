'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yazl = require('yazl');
const {
  downloadFile,
  extractGameArchive,
  fetchLatestVersion,
  getGamePaths,
  isNewerVersion,
  parseVersionManifest,
  readInstalledVersion,
  swapGameDirectory,
  validateGameDirectory,
} = require('../src/game-updater');

async function makeTemporaryDirectory(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pokeclicker-test-'));
  t.after(() => rm(directory, { force: true, recursive: true }));
  return directory;
}

function createZip(archivePath, entries) {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    for (const [entryPath, contents] of Object.entries(entries)) {
      archive.addBuffer(Buffer.from(contents), entryPath);
    }
    archive.outputStream
      .pipe(fs.createWriteStream(archivePath))
      .on('close', resolve)
      .on('error', reject);
    archive.end();
  });
}

async function createGameTree(rootPath, version, marker) {
  const docsPath = path.join(rootPath, 'docs');
  await mkdir(docsPath, { recursive: true });
  await Promise.all([
    writeFile(path.join(docsPath, 'index.html'), `<p>${marker}</p>`),
    writeFile(path.join(docsPath, 'package.json'), JSON.stringify({ version })),
  ]);
}

test('version manifests are validated with semantic versioning', () => {
  assert.equal(parseVersionManifest('{"version":"0.10.25"}', 'test'), '0.10.25');
  assert.equal(isNewerVersion('0.10.26', '0.10.25'), true);
  assert.equal(isNewerVersion('0.10.25', '0.10.25'), false);
  assert.throws(() => parseVersionManifest('{"version":"latest"}', 'test'));
  assert.throws(() => parseVersionManifest('not json', 'test'));
});

test('fetchLatestVersion checks response status, size, and shape', async () => {
  const fetchImpl = async () =>
    new Response('{"version":"0.10.25"}', {
      headers: { 'content-length': '21' },
      status: 200,
    });
  assert.equal(await fetchLatestVersion({ fetchImpl }), '0.10.25');

  await assert.rejects(
    fetchLatestVersion({
      fetchImpl: async () => new Response('missing', { status: 404 }),
    }),
    /HTTP 404/,
  );
});

test('downloadFile streams a bounded response and reports progress', async (t) => {
  const temporaryDirectory = await makeTemporaryDirectory(t);
  const destinationPath = path.join(temporaryDirectory, 'download.bin');
  const payload = Buffer.alloc(64 * 1024, 7);
  const progressEvents = [];
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-length': payload.length });
    response.end(payload);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { port } = server.address();
  const downloadedBytes = await downloadFile(
    `http://127.0.0.1:${port}/game.zip`,
    destinationPath,
    {
      maxBytes: payload.length,
      onProgress: (progress) => progressEvents.push(progress),
    },
  );

  assert.equal(downloadedBytes, payload.length);
  assert.deepEqual(await readFile(destinationPath), payload);
  assert.equal(progressEvents.at(-1).downloadedBytes, payload.length);
  assert.equal(progressEvents.at(-1).totalBytes, payload.length);
});

test('downloadFile removes partial files when the limit is exceeded', async (t) => {
  const temporaryDirectory = await makeTemporaryDirectory(t);
  const destinationPath = path.join(temporaryDirectory, 'oversized.bin');
  const fetchImpl = async () =>
    new Response(Buffer.alloc(1024), {
      headers: { 'content-length': '1024' },
      status: 200,
    });

  await assert.rejects(
    downloadFile('https://example.test/game.zip', destinationPath, {
      fetchImpl,
      maxBytes: 512,
    }),
    /safety limit/,
  );
  await assert.rejects(readFile(destinationPath), { code: 'ENOENT' });
});

test('extractGameArchive extracts only docs and validates the result', async (t) => {
  const temporaryDirectory = await makeTemporaryDirectory(t);
  const archivePath = path.join(temporaryDirectory, 'game.zip');
  const extractionRoot = path.join(temporaryDirectory, 'staged');
  await createZip(archivePath, {
    'pokeclicker-master/README.md': 'not needed',
    'pokeclicker-master/docs/index.html': '<!doctype html>',
    'pokeclicker-master/docs/package.json': '{"version":"0.10.25"}',
    'pokeclicker-master/docs/scripts/game.js': 'console.log("game")',
  });

  const result = await extractGameArchive(archivePath, extractionRoot);
  const stagedGameRoot = path.join(extractionRoot, 'pokeclicker-master');

  assert.equal(result.extractedFiles, 3);
  assert.equal(await validateGameDirectory(stagedGameRoot), '0.10.25');
  assert.equal(
    await readFile(path.join(stagedGameRoot, 'docs', 'scripts', 'game.js'), 'utf8'),
    'console.log("game")',
  );
  await assert.rejects(
    readFile(path.join(stagedGameRoot, 'README.md')),
    { code: 'ENOENT' },
  );
});

test('swapGameDirectory replaces atomically and removes its backup', async (t) => {
  const userDataPath = await makeTemporaryDirectory(t);
  const currentGameRoot = getGamePaths(userDataPath).root;
  const stagedGameRoot = path.join(userDataPath, 'staged-game');
  await createGameTree(currentGameRoot, '0.10.24', 'old');
  await createGameTree(stagedGameRoot, '0.10.25', 'new');

  await swapGameDirectory(userDataPath, stagedGameRoot);

  assert.equal(await readInstalledVersion(userDataPath), '0.10.25');
  assert.match(await readFile(getGamePaths(userDataPath).index, 'utf8'), /new/);
  assert.deepEqual(
    (await readdir(userDataPath)).filter((name) =>
      name.startsWith('.pokeclicker-backup-'),
    ),
    [],
  );
});

test('swapGameDirectory restores the current game if installation fails', async (t) => {
  const userDataPath = await makeTemporaryDirectory(t);
  const currentGameRoot = getGamePaths(userDataPath).root;
  await createGameTree(currentGameRoot, '0.10.24', 'old');

  await assert.rejects(
    swapGameDirectory(userDataPath, path.join(userDataPath, 'missing-staged-game')),
    { code: 'ENOENT' },
  );

  assert.equal(await readInstalledVersion(userDataPath), '0.10.24');
  assert.match(await readFile(getGamePaths(userDataPath).index, 'utf8'), /old/);
});
