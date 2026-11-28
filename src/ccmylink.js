'use strict';
// CCMy 협업: two sessions that develop together talk through the app, which keeps the record (~/.claude/ccmy/links/<id>.md).
// A session says something to its partner by ending a reply with
//   @@협업 요청|알림|참고|완료
//   …
//   @@끝
// The window (src/renderer/ccmy.js) finds such blocks in the session's transcript when it stops, appends them here and hands
// them to the partner as typed text. The sessions never touch a file for this: a background session edits inside its own git
// worktree and asks before writing anywhere else, so a file both sides write turned out not to work (tried first).
const fs = require('fs');
const path = require('path');
const mem = require('./ccmymem');

const BLOCK = /^[ \t]*@@협업[ \t]+(요청|알림|참고|완료)[ \t]*\n([\s\S]*?)\n?[ \t]*@@끝[ \t]*$/gm;
const parse = (text) => [...String(text || '').matchAll(BLOCK)].map(([, kind, body]) => ({ kind, text: body.trim().slice(0, 4000) })).filter((b) => b.text || b.kind === '완료');
const file = (id) => { if (!/^[a-z0-9]{1,12}$/.test(String(id))) throw new Error('bad link id'); return path.join(mem.home(), 'links', `${id}.md`); };
function start(id, header) { const f = file(id); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, header); return f; }
function append(id, entries, at = new Date()) {
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  fs.appendFileSync(file(id), entries.map((e) => `## ${hm} · ${String(e.name).replace(/\s+/g, ' ')} · ${e.kind}\n${e.text || '(내용 없음)'}\n\n`).join(''));
}
module.exports = { parse, file, start, append };
