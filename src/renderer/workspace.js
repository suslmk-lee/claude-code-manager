'use strict';
/* global $, el, S, api, fmtN, fmtTok, fmtAgo, shortPath, openSession, openNewSession, showCtx, askConfirm, loadSessions, WORKTREE_RE, sessionDir, sessionRow, profileBadge, isAbs */
// 워크스페이스 view: the folders under one or more root dirs (default ~/workspace), one level of categories, repos as
// cards joined with the sessions that run in them: counts by state, the latest session's summary, branch, memory, tokens.

const WS = { roots: null, open: new Set(), data: null };
const wsRoots = () => { if (!WS.roots) { try { WS.roots = JSON.parse(localStorage.getItem('wsRoots') || 'null'); } catch { WS.roots = null; } if (!Array.isArray(WS.roots) || !WS.roots.length) WS.roots = [`${api.home}${api.sep}workspace`]; } return WS.roots; };
const saveRoots = () => { try { localStorage.setItem('wsRoots', JSON.stringify(WS.roots)); } catch { /* fine */ } };
// pinned folders (paths): a ★ on a card head or a category heading toggles; they sort first in their grid and gather in a 핀 shelf at the top
const wsPins = () => { if (!WS.pins) { try { WS.pins = new Set(JSON.parse(localStorage.getItem('wsPins') || '[]')); } catch { WS.pins = new Set(); } } return WS.pins; };
const isPinned = (p) => wsPins().has(p);
function togglePin(p) { const pins = wsPins(); if (pins.has(p)) pins.delete(p); else pins.add(p); try { localStorage.setItem('wsPins', JSON.stringify([...pins])); } catch { /* fine */ } renderWorkspace({ still: true }); }
const pinBtn = (p) => el('button', { class: 'ws-pin' + (isPinned(p) ? ' on' : ''), text: isPinned(p) ? '★' : '☆', 'data-tip': isPinned(p) ? '핀 해제' : '핀 고정 (맨 위 핀 묶음에 표시)', onclick: (ev) => { ev.stopPropagation(); togglePin(p); } });
const under = (p, dir) => p === dir || p.startsWith(dir + api.sep);
// a session belongs to the deepest repo whose path contains its working dir (worktrees count for their parent repo)
// a session belongs to the folder it was launched in (not where it cd'ed to later — a worktree, a sub-repo); a worktree launch maps to its repo
const sessionHome = (s) => { const d = s.launchDir || sessionDir(s) || ''; const m = WORKTREE_RE.exec(d); return m ? m[1] : d; };

async function loadWorkspace() {
  const pane = $('#workspace-detail');
  // a cached view paints at once (sessions are live anyway); the rescan then updates it in place only if the disk changed —
  // otherwise the open would show the old view, then visibly redraw it with the entrance replayed
  const cached = !!WS.data;
  if (cached) renderWorkspace(); else pane.replaceChildren(el('div', { class: 'empty', text: '폴더를 읽는 중…' }));
  const roots = wsRoots();
  const [trees, projects, stats] = await Promise.all([Promise.all(roots.map((r) => api.scanWorkspace(r).catch(() => ({ root: r, entries: [] })))), api.listProjects().catch(() => []), api.globalStats({}).catch(() => null)]);
  const sig = (d) => JSON.stringify([d.trees, d.projects], (k, v) => (k === 'root' ? undefined : v)); // folders and memory counts (renderWorkspace tags entries with `root`: ignore it); token figures move constantly and are patched in place instead
  const fresh = { trees, projects, stats };
  if (cached && sig(fresh) === sig(WS.data)) { WS.data = fresh; refreshTokens(); return; }
  WS.data = fresh;
  renderWorkspace({ still: cached });
}

