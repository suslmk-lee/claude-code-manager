'use strict';
// 폴더 이동: moves a workspace folder and carries Claude Code's state with it, so its sessions, memory, trust and background
// jobs keep working at the new path. For every profile (~/.claude and ~/.claude-<id>):
//   projects/<encoded old>  → projects/<encoded new>   transcripts and memory travel inside; paths in them are rewritten
//   .claude.json            → project keys (trust, allowed tools, mcp…) re-keyed; any path value under the folder follows
//   history.jsonl           → the `project` of every prompt line
//   jobs/<short>/state.json → `cwd` of background jobs, so respawn lands in the new place
// Background sessions running in the folder are stopped first and respawned at the end; a session run from a plain
// terminal blocks the move (we cannot stop it). Everything is one prefix rewrite: the old path followed by `"` or `/`.
const fs = require('fs'), fsp = require('fs/promises'), path = require('path'), os = require('os'), readline = require('readline');
const { execFile } = require('child_process');
const data = require('./data');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const under = (p, dir) => p === dir || p.startsWith(dir + path.sep);
// inside JSON text: every string that is exactly `old` or starts with `old/` — keys and values alike (a sibling `old-x` is not touched)
const jsonRe = (old) => new RegExp('"' + esc(JSON.stringify(old).slice(1, -1)) + '(?=["/\\\\])', 'g');
const jsonRepl = (to) => '"' + JSON.stringify(to).slice(1, -1);
// inside markdown (memory files): the path followed by a separator, punctuation or the end of the line
const textRe = (old) => new RegExp(esc(old) + '(?=[/\\s"\'`)\\]>,.;:]|$)', 'gm');
const configFile = (p) => (p.dir === path.join(os.homedir(), '.claude') ? path.join(os.homedir(), '.claude.json') : path.join(p.dir, '.claude.json'));
const countRe = (text, re) => (text.match(re) || []).length;
const readText = async (f) => { try { return await fsp.readFile(f, 'utf8'); } catch { return null; } };
async function writeAtomic(file, text) { const tmp = `${file}.ccm-tmp`; await fsp.writeFile(tmp, text); await fsp.rename(tmp, file); }
async function rewriteFile(file, re, repl) { // whole file in memory: config, history, job state, memory notes
  const text = await readText(file); if (text == null) return 0;
  let n = 0; const out = text.replace(re, () => { n++; return repl; });
  if (n) await writeAtomic(file, out);
  return n;
}
async function rewriteLines(file, re, repl) { // transcripts can be hundreds of MB: stream line by line into a sibling file, then swap
  const tmp = `${file}.ccm-tmp`; let n = 0;
  const out = fs.createWriteStream(tmp);
  for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
    const l = line.replace(re, () => { n++; return repl; });
    if (!out.write(l + '\n')) await new Promise((r) => out.once('drain', r));
  }
  await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
  if (n) await fsp.rename(tmp, file); else await fsp.unlink(tmp);
  return n;
}
// the real path a projects/<encoded> dir stands for: the launch cwd on the first transcript line (the dir name is its encoding)
async function realPathOf(dir, enc) {
  let names = []; try { names = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl')); } catch { return null; }
  for (const f of names) {
    let fh; try { fh = await fsp.open(path.join(dir, f), 'r'); const buf = Buffer.alloc(65536); const { bytesRead } = await fh.read(buf, 0, buf.length, 0); for (const m of buf.toString('utf8', 0, bytesRead).matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)) { const cwd = JSON.parse(`"${m[1]}"`); if (data.encodeProject(cwd) === enc) return cwd; } } catch { /* next */ } finally { await fh?.close(); }
  }
  return null;
}
// what inside the folder bakes its own absolute path in: Python venvs (activate scripts, shebangs, editable installs) and git
// worktrees (the checkout's .git file and the repo's .git/worktrees/<n>/gitdir point at each other by absolute path)
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.cache', '__pycache__', '.next', '.turbo', '.gradle']);
const ls = async (d) => { try { return await fsp.readdir(d); } catch { return []; } };
async function scanInside(root) { // worktrees: { path, repo } — the checkout and the main repo it belongs to (either may be outside root)
  const venvs = [], worktrees = new Map(), repos = [];
  const walk = async (dir, depth) => {
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (ents.some((e) => e.isFile() && e.name === 'pyvenv.cfg')) { venvs.push(dir); return; }
    const git = ents.find((e) => e.name === '.git');
    if (git?.isFile()) { try { const m = /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/]+\s*$/m.exec(await fsp.readFile(path.join(dir, '.git'), 'utf8')); if (m) worktrees.set(dir, { path: dir, repo: path.resolve(dir, m[1]) }); } catch { /* unreadable */ } }
    if (git?.isDirectory()) { repos.push(dir); for (const n of await ls(path.join(dir, '.git', 'worktrees'))) { try { const w = path.resolve(path.dirname((await fsp.readFile(path.join(dir, '.git', 'worktrees', n, 'gitdir'), 'utf8')).trim())); /* resolve: git writes C:/… on Windows, keys must match the checkout side's C:… */ worktrees.set(w, { path: w, repo: dir }); } catch { /* stale entry */ } } }
    if (depth >= 6) return;
    for (const e of ents) if (e.isDirectory() && !SKIP.has(e.name)) await walk(path.join(dir, e.name), depth + 1);
  };
  await walk(root, 0);
  return { venvs, worktrees: [...worktrees.values()], repos };
}
const git = (cwd, ...args) => new Promise((res) => execFile('git', ['-C', cwd, ...args], { timeout: 20000 }, (e, out, err) => res({ ok: !e, output: (out + err).trim() })));
const venvRe = (old) => new RegExp(esc(old) + '(?=[/\\\\"\'\\s]|$)', 'gm'); // \ too: Windows paths (C:\old\.venv\…)
async function fixVenv(dir, from, to) { // the venv is already at its new place; rewrite what still says the old folder
  // a Windows path appears three ways in a venv: C:\old (scripts, .pth), C:/old (pip's file:/// URLs), C:\\old (JSON); POSIX: one
  const alt = (p) => [p, p.replace(/\\/g, '/'), p.replace(/\\/g, '\\\\')];
  const pairs = alt(from).map((f, i) => [f, alt(to)[i]]).filter(([f], i, a) => a.findIndex(([g]) => g === f) === i).map(([f, t]) => [venvRe(f), t]);
  const fix = async (p) => { let k = 0; for (const [re, t] of pairs) k += await rewriteFile(p, re, t); return k; };
  let n = 0;
  for (const bin of ['bin', 'Scripts'].map((d) => path.join(dir, d))) for (const f of await ls(bin)) { // Scripts: Windows venvs; bin: POSIX ones (also Git Bash / WSL)
    const p = path.join(bin, f); let st; try { st = await fsp.lstat(p); } catch { continue; }
    if (!st.isFile()) continue; // symlinks (python → the base interpreter) are fine
    let head = ''; let fh; try { fh = await fsp.open(p, 'r'); const b = Buffer.alloc(2); await fh.read(b, 0, 2, 0); head = b.toString('latin1'); } catch { /* skip */ } finally { await fh?.close(); }
    if (head === '#!' || /^activate/i.test(f)) n += await fix(p); // scripts only; a real binary is left alone
  }
  // site-packages: lib/python3.x/site-packages (POSIX) or Lib\site-packages (Windows)
  const sps = [path.join(dir, 'lib', 'site-packages'), ...(await ls(path.join(dir, 'lib'))).map((v) => path.join(dir, 'lib', v, 'site-packages'))];
  for (const sp of sps) for (const f of await ls(sp)) {
    if (f.endsWith('.pth') || f.endsWith('.egg-link')) n += await fix(path.join(sp, f));
    else if (f.endsWith('.dist-info')) n += await fix(path.join(sp, f, 'direct_url.json'));
  }
  n += await fix(path.join(dir, 'pyvenv.cfg'));
  return n;
}
async function listJobStates(p) {
  const out = []; let names = []; try { names = await fsp.readdir(path.join(p.dir, 'jobs')); } catch { return out; }
  for (const n of names) { const f = path.join(p.dir, 'jobs', n, 'state.json'); if (/^[0-9a-f]{8}$/.test(n) && fs.existsSync(f)) out.push(f); }
  return out;
}

