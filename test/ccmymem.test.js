'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.CCMY_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmymem-'));
const mem = require('../src/ccmymem');
test.after(() => fs.rmSync(process.env.CCMY_HOME, { recursive: true, force: true }));

test('notes: saved per scope, one line each, no duplicates, removable', () => {
  assert.deepEqual(mem.load(), []);
  mem.add('답은 세 줄\n이내', '');
  mem.add('답은 세 줄 이내');
  mem.add('테스트 통과하면 계속 진행', '/w/foo');
  assert.deepEqual(mem.load(), [{ scope: '전체', text: '답은 세 줄 이내' }, { scope: '/w/foo', text: '테스트 통과하면 계속 진행' }]);
  assert.deepEqual(mem.parse(mem.format(mem.load())), mem.load());
  assert.deepEqual(mem.notesFor('/w/foo/sub').map((n) => n.text), ['답은 세 줄 이내', '테스트 통과하면 계속 진행']);
  assert.deepEqual(mem.notesFor('/w/foobar').map((n) => n.text), ['답은 세 줄 이내']);
  assert.equal(mem.del('테스트 통과').length, 1);
  assert.equal(mem.del('답은 세 줄 이내', '/w/foo').length, 0); // exact delete needs the right scope
  assert.equal(mem.load().length, 1);
  assert.throws(() => mem.add('  '));
});
test('journal: one line per piece of work, read back by day and by word', () => {
  const now = new Date(2026, 10, 27, 14, 5);
  mem.journalAdd({ name: 'api 수정', cwd: '/w/foo', text: '로그인 오류\n수정' }, new Date(2026, 10, 26, 9, 3));
  mem.journalAdd({ name: '문서', cwd: '/w/bar', text: 'README 정리' }, now);
  assert.equal(mem.journalRead({ days: 1 }, now), '## 2026-11-27\n- 14:05 · 문서 (bar) :: README 정리');
  assert.match(mem.journalRead({ days: 7 }, now), /2026-11-27[\s\S]*2026-11-26\n- 09:03 · api 수정 \(foo\) :: 로그인 오류 수정/);
  assert.equal(mem.journalRead({ days: 7, query: '로그인' }, now), '## 2026-11-26\n- 09:03 · api 수정 (foo) :: 로그인 오류 수정');
});
test('handoff: per folder, newest first, only the last five kept', () => {
  assert.equal(mem.handoffRead('/w/foo'), '');
  for (let i = 1; i <= 6; i++) mem.handoffAdd('/w/foo', { name: 's' + i, did: '일 ' + i, left: i === 6 ? '배포 확인' : '', blocked: '' }, new Date(2026, 10, 28, 10, i));
  const t = mem.handoffRead('/w/foo');
  assert.match(t, /^## 2026-11-28 10:06 · s6\n- 한 일: 일 6\n- 남은 일: 배포 확인\n- 막힌 점: 없음/);
  assert.equal(t.split('## ').length - 1, 5); assert.ok(!t.includes('· s1\n'));
  assert.equal(mem.handoffRead('/w/bar'), '');
  assert.equal(mem.handoffAdd('/w/foo', { name: 'x', did: ' ' }), null);
});
test('one piece of work is one line: a newer entry of the same session within ten minutes replaces the last one', () => {
  const at = (h, m) => new Date(2026, 10, 20, h, m);
  mem.journalAdd({ name: 'api', cwd: '/w/foo', text: '질문하며 멈춤' }, at(9, 0));
  mem.journalAdd({ name: 'api', cwd: '/w/foo', text: '수정 완료' }, at(9, 6));
  mem.journalAdd({ name: '문서', cwd: '/w/foo', text: '다른 세션' }, at(9, 7));
  mem.journalAdd({ name: 'api', cwd: '/w/foo', text: '다음 작업' }, at(9, 30));
  assert.equal(mem.journalRead({ days: 1 }, at(10, 0)), '## 2026-11-20\n- 09:06 · api (foo) :: 수정 완료\n- 09:07 · 문서 (foo) :: 다른 세션\n- 09:30 · api (foo) :: 다음 작업');
  mem.handoffAdd('/w/merge', { name: 'api', did: '하는 중' }, at(9, 0)); mem.handoffAdd('/w/merge', { name: 'api', did: '끝냄' }, at(9, 5)); mem.handoffAdd('/w/merge', { name: 'api', did: '다음' }, at(9, 40));
  const t = mem.handoffRead('/w/merge'); assert.equal(t.split('## ').length - 1, 2); assert.ok(!t.includes('하는 중')); assert.match(t, /^## 2026-11-20 09:40 · api\n- 한 일: 다음/);
});