function refreshTokens() { // the 출력 figure on each card, without a re-render
  const tok = new Map(Object.values(WS.data?.stats?.byProject || {}).map((p) => [p.cwd, p.tokens?.output || 0]));
  for (const c of document.querySelectorAll('#workspace-detail .ws-card[data-path]')) { const t = tok.get(c.dataset.path); const sp = [...c.querySelectorAll('.ws-meta span')].find((x) => x.textContent.startsWith('출력 ')); if (sp && t) sp.textContent = `출력 ${fmtTok(t)}`; }
}
function renderWorkspace({ still = false } = {}) { // still: refresh in place (after a rename) without replaying the entrance animation
  const pane = $('#workspace-detail'), { trees, projects, stats } = WS.data;
  pane.classList.toggle('ws-still', still);
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
    el('button', { text: '↻', 'data-tip': '다시 읽기', onclick: () => { WS.data = null; loadWorkspace(); } }),
    viewCloseBtn());
  const sections = [], idle = [];
  const pinned = [...wsPins()].map((p) => targets.find((x) => x.path === p)).filter(Boolean);
  if (pinned.length) { const sec = wsSection(`핀 ${fmtN(pinned.length)}`, null, pinned, ctx); sec.classList.add('ws-pinned'); sections.push(sec); }
  for (const t of trees) {
    const rootRepos = t.entries.filter((e) => e.kind === 'repo');
    if (rootRepos.length) sections.push(wsSection(shortPath(t.root), t.root, rootRepos, ctx));
    for (const e of t.entries) {
      if (e.kind !== 'dir') continue;
      const own = bySessions.get(e.path) || [], kids = e.children || [];
      const n = own.length + kids.reduce((a, k) => a + (bySessions.get(k.path) || []).length, 0);
      if (!n && !WS.showEmpty?.has(e.path)) { idle.push(e); continue; } // nothing runs here: one chip at the bottom instead of a section
      e.root = t.root; sections.push(wsCategory(e, own, kids, ctx));
    }
  }
  if (other.length) sections.push(wsSection('기타 · 루트 밖', null, groupOther(other), ctx, true));
  if (idle.length) sections.push(el('div', { class: 'ws-cat ws-idle' },
    el('h3', {}, '세션 없는 폴더', el('span', { class: 'msg', text: ` · ${fmtN(idle.length)}개 · 누르면 펼침` })),
    el('div', { class: 'ws-chips' }, ...idle.map((e) => el('button', { class: 'ws-chip', text: e.name, 'data-tip': `${e.path}\n하위 폴더 ${(e.children || []).length}개\n우클릭: 폴더 이동…`, onclick: () => { (WS.showEmpty ||= new Set()).add(e.path); renderWorkspace(); }, oncontextmenu: (ev) => { ev.preventDefault(); moveFlow(e.path); } })))));
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
function wsSection(title, dir, entries, ctx, pseudo = false) {
  const cards = entries.map((e) => { const ss = pseudo ? e.sessions : (ctx.bySessions.get(e.path) || []); return { e, ss, last: ss.reduce((m, s) => Math.max(m, s.lastActivity || 0), 0) }; })
    .sort((a, b) => (isPinned(b.e.path) ? 1 : 0) - (isPinned(a.e.path) ? 1 : 0) || (b.ss.length ? 1 : 0) - (a.ss.length ? 1 : 0) || b.last - a.last || a.e.name.localeCompare(b.e.name));
  const live = cards.reduce((n, c) => n + c.ss.filter((s) => s.live).length, 0), total = cards.reduce((n, c) => n + c.ss.length, 0);
  return el('div', { class: 'ws-cat', style: `--cat:${catColor(title)}` },
    el('h3', { class: 'ws-cat-title' }, folderIcon(), el('span', { class: 'ws-cat-name', text: title, 'data-tip': dir || null }), el('span', { class: 'msg', text: ` · 폴더 ${fmtN(cards.length)} · 세션 ${fmtN(total)}${live ? ` · 실행 중 ${live}` : ''}` })),
    el('div', { class: 'ws-grid' }, ...cards.map((c, i) => { const k = wsCard(c.e, c.ss, ctx.memByCwd, ctx.tokByCwd); k.style.setProperty('--i', i); return k; })));
}
// a category folder: its own card (sessions running right in it) and its subfolders folded into one line — subfolders
// with sessions are named there; opening lists them as cards, the empty ones as chips, inside an indented rail
function wsCategory(e, own, kids, ctx) {
  const withS = kids.map((k) => ({ k, ss: ctx.bySessions.get(k.path) || [] })).filter((x) => x.ss.length).sort((a, b) => Math.max(...b.ss.map((s) => s.lastActivity || 0)) - Math.max(...a.ss.map((s) => s.lastActivity || 0)));
  const empty = kids.filter((k) => !(ctx.bySessions.get(k.path) || []).length);
  const subN = withS.reduce((n, x) => n + x.ss.length, 0), live = withS.reduce((n, x) => n + x.ss.filter((s) => s.live).length, 0);
  const open = WS.subOpen?.has(e.path);
  let node; // this block; the tile swaps it for a fresh one instead of re-rendering the whole view
  const flip = () => { (WS.subOpen ||= new Set()); if (open) WS.subOpen.delete(e.path); else WS.subOpen.add(e.path); const fresh = wsCategory(e, own, kids, ctx); fresh.style.animation = 'none'; slideLayout(() => node.replaceWith(fresh)); };
  // a square tile beside the folder's own card: subfolder count, their sessions, the active ones by name; click = expand below
  const toggle = kids.length ? el('div', { class: 'ws-tile glass' + (open ? ' open' : '') + (subN ? '' : ' quiet'), onclick: flip, 'data-tip': `${e.name} 하위 폴더 ${kids.length}개${subN ? ` · 세션 ${subN}` : ' · 세션 없음'} · 누르면 ${open ? '접기' : '펼치기'}` },
    el('div', { class: 'ws-tile-top' }, el('b', { class: 'n', text: fmtN(kids.length) }), el('span', { class: 'l', text: '하위 폴더' })),
    subN ? el('div', { class: 'ws-tile-mid' }, el('span', { class: `glyph ${live ? 'idle' : 'off'} ${live ? 'live' : 'off'}` }), `세션 ${fmtN(subN)}${live ? ` · 실행 ${live}` : ''}`) : el('div', { class: 'ws-tile-mid l', text: '세션 없음' }),
    el('div', { class: 'ws-tile-names' }, ...withS.slice(0, 2).map((x) => el('span', { text: `${x.k.name} ${x.ss.length}` })), withS.length > 2 ? el('span', { class: 'l', text: `외 ${withS.length - 2}` }) : null),
    el('span', { class: 'ws-tile-chev', text: open ? '▾' : '▸' })) : null;
  const sub = open ? el('div', { class: 'ws-sub' },
    withS.length ? el('div', { class: 'ws-grid' }, ...withS.map((x, i) => { const c = wsCard(x.k, x.ss, ctx.memByCwd, ctx.tokByCwd); c.style.setProperty('--i', i); return c; })) : null,
    empty.length ? el('div', { class: 'ws-chips' }, ...empty.map((k) => el('button', { class: 'ws-chip', 'data-tip': `${k.path}${k.kind === 'dir' ? '\n(저장소 표식 없음)' : ''}\n우클릭: 폴더 이동…`, onclick: () => { setView('sessions'); openNewSession(k.path); }, oncontextmenu: (ev) => { ev.preventDefault(); moveFlow(k.path); } }, k.name, el('span', { class: 'ws-chip-branch', 'data-path': k.path })))) : null) : null;
  if (sub) sub.querySelectorAll('.ws-chip-branch').forEach((b) => api.gitInfo(b.dataset.path).then((g) => { if (g) b.textContent = ` ${g.branch}${g.dirty ? '*' : ''}`; }).catch(() => {}));
  // the folder's own card is titled by its latest session, not by the folder (the heading already says that)
  const latestOwn = [...own].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
  const ownCard = own.length ? wsCard({ name: latestOwn.name, path: e.path, kind: 'self' }, own, ctx.memByCwd, ctx.tokByCwd) : null;
  node = el('div', { class: 'ws-cat', style: `--cat:${catColor(e.name)}` },
    el('h3', { class: 'ws-cat-title' }, folderIcon(), wsRoots().length > 1 ? el('span', { class: 'msg', text: `${shortPath(e.root)}${api.sep}` }) : null, el('span', { class: 'ws-cat-name', text: e.name, 'data-tip': e.path }), el('span', { class: 'msg', text: ` · 세션 ${fmtN(own.length + subN)}` }), pinBtn(e.path)),
    el('div', { class: 'ws-own-row' }, ownCard, toggle), sub);
  return node;
}
// each category gets a stable colour from its name: the icon, the own card's edge and the tile's number share it
const catColor = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 58% 62%)`; };
const folderIcon = () => { const w = document.createElement('span'); w.className = 'ws-cat-ico'; w.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>'; return w; };
const stateOf = (s) => (s.job?.needs || s.state === 'blocked') ? 'blocked' : (s.state === 'working' || s.status === 'busy') ? 'working' : s.live ? 'idle' : 'off';
function wsCard(e, ss, memByCwd, tokByCwd) {
  const open = WS.open.has(e.path);
  const needs = ss.filter((s) => stateOf(s) === 'blocked').length, working = ss.filter((s) => stateOf(s) === 'working').length, live = ss.filter((s) => s.live).length;
  const latest = [...ss].sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))[0];
  const summary = latest && latest.name !== e.name ? latest.name : ''; // the session's own name (as in the session list); the own card is titled by it already
  const detail = latest ? (latest.job?.needs || latest.job?.detail || latest.lastPrompt || latest.job?.intent || '') : '';
  const mem = memByCwd.get(e.path) || 0, tok = tokByCwd.get(e.path) || 0;
  const dot = el('span', { class: `glyph ${needs ? 'blocked' : working ? 'working' : live ? 'idle' : 'off'} ${live ? 'live' : 'off'}` });
  let node;
  const head = el('div', { class: 'ws-head', onclick: () => { if (open) WS.open.delete(e.path); else WS.open.add(e.path); const fresh = wsCard(e, ss, memByCwd, tokByCwd); fresh.style.animation = 'none'; slideLayout(() => node.replaceWith(fresh)); requestAnimationFrame(() => fresh.querySelectorAll('.ws-summary').forEach(marquee)); } },
    dot, el('b', { class: 'ws-name', text: e.name, title: e.path }),
    e.kind === 'dir' ? el('span', { class: 'pbadge', text: '폴더' }) : null,
    el('span', { class: 'spacer' }),
    ss.length ? el('span', { class: 'ws-counts', 'data-tip': `세션 ${ss.length} · 실행 중 ${live} · 작업 중 ${working} · 입력 대기 ${needs}` }, countEl(ss.length), working ? el('b', { class: 'w', text: ` ●${working}` }) : null, needs ? el('b', { class: 'n', text: ` !${needs}` }) : null) : el('span', { class: 'msg', text: '세션 없음' }),
    /^([A-Za-z]:)?[\\/]/.test(e.path) ? pinBtn(e.path) : null, el('span', { class: 'ws-chev', text: open ? '▾' : '▸' }));
  const branch = el('span', { class: 'ws-branch', text: '' });
  if (e.kind !== 'dir') api.gitInfo(e.path).then((g) => { if (g) { branch.textContent = g.branch + (g.dirty ? '*' : ''); branch.classList.toggle('dirty', g.dirty); } }).catch(() => {});
  const meta = el('div', { class: 'ws-meta' }, branch,
    latest ? el('span', { text: fmtAgo(latest.lastActivity) }) : null,
    mem ? el('span', { text: `메모리 ${fmtN(mem)}` }) : null,
    tok ? el('span', { text: `출력 ${fmtTok(tok)}` }) : null);
  const body = open ? el('div', { class: 'ws-body' },
    ...ss.sort((a, b) => (b.live - a.live) || ((b.lastActivity || 0) - (a.lastActivity || 0))).map((s) => sessionRow(s)),
    el('div', { class: 'ws-actions' }, el('button', { text: '＋ 여기서 새 세션', onclick: () => { setView('sessions'); openNewSession(e.path); } }), /^([A-Za-z]:)?[\\/]/.test(e.path) ? el('button', { text: '폴더 이동…', onclick: () => moveFlow(e.path) }) : null)) : null;
  node = el('div', { class: 'ws-card glass' + (ss.length ? '' : ' ws-empty') + (open ? ' open' : ''), 'data-path': e.path }, // not `.empty`: that is the centred placeholder style
    head, summary ? el('div', { class: 'ws-summary', text: summary, 'data-tip': `${detail ? detail + '\n' : ''}우클릭 → 이름 변경…` }) : null, meta, body);
  if (latest) node.oncontextmenu = (ev) => showCtx(ev, latest); // the session menu (이름 변경… renames it everywhere: list, tab, card)
  return node;
}

// FLIP: note where every card, tile, chip row and heading sits, let `change` swap the DOM, then slide each one from its old
// spot to its new one (and grow/shrink a card that was swapped for a fresh node, matched by its path). Layout itself is
// instant — a grid never animates — so without this the other cards snap into place.
function slideLayout(change, ms = 480) {
  const pane = $('#workspace-detail');
  const all = () => [...pane.querySelectorAll('.ws-card, .ws-tile, .ws-chips, .ws-cat > h3')];
  // a swapped card is matched by its path — plus its ordinal, since a pinned folder's card is on screen twice (핀 shelf + its own place)
  const keyed = (list) => { const n = new Map(); return list.map((x) => { if (!x.dataset.path) return [x, x]; const k = n.get(x.dataset.path) || 0; n.set(x.dataset.path, k + 1); return [x, `card:${x.dataset.path}#${k}`]; }); };
  const before = new Map(keyed(all()).map(([x, k]) => [k, x.getBoundingClientRect()]));
  change();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ease = 'cubic-bezier(.22,.61,.36,1)', els = all(), key = new Map(keyed(els)); // ease-out cubic: visible travel, not a snap
  // a card that opened or closed grows/shrinks over time, and the layout below it flows with its height every frame — so the
  // others' slide is measured against the layout with that card still at its OLD height; both motions then add up cleanly
  const grown = els.filter((x) => x.classList.contains('ws-card') && before.has(key.get(x)) && Math.abs(before.get(key.get(x)).height - x.getBoundingClientRect().height) > 1)
    .map((x) => ({ x, from: before.get(key.get(x)).height, to: x.getBoundingClientRect().height }));
  for (const g of grown) g.x.style.height = `${g.from}px`;
  const after = new Map(els.map((x) => [x, x.getBoundingClientRect()]));
  for (const g of grown) { g.x.style.height = ''; g.x.animate([{ height: `${g.from}px` }, { height: `${g.to}px` }], { duration: ms, easing: ease }); }
  for (const x of els) {
    const b = before.get(key.get(x)); if (!b) continue;
    const a = after.get(x), dx = b.left - a.left, dy = b.top - a.top;
    if (dx || dy) x.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: ms, easing: ease });
  }
}
// 폴더 이동: pick a parent (a category folder of a root, or any folder) and a name; the plan below the fields says what
// will travel (per profile: project dirs, trust/config keys, history lines, jobs) or why it cannot; 이동 runs it
function moveFlow(from, keep = null) { // keep: { dest, name } to reopen with what was typed (after a cancelled confirmation)
  const d = $('#dlg-move'), dest = $('#move-dest'), name = $('#move-name'), plan = $('#move-plan'), ok = $('#move-ok');
  let last = null; // the latest plan, for the confirmation text
  const base = from.split(/[\\/]/).pop(), parent = from.slice(0, from.length - base.length - 1);
  $('#move-from').textContent = from;
  const cats = []; // roots and their category folders (not repos), minus the folder itself and anything inside it
  for (const t of WS.data?.trees || []) { cats.push(t.root); for (const e of t.entries) if (e.kind === 'dir' && e.path !== from && !e.path.startsWith(from + api.sep)) cats.push(e.path); }
  dest.__opts = cats.map((p) => ({ value: p, text: shortPath(p) })); // the combobox (select.js) reads its choices from here
  dest.value = keep?.dest ?? parent; name.value = keep?.name ?? base;
  const to = () => `${dest.value.trim().replace(/[\\/]+$/, '')}${api.sep}${name.value.trim()}`;
  let seq = 0;
  const refresh = async () => {
    const t = to(); $('#move-to').textContent = t; ok.disabled = true;
    if (!dest.value.trim() || !name.value.trim()) { plan.className = 'move-plan'; plan.textContent = ''; return; }
    const my = ++seq; plan.className = 'move-plan dim'; plan.textContent = '확인 중…';
    const p = await api.planMove({ from, to: t }).catch((e) => ({ errors: [e.message.replace(/^.*?Error: /, '')] }));
    if (my !== seq) return;
    if (p.errors?.length) { plan.className = 'move-plan err'; plan.textContent = p.errors.join('\n'); return; }
    last = p;
    const lines = [];
    if (p.live.length) lines.push(`실행 중 세션 ${p.live.length}개를 멈췄다가 다시 시작: ${p.live.map((s) => s.name).join(', ')}`);
    for (const pr of p.profiles) {
      const tag = pr.id === 'default' ? '' : ` (${pr.id})`, parts = [];
      if (pr.projDirs.length) parts.push(`기록 폴더 ${pr.projDirs.length}개 (트랜스크립트 ${pr.projDirs.reduce((n, x) => n + x.files, 0)}개)`);
      if (pr.config) parts.push(`신뢰·설정 ${pr.config}곳`); if (pr.history) parts.push(`히스토리 ${pr.history}줄`); if (pr.jobs) parts.push(`잡 ${pr.jobs}개`);
      if (parts.length) lines.push(`함께 이동${tag}: ${parts.join(' · ')}`);
      if (pr.unsure.length) lines.push(`확인 필요${tag}: 실제 경로를 알 수 없어 그대로 두는 기록 폴더 ${pr.unsure.length}개\n${pr.unsure.map((u) => '  ~/.claude/projects/' + u).join('\n')}`);
    }
    if (!lines.length) lines.push('Claude Code 기록은 없습니다. 폴더만 옮깁니다.');
    if (p.venvs.length) lines.push(`Python 가상환경 ${p.venvs.length}개: 이동 뒤 activate · 실행 스크립트 · editable 설치의 경로를 새 경로로 고칩니다\n${p.venvs.map((v) => '  ' + shortPath(v)).join('\n')}`);
    plan.className = 'move-plan'; plan.replaceChildren(lines.join('\n'));
    if (p.worktrees.length) { // suggest tidying first; moving anyway is an explicit choice (the button says so) and ends with git worktree repair
      plan.append(el('div', { class: 'warn', text: `⚠ git 워크트리 ${p.worktrees.length}개가 있습니다. 옮기기 전에 정리(머지 후 git worktree remove)하기를 권합니다. 그대로 옮기면 이동 뒤 git worktree repair로 다시 연결합니다.\n${p.worktrees.map((w) => '  ' + shortPath(w.path)).join('\n')}` }));
    }
    ok.textContent = p.worktrees.length ? '정리 없이 이동' : '이동';
    ok.disabled = false;
  };
  dest.oninput = name.oninput = refresh;
  $('#move-pick').onclick = async () => { const p = await api.pickDir(); if (p) { dest.value = p; refresh(); } };
  d.onclose = async () => {
    if (d.returnValue !== 'ok') return;
    const t = to(), typed = { dest: dest.value, name: name.value };
    // one more step before anything moves: a confirmation whose default (Enter) is 취소; declining reopens this dialog as it was
    const notes = [];
    if (last?.live?.length) notes.push(`실행 중 세션 ${last.live.length}개를 멈췄다가 다시 시작합니다.`);
    if (last?.worktrees?.length) notes.push(`⚠ git 워크트리 ${last.worktrees.length}개를 정리하지 않은 채 옮기고, 이동 뒤 git worktree repair로 다시 연결합니다.`);
    if (last?.venvs?.length) notes.push(`Python 가상환경 ${last.venvs.length}개의 경로를 고칩니다.`);
    const go = await askConfirm(`${from}\n→ ${t}\n\n폴더를 옮기고 Claude Code 기록(대화 · 메모리 · 신뢰 설정 · 히스토리 · 잡)을 새 경로로 함께 옮깁니다.${notes.length ? '\n' + notes.join('\n') : ''}`, { title: '폴더 이동', ok: last?.worktrees?.length ? '정리 없이 이동' : '이동' });
    if (!go) { moveFlow(from, typed); return; }
    const r = await api.moveFolder({ from, to: t }).catch((e) => ({ error: e.message.replace(/^.*?Error: /, '') }));
    WS.data = null; WS.open.delete(from); loadSessions(); loadWorkspace();
    await askConfirm(r.error ? r.error : r.log.join('\n'), { title: r.error ? '이동 실패' : '이동 완료', ok: '확인', danger: !!r.error, notice: true });
  };
  d.showModal(); refresh(); name.focus();
}
