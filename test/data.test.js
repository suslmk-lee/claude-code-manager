'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.TZ = 'Asia/Seoul'; // day buckets are local-date based
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-test-'));
process.env.CLAUDE_CONFIG_DIR = tmp;
process.env.CLAUDE_BIN = '/bin/false'; // no real CLI in tests → listAgents() returns []
const data = require('../src/data');
data.setCacheDir(path.join(tmp, 'cache'));

const projA = path.join(tmp, 'projects', '-tmp-a'), projB = path.join(tmp, 'projects', '-tmp-b');
fs.mkdirSync(path.join(projA, 'memory'), { recursive: true });
fs.mkdirSync(projB, { recursive: true });

const sid = '11111111-aaaa-bbbb-cccc-000000000000';
const line = (o) => JSON.stringify(o) + '\n';
const asst = (ts, usage, content) => line({ type: 'assistant', timestamp: ts, sessionId: sid, cwd: '/tmp/a', version: '2.1.292', effort: 'high', message: { model: 'claude-fable-5-1', usage, content } });
const transcript = path.join(projA, `${sid}.jsonl`);
fs.writeFileSync(transcript,
  line({ type: 'custom-title', customTitle: 'first', sessionId: sid }) +
  line({ type: 'user', isMeta: true, timestamp: '2026-10-07T00:00:00.000Z', message: { role: 'user', content: 'injected' } }) +
  line({ type: 'user', timestamp: '2026-10-07T00:00:01.000Z', message: { role: 'user', content: 'hello' } }) +
  asst('2026-10-07T00:00:02.000Z', { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 30, output_tokens_details: { thinking_tokens: 5 } }, [{ type: 'tool_use', name: 'Bash' }]) +
  line({ type: 'user', timestamp: '2026-10-07T00:00:03.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }) +
  asst('2026-10-07T00:00:04.000Z', { input_tokens: 1, output_tokens: 2 }, [{ type: 'text', text: 'done' }]) +
  line({ type: 'custom-title', customTitle: 'final title', sessionId: sid }));
fs.writeFileSync(path.join(tmp, 'history.jsonl'), line({ display: 'hello', timestamp: 1791339444164, project: '/tmp/a', sessionId: sid }));

test('listSessions merges transcript + history', async () => {
  const s = await data.listSessions();
  assert.equal(s.length, 1);
  assert.equal(s[0].name, 'final title');
  assert.equal(s[0].cwd, '/tmp/a');
  assert.equal(s[0].prompts, 1);
  assert.equal(s[0].lastActivity, 1791339444164); // last conversation event (prompt vs. last message), never the file mtime
});

test('fileStats sums usage and is incremental', async () => {
  const st = await data.fileStats(transcript);
  assert.equal(st.userMessages, 1);          // meta + tool_result excluded
  assert.equal(st.assistantMessages, 2);
  assert.equal(st.toolCalls, 1);
  assert.deepEqual(st.tokens, { input: 11, cacheRead: 100, cacheCreate: 20, output: 32, thinking: 5 });
  assert.equal(st.totalTokens, 163);
  assert.equal(st.durationMs, 4000);
  assert.equal(st.title, 'final title');
  assert.equal(st.tools.Bash, 1);
  assert.deepEqual(st.byModel['claude-fable-5-1'], { msgs: 2, tools: 1, input: 11, cacheRead: 100, cacheCreate: 20, output: 32 });
  assert.deepEqual(Object.keys(st.days), ['2026-10-07']);
  assert.equal(st.days['2026-10-07'].output, 32);
  // append a partial line, then complete it: partial must not be counted until complete
  fs.appendFileSync(transcript, asst('2026-10-07T00:00:05.000Z', { output_tokens: 7 }, []).slice(0, -5));
  assert.equal((await data.fileStats(transcript)).assistantMessages, 2);
  fs.appendFileSync(transcript, asst('2026-10-07T00:00:05.000Z', { output_tokens: 7 }, []).slice(-5));
  const st2 = await data.fileStats(transcript);
  assert.equal(st2.assistantMessages, 3);
  assert.equal(st2.tokens.output, 39);
});

test('globalStats aggregates per project, model and day', async () => {
  const g = await data.globalStats();
  assert.equal(g.sessions, 1);
  assert.equal(g.tokens.output, 39);
  assert.equal(g.byModel['claude-fable-5-1'].msgs, 3);
  assert.equal(g.days['2026-10-07'].msgs, 3);
  assert.equal(g.byProject['-tmp-a'].sessions, 1);
  assert.equal(g.byProject['-tmp-a'].cwd, '/tmp/a');
});

test('parseFrontmatter flattens nested keys', () => {
  const { meta, body } = data.parseFrontmatter('---\nname: x\nmetadata:\n  type: project\n  originSessionId: abc\n---\n\nbody here\n');
  assert.deepEqual(meta, { name: 'x', type: 'project', originSessionId: 'abc' });
  assert.equal(body, 'body here\n');
});

test('copyMemory copies file, tags origin, appends index once', async () => {
  const src = path.join(projA, 'memory', 'note.md');
  fs.writeFileSync(src, '---\nname: note\ndescription: a hook\nmetadata:\n  type: project\n---\n\nhello\n');
  const r = await data.copyMemory({ src, destProjectDir: '-tmp-b' });
  const dest = path.join(projB, 'memory', 'note.md');
  assert.equal(r.dest, dest);
  const text = fs.readFileSync(dest, 'utf8');
  assert.match(text, /metadata:\n  copiedFrom: -tmp-a\/memory\/note\.md\n  type: project/);
  assert.match(text, /\nhello\n$/);
  assert.equal(fs.readFileSync(path.join(projB, 'memory', 'MEMORY.md'), 'utf8'), '- [note](note.md) — a hook\n');
  // second copy refuses without overwrite, and overwrite does not duplicate the index line
  assert.equal((await data.copyMemory({ src, destProjectDir: '-tmp-b' })).exists, true);
  await data.copyMemory({ src, destProjectDir: '-tmp-b', overwrite: true });
  assert.equal(fs.readFileSync(path.join(projB, 'memory', 'MEMORY.md'), 'utf8').split('\n').filter(Boolean).length, 1);
  const mem = await data.listMemory();
  assert.deepEqual(mem.map((m) => [m.name, m.projectDir, m.copiedFrom]).sort(), [['note', '-tmp-a', null], ['note', '-tmp-b', '-tmp-a/memory/note.md']]);
  await assert.rejects(data.copyMemory({ src: '/etc/passwd', destProjectDir: '-tmp-b' }));
  await assert.rejects(data.copyMemory({ src, destProjectDir: '../x' }));
});

test('pins: read from jobs/pins.json, toggle atomically', async () => {
  fs.mkdirSync(path.join(tmp, 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'jobs', 'pins.json'), '["11111111"]');
  assert.equal((await data.listSessions())[0].pinned, true);
  assert.deepEqual(await data.setPinned('11111111', false), []);
  assert.equal((await data.listSessions())[0].pinned, false);
  assert.deepEqual(await data.setPinned('11111111', true), ['11111111']);
  assert.deepEqual(await data.setPinned('11111111', true), ['11111111']); // idempotent
  await assert.rejects(data.setPinned('../x', true));
});

test('renameSession updates job record + respawn flags + custom-title.json', async () => {
  const jobDir = path.join(tmp, 'jobs', '11111111');
  fs.mkdirSync(jobDir, { recursive: true });
  fs.writeFileSync(path.join(jobDir, 'state.json'), JSON.stringify({ state: 'done', name: 'old', nameSource: 'auto', respawnFlags: ['--agent', 'claude', '--name', 'old'] }));
  const r = await data.renameSession({ sessionId: sid, projectDir: '-tmp-a', name: '새 이름' });
  assert.deepEqual(r.done, ['job', 'title']);
  const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'state.json'), 'utf8'));
  assert.equal(job.name, '새 이름'); assert.equal(job.nameSource, 'user');
  assert.deepEqual(job.respawnFlags, ['--agent', 'claude', '--name', '새 이름']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(projA, sid, 'custom-title.json'), 'utf8')), { customTitle: '새 이름' });
  assert.equal((await data.listSessions())[0].job.state, 'done');
  await assert.rejects(data.renameSession({ sessionId: '../x', projectDir: '-tmp-a', name: 'x' }));
});

