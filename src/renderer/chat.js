'use strict';
/* global $, el, S, fmtN, fmtTok, shortPath, api, turnEl, TR, renderTabs, renderDetail, marked, openSession, attach, loadSessions, cur */
// 대화 탭의 챗 레이어: composer under the transcript, streaming assistant text, tool lines, permission / question cards.

const CH = new Map(); // key (sessionId) → { key, s, busy, model, pending: Map<id, req>, stream: { text, el } | null, status, closed }
const chatCapable = (s) => (s.chatNew || !s.local) && (CH.has(s.sessionId) || !s.live) && isAbs(s.cwd);

function chatState(s) {
  let st = CH.get(s.sessionId);
  if (!st) { st = { key: s.sessionId, s, busy: false, model: null, pending: new Map(), stream: null, status: '', closed: false, started: false }; CH.set(s.sessionId, st); }
  return st;
}

// ---- image attachments (paste / drop) ----
const MAX_SIDE = 1568; // the API's recommended long side; keeps base64 well under the per-image limit
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); // data: URLs pass the page CSP (img-src 'self' data:); blob: would not
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const keepPng = file.type === 'image/png' && c.width * c.height < 1200 * 1200;
        const dataUrl = keepPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9);
        resolve({ type: keepPng ? 'image/png' : 'image/jpeg', data: dataUrl.split(',')[1], dataUrl, name: file.name || 'paste' });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
// Hooks paste/drop on a composer textarea; `box` shows thumbnails; returns the live attachment list.
function attachImages(ta, box) {
  const list = [];
  const render = () => box.replaceChildren(...list.map((im, i) => el('span', { class: 'att' }, el('img', { src: im.dataUrl }), el('span', { class: 'x', text: '×', onclick: () => { list.splice(i, 1); render(); } }))));
  const take = async (files) => { for (const f of [...files].filter((f) => f.type.startsWith('image/')).slice(0, 8 - list.length)) { try { list.push(await shrinkImage(f)); } catch { /* skip */ } } render(); };
  ta.addEventListener('paste', (e) => { const files = [...(e.clipboardData?.files || [])]; if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); take(files); } });
  ta.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  ta.addEventListener('drop', (e) => { const files = [...(e.dataTransfer?.files || [])]; if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); take(files); } });
  return { list, clear: () => { list.length = 0; render(); } };
}

// ---- composer + live extras, appended by showTranscript ----
function renderChatUI(s, pane, list) {
  if (!chatCapable(s)) {
    if (s.live && s.kind === 'background') renderTerminalComposer(s, pane);
    else if (s.live) pane.append(el('div', { class: 'composer hint-bar', text: '다른 터미널에서 열린 세션입니다. 여기서는 실시간으로 읽기만 됩니다.' }));
    return;
  }
  const st = chatState(s);
  for (const req of st.pending.values()) list.append(requestCard(st, req));
  if (st.stream) list.append(streamEl(st));
  const ta = el('textarea', { class: 'composer-input', rows: '1', placeholder: st.started ? '메시지 (Enter 전송 · Shift+Enter 줄바꿈)' : `이 세션을 이어서 대화합니다 · ${shortPath(s.cwd)}` });
  const sendBtn = el('button', { class: 'primary', text: '보내기', onclick: () => submit() });
  const stopBtn = el('button', { text: '중단', onclick: () => api.chatInterrupt(st.key) });
  const handoffBtn = el('button', { text: '터미널로 넘기기', 'data-tip': '챗을 닫고 claude --bg --resume 으로 데몬이 이어받게 한 뒤 터미널 탭에서 붙습니다', onclick: () => handoffToTerminal(st) });
  const status = el('span', { class: 'msg chat-status', text: st.status });
  const attBox = el('div', { class: 'attachments' });
  const att = attachImages(ta, attBox);
  const submit = () => { const text = ta.value.trim(); if ((!text && !att.list.length) || st.busy) return; const images = att.list.map(({ type, data, dataUrl }) => ({ type, data, dataUrl })); att.clear(); ta.value = ''; ta.style.height = ''; sendChat(st, text || '(이미지)', images); };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } };
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
  st.ui = { ta, sendBtn, stopBtn, handoffBtn, status, list, pane };
  pane.append(attBox, el('div', { class: 'composer' }, ta, el('div', { class: 'composer-side' }, sendBtn, stopBtn, handoffBtn, status)));
  syncComposer(st);
  if (st.pending.size) pane.scrollTop = pane.scrollHeight;
}
function syncComposer(st) {
  if (!st.ui) return;
  st.ui.stopBtn.style.display = st.busy ? '' : 'none';
  st.ui.sendBtn.disabled = st.busy || st.closed;
  st.ui.handoffBtn.style.display = st.started && !st.s.chatNew ? '' : 'none';
  st.ui.handoffBtn.disabled = st.busy;
  st.ui.status.textContent = st.status;
}
function setStatus(st, text) { st.status = text; syncComposer(st); }
const atBottom = (pane) => pane.scrollHeight - pane.scrollTop - pane.clientHeight < 220; // the sticky composer covers ~100px of content
function appendLive(st, node) {
  if (!st.ui?.list.isConnected) return;
  const stick = atBottom(st.ui.pane);
  st.ui.list.append(node);
  if (stick) st.ui.pane.scrollTop = st.ui.pane.scrollHeight;
}

