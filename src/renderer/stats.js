'use strict';
/* global $, el, S, fmtN, fmtTok, fmtBytes, fmtAgo, shortPath, api */
// 전체 통계: totals, daily bars, per project / per model tables, editable price table for an API-rate estimate.

// Anthropic first-party API rates, USD per 1M tokens (cached 2026-09-25). Cache write ≈ 1.25× input where not published.
const DEFAULT_PRICES = {
  'claude-fable-5-1': { input: 10, cacheRead: 0.25, cacheWrite: 12.5, output: 50 },
  'claude-fable-5': { input: 10, cacheRead: 1, cacheWrite: 12.5, output: 50 },
  'claude-opus-5-5': { input: 4, cacheRead: 0.2, cacheWrite: 5, output: 20 },
  'claude-opus-5': { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-opus-4-8': { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-opus-4-7': { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-opus-4-6': { input: 5, cacheRead: 0.5, cacheWrite: 6.25, output: 25 },
  'claude-sonnet-5-5': { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  'claude-sonnet-5': { input: 2, cacheRead: 0.2, cacheWrite: 2.5, output: 10 },
  'claude-sonnet-4-6': { input: 3, cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
  'claude-haiku-4-5': { input: 1, cacheRead: 0.1, cacheWrite: 1.25, output: 5 },
  '<synthetic>': { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
};
function loadPrices() { try { return { ...DEFAULT_PRICES, ...JSON.parse(localStorage.getItem('prices') || '{}') }; } catch { return { ...DEFAULT_PRICES }; } }
function priceFor(prices, model) {
  if (prices[model]) return prices[model];
  const key = Object.keys(prices).filter((k) => model.startsWith(k)).sort((a, b) => b.length - a.length)[0]; // date-suffixed ids
  return key ? prices[key] : null;
}
const cost = (b, p) => p ? (b.input * p.input + b.cacheRead * p.cacheRead + b.cacheCreate * p.cacheWrite + b.output * p.output) / 1e6 : null;
const fmtUsd = (v) => v == null ? '-' : '$' + (v >= 100 ? v.toFixed(0) : v.toFixed(2));
const costOf = (byModel, prices) => Object.entries(byModel).reduce((acc, [m, b]) => { const c = cost(b, priceFor(prices, m)); return c == null ? acc : (acc || 0) + c; }, null);

const ST = { range: 30, metric: 'output', data: null };
const METRICS = { output: ['출력 토큰', (b) => b.output], total: ['총 토큰', (b) => b.input + b.cacheRead + b.cacheCreate + b.output], msgs: ['응답 수', (b) => b.msgs], tools: ['도구 호출', (b) => b.tools] };

async function loadStats() {
  const pane = $('#stats-detail');
  if (!ST.data) pane.replaceChildren(el('div', { class: 'empty', text: '전체 세션 집계 중…' }));
  ST.data = await api.globalStats();
  renderStats();
}

function dayChart(days) {
  const [label, pick] = METRICS[ST.metric];
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const all = Object.keys(days).sort();
  const n = ST.range || Math.max(1, Math.round((today - Date.parse(all[0] || today)) / 864e5) + 1);
  const rows = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(today - i * 864e5).toISOString().slice(0, 10); rows.push({ d, v: days[d] ? pick(days[d]) : 0, b: days[d] }); }
  const W = 960, H = 220, L = 52, R = 8, T = 12, B = 26, iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...rows.map((r) => r.v));
  const mag = 10 ** Math.floor(Math.log10(max)), nice = Math.ceil(max / mag) * mag;
  const bw = iw / rows.length, gap = Math.min(2, bw * 0.2), every = Math.ceil(rows.length / 8), lastLabel = Math.floor((rows.length - 1) / every) * every;
  const fmt = ST.metric === 'msgs' || ST.metric === 'tools' ? fmtN : fmtTok;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="일별 ${label}">`;
  for (const f of [1 / 3, 2 / 3, 1]) { const y = T + ih - ih * f; svg += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" class="grid"/><text x="${L - 6}" y="${y + 4}" class="axis" text-anchor="end">${fmt(nice * f)}</text>`; }
  svg += `<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="base"/>`;
  rows.forEach((r, i) => {
    const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap), h = r.v ? Math.max(2, (r.v / nice) * ih) : 0, y = T + ih - h;
    const tip = `${r.d}\n${label}: ${fmt(r.v)}${r.b ? `\n응답 ${fmtN(r.b.msgs)} · 도구 ${fmtN(r.b.tools)} · 출력 ${fmtTok(r.b.output)} · 총 ${fmtTok(r.b.input + r.b.cacheRead + r.b.cacheCreate + r.b.output)}` : ''}`;
    svg += `<g class="bar" data-tip="${tip.replace(/"/g, '&quot;')}"><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" class="hit"/>${h ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(3, w / 2)}" class="fill"/>` : ''}</g>`;
    if (i % every === 0 || (i === rows.length - 1 && i - lastLabel > every / 2)) svg += `<text x="${L + i * bw + bw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${r.d.slice(5)}</text>`;
  });
  svg += '</svg>';
  const box = el('div', { class: 'chart-box' });
  box.innerHTML = svg;
  return box;
}

function table(headers, rows) {
  return el('table', {}, el('tr', {}, ...headers.map((h) => el('th', { text: h }))),
    ...rows.map((r) => el('tr', {}, ...r.map((c, i) => el('td', { class: i ? 'num' : '', text: c })))));
}

