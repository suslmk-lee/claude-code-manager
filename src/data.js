'use strict';
// Read-only access to ~/.claude (sessions, transcripts, jobs, memory) plus the few
// writes we need (memory copy). No Electron dependency so it is testable with plain node.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const HOME = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'); // the default profile's config dir
const PROJECTS = path.join(HOME, 'projects');
const JOBS = path.join(HOME, 'jobs');
let CACHE = path.join(os.tmpdir(), 'claude-code-manager-cache');

const IS_WIN = process.platform === 'win32';
const EXTRA_PATH = IS_WIN
  ? [path.join(process.env.USERPROFILE || os.homedir(), '.local', 'bin'), process.env.APPDATA && path.join(process.env.APPDATA, 'npm'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'claude')].filter(Boolean)
  : [path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'];
// Markers a parent Claude Code session puts into its children's environment. If this app was launched from
// inside a Claude Code session (e.g. `npm start` in its terminal), the sessions we spawn would inherit them and
// run as "child sessions" with transcript saving off. They are never meant for the sessions we start.
const SESSION_MARKERS = /^(CLAUDECODE|CLAUDE_PID|CLAUDE_JOB_DIR|CLAUDE_EFFORT|CLAUDE_CODE_(CHILD_SESSION|ENTRYPOINT|EXECPATH|MESSAGING_SOCKET|MESSAGING_TOKEN|SESSION_ATTENDED|SESSION_ID|SSE_PORT))$/;
function env() {
  const e = {};
  let pk = 'PATH', pv = ''; // Windows env keys are case-insensitive (`Path`): a plain-object copy must hold exactly one PATH-like key
  for (const [k, v] of Object.entries(process.env)) {
    if (SESSION_MARKERS.test(k)) continue;
    if (k === 'PATH' || (IS_WIN && k.toUpperCase() === 'PATH')) { if (!pv) { pk = k; pv = v || ''; } } else e[k] = v;
  }
  e[pk] = [...EXTRA_PATH, pv].join(path.delimiter);
  return e;
}
const isCmd = (bin) => IS_WIN && /\.(cmd|bat)$/i.test(bin);
function findClaude() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const dirs = IS_WIN ? [...EXTRA_PATH, ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)] : EXTRA_PATH;
  for (const name of IS_WIN ? ['claude.exe', 'claude.cmd'] : ['claude']) { // prefer .exe: .cmd needs a shell
    for (const d of dirs) {
      const p = path.join(d, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return 'claude';
}

// ---------- profiles: one Claude Code config dir each ----------
// The default profile is ~/.claude (or $CLAUDE_CONFIG_DIR). Sibling dirs named like it plus "-<id>" that hold a
// settings.json or projects/ are further profiles (e.g. ~/.claude-samanda: the same Claude Code pointed at another
// model/gateway, with its own sessions, transcripts, jobs and memory). A session belongs to exactly one profile and
// every CLI call for it runs with that profile's CLAUDE_CONFIG_DIR — through a `claude-<id>` launcher on PATH when
// one exists, since such a launcher may do its own setup (start a local proxy…) before exec'ing claude.
let profileCache = { at: 0, v: null };
function profiles() {
  if (profileCache.v && Date.now() - profileCache.at < 10000) return profileCache.v;
  const base = path.basename(HOME), parent = path.dirname(HOME);
  const out = [{ id: 'default', name: 'Claude', dir: HOME, model: null }];
  let entries = []; try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch { /* no parent */ }
  for (const e of entries) {
    if (!e.isDirectory() || !e.name.startsWith(base + '-')) continue;
    const dir = path.join(parent, e.name), id = e.name.slice(base.length + 1);
    if (!/^[A-Za-z0-9_.-]+$/.test(id) || !(fs.existsSync(path.join(dir, 'settings.json')) || fs.existsSync(path.join(dir, 'projects')))) continue;
    let model = null; try { model = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).model || null; } catch { /* no settings */ }
    out.push({ id, name: id, dir, model });
  }
  profileCache = { at: Date.now(), v: out };
  return out;
}
const profile = (id) => profiles().find((p) => p.id === id) || profiles()[0];
const pdir = (p, ...parts) => path.join(p.dir, ...parts);
const findBin = (name) => { for (const d of EXTRA_PATH) { const f = path.join(d, name); if (fs.existsSync(f)) return f; } return null; };
// Binary + env that run Claude Code for a profile. launch=true prefers the profile's own `claude-<id>` launcher
// (it may prepare things before exec'ing claude); plain queries (agents, --version) skip it for speed.
function launcher(profileId, { launch = false } = {}) {
  const p = profile(profileId), e = env();
  if (p.id === 'default') return { bin: findClaude(), env: e, profile: p };
  e.CLAUDE_CONFIG_DIR = p.dir;
  const wrapper = launch && !IS_WIN ? findBin(`claude-${p.id}`) : null;
  return { bin: wrapper || findClaude(), env: e, profile: p };
}
function listProfiles() { profileCache.at = 0; return profiles().map((p) => ({ ...p })); }

function claude(args, opts = {}) {
  return new Promise((resolve) => {
    const L = launcher(opts.profile, { launch: !!opts.launch });
    let bin = L.bin, a = args;
    // stdin must be closed: given an open (empty) pipe, Claude Code waits ~3 s for piped prompt input before every
    // command — that was the pause behind 시작 and behind each session-list refresh. execFile cannot close it; spawn can.
    const o = { env: L.env, cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
    if (isCmd(bin)) { o.shell = true; bin = `"${bin}"`; a = args.map((x) => `"${String(x).replace(/"/g, '""')}"`); } // Node refuses .cmd/.bat without a shell; quote for cmd.exe
    let stdout = '', stderr = '', p;
    try { p = spawn(bin, a, o); } catch (e) { return resolve({ code: 1, stdout: '', stderr: String(e.message) }); }
    p.stdout.on('data', (c) => { if (stdout.length < (64 << 20)) stdout += c; });
    p.stderr.on('data', (c) => { if (stderr.length < (8 << 20)) stderr += c; });
    p.on('error', (e) => resolve({ code: 1, stdout, stderr: stderr + e.message }));
    p.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const encodeProject = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
const shortId = (id) => id.slice(0, 8);
const UUID = /^[0-9a-f-]{36}$/, DIR = /^[A-Za-z0-9-]+$/;

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, text);
  for (let n = 0; ; n++) {
    try { return await fsp.rename(tmp, file); } catch (e) {
      // Windows: the target may be briefly open elsewhere (antivirus, readers) → EPERM/EBUSY/EACCES; retry
      if (!IS_WIN || n >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { await fsp.rm(tmp, { force: true }); throw e; }
      await new Promise((r) => setTimeout(r, 40 * (n + 1)));
    }
  }
}

// ---------- sessions ----------

async function listAgents(p = profile()) {
  const { code, stdout } = await claude(['agents', '--json', '--all'], { profile: p.id });
  if (code !== 0) return [];
  try { return JSON.parse(stdout); } catch { return []; }
}

// history.jsonl: one line per prompt → cheap index of every session with its real cwd.
async function readHistory(p = profile()) {
  const bySession = new Map();
  let text = '';
  try { text = await fsp.readFile(pdir(p, 'history.jsonl'), 'utf8'); } catch { return bySession; }
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (!d.sessionId) continue;
    let h = bySession.get(d.sessionId);
    if (!h) { h = { project: d.project, firstPrompt: d.display, firstTs: d.timestamp, prompts: 0 }; bySession.set(d.sessionId, h); }
    h.prompts++; h.lastPrompt = d.display; h.lastTs = d.timestamp; if (d.project) h.project = d.project;
  }
  return bySession;
}

// The transcript tail carries the latest title, permission mode, PR link and (from the last assistant
// record) the model and the current context size — everything the TUI status line shows per session.
async function readTailTitle(file, bytes = 65536) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    const { size } = await fh.stat();
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const out = {};
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!/"type":"(custom-title|ai-title|permission-mode|pr-link|assistant|user|continued-in)"/.test(line)) continue;
      try {
        const d = JSON.parse(line);
        if ((d.type === 'assistant' || d.type === 'user') && d.timestamp && !d.isSidechain) { out.lastTs = Date.parse(d.timestamp); delete out.continuedIn; } // last conversation record (not file mtime, which attach/detach bumps); talking here again voids a hand-off
        if (d.type === 'continued-in') out.continuedIn = d.continuedInSessionId; // `/background` (or ←) went on under a new daemon session id
        else if (d.type === 'custom-title') out.customTitle = d.customTitle;
        else if (d.type === 'ai-title') out.aiTitle = d.aiTitle;
        else if (d.type === 'permission-mode') out.permissionMode = d.permissionMode;
        else if (d.type === 'pr-link') out.pr = { number: d.prNumber, url: d.prUrl, repo: d.prRepository };
        else if (d.type === 'assistant' && d.message?.model && !d.isSidechain) {
          const u = d.message.usage || {};
          out.lastModel = d.message.model;
          out.lastContext = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          if (d.gitBranch) out.gitBranch = d.gitBranch;
          if (d.cwd) out.cwd = d.cwd; // the session may have cd'ed into a sub-repo
        }
      } catch { /* partial first line */ }
    }
    return out;
  } catch { return {}; } finally { await fh?.close(); }
}
// Account rate-limit usage (5h / 7d) as Claude Code caches it; the user's statusline cache is the fallback.
async function usage() {
  // scoped limits (e.g. a per-model weekly cap such as Fable) ride along in `limits`; the status-line cache fallback has none
  const scoped = (u) => (Array.isArray(u?.limits) ? u.limits : []).filter((l) => l.scope?.model?.display_name && typeof l.percent === 'number').map((l) => ({ name: l.scope.model.display_name, group: l.group || l.kind, pct: l.percent, resetsAt: l.resets_at || null, active: !!l.is_active }));
  const pick = (u, at) => u?.five_hour ? { fetchedAt: at || null, fiveHour: { pct: u.five_hour.utilization, resetsAt: u.five_hour.resets_at }, sevenDay: { pct: u.seven_day?.utilization, resetsAt: u.seven_day?.resets_at }, scoped: scoped(u) } : null;
  const cfg = await readJson(path.join(os.homedir(), '.claude.json'), null);
  return pick(cfg?.cachedUsageUtilization?.utilization, cfg?.cachedUsageUtilization?.fetchedAtMs)
    || pick(await readJson(path.join(HOME, 'statusline_cache.json'), null), null);
}
// Logged-in account: the profile Claude Code stores after login, plus `claude auth status` (cached 5 min).
let authCache = { at: 0, v: null };
async function account() {
  const cfg = await readJson(path.join(os.homedir(), '.claude.json'), null);
  const a = cfg?.oauthAccount || null;
  if (Date.now() - authCache.at > 300000) {
    const r = await claude(['auth', 'status']);
    let st = null; try { st = JSON.parse(r.stdout); } catch { /* not logged in or old CLI */ }
    authCache = { at: Date.now(), v: st };
  }
  const st = authCache.v;
  return {
    loggedIn: !!(st?.loggedIn ?? a), name: a?.displayName || a?.fullName || st?.email || null, email: a?.emailAddress || st?.email || null,
    org: a?.organizationName || st?.orgName || null, role: a?.organizationRole || null, seatTier: a?.seatTier || null,
    plan: st?.subscriptionType || null, authMethod: st?.authMethod || null, billing: a?.billingType || null,
  };
}
const gitCache = new Map(); // cwd → { at, info }
async function gitInfo(cwd) {
  if (!cwd || !path.isAbsolute(cwd)) return null;
  const c = gitCache.get(cwd);
  if (c && Date.now() - c.at < 15000) return c.info;
  // --no-optional-locks: status never takes index.lock, so it can't collide with the user's own git in that repo
  const run = (args) => new Promise((res) => execFile('git', ['--no-optional-locks', '-C', cwd, ...args], { env: env(), timeout: 4000, windowsHide: true }, (e, out) => res(e ? null : String(out))));
  const branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
  const info = branch ? { branch, dirty: !!(await run(['status', '--porcelain', '--untracked-files=no']))?.trim() } : null;
  gitCache.set(cwd, { at: Date.now(), info });
  return info;
}

