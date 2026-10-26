'use strict';
/* global $, el, S, api, fmtN, fmtTok, fmtAgo, shortPath, openSession, openNewSession, WORKTREE_RE, sessionDir, sessionRow, profileBadge, isAbs */
// 워크스페이스 view: the folders under one or more root dirs (default ~/workspace), one level of categories, repos as
// cards joined with the sessions that run in them: counts by state, the latest session's summary, branch, memory, tokens.

const WS = { roots: null, open: new Set(), data: null };
const wsRoots = () => { if (!WS.roots) { try { WS.roots = JSON.parse(localStorage.getItem('wsRoots') || 'null'); } catch { WS.roots = null; } if (!Array.isArray(WS.roots) || !WS.roots.length) WS.roots = [`${api.home}${api.sep}workspace`]; } return WS.roots; };
const saveRoots = () => { try { localStorage.setItem('wsRoots', JSON.stringify(WS.roots)); } catch { /* fine */ } };
const under = (p, dir) => p === dir || p.startsWith(dir + api.sep);
// a session belongs to the deepest repo whose path contains its working dir (worktrees count for their parent repo)
const sessionHome = (s) => { const d = sessionDir(s) || ''; const m = WORKTREE_RE.exec(d); return m ? m[1] : d; };

async function loadWorkspace() {
  const pane = $('#workspace-detail');
  if (!WS.data) pane.replaceChildren(el('div', { class: 'empty', text: '폴더를 읽는 중…' }));
  const roots = wsRoots();
  const [trees, projects, stats] = await Promise.all([Promise.all(roots.map((r) => api.scanWorkspace(r).catch(() => ({ root: r, entries: [] })))), api.listProjects().catch(() => []), api.globalStats({}).catch(() => null)]);
  WS.data = { trees, projects, stats };
  renderWorkspace();
}

