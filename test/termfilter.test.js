'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dropClicks, isTermReport } = require('../src/renderer/termfilter');

test('dropClicks removes click reports and keeps wheel reports and keys', () => {
  const press = '\x1b[<0;10;5M', release = '\x1b[<0;10;5m', drag = '\x1b[<32;11;5M', right = '\x1b[<2;10;5M', ctrlClick = '\x1b[<16;10;5M';
  const wheelUp = '\x1b[<64;10;5M', wheelDown = '\x1b[<65;10;5M', shiftWheel = '\x1b[<68;10;5M';
  assert.equal(dropClicks(press + release), '');
  assert.equal(dropClicks(drag + right + ctrlClick), '');
  assert.equal(dropClicks(wheelUp + wheelDown + shiftWheel), wheelUp + wheelDown + shiftWheel);
  assert.equal(dropClicks(`a${press}b${wheelUp}c`), `ab${wheelUp}c`);
  assert.equal(dropClicks('hello\r'), 'hello\r');
  assert.equal(dropClicks('\x1b[A\x1b[1;5F'), '\x1b[A\x1b[1;5F'); // arrow and Ctrl+End untouched
  // legacy X10 encoding: Cb = 32 + code; 32 = left press, 35 = release, 96 = wheel up
  assert.equal(dropClicks('\x1b[M !!' + '\x1b[M#!!'), '');
  assert.equal(dropClicks('\x1b[M`!!'), '\x1b[M`!!');
});

test('isTermReport: query replies and mouse/focus reports are not keystrokes', () => {
  for (const r of ['\x1b[?43;3R', '\x1b[12;40R', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[?2026;2$y', '\x1b[8;40;120t', '\x1b[0n', '\x1b[?0u', '\x1b]11;rgb:1111/1313/1717\x1b\\', '\x1bP>|xterm\x1b\\', '\x1b[<64;5;5M', '\x1b[<0;5;5m', '\x1b[M !!', '\x1b[I', '\x1b[O']) assert.equal(isTermReport(r), true, JSON.stringify(r));
  for (const k of ['a', '\r', '\x1b', '\x1b[A', '\x1b[5~', '\x1b[1;5F', '\x1b[Z', '\x1bOA', '\x1b[97;5u', '\x7f', '\x03']) assert.equal(isTermReport(k), false, JSON.stringify(k));
});
