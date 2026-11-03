const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

test('CLI downloads probe targets the approved public release', () => {
  const checks = JSON.parse(readFileSync(__dirname + '/../checks.json', 'utf8'));
  const downloads = checks.filter(check => check.id === 'downloads');
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url,
    'https://github.com/inferra-AI/cli/releases/download/v0.4.0-rc.97/checksums.txt');
  assert.equal(downloads[0].expect, 200);
});
