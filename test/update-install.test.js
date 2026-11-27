'use strict';
// installMac end to end with a throwaway dmg: the new app is staged, and once the watched process exits the folders swap.
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawn } = require('child_process');
const update = require('../src/update');

test('installMac swaps the app after the old process exits', { skip: process.platform !== 'darwin' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-upd-test-'));
  try {
    const src = path.join(dir, 'src', 'Fake.app'), target = path.join(dir, 'Apps', 'Fake.app'), dmg = path.join(dir, 'fake.dmg');
    fs.mkdirSync(src, { recursive: true }); fs.writeFileSync(path.join(src, 'v'), 'new');
    fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, 'v'), 'old');
    execFileSync('hdiutil', ['create', '-quiet', '-srcfolder', path.join(dir, 'src'), '-format', 'UDZO', dmg]);
    const old = spawn('sleep', ['4']); // stands in for the running app
    const exited = new Promise((r) => old.on('exit', r)); // listen now: a slow hdiutil can outlast the sleep
    await update.installMac(dmg, target, { pid: old.pid, relaunch: false });
    if (old.exitCode == null) assert.equal(fs.readFileSync(path.join(target, 'v'), 'utf8'), 'old', 'nothing changes while the app runs');
    await exited;
    for (let i = 0; i < 40 && fs.existsSync(target + '.update'); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fs.readFileSync(path.join(target, 'v'), 'utf8'), 'new');
    assert.ok(!fs.existsSync(target + '.old') && !fs.existsSync(target + '.update'), 'no leftovers');
    await assert.rejects(update.installMac(path.join(dir, 'missing.dmg'), target, { relaunch: false }), /hdiutil/);
    assert.equal(fs.readFileSync(path.join(target, 'v'), 'utf8'), 'new', 'a bad image leaves the app alone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
