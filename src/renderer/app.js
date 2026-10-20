'use strict';
/* global Terminal, FitAddon */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v != null) e.setAttribute(k, v); // null = attribute absent (setAttribute would write "null", e.g. disabled="null")
  }
  for (const k of kids.flat()) if (k != null) e.append(k);
  return e;
};
const fmtN = (n) => (n ?? 0).toLocaleString();
const fmtTok = (n = 0) => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const fmtBytes = (n = 0) => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : (n / 1e3).toFixed(0) + ' KB';
const fmtDur = (ms = 0) => { const h = Math.floor(ms / 3.6e6), m = Math.round((ms % 3.6e6) / 6e4); return h ? `${h}h ${m}m` : `${m}m`; };
const pad2 = (n) => String(n).padStart(2, '0');
// local-time formatters (the machine's zone, KST here): transcripts carry UTC ISO stamps
const fmtLocalDate = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtLocalDT = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : `${fmtLocalDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fmtLocalStamp = (ts) => { const d = new Date(ts); return isNaN(d) ? '' : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }; // MM-DD HH:mm
const fmtAgo = (ts) => {
  if (!ts) return '';
  const d = Date.now() - ts, m = d / 6e4, h = m / 60, day = h / 24;
  return m < 1 ? '방금' : m < 60 ? `${Math.floor(m)}분 전` : h < 24 ? `${Math.floor(h)}시간 전` : `${Math.floor(day)}일 전`;
};
const isMac = api.platform === 'darwin', isWinOS = api.platform === 'win32';
document.documentElement.classList.toggle('mac', isMac); // header doubles as the title bar on macOS (see style.css)
const kbd = (s) => isMac ? s : s.replace(/⌘|⌃/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+'); // kbd('⌘S') → 'Ctrl+S' off mac
const isAbs = (p = '') => /^([/\\]|[A-Za-z]:[\\/])/.test(p); // /…, C:\…, C:/…, \\server\…
const baseName = (p = '') => p.split(/[\\/]/).filter(Boolean).pop() || p;
const shortPath = (p = '') => {
  const h = api.home || '';
  if (h && p.length >= h.length && (isWinOS ? p.slice(0, h.length).toLowerCase() === h.toLowerCase() : p.startsWith(h)) && (p.length === h.length || /[\\/]/.test(p[h.length]))) return '~' + p.slice(h.length);
  return p.replace(/^\/Users\/[^/]+|^\/home\/[^/]+|^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i, '~');
};

const S = {
  view: 'sessions', sessions: [], local: [], sel: null, tab: 'terminal', tabs: [], booted: false, unseen: new Set(),
  profiles: [], terms: new Map(), shells: new Map(), shellOpen: (() => { try { return localStorage.getItem('shellOpen') === '1'; } catch { return false; } })(), memory: null, projects: [], memSel: null, memFilter: '', memProject: '',
};
const cur = () => S.sessions.find((s) => s.sessionId === S.sel) || S.local.find((s) => s.sessionId === S.sel);

// ---------- navigation ----------
function setView(v) {
  S.view = v;
  for (const k of ['memory', 'stats']) { $(`#btn-${k}`).classList.toggle('active', v === k); $(`#view-${k}`).classList.toggle('hidden', v !== k); }
  $('#view-sessions').classList.toggle('hidden', v !== 'sessions');
  if (typeof syncBrowserPane === 'function') syncBrowserPane(v === 'sessions' ? cur() : null);
  renderTabs();
  if (v === 'memory') loadMemory();
  if (v === 'stats') loadStats();
  if (v === 'sessions') fitCurrent();
}
$('#btn-memory').onclick = () => setView(S.view === 'memory' ? 'sessions' : 'memory');
$('#btn-stats').onclick = () => setView(S.view === 'stats' ? 'sessions' : 'stats');
const menu = $('#sessions-menu');
$('#btn-sessions').onclick = () => { menu.classList.remove('closed'); menu.classList.toggle('open'); };
menu.onmouseleave = () => { if (ctx.classList.contains('hidden')) menu.classList.remove('closed', 'open'); }; // keep the list up while its context menu is open
const closeFlyout = () => { menu.classList.remove('open'); menu.classList.add('closed'); }; // stays shut until the mouse leaves

// ---------- sessions ----------
async function loadSessions() {
  [S.sessions, S.cliVersion, S.profiles] = await Promise.all([api.listSessions(), api.cliVersion(), api.listProfiles().catch(() => S.profiles)]);
  renderVersionBar();
  if (!S.booted) { // tabs from the last run come back; only a first run (nothing saved) opens every running session
    S.booted = true;
    const saved = loadTabs();
    S.tabs = saved?.tabs || S.sessions.filter((s) => s.live).map((s) => s.sessionId);
    if (saved?.sel) S.sel = saved.sel;
  }
  trackNeedsInput();
  const selBefore = S.sel;
  for (const s of S.sessions) if (s.continuedIn && !s.live && S.sessions.some((x) => x.sessionId === s.continuedIn)) followContinuation(s.sessionId, s.continuedIn);
  S.local =S.local.filter((l) => !S.sessions.some((s) => s.sessionId === l.sessionId)); // a new chat's placeholder gives way to the real session
  S.tabs = S.tabs.filter((id) => S.sessions.some((s) => s.sessionId === id) || S.local.some((s) => s.sessionId === id));
  if (!S.tabs.includes(S.sel)) S.sel = S.tabs[0] || null;
  renderSessionList();
  renderTabs();
  const head = $('#detail-head'), s = cur();
  if (head && s) head.replaceWith(buildHead(s)); // live refresh touches the header only, so the terminal keeps focus
  // the other terminal ran /background (or ←): the session is now daemon-owned, so swap the live log for the real TUI
  // the shown terminal has no TUI yet but the session is now a live background one (e.g. a /background hand-off whose daemon
  // worker came up after the tab switched): attach. Never auto-resume a stopped session, never undo the user's detach.
  const st = s && S.terms.get(s.sessionId);
  if (st && S.view === 'sessions' && S.tab === 'terminal' && !st.ptyId && !st.detached && !st.btn.disabled && attachArgs(s)?.[0] === 'attach') attach(s);
  // render when the selection changed (a hand-off) or nothing is shown for it yet (first load with a remembered selection)
  if (S.sel !== selBefore || (s && !head)) renderDetail();
  else if (typeof refreshTerminalActivity === 'function') refreshTerminalActivity();
}
// `/background` (or ←) in another terminal ends that interactive session and continues it under a new daemon id
// (transcript record `continued-in`). The tab follows in place; resuming the old id would fork the conversation.
function followContinuation(oldId, newId) {
  const i = S.tabs.indexOf(oldId);
  if (i === -1) return;
  const t = S.terms.get(oldId);
  if (t) { if (t.ptyId) api.ptyKill(t.ptyId); t.term.dispose(); S.terms.delete(oldId); }
  const h = S.shells.get(oldId); // the shell is just a pty in that folder: it follows the tab to the new id
  if (h) { S.shells.delete(oldId); if (S.shells.has(newId)) { if (h.ptyId) api.ptyKill(h.ptyId); h.term.dispose(); } else S.shells.set(newId, h); }
  if (S.tabs.includes(newId)) S.tabs.splice(i, 1); else S.tabs[i] = newId;
  if (S.sel === oldId) S.sel = newId;
  saveTabs();
}
// ---------- needs-input: notify on the transition, badge until the tab is opened ----------
const needsInput = (s) => !!(s.job?.needs || s.state === 'blocked');
let prevNeeds = null; // null until the first load, so sessions already waiting at startup do not fire
function trackNeedsInput() {
  const now = new Set(S.sessions.filter(needsInput).map((s) => s.sessionId));
  if (prevNeeds) for (const id of now) if (!prevNeeds.has(id)) notifyNeedsInput(S.sessions.find((s) => s.sessionId === id));
  for (const id of [...S.unseen]) if (!now.has(id)) S.unseen.delete(id);
  prevNeeds = now;
  api.setBadge(now.size);
  const btn = $('#btn-sessions');
  btn.replaceChildren('세션 ▾', now.size ? el('span', { class: 'pill', text: String(now.size) }) : '');
}
function notifyNeedsInput(s) {
  S.unseen.add(s.sessionId);
  if (!S.tabs.includes(s.sessionId)) S.tabs.push(s.sessionId);
  try {
    const n = new Notification(`입력 대기: ${s.name}`, { body: s.job?.needs || s.job?.detail || '세션이 입력을 기다립니다', silent: false });
    n.onclick = () => { api.focusWindow(); openSession(s.sessionId); };
  } catch { /* notifications unavailable: the badge still shows */ }
}

