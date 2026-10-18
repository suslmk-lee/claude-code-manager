const test = require('node:test');
const assert = require('node:assert');
const { mdToAnsi, strWidth } = require('../src/renderer/mdansi.js');

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const lines = (s) => s.split('\r\n');
const boxy = (l) => /[│┌├└]/.test(l);

test('strWidth: ascii, Korean, emoji, ANSI, combining', () => {
  assert.equal(strWidth('abc'), 3);
  assert.equal(strWidth('한글'), 4);
  assert.equal(strWidth('a한b'), 4);
  assert.equal(strWidth('🚀'), 2);
  assert.equal(strWidth('\x1b[1;32m한a\x1b[0m'), 3);
  assert.equal(strWidth('é'), 1);
  assert.equal(strWidth('Ｆ'), 2);
});

test('table with Korean cells has aligned box borders', () => {
  const md = '| 이름 | 설명 | 수 |\n|:--|:-:|--:|\n| **굵게** | `code` 값 | 1 |\n| abc | 한글 텍스트 🚀 | 1234 |';
  const out = lines(mdToAnsi(md, { cols: 80 })).map(strip);
  const tbl = out.filter(boxy);
  assert.equal(tbl.length, 7); // top, header, rule, row, rule, row, bottom (TUI rules every row)
  assert.ok(tbl[0].trimStart().startsWith('┌') && tbl.at(-1).trimStart().startsWith('└'));
  assert.equal(new Set(tbl.map(strWidth)).size, 1);
  const all = out.join('\n');
  assert.ok(!all.includes('**') && !all.includes('`'));
});

test('inline styles produce SGR codes, no markdown marks remain', () => {
  const out = mdToAnsi('## 제목\n\n**bold** and `code` and *em* and ~~gone~~', { cols: 80, indent: 0 });
  assert.match(out, /\x1b\[1m제목\x1b\[0m/);
  assert.match(out, /\x1b\[1mbold\x1b\[0m/);
  assert.match(out, /\x1b\[38;2;177;185;249mcode\x1b\[0m/);
  assert.match(out, /\x1b\[3mem\x1b\[0m/);
  assert.match(out, /\x1b\[9mgone\x1b\[0m/);
  assert.ok(!/\*\*|`|##|~~/.test(strip(out)));
});

test('links, lists, task lists, quote, hr, code block', () => {
  const out = strip(mdToAnsi('[t](http://x)\n\n- a\n  - b\n\n- [x] done\n- [ ] todo\n\n> q\n\n---\n\n```js\nlet a = 1;\n```', { cols: 40, indent: 0 }));
  assert.ok(out.includes('t (http://x)'));
  assert.ok(out.includes('- a\r\n  - b'));
  assert.ok(out.includes('☒ done') && out.includes('☐ todo'));
  assert.ok(out.includes('│ q') && out.includes('─'.repeat(30)));
  assert.ok(out.includes('  let a = 1;') && !out.includes('```'));
});

test('wrapping respects cols with hanging indent', () => {
  const long = '가나다 라마바 사아자 차카타 파하 '.repeat(8) + 'x'.repeat(60);
  const out = lines(mdToAnsi(long, { cols: 40, first: '● ' })).map(strip);
  assert.ok(out.length > 3);
  assert.ok(out[0].startsWith('● '));
  for (const l of out.slice(1)) assert.ok(l.startsWith('  '));
  for (const l of out) assert.ok(strWidth(l) <= 40, `${strWidth(l)}: ${l}`);
});

test('overly wide table fits within cols', () => {
  const md = '| 항목 | 설명 |\n|---|---|\n| 첫째 | ' + '매우 긴 설명 텍스트입니다 '.repeat(10) + ' |\n| b | ' + 'y'.repeat(100) + ' |';
  const out = lines(mdToAnsi(md, { cols: 50 })).map(strip);
  for (const l of out) assert.ok(strWidth(l) <= 50, `${strWidth(l)}: ${l}`);
  const tbl = out.filter(boxy);
  assert.equal(new Set(tbl.map(strWidth)).size, 1);
  assert.ok(tbl.length > 6); // cells wrapped into extra lines
});
