'use strict';
/* global Terminal, FitAddon, dropClicks, isTermReport */
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
  view: 'sessions', sessions: [], local: [], sel: null, group: null, layout: 'tile', sizes: { x: 0.5, y: 0.5, c: [1 / 3, 1 / 3] }, paneShells: new Set(), tab: 'terminal', tabs: [], booted: false, unseen: new Set(),
  profiles: [], terms: new Map(), shells: new Map(), shellOpen: (() => { try { return localStorage.getItem('shellOpen') === '1'; } catch { return false; } })(), memory: null, projects: [], memSel: null, memFilter: '', memProject: '',
};
const cur = () => S.sessions.find((s) => s.sessionId === S.sel) || S.local.find((s) => s.sessionId === S.sel);

// ---------- navigation ----------
function setView(v) {
  S.view = v;
  for (const k of ['memory', 'stats', 'workspace']) { $(`#btn-${k}`).classList.toggle('active', v === k); $(`#view-${k}`).classList.toggle('hidden', v !== k); }
  $('#view-sessions').classList.toggle('hidden', v !== 'sessions');
  if (typeof syncBrowserPane === 'function') syncBrowserPane(v === 'sessions' ? cur() : null);
  renderTabs();
  if (v === 'memory') loadMemory();
  if (v === 'stats') loadStats();
  if (v === 'workspace' && typeof loadWorkspace === 'function') loadWorkspace();
  if (v === 'sessions') fitCurrent();
}
$('#btn-memory').onclick = () => setView(S.view === 'memory' ? 'sessions' : 'memory');
$('#btn-workspace').onclick = () => setView(S.view === 'workspace' ? 'sessions' : 'workspace');
// every full-screen view (워크스페이스 · 통계 · 메모리) carries a way back: this button, Esc, or any session tab
const viewCloseBtn = () => el('button', { class: 'view-close', text: '× 세션으로', 'data-tip': '세션 화면으로 돌아가기 (Esc)', onclick: () => setView('sessions') });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || S.view === 'sessions' || e.defaultPrevented) return;
  if (document.querySelector('dialog[open], #term-look, .dd') || !ctx.classList.contains('hidden')) return; // those own Esc
  setView('sessions');
});
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
    { const g = saved?.group || saved?.pair; S.group = Array.isArray(g) && g.length >= 2 && g.length <= 4 ? g : null; }
    if (saved?.layout === 'cols') S.layout = 'cols';
    if (Array.isArray(saved?.paneShells)) S.paneShells = new Set(saved.paneShells);
    { const z = saved?.sizes, ok = (v) => v > 0.1 && v < 0.9; if (z && ok(z.x) && ok(z.y) && Array.isArray(z.c) && ok(z.c[0]) && ok(z.c[1]) && ok(1 - z.c[0] - z.c[1])) S.sizes = { x: z.x, y: z.y, c: [z.c[0], z.c[1]] }; }
  }
  trackNeedsInput();
  const selBefore = S.sel;
  for (const s of S.sessions) if (s.continuedIn && !s.live && S.sessions.some((x) => x.sessionId === s.continuedIn)) followContinuation(s.sessionId, s.continuedIn);
  S.local =S.local.filter((l) => !S.sessions.some((s) => s.sessionId === l.sessionId)); // a new chat's placeholder gives way to the real session
  S.tabs = S.tabs.filter((id) => S.sessions.some((s) => s.sessionId === id) || S.local.some((s) => s.sessionId === id));
  if (!S.tabs.includes(S.sel)) S.sel = S.tabs[0] || null;
  if (S.group) { S.group = [...new Set(S.group)].filter((id) => S.tabs.includes(id)); if (S.group.length < 2) S.group = null; }
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
  if (S.group) S.group = S.group.map((id) => (id === oldId ? newId : id));
  if (S.paneShells.delete(oldId)) S.paneShells.add(newId);
  saveTabs();
}
// ---------- needs-input: notify on the transition, badge until the tab is opened ----------
// 입력 대기 해제: a question that no longer needs an answer. Remembered in this app only (localStorage), keyed by the question:
// the session and its files stay as they are, and a new question from the same session shows up again.
const needsOff = (() => { try { return JSON.parse(localStorage.getItem('needsOff')) || {}; } catch { return {}; } })();
const needsKey = (s) => s.job?.needs || s.job?.detail || s.state || '';
const needsInput = (s) => !!(s.job?.needs || s.state === 'blocked') && needsOff[s.sessionId] !== needsKey(s);
function setNeedsOff(ids, off = true) {
  for (const id of ids) { const s = S.sessions.find((x) => x.sessionId === id); if (off && s) needsOff[id] = needsKey(s); else delete needsOff[id]; }
  try { localStorage.setItem('needsOff', JSON.stringify(needsOff)); } catch { /* this run only */ }
  trackNeedsInput(); renderSessionList(); renderTabs();
}
// what the dot, the list group and the card counts show for a live session: its current activity (daemon status busy/idle),
// not the job's own long-term state — a job says "working" while follow-ups are pending even as its process sits idle at the prompt.
// A stopped session keeps the job's last state (done / working) so a hollow ring still tells how it was left.
const activity = (s) => needsInput(s) ? 'blocked' : s.live ? (s.status === 'busy' ? 'working' : 'idle') : (s.state === 'blocked' ? 'idle' : s.state || s.status || ''); // a released wait reads as idle
let prevNeeds = null; // null until the first load, so sessions already waiting at startup do not fire
// 작업 완료 알림 (모양 › 알림): a session that worked for a while and is now idle/done. Short turns (< 10 s) and the session
// on screen in the focused window stay quiet; needs-input has its own notification above.
const workingSince = new Map(); // sessionId → when it was first seen working
let doneBooted = false;
function trackDone() {
  for (const s of S.sessions) {
    const a = activity(s), id = s.sessionId;
    if (a === 'working') { if (!workingSince.has(id)) workingSince.set(id, Date.now()); continue; }
    const since = workingSince.get(id);
    workingSince.delete(id);
    if (!since || !doneBooted) continue;
    // CCMy 작업 일지: work of 10 s or more that ended, or stopped on a question (a bare wait may be a permission menu mid-work)
    if (Date.now() - since >= 10000 && (a !== 'blocked' || s.job?.needs) && !(typeof LOOK !== 'undefined' && LOOK.ccmyJournal === 'off')) api.ccmyJournal({ sessionId: id, name: s.name, cwd: s.cwd, fallback: s.job?.detail || s.lastPrompt || '' }).catch(() => {});
    if (a === 'blocked') continue;
    if (typeof ccmyChainFire === 'function') ccmyChainFire(s); // CCMy 연결: "when this one finishes, give that one …"
    // CCMy 이어서 진행: every stop counts, short turns and the session on screen included; it answers instead of notifying
    if (typeof ccmyAutoOn === 'function' && ccmyAutoOn(id)) { if (ccmyAutoStep(s, '작업을 멈춤')) continue; }
    if (Date.now() - since < 10000) continue;
    if (document.hasFocus() && S.view === 'sessions' && (id === S.sel || (groupShown() && S.group.includes(id)))) continue;
    if (typeof ccmyDone === 'function') ccmyDone(s); // the CCMy card stays even with the OS notification switched off
    if (typeof LOOK !== 'undefined' && LOOK.doneNotify === 'off') continue;
    try {
      const n = new Notification(`작업 완료: ${s.name}`, { body: s.job?.detail || '세션이 작업을 마쳤습니다', silent: typeof ccmySoundOn === 'function' && ccmySoundOn() && LOOK.ccmy !== 'off' });
      n.onclick = () => { api.focusWindow(); openSession(id); };
    } catch { /* notifications unavailable */ }
  }
  doneBooted = true;
}
function trackNeedsInput() {
  trackDone();
  const now = new Set(S.sessions.filter(needsInput).map((s) => s.sessionId));
  if (prevNeeds) for (const id of now) if (!prevNeeds.has(id)) notifyNeedsInput(S.sessions.find((s) => s.sessionId === id));
  for (const id of [...S.unseen]) if (!now.has(id)) S.unseen.delete(id);
  prevNeeds = now;
  api.setBadge(now.size);
  const btn = $('#btn-sessions');
  btn.replaceChildren('세션 ▾', now.size ? el('span', { class: 'pill', text: String(now.size) }) : '');
  if (typeof ccmyRender === 'function') { ccmyRender(); ccmyTick(); }
}
function notifyNeedsInput(s) {
  S.unseen.add(s.sessionId);
  if (!S.tabs.includes(s.sessionId)) S.tabs.push(s.sessionId);
  if (typeof ccmyAlert === 'function') ccmyAlert(s, '입력 대기');
  try {
    const n = new Notification(`입력 대기: ${s.name}`, { body: s.job?.needs || s.job?.detail || '세션이 입력을 기다립니다', silent: typeof ccmySoundOn === 'function' && ccmySoundOn() && LOOK.ccmy !== 'off' });
    n.onclick = () => { api.focusWindow(); openSession(s.sessionId); };
  } catch { /* notifications unavailable: the badge still shows */ }
}