const pinsFile = (p) => pdir(p, 'jobs', 'pins.json'); // fleet view pins: a plain array of short ids
const readPins = (p = profile()) => readJson(pinsFile(p), []);
async function setPinned(short, on, profileId) {
  if (!/^[0-9a-f]{8}$/.test(short)) throw new Error('bad id');
  const p = profile(profileId);
  const pins = (await readPins(p)).filter((x) => x !== short);
  if (on) pins.push(short);
  await fsp.mkdir(pdir(p, 'jobs'), { recursive: true });
  await writeAtomic(pinsFile(p), JSON.stringify(pins, null, 2) + '\n');
  return pins;
}

async function readJob(short, p = profile()) {
  const job = await readJson(pdir(p, 'jobs', short, 'state.json'), null);
  return job && {
    state: job.state, detail: job.detail, tokens: job.tokens, updatedAt: job.updatedAt, intent: job.intent,
    needs: typeof job.needs === 'string' ? job.needs : null,
    prs: (job.children || []).filter((c) => c.kind === 'pr').map((c) => ({ id: c.id, href: c.href })),
    frames: (job.children || []).filter((c) => c.kind === 'frame').length,
  };
}

// ~/.claude/sessions/<pid>.json carries the Claude Code version each live process runs.
async function liveVersions(p = profile()) {
  const out = {};
  const dir = pdir(p, 'sessions');
  for (const f of (await fsp.readdir(dir).catch(() => [])).filter((f) => f.endsWith('.json'))) {
    const d = await readJson(path.join(dir, f), null);
    if (d?.sessionId && d.version) out[d.sessionId] = d.version;
  }
  return out;
}
let cliVersionCache = { at: 0, v: null };
async function cliVersion() {
  if (Date.now() - cliVersionCache.at < 60000) return cliVersionCache.v; // the binary can update while we run
  const r = await claude(['--version']);
  cliVersionCache = { at: Date.now(), v: /\d+\.\d+\.\d+/.exec(r.stdout)?.[0] || null };
  return cliVersionCache.v;
}
const respawnAll = async () => { // every profile's daemon
  const rs = await Promise.all(profiles().map((p) => claude(['respawn', '--all'], { profile: p.id, launch: true })));
  return { ok: rs.every((r) => r.code === 0), output: rs.map((r) => (r.stdout + r.stderr).trim()).filter(Boolean).join('\n') };
};