// Installed Claude Code version vs. the version each running background session was started with.
const outdated = () => S.sessions.filter((s) => s.live && s.kind === 'background' && s.version && S.cliVersion && s.version !== S.cliVersion);
function renderVersionBar() {
  const bar = $('#version-bar'), old = outdated(), bg = S.sessions.filter((s) => s.live && s.kind === 'background');
  bar.replaceChildren(...[ // native replaceChildren would print a null as "null"
    el('span', { class: 'msg', text: `Claude Code v${S.cliVersion || '?'} · 실행 중인 bg 세션 ${bg.length}개` }),
    old.length ? el('span', { class: 'pill', text: `구버전 ${old.length}개` }) : null,
    el('button', { class: old.length ? 'primary' : '', text: '모두 재시작 (respawn --all)', disabled: bg.length ? null : 'true', onclick: async () => {
      const names = (old.length ? old : bg).map((s) => `· ${s.name} (v${s.version || '?'})`).join('\n');
      if (!confirm(`실행 중인 백그라운드 세션을 모두 현재 Claude Code v${S.cliVersion}로 재시작할까요?\n대화는 그대로 이어지고, 붙어 있던 터미널은 떨어졌다가 다시 붙을 수 있습니다.\n\n${names}`)) return;
      const r = await api.respawnAll();
      if (!r.ok) alert(r.output || 'respawn 실패');
      setTimeout(loadSessions, 1500);
    } })].filter(Boolean));
}

// open tabs, their order and the selected one persist across restarts
const loadTabs = () => { try { return JSON.parse(localStorage.getItem('openTabs')); } catch { return null; } };
const saveTabs = () => { if (S.booted) try { localStorage.setItem('openTabs', JSON.stringify({ tabs: S.tabs, sel: S.sel })); } catch { /* fine */ } };
function renderTabs() {
  saveTabs();
  const all = [...S.local, ...S.sessions];
  $('#tabs').replaceChildren(...S.tabs.map((id) => all.find((s) => s.sessionId === id)).filter(Boolean).map((s) => {
    const st = s.job?.needs ? 'blocked' : (s.state || s.status || '');
    const n = S.tabs.indexOf(s.sessionId) + 1;
    const t = el('div', { class: 'tab' + (s.sessionId === S.sel && S.view === 'sessions' ? ' active' : ''), draggable: 'true', 'data-tip': `${n <= 9 ? `${kbd('⌘' + n)} · ` : ''}${shortPath(s.cwd)}\n${s.job?.needs || s.job?.detail || ''}`.trim(), onclick: () => openSession(s.sessionId), oncontextmenu: (e) => showCtx(e, s),
      // drag to reorder: native HTML5 DnD; the half of the target the pointer is over decides before/after
      ondragstart: (e) => { S.dragTab = s.sessionId; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.sessionId); setTimeout(() => t.classList.add('dragging')); },
      ondragover: (e) => { if (!S.dragTab || S.dragTab === s.sessionId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = t.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; t.classList.toggle('drop-after', after); t.classList.toggle('drop-before', !after); },
      ondragleave: () => t.classList.remove('drop-before', 'drop-after'),
      ondrop: (e) => { e.preventDefault(); e.stopPropagation(); moveTab(S.dragTab, s.sessionId, t.classList.contains('drop-after')); },
      ondragend: () => { S.dragTab = null; renderTabs(); } },
      el('span', { class: 'glyph ' + st, text: s.live || s.local ? '✱' : '•' }),
      el('span', { class: 'label', text: s.name }),
      profileBadge(s),
      S.unseen.has(s.sessionId) ? el('span', { class: 'pill', text: '입력' }) : null,
      el('span', { class: 'x', text: '×', 'data-tip': '탭 닫기 (세션은 계속 실행)', onclick: (e) => { e.stopPropagation(); closeTab(s.sessionId); } }));
    return t;
  }));
  requestAnimationFrame(() => { ($('#tabs .tab.active') || $('#tabs .pill')?.closest('.tab'))?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); updateTabArrows(); });
}
function moveTab(from, to, after) { // ⌘1-9 follow the new order
  if (!from || from === to || !S.tabs.includes(to)) return;
  const arr = S.tabs.filter((x) => x !== from);
  arr.splice(arr.indexOf(to) + (after ? 1 : 0), 0, from);
  S.tabs = arr;
  renderTabs();
}
// the strip scrolls (hidden scrollbar); arrows appear only when tabs overflow it
function updateTabArrows() {
  const t = $('#tabs'), over = t.scrollWidth > t.clientWidth + 1;
  $('#tabs-prev').hidden = $('#tabs-next').hidden = !over;
  $('#tabs-prev').disabled = t.scrollLeft <= 0;
  $('#tabs-next').disabled = t.scrollLeft + t.clientWidth >= t.scrollWidth - 1;
}
{
  const strip = $('#tabs');
  strip.ondragover = (e) => { if (S.dragTab) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } };
  strip.ondrop = (e) => { e.preventDefault(); if (S.dragTab) moveTab(S.dragTab, S.tabs[S.tabs.length - 1], true); }; // empty strip space → last
  strip.onwheel = (e) => { if (!e.deltaX && e.deltaY) strip.scrollLeft += e.deltaY; }; // mouse wheel scrolls the strip sideways
  strip.onscroll = updateTabArrows;
  new ResizeObserver(updateTabArrows).observe(strip);
  $('#tabs-prev').onclick = () => strip.scrollBy({ left: -strip.clientWidth * 0.7, behavior: 'smooth' });
  $('#tabs-next').onclick = () => strip.scrollBy({ left: strip.clientWidth * 0.7, behavior: 'smooth' });
}
function openSession(id) {
  if (!S.tabs.includes(id)) S.tabs.push(id);
  S.sel = id;
  S.unseen.delete(id);
  closeFlyout();
  if (S.view !== 'sessions') setView('sessions');
  renderSessionList(); renderTabs(); renderDetail();
}
function closeTab(id) {
  if (typeof chatOnTabClose === 'function') chatOnTabClose(id); // an SDK chat on this tab ends with it (transcript stays)
  const t = S.terms.get(id);
  if (t) { if (t.ptyId) api.ptyKill(t.ptyId); t.term.dispose(); S.terms.delete(id); } // detach only: the session itself keeps running
  const h = S.shells.get(id);
  if (h) { if (h.ptyId) api.ptyKill(h.ptyId); h.term.dispose(); S.shells.delete(id); }
  S.tabs = S.tabs.filter((x) => x !== id);
  S.local = S.local.filter((s) => s.sessionId !== id);
  if (S.sel === id) S.sel = S.tabs[S.tabs.length - 1] || null;
  renderSessionList(); renderTabs(); renderDetail();
}
function renderSessionList() {
  const list = $('#session-list');
  list.replaceChildren();
  const group = (title, arr) => {
    if (!arr.length) return;
    list.append(el('div', { class: 'group-title', text: `${title} (${arr.length})` }));
    for (const s of arr) list.append(sessionRow(s));
  };
  const bucket = (s) => s.pinned ? 'pinned' : (s.job?.needs || s.state === 'blocked') ? 'needs'
    : (s.state === 'working' || s.status === 'busy') ? 'working' : s.job ? 'done' : 'other';
  const by = {};
  const q = (S.sessFilter || '').toLowerCase();
  const match = (s) => !q || `${s.name} ${s.cwd} ${s.profile || ''} ${s.state || ''} ${s.status || ''} ${s.job?.needs || s.job?.detail || ''}`.toLowerCase().includes(q);
  for (const s of S.sessions) if (match(s)) (by[bucket(s)] ||= []).push(s);
  group('핀', by.pinned || []);
  group('입력 대기', by.needs || []);
  group('작업 중', by.working || []);
  group('완료', by.done || []);
  group('트랜스크립트만', by.other || []);
}
function linksLabel(job) {
  if (!job) return '';
  const n = job.prs?.length || 0;
  const pr = n > 1 ? `${n} PRs` : n === 1 ? (job.prs[0].href?.includes('/merge_requests/') ? '!' : '#') + job.prs[0].id : '';
  return [pr, job.frames ? '⧉' + (job.frames > 1 ? job.frames : '') : ''].filter(Boolean).join(' ');
}
const profileBadge = (s) => (s.profile && s.profile !== 'default' ? el('span', { class: 'pbadge', text: s.profile, 'data-tip': `프로파일 ${s.profile} (${(S.profiles.find((p) => p.id === s.profile) || {}).dir || ''})` }) : null);
function sessionRow(s) {
  const st = s.job?.needs ? 'blocked' : (s.state || s.status || '');
  const detail = s.job?.needs || s.job?.detail || s.lastPrompt || s.job?.intent || '';
  return el('div', { class: 'sess' + (s.sessionId === S.sel ? ' sel' : ''), 'data-tip': `${shortPath(s.cwd)}\n${detail}`, onclick: () => openSession(s.sessionId), oncontextmenu: (e) => showCtx(e, s) },
    el('span', { class: 'name' }, el('span', { class: 'glyph ' + st, text: s.live ? '✱' : '•' }), s.name, profileBadge(s)),
    el('span', { class: 'detail', text: detail }),
    el('span', { class: 'links', text: linksLabel(s.job) }),
    el('span', { class: 'age', text: fmtAgo(s.lastActivity) }));
}