// ---- sending ----
async function sendChat(st, text, images = []) {
  const s = st.s;
  const picked = typeof takePickedBlock === 'function' ? takePickedBlock(s.sessionId) : '';
  if (picked) text = `${picked}\n\n${text}`; // browser pane: selected elements ride along with this message
  st.busy = true; st.closed = false; setStatus(st, st.started ? '전송 중…' : '세션 여는 중…');
  appendLive(st, turnEl({ role: 'user', text, images: images.length || undefined, thumbs: images.map((i) => i.dataUrl), ts: new Date().toISOString(), i: 'live-' + Date.now() }));
  endActivity(st); st.act = { start: Date.now(), tokens: 0 }; setPhase(st, st.started ? '요청 보냄…' : '세션 여는 중…');
  const payload = images.map(({ type, data }) => ({ type, data })); // base64 only over IPC
  try {
    if (!st.started) {
      const req = s.chatNew ? { key: st.key, cwd: s.cwd, text, images: payload, ...s.startOpts } : { key: st.key, cwd: s.cwd, text, images: payload, resume: s.sessionId };
      await api.chatStart(req); st.started = true;
      if (st.ui) st.ui.ta.placeholder = '메시지 (Enter 전송 · Shift+Enter 줄바꿈)';
    }
    else await api.chatSend(st.key, text, payload);
  } catch (e) { st.busy = false; setStatus(st, '오류: ' + e.message); }
}

// ---- activity row: spinner + phase + elapsed + output tokens while a turn runs (like the TUI's "Crunching… (24s · ↓1.6k)") ----
function activityEl(st) {
  if (st.act?.el?.isConnected) return st.act.el;
  const e = el('div', { class: 'activity' }, el('span', { class: 'spin' }), el('span', { class: 'phase', text: st.act?.phase || '요청 보냄…' }), el('span', { class: 'elapsed' }), el('span', { class: 'tok' }));
  st.act = { ...(st.act || {}), el: e, start: st.act?.start || Date.now(), tokens: st.act?.tokens || 0 };
  appendLive(st, e);
  if (!st.act.timer) st.act.timer = setInterval(() => tickActivity(st), 1000);
  return e;
}
function tickActivity(st) {
  const a = st.act; if (!a?.el) return;
  a.el.querySelector('.elapsed').textContent = `(${Math.round((Date.now() - a.start) / 1000)}s`;
  a.el.querySelector('.tok').textContent = a.tokens ? ` · ↓${fmtTok(a.tokens)})` : ')';
}
function setPhase(st, phase, { warn = false } = {}) {
  if (!st.busy) return;
  const e = activityEl(st);
  st.act.phase = phase; e.querySelector('.phase').textContent = phase; e.classList.toggle('warn', warn);
  if (st.ui?.list.lastElementChild !== e) { const stick = st.ui && atBottom(st.ui.pane); st.ui?.list.append(e); if (stick) st.ui.pane.scrollTop = st.ui.pane.scrollHeight; } // stay at the bottom
  tickActivity(st);
}
function endActivity(st) {
  const a = st.act; if (!a) return;
  clearInterval(a.timer); a.el?.remove(); st.act = null;
  return a;
}
function markToolDone(st, toolUseId, isError) {
  const line = st.ui?.list.querySelector(`[data-tool-use-id="${CSS.escape(toolUseId)}"]`);
  if (!line) return;
  const m = line.querySelector('.tool-mark'); if (m) { m.textContent = isError ? '✖' : '✓'; m.classList.add(isError ? 'err' : 'ok'); m.classList.remove('spin'); }
}

