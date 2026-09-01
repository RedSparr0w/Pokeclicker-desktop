'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  getKeyboardZoomDirection,
  nextZoomFactor,
} = require('../src/zoom');

test('nextZoomFactor uses stable tenths and enforces bounds', () => {
  assert.equal(nextZoomFactor(1, 'in'), 1.1);
  assert.equal(nextZoomFactor(1.1, 'out'), 1);
  assert.equal(nextZoomFactor(3, 'in'), 3);
  assert.equal(nextZoomFactor(0.5, 'out'), 0.5);
  assert.equal(nextZoomFactor(2.4, 'reset'), 1);
});

test('getKeyboardZoomDirection handles control and command shortcuts', () => {
  assert.equal(
    getKeyboardZoomDirection({ control: true, key: '=', type: 'keyDown' }),
    'in',
  );
  assert.equal(
    getKeyboardZoomDirection({ key: '-', meta: true, type: 'keyDown' }),
    'out',
  );
  assert.equal(
    getKeyboardZoomDirection({ control: true, key: '0', type: 'keyDown' }),
    'reset',
  );
  assert.equal(
    getKeyboardZoomDirection({ control: false, key: '+', type: 'keyDown' }),
    null,
  );
  assert.equal(
    getKeyboardZoomDirection({ control: true, key: '+', type: 'keyUp' }),
    null,
  );
});