// what a move would touch; `errors` non-empty = cannot proceed. ctx lets tests point at a scratch home.
async function planMove({ from, to }, ctx = {}) {
  // canonical paths: git (worktree links) and Claude (cwd) record realpaths, so a symlinked component would never match
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  from = real(from); to = path.join(real(path.dirname(to)), path.basename(to));
  const errors = [], re = jsonRe(from);
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory()) errors.push(`원본 폴더가 없습니다: ${from}`);
  if (from === to) errors.push('같은 경로입니다');
  else if (fs.existsSync(to)) errors.push(`대상 경로가 이미 있습니다: ${to}`);
  if (under(to, from)) errors.push('폴더를 자기 안으로 옮길 수 없습니다');
  if (!fs.existsSync(path.dirname(to))) errors.push(`상위 폴더가 없습니다: ${path.dirname(to)}`);
  const sessions = ctx.sessions || await data.listSessions();
  const live = sessions.filter((s) => s.live && s.cwd && under(s.cwd, from)).map((s) => ({ name: s.name, short: s.short, sessionId: s.sessionId, profile: s.profile, bg: s.kind === 'background' }));
  const stuck = live.filter((s) => !s.bg);
  if (stuck.length) errors.push(`터미널에서 직접 실행 중인 세션이 있어 먼저 종료해야 합니다: ${stuck.map((s) => s.name).join(', ')}`);
  const profiles = [];
  for (const p of ctx.profiles || data.profiles()) {
    const projDirs = [], unsure = [], projRoot = path.join(p.dir, 'projects');
    let names = []; try { names = await fsp.readdir(projRoot); } catch { /* no projects */ }
    const encFrom = data.encodeProject(from);
    const insideEnc = new Map(), outsideEnc = new Set(); // folders by their encoding: inside `from` (candidates) and next to it (collisions)
    const collect = async (dir, depth, into) => { for (const n of await ls(dir)) { const d = path.join(dir, n); if (SKIP.has(n)) continue; let st; try { st = await fsp.stat(d); } catch { continue; } if (!st.isDirectory()) continue; into(d); if (depth < 4) await collect(d, depth + 1, into); } };
    if (fs.existsSync(from)) await collect(from, 1, (d) => insideEnc.set(data.encodeProject(d), d));
    for (const n of await ls(path.dirname(from))) { const d = path.join(path.dirname(from), n); if (d === from) continue; outsideEnc.add(data.encodeProject(d)); for (const k of await ls(d)) outsideEnc.add(data.encodeProject(path.join(d, k))); }
    for (const enc of names) {
      if (!enc.startsWith(encFrom)) continue; // only an exact or longer encoding can be the folder or something inside it
      const dir = path.join(projRoot, enc);
      if (!fs.statSync(dir).isDirectory()) continue;
      const real = (await realPathOf(dir, enc)) || (enc === encFrom ? from : null) || (insideEnc.has(enc) && !outsideEnc.has(enc) ? insideEnc.get(enc) : null); // transcripts first; else a folder inside that encodes to it, unless a neighbour does too
      if (!real) { if (enc !== encFrom) unsure.push(enc); continue; }
      if (!under(real, from)) continue; // a sibling like old-docs encodes to the same prefix
      const newReal = to + real.slice(from.length), newEnc = data.encodeProject(newReal);
      const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.jsonl')).length;
      const exists = fs.existsSync(path.join(projRoot, newEnc));
      if (exists) errors.push(`새 경로의 기록 폴더가 이미 있습니다 (${p.id}): ${newEnc}`);
      projDirs.push({ enc, newEnc, real, newReal, files, exists });
    }
    const cfg = await readText(configFile(p)), hist = await readText(path.join(p.dir, 'history.jsonl'));
    let jobs = 0; for (const f of await listJobStates(p)) jobs += countRe((await readText(f)) || '', re) ? 1 : 0;
    profiles.push({ id: p.id, dir: p.dir, projDirs, unsure, config: cfg ? countRe(cfg, re) : 0, history: hist ? countRe(hist, re) : 0, jobs });
  }
  const inside = fs.existsSync(from) ? await scanInside(from) : { venvs: [], worktrees: [], repos: [] };
  return { from, to, errors, live, profiles, venvs: inside.venvs, worktrees: inside.worktrees, repos: inside.repos };
}