test('deleteTranscript removes the jsonl and sidecar dir only', async () => {
  const other = path.join(projA, 'keep.txt');
  fs.writeFileSync(other, 'x');
  await data.deleteTranscript({ sessionId: sid, projectDir: '-tmp-a' });
  assert.equal(fs.existsSync(transcript), false);
  assert.equal(fs.existsSync(path.join(projA, sid)), false);
  assert.equal(fs.existsSync(other), true);
  await assert.rejects(data.deleteTranscript({ sessionId: sid, projectDir: '../-tmp-a' }));
});

test('sessionFlags builds claude flags and rejects flag-like or unknown values', () => {
  assert.deepEqual(data.sessionFlags({}), []);
  assert.deepEqual(data.sessionFlags({ name: 'n', model: 'opus[1m]', effort: 'xhigh', permissionMode: 'auto', agent: 'claude' }),
    ['--name', 'n', '--model', 'opus[1m]', '--effort', 'xhigh', '--permission-mode', 'auto', '--agent', 'claude']);
  assert.deepEqual(data.sessionFlags({ model: '  ', effort: '' }), []);
  assert.throws(() => data.sessionFlags({ effort: 'ultra' }));
  assert.throws(() => data.sessionFlags({ permissionMode: 'yolo' }));
  assert.throws(() => data.sessionFlags({ model: '--dangerously-skip-permissions' }));
});

