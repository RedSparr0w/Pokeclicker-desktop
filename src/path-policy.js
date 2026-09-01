'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(
    path.resolve(parentPath),
    path.resolve(candidatePath),
  );

  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  );
}

function isAllowedFileUrl(rawUrl, allowedRoots) {
  try {
    const parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== 'file:') {
      return false;
    }

    const filePath = fileURLToPath(parsedUrl);
    return allowedRoots.some((rootPath) => isPathInside(rootPath, filePath));
  } catch {
    return false;
  }
}

function isSafeExternalUrl(rawUrl) {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizeArchivePath(entryName) {
  if (
    typeof entryName !== 'string' ||
    entryName.length === 0 ||
    entryName.includes('\0') ||
    entryName.includes('\\') ||
    entryName.startsWith('/') ||
    /^[a-zA-Z]:/.test(entryName)
  ) {
    throw new Error(`Unsafe archive entry: ${JSON.stringify(entryName)}`);
  }

  const normalized = path.posix.normalize(entryName);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Unsafe archive entry: ${JSON.stringify(entryName)}`);
  }

  return normalized;
}

module.exports = {
  isAllowedFileUrl,
  isPathInside,
  isSafeExternalUrl,
  normalizeArchivePath,
};