// ---- streaming assistant text ----
function streamEl(st) {
  const e = turnEl({ role: 'assistant', text: st.stream.text, model: st.model, ts: new Date().toISOString(), i: 'stream-' + st.key });
  e.classList.add('streaming');
  st.stream.el = e;
  return e;
}
function streamRender(st, text) { // markdown re-rendered per animation frame while streaming
  const body = st.stream?.el?.querySelector('.md-body');
  if (!body) return;
  const stick = st.ui && atBottom(st.ui.pane);
  body.innerHTML = marked.parse(text);
  if (stick) st.ui.pane.scrollTop = st.ui.pane.scrollHeight;
}
function streamAppend(st, delta) {
  if (!st.stream) { st.stream = { text: '', el: null, raf: 0 }; appendLive(st, streamEl(st)); }
  st.stream.text += delta;
  if (!st.stream.raf) st.stream.raf = requestAnimationFrame(() => { if (st.stream) { st.stream.raf = 0; streamRender(st, st.stream.text); } });
}
function streamFinish(st, fullText) {
  if (!st.stream) { if (fullText) appendLive(st, turnEl({ role: 'assistant', text: fullText, model: st.model, ts: new Date().toISOString(), i: 'a-' + Date.now() })); return; }
  if (st.stream.raf) cancelAnimationFrame(st.stream.raf);
  streamRender(st, fullText || st.stream.text);
  st.stream.el?.classList.remove('streaming');
  st.stream = null;
}

