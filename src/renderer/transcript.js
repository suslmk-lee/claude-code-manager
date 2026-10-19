'use strict';
/* global $, el, S, fmtN, shortPath, api, openSession, renderDetail, closeFlyout, menu, renderSessionList, marked */
// Markdown for user / assistant text. Raw HTML in the source is shown escaped; links open externally (main.js).
const mdRenderer = new marked.Renderer();
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
mdRenderer.html = ({ text }) => escHtml(text);
mdRenderer.link = function ({ href, title, tokens }) {
  const inner = this.parser.parseInline(tokens);
  return /^(https?:|mailto:)/i.test(href) ? `<a href="${escHtml(href)}" target="_blank" rel="noopener"${title ? ` title="${escHtml(title)}"` : ''}>${inner}</a>` : inner;
};
mdRenderer.image = ({ text }) => escHtml(text ? `[이미지: ${text}]` : '[이미지]');
// CommonMark refuses `**굵게**이` (closing ** followed by a letter after punctuation); Korean particles make that common.
const strongLoose = {
  name: 'strongLoose', level: 'inline',
  start(src) { return src.indexOf('**'); },
  tokenizer(src) { const m = /^\*\*(?=\S)([^\n]*?\S)\*\*/.exec(src); return m ? { type: 'strongLoose', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) } : undefined; },
  renderer(token) { return `<strong>${this.parser.parseInline(token.tokens)}</strong>`; },
};
marked.use({ renderer: mdRenderer, gfm: true, breaks: true, extensions: [strongLoose] });
function mdBody(text) { const d = el('div', { class: 'md-body' }); d.innerHTML = marked.parse(text || ''); return d; }
// 대화 서브탭: read-only transcript (paged from the end) and the flyout's full-text search.

const TR = new Map(); // sessionId → { from, total, turns, filter }
// tool calls (⚙ Bash/Write …) and their result rows in the 대화 tab: hidden by default, toggle in the bar, remembered
const toolsShown = () => { try { return localStorage.getItem('showTools') === '1'; } catch { return false; } };
const turnsClass = () => 'turns' + (toolsShown() ? '' : ' no-tools');
const PAGE = 200;

const localTime = (ts) => ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '';
function turnEl(t) {
  const time = t.ts ? t.ts.slice(5, 16).replace('T', ' ') : '';
  if (t.role === 'meta') {
    if (t.kind === 'duration') return el('div', { class: 'turn meta', id: 'turn-' + t.i }, el('span', { class: 'glyph-ok', text: '✱' }), ` 완료 · ${(t.ms / 1000).toFixed(1)}s · ${localTime(t.ts)}`);
    return el('div', { class: 'turn meta recap', id: 'turn-' + t.i }, el('span', { class: 'glyph-ok', text: '※' }), el('b', { text: ' recap: ' }), t.text);
  }
  if (t.role === 'tool') return el('div', { class: 'turn tool', id: 'turn-' + t.i }, el('span', { class: 'who', text: '⚙ ' + t.name }), el('span', { class: 'tsum', text: t.text }), el('span', { class: 'time', text: time }));
  if (t.role === 'result') return el('details', { class: 'turn result' + (t.isError ? ' err' : ''), id: 'turn-' + t.i }, el('summary', { text: `${t.isError ? '오류 결과' : '도구 결과'} · ${fmtN(t.text.length)}자` }), el('pre', { text: t.text }));
  return el('div', { class: 'turn ' + t.role, id: 'turn-' + t.i },
    el('div', { class: 'head' }, el('span', { class: 'who', text: t.role === 'user' ? '나' : 'Claude' }), t.model ? el('span', { class: 'model', text: t.model }) : null, t.images ? el('span', { class: 'img-badge', text: `🖼 이미지 ${t.images}장` }) : null, el('span', { class: 'time', text: time })),
    mdBody(t.text),
    t.thumbs?.length ? el('div', { class: 'thumbs' }, ...t.thumbs.map((u) => el('img', { src: u }))) : null);
}

