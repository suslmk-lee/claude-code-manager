'use strict';
/* global S, $, el, LOOK, needsInput, activity, openSession, api, mdBody */
// CCMy: the floating agent in the corner. 대화: a conversation with the agent in src/ccmy.js, which can list sessions, read
// them, bring one on screen and — after a 보내기 click here — type into one. An alert (needs input / finished) is handed to
// the agent as an "[이벤트]" message, so it reads the session and says what is going on instead of just relaying the alert.
// 세션: the plain card list (no LLM), derived from S.sessions on every poll. A new alert or briefing shows a one-line peek
// beside the bubble; the panel opens on a click, never by itself, so it cannot cover the terminal or take focus.
const CCMY_CHARS = { // id → [name, 96×96 SVG body] · the choice is LOOK.ccmyChar (모양 › CCMy)
  robot: ["로봇", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M48 15v11\" stroke=\"#d7dae0\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><circle cx=\"48\" cy=\"13\" r=\"5\" fill=\"#4caf7d\"/><rect x=\"13\" y=\"42\" width=\"8\" height=\"16\" rx=\"4\" fill=\"#d97757\"/><rect x=\"75\" y=\"42\" width=\"8\" height=\"16\" rx=\"4\" fill=\"#d97757\"/><rect x=\"19\" y=\"26\" width=\"58\" height=\"48\" rx=\"16\" fill=\"#e58a68\"/><rect x=\"27\" y=\"35\" width=\"42\" height=\"24\" rx=\"10\" fill=\"#15181d\"/><path d=\"M35 42l7 5-7 5\" fill=\"none\" stroke=\"#4caf7d\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"50\" y=\"45\" width=\"11\" height=\"4.5\" rx=\"2\" fill=\"#4caf7d\"/><path d=\"M41 66h14\" stroke=\"#15181d\" stroke-width=\"3.5\" stroke-linecap=\"round\"/>"],
  cat: ["고양이 봇", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M22 44L24 18l20 12zM74 44L72 18 52 30z\" fill=\"#d97757\"/><path d=\"M27 36l1-10 9 6zM69 36l-1-10-9 6z\" fill=\"#f4b9a0\"/><rect x=\"18\" y=\"28\" width=\"60\" height=\"50\" rx=\"22\" fill=\"#e58a68\"/><rect x=\"26\" y=\"38\" width=\"44\" height=\"22\" rx=\"10\" fill=\"#15181d\"/><path d=\"M35 44l7 5-7 5\" fill=\"none\" stroke=\"#4caf7d\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"50\" y=\"47\" width=\"11\" height=\"4.5\" rx=\"2\" fill=\"#4caf7d\"/><path d=\"M44 67l4 3 4-3\" fill=\"none\" stroke=\"#15181d\" stroke-width=\"3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M10 58h10M10 66l10-3M86 58H76M86 66l-10-3\" stroke=\"#d7dae0\" stroke-width=\"2\" stroke-linecap=\"round\" opacity=\".7\"/>"],
  ghost: ["유령", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M22 78V44a26 26 0 0 1 52 0v34l-8.7-7-8.6 7-8.7-7-8.7 7-8.6-7z\" fill=\"#d7dae0\"/><path d=\"M34 40l9 6-9 6\" fill=\"none\" stroke=\"#d97757\" stroke-width=\"5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"51\" y=\"43\" width=\"13\" height=\"6\" rx=\"2.5\" fill=\"#15181d\"/><ellipse cx=\"48\" cy=\"60\" rx=\"4\" ry=\"3\" fill=\"#15181d\"/><circle cx=\"30\" cy=\"56\" r=\"3.5\" fill=\"#e58a68\" opacity=\".6\"/><circle cx=\"66\" cy=\"56\" r=\"3.5\" fill=\"#e58a68\" opacity=\".6\"/>"],
  blob: ["블롭", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M48 22c20 0 32 12 32 30S68 80 48 80 16 70 16 52s12-30 32-30z\" fill=\"#e58a68\"/><g stroke=\"#4caf7d\" stroke-width=\"3.5\" stroke-linecap=\"round\"><path d=\"M48 8v14M42 11.500l12 7M54 11.500l-12 7\"/></g><circle cx=\"37\" cy=\"48\" r=\"6\" fill=\"#15181d\"/><circle cx=\"59\" cy=\"48\" r=\"6\" fill=\"#15181d\"/><circle cx=\"39\" cy=\"46\" r=\"2\" fill=\"#fff\"/><circle cx=\"61\" cy=\"46\" r=\"2\" fill=\"#fff\"/><path d=\"M40 61q8 7 16 0\" fill=\"none\" stroke=\"#15181d\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><circle cx=\"27\" cy=\"58\" r=\"4\" fill=\"#d97757\"/><circle cx=\"69\" cy=\"58\" r=\"4\" fill=\"#d97757\"/>"],
  owl: ["부엉이", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M20 30l10 6M76 30l-10 6\" stroke=\"#d97757\" stroke-width=\"7\" stroke-linecap=\"round\"/><path d=\"M20 50c0-18 12-26 28-26s28 8 28 26-12 30-28 30-28-12-28-30z\" fill=\"#e58a68\"/><path d=\"M34 62c4 10 24 10 28 0-6 5-22 5-28 0z\" fill=\"#f4b9a0\"/><circle cx=\"36\" cy=\"46\" r=\"12\" fill=\"#d7dae0\"/><circle cx=\"60\" cy=\"46\" r=\"12\" fill=\"#d7dae0\"/><circle cx=\"37\" cy=\"47\" r=\"6\" fill=\"#15181d\"/><circle cx=\"59\" cy=\"47\" r=\"6\" fill=\"#15181d\"/><circle cx=\"39\" cy=\"45\" r=\"2\" fill=\"#4caf7d\"/><circle cx=\"61\" cy=\"45\" r=\"2\" fill=\"#4caf7d\"/><path d=\"M44 56l4 6 4-6z\" fill=\"#e5b84a\"/>"],
  monitor: ["모니터", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><rect x=\"16\" y=\"22\" width=\"64\" height=\"46\" rx=\"10\" fill=\"#e58a68\"/><rect x=\"22\" y=\"28\" width=\"52\" height=\"34\" rx=\"6\" fill=\"#15181d\"/><path d=\"M32 38l8 6-8 6\" fill=\"none\" stroke=\"#4caf7d\" stroke-width=\"4.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"48\" y=\"41\" width=\"14\" height=\"5.5\" rx=\"2.5\" fill=\"#4caf7d\"/><path d=\"M40 54q8 5 16 0\" fill=\"none\" stroke=\"#d7dae0\" stroke-width=\"3\" stroke-linecap=\"round\"/><rect x=\"42\" y=\"68\" width=\"12\" height=\"8\" fill=\"#d97757\"/><rect x=\"30\" y=\"76\" width=\"36\" height=\"6\" rx=\"3\" fill=\"#d97757\"/>"],
  spark: ["별표 요정", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><g stroke=\"#e58a68\" stroke-width=\"13\" stroke-linecap=\"round\"><path d=\"M48 16v64M20.3 32l55.4 32M20.3 64l55.4-32\"/></g><circle cx=\"48\" cy=\"48\" r=\"19\" fill=\"#e58a68\"/><circle cx=\"41\" cy=\"45\" r=\"4\" fill=\"#15181d\"/><circle cx=\"55\" cy=\"45\" r=\"4\" fill=\"#15181d\"/><circle cx=\"42.3\" cy=\"43.7\" r=\"1.4\" fill=\"#fff\"/><circle cx=\"56.3\" cy=\"43.7\" r=\"1.4\" fill=\"#fff\"/><path d=\"M42 54q6 5 12 0\" fill=\"none\" stroke=\"#15181d\" stroke-width=\"3\" stroke-linecap=\"round\"/>"],
  fox: ["여우", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M16 22l22 10-14 16zM80 22L58 32l14 16z\" fill=\"#d97757\"/><path d=\"M14 40c8-10 22-16 34-16s26 6 34 16L48 82z\" fill=\"#e58a68\"/><path d=\"M14 40l34 42-12-32zM82 40L48 82l12-32z\" fill=\"#d7dae0\"/><circle cx=\"37\" cy=\"46\" r=\"4\" fill=\"#15181d\"/><circle cx=\"59\" cy=\"46\" r=\"4\" fill=\"#15181d\"/><circle cx=\"38.3\" cy=\"44.7\" r=\"1.4\" fill=\"#fff\"/><circle cx=\"60.3\" cy=\"44.7\" r=\"1.4\" fill=\"#fff\"/><ellipse cx=\"48\" cy=\"76\" rx=\"5\" ry=\"4\" fill=\"#15181d\"/>"],
  operator: ["관제사", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M20 52a28 28 0 0 1 56 0\" fill=\"none\" stroke=\"#d7dae0\" stroke-width=\"5\" stroke-linecap=\"round\"/><circle cx=\"48\" cy=\"52\" r=\"24\" fill=\"#e58a68\"/><rect x=\"13\" y=\"44\" width=\"11\" height=\"20\" rx=\"5.5\" fill=\"#4caf7d\"/><rect x=\"72\" y=\"44\" width=\"11\" height=\"20\" rx=\"5.5\" fill=\"#4caf7d\"/><path d=\"M19 64c0 12 10 16 22 16\" fill=\"none\" stroke=\"#d7dae0\" stroke-width=\"3.5\" stroke-linecap=\"round\"/><rect x=\"40\" y=\"76\" width=\"12\" height=\"7\" rx=\"3.5\" fill=\"#d7dae0\"/><path d=\"M36 48l6 4-6 4\" fill=\"none\" stroke=\"#15181d\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><rect x=\"50\" y=\"50\" width=\"11\" height=\"4.5\" rx=\"2\" fill=\"#15181d\"/><path d=\"M42 63q6 4 12 0\" fill=\"none\" stroke=\"#15181d\" stroke-width=\"3\" stroke-linecap=\"round\"/>"],
  drone: ["외눈 드론", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#1c2027\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M22 20h18M56 20h18\" stroke=\"#d7dae0\" stroke-width=\"4\" stroke-linecap=\"round\"/><path d=\"M31 20v10M65 20v10\" stroke=\"#d7dae0\" stroke-width=\"3\"/><rect x=\"18\" y=\"28\" width=\"60\" height=\"44\" rx=\"22\" fill=\"#e58a68\"/><circle cx=\"48\" cy=\"50\" r=\"16\" fill=\"#15181d\"/><circle cx=\"48\" cy=\"50\" r=\"10\" fill=\"#4caf7d\"/><circle cx=\"48\" cy=\"50\" r=\"4.5\" fill=\"#15181d\"/><circle cx=\"52\" cy=\"45\" r=\"2.5\" fill=\"#fff\"/><path d=\"M34 72l-4 10M62 72l4 10\" stroke=\"#d97757\" stroke-width=\"5\" stroke-linecap=\"round\"/>"],
  // neutral / futuristic set. "$" in an id is replaced per drawn copy (ccmyCharSvg): a gradient id must be unique in the page
  orb: ["오브", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><radialGradient id=\"g$\" cx=\".35\" cy=\".3\" r=\".8\"><stop offset=\"0\" stop-color=\"#d9fffa\"/><stop offset=\".45\" stop-color=\"#4fd1c5\"/><stop offset=\"1\" stop-color=\"#2a4fc7\"/></radialGradient></defs><ellipse cx=\"48\" cy=\"48\" rx=\"35\" ry=\"11\" transform=\"rotate(-22 48 48)\" fill=\"none\" stroke=\"#d7dae0\" stroke-width=\"2.5\" opacity=\".35\"/><circle cx=\"48\" cy=\"48\" r=\"20\" fill=\"url(#g$)\"/><path d=\"M15.6 61.100a35 11 -22 0 0 64.8-26.2\" fill=\"none\" stroke=\"#d7dae0\" stroke-width=\"2.5\" stroke-linecap=\"round\" opacity=\".9\"/><circle cx=\"80.4\" cy=\"34.9\" r=\"4.5\" fill=\"#e58a68\"/>"],
  hex: ["헥사 코어", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><linearGradient id=\"g$\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4fd1c5\"/><stop offset=\"1\" stop-color=\"#9b8cff\"/></linearGradient></defs><path d=\"M48 18l26 15v30L48 78 22 63V33z\" fill=\"none\" stroke=\"url(#g$)\" stroke-width=\"5\" stroke-linejoin=\"round\"/><path d=\"M48 33l13 7.500v15L48 63l-13-7.500v-15z\" fill=\"url(#g$)\" opacity=\".9\"/><circle cx=\"48\" cy=\"48\" r=\"4.5\" fill=\"#131722\"/><path d=\"M48 18v15M74 63l-13-7.500M22 63l13-7.5\" stroke=\"url(#g$)\" stroke-width=\"2.5\" opacity=\".6\"/>"],
  visor: ["바이저", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><linearGradient id=\"g$\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4fd1c5\"/><stop offset=\"1\" stop-color=\"#5b8def\"/></linearGradient></defs><rect x=\"23\" y=\"19\" width=\"50\" height=\"60\" rx=\"25\" fill=\"#2a303b\" stroke=\"#566072\" stroke-width=\"2\"/><path d=\"M34 26h28\" stroke=\"#566072\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><rect x=\"28\" y=\"40\" width=\"40\" height=\"13\" rx=\"6.5\" fill=\"#131722\"/><rect x=\"31\" y=\"43\" width=\"34\" height=\"7\" rx=\"3.5\" fill=\"url(#g$)\"/><rect x=\"33\" y=\"44.5\" width=\"10\" height=\"2\" rx=\"1\" fill=\"#fff\" opacity=\".7\"/><path d=\"M42 67h12\" stroke=\"#566072\" stroke-width=\"2.5\" stroke-linecap=\"round\"/>"],
  pulse: ["펄스", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><linearGradient id=\"g$\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4fd1c5\"/><stop offset=\".5\" stop-color=\"#5b8def\"/><stop offset=\"1\" stop-color=\"#9b8cff\"/></linearGradient></defs><circle cx=\"48\" cy=\"48\" r=\"30\" fill=\"none\" stroke=\"url(#g$)\" stroke-width=\"4\"/><circle cx=\"48\" cy=\"48\" r=\"30\" fill=\"url(#g$)\" opacity=\".1\"/><path d=\"M24 48h10l5-14 8 28 7-21 4 7h14\" fill=\"none\" stroke=\"#d7dae0\" stroke-width=\"4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/>"],
  prism: ["프리즘", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><linearGradient id=\"g$\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4fd1c5\"/><stop offset=\"1\" stop-color=\"#9b8cff\"/></linearGradient></defs><path d=\"M10 52l28-4\" stroke=\"#d7dae0\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M56 46l30-10\" stroke=\"#e58a68\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M57 51l29-1\" stroke=\"#e5b84a\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M56 56l30 9\" stroke=\"#4fd1c5\" stroke-width=\"3\" stroke-linecap=\"round\"/><path d=\"M48 20l26 52H22z\" fill=\"url(#g$)\" fill-opacity=\".28\" stroke=\"url(#g$)\" stroke-width=\"4.5\" stroke-linejoin=\"round\"/>"],
  iris: ["아이리스", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><linearGradient id=\"g$\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#5b8def\"/><stop offset=\"1\" stop-color=\"#9b8cff\"/></linearGradient></defs><circle cx=\"48\" cy=\"48\" r=\"32\" fill=\"none\" stroke=\"#3d4455\" stroke-width=\"3\"/><circle cx=\"48\" cy=\"48\" r=\"24\" fill=\"none\" stroke=\"#4fd1c5\" stroke-width=\"4\" stroke-dasharray=\"26 11.7\" stroke-linecap=\"round\"/><circle cx=\"48\" cy=\"48\" r=\"14\" fill=\"url(#g$)\"/><circle cx=\"48\" cy=\"48\" r=\"5.5\" fill=\"#131722\"/><circle cx=\"52.5\" cy=\"43.5\" r=\"2.5\" fill=\"#fff\" opacity=\".85\"/>"],
  nodes: ["노드", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><linearGradient id=\"g$\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#4fd1c5\"/><stop offset=\"1\" stop-color=\"#5b8def\"/></linearGradient></defs><path d=\"M48 48L24 30M48 48l26-16M48 48L28 70M48 48l24 20M24 30l50 2M28 70l44-2\" stroke=\"#566072\" stroke-width=\"2.5\"/><circle cx=\"48\" cy=\"48\" r=\"11\" fill=\"url(#g$)\"/><circle cx=\"24\" cy=\"30\" r=\"6\" fill=\"#9b8cff\"/><circle cx=\"74\" cy=\"32\" r=\"6\" fill=\"#e58a68\"/><circle cx=\"28\" cy=\"70\" r=\"6\" fill=\"#4fd1c5\"/><circle cx=\"72\" cy=\"68\" r=\"6\" fill=\"#5b8def\"/><circle cx=\"48\" cy=\"48\" r=\"4\" fill=\"#131722\"/>"],
  cube: ["큐브", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><path d=\"M48 18l27 15-27 15-27-15z\" fill=\"#4fd1c5\"/><path d=\"M21 33l27 15v31L21 64z\" fill=\"#5b8def\"/><path d=\"M75 33L48 48v31l27-15z\" fill=\"#9b8cff\"/><path d=\"M48 18l27 15v31L48 79 21 64V33z M21 33l27 15 27-15M48 48v31\" fill=\"none\" stroke=\"#131722\" stroke-width=\"2.5\" stroke-linejoin=\"round\"/><path d=\"M34.5 25.500l27 15\" stroke=\"#fff\" stroke-width=\"2\" opacity=\".35\"/>"],
  aurora: ["오로라", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><g style=\"mix-blend-mode:screen\"><circle cx=\"39\" cy=\"41\" r=\"19\" fill=\"#4fd1c5\" opacity=\".8\"/><circle cx=\"58\" cy=\"43\" r=\"19\" fill=\"#9b8cff\" opacity=\".8\"/><circle cx=\"48\" cy=\"59\" r=\"19\" fill=\"#e58a68\" opacity=\".8\"/></g><circle cx=\"48\" cy=\"48\" r=\"6\" fill=\"#fff\" opacity=\".9\"/>"],
  android: ["안드로이드", "<circle cx=\"48\" cy=\"48\" r=\"45\" fill=\"#171b24\" stroke=\"#3d4455\" stroke-width=\"2\"/><defs><linearGradient id=\"g$\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#eef1f6\"/><stop offset=\"1\" stop-color=\"#8d96a8\"/></linearGradient></defs><path d=\"M30 84c2-9 9-12 18-12s16 3 18 12\" fill=\"#566072\"/><path d=\"M26 42a22 22 0 0 1 44 0v9c0 14-10 24-22 24S26 65 26 51z\" fill=\"url(#g$)\"/><path d=\"M48 20v12\" stroke=\"#131722\" stroke-width=\"2\" opacity=\".35\"/><circle cx=\"48\" cy=\"34\" r=\"3\" fill=\"#4fd1c5\"/><rect x=\"32\" y=\"46\" width=\"11\" height=\"4.5\" rx=\"2.2\" fill=\"#131722\"/><rect x=\"53\" y=\"46\" width=\"11\" height=\"4.5\" rx=\"2.2\" fill=\"#131722\"/><rect x=\"35\" y=\"47.2\" width=\"5\" height=\"2\" rx=\"1\" fill=\"#4fd1c5\"/><rect x=\"56\" y=\"47.2\" width=\"5\" height=\"2\" rx=\"1\" fill=\"#4fd1c5\"/><path d=\"M43 63h10\" stroke=\"#131722\" stroke-width=\"2.5\" stroke-linecap=\"round\" opacity=\".6\"/>"],
};
let ccmySvgN = 0;
const ccmyCharSvg = (id) => `<svg viewBox="0 0 96 96">${(CCMY_CHARS[id] || CCMY_CHARS.robot)[1].replaceAll('$', String(++ccmySvgN))}</svg>`;
const ccmyChar = () => (typeof LOOK !== 'undefined' && CCMY_CHARS[LOOK.ccmyChar]) ? LOOK.ccmyChar : 'robot';
const ccmyModel = () => (typeof LOOK !== 'undefined' && LOOK.ccmyModel) || 'haiku';
const ccmyIcon = () => { const w = document.createElement('span'); w.className = 'ccmy-ico'; w.innerHTML = ccmyCharSvg(ccmyChar()); return w; };
const CCMY_RECENT_H = 6; // open tabs that moved within this many hours are listed under the alerts
const CCMY = { done: [], open: false, sent: new Map(), peekTimer: 0, dropped: new Map(), auto: new Map(), view: 'chat', msgs: [], turns: [], status: '' }; // msgs: the thread · turns: prompts in flight, oldest first ({ sessionId } for an alert) // dropped: sessionId → lastActivity when the user cleared its 최근 card // done: [{ id, at }] newest first · sent: sessionId → status line after a reply
const ccmyPos = (() => { try { const p = JSON.parse(localStorage.getItem('ccmyPos')); if (p.r >= 0 && p.b >= 0) return p; } catch { /* default */ } return { r: 20, b: 20 }; })();

const ccmyRoot = el('div', { id: 'ccmy', hidden: '' });
const ccmyBadge = el('span', { class: 'pill', hidden: '' });
const ccmyPeekEl = el('div', { class: 'ccmy-peek', hidden: '', onclick: () => ccmyToggle(true) });
const ccmyList = el('div', { class: 'ccmy-list' });
const ccmyThread = el('div', { class: 'ccmy-thread' });
const ccmyInput = el('textarea', { rows: '1', placeholder: '세션 상태를 묻거나, 세션에 시킬 일을 말해 주세요', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ccmyAsk(); } },
  oninput: () => { ccmyInput.style.height = 'auto'; ccmyInput.style.height = Math.min(ccmyInput.scrollHeight, 120) + 'px'; } });