// ---- permission / question cards ----
const inputSummary = (i = {}) => i.questions?.map((q) => q.question).join(' / ') || i.command || i.file_path || i.pattern || i.url || i.description || JSON.stringify(i);
function requestCard(st, req) {
  const card = el('div', { class: 'card', id: `req-${st.key}-${req.id}` });
  const answer = (result, label) => {
    api.chatPermission(st.key, req.id, result);
    st.pending.delete(req.id);
    if (result.behavior === 'allow') { setStatus(st, `${req.tool} 실행 중…`); setPhase(st, `${req.tool} 실행 중…`); } else { setStatus(st, `${req.tool} 거부됨`); setPhase(st, '답변 작성 중…'); }
    card.replaceChildren(el('div', { class: 'card-done', text: `${req.tool === 'AskUserQuestion' ? '답변' : req.tool}: ${label}` }));
    S.unseen.delete(st.key); renderTabs();
  };
  if (req.tool === 'AskUserQuestion') {
    card.append(el('div', { class: 'card-head', text: 'Claude의 질문' }));
    const answers = {};
    const qs = req.input.questions || [];
    for (const q of qs) {
      const box = el('div', { class: 'q' }, el('div', { class: 'q-text', text: q.question }));
      const chosen = new Set();
      for (const o of q.options || []) {
        const b = el('button', { class: 'opt', 'data-tip': o.description || '', text: o.label, onclick: () => {
          if (q.multiSelect) { chosen.has(o.label) ? chosen.delete(o.label) : chosen.add(o.label); b.classList.toggle('on'); answers[q.question] = [...chosen].join(', '); }
          else { answers[q.question] = o.label; for (const x of box.querySelectorAll('.opt')) x.classList.toggle('on', x === b); }
          if (!q.multiSelect && qs.length === 1) answer({ behavior: 'allow', updatedInput: { ...req.input, answers } }, o.label);
        } });
        box.append(b);
      }
      const other = el('input', { class: 'opt-other', placeholder: '직접 입력…' });
      other.onkeydown = (e) => { if (e.key === 'Enter' && other.value.trim()) { answers[q.question] = other.value.trim(); if (qs.length === 1) answer({ behavior: 'allow', updatedInput: { ...req.input, answers } }, other.value.trim()); } };
      box.append(other);
      card.append(box);
    }
    if (qs.length > 1 || qs.some((q) => q.multiSelect)) card.append(el('div', { class: 'btns' }, el('button', { class: 'primary', text: '답변 보내기', onclick: () => answer({ behavior: 'allow', updatedInput: { ...req.input, answers } }, Object.values(answers).join(' / ')) })));
    return card;
  }
  const ruleLabel = (u) => u.type === 'addRules' ? u.rules.map((r) => r.toolName + (r.ruleContent ? `(${r.ruleContent})` : '')).join(', ') : u.type === 'setMode' ? `모드 → ${u.mode}` : u.type === 'addDirectories' ? `폴더 허용: ${u.directories.join(', ')}` : u.type;
  const whole = { type: 'addRules', rules: [{ toolName: req.tool }], behavior: 'allow', destination: 'session' }; // every call of this tool, this session only
  card.append(...[
    el('div', { class: 'card-head', text: `권한 요청 · ${req.tool}` }),
    req.title ? el('div', { class: 'card-title', text: req.title }) : null,
    el('pre', { class: 'card-input', text: String(inputSummary(req.input)).slice(0, 2000) }),
    req.decisionReason ? el('div', { class: 'msg card-why', text: `물어본 이유: ${req.decisionReason}` }) : null,
    req.blockedPath ? el('div', { class: 'msg', text: `허용 폴더 밖 경로: ${req.blockedPath}` }) : null,
    el('div', { class: 'btns' },
      el('button', { class: 'primary', text: '허용', 'data-tip': '이번 호출만', onclick: () => answer({ behavior: 'allow' }, '허용') }),
      req.suggestions?.length ? el('button', { text: '항상 허용 (제안 규칙)', 'data-tip': '추가되는 규칙:\n' + req.suggestions.map(ruleLabel).join('\n'), onclick: () => answer({ behavior: 'allow', updatedPermissions: req.suggestions }, '항상 허용: ' + req.suggestions.map(ruleLabel).join(', ')) }) : null,
      req.tool !== 'AskUserQuestion' ? el('button', { text: `${req.tool} 전체 허용 (이 세션)`, 'data-tip': `이 세션이 끝날 때까지 ${req.tool} 호출을 더 묻지 않습니다. 설정 파일에는 남지 않습니다.`, onclick: () => answer({ behavior: 'allow', updatedPermissions: [whole] }, `${req.tool} 전체 허용 (세션)`) }) : null,
      el('button', { class: 'danger', text: '거부', onclick: () => answer({ behavior: 'deny', message: 'Denied by the user in Claude Code Manager' }, '거부') })),
  ].filter((x) => x != null)); // DOM append would print "null" for skipped optional rows
  return card;
}