async function showTranscript(s, pane) {
  if (!s.file) {
    const list = el('div', { class: turnsClass() }, el('p', { class: 'msg', text: s.chatNew ? `새 챗 · ${shortPath(s.cwd)} · 첫 메시지를 보내면 이 폴더에서 세션이 만들어집니다` : '트랜스크립트 파일이 아직 없습니다' }));
    pane.replaceChildren(list);
    if (typeof renderChatUI === 'function') renderChatUI(s, pane, list);
    return;
  }
  const jump = S.pendingJump; S.pendingJump = null;
  let st = TR.get(s.sessionId);
  if (!st || jump != null) {
    pane.replaceChildren(el('div', { class: 'empty', text: '대화 불러오는 중…' }));
    const r = await api.transcript(s.sessionId, jump != null ? { from: Math.max(0, jump - 40), limit: PAGE } : {});
    if (!r) { pane.replaceChildren(el('div', { class: 'empty', text: '트랜스크립트를 읽을 수 없습니다' })); return; }
    st = { from: r.from, total: r.total, turns: r.turns, filter: st?.filter || '' };
    TR.set(s.sessionId, st);
  }
  const list = el('div', { class: turnsClass() });
  const more = el('button', { onclick: async () => {
    const from = Math.max(0, st.from - PAGE);
    const r = await api.transcript(s.sessionId, { from, limit: st.from - from });
    st.turns = [...r.turns, ...st.turns]; st.from = from;
    const before = pane.scrollHeight;
    list.prepend(...r.turns.map(turnEl).filter((e) => applyFilter(e, st.filter)));
    pane.scrollTop += pane.scrollHeight - before; // keep what you were reading in place
    more.textContent = moreLabel();
    more.disabled = st.from === 0;
  } });
  const moreLabel = () => st.from > 0 ? `이전 ${fmtN(Math.min(PAGE, st.from))}개 더 보기 (${fmtN(st.from)}개 남음)` : '처음부터 표시 중';
  more.textContent = moreLabel(); more.disabled = st.from === 0;
  const filter = el('input', { class: 'tr-filter', placeholder: '이 대화 안에서 찾기', value: st.filter, oninput: (e) => { st.filter = e.target.value; for (const c of list.children) applyFilter(c, st.filter); } });
  const toolsCb = el('input', { type: 'checkbox' }); toolsCb.checked = toolsShown();
  const setTools = (on, persist) => { toolsCb.checked = on; list.classList.toggle('no-tools', !on); if (persist) try { localStorage.setItem('showTools', on ? '1' : ''); } catch { /* fine */ } };
  toolsCb.onchange = () => setTools(toolsCb.checked, true);
  const bar = el('div', { class: 'tr-bar' }, more, filter,
    el('label', { class: 'tr-tools', 'data-tip': 'Bash·Write 등 도구 호출 줄과 도구 결과 줄 표시 (기본 숨김)' }, toolsCb, ' 도구 호출'),
    el('span', { class: 'msg', text: `${fmtN(st.total)} 턴 · 서브에이전트 제외` }),
    el('button', { text: '↻', 'data-tip': '다시 읽기', onclick: () => { TR.delete(s.sessionId); renderDetail(); } }),
    el('button', { text: '맨 아래', onclick: () => { pane.scrollTop = pane.scrollHeight; } }));
  list.append(...st.turns.map(turnEl));
  for (const c of list.children) applyFilter(c, st.filter);
  pane.replaceChildren(bar, list);
  api.watchTranscript(s.sessionId); // new turns written by the running session appear here as they land on disk
  if (typeof renderChatUI === 'function') renderChatUI(s, pane, list);
  requestAnimationFrame(() => {
    const target = jump != null && document.getElementById('turn-' + jump);
    if (target) { if (target.matches('.tool, .result')) setTools(true, false); target.classList.add('hl'); target.scrollIntoView({ block: 'center' }); } else pane.scrollTop = pane.scrollHeight; // a search hit inside a tool row reveals tool rows for this view
  });
}
api.onTranscriptAppend(({ sessionId, turns }) => {
  const lt = S.terms.get(sessionId);
  if (lt?.logMode) for (const t of turns) lt.term.write(turnToAnsi(t, lt.term.cols)); // terminal tab in live-log mode
  const st = TR.get(sessionId);
  if (!st || S.sel !== sessionId || S.tab !== 'transcript') return;
  if (typeof CH !== 'undefined' && CH.has(sessionId)) return; // app-owned chat renders its own turns live
  const list = $('#session-detail .turns'), pane = $('#session-detail .pane');
  if (!list) return;
  const stick = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 220; // sticky composer covers the bottom
  const act = list.querySelector('.activity');
  for (const t of turns) { t.i = st.total++; st.turns.push(t); const e = turnEl(t); applyFilter(e, st.filter); list.append(e); }
  if (act) list.append(act); // keep the activity row last
  $('#session-detail .tr-bar .msg')?.replaceChildren(`${fmtN(st.total)} 턴 · 서브에이전트 제외 · 실시간`);
  if (stick) pane.scrollTop = pane.scrollHeight;
});
function applyFilter(e, q) {
  const show = !q || e.textContent.toLowerCase().includes(q.toLowerCase());
  e.classList.toggle('hidden', !show);
  return show;
}
function openTranscriptAt(sessionId, i) {
  S.pendingJump = i; S.tab = 'transcript';
  openSession(sessionId);
}

// ---- flyout: filter rows as you type, Enter runs the full-text search ----
const sessSearch = $('#sess-search'), results = $('#search-results');
sessSearch.oninput = (e) => { S.sessFilter = e.target.value; renderSessionList(); };
sessSearch.onfocus = () => { menu.classList.remove('closed'); menu.classList.add('open'); }; // typing pins the list open like a click did
sessSearch.onkeydown = async (e) => {
  if (e.key === 'Escape') { sessSearch.value = ''; S.sessFilter = ''; results.replaceChildren(); renderSessionList(); return; }
  if (e.key !== 'Enter') return;
  const q = sessSearch.value.trim();
  if (q.length < 2) return;
  results.replaceChildren(el('div', { class: 'group-title', text: `대화 검색 "${q}" … 검색 중` }));
  const hits = await api.searchTranscripts(q);
  results.replaceChildren(
    el('div', { class: 'group-title' }, `대화 검색 "${q}" · ${fmtN(hits.length)}건`, el('button', { class: 'mini', text: '닫기', onclick: () => results.replaceChildren() })),
    ...hits.map((h) => el('div', { class: 'sess hit', 'data-tip': `${shortPath(h.cwd)}\n${h.snippet}`, onclick: () => { closeFlyout(); openTranscriptAt(h.sessionId, h.i); } },
      el('span', { class: 'name', text: h.name }),
      el('span', { class: 'detail' }, el('span', { class: 'role ' + h.role, text: { user: '나', assistant: 'Claude', tool: '도구', result: '결과', meta: 'recap' }[h.role] || h.role }), ' ', h.snippet),
      el('span', { class: 'links' }),
      el('span', { class: 'age', text: h.ts ? h.ts.slice(5, 10) : '' }))));
};
