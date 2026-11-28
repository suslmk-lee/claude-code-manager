'use strict';
// CCMy's memory: plain files in one folder (~/.claude/ccmy), so the user can open and edit them.
//   notes.md               지침. "# 전체" applies everywhere, "# <folder>" to sessions in that folder and below; one "- …" line each
//   journal/YYYY-MM-DD.md  작업 일지. one "- HH:MM · <session> (<folder>) :: <what was done>" line per finished piece of work
//   handoff/<folder>.md      인수인계 메모. per project folder, the last few "한 일 / 남은 일 / 막힌 점" entries; goes into the first
//                          prompt of a session CCMy starts in that folder
// Notes reach the agent's prompt, so they are small on purpose: one line each, capped in length and number.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ALL = '전체', MAX_NOTES = 60, MAX_LEN = 300;
const home = () => process.env.CCMY_HOME || path.join(os.homedir(), '.claude', 'ccmy');
const notesFile = () => path.join(home(), 'notes.md');
const one = (t, n = MAX_LEN) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function parse(text) { // → [{ scope: '전체' | folder, text }]
  const notes = []; let scope = ALL;
  for (const l of String(text || '').split('\n')) {
    const h = /^#+\s+(.+?)\s*$/.exec(l), b = /^\s*[-*]\s+(.+?)\s*$/.exec(l);
    if (h) scope = h[1]; else if (b) notes.push({ scope, text: b[1] });
  }
  return notes;
}
const format = (notes) => [...new Set([ALL, ...notes.map((n) => n.scope)])].map((s) => `# ${s}\n${notes.filter((n) => n.scope === s).map((n) => `- ${n.text}`).join('\n')}\n`).join('\n');
function load() { try { return parse(fs.readFileSync(notesFile(), 'utf8')); } catch { return []; } }
function save(notes) { fs.mkdirSync(home(), { recursive: true }); const tmp = notesFile() + '.tmp'; fs.writeFileSync(tmp, format(notes)); fs.renameSync(tmp, notesFile()); }
function add(text, scope) { // → the saved note; throws with a message for the user when it cannot be kept
  const note = { scope: one(scope, 400) || ALL, text: one(text) }, notes = load();
  if (!note.text) throw new Error('기억할 내용이 없습니다.');
  if (notes.some((n) => n.scope === note.scope && n.text === note.text)) return note;
  if (notes.length >= MAX_NOTES) throw new Error(`지침은 ${MAX_NOTES}개까지 둘 수 있습니다. 모양 › 기억에서 안 쓰는 것을 지워 주세요.`);
  save([...notes, note]); return note;
}
function del(text, scope) { // exact (scope given, from the settings list) or by a part of the text (the agent's forget) → removed notes
  const notes = load(), hit = notes.filter((n) => scope ? n.scope === scope && n.text === text : n.text.includes(text));
  if (hit.length) save(notes.filter((n) => !hit.includes(n)));
  return hit;
}
// the notes that apply to a session folder: 전체 + its own folder and the folders above it
const under = (cwd, scope) => cwd === scope || String(cwd || '').startsWith(scope.replace(/\/+$/, '') + '/');
const notesFor = (cwd, notes = load()) => notes.filter((n) => n.scope === ALL || under(cwd, n.scope));

function journalAdd({ name, cwd, text }, at = new Date()) {
  const dir = path.join(home(), 'journal'), line = `- ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} · ${one(name, 80)}${cwd ? ` (${path.basename(cwd)})` : ''} :: ${one(text)}\n`;
  fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, day(at) + '.md'), line);
  return line;
}
function journalRead({ days = 2, query = '' } = {}, now = new Date()) { // newest day first; only days that have lines
  const outp = [], q = query.trim().toLowerCase();
  for (let i = 0; i < Math.min(Math.max(days, 1), 31); i++) {
    const d = day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    let lines = [];
    try { lines = fs.readFileSync(path.join(home(), 'journal', d + '.md'), 'utf8').split('\n').filter((l) => l.trim() && (!q || l.toLowerCase().includes(q))); } catch { /* no work that day */ }
    if (lines.length) outp.push(`## ${d}\n${lines.join('\n')}`);
  }
  return outp.join('\n\n').slice(0, 12000);
}
const HANDOFF_KEEP = 5;
const handoffFile = (cwd) => path.join(home(), 'handoff', String(cwd).replace(/[^A-Za-z0-9가-힣._-]+/g, '-').replace(/^-+/, '').slice(-150) + '.md');
function handoffAdd(cwd, { name, did, left, blocked }, at = new Date()) { // newest first, the last HANDOFF_KEEP kept
  if (!cwd || !one(did)) return null;
  const f = handoffFile(cwd), none = (t) => one(t) || '없음';
  const entry = `## ${day(at)} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} · ${one(name, 80)}\n- 한 일: ${one(did)}\n- 남은 일: ${none(left)}\n- 막힌 점: ${none(blocked)}\n`;
  let old = []; try { old = fs.readFileSync(f, 'utf8').split(/\n(?=## )/).filter((e) => e.startsWith('## ')); } catch { /* first entry */ }
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, [entry, ...old].slice(0, HANDOFF_KEEP).map((e) => e.trim()).join('\n\n') + '\n');
  return entry;
}
function handoffRead(cwd) { try { return fs.readFileSync(handoffFile(cwd), 'utf8').trim(); } catch { return ''; } }
module.exports = { handoffAdd, handoffRead, ALL, home, load, add, del, notesFor, format, parse, journalAdd, journalRead };