test('transcript turns and full-text search', async () => {
  const sid2 = '22222222-aaaa-bbbb-cccc-000000000000';
  const f = path.join(projA, `${sid2}.jsonl`);
  fs.writeFileSync(f,
    line({ type: 'user', timestamp: '2026-10-07T01:00:00.000Z', uuid: 'u1', message: { role: 'user', content: 'find the Needle please' } }) +
    line({ type: 'assistant', timestamp: '2026-10-07T01:00:01.000Z', uuid: 'a1', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Bash', input: { command: 'grep needle' } }] } }) +
    line({ type: 'user', timestamp: '2026-10-07T01:00:02.000Z', uuid: 'u2', message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: 'nope' }] } }) +
    line({ type: 'user', isSidechain: true, timestamp: '2026-10-07T01:00:03.000Z', message: { role: 'user', content: 'subagent chatter' } }) +
    line({ type: 'assistant', timestamp: '2026-10-07T01:00:04.000Z', uuid: 'a2', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Found it.' }] } }) +
    line({ type: 'system', subtype: 'turn_duration', durationMs: 24737, timestamp: '2026-10-07T01:00:05.000Z' }) +
    line({ type: 'system', subtype: 'away_summary', content: 'recap one', timestamp: '2026-10-07T01:00:06.000Z' }) +
    line({ type: 'system', subtype: 'away_summary', content: 'recap one', timestamp: '2026-10-07T01:00:07.000Z' }) + // re-emitted → folded
    line({ type: 'system', subtype: 'status', timestamp: '2026-10-07T01:00:08.000Z' }));
  const t = await data.transcript(sid2);
  assert.deepEqual(t.turns.map((x) => x.role), ['user', 'assistant', 'tool', 'result', 'assistant', 'meta', 'meta']);
  assert.deepEqual([t.turns[5].kind, t.turns[5].ms, t.turns[6].kind, t.turns[6].text], ['duration', 24737, 'recap', 'recap one']);
  assert.equal(t.total, 7); assert.equal(t.turns[2].text, 'grep needle'); assert.equal(t.turns[3].isError, true);
  const page = await data.transcript(sid2, { from: 3, limit: 1 });
  assert.deepEqual([page.from, page.turns.length, page.turns[0].i], [3, 1, 3]);
  const hits = await data.searchTranscripts('needle');
  assert.deepEqual(hits.map((h) => [h.i, h.role]).sort(), [[0, 'user'], [2, 'tool']]);
  assert.equal(await data.transcript('../etc'), null);
});

test('writeMemory / deleteMemory keep MEMORY.md in sync', async () => {
  const dir = path.join(projB, 'memory');
  const f = path.join(dir, 'note.md'); // copied earlier; index has "- [note](note.md) — a hook"
  await data.writeMemory(f, '---\nname: note\ndescription: a hook\n---\n\nedited body\n');
  assert.match(fs.readFileSync(f, 'utf8'), /edited body/);
  assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'), '- [note](note.md) — a hook\n'); // unchanged meta → line untouched
  await data.writeMemory(f, '---\nname: renamed\ndescription: new hook\n---\n\nbody\n');
  assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'), '- [renamed](note.md) — new hook\n');
  await data.writeMemory(path.join(dir, 'fresh.md'), '---\nname: fresh\ndescription: brand new\n---\n\nx\n');
  assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'), '- [renamed](note.md) — new hook\n- [fresh](fresh.md) — brand new\n');
  await data.deleteMemory(f);
  assert.equal(fs.existsSync(f), false);
  assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'), '- [fresh](fresh.md) — brand new\n');
  await assert.rejects(data.writeMemory(path.join(dir, 'MEMORY.md'), 'x'));
  await assert.rejects(data.deleteMemory('/etc/hosts'));
});

test('liveVersions reads the sessions registry; cliVersion tolerates a missing CLI', async () => {
  fs.mkdirSync(path.join(tmp, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'sessions', '123.json'), JSON.stringify({ pid: 123, sessionId: sid, version: '2.1.290', kind: 'bg' }));
  fs.writeFileSync(path.join(tmp, 'sessions', '123.deadbeef.key'), 'not json');
  assert.deepEqual(await data.liveVersions(), { [sid]: '2.1.290' });
  assert.equal(await data.cliVersion(), null); // CLAUDE_BIN=/bin/false
  assert.equal((await data.respawnAll()).ok, false);
});

test('createMemory writes a templated file + index line and refuses duplicates', async () => {
  const r = await data.createMemory({ projectDir: '-tmp-b', name: ' Deploy Order ', type: 'project', description: 'deploy\nin order' });
  assert.equal(path.basename(r.file), 'deploy-order.md');
  assert.match(r.text, /^---\nname: deploy-order\ndescription: deploy in order\nmetadata:\n  type: project\n  createdBy: claude-code-manager\n---\n/);
  assert.match(r.text, /\*\*Why:\*\*/);
  assert.match(fs.readFileSync(path.join(projB, 'memory', 'MEMORY.md'), 'utf8'), /- \[deploy-order\]\(deploy-order\.md\) — deploy in order\n$/);
  await assert.rejects(data.createMemory({ projectDir: '-tmp-b', name: 'deploy-order', type: 'project' }), /이미 있습니다/);
  await assert.rejects(data.createMemory({ projectDir: '-tmp-b', name: 'x', type: 'random' }));
  await assert.rejects(data.createMemory({ projectDir: '../x', name: 'x', type: 'user' }));
  const mem = await data.listMemory();
  assert.ok(mem.some((m) => m.name === 'deploy-order' && m.type === 'project'));
});

test('chat input queue: async iteration drains pushes and ends cleanly', async () => {
  const chat = require('../src/chat');
  const q = chat._queue();
  const seen = [];
  const consumer = (async () => { for await (const m of q) seen.push(m.message.content); })();
  q.push(chat._userMsg('one'));
  await new Promise((r) => setTimeout(r, 10));
  q.push(chat._userMsg('two')); q.push(chat._userMsg('three'));
  await new Promise((r) => setTimeout(r, 10));
  q.end();
  await consumer;
  assert.deepEqual(seen, ['one', 'two', 'three']);
  assert.deepEqual(chat._userMsg('x'), { type: 'user', message: { role: 'user', content: 'x' }, parent_tool_use_id: null });
  assert.deepEqual(chat.list(), []);
  assert.throws(() => chat.send('nope', 'x'));
});

test('chat: SDK/CLI version drift is detected on the patch number', () => {
  const chat = require('../src/chat');
  assert.match(chat.SDK_VERSION, /^\d+\.\d+\.\d+$/);
  const n = chat.SDK_VERSION.split('.').pop();
  assert.equal(chat.versionWarning(`2.1.${n}`), null);
  assert.match(chat.versionWarning(`2.1.${Number(n) + 1}`) || '', /버전이 다릅니다/);
  assert.equal(chat.versionWarning(undefined), null);
});

test('readTailTitle picks up permission mode, PR link, last model and context size', async () => {
  const f = path.join(projA, 'tail-test.jsonl');
  fs.writeFileSync(f,
    line({ type: 'custom-title', customTitle: 't' }) +
    line({ type: 'permission-mode', permissionMode: 'auto' }) +
    line({ type: 'pr-link', prNumber: 26, prUrl: 'https://git.example/x/-/merge_requests/26', prRepository: 'x' }) +
    line({ type: 'assistant', timestamp: '2026-10-13T06:45:01.903Z', gitBranch: 'main', message: { model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_read_input_tokens: 623027, cache_creation_input_tokens: 2399 } } }) +
    line({ type: 'assistant', isSidechain: true, timestamp: '2026-10-13T07:00:00.000Z', message: { model: 'claude-opus-5-5' } }) +
    line({ type: 'system', subtype: 'away_summary', timestamp: '2026-10-13T06:48:08.047Z', content: 'recap' }) +
    line({ type: 'system', subtype: 'turn_duration', durationMs: 1 }));
  const t = await data.readTailTitle(f);
  assert.deepEqual([t.customTitle, t.permissionMode, t.pr.number, t.lastModel, t.lastContext, t.gitBranch], ['t', 'auto', 26, 'claude-opus-5-5', 625428, 'main']);
  assert.equal(t.lastTs, Date.parse('2026-10-13T06:45:01.903Z')); // sidechain and system records don't count
  assert.equal(await data.gitInfo('/nonexistent/dir'), null);
  const u = await data.usage(); // depends on the machine's caches; just the shape
  assert.ok(u === null || (typeof u.fiveHour.pct === 'number' && Array.isArray(u.scoped)));
});

