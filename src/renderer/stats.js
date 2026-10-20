'use strict';
/* global $, el, S, fmtN, fmtTok, fmtAgo, shortPath, api */
// 전체 통계 dashboard: KPI cards (count-up, sparkline, delta vs the previous period), daily chart with a 7-day average,
// activity heatmap, weekday profile, model-share donut, token mix, ranked project / tool bars, detail tables, price table.

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

const ST = { range: 30, metric: 'output', data: null, profile: '' }; // profile: '' = all
const METRICS = { output: ['출력 토큰', (b) => b.output], total: ['총 토큰', (b) => b.input + b.cacheRead + b.cacheCreate + b.output], msgs: ['응답 수', (b) => b.msgs], tools: ['도구 호출', (b) => b.tools] };
const PALETTE = ['var(--acc)', '#5b9cf6', '#4caf7d', '#e0b341', '#bd93f9', '#2aa198', '#e05d5d', '#f0a07a', '#8a919e'];
const totalOf = (b) => (b.input || 0) + (b.cacheRead || 0) + (b.cacheCreate || 0) + (b.output || 0);
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
const todayUTC = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
// day buckets of the selected range (offset = periods back) as an array, oldest first
function rangeRows(days, n, offset = 0) { const today = todayUTC(), rows = []; for (let i = n - 1 + offset * n; i >= offset * n; i--) { const d = dayKey(today - i * 864e5); rows.push({ d, b: days[d] || null }); } return rows; }
const sumRows = (rows, pick) => rows.reduce((a, r) => a + (r.b ? pick(r.b) : 0), 0);
function rangeDays(days) { if (ST.range) return ST.range; const all = Object.keys(days).sort(); return Math.max(1, Math.round((todayUTC() - Date.parse(all[0] || Date.now())) / 864e5) + 1); }
const seg = (opts, val, on) => el('div', { class: 'seg' }, ...opts.map(([v, t]) => el('button', { class: String(v) === String(val) ? 'active' : '', text: t, onclick: () => on(v) })));