// Installed Claude Code version vs. the version each running background session was started with.
const outdated = () => S.sessions.filter((s) => s.live && s.kind === 'background' && s.version && S.cliVersion && s.version !== S.cliVersion);
function renderVersionBar() {
  const bar = $('#version-bar'), old = outdated(), bg = S.sessions.filter((s) => s.live && s.kind === 'background');
  bar.replaceChildren(...[ // native replaceChildren would print a null as "null"
    el('span', { class: 'msg' }, el('span', { class: 'ver-link', text: `Manager v${api.appVersion}`, 'data-tip': '누르면 새 버전이 있는지 확인합니다', onclick: (e) => { e.stopPropagation(); checkUpdateInline(e.currentTarget.nextSibling); } }), el('span', { id: 'ver-status-bar' }), ` · Claude Code v${S.cliVersion || '?'} · 실행 중인 bg 세션 ${bg.length}개`),
    old.length ? el('span', { class: 'pill', text: `구버전 ${old.length}개` }) : null,
    el('button', { class: old.length ? 'primary' : '', text: '모두 재시작 (respawn --all)', disabled: bg.length ? null : 'true', onclick: async () => {
      const names = (old.length ? old : bg).map((s) => `· ${s.name} (v${s.version || '?'})`).join('\n');
      if (!(await askConfirm(`실행 중인 백그라운드 세션을 모두 현재 Claude Code v${S.cliVersion}로 재시작할까요?\n대화는 그대로 이어지고, 붙어 있던 터미널은 떨어졌다가 다시 붙을 수 있습니다.\n\n${names}`, { title: '모두 재시작', ok: '재시작', danger: false }))) return;
      const r = await api.respawnAll();
      if (!r.ok) alert(r.output || 'respawn 실패');
      setTimeout(loadSessions, 1500);
    } })].filter(Boolean));
}