function renderWorkspace() {
  const pane = $('#workspace-detail'), { trees, projects, stats } = WS.data;
  // every folder is a possible home: repos, category dirs (sessions may run right in them) and their subdirs
  const targets = [];
  for (const t of trees) for (const e of t.entries) { targets.push({ ...e, root: t.root }); for (const k of e.children || []) targets.push({ ...k, cat: e, root: t.root }); }
  targets.sort((a, b) => b.path.length - a.path.length); // deepest first
  const bySessions = new Map(targets.map((r) => [r.path, []])), other = [];
  for (const s of S.sessions) { const home = sessionHome(s); const r = home && targets.find((x) => under(home, x.path)); if (r) bySessions.get(r.path).push(s); else other.push(s); }
  const memByCwd = new Map(); for (const p of projects) memByCwd.set(p.cwd, (memByCwd.get(p.cwd) || 0) + p.memoryCount); // profiles may share a cwd
  const tokByCwd = new Map(Object.values(stats?.byProject || {}).map((p) => [p.cwd, p.tokens?.output || 0]));
  const ctx = { bySessions, memByCwd, tokByCwd };
  const bar = el('div', { class: 'ws-bar' },
    el('span', { class: 'msg', text: '루트 폴더' }),
    ...wsRoots().map((r) => el('span', { class: 'ws-root' }, el('span', { text: shortPath(r) }), wsRoots().length > 1 ? el('button', { class: 'x', text: '×', 'data-tip': '이 루트 제외', onclick: () => { WS.roots = WS.roots.filter((x) => x !== r); saveRoots(); WS.data = null; loadWorkspace(); } }) : null)),
    el('button', { text: '루트 추가…', onclick: async () => { const d = await api.pickDir(); if (d && !WS.roots.includes(d)) { WS.roots.push(d); saveRoots(); WS.data = null; loadWorkspace(); } } }),
    el('button', { text: '루트 변경…', onclick: async () => { const d = await api.pickDir(); if (d) { WS.roots = [d]; saveRoots(); WS.data = null; loadWorkspace(); } } }),
    el('span', { class: 'spacer' }),
    el('span', { class: 'msg' }, '폴더 ', countEl(targets.length), ' · 세션 ', countEl(S.sessions.length), ` (루트 밖 ${fmtN(other.length)})`),
    el('button', { text: '↻', 'data-tip': '다시 읽기', onclick: () => { WS.data = null; loadWorkspace(); } }));
  const sections = [], idle = [];
  for (const t of trees) {
    const rootRepos = t.entries.filter((e) => e.kind === 'repo');
    if (rootRepos.length) sections.push(section(shortPath(t.root), t.root, rootRepos, ctx));
    for (const e of t.entries) {
      if (e.kind !== 'dir') continue;
      const own = bySessions.get(e.path) || [], kids = e.children || [];
      const n = own.length + kids.reduce((a, k) => a + (bySessions.get(k.path) || []).length, 0);
      if (!n && !WS.showEmpty?.has(e.path)) { idle.push(e); continue; } // nothing runs here: one chip at the bottom instead of a section
      // sessions that run in the category folder itself get a card of their own at the front
      const entries = own.length ? [{ name: `${e.name} (이 폴더)`, path: e.path, kind: 'self' }, ...kids] : kids;
      sections.push(section(e.name, e.path, entries, ctx));
    }
  }
  if (other.length) sections.push(section('기타 · 루트 밖', null, groupOther(other), ctx, true));
  if (idle.length) sections.push(el('div', { class: 'ws-cat ws-idle' },
    el('h3', {}, '세션 없는 폴더', el('span', { class: 'msg', text: ` · ${fmtN(idle.length)}개 · 누르면 펼침` })),
    el('div', { class: 'ws-chips' }, ...idle.map((e) => el('button', { class: 'ws-chip', text: e.name, 'data-tip': `${e.path}\n하위 폴더 ${(e.children || []).length}개`, onclick: () => { (WS.showEmpty ||= new Set()).add(e.path); renderWorkspace(); } })))));
  pane.replaceChildren(el('div', { class: 'ws-glow', 'aria-hidden': 'true' }), bar, ...sections.map((sec, i) => { sec.style.setProperty('--i', i); return sec; }));
  pane.onscroll = () => pane.style.setProperty('--py', `${pane.scrollTop * 0.25}px`); // parallax: the glow drifts at a quarter of the scroll
  requestAnimationFrame(() => pane.querySelectorAll('.ws-summary').forEach(marquee));
}
// numbers roll up from 0 (stats.js countUp), text that is cut off drifts sideways by exactly its overflow
function countEl(n) { const e = el('b', { class: 'ws-count', text: '0' }); requestAnimationFrame(() => wsCountUp(e, n, 600)); return e; }
function wsCountUp(node, to, ms) { // own copy: stats.js (which has countUp) loads after this file
  if (!to || matchMedia('(prefers-reduced-motion: reduce)').matches) { node.textContent = fmtN(to || 0); return; }
  const t0 = performance.now();
  const step = (t) => { const p = Math.min(1, (t - t0) / ms), e = 1 - (1 - p) ** 3; node.textContent = fmtN(Math.round(to * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function marquee(e) { const over = e.scrollWidth - e.clientWidth; if (over > 8) { e.style.setProperty('--shift', `-${over}px`); e.style.setProperty('--dur', `${Math.max(6, over / 25)}s`); e.classList.add('marquee'); } }
// sessions outside every root, grouped by their own folder, as pseudo-repos
function groupOther(sessions) {
  const by = new Map();
  for (const s of sessions) { const d = sessionHome(s) || '(폴더 없음)'; if (!by.has(d)) by.set(d, { name: shortPath(d), path: d, kind: 'repo', sessions: [] }); by.get(d).sessions.push(s); }
  return [...by.values()].sort((a, b) => Math.max(...b.sessions.map((s) => s.lastActivity)) - Math.max(...a.sessions.map((s) => s.lastActivity)));
}
function section(title, dir, entries, ctx, pseudo = false) {
  const cards = entries.map((e) => { const ss = pseudo ? e.sessions : (ctx.bySessions.get(e.path) || []); return { e, ss, last: ss.reduce((m, s) => Math.max(m, s.lastActivity || 0), 0) }; })
    .sort((a, b) => (b.ss.length ? 1 : 0) - (a.ss.length ? 1 : 0) || b.last - a.last || a.e.name.localeCompare(b.e.name));
  const live = cards.reduce((n, c) => n + c.ss.filter((s) => s.live).length, 0), total = cards.reduce((n, c) => n + c.ss.length, 0);
  return el('div', { class: 'ws-cat' },
    el('h3', {}, title, el('span', { class: 'msg', text: ` · 폴더 ${fmtN(cards.length)} · 세션 ${fmtN(total)}${live ? ` · 실행 중 ${live}` : ''}` }), dir ? el('span', { class: 'msg ws-path', text: dir }) : null),
    el('div', { class: 'ws-grid' }, ...cards.map((c, i) => { const k = card(c.e, c.ss, ctx.memByCwd, ctx.tokByCwd); k.style.setProperty('--i', i); return k; })));
}
const stateOf = (s) => (s.job?.needs || s.state === 'blocked') ? 'blocked' : (s.state === 'working' || s.status === 'busy') ? 'working' : s.live ? 'idle' : 'off';
function card(e, ss, memByCwd, tokByCwd) {
  const open = WS.open.has(e.path);
  const needs = ss.filter((s) => stateOf(s) === 'blocked').length, working = ss.filter((s) => stateOf(s) === 'working').length, live = ss.filter((s) => s.live).length;
  const latest = [...ss].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
  const summary = latest ? (latest.job?.needs || latest.job?.detail || latest.lastPrompt || latest.job?.intent || '') : '';
  const mem = memByCwd.get(e.path) || 0, tok = tokByCwd.get(e.path) || 0;
  const dot = el('span', { class: `glyph ${needs ? 'blocked' : working ? 'working' : live ? 'idle' : 'off'} ${live ? 'live' : 'off'}` });
  const head = el('div', { class: 'ws-head', onclick: () => { if (open) WS.open.delete(e.path); else WS.open.add(e.path); renderWorkspace(); } },
    dot, el('b', { class: 'ws-name', text: e.name, title: e.path }),
    e.kind === 'dir' ? el('span', { class: 'pbadge', text: '폴더' }) : null,
    el('span', { class: 'spacer' }),
    ss.length ? el('span', { class: 'ws-counts', 'data-tip': `세션 ${ss.length} · 실행 중 ${live} · 작업 중 ${working} · 입력 대기 ${needs}` }, countEl(ss.length), working ? el('b', { class: 'w', text: ` ●${working}` }) : null, needs ? el('b', { class: 'n', text: ` !${needs}` }) : null) : el('span', { class: 'msg', text: '세션 없음' }),
    el('span', { class: 'ws-chev', text: open ? '▾' : '▸' }));
  const branch = el('span', { class: 'ws-branch', text: '' });
  if (e.kind !== 'dir') api.gitInfo(e.path).then((g) => { if (g) { branch.textContent = g.branch + (g.dirty ? '*' : ''); branch.classList.toggle('dirty', g.dirty); } }).catch(() => {});
  const meta = el('div', { class: 'ws-meta' }, branch,
    latest ? el('span', { text: fmtAgo(latest.lastActivity) }) : null,
    mem ? el('span', { text: `메모리 ${fmtN(mem)}` }) : null,
    tok ? el('span', { text: `출력 ${fmtTok(tok)}` }) : null);
  const body = open ? el('div', { class: 'ws-body' },
    ...ss.sort((a, b) => (b.live - a.live) || ((b.lastActivity || 0) - (a.lastActivity || 0))).map((s) => sessionRow(s)),
    el('div', { class: 'ws-actions' }, el('button', { text: '＋ 여기서 새 세션', onclick: () => { setView('sessions'); openNewSession(e.path); } }))) : null;
  return el('div', { class: 'ws-card' + (ss.length ? '' : ' ws-empty') + (open ? ' open' : ''), 'data-path': e.path }, // not `.empty`: that is the centred placeholder style
    head, summary ? el('div', { class: 'ws-summary', text: summary, 'data-tip': `${latest.name}\n${summary}` }) : null, meta, body);
}
