'use strict';
// What the terminal sends to a Claude session: with mouse tracking on, xterm reports every click as an escape sequence and the
// fullscreen TUI acts on it (a click on the status line opens the background-agents list; a prompt typed there starts a new
// agent — "이름 (2)"). dropClicks removes button press / release / drag reports and keeps wheel reports, so scrolling still works.
(() => {
  const SGR = /\x1b\[<(\d+);\d+;\d+[Mm]/g;           // CSI < Cb ; Px ; Py M|m   (DECSET 1006)
  const X10 = /\x1b\[M([\x20-\xff])[\x20-\xff]{2}/g;  // CSI M Cb Px Py           (legacy, Cb = 32 + code)
  const wheel = (cb) => (cb & 0x43) >= 64; // bit 6 marks the wheel (64/65 ± modifiers); buttons 0-2, with motion (32) or modifiers, are clicks
  const dropClicks = (s) => (s.includes('\x1b[') ? s.replace(SGR, (m, cb) => (wheel(Number(cb)) ? m : '')).replace(X10, (m, b) => (wheel(b.charCodeAt(0) - 32) ? m : '')) : s);
  const api = { dropClicks };
  if (typeof module !== 'undefined') module.exports = api; else Object.assign(globalThis, api);
})();