// ---- status line under the header: model | branch* | context/window | 5h % (reset) | 7d % | mode | MR ----
const modelLabel = (m = '') => { const x = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(m); return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? '.' + x[3] : ''}` : (m || ''); };
const fmtUntil = (iso) => { const ms = Date.parse(iso) - Date.now(); if (!(ms > 0)) return ''; const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4); return h >= 24 ? `${Math.floor(h / 24)}d${h % 24}h` : h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`; };
let usageCache = { at: 0, v: null };
async function getUsage() { if (Date.now() - usageCache.at > 60000) { usageCache = { at: Date.now(), v: await api.usage().catch(() => null) }; } return usageCache.v; }
function statusLine(s) {
  const sep = () => el('span', { class: 'sl-sep', text: '|' });
  const line = el('div', { class: 'statusline' });
  const win = /haiku/.test(s.lastModel || '') ? 200000 : 1000000;
  const jobPr = s.job?.prs?.length ? s.job.prs[s.job.prs.length - 1] : null; // the daemon's link scan covers the whole transcript
  const pr = s.pr || (jobPr ? { number: jobPr.id, url: jobPr.href } : null);
  const ctxPct = s.lastContext ? s.lastContext / win : 0;
  line.append(...[
    el('span', { class: 'sl-model', text: modelLabel(s.lastModel) || '모델 ?' }), sep(),
    el('span', { class: 'sl-branch', text: s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : '…' }), sep(),
    s.lastContext ? el('span', { class: 'sl-ctx' + (ctxPct > 0.8 ? ' warn' : ''), 'data-tip': '현재 대화의 컨텍스트 크기 (마지막 응답의 입력 토큰) / 모델 컨텍스트 한도', text: `${fmtTok(s.lastContext)}/${fmtTok(win)}` }) : el('span', { class: 'sl-ctx', text: '컨텍스트 ?' }), sep(),
    s.profile && s.profile !== 'default' ? el('span', { class: 'sl-usage', text: `프로파일 ${s.profile}`, 'data-tip': '이 세션은 별도 설정 폴더(프로파일)에서 실행됩니다 · 계정 사용량은 기본 프로파일만' }) : el('span', { class: 'sl-usage', text: '5h · 7d …' }),
    s.permissionMode ? [sep(), el('span', { class: 'sl-mode' + (s.permissionMode === 'auto' ? ' auto' : ''), text: `${s.permissionMode} mode` })] : null,
    pr?.url ? [sep(), el('a', { class: 'sl-pr', href: pr.url, target: '_blank', 'data-tip': pr.url, text: `${/merge_requests/.test(pr.url) ? 'MR !' : 'PR #'}${pr.number}` })] : null,
    (s.job?.prs?.length || 0) > 1 ? el('span', { class: 'msg', text: ` (+${s.job.prs.length - 1})` }) : null,
  ].flat().filter((x) => x != null));
  api.gitInfo(s.workCwd || s.cwd).then((g) => { const b = line.querySelector('.sl-branch'); if (!b) return; if (g) { b.textContent = g.branch + (g.dirty ? '*' : ''); b.classList.toggle('dirty', g.dirty); } else if (b.textContent === '…') b.textContent = s.gitBranch && s.gitBranch !== 'HEAD' ? s.gitBranch : 'no git'; });
  if (!s.profile || s.profile === 'default') getUsage().then((u) => { const e = line.querySelector('.sl-usage'); if (!e) return; if (!u) { e.textContent = '사용량 캐시 없음'; return; }
    e.replaceChildren(
      el('span', { 'data-tip': `5시간 창 사용률 · ${fmtUntil(u.fiveHour.resetsAt) || '곧'} 뒤 초기화` }, '5h ', el('b', { class: u.fiveHour.pct >= 80 ? 'warn' : '', text: `${u.fiveHour.pct}%` }), ` (${fmtUntil(u.fiveHour.resetsAt)})`),
      ' | ',
      el('span', { 'data-tip': `7일 창 사용률 · ${fmtUntil(u.sevenDay.resetsAt) || '곧'} 뒤 초기화` }, '7d ', el('b', { class: u.sevenDay.pct >= 80 ? 'warn' : '', text: `${u.sevenDay.pct}%` }), ` (${fmtUntil(u.sevenDay.resetsAt)})`)); });
  const last = el('div', { class: 'statusline last-prompt' }, el('span', { class: 'sl-sep', text: '▸' }), ` ${s.historyLastTs ? new Date(s.historyLastTs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''} ${(s.lastPrompt || '').replace(/\s+/g, ' ').slice(0, 160)}`);
  return [line, s.lastPrompt ? last : null];
}

function buildHead(s) {
  const actions = [];
  if (s.kind === 'background' && s.live) {
    actions.push(el('button', { text: '중지', onclick: () => act('stop', s) }), el('button', { text: '재시작', onclick: () => act('respawn', s) }));
  } else if (s.kind === 'background') {
    actions.push(el('button', { text: '재시작', onclick: () => act('respawn', s) }), el('button', { class: 'danger', text: '삭제', onclick: () => confirm(`"${s.name}" 백그라운드 세션을 삭제할까요? (트랜스크립트는 남습니다)`) && act('rm', s) }));
  }
  if (s.job) actions.unshift(el('button', { text: s.pinned ? '★ 핀 해제' : '☆ 핀', onclick: () => api.setPinned(s.short, !s.pinned, s.profile).then(loadSessions) }));
  if (!s.local || s.chatNew) actions.unshift(el('button', { class: typeof BR !== 'undefined' && BR.get(s.sessionId)?.open ? 'toggled' : '', text: '브라우저', 'data-tip': '오른쪽에 브라우저 패널 (요소 선택 → Claude에 전달)', onclick: () => { toggleBrowser(s); renderDetail(); } }));
  return el('div', { class: 'detail-head', id: 'detail-head' },
    el('h2', {}, s.name, profileBadge(s)),
    el('span', { class: 'path', text: `${shortPath(s.cwd)}  ·  ${s.sessionId}` }),
    el('span', { class: 'badge' + (s.live ? ' live' : ''), text: (typeof CH !== 'undefined' && CH.has(s.sessionId)) ? `live · 챗 (SDK) · ${s.status || ''}` : s.live ? `live · ${s.kind} · ${s.status || ''} ${s.state || ''}` : (s.kind || 'transcript') }),
    s.version ? el('span', { class: 'badge' + (S.cliVersion && s.version !== S.cliVersion ? ' warn' : ''), text: `v${s.version}`, 'data-tip': S.cliVersion && s.version !== S.cliVersion ? `설치된 Claude Code는 v${S.cliVersion} · 세션 ▾ 에서 재시작` : '이 세션이 실행 중인 Claude Code 버전' }) : null,
    s.size ? el('span', { class: 'badge', text: fmtBytes(s.size) }) : null,
    s.prompts ? el('span', { class: 'badge', text: `${s.prompts} prompts` }) : null,
    el('span', { class: 'actions' }, ...actions),
    ...(s.local ? [] : statusLine(s)));
}
function renderDetail() {
  const s = cur();
  const sec = $('#session-detail');
  if (!s) { sec.replaceChildren(el('div', { class: 'empty', text: '「세션 ▾」에서 세션을 고르면 탭으로 열립니다' })); if (typeof syncBrowserPane === 'function') syncBrowserPane(null); return; }
  const head = buildHead(s);
  if (S.tab === 'shell') S.tab = 'terminal'; // the shell is a bottom panel now, not a sub-tab
  const tabs = el('div', { class: 'tabs' }, el('div', { class: 'seg' }, ...[['terminal', '터미널'], ['transcript', '대화'], ['stats', '통계'], ['memory', '메모리']].map(([k, label]) =>
    el('button', { class: k === S.tab ? 'active' : '', text: label, onclick: () => { S.tab = k; renderDetail(); } }))),
    shellToggleBtn());
  const pane = el('div', { class: 'pane' + (S.tab === 'terminal' ? ' term' : '') });
  sec.replaceChildren(el('div', { class: 'head-wrap' }, el('div', { class: 'head-strip' }, el('i')), head), tabs, pane); // head is an overlay: hidden until the strip is hovered, so the pane never reflows
  renderShellPanel();
  if (typeof syncBrowserPane === 'function') syncBrowserPane(s);
  if (S.tab === 'terminal') showTerminal(s, pane);
  else if (S.tab === 'transcript') showTranscript(s, pane);
  else if (S.tab === 'stats') showStats(s, pane);
  else showSessionMemory(s, pane);
}
async function act(action, s) {
  const r = await api.agentAction(action, s.short, s.profile);
  if (!r.ok) alert(r.output || `${action} 실패`);
  await loadSessions();
}

