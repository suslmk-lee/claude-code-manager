'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const usage = require('../src/appusage');

test('app usage: nothing without collect.json; 0 on start, 5 per 5 ticks, the rest on quit; file re-read each send', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-usage-'));
  const file = path.join(dir, 'collect.json');
  usage.setFile(file);
  const calls = [];
  usage.setFetcher(async (url, opt) => { calls.push({ url, auth: opt.headers.authorization, body: JSON.parse(opt.body) }); if (opt.headers.authorization.endsWith('bad')) throw new Error('fetch failed'); return { status: 204 }; });

  await usage.start('0.1.23'); // 팀앱 미설치 · 로그인 전: 파일이 없다
  t.mock.timers.tick(10 * 60000);
  assert.equal(usage.flush(), null);
  assert.deepEqual(calls, []);

  fs.writeFileSync(file, JSON.stringify({ endpoint: 'http://127.0.0.1:18090/', token: 'qmo_test' }));
  await usage.start('0.1.23');
  assert.deepEqual(calls.pop(), { url: 'http://127.0.0.1:18090/apps/usage', auth: 'Bearer qmo_test', body: { app: 'claude-code-manager', version: '0.1.23', minutes: 0 } });
  t.mock.timers.tick(4 * 60000);
  assert.equal(calls.length, 0);
  t.mock.timers.tick(60000);
  assert.deepEqual(calls.pop().body, { app: 'claude-code-manager', version: '0.1.23', minutes: 5 });
  fs.writeFileSync(file, JSON.stringify({ endpoint: 'http://127.0.0.1:18090', token: 'qmo_bad' })); // 팀앱이 다시 쓴 토큰
  t.mock.timers.tick(2 * 60000);
  assert.equal(await usage.flush(), false); // 실패도 조용히
  assert.deepEqual(calls.pop(), { url: 'http://127.0.0.1:18090/apps/usage', auth: 'Bearer qmo_bad', body: { app: 'claude-code-manager', version: '0.1.23', minutes: 2 } });
  assert.equal(usage.flush(), null); // 보낸 분은 비워진다
  fs.rmSync(dir, { recursive: true, force: true });
});