// ---- animation helpers ----
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUp(node, to, fmt, ms = 750) {
  if (reduced() || !to) { node.textContent = fmt(to || 0); return; }
  const t0 = performance.now(), whole = Number.isInteger(to);
  const step = (t) => { const p = Math.min(1, (t - t0) / ms), e = 1 - (1 - p) ** 3; node.textContent = fmt(whole ? Math.round(to * e) : to * e); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
const nextFrame = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn)); // let the initial style land, then transition
function sparkline(vals, color) {
  const W = 120, H = 32, max = Math.max(1, ...vals), n = vals.length;
  const pts = vals.map((v, i) => [n > 1 ? (i / (n - 1)) * W : W, H - 2 - (v / max) * (H - 6)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const box = el('div', { class: 'spark' });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${line} L${W},${H} L0,${H} Z" class="area" style="fill:${color}"/><path d="${line}" class="line" style="stroke:${color}" pathLength="1"/></svg>`;
  return box;
}
function kpi(label, value, fmt, { spark, color = 'var(--acc)', delta, sub, i = 0, n = 0 } = {}) {
  const v = el('div', { class: 'v' });
  const d = delta != null && isFinite(delta)
    ? el('div', { class: 'delta ' + (delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : 'flat'), text: `${delta > 0.005 ? '▲' : delta < -0.005 ? '▼' : '•'} ${Math.abs(delta * 100).toFixed(0)}% vs 이전`, 'data-tip': `같은 길이의 직전 기간(${n}일) 대비 증감` })
    : sub ? el('div', { class: 'delta flat', text: sub }) : null;
  const card = el('div', { class: 'kpi', style: `--i:${i}` }, el('div', { class: 'k', text: label }), v, d, spark ? sparkline(spark, color) : null);
  requestAnimationFrame(() => countUp(v, value, fmt));
  return card;
}

async function loadStats() {
  const pane = $('#stats-detail');
  if (!ST.data) pane.replaceChildren(el('div', { class: 'empty', text: '전체 세션 집계 중…' }));
  ST.data = await api.globalStats(ST.profile ? { profile: ST.profile } : {});
  renderStats();
}

// ---- daily bars + 7-day moving average ----
function dayChart(days) {
  const [label, pick] = METRICS[ST.metric];
  const rows = rangeRows(days, rangeDays(days)).map((r) => ({ ...r, v: r.b ? pick(r.b) : 0 }));
  const W = 960, H = 240, L = 56, R = 12, T = 14, B = 28, iw = W - L - R, ih = H - T - B;
  const max = Math.max(1, ...rows.map((r) => r.v));
  const mag = 10 ** Math.floor(Math.log10(max)), nice = Math.ceil(max / mag) * mag;
  const bw = iw / rows.length, gap = Math.min(3, bw * 0.25), every = Math.ceil(rows.length / 8), lastLabel = Math.floor((rows.length - 1) / every) * every;
  const fmt = ST.metric === 'msgs' || ST.metric === 'tools' ? fmtN : fmtTok;
  const y = (v) => T + ih - (v / nice) * ih;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="일별 ${label}"><defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--acc);stop-opacity:.95"/><stop offset="1" style="stop-color:var(--acc);stop-opacity:.4"/></linearGradient></defs>`;
  for (const f of [0.25, 0.5, 0.75, 1]) { const yy = y(nice * f); svg += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="grid"/><text x="${L - 8}" y="${yy + 4}" class="axis" text-anchor="end">${fmt(nice * f)}</text>`; }
  svg += `<line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="base"/>`;
  rows.forEach((r, i) => {
    const x = L + i * bw + gap / 2, w = Math.max(1, bw - gap), h = r.v ? Math.max(2, (r.v / nice) * ih) : 0, yy = T + ih - h;
    const tip = `${r.d}\n${label}: ${fmt(r.v)}${r.b ? `\n응답 ${fmtN(r.b.msgs)} · 도구 ${fmtN(r.b.tools)} · 출력 ${fmtTok(r.b.output)} · 총 ${fmtTok(totalOf(r.b))}` : ''}`;
    svg += `<g class="bar" data-tip="${tip.replace(/"/g, '&quot;')}"><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" class="hit"/>${h ? `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="${Math.min(3, w / 2)}" class="fill" style="--i:${i};transform-origin:${(x + w / 2).toFixed(1)}px ${T + ih}px"/>` : ''}</g>`;
    if (i % every === 0 || (i === rows.length - 1 && i - lastLabel > every / 2)) svg += `<text x="${L + i * bw + bw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${r.d.slice(5)}</text>`;
  });
  if (rows.length >= 7) {
    const pts = rows.map((r, i) => { const s = rows.slice(Math.max(0, i - 6), i + 1); return [L + i * bw + bw / 2, y(s.reduce((a, q) => a + q.v, 0) / s.length)]; });
    svg += `<path class="avg" pathLength="1" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')}"/>`;
  }
  svg += '</svg>';
  const box = el('div', { class: 'chart-box' }); box.innerHTML = svg;
  return el('div', {}, box, el('div', { class: 'legend' }, el('span', { class: 'sw', style: 'background:var(--acc)' }), `일별 ${label}`, el('span', { class: 'sw line' }), '7일 이동평균', el('span', { class: 'msg', text: '· 막대에 마우스를 올리면 상세' })));
}

// ---- activity heatmap (last 26 weeks, output tokens) ----
function heatmap(days) {
  const weeks = 26, today = todayUTC(), dow = today.getUTCDay();
  const start = today - (weeks * 7 - 1 - (6 - dow)) * 864e5; // the grid ends on this week's Saturday column
  const cell = 13, gapPx = 3, L = 26, T = 16;
  const vals = []; for (let i = 0; i < weeks * 7; i++) { const t = start + i * 864e5; if (t > today) break; vals.push(days[dayKey(t)]?.output || 0); }
  const nz = vals.filter(Boolean).sort((a, b) => a - b), q = (p) => nz.length ? nz[Math.min(nz.length - 1, Math.floor(p * nz.length))] : 0;
  const level = (v) => !v ? 0 : v <= q(0.25) ? 1 : v <= q(0.5) ? 2 : v <= q(0.8) ? 3 : 4;
  const W = L + weeks * (cell + gapPx), H = T + 7 * (cell + gapPx);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="heat" role="img" aria-label="활동 히트맵">`;
  ['일', '월', '화', '수', '목', '금', '토'].forEach((d, i) => { if (i % 2) svg += `<text x="0" y="${T + i * (cell + gapPx) + cell - 2}">${d}</text>`; });
  let lastMonth = -1, idx = 0;
  for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
    const t = start + (w * 7 + d) * 864e5; if (t > today) continue;
    const date = new Date(t), key = dayKey(t), b = days[key], v = b?.output || 0, lv = level(v);
    if (d === 0 && date.getUTCMonth() !== lastMonth) { lastMonth = date.getUTCMonth(); svg += `<text x="${L + w * (cell + gapPx)}" y="10">${lastMonth + 1}월</text>`; }
    const tip = `${key}${b ? `\n출력 ${fmtTok(b.output)} · 응답 ${fmtN(b.msgs)} · 도구 ${fmtN(b.tools)}` : '\n활동 없음'}`;
    svg += `<rect x="${L + w * (cell + gapPx)}" y="${T + d * (cell + gapPx)}" width="${cell}" height="${cell}" rx="3" class="l${lv}" style="--i:${idx++}" data-tip="${tip.replace(/"/g, '&quot;')}"/>`;
  }
  svg += '</svg>';
  const box = el('div', { class: 'heat-box' }); box.innerHTML = svg;
  const legend = el('div', { class: 'legend' }, el('span', { class: 'msg', text: '적음' }), ...[0, 1, 2, 3, 4].map((l) => el('span', { class: `sw heat-l${l}` })), el('span', { class: 'msg', text: '많음 · 출력 토큰 기준, 최근 26주' }));
  return el('div', {}, box, legend);
}