async function waitStopped(s, ctx) { // `claude stop` returns before the process is gone; moving under a writer would corrupt its transcript
  for (let i = 0; i < 20; i++) {
    const cur = (ctx.sessions || await data.listSessions()).find((x) => x.sessionId === s.sessionId);
    if (!cur || !cur.live) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function moveFolder({ from, to }, ctx = {}) {
  const plan = await planMove({ from, to }, ctx);
  if (plan.errors.length) throw new Error(plan.errors.join('\n'));
  ({ from, to } = plan);
  const log = [], re = jsonRe(from), repl = jsonRepl(to), tre = textRe(from);
  const act = ctx.agentAction || data.agentAction;
  for (const s of plan.live) {
    const r = await act('stop', s.short, s.profile);
    if (!r.ok || !(await waitStopped(s, ctx))) throw new Error(`세션을 중지하지 못했습니다: ${s.name}\n${r.output || ''}`.trim());
    log.push(`중지: ${s.name}`);
  }
  await fsp.rename(from, to);
  log.push(`폴더 이동: ${from} → ${to}`);
  for (const p of plan.profiles) {
    const tag = p.id === 'default' ? '' : ` (${p.id})`;
    for (const d of p.projDirs) {
      const newDir = path.join(p.dir, 'projects', d.newEnc);
      await fsp.rename(path.join(p.dir, 'projects', d.enc), newDir);
      let lines = 0, notes = 0;
      for (const f of await fsp.readdir(newDir)) if (f.endsWith('.jsonl')) lines += await rewriteLines(path.join(newDir, f), re, repl);
      for (const f of ['MEMORY.md', ...(fs.existsSync(path.join(newDir, 'memory')) ? (await fsp.readdir(path.join(newDir, 'memory'))).map((x) => `memory/${x}`) : [])]) if (f.endsWith('.md')) notes += await rewriteFile(path.join(newDir, f), tre, to);
      log.push(`기록 폴더${tag}: ${d.enc} → ${d.newEnc} (트랜스크립트 ${d.files}개, 경로 ${lines}곳, 메모리 ${notes}곳)`);
    }
    const c = await rewriteFile(configFile(p), re, repl); if (c) log.push(`신뢰·설정${tag}: ${c}곳`);
    const h = await rewriteFile(path.join(p.dir, 'history.jsonl'), re, repl); if (h) log.push(`히스토리${tag}: ${h}줄`);
    let j = 0; for (const f of await listJobStates(p)) j += (await rewriteFile(f, re, repl)) ? 1 : 0; if (j) log.push(`잡 기록${tag}: ${j}개`);
    if (p.unsure.length) log.push(`확인 필요${tag}: 실제 경로를 알 수 없어 그대로 둔 기록 폴더 ${p.unsure.join(', ')}`);
  }
  const moved = (p) => (under(p, from) ? to + p.slice(from.length) : p);
  for (const v of plan.venvs) log.push(`가상환경 고침: ${moved(v)} (경로 ${await fixVenv(moved(v), from, to)}곳)`);
  // worktrees: `git worktree repair <paths>` run in each main repo (at its new place if it moved too) relinks both sides
  const byRepo = new Map(); for (const w of plan.worktrees) { const r = moved(w.repo); if (!byRepo.has(r)) byRepo.set(r, []); byRepo.get(r).push(moved(w.path)); }
  for (const [r, paths] of byRepo) { const g = await git(r, 'worktree', 'repair', ...paths); log.push(`${g.ok ? '워크트리 복구' : '워크트리 복구 실패'}: ${paths.join(', ')}${g.output ? ` — ${g.output}` : ''}`); }
  for (const s of plan.live) { const r = await act('respawn', s.short, s.profile); log.push(`${r.ok ? '재시작' : '재시작 실패'}: ${s.name}${r.ok ? '' : ` — ${r.output}`}`); }
  return { ok: true, from, to, log };
}

module.exports = { planMove, moveFolder, jsonRe, textRe, scanInside, fixVenv };
