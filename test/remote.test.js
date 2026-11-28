'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const usage = require('../src/appusage');
const remote = require('../src/remote');

test('remote: sync uploads sessions, types commands only into live bg sessions, reports results next sync', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-remote-'));
  const file = path.join(dir, 'collect.json');
  fs.writeFileSync(file, JSON.stringify({ endpoint: 'http://qm.test/', token: 'qmo_x' }));
  usage.setFile(file);
  const calls = [];
  let commands = [{ id: 1, session: 'aaaa1111', body: '테스트 돌려줘' }, { id: 2, session: 'bbbb2222', body: 'x' }, { id: 3, session: 'cccc3333', body: 'y' }];
  remote.setFetcher(async (url, opt) => {
    calls.push({ url, auth: opt.headers.authorization, body: JSON.parse(opt.body) });
    const c = commands; commands = [];
    return { ok: true, status: 200, json: async () => ({ commands: url.endsWith('/ccm/sync') ? c : [] }) };
  });
  const sent = [];
  const sessions = [
    { id: 'aaaa1111', name: 'A', cwd: '/Users/me/work/repo-a', state: 'idle', canSend: true, profile: undefined },
    { id: 'bbbb2222', name: 'B', cwd: '/x/b', state: 'idle', canSend: false },
  ];
  remote.setEnabled(true, { snapshot: async () => sessions, send: async (r) => { sent.push(r); } });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const first = calls.shift();
  assert.equal(first.url, 'http://qm.test/ccm/sync');
  assert.equal(first.auth, 'Bearer qmo_x');
  assert.equal(first.body.sessions[0].folder, 'repo-a');
  assert.equal(first.body.sessions[0].cwd, undefined); // 전체 경로는 올리지 않는다
  assert.deepEqual(sent, [{ short: 'aaaa1111', cwd: '/Users/me/work/repo-a', text: '테스트 돌려줘', profile: undefined }]);

  await remote.tick();
  const second = calls.shift();
  assert.deepEqual(second.body.done.map((d) => [d.id, d.ok]), [[1, true], [2, false], [3, false]]);

  await remote.alert('needs', { id: 'aaaa1111', name: 'A', body: '진행할까요?' });
  assert.deepEqual(calls.shift(), { url: 'http://qm.test/ccm/alert', auth: 'Bearer qmo_x', body: { kind: 'needs', session: 'aaaa1111', name: 'A', body: '진행할까요?' } });

  // 되돌리기 어려운 일은 폰에서 시작하지 않는다 (CCMy 이어서 진행과 같은 금지 목록)
  commands = [{ id: 4, session: 'aaaa1111', body: 'main 에 머지하고 푸시해줘' }, { id: 5, session: 'aaaa1111', body: '다음 단계 진행해줘' }];
  sent.length = 0; await remote.tick(); calls.shift();
  assert.deepEqual(sent.map((x) => x.text), ['다음 단계 진행해줘']);
  await remote.tick();
  const third = calls.shift().body.done;
  assert.deepEqual(third.map((d) => [d.id, d.ok]), [[4, false], [5, true]]); assert.match(third[0].note, /폰에서 시킬 수 없습니다/);

  remote.setEnabled(false);
  assert.equal(remote.alert('done', { id: 'aaaa1111' }), null); // 꺼 두면 보내지 않는다
});