// ---------- embedded terminal ----------
function attachArgs(s) {
  if (s.local) return s.args;
  if (typeof CH !== 'undefined' && CH.has(s.sessionId)) return null; // an SDK chat owns this session; no TUI exists
  if (s.live && s.kind === 'background') return ['attach', s.short];
  if (s.live) return null;
  return ['--resume', s.sessionId];
}
// xterm setup shared by the Claude terminal and the plain shell: font/theme, fit addon, key handling, auto-fit on resize
function newXterm() {
  const term = new Terminal({ cursorBlink: true, scrollback: 5000, ...xtermOptions() }); // theme + font from termlook.js (user-chosen, persisted)
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  const box = el('div', { class: 'term-box' });
  term.open(box);
  term.attachCustomKeyEventHandler((e) => {
    if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[0-9]$/.test(e.code)) return false; // ⌥digit = tab switch, not terminal input
    if (!isMac && e.type === 'keydown' && e.ctrlKey && !e.altKey && !e.metaKey) { // Windows Terminal style clipboard
      const k = e.key.toLowerCase();
      if (k === 'c' && (e.shiftKey || term.hasSelection())) { e.preventDefault(); if (term.hasSelection()) navigator.clipboard.writeText(term.getSelection()).catch(() => {}); return false; } // plain Ctrl+C without selection = ^C
      if (k === 'v' && e.shiftKey) { e.preventDefault(); navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {}); return false; }
      if (k === 'v') return false; // not preventDefault: the browser paste event reaches xterm
    }
    return true;
  });
  new ResizeObserver(() => box.isConnected && box.clientHeight && fit.fit()).observe(box);
  return { term, fit, box };
}
function createTerm(s) {
  const { term, fit, box } = newXterm();
  const status = el('span', { text: '연결 안 됨' });
  const btn = el('button', { onclick: () => { t.detached = !!t.ptyId; return t.ptyId ? api.ptyKill(t.ptyId) : attach(s); } }); // detached = the user let go: no auto re-attach
  const t = { term, fit, box, btn, status, ptyId: null, bar: el('div', { class: 'term-bar' }, btn, status, lookButton()) };
  // one button toggles: detach only ends the `claude attach` client, the background session keeps running
  t.setLabel = () => { const live = (S.sessions.find((x) => x.sessionId === s.sessionId) || s).live; btn.textContent = t.ptyId ? (live ? '떼기 (detach)' : '닫기') : (live ? '붙기 (attach)' : '이어가기 (resume)'); }; // fresh state: s is the object from when the tab was built
  t.setLabel();
  // Claude Code draws attached background sessions with its fullscreen renderer (alt screen, own scrolling; not switchable):
  // after a wheel-up, auto-follow pauses and typing no longer brings the prompt back into view. So the first keystroke after
  // a wheel-up is preceded by its scroll:bottom key (Ctrl+End), which jumps to the latest message and re-enables auto-follow.
  // Mouse (SGR `\e[<`, X10 `\e[M`) and focus (`\e[I`/`\e[O`) reports are not keystrokes.
  // However the view got there (wheel, PageUp, drag-selecting past the edge, clicking the "earlier prompt" row), the TUI
  // shows a "Jump to bottom" / "N new messages" button while scrolled up: look for it on screen at each keystroke.
  const SCROLLED_UP_HINT = /Jump to bottom|\d+ new messages?/;
  const tuiScrolledUp = () => { const b = term.buffer.active; for (let i = b.viewportY, end = Math.min(b.length, b.viewportY + term.rows); i < end; i++) if (SCROLLED_UP_HINT.test(b.getLine(i)?.translateToString(true) || '')) return true; return false; };
  term.onData((d) => {
    if (!t.ptyId) return;
    if (/^\x1b\[[<MIO]/.test(d)) { if (/^\x1b\[<64;/.test(d)) t.wheeledUp = true; } // SGR button 64 = wheel up
    else {
      const b = term.buffer.active;
      if (b.type === 'alternate') { if (t.wheeledUp || tuiScrolledUp()) api.ptyWrite(t.ptyId, '\x1b[1;5F'); }
      else if (b.viewportY < b.baseY) term.scrollToBottom(); // classic renderer: xterm's own scrollback
      t.wheeledUp = false;
    }
    api.ptyWrite(t.ptyId, d);
  });
  term.onResize(({ cols, rows }) => t.ptyId && api.ptyResize(t.ptyId, cols, rows));
  return t;
}
// Sessions with no TUI to attach to (an SDK chat in this app, or an interactive session in another terminal)
// get a read-only live log in the terminal instead: recent turns, then the transcript tail as it grows.
const ansiWrap = (s) => String(s || '').replace(/\r?\n/g, '\r\n');
function turnToAnsi(t, cols = 80) {
  // user/assistant: Markdown -> ANSI with the TUI's 2-col hanging indent; one-line tool/meta rows are cut to width with …
  if (t.role === 'user') return `\r\n${mdToAnsi(t.text, { cols, first: '\x1b[1;33m❯\x1b[0m ' })}${t.images ? ` \x1b[90m[이미지 ${t.images}장]\x1b[0m` : ''}\r\n`;
  if (t.role === 'assistant') return `\r\n${mdToAnsi(t.text, { cols, first: '\x1b[1;32m●\x1b[0m ' })}\r\n`;
  const one = (s, pre) => truncW(pre + String(s ?? '').replace(/\s+/g, ' '), cols - 1);
  if (t.role === 'tool') return `\x1b[90m${one(t.text, `  ⚙ ${t.name}: `)}\x1b[0m\r\n`;
  if (t.role === 'result') return `\x1b[90m  ↳ ${t.isError ? '\x1b[31m오류 \x1b[90m' : ''}결과 ${(t.text || '').length}자\x1b[0m\r\n`;
  if (t.role === 'meta') return t.kind === 'duration' ? `\x1b[32m✱\x1b[0m \x1b[90m완료 · ${((t.ms || 0) / 1000).toFixed(1)}s\x1b[0m\r\n` : `\x1b[90m${one(t.text, '※ recap: ')}\x1b[0m\r\n`;
  return '';
}
async function startLogMode(s, t) {
  t.logMode = true; t.btn.style.display = 'none';
  t.status.textContent = (typeof CH !== 'undefined' && CH.has(s.sessionId)) ? '실시간 로그 · 이 앱의 챗 세션입니다 (입력은 대화 탭에서, 터미널이 필요하면 "터미널로 넘기기")' : '실시간 로그 · 다른 터미널에서 열린 세션 — 그 터미널에서 /background (또는 ←) 하면 여기로 넘어와 TUI로 이어집니다';
  t.term.reset();
  const r = await api.transcript(s.sessionId, { limit: 40 }).catch(() => null);
  if (r) { if (r.from > 0) t.term.write(`\x1b[90m… 이전 ${fmtN(r.from)}턴은 대화 탭에서\x1b[0m\r\n`); for (const x of r.turns) t.term.write(turnToAnsi(x, t.term.cols)); }
  api.watchTranscript(s.sessionId);
}
function showTerminal(s, pane) {
  let t = S.terms.get(s.sessionId);
  if (!t) { t = createTerm(s); S.terms.set(s.sessionId, t); }
  pane.append(t.bar, t.box);
  requestAnimationFrame(() => {
    t.fit.fit(); t.term.focus();
    if (t.ptyId) return;
    if (!attachArgs(s) && (s.live || (typeof CH !== 'undefined' && CH.has(s.sessionId)))) { if (!t.logMode) startLogMode(s, t); else api.watchTranscript(s.sessionId); }
    else if (s.local || s.live) attach(s);
  });
}
async function attach(s) {
  const t = S.terms.get(s.sessionId);
  if (!t || t.ptyId) return;
  const args = attachArgs(s);
  if (!args) { if (!t.logMode) startLogMode(s, t); return; }
  if (t.logMode) { t.logMode = false; t.btn.style.display = ''; t.term.reset(); }
  t.fit.fit();
  t.btn.disabled = true; // until the pty is up, so a double click cannot spawn two clients
  t.ptyId = await api.ptyOpen({ args, cwd: s.cwd, cols: t.term.cols, rows: t.term.rows, profile: s.profile });
  t.btn.disabled = false;
  t.setLabel();
  t.status.textContent = 'claude ' + args.join(' ');
  t.term.focus();
}
// ---------- plain shell in the session's working folder (its own pty; nothing goes into the conversation) ----------
// A session checked out under <project>/.claude/worktrees/<name> still gets its shell at <project> (user preference);
// the bar offers a one-click cd into the worktree and back.
const WORKTREE_RE = /^(.*)\/\.claude\/worktrees\/[^/]+(?:\/|$)/;
const sessionDir = (s) => s.workCwd || s.cwd;
const shellCwd = (s) => { const m = WORKTREE_RE.exec(sessionDir(s) || ''); return m ? m[1] : sessionDir(s); };
const shq = (p) => `'${String(p).replace(/'/g, `'\\''`)}'`;
function createShell(s) {
  const { term, fit, box } = newXterm();
  const status = el('span');
  const btn = el('button', { onclick: () => (h.ptyId ? api.ptyKill(h.ptyId) : openShell(s)) });
  const hide = el('button', { text: '숨기기', 'data-tip': '패널 숨기기 (⌃`) · 셸은 계속 실행', onclick: toggleShell });
  const wt = WORKTREE_RE.test(sessionDir(s) || '') ? sessionDir(s) : null;
  const cdBtn = wt && el('button', { 'data-tip': `세션은 워크트리에서 작업 중: ${shortPath(wt)}`, onclick: () => { if (!h.ptyId) return; h.atWorktree = !h.atWorktree; api.ptyWrite(h.ptyId, `cd ${shq(h.atWorktree ? wt : shellCwd(s))}\r`); cdBtn.textContent = h.atWorktree ? '루트로 cd' : '워크트리로 cd'; h.term.focus(); } });
  if (cdBtn) cdBtn.textContent = '워크트리로 cd';
  const h = { term, fit, box, btn, status, ptyId: null, exited: false, atWorktree: false, bar: el('div', { class: 'term-bar' }, el('b', { class: 'shell-title', text: '셸' }), btn, cdBtn, status, lookButton(), hide) };
  h.setLabel = () => { btn.textContent = h.ptyId ? '닫기' : '다시 열기'; };
  h.setLabel();
  term.onData((d) => h.ptyId && api.ptyWrite(h.ptyId, d));
  term.onResize(({ cols, rows }) => h.ptyId && api.ptyResize(h.ptyId, cols, rows));
  return h;
}
async function openShell(s) {
  const h = S.shells.get(s.sessionId);
  if (!h || h.ptyId) return;
  if (h.exited) { h.exited = false; h.term.reset(); h.atWorktree = false; const b = h.bar.querySelector('button:nth-child(3)'); if (b && /cd$/.test(b.textContent)) b.textContent = '워크트리로 cd'; }
  h.fit.fit();
  h.btn.disabled = true;
  h.ptyId = await api.ptyOpen({ shell: true, cwd: shellCwd(s), cols: h.term.cols, rows: h.term.rows, profile: s.profile });
  h.btn.disabled = false;
  h.setLabel();
  h.status.textContent = `셸 · ${shortPath(shellCwd(s))} · 이 세션의 대화에는 기록되지 않습니다`;
  h.term.focus();
}
// Bottom panel (VS Code style): one shell per session tab, shown under whatever sub-tab is open; hiding keeps the pty.
const svgIcon = (d) => { const w = document.createElement('span'); w.innerHTML = `<svg viewBox="0 0 24 24">${d}</svg>`; return w.firstChild; };
const shellToggleBtn = () => el('button', { class: 'shell-toggle' + (S.shellOpen ? ' active' : ''), 'data-tip': `하단 셸 패널 ${S.shellOpen ? '숨기기' : '열기'} (⌃\`) · 세션 폴더의 zsh, 대화에는 기록되지 않음`, onclick: toggleShell },
  svgIcon('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10l3 2-3 2M12.5 15H17"/>'), `셸 ${S.shellOpen ? '▾' : '▴'}`);
const loadShellH = () => { try { return Math.max(120, Number(localStorage.getItem('shellH')) || 260); } catch { return 260; } };
function toggleShell() {
  S.shellOpen = !S.shellOpen;
  try { localStorage.setItem('shellOpen', S.shellOpen ? '1' : ''); } catch { /* fine */ }
  $('#session-detail .shell-toggle')?.replaceWith(shellToggleBtn());
  renderShellPanel();
  if (!S.shellOpen) S.terms.get(S.sel)?.term.focus();
}
function renderShellPanel() {
  const sec = $('#session-detail'), s = cur(), old = sec.querySelector('.shell-panel');
  if (!S.shellOpen || !s || S.view !== 'sessions') { old?.remove(); return; }
  let h = S.shells.get(s.sessionId);
  if (!h) { h = createShell(s); S.shells.set(s.sessionId, h); }
  if (old?.dataset.id === s.sessionId) return;
  old?.remove();
  const panel = el('div', { class: 'shell-panel', 'data-id': s.sessionId, style: `height:${loadShellH()}px` });
  const grip = el('div', { class: 'shell-grip', 'data-tip': '끌어서 높이 조절' });
  grip.onmousedown = (e) => { // drag the top edge; the xterm refits through its ResizeObserver
    e.preventDefault();
    const startY = e.clientY, startH = panel.offsetHeight, max = sec.clientHeight - 160;
    document.body.classList.add('resizing');
    const move = (ev) => { panel.style.height = `${Math.min(max, Math.max(120, startH + (startY - ev.clientY)))}px`; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); try { localStorage.setItem('shellH', String(panel.offsetHeight)); } catch { /* fine */ } };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
  panel.append(grip, h.bar, h.box);
  sec.append(panel);
  requestAnimationFrame(() => { h.fit.fit(); h.term.focus(); if (!h.ptyId && !h.exited) openShell(s); }); // an exited shell stays as it was until "다시 열기"
}
function fitCurrent() { for (const t of [S.terms.get(S.sel), S.shells.get(S.sel)]) if (t?.box.isConnected) requestAnimationFrame(() => t.fit.fit()); }
api.onPtyData(({ id, data }) => { for (const t of [...S.terms.values(), ...S.shells.values()]) if (t.ptyId === id) t.term.write(data); });
api.onPtyExit(({ id, code }) => {
  for (const t of S.terms.values()) if (t.ptyId === id) {
    t.ptyId = null; t.btn.disabled = false; t.setLabel(); t.status.textContent = `떼어냄 (code ${code})`;
    t.term.write(`\r\n\x1b[90m[떼어냄 · 세션은 계속 실행 중 · 다시 붙으려면 위 버튼]\x1b[0m\r\n`);
  }
  for (const h of S.shells.values()) if (h.ptyId === id) {
    h.ptyId = null; h.exited = true; h.btn.disabled = false; h.setLabel(); h.status.textContent = `셸 종료 (code ${code})`;
    h.term.write(`\r\n\x1b[90m[셸 종료 · 다시 열려면 위 버튼]\x1b[0m\r\n`);
  }
});
window.addEventListener('resize', fitCurrent);

// ---------- stats ----------
async function showStats(s, pane) {
  pane.textContent = '집계 중…';
  const st = await api.sessionStats(s.sessionId);
  if (!st) { pane.textContent = '트랜스크립트 파일이 없습니다'; return; }
  const tk = st.tokens;
  const tile = (k, v) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }));
  const table = (title, obj, limit = 15) => {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (!rows.length) return null;
    return el('div', {}, el('h4', { text: title }), el('table', {}, ...rows.map(([k, v]) => el('tr', {}, el('td', { text: k }), el('td', { class: 'num', text: fmtN(v) })))));
  };
  pane.replaceChildren(
    el('div', { class: 'stats' },
      tile('사용자 메시지', fmtN(st.userMessages)), tile('어시스턴트 메시지', fmtN(st.assistantMessages)),
      tile('서브에이전트 메시지', fmtN(st.sidechainMessages)), tile('도구 호출', fmtN(st.toolCalls)),
      tile('총 토큰', fmtTok(st.totalTokens)), tile('출력 토큰', fmtTok(tk.output)), tile('thinking 토큰', fmtTok(tk.thinking)),
      tile('입력(비캐시)', fmtTok(tk.input)), tile('캐시 읽기', fmtTok(tk.cacheRead)), tile('캐시 생성', fmtTok(tk.cacheCreate)),
      tile('기간', fmtDur(st.durationMs)), tile('파일', fmtBytes(st.size))),
    el('p', { class: 'msg', text: `${fmtLocalDT(st.firstTs)} → ${fmtLocalDT(st.lastTs)}  ·  branch ${st.gitBranch || '-'}  ·  ${shortPath(st.cwd || '')}` }),
    table('모델별 응답 수', st.models), table('effort', st.efforts), table('도구별 호출 수', st.tools), table('Claude Code 버전', st.versions, 6));
}