const ccmyChat = el('div', { class: 'ccmy-chat' }, ccmyThread, el('div', { class: 'ccmy-ask' }, ccmyInput, el('button', { class: 'primary', text: '↑', 'aria-label': '보내기', onclick: () => ccmyAsk() })));
const ccmyCount = el('span', { class: 'pill', hidden: '' });
const ccmyModelChip = el('span', { class: 'ccmy-model', 'data-tip': 'CCMy가 쓰는 모델 (모양 › CCMy에서 바꿉니다)' });
const ccmySeg = el('div', { class: 'ccmy-seg' }, ...[['chat', '대화'], ['list', '세션']].map(([v, t]) => el('button', { 'data-v': v, onclick: () => { CCMY.view = v; ccmyRender(); if (v === 'chat') ccmyInput.focus(); } }, t, v === 'list' ? ccmyCount : null)));
const ccmyQuick = el('div', { class: 'ccmy-chips' }, ...[['지금 상황 정리', '지금 상황 정리해줘'], ['입력 대기 세션', '입력 기다리는 세션 뭐야?'], ['방금 끝난 작업', '방금 끝난 작업 요약해줘']].map(([t, q]) => el('button', { text: t, onclick: () => ccmyAsk(q) })));
ccmyChat.insertBefore(ccmyQuick, ccmyChat.lastChild);
const ccmyPanel = el('div', { class: 'ccmy-panel', hidden: '', onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); ccmyToggle(false); } } },
  el('div', { class: 'ccmy-head' },
    el('div', { class: 'ccmy-head-row' }, el('span', { class: 'ccmy-av' }, ccmyIcon()), el('div', { class: 'ccmy-ttl' }, el('b', { text: 'CCMy' }), ccmyModelChip),
      el('button', { class: 'x', text: '↺', 'aria-label': '새 대화', 'data-tip': '새 대화 (지금까지의 대화를 잊습니다)', onclick: () => ccmyReset() }),
      el('button', { class: 'x', text: '×', 'aria-label': '닫기', onclick: () => ccmyToggle(false) })),
    ccmySeg),
  ccmyChat, ccmyList);