// open tabs, their order and the selected one persist across restarts
const loadTabs = () => { try { return JSON.parse(localStorage.getItem('openTabs')); } catch { return null; } };
const saveTabs = () => { if (S.booted) try { localStorage.setItem('openTabs', JSON.stringify({ tabs: S.tabs, sel: S.sel, group: S.group, layout: S.layout, sizes: S.sizes, paneShells: [...S.paneShells] })); } catch { /* fine */ } };
function renderTabs() {
  { const seen = new Set(); S.tabs = S.tabs.filter((id) => !seen.has(id) && seen.add(id)); } // one tab per session, whatever path added it
  saveTabs();
  const all = [...S.local, ...S.sessions];
  $('#tabs').replaceChildren(...S.tabs.map((id) => all.find((s) => s.sessionId === id)).filter(Boolean).map((s) => {
    const st = activity(s);
    const n = S.tabs.indexOf(s.sessionId) + 1;
    const t = el('div', { class: 'tab glass' + (s.sessionId === S.sel && S.view === 'sessions' ? ' active' : '') + (S.group?.includes(s.sessionId) ? ' paired' : ''), draggable: 'true',
      // a cut-off name drifts to show the rest while hovered
      onmouseenter: (e) => { const l = e.currentTarget.querySelector('.label'); const over = l.scrollWidth - l.clientWidth; if (over > 4) { l.style.setProperty('--shift', `-${over}px`); l.style.setProperty('--dur', `${Math.max(2.5, over / 30)}s`); l.classList.add('marquee'); } else l.classList.remove('marquee'); }, 'data-tip': `${n <= 9 ? `${kbd('⌘' + n)} · ` : ''}${shortPath(s.cwd)}\n${s.job?.needs || s.job?.detail || ''}`.trim(), onclick: () => openSession(s.sessionId), oncontextmenu: (e) => showCtx(e, s),
      // drag to reorder: native HTML5 DnD; the half of the target the pointer is over decides before/after
      ondragstart: (e) => { S.dragTab = s.sessionId; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.sessionId); setTimeout(() => t.classList.add('dragging')); },
      ondragover: (e) => { if (!S.dragTab || S.dragTab === s.sessionId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const r = t.getBoundingClientRect(); const after = e.clientX > r.left + r.width / 2; t.classList.toggle('drop-after', after); t.classList.toggle('drop-before', !after); },
      ondragleave: () => t.classList.remove('drop-before', 'drop-after'),
      ondrop: (e) => { e.preventDefault(); e.stopPropagation(); moveTab(S.dragTab, s.sessionId, t.classList.contains('drop-after')); },
      ondragend: () => { S.dragTab = null; renderTabs(); } },
      el('span', { class: `glyph ${st} ${s.live || s.local ? 'live' : 'off'}` }),
      S.group?.includes(s.sessionId) ? el('span', { class: 'side', text: '①②③④'[S.group.indexOf(s.sessionId)], 'data-tip': `나란히 보기의 ${S.group.indexOf(s.sessionId) + 1}번 창` }) : null,
      el('span', { class: 'label' }, el('span', { class: 'txt', text: s.name })), // inner span: the marquee moves it with transform, so the tab's width never follows
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
  S.picker = false;
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
  S.paneShells.delete(id);
  S.local = S.local.filter((s) => s.sessionId !== id);
  if (S.sel === id) S.sel = S.tabs[S.tabs.length - 1] || null;
  if (S.group?.includes(id)) { S.group = S.group.filter((x) => x !== id); if (S.group.length < 2) S.group = null; }
  renderSessionList(); renderTabs(); renderDetail();
}
// ---------- 나란히 보기: 2 ~ 4 sessions as a fixed group, in order (terminal sub-tab only) ----------
// The group shows whenever one of its tabs is selected, always in the same order; the selected one is the active pane
// (header, sub-tabs, shell and browser follow it). Any other tab shows alone; coming back to a grouped tab brings the group back.
// Layouts: 2 → side by side, 4 → 2×2, 3 → S.layout 'tile' (one tall pane + two stacked) or 'cols' (three columns).
// Borders drag (S.sizes: x / y = the column / row split, c = the first two of three columns); a double click evens them out.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cols3 = (n) => n === 3 && S.layout === 'cols';
function applySplitSizes(pane, n) {
  const z = S.sizes, fr = (...f) => f.map((v) => `minmax(0, ${v}fr)`).join(' ');
  pane.style.gridTemplateColumns = cols3(n) ? fr(z.c[0], z.c[1], 1 - z.c[0] - z.c[1]) : fr(z.x, 1 - z.x);
  pane.style.gridTemplateRows = n > 2 && !cols3(n) ? fr(z.y, 1 - z.y) : '';
}
function placeGrips(pane) { // each grip sits on the gap between the two panes it divides
  const k = [...pane.querySelectorAll('.split-col')].map((c) => c.getBoundingClientRect()), p = pane.getBoundingClientRect(), n = k.length;
  for (const g of pane.querySelectorAll('.split-grip')) {
    const key = g.dataset.k;
    if (key === 'y') { const [a, b] = n === 3 ? [k[1], k[2]] : [k[0], k[2]]; Object.assign(g.style, { top: `${(a.bottom + b.top) / 2 - p.top - 4}px`, left: `${(n === 3 ? a.left : k[0].left) - p.left}px`, width: `${n === 3 ? a.width : k[1].right - k[0].left}px` }); }
    else { const [a, b] = key === 'c1' ? [k[1], k[2]] : [k[0], k[1]]; Object.assign(g.style, { left: `${(a.right + b.left) / 2 - p.left - 4}px`, top: `${k[0].top - p.top}px`, height: `${k[n - 1].bottom - k[0].top}px` }); }
  }
}
function splitGrip(pane, key, n) {
  const g = el('div', { class: 'split-grip ' + (key === 'y' ? 'h' : 'v'), 'data-k': key, 'data-tip': '끌어서 크기 조절 · 두 번 눌러 균등하게' });
  const set = (fx, fy) => {
    const z = S.sizes;
    if (key === 'x') z.x = clamp(fx, 0.2, 0.8); else if (key === 'y') z.y = clamp(fy, 0.2, 0.8);
    else if (key === 'c0') { const sum = z.c[0] + z.c[1]; z.c[0] = clamp(fx, 0.15, sum - 0.15); z.c[1] = sum - z.c[0]; } // the middle pane gives or takes
    else z.c[1] = clamp(fx - z.c[0], 0.15, 0.85 - z.c[0]);
    applySplitSizes(pane, n); placeGrips(pane);
  };
  g.onmousedown = (e) => {
    e.preventDefault();
    const r = pane.getBoundingClientRect(), pad = parseFloat(getComputedStyle(pane).paddingLeft) || 0;
    document.body.classList.add('resizing', key === 'y' ? 'row' : 'col');
    const move = (ev) => set((ev.clientX - r.left - pad) / (r.width - 2 * pad), (ev.clientY - r.top - pad) / (r.height - 2 * pad));
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing', 'row', 'col'); saveTabs(); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
  g.ondblclick = () => { if (key === 'x' || key === 'y') set(0.5, 0.5); else { S.sizes.c = [1 / 3, 1 / 3]; applySplitSizes(pane, n); placeGrips(pane); } saveTabs(); };
  return g;
}
const SPLIT_MAX = 4;
const groupShown = () => !!(S.group && S.group.includes(S.sel) && S.view === 'sessions' && S.tab === 'terminal');
const groupSessions = () => { if (!S.group || !S.group.includes(S.sel)) return null; const all = [...S.local, ...S.sessions], g = S.group.map((id) => all.find((s) => s.sessionId === id)).filter(Boolean); return g.length >= 2 ? g : null; };
function setGroup(ids) { // null or fewer than two ends it
  S.group = ids && ids.length >= 2 ? ids.slice(0, SPLIT_MAX) : null;
  if (S.group) { for (const id of S.group) if (!S.tabs.includes(id)) S.tabs.push(id); if (!S.group.includes(S.sel)) S.sel = S.group[S.group.length - 1]; S.tab = 'terminal'; if (S.view !== 'sessions') setView('sessions'); }
  renderTabs(); renderDetail();
}
const addSplit = (id) => setGroup(S.group ? [...S.group.filter((x) => x !== id), id] : [S.sel, id]); // joins as the last pane
const dropSplit = (id) => setGroup(S.group.filter((x) => x !== id));
// ⌘\ or the ＋ 창 button opens an empty pane with a picker: the user chooses which tab or session goes there
function toggleSplit() {
  if (S.picker) { S.picker = false; return renderDetail(); }
  if (S.group) return setGroup(null);
  if (cur()) openPicker();
}
function openPicker() { S.picker = true; S.tab = 'terminal'; if (S.view !== 'sessions') setView('sessions'); renderDetail(); }
function pickSplit(id) { S.picker = false; const g = S.group?.includes(S.sel) ? [...S.group, id] : [S.sel, id]; S.sel = id; setGroup(g); } // the new pane becomes the active one
function pickerPane(taken) {
  const all = [...S.local, ...S.sessions].filter((x) => !taken.includes(x.sessionId) && !x.starting);
  const list = el('div', { class: 'pick-list' });
  const row = (x) => el('div', { class: 'pick-row', onclick: () => pickSplit(x.sessionId) },
    el('span', { class: `glyph ${activity(x)} ${x.live || x.local ? 'live' : 'off'}` }), el('span', { class: 'name', text: x.name }), el('span', { class: 'path', text: shortPath(x.cwd) }));
  const draw = (q = '') => {
    const hit = all.filter((x) => !q || `${x.name} ${x.cwd}`.toLowerCase().includes(q.toLowerCase()));
    const open = S.tabs.map((id) => hit.find((x) => x.sessionId === id)).filter(Boolean), rest = hit.filter((x) => !S.tabs.includes(x.sessionId)).slice(0, 60);
    list.replaceChildren(...(open.length ? [el('h4', { text: '열린 탭' }), ...open.map(row)] : []), ...(rest.length ? [el('h4', { text: '다른 세션' }), ...rest.map(row)] : []),
      ...(!open.length && !rest.length ? [el('div', { class: 'empty', text: '고를 세션이 없습니다' })] : []));
  };
  const input = el('input', { placeholder: '이 창에 열 세션 검색…', oninput: () => draw(input.value),
    onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); toggleSplit(); } else if (e.key === 'Enter') list.querySelector('.pick-row')?.click(); } });
  draw();
  requestAnimationFrame(() => input.focus());
  return el('div', { class: 'split-col picker' }, input, list, el('div', { class: 'split-tools' }, el('button', { 'data-tip': '취소 (Esc)', onclick: toggleSplit }, svgIcon(ICON.x))));
}
// the active pane moves to the first place (the tall one in the 1+2 tile); already first → it trades with the second
function swapSplit(id = S.sel) {
  if (!S.group?.includes(id)) return;
  const rest = S.group.filter((x) => x !== id);
  S.group = S.group[0] === id ? [rest[0], id, ...rest.slice(1)] : [id, ...rest];
  renderTabs(); renderDetail();
}
function toggleLayout() { S.layout = S.layout === 'cols' ? 'tile' : 'cols'; saveTabs(); renderDetail(); }
// the active side follows focus (a click into the other terminal, or ⌘⌥←/→) without rebuilding the pane
function activatePane(id, refocus = true) { // refocus false: the click already put focus where the user wants it (terminal or its shell)
  const t = S.terms.get(id);
  if (id === S.sel || !S.group?.includes(id)) { if (refocus) t?.term.focus(); return; }
  S.sel = id; S.unseen.delete(id);
  renderTabs(); renderSessionList();
  for (const c of document.querySelectorAll('.split-col')) c.classList.toggle('on', c.dataset.id === id);
  const head = $('#detail-head'), s = cur();
  if (head && s) head.replaceWith(buildHead(s));
  renderShellPanel(); if (typeof syncBrowserPane === 'function') syncBrowserPane(s);
  $('#session-detail .shell-toggle')?.replaceWith(shellToggleBtn());
  if (refocus) t?.term.focus();
}
function focusSplit(dir) { if (!groupShown()) return; const n = S.group.length, i = S.group.indexOf(S.sel); activatePane(S.group[(i + (dir === 'right' ? 1 : n - 1)) % n]); } // wraps around
function renderSessionList() {
  const list = $('#session-list');
  list.replaceChildren();
  const group = (title, arr) => {
    if (!arr.length) return;
    list.append(el('div', { class: 'group-title', text: `${title} (${arr.length})` }));
    for (const s of arr) { const r = sessionRow(s); r.style.setProperty('--i', list.childElementCount); list.append(r); } // stagger index
  };
  const bucket = (s) => s.pinned ? 'pinned' : needsInput(s) ? 'needs'
    : activity(s) === 'working' ? 'working' : s.job ? 'done' : 'other';
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
  const st = activity(s);
  const detail = s.job?.needs || s.job?.detail || s.lastPrompt || s.job?.intent || '';
  return el('div', { class: 'sess' + (s.sessionId === S.sel ? ' sel' : ''), 'data-tip': `${shortPath(s.cwd)}\n${detail}`, onclick: () => openSession(s.sessionId), oncontextmenu: (e) => showCtx(e, s) },
    el('span', { class: 'name' }, el('span', { class: `glyph ${st} ${s.live ? 'live' : 'off'}` }), s.name, profileBadge(s)),
    el('span', { class: 'detail', text: detail }),
    el('span', { class: 'links', text: linksLabel(s.job) }),
    el('span', { class: 'age', text: fmtAgo(s.lastActivity) }));
}

// ---- status line under the header: model | branch* | context/window | 5h % (reset) | 7d % | mode | MR ----
const modelLabel = (m = '') => { const x = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(m); return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? '.' + x[3] : ''}` : (m || ''); };
const fmtUntil = (iso) => { const ms = Date.parse(iso) - Date.now(); if (!(ms > 0)) return ''; const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4); return h >= 24 ? `${Math.floor(h / 24)}d${h % 24}h` : h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`; };
let usageCache = { at: 0, v: null };
async function getUsage() { if (Date.now() - usageCache.at > 60000) { usageCache = { at: Date.now(), v: await api.usage().catch(() => null) }; } return usageCache.v; }
// ---- account usage strip (sub-tab row): 5h / 7d / per-model (Fable) windows as mini gauges, refreshed every minute ----
function renderUsageStrip(box, u) {
  if (!u) { box.replaceChildren(el('span', { class: 'msg', text: '사용량 캐시 없음' })); return; }
  const items = [['5h', u.fiveHour, '5시간 창'], ['7d', u.sevenDay, '7일 창'], ...(u.scoped || []).map((s) => [`${s.name} ${s.group === 'weekly' ? '7d' : s.group}`, s, `${s.name} 모델 ${s.group === 'weekly' ? '주간' : s.group} 한도`])];
  box.replaceChildren(...items.filter(([, w]) => w && typeof w.pct === 'number').map(([label, w, desc]) => {
    const cls = w.pct >= 90 ? 'bad' : w.pct >= 70 ? 'warn' : '';
    return el('span', { class: 'ug', 'data-tip': `${desc} 사용률 ${w.pct}%${w.resetsAt ? ` · ${fmtUntil(w.resetsAt) || '곧'} 뒤 초기화` : ''}${u.fetchedAt ? `\n사용량 캐시 ${fmtAgo(u.fetchedAt)} 갱신 · Claude Code가 세션 중에 갱신` : ''}` },
      el('span', { class: 'ug-l', text: label }), el('span', { class: 'ub' }, el('i', { class: cls, style: `width:${Math.min(100, w.pct)}%` })),
      el('b', { class: cls, text: `${w.pct}%` }), w.resetsAt ? el('span', { class: 'ug-r', text: fmtUntil(w.resetsAt) || '곧' }) : null);
  }));
}
function usageStrip() { const box = el('div', { class: 'usage-strip' }); getUsage().then((u) => renderUsageStrip(box, u)); return box; }
setInterval(() => { const box = $('.usage-strip'); if (!box) return; usageCache.at = 0; getUsage().then((u) => renderUsageStrip(box, u)); }, 60000);
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
    actions.push(el('button', { text: '재시작', onclick: () => act('respawn', s) }), el('button', { class: 'danger', text: '삭제', onclick: () => deleteFlow(s) }));
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
    usageStrip(), shellToggleBtn());
  const pane = el('div', { class: 'pane' + (S.tab === 'terminal' ? ' term' : '') });
  sec.replaceChildren(el('div', { class: 'head-wrap' }, el('div', { class: 'head-strip' }, el('i')), head), tabs, pane); // head is an overlay: hidden until the strip is hovered, so the pane never reflows
  renderShellPanel();
  if (typeof syncBrowserPane === 'function') syncBrowserPane(s);
  const group = S.tab === 'terminal' ? groupSessions() : null;
  const picking = S.tab === 'terminal' && S.picker && (group?.length || 1) < SPLIT_MAX;
  if (!picking) S.picker = false;
  if (group || picking) {
    const shown = group || [s], n = shown.length + (picking ? 1 : 0);
    pane.classList.add('split', `n${n}`, cols3(n) ? 'lay-cols' : 'lay-tile');
    applySplitSizes(pane, n);
    if (n === 3) tabs.insertBefore(el('button', { class: 'split-layout ico', 'data-tip': `배치 바꾸기 · 지금: ${S.layout === 'cols' ? '긴 창 3열' : '긴 창 1 + 짧은 창 2'}`, onclick: toggleLayout }, svgIcon(S.layout === 'cols' ? ICON.cols : ICON.tile)), tabs.lastChild);
    if (group && !picking && n < SPLIT_MAX) tabs.insertBefore(el('button', { class: 'split-layout ico', 'data-tip': '창 추가 · 빈 창을 열고 세션을 골라 넣기', onclick: openPicker }, svgIcon(ICON.addPane)), tabs.lastChild);
    shown.forEach((x, i) => {
      const col = el('div', { class: 'split-col' + (x.sessionId === S.sel ? ' on' : ''), 'data-id': x.sessionId, onfocusin: () => { if (x.sessionId !== S.sel) activatePane(x.sessionId, false); } });
      pane.append(col);
      showTerminal(x, col, x.sessionId === S.sel && !picking);
      if (group && S.paneShells.has(x.sessionId)) { const f = S.focusShell === x.sessionId; col.append(shellPanel(x, col, { key: 'shellHPane', def: 170, min: 80, room: 100, focus: f })); }
      if (group) col.append(el('div', { class: 'split-tools' },
        el('button', { class: S.paneShells.has(x.sessionId) ? 'toggled' : '', 'data-tip': '이 창의 셸 열기/숨기기 (⌃`)', onclick: () => toggleShell(x.sessionId) }, svgIcon(ICON.shell)),
        i ? el('button', { 'data-tip': '첫 번째 자리로 (긴 창)', onclick: () => swapSplit(x.sessionId) }, svgIcon(ICON.first)) : null,
        el('button', { 'data-tip': '나란히 보기에서 빼기 (탭은 그대로)', onclick: () => dropSplit(x.sessionId) }, svgIcon(ICON.x))));
    });
    S.focusShell = null;
    if (picking) pane.append(pickerPane(shown.map((x) => x.sessionId)));
    pane.append(...(cols3(n) ? ['c0', 'c1'] : n > 2 ? ['x', 'y'] : ['x']).map((k) => splitGrip(pane, k, n)));
    new ResizeObserver(() => pane.isConnected && placeGrips(pane)).observe(pane);
  } else if (S.tab === 'terminal') showTerminal(s, pane);
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
// clicks on a Claude terminal stay local unless 모양 → 「마우스 클릭을 Claude 터미널에 전달」 is on
const clicksLocal = () => !(typeof LOOK !== 'undefined' && LOOK.termClicks === 'on');
// localClicks: a function saying whether this terminal keeps mouse clicks to itself (the Claude terminal) — then drag-selection
// stays on even while the program tracks the mouse. Omitted (the shell panel) = xterm's default: the program owns the drag.
function newXterm({ localClicks } = {}) {
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
  // xterm switches its own drag-selection off whenever the program enables mouse reporting (the fullscreen TUI does) and
  // expects the program to handle the drag. When clicks never reach the program there is nothing to hand the drag to, so
  // selection is switched back on after every protocol change (xterm disables it there first). xterm 5.5 internals, guarded.
  const sel = term._core?._selectionService, mouse = term._core?.coreMouseService;
  const syncSelection = () => { if (!localClicks || !sel || !mouse) return; if (mouse.areMouseEventsActive && !localClicks()) sel.disable(); else sel.enable(); };
  if (localClicks && sel && mouse?.onProtocolChange && mouse.triggerMouseEvent) {
    mouse.onProtocolChange(syncSelection); box.classList.add('local-clicks');
    // and the reports themselves are stopped at the source: a report counts as user input, on which xterm clears the
    // selection (the mouse-up report would wipe the drag just made). Wheel reports (button 4) still go to the program.
    const send = mouse.triggerMouseEvent.bind(mouse);
    mouse.triggerMouseEvent = (e) => (e.button !== 4 && localClicks() ? false : send(e));
  }
  return { term, fit, box, syncSelection };
}
function createTerm(s) {
  const { term, fit, box, syncSelection } = newXterm({ localClicks: clicksLocal });
  const status = el('span', { text: '연결 안 됨' });
  const btn = el('button', { class: 'ico', onclick: () => { t.detached = !!t.ptyId; return t.ptyId ? api.ptyKill(t.ptyId) : attach(s); } }); // detached = the user let go: no auto re-attach
  const t = { term, fit, box, btn, status, syncSelection, ptyId: null, bar: el('div', { class: 'term-bar' }, btn, status) }; // 모양 lives in the gear menu
  // one button toggles: detach only ends the `claude attach` client, the background session keeps running
  t.setLabel = () => { const live = (S.sessions.find((x) => x.sessionId === s.sessionId) || s).live; const [icon, tip] = t.ptyId ? (live ? [ICON.detach, '떼기 (detach) · 세션은 계속 실행'] : [ICON.stop, '터미널 닫기']) : (live ? [ICON.attach, '붙기 (attach)'] : [ICON.play, '이어가기 (resume)']); btn.replaceChildren(svgIcon(icon)); btn.dataset.tip = tip; }; // fresh state: s is the object from when the tab was built
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
    // replies to the TUI's own queries ride this path too (Claude Code 2.1.328+ polls the cursor position several times a
    // second): they are not typing, so neither the catch-up below nor the wheeled-up reset may fire on them
    if (isTermReport(d)) { if (/^\x1b\[<64;/.test(d)) t.wheeledUp = true; } // SGR button 64 = wheel up
    else {
      const b = term.buffer.active;
      if (b.type === 'alternate') { if (t.wheeledUp || tuiScrolledUp()) api.ptyWrite(t.ptyId, '\x1b[1;5F'); }
      else if (b.viewportY < b.baseY) term.scrollToBottom(); // classic renderer: xterm's own scrollback
      t.wheeledUp = false;
    }
    if (clicksLocal()) { d = dropClicks(d); if (!d) return; } // wheel reports pass
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
// An xterm box that leaves the DOM (tab switch, panel hide) comes back with its viewport scrollTop reset to 0 while
// xterm still believes it sits at its old line: the next wheel notch then jumps by that whole gap and the bottom
// becomes unreachable. Moving one line away and back makes xterm's Viewport rewrite scrollTop from its own state.
function resyncViewport(term) {
  const b = term.buffer.active;
  if (b.type !== 'normal' || b.baseY === 0) return;
  const y = b.viewportY;
  term.scrollLines(y > 0 ? -1 : 1);
  term.scrollToLine(y);
}
function showTerminal(s, pane, focus = true) {
  if (s.starting) { pane.append(el('div', { class: 'starting' }, el('span', { class: 'spin' }), el('span', { text: `"${s.name}" 세션을 시작하는 중… (claude --bg${s.profile !== 'default' ? ` · ${s.profile}` : ''})` }))); return; }
  let t = S.terms.get(s.sessionId);
  if (!t) { t = createTerm(s); S.terms.set(s.sessionId, t); }
  pane.append(t.bar, t.box);
  requestAnimationFrame(() => {
    t.fit.fit(); resyncViewport(t.term); if (focus) t.term.focus();
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
  if (s.sessionId === S.sel) t.term.focus(); // the other side of a pair attaches without taking focus
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
  const btn = el('button', { class: 'ico', onclick: () => (h.ptyId ? api.ptyKill(h.ptyId) : openShell(s)) });
  const hide = el('button', { class: 'ico', 'data-tip': '숨기기 (⌃`) · 셸은 계속 실행', onclick: () => toggleShell(s.sessionId) }, svgIcon(ICON.down));
  const wt = WORKTREE_RE.test(sessionDir(s) || '') ? sessionDir(s) : null;
  const cdBtn = wt && el('button', { class: 'ico', onclick: () => { if (!h.ptyId) return; h.atWorktree = !h.atWorktree; api.ptyWrite(h.ptyId, `cd ${shq(h.atWorktree ? wt : shellCwd(s))}\r`); h.setCd(); h.term.focus(); } });
  const h = { term, fit, box, btn, status, ptyId: null, exited: false, atWorktree: false, bar: el('div', { class: 'term-bar' }, el('b', { class: 'shell-title', text: '셸' }), btn, cdBtn, status, hide) };
  h.setLabel = () => { btn.replaceChildren(svgIcon(h.ptyId ? ICON.stop : ICON.play)); btn.dataset.tip = h.ptyId ? '셸 닫기' : '셸 다시 열기'; };
  h.setCd = () => { if (!cdBtn) return; cdBtn.replaceChildren(svgIcon(h.atWorktree ? ICON.folder : ICON.branch)); cdBtn.dataset.tip = h.atWorktree ? '프로젝트 루트로 cd' : `워크트리로 cd · 세션은 여기서 작업 중: ${shortPath(wt)}`; }; // the icon shows where a click goes
  h.setCd();
  h.setLabel();
  term.onData((d) => h.ptyId && api.ptyWrite(h.ptyId, d));
  term.onResize(({ cols, rows }) => h.ptyId && api.ptyResize(h.ptyId, cols, rows));
  return h;
}
async function openShell(s, focus = true) {
  const h = S.shells.get(s.sessionId);
  if (!h || h.ptyId) return;
  if (h.exited) { h.exited = false; h.term.reset(); h.atWorktree = false; h.setCd(); }
  h.fit.fit();
  h.btn.disabled = true;
  h.ptyId = await api.ptyOpen({ shell: true, cwd: shellCwd(s), cols: h.term.cols, rows: h.term.rows, profile: s.profile });
  h.btn.disabled = false;
  h.setLabel();
  h.status.textContent = `셸 · ${shortPath(shellCwd(s))} · 이 세션의 대화에는 기록되지 않습니다`;
  if (focus) h.term.focus();
}
// Bottom panel (VS Code style): one shell per session tab, shown under whatever sub-tab is open; hiding keeps the pty.
const ICON = { // 24×24 stroke icons for the terminal bar and the pane tools
  shell: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10l3 2-3 2M12.5 15H17"/>',
  first: '<path d="M5 5v14M19 12H9M13 7l-5 5 5 5"/>', x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  attach: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>',
  detach: '<path d="M10.5 13.5a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/><path d="M4 4l16 16"/>', // the link, struck through
  down: '<path d="M6 9.5l6 6 6-6"/>', folder: '<path d="M3.5 8a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  branch: '<circle cx="7" cy="6" r="2"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="8" r="2"/><path d="M7 8v8M17 10c0 3.5-5 3-9 5"/>',
  addPane: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 9v6M9 12h6"/>',
  tile: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 5v14M12 12h9"/>', cols: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M9 5v14M15 5v14"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>', stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
};
const svgIcon = (d) => { const w = document.createElement('span'); w.innerHTML = `<svg viewBox="0 0 24 24">${d}</svg>`; return w.firstChild; };
// In 나란히 보기 each pane has its own shell under its terminal (S.paneShells, toggled per pane); the bottom panel is for a single session.
const shellOn = () => (groupShown() ? S.paneShells.has(S.sel) : S.shellOpen);
const shellToggleBtn = () => el('button', { class: 'shell-toggle' + (shellOn() ? ' active' : ''), 'data-tip': `${groupShown() ? '이 창의 셸' : '하단 셸 패널'} ${shellOn() ? '숨기기' : '열기'} (⌃\`) · 세션 폴더의 zsh, 대화에는 기록되지 않음`, onclick: () => toggleShell() },
  svgIcon(ICON.shell), `셸 ${shellOn() ? '▾' : '▴'}`);
function toggleShell(id = S.sel) {
  if (groupShown() && S.group.includes(id)) { // this pane's shell only
    const on = !S.paneShells.delete(id);
    if (on) { S.paneShells.add(id); S.focusShell = id; }
    if (id !== S.sel) { S.sel = id; renderTabs(); }
    saveTabs(); renderDetail();
    return;
  }
  S.shellOpen = !S.shellOpen;
  try { localStorage.setItem('shellOpen', S.shellOpen ? '1' : ''); } catch { /* fine */ }
  $('#session-detail .shell-toggle')?.replaceWith(shellToggleBtn());
  renderShellPanel();
  if (!S.shellOpen) S.terms.get(S.sel)?.term.focus();
}
// a session's shell as a panel with a draggable top edge; host = what it sits in (the detail section, or one pane of a group)
function shellPanel(s, host, { key = 'shellH', def = 260, min = 120, room = 160, focus = true } = {}) {
  let h = S.shells.get(s.sessionId);
  if (!h) { h = createShell(s); S.shells.set(s.sessionId, h); }
  const saved = (() => { try { return Number(localStorage.getItem(key)) || def; } catch { return def; } })();
  const panel = el('div', { class: 'shell-panel', 'data-id': s.sessionId, style: `height:${Math.max(min, saved)}px` });
  const grip = el('div', { class: 'shell-grip', 'data-tip': '끌어서 높이 조절' });
  grip.onmousedown = (e) => { // drag the top edge; the xterm refits through its ResizeObserver
    e.preventDefault();
    const startY = e.clientY, startH = panel.offsetHeight, max = host.clientHeight - room;
    document.body.classList.add('resizing');
    const move = (ev) => { panel.style.height = `${Math.min(max, Math.max(min, startH + (startY - ev.clientY)))}px`; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing'); try { localStorage.setItem(key, String(panel.offsetHeight)); } catch { /* fine */ } };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
  panel.append(grip, h.bar, h.box);
  requestAnimationFrame(() => { if (!panel.isConnected) return; h.fit.fit(); resyncViewport(h.term); if (focus) h.term.focus(); if (!h.ptyId && !h.exited) openShell(s, focus); }); // an exited shell stays as it was until "다시 열기"
  return panel;
}
function renderShellPanel() {
  const sec = $('#session-detail'), s = cur(), old = sec.querySelector(':scope > .shell-panel');
  if (!S.shellOpen || !s || S.view !== 'sessions' || groupShown()) { old?.remove(); return; }
  if (old?.dataset.id === s.sessionId) return;
  old?.remove();
  sec.append(shellPanel(s, sec));
}
function fitCurrent() { for (const t of [S.terms.get(S.sel), ...(S.group || []).map((id) => S.terms.get(id)), S.shells.get(S.sel)]) if (t?.box.isConnected) requestAnimationFrame(() => t.fit.fit()); }
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
  if (typeof renderSessionStats === 'function') return renderSessionStats(st, pane, s); // stats.js: same dashboard pieces as 전체 통계
  const tk = st.tokens;
  const tile = (k, v) => el('div', { class: 'tile glass' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }));
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
$('#mem-close').onclick = () => setView('sessions');
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
          if (!(await askConfirm(`"${m.name}" 메모리를 삭제할까요?\n${shortPath(m.file)}\nMEMORY.md 인덱스 줄도 함께 지웁니다.`, { title: '메모리 삭제', ok: '삭제' }))) return;
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
    if (r.exists && await askConfirm('대상 프로젝트에 같은 이름의 메모리가 있습니다. 덮어쓸까요?', { title: '메모리 복사', ok: '덮어쓰기', danger: false })) r = await api.copyMemory({ src: m.file, destProjectDir: dest.dir, destProfile: dest.profile, overwrite: true }).catch((e) => ({ error: e.message }));
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
$('#btn-new').onclick = () => openNewSession();
function openNewSession(cwd) { // cwd: preset folder (the workspace view's "여기서 새 세션")
  $('#new-cwd').value = isAbs(cwd) ? cwd : isAbs(cur()?.cwd) ? cur().cwd : '';
  const ps = $('#new-profile');
  ps.replaceChildren(...S.profiles.map((p) => el('option', { value: p.id === 'default' ? '' : p.id, text: p.id === 'default' ? 'Claude (기본 · ~/.claude)' : `${p.name}${p.model ? ` · ${p.model}` : ''} (${shortPath(p.dir)})` })));
  ps.closest('label').hidden = S.profiles.length < 2; // one profile: nothing to choose
  let last = {};
  try { last = JSON.parse(localStorage.getItem('newSessionOpts') || '{}'); for (const [k, sel] of Object.entries(OPTS)) $(sel).value = last[k] || ''; } catch { /* no saved options */ }
  if (cur()?.profile && cur().profile !== 'default') ps.value = cur().profile; // follow the session you are looking at
  // a remembered model must not leak into another profile: `--model` would override that profile's own model
  if ((last.profile || '') !== ps.value) $('#new-model').value = '';
  modelHint();
  if (ps.value && isAnthropicModel($('#new-model').value)) $('#new-model').value = ''; // a Claude model name saved with a gateway profile (an older leak)
  dlg.showModal();
};
$('#new-pick').onclick = async () => { const d = await api.pickDir(); if (d) $('#new-cwd').value = d; };
// the model field is per profile: switching profiles clears it, the placeholder names what an empty field means, and the
// list offers that profile's models — the default profile's aliases (the datalist in index.html) or the other profile's
// settings.json model — plus the models its sessions have actually used (from the stats, fetched once per profile).
const seenModels = new Map(); // profile id → models seen in its transcripts, most used first
function applyModelOptions() {
  const id = $('#new-profile').value || 'default', inp = $('#new-model'), p = S.profiles.find((x) => x.id === id);
  if (!inp.__aliases) inp.__aliases = (inp.__opts || []).map((o) => o.value); // what select.js read from the datalist
  if (!seenModels.has(id)) {
    seenModels.set(id, []);
    api.globalStats({ profile: id }).then((g) => { seenModels.set(id, Object.entries(g.byModel || {}).filter(([m]) => m !== '<synthetic>').sort((a, b) => b[1].output - a[1].output).map(([m]) => m)); if (($('#new-profile').value || 'default') === id) applyModelOptions(); }).catch(() => {});
  }
  const base = id === 'default' ? inp.__aliases : [p?.model].filter(Boolean);
  inp.__opts = [...new Set([...base, ...seenModels.get(id)])].map((v) => ({ value: v, text: v }));
}
const isAnthropicModel = (m) => !!m && (/^claude-/.test(m) || ($('#new-model').__aliases || []).includes(m));
function modelHint() {
  const id = $('#new-profile').value || 'default', p = S.profiles.find((x) => x.id === id), other = id !== 'default';
  $('#new-model').placeholder = other ? `비워 두면 프로파일 모델 (${p?.model || '설정값'})` : '기본값 (settings.json)';
  applyModelOptions();
  // effort is an Anthropic-model setting (thinking budget): meaningless for a gateway profile's model, so it is left off
  const eff = $('#new-effort'); eff.disabled = other; if (other) eff.value = '';
  eff.closest('label').classList.toggle('off', other);
  eff.closest('label').title = other ? `${p?.model || '이 프로파일의 모델'}에는 effort 설정이 적용되지 않습니다` : '';
}
$('#new-profile').onchange = () => { $('#new-model').value = ''; modelHint(); };
dlg.onclose = async () => {
  if (dlg.returnValue !== 'ok') return;
  const cwd = $('#new-cwd').value, name = $('#new-name').value.trim(), prompt = $('#new-prompt').value.trim();
  if (!cwd) return alert('작업 폴더를 선택하세요');
  const { mode, ...opts } = readOpts();
  try { localStorage.setItem('newSessionOpts', JSON.stringify({ ...opts, mode })); } catch { /* fine */ }
  if (mode === 'chat') { newChatTab({ cwd, name, prompt, opts }); return; }
  // instant feedback: a placeholder tab while `claude --bg` boots the worker (≈1–3 s), swapped for the real session
  const ph = { sessionId: 'starting-' + Date.now(), local: true, starting: true, name: name || baseName(cwd), cwd, profile: opts.profile || 'default' };
  S.local.push(ph); S.tab = 'terminal'; openSession(ph.sessionId);
  const dropPlaceholder = (replaceWith) => { const i = S.tabs.indexOf(ph.sessionId); S.local = S.local.filter((x) => x !== ph); if (replaceWith && i !== -1 && !S.tabs.includes(replaceWith)) S.tabs[i] = replaceWith; else S.tabs = S.tabs.filter((x) => x !== ph.sessionId); if (S.sel === ph.sessionId) S.sel = replaceWith || S.tabs[0] || null; }; // the session may already be a tab (opened from the list meanwhile)
  const r = await api.newSession({ cwd, name, prompt, ...opts }).catch((e) => ({ ok: false, output: e.message }));
  if (r.ok) {
    await loadSessions();
    const s = S.sessions.find((x) => x.short === r.id);
    dropPlaceholder(s?.sessionId);
    if (s) { S.tab = 'terminal'; openSession(s.sessionId); } else { renderSessionList(); renderTabs(); renderDetail(); }
    return;
  }
  dropPlaceholder(); renderSessionList(); renderTabs(); renderDetail();
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
    ...(S.group?.includes(s.sessionId) ? [item('나란히 보기에서 빼기', () => dropSplit(s.sessionId)), item('나란히 보기 끄기 (전체)', () => setGroup(null))]
      : S.group ? [S.group.length < SPLIT_MAX ? item(`나란히 보기에 추가 (${S.group.length + 1}번 창)`, () => addSplit(s.sessionId)) : null]
      : [s.sessionId !== S.sel && cur() ? item('오른쪽에 나란히 보기', () => addSplit(s.sessionId)) : null]),
    el('div', { class: 'sep' }),
    s.local ? null : item('이름 변경…', () => renameFlow(s)),
    bg && s.live && typeof ccmyAutoOn === 'function' ? (ccmyAutoOn(s.sessionId) ? item('CCMy 이어서 진행 끄기', () => ccmyAutoOff(s.sessionId, '사용자가 껐습니다')) : item('CCMy 이어서 진행…', () => ccmyAutoStart(s))) : null,
    needsInput(s) ? item('입력 대기 해제 (답할 필요 없음)', () => setNeedsOff([s.sessionId])) : s.sessionId in needsOff ? item('입력 대기 다시 표시', () => setNeedsOff([s.sessionId], false)) : null,
    s.job ? item(s.pinned ? '핀 해제' : '핀 고정 (맨 위로)', () => api.setPinned(s.short, !s.pinned, s.profile).then(loadSessions)) : null,
    bg && s.live ? item('중지', () => act('stop', s)) : null,
    bg ? item('재시작 (respawn)', () => act('respawn', s)) : null,
    el('div', { class: 'sep' }),
    S.tabs.includes(s.sessionId) ? item('탭 닫기', () => closeTab(s.sessionId)) : null,
    s.local || (s.live && !bg) ? null : item(bg ? '세션 삭제… (대화 기록은 유지)' : '트랜스크립트 삭제…', () => deleteFlow(s), 'danger'),
    bg && s.file && !s.local ? item('완전 삭제… (세션 + 대화 기록)', () => deleteFlow(s, { purge: true }), 'danger') : null,
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
    setTimeout(async () => { await loadSessions(); if (S.view === 'workspace' && typeof renderWorkspace === 'function' && WS.data) renderWorkspace({ still: true }); }, 800); // the card line follows the new name
  };
  dlgRename.showModal();
  $('#rename-name').select();
}
// in-app confirm: native confirm() looks foreign and can leave the window without keyboard focus on macOS. 취소 is the first
// (default) button, so Enter never confirms by accident; only the 확인 button resolves true (Esc, 취소, backdrop → false)
function askConfirm(body, { title = '확인', ok = '확인', danger = true, notice = false } = {}) { // notice: just a report, 확인 only
  const d = $('#dlg-confirm'), b = $('#confirm-ok'), c = $('#confirm-cancel');
  $('#confirm-title').textContent = title; $('#confirm-body').textContent = body; b.textContent = ok; b.classList.toggle('danger', danger); c.hidden = notice;
  return new Promise((res) => { d.onclose = () => res(d.returnValue === 'ok'); d.returnValue = ''; d.showModal(); (notice ? b : c).focus(); });
}
async function deleteFlow(s, { purge = false } = {}) {
  if (s.kind === 'background') {
    const what = purge ? '세션과 대화 기록(트랜스크립트)을 모두 영구 삭제할까요?\n이 세션은 더 이상 이어갈 수 없습니다.' : '백그라운드 세션을 삭제할까요?\n대화 기록(트랜스크립트)은 남아 「트랜스크립트만」 그룹에서 다시 이어갈 수 있습니다.';
    if (!(await askConfirm(`"${s.name}" ${s.live ? '(실행 중이라 먼저 중지합니다) ' : ''}${what}`, { title: purge ? '완전 삭제' : '세션 삭제', ok: '삭제' }))) return;
    if (s.live) await api.agentAction('stop', s.short, s.profile);
    const r = await api.agentAction('rm', s.short, s.profile);
    if (!r.ok) { alert(r.output || 'rm 실패'); return; }
    if (purge && s.file) await api.deleteTranscript({ sessionId: s.sessionId, projectDir: s.projectDir, profile: s.profile }).catch((e) => alert(e.message));
  } else {
    if (!(await askConfirm(`"${s.name}" 의 트랜스크립트(${fmtBytes(s.size)})를 영구 삭제할까요?\n이 세션은 더 이상 이어갈 수 없습니다.`, { title: '트랜스크립트 삭제', ok: '삭제' }))) return;
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
      el('div', { class: 'msg', text: `사용량 캐시 ${u.fetchedAt ? fmtAgo(u.fetchedAt) + ' 갱신' : ''} · ${u.source === 'app' ? '앱이 직접 조회' : u.source === 'statusline' ? 'Claude Code 상태줄 캐시' : 'Claude Code가 세션 중에 갱신합니다'}` })) : el('div', { class: 'msg', text: '사용량 캐시 없음' }),
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
  else if (action === 'split') toggleSplit();
  else if (action === 'splitFocus') focusSplit(arg);
  else if (action === 'splitSwap') swapSplit();
  else if (action === 'splitLayout') { if (groupShown() && S.group.length === 3) toggleLayout(); }
  else if (action === 'keys') showKeys();
  else if (action === 'shell') { if (S.view !== 'sessions') setView('sessions'); if (cur()) toggleShell(); }
});
document.addEventListener('keydown', (e) => {
  if (e.altKey && !e.metaKey && !e.ctrlKey && /^Digit[0-9]$/.test(e.code)) { e.preventDefault(); selectTabN(Number(e.code.slice(5))); }
}, true);

// ---------- live updates ----------
api.onSessionsChanged(loadSessions);
api.onMemoryChanged(() => { S.memory = null; if (S.view === 'memory') loadMemory(); });
$('#btn-refresh').onclick = () => { S.memory = null; loadSessions(); if (S.view === 'memory') loadMemory(); };
// ---------- 단축키 안내: the menu's own table (main.js SHORTCUTS) plus the few keys handled in the page ----------
const accLabel = (a) => a.split('+').map((k) => (isMac ? { CmdOrCtrl: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Left: '←', Right: '→' } : { CmdOrCtrl: 'Ctrl', Left: '←', Right: '→' })[k] || k).join(isMac ? '' : '+');
function showKeys() {
  const rows = [...api.shortcuts.filter((k) => !/^[2-9]번째 탭$/.test(k.label)).map((k) => (/^1번째 탭$/.test(k.label) ? { ...k, label: '1 ~ 9번째 탭', acc: k.acc.replace(/1$/, '1…9') } : k)),
    { group: '세션 · 탭', label: '1 ~ 9번째 탭 (다른 방법)', acc: 'Alt+1…9' }, { group: '기타', label: '세션 화면으로 돌아가기 · 메뉴 닫기', acc: 'Esc' }, { group: '기타', label: '대화상자 확인', acc: 'Enter' }];
  const groups = [...new Set(rows.map((r) => r.group))];
  $('#keys-body').replaceChildren(...groups.flatMap((g) => [el('h4', { text: g }), el('div', { class: 'keys-grid' }, ...rows.filter((r) => r.group === g).flatMap((r) => [el('span', { text: r.label }), el('kbd', { text: accLabel(r.acc) })]))]),
    el('p', { class: 'hint', text: '터미널에 포커스가 있어도 동작합니다. 같은 목록이 상단 메뉴 「탭」에도 있습니다.' }));
  $('#dlg-keys').showModal();
}
$('#btn-keys').onclick = showKeys;
const gearMenu = $('#gear-menu'); // hover menu like 세션 ▾: a click on an item shuts it until the pointer leaves
$('#app-ver').textContent = api.appVersion;
// ---------- app update: a GitHub Release newer than this build puts a button in the header; a click downloads this machine's
// installer into ~/Downloads and opens it (the user drags the app over the installed one). 톱니 메뉴 → 업데이트 확인 asks now. ----------
let UPD = null;
function showUpdate(info) {
  UPD = info; const b = $('#btn-update');
  if (!info || !info.newer) { b.hidden = true; return; }
  b.hidden = false; b.textContent = `업데이트 v${info.version}`;
  b.dataset.tip = `${info.name || info.tag}${info.publishedAt ? ` · ${fmtLocalDate(info.publishedAt)}` : ''}\n${info.asset ? `누르면 ${info.asset.name}을(를) 내려받아 엽니다` : '이 플랫폼용 파일이 없어 릴리스 페이지를 엽니다'}${info.notes ? `\n\n${info.notes.slice(0, 400)}` : ''}`;
}
api.onUpdate(showUpdate);
api.onUpdateProgress(({ got, total }) => { $('#btn-update').textContent = total ? `내려받는 중 ${Math.round(got / total * 100)}%` : `내려받는 중 ${fmtBytes(got)}`; });
async function downloadUpdateFlow() {
  const b = $('#btn-update');
  if (!UPD?.asset) { api.openReleasePage(UPD?.url); return; }
  b.hidden = false; b.disabled = true; const r = await api.downloadUpdate(); b.disabled = false; b.textContent = `업데이트 v${UPD.version}`;
  if (r?.error) { askConfirm(`내려받기 실패: ${r.error}`, { title: '업데이트', ok: '확인', notice: true }); return; }
  if (r.auto) { // macOS: the app closes itself, swaps the bundle and reopens
    if (!await askConfirm(`앱을 닫고 v${UPD.version}을 설치한 뒤 다시 엽니다. 10초쯤 걸립니다.\n\n열어 둔 탭은 그대로 돌아오고, 백그라운드 세션은 계속 실행됩니다. 셸 패널과 챗 세션은 닫힙니다.`, { title: `v${UPD.version} 설치`, ok: '설치하고 다시 시작', danger: false })) return;
    b.disabled = true; b.textContent = '설치하는 중…';
    const i = await api.installUpdate(r.file);
    if (i?.error) { b.disabled = false; b.textContent = `업데이트 v${UPD.version}`; askConfirm(`설치 실패: ${i.error}\n\n${r.file} 을 직접 열어 설치해 주세요.`, { title: '업데이트', ok: '확인', notice: true }); }
    return;
  }
  askConfirm(`${r.file}\n\n열린 설치 이미지의 앱을 /Applications에 끌어 넣어 덮어쓴 뒤 이 앱을 다시 실행하면 v${UPD.version}입니다. 열어 둔 탭과 세션은 그대로입니다.`, { title: `v${UPD.version} 내려받음`, ok: '확인', danger: false, notice: true });
}
$('#btn-update').onclick = downloadUpdateFlow;
// the version labels (톱니 메뉴 footer, 세션 flyout bar) are the check buttons: a click asks GitHub now and writes the verdict
// beside the version — 최신, 릴리스 없음, or "vX 있음" with a 내려받기 button (the header button appears too)
function renderCheckResult(statusEl, r) {
  if (!r || r.error) { statusEl.replaceChildren(`· 확인 실패${r?.error ? ` (${r.error})` : ''}`); return; }
  showUpdate(r);
  if (!r.newer) { statusEl.replaceChildren(r.none ? '· 게시된 릴리스 없음' : `· 최신 (릴리스 ${r.tag})`); return; }
  statusEl.replaceChildren(`· v${r.version} 있음 `, el('button', { class: 'chk', text: '내려받기', 'data-tip': r.asset ? `${r.asset.name}을(를) ~/Downloads에 받아 엽니다` : '릴리스 페이지를 엽니다', onclick: downloadUpdateFlow }));
}
async function checkUpdateInline(statusEl) { statusEl.replaceChildren('· 확인 중…'); renderCheckResult(statusEl, await api.checkUpdate(true)); }
$('#ver-row').onclick = () => checkUpdateInline($('#ver-status'));
gearMenu.querySelector('.gear-pop').addEventListener('click', (e) => { if (e.target.closest('button')) { gearMenu.classList.remove('open'); gearMenu.classList.add('closed'); } });
gearMenu.onmouseleave = () => gearMenu.classList.remove('closed', 'open');
$('#btn-gear').onclick = () => { gearMenu.classList.remove('closed'); gearMenu.classList.toggle('open'); };

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
