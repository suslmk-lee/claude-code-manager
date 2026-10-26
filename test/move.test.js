'use strict';
// 폴더 이동 against a scratch home: the folder moves, its project dirs (and a child's) are re-keyed with paths rewritten
// inside transcripts and memory, config keys / history / job cwd follow, and a sibling that shares the encoded prefix is left alone.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), os = require('os');
const { planMove, moveFolder } = require('../src/move');
const { encodeProject } = require('../src/data');

const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const j = (o) => JSON.stringify(o);

test('moveFolder carries projects, config, history, jobs and memory to the new path; siblings untouched', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-move-')));
  const work = path.join(root, 'work'), cfg = path.join(root, 'cfg');
  const old = path.join(work, 'proj'), sub = path.join(old, 'sub'), sib = path.join(work, 'proj-docs'), to = path.join(work, 'cat', 'proj');
  fs.mkdirSync(sub, { recursive: true }); fs.mkdirSync(sib); fs.mkdirSync(path.join(work, 'cat'));
  w(path.join(old, 'a.txt'), 'x');
  const P = (p) => path.join(cfg, 'projects', encodeProject(p));
  w(path.join(P(old), 's1.jsonl'), [j({ type: 'user', cwd: old, sessionId: 's1' }), j({ type: 'assistant', cwd: old, message: { content: [{ type: 'tool_use', input: { file_path: `${old}/a.txt` } }] } })].join('\n') + '\n');
  w(path.join(P(old), 'MEMORY.md'), `- [x](memory/x.md) — see ${old}/README\n`);
  w(path.join(P(old), 'memory', 'x.md'), `lives in ${old}\nnot ${old}-docs\n`);
  w(path.join(P(sub), 's2.jsonl'), j({ type: 'user', cwd: sub }) + '\n');
  w(path.join(P(sib), 's3.jsonl'), j({ type: 'user', cwd: sib }) + '\n');
  w(path.join(cfg, '.claude.json'), j({ projects: { [old]: { hasTrustDialogAccepted: true }, [sub]: { allowedTools: [] }, [sib]: { hasTrustDialogAccepted: true } } }));
  w(path.join(cfg, 'history.jsonl'), [j({ display: 'hi', project: old }), j({ display: 'yo', project: sib }), j({ display: `${old} 봐줘`, project: path.join(work, 'other') })].join('\n') + '\n');
  w(path.join(cfg, 'jobs', 'abcd1234', 'state.json'), j({ cwd: old, name: 'j', linkScanPath: `${old}/.git` }));
  w(path.join(cfg, 'jobs', 'ffff0000', 'state.json'), j({ cwd: sib }));
  const ctx = { profiles: [{ id: 'default', dir: cfg }], sessions: [] };

  const plan = await planMove({ from: old, to }, ctx);
  assert.deepStrictEqual(plan.errors, []);
  assert.deepStrictEqual(plan.profiles[0].projDirs.map((d) => d.enc).sort(), [encodeProject(old), encodeProject(sub)].sort());
  assert.strictEqual(plan.profiles[0].config, 2); assert.strictEqual(plan.profiles[0].history, 1); assert.strictEqual(plan.profiles[0].jobs, 1);

  const r = await moveFolder({ from: old, to }, ctx);
  assert.ok(r.ok);
  assert.ok(fs.existsSync(path.join(to, 'a.txt')) && !fs.existsSync(old));
  const nsub = path.join(to, 'sub');
  assert.ok(fs.existsSync(P(to)) && fs.existsSync(P(nsub)) && !fs.existsSync(P(old)) && !fs.existsSync(P(sub)));
  const s1 = fs.readFileSync(path.join(P(to), 's1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(s1[0].cwd, to); assert.strictEqual(s1[1].message.content[0].input.file_path, `${to}/a.txt`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(P(nsub), 's2.jsonl'), 'utf8')).cwd, nsub);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(P(sib), 's3.jsonl'), 'utf8')).cwd, sib);
  assert.strictEqual(fs.readFileSync(path.join(P(to), 'memory', 'x.md'), 'utf8'), `lives in ${to}\nnot ${old}-docs\n`);
  assert.ok(fs.readFileSync(path.join(P(to), 'MEMORY.md'), 'utf8').includes(`${to}/README`));
  const c = JSON.parse(fs.readFileSync(path.join(cfg, '.claude.json'), 'utf8')).projects;
  assert.deepStrictEqual(Object.keys(c).sort(), [to, nsub, sib].sort());
  const hist = fs.readFileSync(path.join(cfg, 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(hist[0].project, to); assert.strictEqual(hist[1].project, sib); assert.strictEqual(hist[2].display, `${old} 봐줘`); // prompt text is history: only `project` (path followed by `"`) is re-keyed
  const job = JSON.parse(fs.readFileSync(path.join(cfg, 'jobs', 'abcd1234', 'state.json'), 'utf8'));
  assert.strictEqual(job.cwd, to); assert.strictEqual(job.linkScanPath, `${to}/.git`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(cfg, 'jobs', 'ffff0000', 'state.json'), 'utf8')).cwd, sib);
  assert.ok(!fs.readdirSync(P(to)).some((f) => f.endsWith('.ccm-tmp')));

  // refusals: into itself, onto an existing path, a session run from a terminal
  assert.ok((await planMove({ from: to, to: path.join(to, 'x') }, ctx)).errors.length);
  assert.ok((await planMove({ from: to, to: sib }, ctx)).errors.length);
  assert.ok((await planMove({ from: to, to: old }, { ...ctx, sessions: [{ live: true, cwd: to, kind: 'foreground', name: 'fg', sessionId: 'x' }] })).errors.some((e) => e.includes('fg')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('moveFolder stops background sessions in the folder first and respawns them after', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-move-')));
  const old = path.join(root, 'a'), to = path.join(root, 'b'); fs.mkdirSync(old);
  const calls = []; let live = true;
  const ctx = { profiles: [{ id: 'default', dir: path.join(root, 'cfg') }], get sessions() { return [{ live, cwd: old, kind: 'background', name: 'bg', short: 'abcd1234', sessionId: 'S', profile: 'default' }]; },
    agentAction: async (a, id) => { calls.push(a + ':' + id); if (a === 'stop') live = false; return { ok: true, output: '' } } };
  const r = await moveFolder({ from: old, to }, ctx);
  assert.deepStrictEqual(calls, ['stop:abcd1234', 'respawn:abcd1234']);
  assert.ok(r.log.some((l) => l.startsWith('중지')) && r.log.some((l) => l.startsWith('재시작')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('moveFolder fixes a Python venv and repairs a git worktree inside the moved folder', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-move-')));
  const old = path.join(root, 'repo'), to = path.join(root, 'cat', 'repo'); fs.mkdirSync(path.join(root, 'cat'));
  const { execFileSync } = require('child_process');
  const g = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString();
  fs.mkdirSync(old); g(old, 'init', '-q'); w(path.join(old, 'f'), '1'); g(old, 'add', '.'); g(old, 'commit', '-qm', 'i');
  g(old, 'worktree', 'add', '-q', path.join(old, '.claude', 'worktrees', 'wt'), '-b', 'wt');
  const venv = path.join(old, '.venv');
  w(path.join(venv, 'pyvenv.cfg'), 'home = /usr/bin\nversion = 3.12\n');
  w(path.join(venv, 'bin', 'activate'), `VIRTUAL_ENV="${venv}"\nexport VIRTUAL_ENV\n`);
  w(path.join(venv, 'bin', 'pip'), `#!${venv}/bin/python3\nimport sys\n`);
  fs.writeFileSync(path.join(venv, 'bin', 'tool.bin'), Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 1, 2])); // a real binary: untouched
  w(path.join(venv, 'lib', 'python3.12', 'site-packages', 'mypkg.pth'), `${old}/src\n`);
  w(path.join(venv, 'lib', 'python3.12', 'site-packages', 'mypkg-1.0.dist-info', 'direct_url.json'), j({ url: `file://${old}`, dir_info: { editable: true } }));
  const ctx = { profiles: [{ id: 'default', dir: path.join(root, 'cfg') }], sessions: [] };
  const plan = await planMove({ from: old, to }, ctx);
  assert.deepStrictEqual(plan.venvs, [venv]);
  assert.deepStrictEqual(plan.worktrees.map((x) => [x.path, x.repo]), [[path.join(old, '.claude', 'worktrees', 'wt'), old]]);
  const r = await moveFolder({ from: old, to }, ctx);
  const nv = path.join(to, '.venv');
  assert.strictEqual(fs.readFileSync(path.join(nv, 'bin', 'activate'), 'utf8'), `VIRTUAL_ENV="${nv}"\nexport VIRTUAL_ENV\n`);
  assert.strictEqual(fs.readFileSync(path.join(nv, 'bin', 'pip'), 'utf8').split('\n')[0], `#!${nv}/bin/python3`);
  assert.strictEqual(fs.readFileSync(path.join(nv, 'bin', 'tool.bin'), 'latin1').charCodeAt(0), 0xcf);
  assert.strictEqual(fs.readFileSync(path.join(nv, 'lib', 'python3.12', 'site-packages', 'mypkg.pth'), 'utf8'), `${to}/src\n`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(nv, 'lib', 'python3.12', 'site-packages', 'mypkg-1.0.dist-info', 'direct_url.json'), 'utf8')).url, `file://${to}`);
  const wt = path.join(to, '.claude', 'worktrees', 'wt');
  assert.ok(r.log.some((l) => l.startsWith('워크트리 복구:')), r.log.join('\n'));
  assert.strictEqual(g(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'wt'); // git works inside the moved worktree again
  assert.ok(g(to, 'worktree', 'list').includes(wt.replace(/\\/g, '/')) || g(to, 'worktree', 'list').includes(wt)); // git prints C:/… on Windows
  fs.rmSync(root, { recursive: true, force: true });
});