const ccmyFab = el('button', { class: 'ccmy-fab', 'aria-label': 'CCMy 알림', 'data-tip': 'CCMy :: 세션 알림 (끌어서 옮기기)' }, ccmyIcon(), ccmyBadge);
ccmyRoot.append(ccmyPanel, ccmyPeekEl, ccmyFab);
document.body.append(ccmyRoot);

function ccmyPlace() { // keep the bubble inside the window; the panel unfolds toward the roomier side
  ccmyPos.r = Math.max(8, Math.min(ccmyPos.r, innerWidth - 60)); ccmyPos.b = Math.max(8, Math.min(ccmyPos.b, innerHeight - 60));
  ccmyRoot.style.right = ccmyPos.r + 'px'; ccmyRoot.style.bottom = ccmyPos.b + 'px';
  ccmyRoot.classList.toggle('down', ccmyPos.b > innerHeight / 2);
  ccmyRoot.classList.toggle('toR', ccmyPos.r > innerWidth / 2);
}
addEventListener('resize', ccmyPlace);
ccmyFab.onpointerdown = (e) => { // drag to move, plain click to open
  if (e.button) return;
  const x0 = e.clientX, y0 = e.clientY, r0 = ccmyPos.r, b0 = ccmyPos.b;
  let moved = false;
  ccmyFab.setPointerCapture(e.pointerId);
  ccmyFab.onpointermove = (m) => {
    if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 5) return;
    moved = true; ccmyPos.r = r0 - (m.clientX - x0); ccmyPos.b = b0 - (m.clientY - y0); ccmyPlace();
  };
  ccmyFab.onpointerup = () => {
    ccmyFab.onpointermove = ccmyFab.onpointerup = null;
    if (moved) { try { localStorage.setItem('ccmyPos', JSON.stringify(ccmyPos)); } catch { /* not saved */ } } else ccmyToggle();
  };
};
function ccmyToggle(open = !CCMY.open) {
  CCMY.open = open;
  ccmyPanel.hidden = !open;
  ccmyRoot.classList.toggle('open', open);
  if (open) { ccmyPeekEl.hidden = true; ccmyRender(); ccmyThreadRender(); if (CCMY.view === 'chat') ccmyInput.focus(); }
}
// one line beside the bubble for a few seconds; the panel stays closed until the user asks
function ccmyPeek(text, ms = 6000) {
  if (CCMY.open || ccmyRoot.hidden) return;
  ccmyPeekEl.textContent = text;
  ccmyPeekEl.hidden = false;
  clearTimeout(CCMY.peekTimer);
  CCMY.peekTimer = setTimeout(() => { ccmyPeekEl.hidden = true; }, ms);
}
function ccmyDone(s) { // from trackDone: a session that worked for a while and stopped
  CCMY.done = [{ id: s.sessionId, at: Date.now() }, ...CCMY.done.filter((d) => d.id !== s.sessionId)].slice(0, 20);
  ccmyAlert(s, '작업 완료');
}
// An alert: a peek right away, and (unless switched off under 모양 › 알림) the agent reads the session and briefs.
// ---- 이어서 진행: for a session the user switched it on for (with a goal), CCMy answers by itself when the session stops, so
// the work goes on. Limits live here and in src/ccmy.js (auto_continue): a send count and a time limit per
// session, only a running background session, never a wait without a question (may be a permission menu), never anything on
// the forbidden list (merge, push, deploy, delete, …) — those go to the user. Kept in memory: off again after a restart.
// defaults from 모양 › 이어서 진행 (LOOK.ccmyAutoMax / ccmyAutoHours / ccmyAutoModel); each start can change the first two
const ccmyNum = (v, def, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo ? Math.min(n, hi) : def; };
const ccmyAutoMax = () => Math.round(ccmyNum(typeof LOOK !== 'undefined' && LOOK.ccmyAutoMax, 5, 1, 30));
const ccmyAutoHours = () => ccmyNum(typeof LOOK !== 'undefined' && LOOK.ccmyAutoHours, 2, 0.25, 24);
const ccmyAutoModel = () => (typeof LOOK !== 'undefined' && LOOK.ccmyAutoModel) || 'sonnet';
const ccmyAutoOn = (id) => CCMY.auto.has(id);
function ccmyAutoOff(id, why) {
  const a = CCMY.auto.get(id); if (!a) return;
  CCMY.auto.delete(id);
  CCMY.msgs.push({ who: 'note', text: `이어서 진행 끝 · ${a.name} :: ${why}` });
  ccmyPeek(`이어서 진행 끝 :: ${a.name}`); ccmyRender(); ccmyThreadRender();
}
function ccmyAutoStart(s) {
  const goal = el('textarea', { rows: '3', placeholder: '예: KSHQ-140 구현을 테스트 통과까지 끝낸다' });
  const max = el('input', { type: 'number', min: '1', max: '30', step: '1', value: String(ccmyAutoMax()) }), hours = el('input', { type: 'number', min: '0.25', max: '24', step: '0.25', value: String(ccmyAutoHours()) });
  const dlg = el('dialog', { class: 'glass', onclose: () => { const g = goal.value.trim(); dlg.remove(); if (dlg.returnValue !== 'ok' || !g) return;
    const h = ccmyNum(hours.value, ccmyAutoHours(), 0.25, 24);
    CCMY.auto.set(s.sessionId, { goal: g, count: 0, max: Math.round(ccmyNum(max.value, ccmyAutoMax(), 1, 30)), hours: h, until: Date.now() + h * 3600000, name: s.name });
    CCMY.msgs.push({ who: 'note', text: `이어서 진행 시작 · ${s.name} :: ${g}` }); ccmyRender(); ccmyThreadRender();
    const now = S.sessions.find((x) => x.sessionId === s.sessionId); if (now && activity(now) !== 'working') ccmyAutoStep(now, needsInput(now) ? '입력 대기' : '대기 중'); } },
    el('form', { method: 'dialog' }, el('h3', { text: `CCMy 이어서 진행 · ${s.name}` }),
      el('label', {}, '목표 (여기까지는 CCMy가 알아서 답합니다)', goal),
      el('div', { class: 'grid2' }, el('label', {}, '자동 전송 횟수', max), el('label', {}, '시간 (시간 단위)', hours)),
      el('p', { class: 'hint', text: `세션이 멈추거나 물어보면 CCMy(${ccmyAutoModel()})가 대화를 읽고 목표 안에서 답을 보냅니다. 횟수나 시간을 넘으면 꺼집니다. 기본값과 결정 모델은 모양 › 이어서 진행에서 바꿉니다. 머지 · 푸시 · 배포 · 삭제 · 결제 · 외부 전송에 관한 질문과 권한 승인 메뉴는 답하지 않고 알림으로 넘깁니다. 앱을 다시 켜면 꺼집니다.` }),
      el('div', { class: 'row right' }, el('button', { value: 'cancel', text: '취소' }), el('button', { value: 'ok', class: 'primary', text: '시작' }))));
  document.body.append(dlg); dlg.showModal(); goal.focus();
}
// the session stopped: hand it to the agent as an "[자동 진행]" turn. false = not on (or just switched off) → the usual alert
function ccmyAutoStep(s, what) {
  const a = CCMY.auto.get(s.sessionId); if (!a) return false;
  const stop = a.count >= a.max ? `자동 전송 ${a.max}회를 다 썼습니다` : Date.now() > a.until ? `${a.hours}시간이 지났습니다` : !(s.live && s.kind === 'background') ? '세션이 실행 중이 아닙니다' : '';
  if (stop) { ccmyAutoOff(s.sessionId, stop); return false; }
  ccmyPrompt(`[자동 진행] 세션 "${s.name}" (id ${s.short}) 이 멈췄습니다 (${what})${s.job?.needs ? ` · 질문: ${s.job.needs}` : ''}\n목표: ${a.goal}\n자동 전송 ${a.count}/${a.max}회 사용.`, { sessionId: s.sessionId, cap: `이어서 진행 · ${s.name}`, kind: 'auto' });
  return true;
}
// for the auto_continue tool (src/main.js → src/ccmy.js)
function ccmyAutoCheck(sessionId) {
  const a = CCMY.auto.get(sessionId), s = S.sessions.find((x) => x.sessionId === sessionId);
  if (!a || !s) return { ok: false };
  return { ok: a.count < a.max && Date.now() <= a.until && !!(s.live && s.kind === 'background'), goal: a.goal, count: a.count, max: a.max, needs: s.job?.needs || null, menu: s.state === 'blocked' && !s.job?.needs };
}
function ccmyAutoSent(sessionId, text) {
  const a = CCMY.auto.get(sessionId); if (!a) return;
  a.count++; CCMY.msgs.push({ who: 'auto', name: a.name, sessionId, text, n: a.count, max: a.max }); ccmyRender(); ccmyThreadRender();
}
function ccmyAlert(s, what) {
  if (ccmyAutoStep(s, what)) return ccmyPeek(`이어서 진행 :: ${s.name}`);
  ccmyPeek(`${what} :: ${s.name}`);
  if (ccmyRoot.hidden || (typeof LOOK !== 'undefined' && LOOK.ccmyBrief === 'off')) return;
  ccmyPrompt(`[이벤트] ${what} :: 세션 "${s.name}" (id ${s.short})${s.job?.needs ? ` · 질문: ${s.job.needs}` : ''}`, { sessionId: s.sessionId, cap: `${what} · ${s.name}`, kind: what === '작업 완료' ? 'done' : 'needs' });
}
// what the agent's tools see (src/main.js asks for it): open tabs, running, waiting, or moved in the last 24 h — newest first
function ccmySnapshot() {
  const day = Date.now() - 24 * 3600000;
  return S.sessions.filter((s) => S.tabs.includes(s.sessionId) || s.live || needsInput(s) || s.lastActivity > day).sort((a, b) => b.lastActivity - a.lastActivity).slice(0, 40)
    .map((s) => ({ id: s.short, sessionId: s.sessionId, profile: s.profile, name: s.name, cwd: s.cwd, state: activity(s), needs: needsInput(s) ? (s.job?.needs || '입력 대기') : null, detail: s.job?.detail || null,
      openTab: S.tabs.includes(s.sessionId), onScreen: s.sessionId === S.sel, canSend: !!(s.live && s.kind === 'background'), lastActivity: s.lastActivity ? ccmyAgo(s.lastActivity) : null }));
}
function ccmyPrompt(text, turn = {}) {
  turn.conv = turn.kind === 'auto' ? 'auto' : 'chat'; // 이어서 진행 decisions run in their own conversation, with their own model
  CCMY.turns.push(turn); CCMY.status = '생각 중…';
  ccmyThreadRender();
  api.ccmySend(text, turn.conv === 'auto' ? ccmyAutoModel() : ccmyModel(), turn.conv).catch((e) => { CCMY.turns = CCMY.turns.filter((t) => t !== turn); CCMY.status = ''; CCMY.msgs.push({ who: 'error', text: '시작 실패: ' + e.message }); ccmyThreadRender(); });
}
function ccmyAsk(text = ccmyInput.value.trim()) {
  if (!text) return;
  ccmyInput.value = ''; ccmyInput.style.height = '';
  CCMY.msgs.push({ who: 'me', text });
  ccmyPrompt(text);
}
function ccmyReset() { api.ccmyClose('chat'); CCMY.msgs = []; CCMY.turns = CCMY.turns.filter((t) => t.conv !== 'chat'); CCMY.status = CCMY.turns.length ? '생각 중…' : ''; ccmyThreadRender(); }
const CCMY_TOOL = { auto_continue: '이어서 진행 판단 중…', dismiss_waiting: '입력 대기 정리 중…', list_sessions: '세션 목록 확인 중…', read_session: '세션 대화 읽는 중…', open_session: '세션 여는 중…', send_to_session: '전송 확인을 기다리는 중…' };
api.onCcmyEvent((m) => {
  if (m.type === 'assistant' && !m.parent_tool_use_id) {
    const c = m.message?.content || [], text = c.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(), use = c.find((b) => b.type === 'tool_use');
    if (text) { const { sessionId, cap, kind } = CCMY.turns.find((t) => t.conv === m.conv) || {}; CCMY.msgs.push({ who: 'bot', text, sessionId, cap, kind, at: Date.now() }); if (sessionId) ccmyPeek(text.replace(CCMY_SUGGEST, '').replace(/[*_`#>]/g, '').trim().split('\n')[0], 12000); }
    if (use) CCMY.status = CCMY_TOOL[use.name.replace('mcp__ccm__', '')] || '작업 중…';
  } else if (m.type === 'result') {
    { const i = CCMY.turns.findIndex((t) => t.conv === m.conv); if (i !== -1) CCMY.turns.splice(i, 1); } CCMY.status = CCMY.turns.length ? '생각 중…' : '';
    if (m.is_error) CCMY.msgs.push({ who: 'error', text: '오류: ' + (m.result || m.subtype || '응답을 받지 못했습니다') });
  } else if (m.type === 'confirm') CCMY.msgs.push({ who: 'confirm', id: m.id, name: m.name, sessionId: m.sessionId, text: m.text, state: 'ask' });
  else if (m.type === 'confirm_cancelled') { const c = CCMY.msgs.find((x) => x.who === 'confirm' && x.id === m.id); if (c) c.state = 'no'; }
  else if (m.type === 'error' || m.type === 'closed') { if (m.type === 'error') CCMY.msgs.push({ who: 'error', text: '오류: ' + m.message }); CCMY.turns = CCMY.turns.filter((t) => t.conv !== m.conv); CCMY.status = CCMY.turns.length ? '생각 중…' : ''; }
  else return;
  ccmyThreadRender();
});
// A reply the agent proposes ends with "[[보내기: <id> | <버튼 이름> | <보낼 글>]]" (src/ccmy.js SYSTEM): shown as a button. The
// button opens the same 보내기 / 취소 card and, on 보내기, types the text straight into that session (no second LLM turn).
const CCMY_SUGGEST = /\[\[보내기:\s*([0-9a-f]{8})\s*\|\s*([^|\]]+?)\s*\|\s*([\s\S]*?)\]\]/g;
function ccmySuggest(short, text) {
  const s = S.sessions.find((x) => x.short === short);
  if (!s) { CCMY.msgs.push({ who: 'error', text: '그 세션을 찾지 못했습니다.' }); return ccmyThreadRender(); }
  CCMY.msgs.push({ who: 'confirm', name: s.name, sessionId: s.sessionId, text, state: 'ask', local: { short: s.short, cwd: s.cwd, profile: s.profile } });
  ccmyThreadRender();
}
function ccmyThreadRender() {
  ccmyRoot.classList.toggle('busy', !!CCMY.status);
  if (!CCMY.open) return;
  const go = (id) => id ? el('button', { text: '세션 열기', onclick: () => ccmyGo(id) }) : null;
  const answer = async (c, ok) => {
    c.state = ok ? 'yes' : 'no';
    if (!c.local) api.ccmyConfirm(c.id, ok);
    else if (ok) { c.state = 'wait'; ccmyThreadRender(); try { await api.ptySendToSession(c.local.short, c.local.cwd, c.text, c.local.profile); c.state = 'yes'; } catch (e) { c.state = 'no'; CCMY.msgs.push({ who: 'error', text: '전송 실패: ' + e.message }); } }
    ccmyThreadRender();
  };
  const bot = (m) => {
    const acts = [...m.text.matchAll(CCMY_SUGGEST)].slice(0, 3).map(([, short, label, text]) => el('button', { class: 'p', text: label, 'data-tip': text, onclick: () => ccmySuggest(short, text.trim()) }));
    const body = el('div', { class: 'ccmy-msg-body' }, mdBody(m.text.replace(CCMY_SUGGEST, '').trim()), m.sessionId || acts.length ? el('div', { class: 'ccmy-acts' }, go(m.sessionId), ...acts) : null);
    return m.cap ? el('div', { class: 'ccmy-msg bot alert ' + m.kind }, el('div', { class: 'ccmy-cap', text: `${m.kind === 'done' ? '✓' : m.kind === 'auto' ? '↻' : '●'} ${m.cap} · ${ccmyAgo(m.at)}` }), body) : el('div', { class: 'ccmy-msg bot' }, body);
  };
  ccmyThread.replaceChildren(...(CCMY.msgs.length ? CCMY.msgs.map((m) => m.who === 'me' ? el('div', { class: 'ccmy-msg me', text: m.text })
    : m.who === 'error' ? el('div', { class: 'ccmy-msg error', text: m.text })
    : m.who === 'note' ? el('div', { class: 'ccmy-msg note', text: m.text })
    : m.who === 'auto' ? el('div', { class: 'ccmy-msg confirm auto' }, el('div', { class: 'ccmy-confirm-head' }, el('b', { text: m.name }), ` 세션에 자동 전송 (${m.n}/${m.max})`), el('pre', { text: m.text }), el('div', { class: 'ccmy-acts' }, go(m.sessionId), CCMY.auto.has(m.sessionId) ? el('button', { text: '이어서 진행 끄기', onclick: () => ccmyAutoOff(m.sessionId, '사용자가 껐습니다') }) : null))
    : m.who === 'confirm' ? el('div', { class: 'ccmy-msg confirm' }, el('div', { class: 'ccmy-confirm-head' }, el('b', { text: m.name }), ' 세션에 보냅니다'), el('pre', { text: m.text }),
      m.state === 'ask' ? el('div', { class: 'ccmy-acts' }, el('button', { text: '취소', onclick: () => answer(m, false) }), el('button', { class: 'p', text: '보내기', onclick: () => answer(m, true) }))
        : el('div', { class: 'ccmy-sent', text: m.state === 'yes' ? '보냄' : m.state === 'wait' ? '보내는 중…' : '취소함' }))
    : bot(m))
    : [el('div', { class: 'ccmy-msg bot' }, el('div', { class: 'ccmy-msg-body' }, '안녕하세요, CCMy입니다. 세션들을 지켜보다가 입력 대기나 작업 완료가 생기면 내용을 읽고 알려 드립니다. 세션에 시킬 일을 말하면 대신 전달합니다.'))]));
  // working: the character with three bouncing dots and what it is doing, as the last bubble of the thread
  if (CCMY.status) ccmyThread.append(el('div', { class: 'ccmy-think' }, ccmyIcon(), el('div', { class: 'ccmy-think-bubble' }, el('span', { class: 'ccmy-dots' }, el('i'), el('i'), el('i')), el('span', { class: 'ccmy-think-text', text: CCMY.status.replace(/…$/, '') }),
    el('button', { 'aria-label': '중지', 'data-tip': '중지', onclick: () => api.ccmyInterrupt() }))));
  ccmyThread.scrollTop = ccmyThread.scrollHeight;
}
// after a change under 모양 › CCMy: redraw the character everywhere; a new model starts a new conversation
function ccmyApplyLook(modelChanged) {
  for (const w of document.querySelectorAll('#ccmy .ccmy-ico')) w.innerHTML = ccmyCharSvg(ccmyChar());
  if (modelChanged) ccmyReset();
  ccmyRender();
}
const ccmyGo = (id) => { CCMY.done = CCMY.done.filter((d) => d.id !== id); ccmyToggle(false); openSession(id); };
const ccmyAgo = (at) => { const m = Math.floor((Date.now() - at) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`; };
// 세션 tab: a reply goes in as typed text + Enter through the session's attach client (same path as the chat tab). Only offered
// when the session asked a question (job.needs): a bare "blocked" may be a permission menu, where typed text would pick an option.
async function ccmyReply(s, input) {
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  CCMY.sent.set(s.sessionId, '전송 중…'); ccmyRender();
  try { await api.ptySendToSession(s.short, s.cwd, text, s.profile); CCMY.sent.set(s.sessionId, `보냄 :: ${text}`); }
  catch (e) { CCMY.sent.set(s.sessionId, '전송 실패: ' + e.message); }
  ccmyRender();
}
function ccmyRender() {
  if (typeof S === 'undefined') return;
  ccmyRoot.hidden = typeof LOOK !== 'undefined' && LOOK.ccmy === 'off';
  ccmyPlace();
  const byId = new Map(S.sessions.map((s) => [s.sessionId, s]));
  const rank = (x) => (S.tabs.includes(x.sessionId) ? 2 : 0) + (x.live ? 1 : 0);
  const needs = S.sessions.filter(needsInput).sort((a, b) => rank(b) - rank(a)); // open tabs first, then running sessions: stopped ones keep an old question
  // a done card goes away once the session is gone, working again, asking for input, or on screen in the focused window
  CCMY.done = CCMY.done.filter((d) => { const s = byId.get(d.id); return s && activity(s) !== 'working' && !needsInput(s) && !(document.hasFocus() && S.view === 'sessions' && d.id === S.sel); });
  for (const id of [...CCMY.sent.keys()]) if (!needs.some((s) => s.sessionId === id)) CCMY.sent.delete(id);
  const n = needs.length + CCMY.done.length;
  ccmyBadge.textContent = String(n); ccmyBadge.hidden = !n;
  ccmyFab.classList.toggle('alert', needs.length > 0);
  ccmyCount.textContent = String(n); ccmyCount.hidden = !n; ccmyModelChip.textContent = ccmyModel();
  if (!CCMY.open) return;
  ccmyChat.hidden = CCMY.view !== 'chat'; ccmyList.hidden = CCMY.view !== 'list';
  for (const b of ccmySeg.children) b.classList.toggle('on', b.dataset.v === CCMY.view);
  if (CCMY.view !== 'list') return;
  // not alerts (no badge): open tabs working now or that moved in the last few hours, newest first
  const recent = S.sessions.filter((s) => S.tabs.includes(s.sessionId) && !needsInput(s) && !CCMY.done.some((d) => d.id === s.sessionId)
    && (activity(s) === 'working' || (Date.now() - s.lastActivity < CCMY_RECENT_H * 3600000 && CCMY.dropped.get(s.sessionId) !== s.lastActivity)))
    .sort((a, b) => b.lastActivity - a.lastActivity);
  // the poll re-renders every few seconds: keep what is being typed, and the caret
  const typed = new Map([...ccmyList.querySelectorAll('input')].map((i) => [i.dataset.id, i.value]));
  const active = document.activeElement?.closest?.('.ccmy-list') ? document.activeElement.dataset.id : null;
  const card = (s, kind, body, ...extra) => el('div', { class: 'ccmy-card ' + kind },
    el('div', { class: 'ccmy-card-head' }, el('span', { class: 'ccmy-tag', text: kind === 'done' ? '작업 완료' : kind === 'work' ? '작업 중' : kind === 'recent' ? '최근 작업' : s.live ? '입력 대기' : '입력 대기 · 중지됨' }), el('b', { text: s.name })),
    el('div', { class: 'ccmy-body', text: body }), ...extra);
  const open = (id) => el('button', { text: '세션 열기', onclick: () => ccmyGo(id) });
  const needCard = (s) => {
    const sent = CCMY.sent.get(s.sessionId), canReply = s.job?.needs && s.live && s.kind === 'background';
    const input = canReply ? el('input', { 'data-id': s.sessionId, placeholder: '답장을 쓰고 Enter', autocomplete: 'off', onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) ccmyReply(s, e.target); } }) : null;
    if (input) input.value = typed.get(s.sessionId) || '';
    return card(s, 'needs', s.job?.needs || s.job?.detail || '세션이 입력을 기다립니다',
      sent ? el('div', { class: 'ccmy-sent', text: sent }) : null,
      el('div', { class: 'ccmy-acts' }, sent && !sent.startsWith('전송 실패') ? null : input, el('button', { text: '대기 해제', 'data-tip': '이 질문은 더 답할 필요 없음 :: 알림 · 배지에서 뺍니다 (세션은 그대로)', onclick: () => setNeedsOff([s.sessionId]) }), open(s.sessionId)));
  };
  const stale = needs.filter((s) => !s.live);
  const inTab = (s) => S.tabs.includes(s.sessionId);
  // open tabs first (waiting → finished → working / recent), then waiting sessions that are not open
  const autos = [...CCMY.auto].map(([id, a]) => el('div', { class: 'ccmy-card auto' }, el('div', { class: 'ccmy-card-head' }, el('span', { class: 'ccmy-tag', text: `이어서 진행 ${a.count}/${a.max}` }), el('b', { text: a.name })),
    el('div', { class: 'ccmy-body', text: `목표 :: ${a.goal}` }), el('div', { class: 'ccmy-acts' }, el('button', { text: '끄기', onclick: () => ccmyAutoOff(id, '사용자가 껐습니다') }), open(id))));
  ccmyList.replaceChildren(...[...autos, stale.length > 1 ? el('button', { class: 'ccmy-bulk', text: `중지된 세션의 입력 대기 ${stale.length}건 모두 해제`, onclick: () => setNeedsOff(stale.map((s) => s.sessionId)) }) : null, ...needs.filter(inTab).map(needCard), ...CCMY.done.map((d) => { const s = byId.get(d.id);
    return card(s, 'done', `${s.job?.detail || '세션이 작업을 마쳤습니다'} · ${ccmyAgo(d.at)}`,
      el('div', { class: 'ccmy-acts' }, open(d.id), el('button', { text: '지우기', onclick: () => { CCMY.done = CCMY.done.filter((x) => x.id !== d.id); ccmyRender(); } })));
  }), ...recent.map((s) => { const w = activity(s) === 'working';
    return card(s, w ? 'work' : 'recent', `${s.job?.detail || s.lastPrompt || ''}${w ? '' : ` · ${ccmyAgo(s.lastActivity)}`}`.replace(/^ · /, ''),
      el('div', { class: 'ccmy-acts' }, open(s.sessionId), w ? null : el('button', { text: '지우기', onclick: () => { CCMY.dropped.set(s.sessionId, s.lastActivity); ccmyRender(); } })));
  }), ...needs.filter((s) => !inTab(s)).map(needCard), n || recent.length || autos.length ? null : el('div', { class: 'ccmy-empty' }, '지금 조치할 알림이 없습니다.', el('br'), '세션이 입력을 기다리거나 작업을 마치면 여기에 모입니다.')].filter(Boolean)); // native replaceChildren would print a null as "null"
  if (active) ccmyList.querySelector(`input[data-id="${active}"]`)?.focus();
}
ccmyRender();
