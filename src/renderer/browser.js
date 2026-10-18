'use strict';
/* global $, el, S, api, cur, shortPath, renderDetail */
// Right-hand browser pane per session: a persistent <webview> (never re-attached, only shown/hidden),
// an element picker, and picked-element chips that ride along with the next chat message or get pasted into the terminal.

const BR = new Map(); // sessionId → { open, url, view, picks: [], picking }
const pane = $('#browser-pane');
const urlKey = (s) => 'browserUrl:' + (s.projectDir || s.cwd || s.sessionId);

function brState(s) {
  let b = BR.get(s.sessionId);
  if (!b) {
    let url = 'http://localhost:3000';
    try { url = localStorage.getItem(urlKey(s)) || url; } catch { /* default */ }
    b = { open: false, url, view: null, picks: [], picking: false, s, console: [] };
    BR.set(s.sessionId, b);
  }
  return b;
}
function toggleBrowser(s) { const b = brState(s); b.open = !b.open; syncBrowserPane(s); }

function ensureView(b) {
  if (b.view) return b.view;
  const v = el('webview', { src: b.url, preload: api.webviewPreload, partition: 'persist:browser', class: 'wv' });
  v.addEventListener('ipc-message', (e) => {
    if (e.channel === 'picked') { const p = { kind: 'element', ...e.args[0] }; b.picks.push(p); renderChips(b); shotElement(b, p); if (typeof onElementPicked === 'function') onElementPicked(b.s); } // 'picking' reports whether the picker stayed on (shift-click)
    else if (e.channel === 'picking') { b.picking = !!e.args[0]; renderToolbar(b); }
    else if (e.channel === 'ready') { b.ready = true; renderToolbar(b); }
    else if (e.channel === 'pick-cancel') { b.picking = false; renderToolbar(b); }
  });
  v.addEventListener('did-navigate', (e) => { b.url = e.url; try { localStorage.setItem(urlKey(b.s), e.url); } catch { /* fine */ } b.ready = false; renderToolbar(b); setTimeout(() => { try { v.send('ping'); } catch { /* not attached */ } }, 400); }); // new document: ask the picker if it is there
  v.addEventListener('did-navigate-in-page', (e) => { b.url = e.url; renderToolbar(b); });
  v.addEventListener('did-fail-load', (e) => { if (e.isMainFrame !== false && e.errorCode !== -3) showLoadError(b, e.errorCode, e.errorDescription, e.validatedURL); });
  v.addEventListener('did-start-loading', () => { b.error = null; $('#br-views .br-error')?.remove(); $('#br-status').textContent = '로딩…'; });
  v.addEventListener('did-stop-loading', () => { if (!b.error) $('#br-status').textContent = ''; });
  v.addEventListener('dom-ready', () => { b.domReady = true; if (b.pendingUrl) { const u = b.pendingUrl; b.pendingUrl = null; v.loadURL(u); } });
  v.addEventListener('console-message', (e) => { // Electron levels: 0 verbose, 1 info, 2 warning, 3 error
    if (e.level < 2 || /^%cElectron Security Warning/.test(e.message)) return;
    b.console.push({ level: e.level === 3 ? 'error' : 'warn', message: String(e.message).slice(0, 500), source: e.sourceId ? `${e.sourceId.split(/[\\/]/).pop()}:${e.line}` : '', ts: Date.now() });
    if (b.console.length > 50) b.console.shift();
    renderToolbar(b);
  });
  $('#br-views').append(v);
  b.view = v;
  return v;
}

// Show the pane for this session (its webview visible, others hidden) or hide it.
function syncBrowserPane(s) {
  const b = s && BR.get(s.sessionId);
  const open = !!(b && b.open && S.view === 'sessions');
  pane.classList.toggle('hidden', !open);
  if (!open) return;
  ensureView(b);
  for (const [id, x] of BR) if (x.view) x.view.classList.toggle('hidden', id !== s.sessionId);
  renderToolbar(b); renderChips(b);
}