function renderStats() {
  const g = ST.data, prices = loadPrices(), pane = $('#stats-detail');
  const tile = (k, v) => el('div', { class: 'tile' }, el('div', { class: 'k', text: k }), el('div', { class: 'v', text: v }));
  const total = g.tokens.input + g.tokens.cacheRead + g.tokens.cacheCreate + g.tokens.output;
  const totalCost = costOf(g.byModel, prices);
  const sel = (id, opts, val, on) => { const s = el('select', { id, onchange: (e) => on(e.target.value) }, ...opts.map(([v, t]) => el('option', { value: v, text: t }))); s.value = val; return s; };
  const projects = Object.values(g.byProject).sort((a, b) => (b.tokens.output) - (a.tokens.output));
  const models = Object.entries(g.byModel).sort((a, b) => b[1].output - a[1].output);
  const tools = Object.entries(g.tools).sort((a, b) => b[1] - a[1]).slice(0, 12);

  pane.replaceChildren(
    el('div', { class: 'stats-head' },
      el('h3', { text: '전체 통계' }),
      el('span', { class: 'msg', text: `${g.firstTs?.slice(0, 10) || ''} → ${g.lastTs?.slice(0, 10) || ''} · 트랜스크립트가 있는 세션 ${g.sessions}개` }),
      el('span', { class: 'spacer' }),
      el('button', { text: '↻ 다시 집계', onclick: () => { ST.data = null; loadStats(); } })),
    el('div', { class: 'stats' },
      tile('세션', fmtN(g.sessions)), tile('사용자 메시지', fmtN(g.userMessages)), tile('어시스턴트 응답', fmtN(g.assistantMessages)),
      tile('도구 호출', fmtN(g.toolCalls)), tile('총 토큰', fmtTok(total)), tile('출력 토큰', fmtTok(g.tokens.output)),
      tile('캐시 읽기', fmtTok(g.tokens.cacheRead)), tile('활동일', fmtN(Object.keys(g.days).length)),
      tile('API 요금 환산', fmtUsd(totalCost))),
    el('div', { class: 'stats-head' },
      el('h4', { text: '일별 추이' }),
      sel('stats-metric', Object.entries(METRICS).map(([k, [t]]) => [k, t]), ST.metric, (v) => { ST.metric = v; renderStats(); }),
      sel('stats-range', [['30', '최근 30일'], ['90', '최근 90일'], ['0', '전체']], String(ST.range), (v) => { ST.range = Number(v); renderStats(); })),
    dayChart(g.days),
    el('h4', { text: '프로젝트별' }),
    table(['프로젝트', '세션', '메시지', '도구 호출', '출력 토큰', '총 토큰', 'API 환산', '마지막 활동'],
      projects.map((p) => [shortPath(p.cwd), fmtN(p.sessions), fmtN(p.userMessages + p.assistantMessages), fmtN(p.toolCalls), fmtTok(p.tokens.output),
        fmtTok(p.tokens.input + p.tokens.cacheRead + p.tokens.cacheCreate + p.tokens.output), fmtUsd(costOf(p.byModel, prices)), p.lastTs ? fmtAgo(Date.parse(p.lastTs)) : ''])),
    el('h4', { text: '모델별' }),
    table(['모델', '응답', '입력', '캐시 읽기', '캐시 생성', '출력', 'API 환산'],
      models.map(([m, b]) => [m, fmtN(b.msgs), fmtTok(b.input), fmtTok(b.cacheRead), fmtTok(b.cacheCreate), fmtTok(b.output), fmtUsd(cost(b, priceFor(prices, m)))])),
    el('h4', { text: '도구별 호출 수 (상위 12)' }),
    table(['도구', '호출'], tools.map(([t, n]) => [t, fmtN(n)])),
    priceEditor(prices, models.map(([m]) => m)));
}

function priceEditor(prices, used) {
  const keys = [...new Set([...used.filter((m) => !priceFor(prices, m) || prices[m]), ...Object.keys(DEFAULT_PRICES)])].filter((k) => k !== '<synthetic>');
  const save = () => { const o = {}; for (const k of keys) { o[k] = {}; for (const f of ['input', 'cacheRead', 'cacheWrite', 'output']) o[k][f] = Number($(`#p-${CSS.escape(k)}-${f}`).value) || 0; } localStorage.setItem('prices', JSON.stringify(o)); renderStats(); };
  const row = (k) => { const p = prices[k] || priceFor(prices, k) || { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }; return el('tr', {}, el('td', { text: k }),
    ...['input', 'cacheRead', 'cacheWrite', 'output'].map((f) => el('td', { class: 'num' }, el('input', { id: `p-${k}-${f}`, type: 'number', step: '0.01', min: '0', value: p[f], onchange: save })))); };
  return el('details', { class: 'prices' },
    el('summary', { text: '단가표 (USD / 1M 토큰) — API 요금 환산용. 구독 사용량에는 청구되지 않습니다. 2026-09-25 공개 단가 기준, 수정 가능' }),
    el('table', {}, el('tr', {}, ...['모델', '입력', '캐시 읽기', '캐시 생성', '출력'].map((h) => el('th', { text: h }))), ...keys.map(row)),
    el('button', { text: '기본값 복원', onclick: () => { localStorage.removeItem('prices'); renderStats(); } }));
}