// ---------- memory ----------
const pkey = (p) => `${p.profile || 'default'}|${p.dir}`, unpkey = (k) => { const i = k.indexOf('|'); return { profile: k.slice(0, i), dir: k.slice(i + 1) }; }; // a project = (profile, encoded dir)
async function ensureMemory() {
  if (S.memory) return;
  [S.memory, S.projects] = await Promise.all([api.listMemory(), api.listProjects()]);
  const sel = $('#mem-project');
  sel.replaceChildren(el('option', { value: '', text: '모든 프로젝트' }),
    ...S.projects.filter((p) => p.memoryCount).map((p) => el('option', { value: pkey(p), text: `${shortPath(p.cwd)} (${p.memoryCount})${p.profile !== 'default' ? ` · ${p.profile}` : ''}` })));
  sel.value = S.memProject;
}
async function loadMemory() { S.memory = null; await ensureMemory(); renderMemoryList(); if (S.memSel) selectMemory(S.memory.find((m) => m.file === S.memSel.file) || null); }
function memRow(m, onclick) {
  return el('div', { class: 'mem' + (m.file === S.memSel?.file ? ' sel' : ''), onclick },
    el('div', { class: 'name', text: m.name }), el('div', { class: 'desc', text: m.description || m.base }),
    el('div', { class: 'proj', text: `${shortPath(m.project)} · ${m.type || '-'} · ${fmtAgo(m.mtime)}${m.copiedFrom ? ' · 복사본' : ''}` }));
}
function renderMemoryList() {
  const q = S.memFilter.toLowerCase();
  const rows = S.memory.filter((m) => (!S.memProject || pkey({ profile: m.profile, dir: m.projectDir }) === S.memProject) &&
    (!q || `${m.name} ${m.description} ${m.project} ${m.base}`.toLowerCase().includes(q)));
  $('#memory-list').replaceChildren(...rows.map((m) => memRow(m, () => selectMemory(m))));
}
$('#mem-search').oninput = (e) => { S.memFilter = e.target.value; renderMemoryList(); };
$('#mem-project').onchange = (e) => { S.memProject = e.target.value; renderMemoryList(); };

