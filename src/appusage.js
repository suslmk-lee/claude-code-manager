'use strict';
// 사내 앱 사용 기록 :: 켜진 분 · 설치 버전을 QuantumMate 서버로 보낸다 (quantum-mate docs/app-usage-client.md, 2026-11-25).
// 팀앱이 둔 collect.json 이 없으면 아무것도 보내지 않고, 실패는 조용히 버린다 — 앱 동작 · 화면에 영향 없음, 재시도 큐 없음.
const fs = require('fs');
const path = require('path');

const APP_ID = 'claude-code-manager'; // 팀장앱 앱 사용 화면에 이 이름으로 보인다 (앱마다 고정)
const BATCH = 5; // 분이 이만큼 모이면 보낸다
let file = path.join(process.env.HOME || '', 'Library/Application Support/ai.quantumcns.quantummate/collect.json');
let fetcher = (...a) => fetch(...a);
let version = '', pending = 0, timer;

// 보낼 때마다 새로 읽는다 (팀앱이 재로그인 때 다시 쓴다)
const collect = () => { try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); return c.endpoint && c.token ? c : null; } catch { return null; } };

// 응답은 보지 않는다 — 401 · 404 · 네트워크 오류 모두 무시. 토큰은 헤더에만 있고 어디에도 찍지 않는다
async function send(minutes, timeout = 10000) {
  const c = collect();
  if (!c) return false;
  try {
    await fetcher(c.endpoint.replace(/\/+$/, '') + '/apps/usage', {
      method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' },
      body: JSON.stringify({ app: APP_ID, version, minutes: Math.min(minutes, 10) }), signal: AbortSignal.timeout(timeout),
    });
    return true;
  } catch { return false; }
}

// 켤 때 minutes 0 한 번, 그 뒤 1분 타이머 틱으로 센다 (벽시계 차이 아님). Mac 이 잠자면 타이머도 멈추고, 깨어날 때 밀린 틱은 한 번만 온다
function start(ver) {
  version = String(ver || '');
  pending = 0;
  clearInterval(timer);
  timer = setInterval(() => { if (++pending >= BATCH) { const m = pending; pending = 0; send(m); } }, 60000);
  return send(0);
}

// 끌 때 :: 남은 분을 2초 안에 보낸다. 보낼 것이 없으면 null
function flush() { const m = pending; pending = 0; return m ? send(m, 2000) : null; }

module.exports = { APP_ID, start, flush, send, setFile: (p) => { file = p; }, setFetcher: (f) => { fetcher = f || ((...a) => fetch(...a)); } };