async function listSessions() {
  const all = await Promise.all(profiles().map(listProfileSessions));
  return all.flat().sort((a, b) => (b.live - a.live) || (b.lastActivity - a.lastActivity));
}
async function listProfileSessions(p) {
  const [agents, history, pins, versions] = await Promise.all([listAgents(p), readHistory(p), readPins(p), liveVersions(p)]);
  const byId = new Map();
  const projects = pdir(p, 'projects');
  let dirs = [];
  try { dirs = await fsp.readdir(projects); } catch { /* no projects yet */ }
  await Promise.all(dirs.map(async (dir) => {
    let entries = [];
    try { entries = await fsp.readdir(path.join(projects, dir)); } catch { return; }
    await Promise.all(entries.filter((e) => e.endsWith('.jsonl')).map(async (e) => {
      const file = path.join(projects, dir, e);
      const sessionId = e.slice(0, -6);
      const [st, title, job] = await Promise.all([fsp.stat(file), readTailTitle(file), readJob(shortId(sessionId), p)]);
      byId.set(sessionId, {
        sessionId, short: shortId(sessionId), profile: p.id, projectDir: dir, file, size: st.size, mtime: st.mtimeMs,
        customTitle: title.customTitle, aiTitle: title.aiTitle,
        permissionMode: title.permissionMode || null, lastModel: title.lastModel || null, lastContext: title.lastContext || null, pr: title.pr || null, gitBranch: title.gitBranch || null, workCwd: title.cwd || null, lastTs: title.lastTs || null, continuedIn: title.continuedIn || null,
        pinned: pins.includes(shortId(sessionId)), job,
      });
    }));
  }));
  for (const a of agents) {
    const s = byId.get(a.sessionId) || { sessionId: a.sessionId, short: a.id || shortId(a.sessionId), profile: p.id };
    if (!s.job) s.job = await readJob(s.short, p); // sessions with no transcript yet (fresh --bg) still have job state
    Object.assign(s, { agent: a, cwd: a.cwd, kind: a.kind, live: !!a.pid, status: a.status, state: a.state, startedAt: a.startedAt, agentName: a.name, pinned: s.pinned || pins.includes(s.short), version: versions[a.sessionId] || null });
    byId.set(a.sessionId, s);
  }
  const out = [];
  for (const s of byId.values()) {
    const h = history.get(s.sessionId);
    if (h) Object.assign(s, { cwd: s.cwd || h.project, prompts: h.prompts, firstPrompt: h.firstPrompt, lastPrompt: h.lastPrompt, historyLastTs: h.lastTs });
    if (!s.cwd && s.projectDir) s.cwd = s.projectDir; // ponytail: encoded dir as last-resort label
    if (!s.projectDir && s.cwd && path.isAbsolute(s.cwd)) s.projectDir = encodeProject(s.cwd); // agent-only sessions (no transcript yet) still belong to a project
    const autoNamed = !s.agentName || s.agentName === s.short || s.kind === 'interactive';
    s.name = (autoNamed && s.customTitle) ? s.customTitle : (s.agentName || s.customTitle || s.aiTitle || (s.firstPrompt || '').slice(0, 60) || s.short);
    // last conversation time: last message record or last prompt; start time / file mtime only for sessions without a message yet
    s.lastActivity = Math.max(s.lastTs || 0, s.historyLastTs || 0) || s.startedAt || s.mtime || 0;
    s.live = !!s.live;
    out.push(s);
  }
  return out;
}

