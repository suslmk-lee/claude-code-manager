'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dropClicks } = require('../src/renderer/termfilter');

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