async function selectMemory(m) {
  S.memSel = m;
  renderMemoryList();
  const sec = $('#memory-detail');
  if (!m) { sec.replaceChildren(el('div', { class: 'empty', text: '메모리를 선택하세요' })); return; }
  const body = await api.readMemory(m.file);
  const origin = m.originSessionId && S.sessions.find((s) => s.sessionId === m.originSessionId);
  sec.replaceChildren(
    el('div', { class: 'detail-head' },
      el('h2', { text: m.name }),
      el('span', { class: 'path', text: shortPath(m.file) }),
      el('span', { class: 'badge', text: m.type || 'memory' }),
      m.originSessionId ? el('button', { text: `원본 세션: ${origin ? origin.name : m.originSessionId.slice(0, 8)}`, onclick: () => origin && openSession(origin.sessionId) }) : null,
      m.copiedFrom ? el('span', { class: 'badge', text: `복사 원본: ${m.copiedFrom}` }) : null,
      el('span', { class: 'actions' },
        el('button', { text: '편집', onclick: () => editMemory(m, body) }),
        el('button', { class: 'danger', text: '삭제', onclick: async () => {
          if (!confirm(`"${m.name}" 메모리를 삭제할까요?\n${shortPath(m.file)}\nMEMORY.md 인덱스 줄도 함께 지웁니다.`)) return;
          await api.deleteMemory(m.file).catch((e) => alert(e.message));
          S.memSel = null; S.memory = null; loadMemory();
        } }))),
    el('div', { class: 'pane' }, copyBar(m), el('pre', { class: 'md', text: body })));
}
function editMemory(m, body) {
  const sec = $('#memory-detail');
  const ta = el('textarea', { class: 'md-edit', spellcheck: 'false' });
  ta.value = body;
  const msg = el('span', { class: 'msg' });
  const save = async () => {
    msg.className = 'msg'; msg.textContent = '저장 중…';
    try {
      await api.writeMemory(m.file, ta.value);
      S.memory = null; await ensureMemory();
      selectMemory(S.memory.find((x) => x.file === m.file) || null);
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; }
  };
  ta.onkeydown = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } };
  sec.replaceChildren(
    el('div', { class: 'detail-head' }, el('h2', { text: `편집: ${m.name}` }), el('span', { class: 'path', text: shortPath(m.file) }),
      el('span', { class: 'actions' }, msg, el('button', { text: '취소', onclick: () => selectMemory(m) }), el('button', { class: 'primary', text: `저장 (${kbd('⌘S')})`, onclick: save }))),
    el('div', { class: 'pane edit-pane' }, el('p', { class: 'hint', text: 'frontmatter(name · description)을 바꾸면 MEMORY.md 인덱스 줄도 같이 갱신됩니다.' }), ta));
  ta.focus();
}
function copyBar(m) {
  const sel = el('select', {}, ...S.projects.filter((p) => !(p.dir === m.projectDir && p.profile === m.profile)).map((p) => el('option', { value: pkey(p), text: `${shortPath(p.cwd)}${p.profile !== 'default' ? ` · ${p.profile}` : ''}` })));
  const c = cur(), current = c?.projectDir && pkey({ profile: c.profile, dir: c.projectDir }); // default target: the project of the session tab you are working in
  if (current && S.projects.some((p) => pkey(p) === current && !(p.dir === m.projectDir && p.profile === m.profile))) sel.value = current;
  const msg = el('span', { class: 'msg' });
  const go = async () => {
    msg.className = 'msg'; msg.textContent = '복사 중…';
    const dest = unpkey(sel.value);
    let r = await api.copyMemory({ src: m.file, destProjectDir: dest.dir, destProfile: dest.profile }).catch((e) => ({ error: e.message }));
    if (r.exists && confirm('대상 프로젝트에 같은 이름의 메모리가 있습니다. 덮어쓸까요?')) r = await api.copyMemory({ src: m.file, destProjectDir: dest.dir, destProfile: dest.profile, overwrite: true }).catch((e) => ({ error: e.message }));
    if (r.error) { msg.className = 'msg err'; msg.textContent = r.error; }
    else if (r.exists) { msg.textContent = '취소됨'; }
    else { msg.className = 'msg ok'; msg.textContent = `복사됨 → ${shortPath(r.dest)}  (MEMORY.md 인덱스 갱신)`; S.memory = null; }
  };
  return el('div', { class: 'copybar' }, el('span', { class: 'msg', text: '이 메모리를 다른 프로젝트로 복사:' }), sel, el('button', { text: '복사', onclick: go }), msg);
}
async function showSessionMemory(s, pane) {
  pane.textContent = '불러오는 중…';
  await ensureMemory();
  const mine = S.memory.filter((m) => m.originSessionId === s.sessionId);
  const proj = S.memory.filter((m) => m.projectDir === s.projectDir && m.originSessionId !== s.sessionId);
  const open = (m) => () => { setView('memory'); selectMemory(m); };
  pane.replaceChildren(
    el('h4', { text: `이 세션이 만든 메모리 (${mine.length})` }),
    mine.length ? el('div', {}, ...mine.map((m) => memRow(m, open(m)))) : el('p', { class: 'msg', text: '없음' }),
    el('h4', { text: `같은 프로젝트의 다른 메모리 (${proj.length})` }),
    proj.length ? el('div', {}, ...proj.map((m) => memRow(m, open(m)))) : el('p', { class: 'msg', text: '없음' }));
}