test('user turns count image blocks', async () => {
  const sid3 = '33333333-aaaa-bbbb-cccc-000000000000';
  fs.writeFileSync(path.join(projA, `${sid3}.jsonl`),
    line({ type: 'user', timestamp: '2026-10-08T01:00:00.000Z', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'what color?' }] } }) +
    line({ type: 'user', timestamp: '2026-10-08T01:00:01.000Z', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }] } }));
  const t = await data.transcript(sid3);
  assert.deepEqual(t.turns.map((x) => [x.role, x.text, x.images]), [['user', 'what color?', 1], ['user', '', 1]]);
  const chat = require('../src/chat');
  const m = chat._userMsg('hi', [{ type: 'image/png', data: 'AAAA' }]);
  assert.deepEqual(m.message.content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'hi' }]);
  assert.equal(chat._userMsg('plain').message.content, 'plain');
});

test('env() drops a parent Claude Code session\'s markers but keeps everything else', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDECODE: '1', CLAUDE_PID: '1', CLAUDE_EFFORT: 'high', CLAUDE_CONFIG_DIR: '/keep', MY_VAR: 'keep' });
  const e = data.env();
  const pathKey = Object.keys(e).find((k) => k.toUpperCase() === 'PATH');
  for (const k of ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT']) assert.equal(k in e, false, k);
  assert.equal(e.CLAUDE_CONFIG_DIR, '/keep'); assert.equal(e.MY_VAR, 'keep'); assert.ok(e[pathKey].split(path.delimiter).includes(path.join(os.homedir(), '.local', 'bin')));
  assert.deepEqual(Object.keys(e).filter((k) => k.toUpperCase() === 'PATH'), [pathKey]); // exactly one PATH-like key
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

test('parseFrontmatter and copyMemory handle CRLF files', async () => {
  const crlf = '---\r\nname: win\r\ndescription: crlf hook\r\nmetadata:\r\n  type: project\r\n---\r\n\r\nbody\r\n';
  const { meta, body } = data.parseFrontmatter(crlf);
  assert.deepEqual(meta, { name: 'win', description: 'crlf hook', type: 'project' });
  assert.equal(body, 'body\r\n');
  const src = path.join(projA, 'memory', 'win.md');
  fs.writeFileSync(src, crlf);
  fs.writeFileSync(path.join(projB, 'memory', 'MEMORY.md'), '- [other](other.md) — x\r\n'); // CRLF index tolerated
  const r = await data.copyMemory({ src, destProjectDir: '-tmp-b' });
  const text = fs.readFileSync(r.dest, 'utf8');
  assert.equal(text, '---\r\nname: win\r\ndescription: crlf hook\r\nmetadata:\r\n  copiedFrom: -tmp-a/memory/win.md\r\n  type: project\r\n---\r\n\r\nbody\r\n');
  assert.equal(data.parseFrontmatter(text).meta.copiedFrom, '-tmp-a/memory/win.md');
  assert.equal(fs.readFileSync(path.join(projB, 'memory', 'MEMORY.md'), 'utf8'), '- [other](other.md) — x\n- [win](win.md) — crlf hook\n');
});

test('findClaude honors CLAUDE_BIN', () => {
  assert.equal(data.findClaude(), '/bin/false');
  const saved = process.env.CLAUDE_BIN;
  process.env.CLAUDE_BIN = 'custom-claude'; assert.equal(data.findClaude(), 'custom-claude');
  delete process.env.CLAUDE_BIN; assert.equal(typeof data.findClaude(), 'string'); // resolved binary or bare 'claude'
  process.env.CLAUDE_BIN = saved;
});

test('searchTranscripts: Node fallback (no grep) agrees with the grep path', async () => {
  const sid4 = '44444444-aaaa-bbbb-cccc-000000000000';
  fs.writeFileSync(path.join(projA, `${sid4}.jsonl`),
    line({ type: 'user', timestamp: '2026-10-09T01:00:00.000Z', message: { role: 'user', content: 'a ZebraQuux appears' } }) +
    line({ type: 'assistant', timestamp: '2026-10-09T01:00:01.000Z', message: { model: 'm', content: [{ type: 'text', text: 'nothing' }] } }));
  const key = (h) => h.map((x) => [x.sessionId, x.i, x.role]);
  const viaNode = await data.searchTranscripts('zebraquux', { grep: false });
  assert.deepEqual(key(viaNode), [[sid4, 0, 'user']]);
  assert.match(viaNode[0].snippet, /ZebraQuux/);
  assert.deepEqual(await data.searchTranscripts('no-such-needle-xyz', { grep: false }), []);
  assert.deepEqual(key(await data.searchTranscripts('zebraquux')), key(viaNode)); // platform default (grep, or Node on Windows)
});

test('readTailTitle follows a /background hand-off (continued-in) until the old session talks again', async () => {
  const f = path.join(tmp, 'continued.jsonl'), next = 'f61e518f-df9e-4033-96d5-d4bfb97b0608';
  fs.writeFileSync(f, line({ type: 'user', timestamp: '2026-10-18T00:00:00.000Z', message: { content: 'hi' } }) + line({ type: 'continued-in', continuedInSessionId: next }) + line({ type: 'cost-state' }));
  assert.equal((await data.readTailTitle(f)).continuedIn, next);
  fs.appendFileSync(f, line({ type: 'user', timestamp: '2026-10-18T00:01:00.000Z', message: { content: 'resumed here' } }));
  assert.equal((await data.readTailTitle(f)).continuedIn, undefined);
});

test('profiles: a sibling <config>-<id> dir is a second profile with its own sessions, env and transcripts', async () => {
  const alt = tmp + '-alt', aid = '55555555-aaaa-bbbb-cccc-000000000000';
  fs.mkdirSync(path.join(alt, 'projects', '-tmp-c'), { recursive: true });
  fs.writeFileSync(path.join(alt, 'settings.json'), JSON.stringify({ model: 'OTHER-MODEL', env: {} }));
  fs.writeFileSync(path.join(alt, 'projects', '-tmp-c', `${aid}.jsonl`),
    line({ type: 'user', timestamp: '2026-10-09T00:00:01.000Z', message: { role: 'user', content: 'alt hello' } }) +
    asst('2026-10-09T00:00:02.000Z', { input_tokens: 5, output_tokens: 7 }, [{ type: 'text', text: 'alt reply' }]));
  const ps = data.profiles();
  assert.deepEqual(ps.map((p) => [p.id, p.dir, p.model]), [['default', tmp, null], ['alt', alt, 'OTHER-MODEL']]);
  const L = data.launcher('alt');
  assert.equal(L.env.CLAUDE_CONFIG_DIR, alt);
  assert.equal(data.launcher('default').env.CLAUDE_CONFIG_DIR, tmp); // the test's own CLAUDE_CONFIG_DIR, untouched
  const ss = await data.listSessions();
  const a = ss.find((s) => s.sessionId === aid);
  assert.equal(a.profile, 'alt');
  assert.ok(ss.some((s) => s.profile === 'default'));
  assert.equal(await data.findTranscript(aid), path.join(alt, 'projects', '-tmp-c', `${aid}.jsonl`));
  assert.equal((await data.transcript(aid)).turns.map((t) => t.text).join('|'), 'alt hello|alt reply');
  assert.equal((await data.globalStats({ profile: 'alt' })).sessions, 1);
  assert.ok((await data.globalStats()).sessions >= 2);
  assert.ok((await data.listProjects()).some((p) => p.profile === 'alt' && p.dir === '-tmp-c'));
  const m = await data.createMemory({ projectDir: '-tmp-c', profile: 'alt', name: 'alt-note', type: 'project', description: 'in alt' });
  assert.ok(m.file.startsWith(path.join(alt, 'projects')));
  assert.ok((await data.listMemory()).some((x) => x.file === m.file && x.profile === 'alt'));
  await data.setPinned('55555555', true, 'alt');
  assert.ok(!(await data.readPins()).includes('55555555')); // pins are per profile: the default profile's list is untouched
  assert.equal(JSON.parse(fs.readFileSync(path.join(alt, 'jobs', 'pins.json'), 'utf8'))[0], '55555555');
});

test('daily buckets use the local (KST) calendar day', async () => {
  const f = path.join(projA, 'tz-test.jsonl');
  fs.writeFileSync(f, asst('2026-10-09T15:30:00.000Z', { output_tokens: 1 }, []) + asst('2026-10-09T14:59:00.000Z', { output_tokens: 2 }, [])); // 00:30 KST on the 10th, 23:59 KST on the 9th
  const st = await data.fileStats(f);
  assert.deepEqual(Object.keys(st.days).sort(), ['2026-10-09', '2026-10-10']);
  assert.equal(st.days['2026-10-10'].output, 1);
});
