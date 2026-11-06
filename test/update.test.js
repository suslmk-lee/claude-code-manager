'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { newer, pickAsset, latest } = require('../src/update');

test('newer compares x.y.z tags against the running version', () => {
  assert.equal(newer('0.1.7', 'v0.1.8'), true);
  assert.equal(newer('0.1.7', 'v0.1.7'), false);
  assert.equal(newer('0.1.10', 'v0.1.9'), false); // numeric, not lexical
  assert.equal(newer('0.1.7', 'v0.2.0'), true);
  assert.equal(newer('1.0.0', 'v0.9.9'), false);
  assert.equal(newer('0.1.7', ''), false);
});

test('pickAsset chooses this platform and arch', () => {
  const assets = [{ name: 'Claude Code Manager Setup 0.1.8.exe' }, { name: 'Claude Code Manager-0.1.8-arm64.dmg' }, { name: 'Claude Code Manager-0.1.8-x64.dmg' }];
  assert.equal(pickAsset(assets, 'darwin', 'arm64').name, 'Claude Code Manager-0.1.8-arm64.dmg');
  assert.equal(pickAsset(assets, 'darwin', 'x64').name, 'Claude Code Manager-0.1.8-x64.dmg');
  assert.equal(pickAsset(assets, 'win32', 'x64').name, 'Claude Code Manager Setup 0.1.8.exe');
  assert.equal(pickAsset([{ name: 'Claude Code Manager-0.1.8.dmg' }], 'darwin', 'arm64').name, 'Claude Code Manager-0.1.8.dmg'); // unmarked dmg is fine
  assert.equal(pickAsset(assets, 'linux', 'x64'), null);
});

test('latest reads the release feed once an hour and flags a newer tag', async () => {
  let calls = 0;
  const fetch = async () => { calls++; return { tag_name: 'v0.1.9', name: 'v0.1.9', body: 'notes', html_url: 'u', published_at: '2026-11-06T00:00:00Z', assets: [{ name: 'Claude Code Manager-0.1.9-arm64.dmg', browser_download_url: 'd', size: 5 }] }; };
  const a = await latest('0.1.7', { force: true, fetch });
  assert.equal(a.newer, true); assert.equal(a.version, '0.1.9');
  if (process.platform === 'darwin' && process.arch === 'arm64') assert.equal(a.asset.name, 'Claude Code Manager-0.1.9-arm64.dmg');
  await latest('0.1.7', { fetch }); assert.equal(calls, 1); // memoised
  await latest('0.1.7', { force: true, fetch }); assert.equal(calls, 2);
});