// ---------- new memory ----------
const dlgMem = $('#dlg-memory');
$('#btn-new-memory').onclick = async () => {
  await ensureMemory();
  const sel = $('#nm-project');
  sel.replaceChildren(...S.projects.map((p) => el('option', { value: pkey(p), text: `${shortPath(p.cwd)}${p.profile !== 'default' ? ` · ${p.profile}` : ''}` })));
  const c = cur();
  sel.value = S.memProject || (c?.projectDir ? pkey({ profile: c.profile, dir: c.projectDir }) : '') || (S.projects[0] ? pkey(S.projects[0]) : ''); // the filtered project, else the session you're in
  $('#nm-name').value = ''; $('#nm-desc').value = '';
  dlgMem.showModal();
};
dlgMem.onclose = async () => {
  if (dlgMem.returnValue !== 'ok') return;
  const dest = unpkey($('#nm-project').value);
  const req = { projectDir: dest.dir, profile: dest.profile, name: $('#nm-name').value, type: $('#nm-type').value, description: $('#nm-desc').value };
  try {
    const r = await api.createMemory(req);
    S.memory = null; await ensureMemory();
    const m = S.memory.find((x) => x.file === r.file);
    if (m) { renderMemoryList(); S.memSel = m; editMemory(m, r.text); }
  } catch (e) { alert(e.message); }
};

// ---------- new session ----------
const dlg = $('#dlg-new');
const OPTS = { profile: '#new-profile', model: '#new-model', effort: '#new-effort', permissionMode: '#new-permission', agent: '#new-agent', mode: '#new-mode' };
function readOpts() { const o = {}; for (const [k, sel] of Object.entries(OPTS)) o[k] = $(sel).value.trim(); return o; }
$('#btn-new').onclick = () => {
  $('#new-cwd').value = isAbs(cur()?.cwd) ? cur().cwd : '';
  const ps = $('#new-profile');
  ps.replaceChildren(...S.profiles.map((p) => el('option', { value: p.id === 'default' ? '' : p.id, text: p.id === 'default' ? 'Claude (기본 · ~/.claude)' : `${p.name}${p.model ? ` · ${p.model}` : ''} (${shortPath(p.dir)})` })));
  ps.closest('label').hidden = S.profiles.length < 2; // one profile: nothing to choose
  try { const last = JSON.parse(localStorage.getItem('newSessionOpts') || '{}'); for (const [k, sel] of Object.entries(OPTS)) $(sel).value = last[k] || ''; } catch { /* no saved options */ }
  if (cur()?.profile && cur().profile !== 'default') ps.value = cur().profile; // follow the session you are looking at
  dlg.showModal();
};
$('#new-pick').onclick = async () => { const d = await api.pickDir(); if (d) $('#new-cwd').value = d; };
dlg.onclose = async () => {
  if (dlg.returnValue !== 'ok') return;
  const cwd = $('#new-cwd').value, name = $('#new-name').value.trim(), prompt = $('#new-prompt').value.trim();
  if (!cwd) return alert('작업 폴더를 선택하세요');
  const { mode, ...opts } = readOpts();
  try { localStorage.setItem('newSessionOpts', JSON.stringify({ ...opts, mode })); } catch { /* fine */ }
  if (mode === 'chat') { newChatTab({ cwd, name, prompt, opts }); return; }
  const r = await api.newSession({ cwd, name, prompt, ...opts }).catch((e) => ({ ok: false, output: e.message }));
  if (r.ok) {
    await loadSessions();
    const s = S.sessions.find((x) => x.short === r.id);
    if (s) { S.tab = 'terminal'; openSession(s.sessionId); }
    return;
  }
  if (!r.untrusted) return alert(r.output || '세션 생성 실패');
  // Untrusted folder: open claude interactively in our terminal so the trust prompt can be answered.
  const flags = Object.entries({ name, ...opts }).flatMap(([k, v]) => { const f = { name: '--name', model: '--model', effort: '--effort', permissionMode: '--permission-mode', agent: '--agent' }[k]; return v && f ? [f, v] : []; });
  const local = { sessionId: 'local-' + Date.now(), local: true, name: name || baseName(cwd), cwd, profile: opts.profile || 'default', args: [...flags, ...(prompt ? [prompt] : [])] };
  S.local.push(local);
  S.tab = 'terminal';
  openSession(local.sessionId);
};

// ---------- right-click menu on a session row or tab ----------
const ctx = $('#ctx');
function hideCtx() { ctx.classList.add('hidden'); if (!menu.matches(':hover')) menu.classList.remove('closed', 'open'); }
function showCtx(e, s) {
  e.preventDefault(); e.stopPropagation(); hideTip();
  if (menu.contains(e.target)) { menu.classList.remove('closed'); menu.classList.add('open'); } // hover alone would drop the list once the pointer moves onto the menu
  const t = S.terms.get(s.sessionId);
  const bg = s.kind === 'background';
  const item = (text, fn, cls = '') => el('div', { class: 'item ' + cls, text, onclick: () => { hideCtx(); fn(); } });
  const items = [
    el('div', { class: 'head', text: s.name }),
    S.tabs.includes(s.sessionId) && s.sessionId === S.sel ? null : item('열기 (탭)', () => openSession(s.sessionId)),
    t?.ptyId ? item(s.live ? '떼기 (detach)' : '터미널 닫기', () => api.ptyKill(t.ptyId))
      : (!s.live || bg) ? item(s.live ? '붙기 (attach)' : '이어가기 (resume)', () => { openSession(s.sessionId); S.tab = 'terminal'; renderDetail(); attach(s); }) : null,
    el('div', { class: 'sep' }),
    s.local ? null : item('이름 변경…', () => renameFlow(s)),
    s.job ? item(s.pinned ? '핀 해제' : '핀 고정 (맨 위로)', () => api.setPinned(s.short, !s.pinned, s.profile).then(loadSessions)) : null,
    bg && s.live ? item('중지', () => act('stop', s)) : null,
    bg ? item('재시작 (respawn)', () => act('respawn', s)) : null,
    el('div', { class: 'sep' }),
    S.tabs.includes(s.sessionId) ? item('탭 닫기', () => closeTab(s.sessionId)) : null,
    s.local || (s.live && !bg) ? null : item('삭제…', () => deleteFlow(s), 'danger'),
  ];
  ctx.replaceChildren(...items.filter(Boolean));
  ctx.classList.remove('hidden');
  const w = ctx.offsetWidth, h = ctx.offsetHeight;
  ctx.style.left = Math.min(e.clientX, innerWidth - w - 8) + 'px';
  ctx.style.top = Math.min(e.clientY, innerHeight - h - 8) + 'px';
}
document.addEventListener('mousedown', (e) => { if (!ctx.contains(e.target)) hideCtx(); }, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCtx(); }, true);
window.addEventListener('blur', () => ctx.classList.add('hidden')); // app lost focus: drop the menu, leave the list as is

const dlgRename = $('#dlg-rename');
function renameFlow(s) {
  $('#rename-name').value = s.name;
  $('#rename-hint').textContent = s.live
    ? '실행 중인 세션: 붙어 있는 터미널에 /rename 을 보내고, 기록 파일(job · custom-title)도 함께 갱신합니다.'
    : '기록 파일(job 이름 · respawn 플래그 · custom-title.json)을 갱신합니다.';
  dlgRename.onclose = async () => {
    const name = $('#rename-name').value.trim();
    if (dlgRename.returnValue !== 'ok' || !name || name === s.name) return;
    await api.renameSession({ sessionId: s.sessionId, projectDir: s.projectDir, profile: s.profile, name }).catch((e) => alert(e.message));
    if (s.live) {
      const t = S.terms.get(s.sessionId);
      if (t?.ptyId) api.ptyWrite(t.ptyId, `/rename ${name}\r`);
      else if (s.kind === 'background') { // ponytail: attach, give the TUI a moment to come up, then send the slash command
        openSession(s.sessionId); S.tab = 'terminal'; renderDetail(); await attach(s);
        const tt = S.terms.get(s.sessionId);
        setTimeout(() => tt?.ptyId && api.ptyWrite(tt.ptyId, `/rename ${name}\r`), 2500);
      }
    }
    setTimeout(loadSessions, 800);
  };
  dlgRename.showModal();
  $('#rename-name').select();
}
async function deleteFlow(s) {
  if (s.kind === 'background') {
    if (!confirm(`"${s.name}" 백그라운드 세션을 삭제할까요?${s.live ? ' (실행 중이라 먼저 중지합니다)' : ''}\n트랜스크립트는 남습니다.`)) return;
    if (s.live) await api.agentAction('stop', s.short, s.profile);
    const r = await api.agentAction('rm', s.short, s.profile);
    if (!r.ok) alert(r.output || 'rm 실패');
  } else {
    if (!confirm(`"${s.name}" 의 트랜스크립트(${fmtBytes(s.size)})를 영구 삭제할까요?\n이 세션은 더 이상 이어갈 수 없습니다.`)) return;
    await api.deleteTranscript({ sessionId: s.sessionId, projectDir: s.projectDir, profile: s.profile }).catch((e) => alert(e.message));
  }
  closeTab(s.sessionId);
  loadSessions();
}

