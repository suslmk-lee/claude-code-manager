// Markdown -> ANSI for the read-only terminal live log, imitating the Claude Code TUI.
// Walks marked's token tree; text is laid out as styled segments so wrapping is width-aware and SGR never leaks across lines.
(function () {
const _marked = globalThis.marked || (typeof require === 'function' ? require('marked').marked : null); // renderer is sandboxed: no require there

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
const RST = '\x1b[0m';
const CODE_FG = '38;2;177;185;249'; // Claude's blue-violet for inline code
const WIDE = [[0x1100, 0x115f], [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1faff], [0x20000, 0x3fffd]];
const ZERO = [[0x0300, 0x036f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x20d0, 0x20ff], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f], [0xe0100, 0xe01ef]];
const inR = (cp, rs) => { for (const [a, b] of rs) if (cp >= a && cp <= b) return true; return false; };
function cpWidth(cp) {
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (cp < 0x300) return 1; // ASCII/Latin fast path
  if (inR(cp, ZERO)) return 0;
  return inR(cp, WIDE) ? 2 : 1;
}
function strWidth(s) {
  let w = 0;
  for (const ch of String(s).replace(ANSI_RE, '')) w += cpWidth(ch.codePointAt(0));
  return w;
}
// Cut to `w` cells, ending in … when shortened (ANSI-free input).
function truncW(s, w) {
  s = String(s);
  if (strWidth(s) <= w) return s;
  let out = '', n = 0;
  for (const ch of s) { const cw = cpWidth(ch.codePointAt(0)); if (n + cw > w - 1) break; out += ch; n += cw; }
  return out + '…';
}

const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]); // marked leaves entities in text tokens
const sgr = (a, b) => (a && b ? a + ';' + b : a || b);
const paint = (text, s) => (s ? `\x1b[${s}m${text}${RST}` : text);

// Inline tokens -> [[text, sgr]]; '\n' inside text means a hard break.
function inline(tokens, base = '', out = []) {
  for (const t of tokens || []) {
    switch (t.type) {
      case 'strong': inline(t.tokens, sgr(base, '1'), out); break;
      case 'em': inline(t.tokens, sgr(base, '3'), out); break;
      case 'del': inline(t.tokens, sgr(base, '9'), out); break;
      case 'codespan': out.push([decode(t.text), sgr(base, CODE_FG)]); break;
      case 'br': out.push(['\n', base]); break;
      case 'link': {
        inline(t.tokens, sgr(base, '4'), out);
        if (t.text !== t.href && t.href) out.push([` (${t.href})`, sgr(base, '2')]);
        break;
      }
      case 'image': out.push([`[이미지: ${t.text || t.href}]`, sgr(base, '2')]); break;
      case 'checkbox': out.push([t.checked ? '☒ ' : '☐ ', base]); break;
      case 'text': case 'escape':
        if (t.tokens) inline(t.tokens, base, out); else out.push([decode(t.text), base]);
        break;
      default: out.push([t.raw ?? t.text ?? '', base]); // html etc.: plain text
    }
  }
  return out;
}

// Greedy word wrap of segments to `width` cells; returns lines of ANSI-painted text.
function wrap(segs, width) {
  width = Math.max(1, width);
  const lines = [];
  let cur = [], lw = 0, gap = null; // gap: pending space [text, sgr] (dropped at line start/end)
  const flush = () => { lines.push(cur); cur = []; lw = 0; gap = null; };
  const put = (txt, s, w) => { if (cur.length && cur[cur.length - 1][1] === s) cur[cur.length - 1][0] += txt; else cur.push([txt, s]); lw += w; };
  for (const [text, s] of segs) {
    const parts = text.split('\n');
    parts.forEach((part, pi) => {
      if (pi) flush();
      for (const tok of part.match(/ +|[^ ]+/g) || []) {
        if (tok[0] === ' ') { if (lw) gap = [tok, s]; continue; }
        const w = strWidth(tok);
        if (w <= width) {
          const gw = gap ? gap[0].length : 0;
          if (lw && lw + gw + w > width) flush();
          else if (gap && lw) put(gap[0], gap[1], gw);
          gap = null; put(tok, s, w);
        } else { // overlong token: break by width
          if (gap && lw) put(gap[0], gap[1], gap[0].length);
          gap = null;
          let piece = '', pw = 0;
          for (const ch of tok) {
            const cw = cpWidth(ch.codePointAt(0));
            if (lw + pw + cw > width) { if (piece) put(piece, s, pw); flush(); piece = ''; pw = 0; }
            piece += ch; pw += cw;
          }
          if (piece) put(piece, s, pw);
        }
      }
    });
  }
  if (cur.length || !lines.length) lines.push(cur);
  return lines.map((l) => ({ text: l.map(([t, s]) => paint(t, s)).join(''), w: l.reduce((n, [t]) => n + strWidth(t), 0) }));
}