// ---- events from main ----
const blockText = (c) => (Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('') : typeof c === 'string' ? c : '');
api.onChatEvent(({ key, msg }) => {
  const st = CH.get(key) || [...CH.values()].find((x) => x.key === key); // a new chat is re-keyed to its session id on init; events keep the chat key
  if (!st) return;
  const m = msg;
  if (m.type === 'system' && m.subtype === 'init') {
    st.model = m.model; st.sessionId = m.session_id;
    if (st.s.chatNew && m.session_id && st.s.sessionId !== m.session_id) { // the placeholder tab becomes the real session
      const old = st.s.sessionId;
      st.s.sessionId = m.session_id; st.s.chatNew = false; st.s.live = true; st.s.kind = 'chat';
      S.tabs = S.tabs.map((x) => (x === old ? m.session_id : x)); if (S.sel === old) S.sel = m.session_id;
      CH.delete(old); CH.set(m.session_id, st);
      st.ui?.list.querySelector('p.msg')?.remove(); // the "first message creates the session" hint is done
      renderTabs();
    }
    if (!st.busy) return; setStatus(st, `${m.model} · 응답 대기 중…`);
  }
  else if (m.type === 'stream_event') {
    const ev = m.event;
    if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { streamAppend(st, ev.delta.text); setPhase(st, '답변 작성 중…'); }
    else if (ev?.type === 'content_block_start') setPhase(st, ev.content_block?.type === 'thinking' ? '생각 중…' : ev.content_block?.type === 'tool_use' ? `${ev.content_block.name} 호출 준비…` : '답변 작성 중…');
    else if (ev?.type === 'message_delta' && ev.usage?.output_tokens != null) { st.act && (st.act.msgTokens = ev.usage.output_tokens); }
    else if (ev?.type === 'message_stop' && st.act) { st.act.tokens += st.act.msgTokens || 0; st.act.msgTokens = 0; tickActivity(st); }
  }
  else if (m.type === 'assistant') {
    const c = m.message?.content || [];
    const text = blockText(c);
    if (text) streamFinish(st, text);
    for (const b of c) if (b.type === 'tool_use') {
      streamFinish(st);
      const line = turnEl({ role: 'tool', name: b.name, text: String(inputSummary(b.input)).slice(0, 400), ts: new Date().toISOString(), i: 't-' + Date.now() });
      if (b.id) { line.dataset.toolUseId = b.id; line.prepend(el('span', { class: 'tool-mark spin' })); }
      appendLive(st, line);
      setStatus(st, `${b.name} 실행 중…`); setPhase(st, `${b.name} 실행 중…`);
    }
  }
  else if (m.type === 'user') {
    for (const b of (Array.isArray(m.message?.content) ? m.message.content : [])) if (b.type === 'tool_result') { appendLive(st, turnEl({ role: 'result', text: blockText(b.content).slice(0, 2000), isError: !!b.is_error, ts: new Date().toISOString(), i: 'r-' + Date.now() })); if (b.tool_use_id) markToolDone(st, b.tool_use_id, !!b.is_error); setPhase(st, '결과 검토 중…'); }
  }
  else if (m.type === 'tool_progress') setPhase(st, `${m.tool_name} 실행 중 · ${Math.round(m.elapsed_time_seconds || 0)}s`);
  else if (m.type === 'system' && m.subtype === 'status' && m.status) setPhase(st, m.status === 'compacting' ? '컨텍스트 압축 중…' : String(m.status));
  else if (m.type === 'system' && m.subtype === 'hook_started') setPhase(st, `훅 ${m.hook_name || m.hook_event} 실행 중…`);
  else if (m.type === 'system' && m.subtype === 'task_progress' && m.description) setPhase(st, `서브에이전트: ${m.description}`);
  else if (m.type === 'permission_request') {
    st.pending.set(m.id, m);
    appendLive(st, requestCard(st, m));
    setStatus(st, m.tool === 'AskUserQuestion' ? 'Claude가 질문했습니다' : `권한 대기: ${m.tool}`);
    setPhase(st, m.tool === 'AskUserQuestion' ? '답변을 기다리는 중' : `권한 승인을 기다리는 중: ${m.tool}`, { warn: true });
    if (S.sel !== key || !document.hasFocus()) {
      S.unseen.add(key); renderTabs();
      try { const n = new Notification(m.tool === 'AskUserQuestion' ? `질문: ${st.s.name}` : `권한 요청: ${st.s.name}`, { body: m.tool === 'AskUserQuestion' ? (m.input.questions?.[0]?.question || '') : `${m.tool} · ${inputSummary(m.input)}`.slice(0, 120) }); n.onclick = () => { api.focusWindow(); openSession(key); }; } catch { /* no notifications */ }
    }
  }
  else if (m.type === 'permission_cancelled') { st.pending.delete(m.id); $(`#req-${CSS.escape(st.key)}-${m.id}`)?.replaceChildren(el('div', { class: 'card-done', text: '취소됨' })); }
  else if (m.type === 'result') {
    streamFinish(st);
    st.busy = false;
    const a = endActivity(st);
    const u = m.usage || {};
    appendLive(st, turnEl({ role: 'meta', kind: 'duration', ms: m.duration_ms || (a ? Date.now() - a.start : 0), ts: new Date().toISOString(), i: 'd-' + Date.now() }));
    setStatus(st, `${m.subtype === 'success' ? '완료' : '오류: ' + (m.subtype || '')} · ${m.num_turns || 0}턴 · ${((m.duration_ms || 0) / 1000).toFixed(1)}s${u.output_tokens ? ` · 출력 ${fmtTok(u.output_tokens)}` : ''}`);
    TR.delete(key); // the transcript on disk now has these turns; reload it on the next render
  }
  else if (m.type === 'warning') { if (st.ui && !st.ui.pane.querySelector('.warn-banner')) st.ui.pane.querySelector('.composer')?.before(el('div', { class: 'msg warn-banner', text: '⚠ ' + m.message })); }
  else if (m.type === 'error') { st.busy = false; endActivity(st); setStatus(st, '오류: ' + m.message); }
  else if (m.type === 'closed') { st.busy = false; endActivity(st); st.closed = true; st.started = false; setStatus(st, '세션 종료됨 · 다시 보내면 이어서 엽니다'); st.closed = false; CH.delete(st.s.sessionId); st.onClosed?.(); }
});
// Running background session: messages go through the shared `claude attach` client (same one the terminal tab
// shows), and replies arrive via the live transcript tail — both surfaces stay in sync.
const TACT = new Map(); // sessionId → activity element for running-terminal chats
function terminalActivity(s) {
  const e = TACT.get(s.sessionId); if (!e?.isConnected) return;
  const pane = e.closest('.pane'), stick = pane && atBottom(pane);
  const working = s.live && (s.state === 'working' || s.status === 'busy') && !(s.job?.needs || s.state === 'blocked');
  const was = { hidden: e.classList.contains('hidden'), text: e.querySelector('.phase').textContent };
  e.classList.toggle('hidden', !working);
  if (working) e.querySelector('.phase').textContent = s.job?.detail || '작업 중…';
  const list = e.parentElement; if (working && list && list.lastElementChild !== e) list.append(e);
  if (pane && stick && (was.hidden !== !working || was.text !== e.querySelector('.phase').textContent)) pane.scrollTop = pane.scrollHeight; // keep the newest line above the composer
}
function refreshTerminalActivity() { const s = cur(); if (s && TACT.has(s.sessionId)) terminalActivity(s); }
function renderTerminalComposer(s, pane) {
  const list = pane.querySelector('.turns');
  if (list) { const act = el('div', { class: 'activity hidden' }, el('span', { class: 'spin' }), el('span', { class: 'phase' }), el('span', { class: 'msg', text: ' · 터미널 세션 진행 중' })); list.append(act); TACT.set(s.sessionId, act); terminalActivity(s); }
  const waiting = !!(s.job?.needs || s.state === 'blocked');
  const ta = el('textarea', { class: 'composer-input', rows: '1', placeholder: waiting ? '세션이 입력(권한·질문)을 기다리는 중 — 터미널 탭에서 먼저 응답하세요' : '실행 중인 세션에 보내기 (터미널과 같은 세션 · Enter 전송 · 이미지 붙여넣기 가능)' });
  const status = el('span', { class: 'msg chat-status' });
  const attBox = el('div', { class: 'attachments' });
  const att = attachImages(ta, attBox);
  const submit = async () => {
    let text = ta.value.trim(); if (!text && !att.list.length) return;
    const picked = typeof takePickedBlock === 'function' ? takePickedBlock(s.sessionId) : '';
    if (picked) text = `${picked}\n\n${text}`;
    if (att.list.length) { // the TUI cannot take binary over the pty: save files, hand over paths (Claude reads them)
      const paths = [];
      for (const im of att.list) { try { paths.push(await api.saveImage(im.dataUrl, im.name)); } catch (e) { status.textContent = '이미지 저장 실패: ' + e.message; } }
      att.clear();
      text = `${text || '첨부한 이미지를 봐주세요.'}\n\n${paths.map((p) => `[첨부 이미지] ${p}`).join('\n')}`;
    }
    ta.value = ''; ta.style.height = ''; status.textContent = '전송 중…';
    pane.scrollTop = pane.scrollHeight;
    try { await api.ptySendToSession(s.short, s.cwd, text); status.textContent = '터미널 세션으로 전송됨 · 응답은 아래에 실시간으로'; pane.scrollTop = pane.scrollHeight; }
    catch (e) { status.textContent = '전송 실패: ' + e.message; }
  };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); } };
  ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
  ta.disabled = waiting;
  pane.append(attBox, el('div', { class: 'composer' }, ta, el('div', { class: 'composer-side' },
    el('button', { class: 'primary', text: '보내기', disabled: waiting ? 'true' : null, onclick: submit }),
    el('button', { text: '챗으로 전환', 'data-tip': '백그라운드 세션을 중지하고 SDK 챗으로 이어갑니다 (권한·질문 카드 사용 가능)', onclick: () => takeOverFromTerminal(s) }),
    status)));
}

