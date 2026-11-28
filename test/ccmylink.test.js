'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
process.env.CCMY_HOME = process.env.CCMY_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'ccmylink-'));
const link = require('../src/ccmylink');
test('협업: @@협업 blocks are read out of a reply, and the app keeps the record', () => {
  const reply = 'API를 고쳤습니다.\n\n@@협업 알림\n로그인 응답에 `role` 필드 추가\n형식: string\n@@끝\n\n그리고\n  @@협업 완료\n@@끝\n@@협업 잡담\n무시\n@@끝\n@@협업 요청\n\n@@끝';
  assert.deepEqual(link.parse(reply), [{ kind: '알림', text: '로그인 응답에 `role` 필드 추가\n형식: string' }, { kind: '완료', text: '' }]);
  assert.deepEqual(link.parse('협업 문서에 @@협업 요청 이라고 적으면 됩니다'), []);
  assert.throws(() => link.file('../x'));
  link.start('t1', '# 문서\n\n');
  link.append('t1', [{ name: 'A  세션', kind: '요청', text: '숫자 주세요' }, { name: 'B', kind: '완료', text: '' }], new Date(2026, 10, 28, 9, 5));
  assert.equal(fs.readFileSync(link.file('t1'), 'utf8'), '# 문서\n\n## 09:05 · A 세션 · 요청\n숫자 주세요\n\n## 09:05 · B · 완료\n(내용 없음)\n\n');
  fs.rmSync(path.join(process.env.CCMY_HOME, 'links'), { recursive: true, force: true });
});
