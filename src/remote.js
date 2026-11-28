'use strict';
// 폰 원격 (QuantumMate 모바일, 2026-11-28) :: 세션 목록을 QuantumMate 서버에 올리고, 폰에서 보낸 지시를 받아 세션에 입력한다.
// 서버 :: quantum-mate server/internal/api/ccm.go. 인증은 팀앱이 둔 collect.json 의 수집 토큰 (appusage.js 와 같음)
//   POST /ccm/sync {sessions, done} → {commands: [{id, session, body}]}   15초마다, 켜 둔 동안만 (모양 › 알림 › 폰 원격)
//   POST /ccm/alert {kind: needs|done, session, name, body}               입력 대기 · 작업 완료 (켜 둔 동안만)
// 지시는 실행 중인 백그라운드 세션 (canSend) 에만 넣는다. 결과는 다음 sync 의 done 으로 보고. 실패는 조용히 버리고 다음 틱에 다시
// ponytail: 폴링 15초 :: 서버가 SSE 를 주면 그때 바꾼다
const { collect } = require('./appusage');

const EVERY = 15000;
let fetcher = (...a) => fetch(...a);
let deps = null; // { snapshot: () => Promise<session[]>, send: ({short, cwd, text, profile}) => Promise, notice: (title, body) => void }
let timer = null, busy = false;
const done = []; // 다음 sync 에 보낼 결과

async function post(path, body) {
  const c = collect();
  if (!c) return null;
  const r = await fetcher(c.endpoint.replace(/\/+$/, '') + path, {
    method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  return r.ok && r.status !== 204 ? r.json() : null;
}

// 폰에 보일 만큼만 :: 폴더 경로는 마지막 이름만
const brief = (s) => ({ id: s.id, name: s.name, folder: String(s.cwd || '').split(/[\\/]/).filter(Boolean).pop() || '', state: s.state,
  needs: s.needs, detail: s.detail ? String(s.detail).slice(0, 300) : null, canSend: !!s.canSend, lastActivity: s.lastActivity });

async function tick() {
  if (busy || !deps) return;
  busy = true;
  try {
    const sessions = await deps.snapshot();
    const out = done.splice(0);
    let res;
    try { res = await post('/ccm/sync', { sessions: sessions.map(brief), done: out }); } catch { done.unshift(...out); return; }
    for (const c of res?.commands || []) {
      const s = sessions.find((x) => x.id === c.session);
      if (!s?.canSend) { done.push({ id: c.id, ok: false, note: s ? '실행 중인 백그라운드 세션이 아닙니다' : '세션을 찾지 못했습니다' }); continue; }
      try {
        await deps.send({ short: s.id, cwd: s.cwd, text: c.body, profile: s.profile });
        done.push({ id: c.id, ok: true, note: '' });
        deps.notice?.(`폰에서 보낸 지시 :: ${s.name}`, c.body.slice(0, 200));
      } catch (e) { done.push({ id: c.id, ok: false, note: String(e.message || e).slice(0, 200) }); }
    }
  } catch { /* 창이 아직 없음 등 :: 다음 틱 */ } finally { busy = false; }
}

function setEnabled(on, d) {
  if (d) deps = d;
  clearInterval(timer); timer = null;
  if (on && deps) { timer = setInterval(tick, EVERY); tick(); }
  return !!timer;
}

// 입력 대기 · 작업 완료 → 내 알림함 (켜 둔 동안만)
function alert(kind, s) {
  if (!timer || !s?.id) return null;
  return post('/ccm/alert', { kind, session: s.id, name: s.name || '', body: String(s.body || '').slice(0, 1500) }).catch(() => null);
}

module.exports = { setEnabled, alert, tick, setFetcher: (f) => { fetcher = f || ((...a) => fetch(...a)); } };
