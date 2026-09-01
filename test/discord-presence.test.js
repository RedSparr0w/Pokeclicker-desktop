'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildActivity } = require('../src/discord-presence');

test('buildActivity normalizes user-controlled rich presence fields', () => {
  const activity = buildActivity({
    largeImageKey: ' badge ',
    largeImageText: 'A'.repeat(200),
    line1: '',
    line2: ' Route 1 ',
    smallImageText: 'ignored without a key',
    startTimestamp: 1234,
  });

  assert.equal(activity.details, '--');
  assert.equal(activity.state, 'Route 1');
  assert.equal(activity.largeImageKey, 'badge');
  assert.equal(activity.largeImageText.length, 128);
  assert.equal(activity.smallImageText, undefined);
  assert.equal(activity.startTimestamp, 1234);
});