// ---- hand-off both ways ----
const until = async (cond, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
async function handoffToTerminal(st) {
  const s = st.s, sessionId = s.sessionId;
  if (st.busy) return;
  setStatus(st, '챗 프로세스 닫는 중…');
  const closed = new Promise((r) => { st.onClosed = r; setTimeout(r, 5000); });
  api.chatClose(st.key);
  await closed; // --bg --resume must not see a second process on this transcript, or it starts a copy
  // a session that already has a daemon job record keeps its saved options: any flag would make the daemon start a copy
  const name = s.job || /^[0-9a-f]{8}$/.test(s.name) ? '' : s.name;
  const r = await api.resumeBg({ sessionId, cwd: s.cwd, name }).catch((e) => ({ ok: false, output: e.message }));
  if (!r.ok && r.untrusted) { // the daemon refuses untrusted folders: open the session in a local terminal instead (the trust prompt shows there)
    await until(async () => { await loadSessions(); return !S.sessions.find((v) => v.sessionId === sessionId)?.live; });
    TR.delete(sessionId); S.tab = 'terminal'; openSession(sessionId);
    await attach(cur()); // local `claude --resume`: the trust prompt appears in this terminal
    const t = S.terms.get(sessionId); if (t) t.status.textContent += ' · 신뢰되지 않은 폴더라 백그라운드 대신 로컬 터미널로 이어갑니다 (신뢰 프롬프트에 답하면 계속)';
    return;
  }
  if (!r.ok) { alert(r.output || '넘기기 실패'); return; }
  if (r.copy) { alert('챗 프로세스가 아직 끝나지 않아 복사본 세션이 만들어졌습니다. 잠시 후 다시 시도하세요.\n' + r.output); await loadSessions(); return; }
  const ok = await until(async () => { await loadSessions(); const x = S.sessions.find((v) => v.sessionId === sessionId); return x?.live && x.kind === 'background'; }, 15000);
  if (!ok) { alert('백그라운드 세션이 뜨지 않았습니다: ' + r.output); return; }
  TR.delete(sessionId); S.tab = 'terminal'; openSession(sessionId); attach(cur());
}
async function takeOverFromTerminal(s) {
  if (!confirm(`"${s.name}" 백그라운드 세션을 중지하고 여기서 챗으로 이어갈까요?`)) return;
  const r = await api.agentAction('stop', s.short);
  if (!r.ok) { alert(r.output || 'stop 실패'); return; }
  await until(async () => { await loadSessions(); return !S.sessions.find((v) => v.sessionId === s.sessionId)?.live; });
  TR.delete(s.sessionId); S.tab = 'transcript'; renderDetail();
}

function onElementPicked(s) { const st = CH.get(s.sessionId); if (st) setStatus(st, '선택한 요소가 다음 메시지에 첨부됩니다'); }

function chatOnTabClose(sessionId) { const st = CH.get(sessionId); if (st) { api.chatClose(st.key); CH.delete(sessionId); } }
// 새 세션 창 → 챗: a placeholder tab; the first message creates the session (title = name) and init swaps in the real id.
function newChatTab({ cwd, name, prompt, opts = {} }) {
  const tmp = 'chat-' + Date.now();
  const s = { sessionId: tmp, chatNew: true, local: true, kind: 'chat', name: name || `${baseName(cwd)} (챗)`, cwd, projectDir: cwd.replace(/[^A-Za-z0-9]/g, '-'),
    startOpts: { model: opts.model, effort: opts.effort, permissionMode: opts.permissionMode, agent: opts.agent, title: name || undefined } };
  S.local.push(s); S.tab = 'transcript';
  openSession(tmp);
  if (prompt) sendChat(chatState(s), prompt);
  return tmp;
}