// ---- weekday profile: average output per weekday over the range ----
function weekdayChart(days) {
  const rows = rangeRows(days, rangeDays(days)), sums = Array(7).fill(0), cnt = Array(7).fill(0);
  for (const r of rows) { const d = new Date(r.d + 'T00:00:00Z').getUTCDay(); cnt[d]++; sums[d] += r.b?.output || 0; }
  const avg = sums.map((s, i) => cnt[i] ? s / cnt[i] : 0), max = Math.max(1, ...avg);
  const names = ['일', '월', '화', '수', '목', '금', '토'];
  return el('div', { class: 'wk' }, ...avg.map((v, i) => el('div', { class: 'wk-col', 'data-tip': `${names[i]}요일 평균 출력 ${fmtTok(v)}` },
    el('div', { class: 'wk-track' }, el('i', { style: `height:${(v / max) * 100}%; --i:${i}` })), el('span', { class: 'wk-l' + (i === 0 || i === 6 ? ' we' : ''), text: names[i] }))));
}

// ---- donut: share of a quantity by label ----
function donut(entries, centerTop, centerSub) { // entries: [{ name, value, color, sub }]
  const total = entries.reduce((a, e) => a + e.value, 0) || 1, R = 42, C = 2 * Math.PI * R;
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 120 120'); svg.setAttribute('class', 'donut');
  const bg = document.createElementNS(ns, 'circle'); bg.setAttribute('cx', 60); bg.setAttribute('cy', 60); bg.setAttribute('r', R); bg.setAttribute('class', 'ring'); svg.append(bg);
  let off = 0; const segs = [];
  for (const e of entries) {
    const len = (e.value / total) * C, c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', 60); c.setAttribute('cy', 60); c.setAttribute('r', R); c.setAttribute('class', 'seg'); c.style.stroke = e.color;
    c.setAttribute('stroke-dasharray', `0 ${C}`); c.setAttribute('stroke-dashoffset', String(-off)); c.dataset.tip = `${e.name}\n${(e.value / total * 100).toFixed(1)}%${e.sub ? ` · ${e.sub}` : ''}`;
    segs.push([c, len]); svg.append(c); off += len;
  }
  const t1 = document.createElementNS(ns, 'text'); t1.setAttribute('x', 60); t1.setAttribute('y', 58); t1.setAttribute('class', 'c1'); t1.textContent = centerTop;
  const t2 = document.createElementNS(ns, 'text'); t2.setAttribute('x', 60); t2.setAttribute('y', 72); t2.setAttribute('class', 'c2'); t2.textContent = centerSub;
  svg.append(t1, t2);
  nextFrame(() => { for (const [c, len] of segs) c.setAttribute('stroke-dasharray', `${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`); });
  const legend = el('div', { class: 'dl' }, ...entries.flatMap((e) => [el('span', { class: 'dot', style: `background:${e.color}` }), el('span', { class: 'nm', text: e.name, title: e.name }), el('span', { class: 'pct', text: `${(e.value / total * 100).toFixed(1)}%` }), el('span', { class: 'n', text: e.sub || '' })]));
  return el('div', { class: 'donut-wrap' }, svg, legend);
}

