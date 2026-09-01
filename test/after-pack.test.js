'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { getElectronPath } = require('../scripts/after-pack');

function makeContext(electronPlatformName) {
  return {
    appOutDir: path.resolve('dist', 'output'),
    electronPlatformName,
    packager: {
      appInfo: { productFilename: 'PokéClicker' },
      executableName: 'pokeclicker-desktop',
    },
  };
}

test('getElectronPath resolves the executable inside a macOS app bundle', () => {
  assert.equal(
    getElectronPath(makeContext('darwin')),
    path.resolve(
      'dist',
      'output',
      'PokéClicker.app',
      'Contents',
      'MacOS',
      'PokéClicker',
    ),
  );
});

test('getElectronPath resolves Linux and Windows executables', () => {
  assert.equal(
    getElectronPath(makeContext('linux')),
    path.resolve('dist', 'output', 'pokeclicker-desktop'),
  );
  assert.equal(
    getElectronPath(makeContext('win32')),
    path.resolve('dist', 'output', 'PokéClicker.exe'),
  );
});

test('getElectronPath rejects unknown platforms', () => {
  assert.throws(
    () => getElectronPath(makeContext('freebsd')),
    /Unsupported Electron platform/,
  );
});
