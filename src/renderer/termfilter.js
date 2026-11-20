'use strict';
// What the terminal sends to a Claude session: with mouse tracking on, xterm reports every click as an escape sequence and the
// fullscreen TUI acts on it (a click on the status line opens the background-agents list; a prompt typed there starts a new
// agent — "이름 (2)"). dropClicks removes button press / release / drag reports and keeps wheel reports, so scrolling still works.
(() => {
  const SGR = /\x1b\[<(\d+);\d+;\d+[Mm]/g;           // CSI < Cb ; Px ; Py M|m   (DECSET 1006)
  const X10 = /\x1b\[M([\x20-\xff])[\x20-\xff]{2}/g;  // CSI M Cb Px Py           (legacy, Cb = 32 + code)
  const wheel = (cb) => (cb & 0x43) >= 64; // bit 6 marks the wheel (64/65 ± modifiers); buttons 0-2, with motion (32) or modifiers, are clicks
  const dropClicks = (s) => (s.includes('\x1b[') ? s.replace(SGR, (m, cb) => (wheel(Number(cb)) ? m : '')).replace(X10, (m, b) => (wheel(b.charCodeAt(0) - 32) ? m : '')) : s);
  // What a terminal sends on its own, not typing: mouse / focus reports, and replies to the program's queries — cursor
  // position (CSI ? r ; c R), device attributes (… c, also CSI > … c), mode reports (… $ y), window reports (… t), DSR
  // (… n), the kitty keyboard flags (CSI ? … u), OSC and DCS replies. Keystrokes never end in those finals.
  const REPORT = /^\x1b(?:\[(?:[<MIO]|[?>]?[\d;]*(?:R|c|\$y|t|n)|\?[\d;]*u)|\]|P)/;
  const isTermReport = (s) => REPORT.test(s);
  const api = { dropClicks, isTermReport };
  if (typeof module !== 'undefined') module.exports = api; else Object.assign(globalThis, api);
})();