// ---- token mix: one stacked bar ----
function tokenMix(tk) {
  const parts = [['입력', tk.input, '#5b9cf6'], ['캐시 읽기', tk.cacheRead, 'var(--ok)'], ['캐시 생성', tk.cacheCreate, 'var(--warn)'], ['출력', tk.output, 'var(--acc)']];
  const total = parts.reduce((a, p) => a + p[1], 0) || 1, hit = (tk.cacheRead / ((tk.input + tk.cacheRead + tk.cacheCreate) || 1)) * 100;
  const bar = el('div', { class: 'stack' }, ...parts.map(([n, v, c]) => el('i', { style: `background:${c}`, 'data-tip': `${n} ${fmtTok(v)} · ${(v / total * 100).toFixed(1)}%` })));
  nextFrame(() => { [...bar.children].forEach((i, k) => { i.style.width = `${(parts[k][1] / total) * 100}%`; }); });
  return el('div', {}, bar,
    el('div', { class: 'legend wrap' }, ...parts.map(([n, v, c]) => el('span', {}, el('span', { class: 'sw', style: `background:${c}` }), `${n} ${fmtTok(v)}`))),
    el('div', { class: 'msg', style: 'margin-top:6px', text: `캐시 적중률 ${hit.toFixed(1)}% — 입력 중 캐시에서 읽은 비율 (높을수록 같은 문맥을 싸게 재사용)` }));
}

// ---- ranked horizontal bars ----
function rankBars(items, fmt) { // [{ name, value, sub, tip }]
  const max = Math.max(1, ...items.map((i) => i.value));
  const grid = el('div', { class: 'rank' }, ...items.flatMap((it, k) => [
    el('span', { class: 'nm', text: it.name, title: it.name }),
    el('span', { class: 'track', 'data-tip': it.tip || '' }, el('i', { style: `--i:${k}` })),
    el('span', { class: 'val' }, el('b', { text: fmt(it.value) }), it.sub ? el('small', { text: ' ' + it.sub }) : null)]));
  nextFrame(() => { grid.querySelectorAll('.track i').forEach((i, k) => { i.style.width = `${(items[k].value / max) * 100}%`; }); });
  return grid;
}
function table(headers, rows) {
  return el('table', {}, el('tr', {}, ...headers.map((h) => el('th', { text: h }))),
    ...rows.map((r) => el('tr', {}, ...r.map((c, i) => el('td', { class: i ? 'num' : '', text: c })))));
}
const card = (title, body, extra, cls = '') => el('div', { class: 'card2 ' + cls }, el('h4', {}, title, extra || null), body); // div, not section: the global section rule would let it flex-shrink