// ---------- stats (incremental scan of the transcript, cached by byte offset) ----------

const STATS_VERSION = 3; // bump when the shape below changes: caches with another version are rescanned (3: days bucketed by local date)
const pad2 = (n) => String(n).padStart(2, '0');
const localDay = (ts) => { const d = new Date(ts); return isNaN(d) ? null : `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }; // calendar day in the local time zone
const bucket = () => ({ msgs: 0, tools: 0, input: 0, cacheRead: 0, cacheCreate: 0, output: 0 });
function emptyStats() {
  return {
    version: STATS_VERSION,
    offset: 0, userMessages: 0, assistantMessages: 0, sidechainMessages: 0, toolCalls: 0,
    tokens: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0 },
    models: {}, efforts: {}, tools: {}, versions: {}, firstTs: null, lastTs: null,
    byModel: {}, days: {}, // per model / per UTC day token buckets for the global stats page
    cwd: null, gitBranch: null, title: null, aiTitle: null,
  };
}
const inc = (obj, key) => { if (key) obj[key] = (obj[key] || 0) + 1; };
function addUsage(b, u, tools) {
  b.msgs++; b.tools += tools;
  b.input += u.input_tokens || 0; b.cacheRead += u.cache_read_input_tokens || 0;
  b.cacheCreate += u.cache_creation_input_tokens || 0; b.output += u.output_tokens || 0;
}

function ingest(line, s) {
  let d; try { d = JSON.parse(line); } catch { return; }
  if (d.timestamp) {
    if (!s.firstTs || d.timestamp < s.firstTs) s.firstTs = d.timestamp;
    if (!s.lastTs || d.timestamp > s.lastTs) s.lastTs = d.timestamp;
  }
  if (d.cwd) s.cwd = d.cwd;
  if (d.gitBranch) s.gitBranch = d.gitBranch;
  inc(s.versions, d.version);
  if (d.type === 'custom-title') s.title = d.customTitle;
  else if (d.type === 'ai-title') s.aiTitle = d.aiTitle;
  else if (d.type === 'assistant') {
    const m = d.message || {};
    if (d.isSidechain) s.sidechainMessages++; else s.assistantMessages++;
    inc(s.models, m.model); inc(s.efforts, d.effort);
    const u = m.usage || {};
    s.tokens.input += u.input_tokens || 0;
    s.tokens.cacheRead += u.cache_read_input_tokens || 0;
    s.tokens.cacheCreate += u.cache_creation_input_tokens || 0;
    s.tokens.output += u.output_tokens || 0;
    s.tokens.thinking += u.output_tokens_details?.thinking_tokens || 0;
    let tools = 0;
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b.type === 'tool_use') { s.toolCalls++; tools++; inc(s.tools, b.name); }
    }
    addUsage(s.byModel[m.model || '?'] ||= bucket(), u, tools);
    const day = d.timestamp && localDay(d.timestamp);
    if (day) addUsage(s.days[day] ||= bucket(), u, tools);
  } else if (d.type === 'user' && !d.isMeta && !d.isSidechain) {
    const c = d.message?.content;
    if (typeof c === 'string' || (Array.isArray(c) && c.some((b) => b.type === 'text'))) s.userMessages++;
  }
}

// Streams complete lines from `start`; resolves with the byte offset just past the last complete line.
function streamLines(file, start, onLine) {
  return new Promise((resolve, reject) => {
    let rest = Buffer.alloc(0);
    let consumed = start;
    const stream = fs.createReadStream(file, { start });
    stream.on('data', (chunk) => {
      const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      let from = 0, idx;
      while ((idx = buf.indexOf(10, from)) !== -1) {
        onLine(buf.subarray(from, idx).toString('utf8'));
        from = idx + 1;
      }
      consumed += from;
      rest = buf.subarray(from);
    });
    stream.on('end', () => resolve(consumed));
    stream.on('error', reject);
  });
}
async function scanFrom(file, s) {
  s.offset = await streamLines(file, s.offset, (line) => ingest(line, s));
  return s;
}

async function sessionStats(sessionId) {
  const sessions = await listSessions();
  const sess = sessions.find((x) => x.sessionId === sessionId);
  if (!sess?.file) return null;
  return fileStats(sess.file);
}

async function fileStats(file) {
  await fsp.mkdir(path.join(CACHE, 'stats'), { recursive: true });
  const cacheFile = path.join(CACHE, 'stats', path.basename(file, '.jsonl') + '.json');
  const st = await fsp.stat(file);
  let s = await readJson(cacheFile, null);
  if (!s || s.version !== STATS_VERSION || s.offset > st.size) s = emptyStats();
  if (st.size > s.offset) {
    await scanFrom(file, s);
    await writeAtomic(cacheFile, JSON.stringify(s));
  }
  const t = s.tokens;
  return {
    ...s, file, size: st.size,
    totalTokens: t.input + t.cacheRead + t.cacheCreate + t.output,
    durationMs: s.firstTs && s.lastTs ? Date.parse(s.lastTs) - Date.parse(s.firstTs) : 0,
  };
}

// Everything, aggregated: totals, per project, per model, per day, top tools.
async function globalStats({ profile: only } = {}) {
  const [sessions, labels] = await Promise.all([listSessions(), projectLabels()]);
  const withFile = sessions.filter((s) => s.file && (!only || s.profile === only));
  const stats = await Promise.all(withFile.map((s) => fileStats(s.file).catch(() => null)));
  const sum = (dst, src) => { for (const k of Object.keys(src)) dst[k] = (dst[k] || 0) + src[k]; };
  const g = { sessions: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, tokens: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0, thinking: 0 },
    byModel: {}, days: {}, tools: {}, byProject: {}, firstTs: null, lastTs: null };
  withFile.forEach((s, i) => {
    const st = stats[i];
    if (!st) return;
    g.sessions++;
    g.userMessages += st.userMessages; g.assistantMessages += st.assistantMessages; g.toolCalls += st.toolCalls;
    sum(g.tokens, st.tokens); sum(g.tools, st.tools);
    for (const [m, b] of Object.entries(st.byModel)) sum(g.byModel[m] ||= bucket(), b);
    for (const [d, b] of Object.entries(st.days)) sum(g.days[d] ||= bucket(), b);
    if (st.firstTs && (!g.firstTs || st.firstTs < g.firstTs)) g.firstTs = st.firstTs;
    if (st.lastTs && (!g.lastTs || st.lastTs > g.lastTs)) g.lastTs = st.lastTs;
    const p = g.byProject[s.projectDir] ||= { dir: s.projectDir, cwd: labels[s.projectDir] || s.cwd || s.projectDir, sessions: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, tokens: { input: 0, cacheRead: 0, cacheCreate: 0, output: 0 }, byModel: {}, lastTs: null };
    p.sessions++; p.userMessages += st.userMessages; p.assistantMessages += st.assistantMessages; p.toolCalls += st.toolCalls;
    sum(p.tokens, { input: st.tokens.input, cacheRead: st.tokens.cacheRead, cacheCreate: st.tokens.cacheCreate, output: st.tokens.output });
    for (const [m, b] of Object.entries(st.byModel)) sum(p.byModel[m] ||= bucket(), b);
    if (st.lastTs && (!p.lastTs || st.lastTs > p.lastTs)) p.lastTs = st.lastTs;
  });
  return g;
}

// ---------- transcript viewer ----------
// A transcript becomes a flat list of turns: user / assistant text, tool calls, tool results.
// Subagent (sidechain) and injected (isMeta) records are skipped. Text is clipped per turn.
const clip = (t, n) => t.length > n ? t.slice(0, n) + `\n… (${t.length - n}자 생략)` : t;
const toolSummary = (i = {}) => String(i.questions?.map((q) => q.question).join(' / ') || i.command || i.file_path || i.pattern || i.description || i.prompt || i.query || JSON.stringify(i));
const blockText = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
function ingestTurn(line, turns) {
  let d; try { d = JSON.parse(line); } catch { return; }
  if (d.isSidechain) return;
  const base = { ts: d.timestamp, uuid: d.uuid };
  if (d.type === 'user' && !d.isMeta) {
    const c = d.message?.content;
    const text = blockText(c).trim();
    const images = Array.isArray(c) ? c.filter((b) => b.type === 'image').length : 0;
    if (text || images) turns.push({ ...base, role: 'user', text: clip(text, 6000), ...(images ? { images } : {}) });
    for (const b of Array.isArray(c) ? c : []) if (b.type === 'tool_result') turns.push({ ...base, role: 'result', text: clip(blockText(b.content), 2000), isError: !!b.is_error });
  } else if (d.type === 'assistant') {
    const m = d.message || {}, c = Array.isArray(m.content) ? m.content : [];
    const text = blockText(c).trim();
    if (text) turns.push({ ...base, role: 'assistant', model: m.model, text: clip(text, 8000) });
    for (const b of c) if (b.type === 'tool_use') turns.push({ ...base, role: 'tool', name: b.name, text: clip(toolSummary(b.input), 400) });
  } else if (d.type === 'system' && d.subtype === 'turn_duration') { // the TUI's "✱ Crunched for 24s · done 10:32" line
    turns.push({ ...base, role: 'meta', kind: 'duration', ms: d.durationMs || 0, text: '' });
  } else if (d.type === 'system' && d.subtype === 'away_summary' && d.content) { // "※ recap: …", re-emitted on every return; keep one
    const last = turns[turns.length - 1];
    if (!(last?.kind === 'recap' && last.text === d.content)) turns.push({ ...base, role: 'meta', kind: 'recap', text: String(d.content) });
  }
}
const TR_CACHE = new Map(); // sessionId → { size, mtime, turns } — ponytail: small LRU, whole-file parse
async function loadTurns(file, sessionId) {
  const st = await fsp.stat(file);
  const c = TR_CACHE.get(sessionId);
  if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.turns;
  const turns = [];
  await streamLines(file, 0, (line) => ingestTurn(line, turns));
  turns.forEach((t, i) => { t.i = i; });
  TR_CACHE.set(sessionId, { size: st.size, mtime: st.mtimeMs, turns });
  if (TR_CACHE.size > 8) TR_CACHE.delete(TR_CACHE.keys().next().value);
  return turns;
}
async function findTranscript(sessionId) {
  if (!UUID.test(sessionId)) return null;
  for (const p of profiles()) {
    const projects = pdir(p, 'projects');
    for (const dir of await fsp.readdir(projects).catch(() => [])) {
      const f = path.join(projects, dir, sessionId + '.jsonl');
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}
async function transcript(sessionId, { from, limit = 200 } = {}) {
  const file = await findTranscript(sessionId);
  if (!file) return null;
  const turns = await loadTurns(file, sessionId);
  const start = from == null ? Math.max(0, turns.length - limit) : Math.max(0, Math.min(from, turns.length));
  return { total: turns.length, from: start, turns: turns.slice(start, start + limit) };
}
// Pure-Node stand-in for `grep -l -i -F` (no grep on Windows): streams the file, keeping a needle-sized overlap between chunks.
function fileHas(file, needle) {
  return new Promise((resolve) => {
    let tail = '', found = false;
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    stream.on('data', (chunk) => {
      const t = (tail + chunk).toLowerCase();
      if (t.includes(needle)) { found = true; stream.destroy(); } else tail = t.slice(-(needle.length - 1));
    });
    stream.on('close', () => resolve(found));
    stream.on('error', () => resolve(false));
  });
}
async function nodeGrep(files, needle) {
  const hits = new Set();
  for (let i = 0; i < files.length; i += 8) await Promise.all(files.slice(i, i + 8).map(async (f) => { if (await fileHas(f, needle)) hits.add(path.normalize(f)); }));
  return hits;
}
// Full-text search: grep narrows the files, then the parsed turns give role-aware snippets.
// `grep: false` (default on Windows, or when grep is missing) uses the Node fallback.
async function searchTranscripts(q, { limit = 300, perSession = 30, grep = !IS_WIN } = {}) {
  q = String(q || '').trim();
  if (q.length < 2) return [];
  const sessions = (await listSessions()).filter((s) => s.file);
  const needle = q.toLowerCase(), out = [], files = sessions.map((s) => s.file);
  const hits = grep ? await new Promise((res) => execFile('grep', ['-l', '-i', '-F', '--', q, ...files], { maxBuffer: 1 << 24 }, (e, o) => {
    if (e && e.code !== 1 && !o) return res(nodeGrep(files, needle)); // grep missing/failed with no output (exit 1 = just no match)
    res(new Set(String(o || '').split(/\r?\n/).filter(Boolean).map((f) => path.normalize(f))));
  })) : await nodeGrep(files, needle);
  for (const s of sessions) {
    if (!hits.has(path.normalize(s.file))) continue;
    let n = 0;
    for (const t of await loadTurns(s.file, s.sessionId)) {
      const k = t.text.toLowerCase().indexOf(needle);
      if (k === -1) continue;
      out.push({ sessionId: s.sessionId, name: s.name, cwd: s.cwd, i: t.i, role: t.role, ts: t.ts, snippet: t.text.slice(Math.max(0, k - 80), k + 140).replace(/\s+/g, ' ') });
      if (++n >= perSession) break;
    }
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, limit);
}

// ---------- memory ----------

// `---\n` / `---\r\n` opener + `\n---` closer → { start: first fm char, end: end of fm text (before any CR), nl: index of the closer's newline }
function frontmatterSpan(text) {
  const m = /^---\r?\n/.exec(text);
  if (!m) return null;
  const nl = text.indexOf('\n---', m[0].length);
  return nl === -1 ? null : { start: m[0].length, end: text[nl - 1] === '\r' && nl - 1 >= m[0].length ? nl - 1 : nl, nl };
}
function parseFrontmatter(text) {
  const meta = {};
  const fm = frontmatterSpan(text);
  if (!fm) return { meta, body: text };
  for (const line of text.slice(fm.start, fm.end).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (m && m[2] !== '') meta[m[1]] = m[2].trim(); // ponytail: flat key/value, nested keys collapse
  }
  return { meta, body: text.slice(fm.nl + 4).replace(/^(\r?\n)+/, '') };
}

// encoded project dir → real cwd, learned from history.jsonl and running agents
async function projectLabels() {
  const map = {};
  for (const p of profiles()) {
    const [history, agents] = await Promise.all([readHistory(p), listAgents(p)]);
    for (const h of history.values()) if (h.project) map[encodeProject(h.project)] = h.project;
    for (const a of agents) if (a.cwd) map[encodeProject(a.cwd)] = a.cwd;
  }
  return map;
}

async function listProjects() {
  const labels = await projectLabels();
  const out = [];
  for (const p of profiles()) {
    const projects = pdir(p, 'projects');
    let dirs = [];
    try { dirs = await fsp.readdir(projects); } catch { continue; }
    for (const dir of dirs) {
      let n = 0;
      try { n = (await fsp.readdir(path.join(projects, dir, 'memory'))).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md').length; } catch { /* no memory dir */ }
      out.push({ dir, profile: p.id, cwd: labels[dir] || dir, memoryCount: n });
    }
  }
  return out.sort((a, b) => b.memoryCount - a.memoryCount || a.cwd.localeCompare(b.cwd));
}

async function listMemory() {
  const projects = await listProjects();
  const out = [];
  await Promise.all(projects.filter((p) => p.memoryCount).map(async (p) => {
    const dir = pdir(profile(p.profile), 'projects', p.dir, 'memory');
    for (const f of await fsp.readdir(dir)) {
      if (!f.endsWith('.md') || f === 'MEMORY.md') continue;
      const file = path.join(dir, f);
      const [text, st] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]);
      const { meta } = parseFrontmatter(text);
      out.push({
        file, base: f, projectDir: p.dir, profile: p.profile, project: p.cwd, size: st.size, mtime: st.mtimeMs,
        name: meta.name || f.replace(/\.md$/, ''), description: meta.description || '', type: meta.type || '',
        originSessionId: meta.originSessionId || null, copiedFrom: meta.copiedFrom || null,
      });
    }
  }));
  return out.sort((a, b) => b.mtime - a.mtime);
}

function assertInsideProjects(file) {
  const r = path.resolve(file);
  const fold = (p) => IS_WIN ? p.toLowerCase() : p; // drive-letter case may differ on Windows
  const inside = profiles().some((p) => fold(r).startsWith(fold(pdir(p, 'projects') + path.sep)));
  if (!inside || !r.endsWith('.md')) throw new Error('path outside a profile\'s projects dir');
  return r;
}

async function readMemory(file) {
  return fsp.readFile(assertInsideProjects(file), 'utf8');
}

async function copyMemory({ src, destProjectDir, destProfile, overwrite = false }) {
  src = assertInsideProjects(src);
  if (!/^[A-Za-z0-9-]+$/.test(destProjectDir)) throw new Error('bad project dir');
  const destDir = pdir(profile(destProfile), 'projects', destProjectDir, 'memory');
  await fsp.mkdir(destDir, { recursive: true });
  const base = path.basename(src);
  const dest = path.join(destDir, base);
  if (dest === src) throw new Error('same project');
  if (!overwrite && fs.existsSync(dest)) return { exists: true, dest };

  const text = await fsp.readFile(src, 'utf8');
  const origin = `${path.basename(path.dirname(path.dirname(src)))}/memory/${base}`;
  const { meta } = parseFrontmatter(text);
  let out;
  const eol = text.includes('\r\n') ? '\r\n' : '\n'; // keep the file's line endings
  const span = frontmatterSpan(text);
  if (span) {
    const fm = text.slice(span.start, span.end).split(/\r?\n/).filter((l) => !/^\s*copiedFrom:/.test(l));
    const i = fm.findIndex((l) => /^metadata:\s*$/.test(l));
    if (i !== -1) fm.splice(i + 1, 0, `  copiedFrom: ${origin}`); else fm.push(`copiedFrom: ${origin}`);
    out = `---${eol}${fm.join(eol)}${eol}${text.slice(span.nl + 1)}`;
  } else {
    out = `---${eol}copiedFrom: ${origin}${eol}---${eol}${eol}${text}`;
  }
  await writeAtomic(dest, out);
  await syncIndexLine(destDir, base, meta, 'ensure');
  return { dest };
}

// memory/MEMORY.md keeps one `- [title](file) — hook` line per file. 'ensure' appends if missing,
// 'update' rewrites (or appends), 'remove' drops it. The hook is the frontmatter description.
async function syncIndexLine(dir, base, meta, mode) {
  const index = path.join(dir, 'MEMORY.md');
  let idx = ''; try { idx = await fsp.readFile(index, 'utf8'); } catch { /* new index */ }
  const lines = idx.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const i = lines.findIndex((l) => l.includes(`](${base})`));
  const line = `- [${meta.name || base.replace(/\.md$/, '')}](${base})${meta.description ? ` — ${meta.description}` : ''}`;
  if (mode === 'remove') { if (i === -1) return; lines.splice(i, 1); }
  else if (i === -1) lines.push(line);
  else if (mode === 'update') lines[i] = line;
  else return;
  await writeAtomic(index, lines.length ? lines.join('\n') + '\n' : '');
}

async function writeMemory(file, text) {
  file = assertInsideProjects(file);
  if (path.basename(file) === 'MEMORY.md') throw new Error('index file');
  let before = {}; try { before = parseFrontmatter(await fsp.readFile(file, 'utf8')).meta; } catch { /* new file */ }
  const { meta } = parseFrontmatter(text);
  await writeAtomic(file, text);
  const changed = before.name !== meta.name || before.description !== meta.description;
  await syncIndexLine(path.dirname(file), path.basename(file), meta, changed ? 'update' : 'ensure');
  return { meta };
}

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];
// New memory with the same frontmatter Claude Code writes; refuses to clobber an existing file.
async function createMemory({ projectDir, profile: profileId, name, type, description }) {
  name = String(name || '').trim().toLowerCase().replace(/[^a-z0-9가-힣_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!DIR.test(projectDir) || !name) throw new Error('bad project or name');
  if (!MEMORY_TYPES.includes(type)) throw new Error('bad type');
  const dir = pdir(profile(profileId), 'projects', projectDir, 'memory');
  const file = path.join(dir, name + '.md');
  if (fs.existsSync(file)) throw new Error(`이미 있습니다: ${name}.md`);
  await fsp.mkdir(dir, { recursive: true });
  const body = type === 'user' ? '' : type === 'reference' ? 'URL / 위치: \n' : '\n\n**Why:** \n\n**How to apply:** \n';
  const text = `---\nname: ${name}\ndescription: ${String(description || '').trim().replace(/\n+/g, ' ')}\nmetadata:\n  type: ${type}\n  createdBy: claude-code-manager\n---\n\n${body}`;
  await writeMemory(file, text);
  return { file, text };
}

async function deleteMemory(file) {
  file = assertInsideProjects(file);
  if (path.basename(file) === 'MEMORY.md') throw new Error('index file');
  await fsp.rm(file, { force: true });
  await syncIndexLine(path.dirname(file), path.basename(file), {}, 'remove');
  return { ok: true };
}

// Hand a (closed) chat session to the daemon: `--bg --resume` keeps the same id when nothing else runs it.
async function resumeInBackground({ sessionId, cwd, name, profile: profileId }) {
  if (!UUID.test(sessionId)) throw new Error('bad id');
  const r = await claude(['--bg', ...sessionFlags({ name }), '--resume', sessionId], { cwd, profile: profileId, launch: true });
  const output = (r.stdout + r.stderr).trim();
  if (r.code !== 0) return { ok: false, untrusted: /not trusted/i.test(output), output };
  const m = /backgrounded\s*·\s*([0-9a-f]{8})/.exec(output);
  return { ok: true, id: m?.[1], copy: /copy/i.test(output), output };
}

// ---------- rename / delete ----------

// Writes the places Claude Code reads a name from: the job record (+ respawn flags) and the
// transcript's custom-title.json. A live worker owns its own in-memory name, so for live
// sessions the renderer additionally sends `/rename` through the attached terminal.
async function renameSession({ sessionId, projectDir, profile: profileId, name }) {
  name = String(name || '').trim();
  if (!name || !UUID.test(sessionId)) throw new Error('bad rename');
  const done = [], p = profile(profileId);
  const stateFile = pdir(p, 'jobs', shortId(sessionId), 'state.json');
  const job = await readJson(stateFile, null);
  if (job) {
    job.name = name; job.nameSource = 'user';
    const flags = Array.isArray(job.respawnFlags) ? job.respawnFlags : [];
    const i = flags.indexOf('--name');
    if (i !== -1 && i + 1 < flags.length) flags[i + 1] = name; else flags.push('--name', name);
    job.respawnFlags = flags;
    await writeAtomic(stateFile, JSON.stringify(job, null, 2));
    done.push('job');
  }
  if (projectDir && DIR.test(projectDir)) {
    const dir = pdir(p, 'projects', projectDir, sessionId);
    await fsp.mkdir(dir, { recursive: true });
    await writeAtomic(path.join(dir, 'custom-title.json'), JSON.stringify({ customTitle: name }));
    done.push('title');
  }
  return { done };
}

// For sessions that only exist as a transcript (no background job): remove the .jsonl and its sidecar dir.
async function deleteTranscript({ sessionId, projectDir, profile: profileId }) {
  if (!UUID.test(sessionId) || !DIR.test(projectDir)) throw new Error('bad id');
  const base = pdir(profile(profileId), 'projects', projectDir, sessionId);
  await fsp.rm(base + '.jsonl', { force: true });
  await fsp.rm(base, { recursive: true, force: true });
  await fsp.rm(path.join(CACHE, 'stats', sessionId + '.json'), { force: true });
  return { ok: true };
}

// ---------- session lifecycle (delegated to the CLI) ----------

async function agentAction(action, id, profileId) {
  if (!['stop', 'rm', 'respawn'].includes(action)) throw new Error('bad action');
  const r = await claude([action, id], { profile: profileId, launch: action === 'respawn' });
  return { ok: r.code === 0, output: (r.stdout + r.stderr).trim() };
}

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSION_MODES = ['auto', 'acceptEdits', 'plan', 'manual', 'dontAsk', 'bypassPermissions'];
// Flags shared by `claude --bg` and the interactive fallback. Values are passed as argv (no shell), so the
// only thing to refuse is something that would parse as another flag.
function sessionFlags({ name, model, effort, permissionMode, agent } = {}) {
  const clean = (v) => { v = String(v || '').trim(); if (v.startsWith('-')) throw new Error(`bad value: ${v}`); return v; };
  const args = [];
  if (clean(name)) args.push('--name', clean(name));
  if (clean(model)) args.push('--model', clean(model));
  if (clean(effort)) { if (!EFFORTS.includes(effort)) throw new Error('bad effort'); args.push('--effort', effort); }
  if (clean(permissionMode)) { if (!PERMISSION_MODES.includes(permissionMode)) throw new Error('bad permission mode'); args.push('--permission-mode', permissionMode); }
  if (clean(agent)) args.push('--agent', clean(agent));
  return args;
}

async function newSession(opts) {
  const { cwd, prompt } = opts;
  const args = ['--bg', ...sessionFlags(opts)];
  if (prompt) args.push(prompt);
  const r = await claude(args, { cwd, profile: opts.profile, launch: true });
  const output = (r.stdout + r.stderr).trim();
  if (r.code !== 0) return { ok: false, untrusted: /not trusted/i.test(output), output };
  const m = /backgrounded\s*·\s*([0-9a-f]{8})/.exec(output);
  return { ok: true, id: m?.[1], output };
}

module.exports = {
  IS_WIN, HOME, PROJECTS, env, findClaude, profiles: listProfiles, launcher, encodeProject, parseFrontmatter, ingest, emptyStats,
  listSessions, listAgents, sessionStats, fileStats, globalStats, readPins, setPinned, listProjects, transcript, searchTranscripts, findTranscript, streamLines, ingestTurn, readTailTitle, usage, gitInfo, account, listMemory, readMemory, copyMemory, writeMemory, deleteMemory, createMemory, MEMORY_TYPES,
  agentAction, newSession, sessionFlags, resumeInBackground, cliVersion, liveVersions, respawnAll, EFFORTS, PERMISSION_MODES, renameSession, deleteTranscript, setCacheDir: (d) => { CACHE = d; },
};