function renderToolbar(b) {
  const v = b.view;
  $('#br-toolbar').replaceChildren(
    el('button', { text: '◀', 'data-tip': '뒤로', onclick: () => v?.canGoBack() && v.goBack() }),
    el('button', { text: '▶', 'data-tip': '앞으로', onclick: () => v?.canGoForward() && v.goForward() }),
    el('button', { text: '↻', 'data-tip': '새로고침', onclick: () => v?.reload() }),
    (() => { const i = el('input', { class: 'br-url', value: b.url, spellcheck: 'false' }); i.onkeydown = (e) => { if (e.key === 'Enter') go(b, i.value); }; i.onfocus = () => i.select(); return i; })(),
    el('button', { class: 'primary' + (b.picking ? ' picking' : ''), text: b.picking ? '선택 중… (Esc 취소)' : '요소 선택', 'data-tip': '페이지에서 요소를 클릭하면 선택됩니다. Shift+클릭으로 여러 개', onclick: () => { b.picking = !b.picking; v?.send('pick', b.picking); renderToolbar(b); } }),
    el('button', { text: '📷', 'data-tip': '페이지 스크린샷을 찍어 선택 목록에 추가', onclick: () => shotPage(b) }),
    (() => { const n = b.console.filter((c) => c.level === 'error').length, w = b.console.length - n;
      return el('button', { class: n ? 'has-errors' : '', text: `콘솔 ${n}${w ? `+${w}` : ''}`, 'data-tip': b.console.length ? b.console.slice(-8).map((c) => `${c.level === 'error' ? '✖' : '▲'} ${c.message}${c.source ? ` (${c.source})` : ''}`).join('\n') : '콘솔 오류·경고 없음', onclick: () => attachConsole(b) }); })(),
    el('button', { text: '⚙', 'data-tip': '개발자 도구', onclick: () => v?.openDevTools() }),
    el('button', { text: '✕', 'data-tip': '패널 닫기', onclick: () => { b.open = false; syncBrowserPane(b.s); renderDetail(); } }),
    el('span', { id: 'br-status', class: 'msg' }),
    el('span', { class: 'msg ' + (b.ready ? 'ok' : ''), 'data-tip': b.ready ? '요소 선택기가 페이지에 주입됐습니다' : '선택기 대기 중 (페이지 로드 후 준비됨)', text: b.ready ? '● 선택기' : '○ 선택기' }));
}
const sameUrl = (a, b) => { try { return new URL(a).href === new URL(b).href; } catch { return a === b; } };
function go(b, url) {
  url = url.trim(); if (!url) return;
  if (!/^[a-z]+:\/\//i.test(url)) url = (/^localhost|^\d+\.\d+\.\d+\.\d+|^[\w.-]+:\d+/.test(url) ? 'http://' : 'https://') + url;
  b.url = url; try { localStorage.setItem(urlKey(b.s), url); } catch { /* fine */ }
  const v = ensureView(b);
  if (b.domReady) v.loadURL(url);
  else if (!sameUrl(v.getAttribute('src'), url)) b.pendingUrl = url; // created earlier with another src: navigate once dom-ready fires
}

const LOAD_HINTS = {
  '-105': '호스트 이름을 찾을 수 없습니다. 주소의 오타를 확인하세요.',
  '-102': '연결이 거부됐습니다. 개발 서버가 떠 있는지, 포트가 맞는지 확인하세요.',
  '-7': '응답이 없습니다 (시간 초과).',
  '-106': '네트워크에 연결돼 있지 않습니다.',
};
function showLoadError(b, code, desc, url) {
  b.error = { code, desc, url };
  $('#br-status').textContent = `로드 실패 ${desc || code}`;
  const isCert = /CERT|SSL/i.test(desc || '');
  $('#br-views .br-error')?.remove();
  $('#br-views').append(el('div', { class: 'br-error' },
    el('div', { class: 'code', text: `${desc || ''} (${code})` }),
    el('div', { class: 'url', text: url || b.url }),
    el('div', { class: 'msg', text: isCert ? '이 사이트의 인증서를 확인할 수 없습니다. 사내 자체 서명 인증서라면 허용하고 다시 열 수 있습니다.' : (LOAD_HINTS[String(code)] || '') }),
    isCert ? el('button', { class: 'primary', text: '이 호스트의 인증서 오류 허용 후 다시 열기', onclick: async () => { await api.trustHost(new URL(url || b.url).host); b.view.loadURL(url || b.url); } }) : null,
    el('button', { text: '다시 시도', onclick: () => b.view.loadURL(url || b.url) })));
}

// ---- picked elements → context block ----
function elementBlock(p) {
  if (p.kind === 'screenshot') return `[페이지 스크린샷] ${p.url}\n파일: ${p.file}`;
  if (p.kind === 'console') return `[콘솔 오류·경고] ${p.url}\n${p.items.map((c) => `${c.level === 'error' ? 'ERROR' : 'WARN'} ${c.message}${c.source ? ` (${c.source})` : ''}`).join('\n')}`;
  const src = p.source;
  const lines = [`[선택한 요소] ${p.url}`, `선택자: ${p.selector}`];
  if (p.text) lines.push(`텍스트: "${p.text}"`);
  lines.push(`크기: ${p.rect.w}×${p.rect.h} @ (${p.rect.x}, ${p.rect.y})`);
  if (src) {
    if (src.chain?.length) lines.push(`컴포넌트: ${src.chain.join(' > ')}`);
    if (src.loc) lines.push(`소스: ${src.loc}`);
  }
  lines.push(`HTML: ${p.html.length > 600 ? p.html.slice(0, 600) + '…' : p.html}`);
  if (p.file) lines.push(`스크린샷: ${p.file}`);
  return lines.join('\n');
}

// element crop / page screenshot → PNG file under userData/shots (Claude reads it by path)
async function shotElement(b, p) {
  try {
    const r = p.rect, v = b.view;
    const w = v.clientWidth, h = v.clientHeight;
    const rect = { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: Math.min(w, r.w + 16), height: Math.min(h, r.h + 16) };
    if (rect.width < 4 || rect.height < 4 || r.y > h || r.x > w) return;
    const shot = await api.captureShot(v.getWebContentsId(), rect, p.tag + (p.id ? '-' + p.id : ''));
    p.file = shot.file; p.thumb = shot.thumb;
    renderChips(b);
  } catch (e) { console.warn('element shot failed', e); }
}
async function shotPage(b) {
  try {
    const shot = await api.captureShot(b.view.getWebContentsId(), null, 'page');
    b.picks.push({ kind: 'screenshot', url: b.url, file: shot.file, thumb: shot.thumb });
    renderChips(b); if (typeof onElementPicked === 'function') onElementPicked(b.s);
  } catch (e) { $('#br-status').textContent = '스크린샷 실패: ' + e.message; }
}
function attachConsole(b) {
  if (!b.console.length) return;
  b.picks.push({ kind: 'console', url: b.url, items: b.console.slice(-20) });
  b.console = []; renderToolbar(b); renderChips(b); if (typeof onElementPicked === 'function') onElementPicked(b.s);
}
async function openSource(b, p) {
  const r = await api.openSource(b.s.cwd, p.source.loc);
  $('#br-status').textContent = r.ok ? `열림 (${r.via})` : r.error || '열기 실패';
}
function pickedBlock(sessionId) { const b = BR.get(sessionId); return b?.picks.length ? b.picks.map(elementBlock).join('\n\n') : ''; }
function takePickedBlock(sessionId) { const t = pickedBlock(sessionId); const b = BR.get(sessionId); if (b) { b.picks = []; renderChips(b); } return t; }

function renderChips(b) {
  const box = $('#br-chips');
  if (!b.picks.length) { box.replaceChildren(); return; }
  const t = S.terms.get(b.s.sessionId);
  box.replaceChildren(
    el('div', { class: 'chips-head' },
      el('span', { text: `선택한 요소 ${b.picks.length}개 · 다음 챗 메시지에 함께 전달됩니다` }),
      t?.ptyId ? el('button', { text: '터미널에 붙여넣기', 'data-tip': '프롬프트 입력란에 블록으로 붙입니다 (전송은 직접)', onclick: () => { api.ptyWrite(t.ptyId, '\x1b[200~' + pickedBlock(b.s.sessionId) + '\n\x1b[201~'); b.picks = []; renderChips(b); } }) : null,
      el('button', { text: '지우기', onclick: () => { b.picks = []; renderChips(b); } })),
    ...b.picks.map((p, i) => el('div', { class: 'chip', 'data-tip': elementBlock(p) },
      p.thumb ? el('img', { class: 'chip-thumb', src: p.thumb }) : null,
      p.kind === 'screenshot' ? el('span', { class: 'chip-sel', text: '📷 페이지 스크린샷' })
        : p.kind === 'console' ? el('span', { class: 'chip-sel', text: `콘솔 ${p.items.length}건` })
        : el('span', { class: 'chip-sel', text: `${p.tag}${p.id ? '#' + p.id : ''}${p.classes.slice(0, 2).map((c) => '.' + c).join('')}` }),
      p.kind === 'element' && p.source?.chain?.length ? el('span', { class: 'chip-src', text: p.source.chain.slice(-2).join(' > ') + (p.source.loc ? ` · ${p.source.loc.split(/[\\/]/).pop()}` : '') }) : (p.source?.loc ? el('span', { class: 'chip-src', text: p.source.loc.split(/[\\/]/).pop() }) : null),
      p.kind === 'element' && p.source?.loc && /\.[a-z]+(:\d+)?(:\d+)?$/i.test(p.source.loc) ? el('button', { class: 'mini', text: '소스 열기', 'data-tip': p.source.loc, onclick: (e) => { e.stopPropagation(); openSource(b, p); } }) : null,
      p.kind === 'element' && p.text ? el('span', { class: 'chip-text', text: `"${p.text.slice(0, 40)}${p.text.length > 40 ? '…' : ''}"` }) : p.kind === 'console' ? el('span', { class: 'chip-text', text: p.items[p.items.length - 1].message }) : null,
      el('span', { class: 'x', text: '×', onclick: () => { b.picks.splice(i, 1); renderChips(b); } }))));
}

// ---- divider drag ----
(() => {
  const div = $('#br-divider'); let dragging = false;
  div.onmousedown = (e) => { dragging = true; e.preventDefault(); document.body.classList.add('dragging'); };
  window.addEventListener('mousemove', (e) => { if (!dragging) return; const w = Math.min(Math.max(window.innerWidth - e.clientX, 320), window.innerWidth * 0.8); pane.style.width = w + 'px'; });
  window.addEventListener('mouseup', () => { if (dragging) { dragging = false; document.body.classList.remove('dragging'); } });
})();
