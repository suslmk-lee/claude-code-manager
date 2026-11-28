'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { repo } = require('../src/ccmy');
test('check_repo: reads branch, uncommitted files, change size, commits and one file diff; says so outside a repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmy-repo-'));
  try {
    assert.match(await repo(dir), /git 저장소가 아닙니다/);
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir });
    g('init', '-q', '-b', 'work'); fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n'); g('add', '.'); g('commit', '-q', '-m', 'first commit');
    assert.match(await repo(dir), /## work\n\n\[커밋되지 않은 변경량\]\n\(없음\)[\s\S]*first commit/);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'two\n'); fs.writeFileSync(path.join(dir, 'new.txt'), 'x');
    const r = await repo(dir);
    assert.match(r, / M a\.txt/); assert.match(r, /\?\? new\.txt/); assert.match(r, /1 file changed/);
    assert.match(await repo(dir, 'a.txt'), /-one\n\+two/);
    assert.match(await repo(dir, 'new.txt'), /달라진 내용이 없습니다/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