function renderStats() {
  const g = ST.data, prices = loadPrices(), pane = $('#stats-detail');
  const n = rangeDays(g.days), cur = rangeRows(g.days, n), prev = rangeRows(g.days, n, 1);
  const delta = (pick) => { const a = sumRows(cur, pick), b = sumRows(prev, pick); return b ? (a - b) / b : null; };
  const series = (pick) => cur.slice(-Math.min(cur.length, 30)).map((r) => (r.b ? pick(r.b) : 0));
  const total = totalOf(g.tokens), totalCost = costOf(g.byModel, prices);
  const activeDays = cur.filter((r) => r.b).length;
  const projects = Object.values(g.byProject).sort((a, b) => b.tokens.output - a.tokens.output);
  const models = Object.entries(g.byModel).sort((a, b) => b[1].output - a[1].output);
  const tools = Object.entries(g.tools).sort((a, b) => b[1] - a[1]);
  const rangeLabel = ST.range ? `최근 ${ST.range}일` : '전체 기간';
  const top = models.slice(0, 6), rest = models.slice(6);
  const donutEntries = [...top.map(([m, b], i) => ({ name: m, value: b.output, color: PALETTE[i % PALETTE.length], sub: `출력 ${fmtTok(b.output)} · ${fmtUsd(cost(b, priceFor(prices, m)))}` })),
    ...(rest.length ? [{ name: `기타 ${rest.length}개`, value: rest.reduce((a, [, b]) => a + b.output, 0), color: PALETTE[8] }] : [])];

  pane.replaceChildren(
    el('div', { class: 'stats-head' },
      el('h3', { text: '전체 통계' }),
      el('span', { class: 'msg', text: `${g.firstTs?.slice(0, 10) || ''} → ${g.lastTs?.slice(0, 10) || ''} · 트랜스크립트가 있는 세션 ${fmtN(g.sessions)}개` }),
      el('span', { class: 'spacer' }),
      S.profiles.length > 1 ? seg([['', '모든 프로파일'], ...S.profiles.map((p) => [p.id, p.id === 'default' ? 'Claude' : p.name])], ST.profile, (v) => { ST.profile = v; ST.data = null; loadStats(); }) : null,
      seg([[7, '7일'], [30, '30일'], [90, '90일'], [0, '전체']], ST.range, (v) => { ST.range = Number(v); renderStats(); }),
      el('button', { text: '↻ 다시 집계', onclick: () => { ST.data = null; loadStats(); } })),
    el('div', { class: 'kpis' },
      kpi(`응답 수 · ${rangeLabel}`, sumRows(cur, (b) => b.msgs), fmtN, { i: 0, spark: series((b) => b.msgs), delta: delta((b) => b.msgs) , n }),
      kpi(`도구 호출 · ${rangeLabel}`, sumRows(cur, (b) => b.tools), fmtN, { i: 1, spark: series((b) => b.tools), delta: delta((b) => b.tools), color: '#5b9cf6' , n }),
      kpi(`출력 토큰 · ${rangeLabel}`, sumRows(cur, (b) => b.output), fmtTok, { i: 2, spark: series((b) => b.output), delta: delta((b) => b.output), color: 'var(--ok)' , n }),
      kpi(`총 토큰 · ${rangeLabel}`, sumRows(cur, totalOf), fmtTok, { i: 3, spark: series(totalOf), delta: delta(totalOf), color: 'var(--warn)' , n }),
      kpi(`활동일 · ${rangeLabel}`, activeDays, fmtN, { i: 4, sub: `${n}일 중 · 하루 평균 출력 ${fmtTok(activeDays ? sumRows(cur, (b) => b.output) / activeDays : 0)}` }),
      kpi('세션 · 전체', g.sessions, fmtN, { i: 5, sub: `사용자 메시지 ${fmtN(g.userMessages)} · 응답 ${fmtN(g.assistantMessages)}` }),
      kpi('총 토큰 · 전체', total, fmtTok, { i: 6, sub: `출력 ${fmtTok(g.tokens.output)} · 캐시 읽기 ${fmtTok(g.tokens.cacheRead)}` }),
      kpi('API 요금 환산 · 전체', totalCost || 0, fmtUsd, { i: 7, sub: '단가표 기준 · 구독에는 청구되지 않음' })),
    card('일별 추이', dayChart(g.days), seg(Object.entries(METRICS).map(([k, [t]]) => [k, t]), ST.metric, (v) => { ST.metric = v; renderStats(); })),
    el('div', { class: 'row2col' },
      card('활동 히트맵', heatmap(g.days), el('span', { class: 'msg', text: '요일 × 주' })),
      card('요일별 평균 출력', weekdayChart(g.days), el('span', { class: 'msg', text: rangeLabel }))),
    el('div', { class: 'row2col' },
      card('모델 비중', donut(donutEntries, fmtTok(g.tokens.output), '출력 토큰'), el('span', { class: 'msg', text: '출력 토큰 기준 · 전체' })),
      card('토큰 구성', tokenMix(g.tokens), el('span', { class: 'msg', text: '전체' }))),
    el('div', { class: 'row2col' },
      card('프로젝트 · 출력 토큰', rankBars(projects.slice(0, 10).map((p) => ({ name: shortPath(p.cwd), value: p.tokens.output, sub: `${fmtN(p.sessions)}세션 · ${fmtUsd(costOf(p.byModel, prices))}`, tip: `${p.cwd}\n메시지 ${fmtN(p.userMessages + p.assistantMessages)} · 도구 ${fmtN(p.toolCalls)} · 총 ${fmtTok(totalOf(p.tokens))}${p.lastTs ? `\n마지막 활동 ${fmtAgo(Date.parse(p.lastTs))}` : ''}` })), fmtTok), el('span', { class: 'msg', text: `상위 ${Math.min(10, projects.length)} / ${projects.length}` })),
      card('도구 호출', rankBars(tools.slice(0, 12).map(([t, c]) => ({ name: t, value: c, sub: `${(c / (g.toolCalls || 1) * 100).toFixed(0)}%` })), fmtN), el('span', { class: 'msg', text: `상위 12 / ${tools.length}` }))),
    el('details', { class: 'tables' }, el('summary', { text: '상세 표 (프로젝트 · 모델)' }),
      el('h4', { text: '프로젝트별' }),
      table(['프로젝트', '세션', '메시지', '도구 호출', '출력 토큰', '총 토큰', 'API 환산', '마지막 활동'],
        projects.map((p) => [shortPath(p.cwd), fmtN(p.sessions), fmtN(p.userMessages + p.assistantMessages), fmtN(p.toolCalls), fmtTok(p.tokens.output), fmtTok(totalOf(p.tokens)), fmtUsd(costOf(p.byModel, prices)), p.lastTs ? fmtAgo(Date.parse(p.lastTs)) : ''])),
      el('h4', { text: '모델별' }),
      table(['모델', '응답', '입력', '캐시 읽기', '캐시 생성', '출력', 'API 환산'],
        models.map(([m, b]) => [m, fmtN(b.msgs), fmtTok(b.input), fmtTok(b.cacheRead), fmtTok(b.cacheCreate), fmtTok(b.output), fmtUsd(cost(b, priceFor(prices, m)))]))),
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