// ---------- tooltip: one element drawn by us instead of the native (light) title bubble ----------
const tip = el('div', { id: 'tip' });
document.body.append(tip);
let tipTimer, tipFor = null;
function hideTip() { clearTimeout(tipTimer); tip.style.display = 'none'; tipFor = null; }
function showTip(target, x) {
  tip.textContent = target.dataset.tip;
  tip.style.display = 'block';
  const r = target.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(x - 16, innerWidth - w - 8)) + 'px';
  tip.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  tipFor = target;
}
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t === tipFor) return;
  hideTip();
  if (t && t.dataset.tip) tipTimer = setTimeout(() => showTip(t, e.clientX), 350);
});
document.addEventListener('mouseout', (e) => {
  const t = e.target.closest('[data-tip]');
  if (t && !t.contains(e.relatedTarget)) hideTip();
});
for (const ev of ['scroll', 'mousedown', 'keydown']) document.addEventListener(ev, hideTip, true);

// ---------- account chip (header, right) ----------
const pmenu = $('#profile-menu'), ppop = $('#profile-pop');
const avatarColor = (s = '') => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 45% 48%)`; };
const planLabel = (a) => ({ team: 'Claude Team', max: 'Claude Max', pro: 'Claude Pro', enterprise: 'Claude Enterprise' }[a.plan] || a.plan || (a.seatTier ? a.seatTier.replace(/_tier_\d+$/, '') : '') || '');
async function renderProfile() {
  const a = await api.account().catch(() => null);
  S.account = a;
  const btn = $('#btn-profile');
  if (!a || !a.loggedIn) { btn.classList.add('off'); btn.querySelector('.avatar').textContent = '!'; btn.querySelector('.profile-text').textContent = '로그인 필요'; return; }
  btn.classList.remove('off');
  const av = btn.querySelector('.avatar'); av.textContent = (a.name || a.email || '?').trim()[0].toUpperCase(); av.style.background = avatarColor(a.email || a.name || '');
  btn.querySelector('.profile-text').textContent = [a.name, a.org].filter(Boolean).join(' · ');
}
async function renderProfilePop() {
  const a = S.account, u = await getUsage();
  const bar = (pct) => el('div', { class: 'bar' }, el('i', { class: pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '', style: `width:${Math.min(100, pct || 0)}%` }));
  if (!a || !a.loggedIn) { ppop.replaceChildren(el('h4', { text: '로그인되어 있지 않습니다' }), el('p', { class: 'msg', text: '터미널에서 claude 를 실행해 로그인하면 여기에 계정이 표시됩니다.' })); return; }
  ppop.replaceChildren(
    el('h4', { text: a.name || a.email }),
    el('div', { class: 'msg', text: a.email || '' }),
    el('div', { class: 'row2' },
      el('span', { text: '조직' }), el('span', { text: `${a.org || '-'}${a.role ? ` · ${a.role.replace('membership_', '')}` : ''}` }),
      el('span', { text: '플랜' }), el('span', { text: planLabel(a) + (a.billing === 'stripe_subscription' ? ' (구독)' : '') }),
      el('span', { text: '인증' }), el('span', { text: a.authMethod || 'claude.ai' }),
      el('span', { text: 'Claude Code' }), el('span', { text: 'v' + (S.cliVersion || '?') })),
    u ? el('div', {},
      el('div', { class: 'row2' }, el('span', { text: '5시간' }), el('span', { text: `${u.fiveHour.pct}% · ${fmtUntil(u.fiveHour.resetsAt) || '곧'} 뒤 초기화` })), bar(u.fiveHour.pct),
      el('div', { class: 'row2' }, el('span', { text: '7일' }), el('span', { text: `${u.sevenDay.pct}% · ${fmtUntil(u.sevenDay.resetsAt) || '곧'} 뒤 초기화` })), bar(u.sevenDay.pct),
      el('div', { class: 'msg', text: `사용량 캐시 ${u.fetchedAt ? fmtAgo(u.fetchedAt) + ' 갱신' : ''} · Claude Code가 세션 중에 갱신합니다` })) : el('div', { class: 'msg', text: '사용량 캐시 없음' }),
    el('div', { class: 'row right', style: 'margin-top:8px' }, el('button', { text: '다시 읽기', onclick: () => { usageCache.at = 0; renderProfile().then(renderProfilePop); } })));
}
$('#btn-profile').onclick = () => { pmenu.classList.toggle('open'); if (pmenu.classList.contains('open')) renderProfilePop(); }; // click pins it open
pmenu.onmouseenter = () => renderProfilePop(); // the flyout opens on hover (CSS): refresh its contents then, no click needed
document.addEventListener('mousedown', (e) => { if (!pmenu.contains(e.target)) pmenu.classList.remove('open'); }, true);
renderProfile().then(renderProfilePop); // filled up front, so the hover flyout is never an empty box

// ---------- keyboard shortcuts (menu accelerators via main, ⌥digit directly; Ctrl+Shift+N/K/W and Ctrl+Alt+1-4 off mac) ----------
function selectTabN(n) { const id = n === 0 ? S.tabs[S.tabs.length - 1] : S.tabs[n - 1]; if (id) openSession(id); }
function stepTab(d) { if (!S.tabs.length) return; const i = S.tabs.indexOf(S.sel); openSession(S.tabs[(i + d + S.tabs.length) % S.tabs.length]); }
api.onShortcut(({ action, arg }) => {
  if (action === 'tab') selectTabN(arg);
  else if (action === 'next') stepTab(1);
  else if (action === 'prev') stepTab(-1);
  else if (action === 'close') { if (S.sel && S.view === 'sessions') closeTab(S.sel); }
  else if (action === 'new') $('#btn-new').click();
  else if (action === 'search') { menu.classList.remove('closed'); menu.classList.add('open'); $('#sess-search').focus(); $('#sess-search').select(); }
  else if (action === 'sub') { if (S.view !== 'sessions') setView('sessions'); if (cur()) { S.tab = arg; renderDetail(); } }
  else if (action === 'shell') { if (S.view !== 'sessions') setView('sessions'); if (cur()) toggleShell(); }
});
document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[0-9]$/.test(e.code)) { e.preventDefault(); selectTabN(Number(e.code.slice(5))); }
}, true);

// ---------- live updates ----------
api.onSessionsChanged(loadSessions);
api.onMemoryChanged(() => { S.memory = null; if (S.view === 'memory') loadMemory(); });
$('#btn-refresh').onclick = () => { S.memory = null; loadSessions(); if (S.view === 'memory') loadMemory(); };

// ---------- boot ----------
const q = new URLSearchParams(location.hash.slice(1)); // dev aid: #tab=stats&sel=<short id>&view=memory
if (q.get('tab')) S.tab = q.get('tab');
loadSessions().then(() => {
  const s = q.get('sel') && S.sessions.find((x) => x.short === q.get('sel'));
  if (s) openSession(s.sessionId);
  setView(q.get('view') || 'sessions');
  if (q.get('flyout')) menu.classList.add('open');
  if (q.get('tip')) setTimeout(() => $('.sess')?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: 120, clientY: 120 })), 500);
  if (q.get('ctx')) setTimeout(() => $('.sess')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 140 })), 500);
  if (q.get('new')) setTimeout(() => $('#btn-new').click(), 300);
  if (q.get('profile')) setTimeout(() => $('#btn-profile').click(), 800);
  if (q.get('browser')) setTimeout(() => { const s = cur(); if (s) { toggleBrowser(s); go(brState(s), q.get('browser')); } }, 300);
});
