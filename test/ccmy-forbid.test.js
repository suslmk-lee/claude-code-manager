'use strict';
const test = require('node:test'), assert = require('node:assert');
const { FORBID } = require('../src/ccmy');
test('auto_continue forbidden list: hard-to-undo and outward-facing work is never answered automatically', () => {
  for (const t of ['MR 3건을 머지할까요?', 'git push origin main 할까요', '운영에 배포해도 될까요', 'v0.2 릴리스 진행할까요?', '이 폴더를 삭제할까요', 'rm -rf build', 'force 옵션으로 덮어쓸까요', '고객에게 메일 보낼까요', '결제 진행'])
    assert.ok(FORBID.test(t), t);
  for (const t of ['테스트부터 돌릴까요?', '다음 단계(설치 팩 재생성)를 진행할까요?', '네, 진행해 주세요', '함수 이름을 바꿀까요'])
    assert.ok(!FORBID.test(t), t);
});
