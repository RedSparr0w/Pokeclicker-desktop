'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const {
  isAllowedFileUrl,
  isPathInside,
  isSafeExternalUrl,
  normalizeArchivePath,
} = require('../src/path-policy');

test('isPathInside distinguishes children from similarly named siblings', () => {
  const root = path.resolve('tmp', 'game');
  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, path.join(root, 'docs', 'index.html')), true);
  assert.equal(isPathInside(root, path.resolve('tmp', 'game-copy')), false);
  assert.equal(isPathInside(root, path.resolve('tmp')), false);
});

test('isAllowedFileUrl only accepts files below an allowed root', () => {
  const root = path.resolve('tmp', 'game');
  assert.equal(
    isAllowedFileUrl(pathToFileURL(path.join(root, 'index.html')).href, [root]),
    true,
  );
  assert.equal(
    isAllowedFileUrl(pathToFileURL(path.resolve('tmp', 'outside.html')).href, [
      root,
    ]),
    false,
  );
  assert.equal(isAllowedFileUrl('https://pokeclicker.com/', [root]), false);
});

test('isSafeExternalUrl restricts operating-system handoff to web URLs', () => {
  assert.equal(isSafeExternalUrl('https://pokeclicker.com/'), true);
  assert.equal(isSafeExternalUrl('http://localhost:8080/'), true);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
  assert.equal(isSafeExternalUrl('not a URL'), false);
});

test('normalizeArchivePath rejects traversal and platform-specific paths', () => {
  assert.equal(
    normalizeArchivePath('pokeclicker-master/docs/index.html'),
    'pokeclicker-master/docs/index.html',
  );

  for (const unsafePath of [
    '../escape',
    'pokeclicker-master/docs/../../../escape',
    '/absolute/path',
    'C:/windows/path',
    'folder\\windows-path',
    'nul\0byte',
  ]) {
    assert.throws(() => normalizeArchivePath(unsafePath), /Unsafe archive entry/);
  }
});