function table(t, width, base) {
  const n = t.header.length;
  const cell = (c, hdr) => inline(c.tokens, hdr ? sgr(base, '1') : base);
  const grid = [t.header.map((c) => cell(c, true)), ...t.rows.map((r) => r.map((c) => cell(c, false)))];
  const nat = Array.from({ length: n }, (_, i) => Math.max(1, ...grid.map((r) => Math.max(...(r[i] || []).map(([x]) => x).join('').split('\n').map(strWidth)))));
  const cw = nat.slice(), avail = width - (3 * n + 1);
  for (let sum = cw.reduce((a, b) => a + b, 0); sum > avail; sum--) { // shrink the widest column first
    let k = 0; for (let i = 1; i < n; i++) if (cw[i] > cw[k]) k = i;
    if (cw[k] <= 1) break; cw[k]--;
  }
  const bar = (l, m, r) => paint(l + cw.map((w) => '─'.repeat(w + 2)).join(m) + r, base);
  const v = paint('│', base);
  const row = (cells, hdr) => {
    const ls = cells.map((c, i) => wrap(c || [], cw[i]));
    const h = Math.max(...ls.map((x) => x.length));
    const out = [];
    for (let y = 0; y < h; y++) {
      out.push(v + ls.map((x, i) => {
        const { text, w } = x[y] || { text: '', w: 0 }, pad = Math.max(0, cw[i] - w), al = hdr ? 'center' : t.align[i]; // TUI centres header cells
        const l = al === 'right' ? pad : al === 'center' ? pad >> 1 : 0;
        return ' ' + ' '.repeat(l) + text + ' '.repeat(pad - l) + ' ' + v;
      }).join(''));
    }
    return out;
  };
  const body = grid.slice(1).map((r) => row(r));
  const lines = [bar('┌', '┬', '┐'), ...row(grid[0], true), bar('├', '┼', '┤')];
  body.forEach((r, i) => { lines.push(...r); if (i < body.length - 1) lines.push(bar('├', '┼', '┤')); }); // a rule between every row, like the TUI
  lines.push(bar('└', '┴', '┘'));
  return lines;
}

function blocks(tokens, width, base = '', tight = false) {
  const out = [];
  const sep = () => { if (out.length) out.push(''); };
  for (const t of tokens) {
    switch (t.type) {
      case 'space': case 'def': break;
      case 'heading': sep(); out.push(...wrap(inline(t.tokens, sgr(base, t.depth === 1 ? '1;4' : '1')), width).map((l) => l.text)); break;
      case 'paragraph': sep(); out.push(...wrap(inline(t.tokens, base), width).map((l) => l.text)); break;
      case 'text': out.push(...wrap(inline(t.tokens || [t], base), width).map((l) => l.text)); break; // tight list item body
      case 'html': sep(); out.push(...wrap([[t.text.replace(/\n+$/, ''), base]], width).map((l) => l.text)); break;
      case 'code': sep(); for (const l of t.text.split('\n')) out.push('  ' + paint(l, sgr(base, '2'))); break;
      case 'hr': sep(); out.push(paint('─'.repeat(width), '2')); break;
      case 'blockquote': sep(); for (const l of blocks(t.tokens, width - 2, sgr(base, '3'))) out.push(paint('│', '2') + ' ' + l); break;
      case 'table': sep(); out.push(...table(t, width, base)); break;
      case 'list': {
        if (!tight) sep(); // nested list in a tight item hugs its parent line
        t.items.forEach((it, i) => {
          const mk = t.ordered ? `${(+t.start || 1) + i}. ` : '- ';
          const body = blocks(it.tokens, width - mk.length, base, true); // TUI lists are compact even when the source is loose
          body.forEach((l, j) => out.push(j ? (l ? ' '.repeat(mk.length) + l : l) : mk + l));
          if (!body.length) out.push(mk);
        });
        break;
      }
      default: sep(); out.push(...wrap([[t.raw || t.text || '', base]], width).map((l) => l.text));
    }
  }
  return out;
}

// opts.first: prefix for the first line (visible width must equal opts.indent); later lines get `indent` spaces.
function mdToAnsi(md, { cols = 80, indent = 2, first = ' '.repeat(indent) } = {}) {
  const width = Math.max(10, cols - indent - 1); // -1: never touch the last column (avoids deferred-wrap quirks)
  let lines;
  try { lines = blocks(_marked.lexer(String(md || ''), { gfm: true }), width); } catch { lines = String(md || '').split('\n'); }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) lines = [''];
  return lines.map((l, i) => (i ? (l ? ' '.repeat(indent) + l : l) : first + l)).join('\r\n');
}

const api = { mdToAnsi, strWidth, truncW };
if (typeof module !== 'undefined') module.exports = api; else Object.assign(globalThis, api); // IIFE: classic-script consts would otherwise clash with other renderer files
})();
