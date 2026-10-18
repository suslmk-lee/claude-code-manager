'use strict';
// SDK-driven chat sessions (stage 5). One long-lived `query()` per session, fed by a message queue, running the
// same installed `claude` binary as the terminal so hooks/plugins/settings/transcripts are identical.
const { query } = require('@anthropic-ai/claude-agent-sdk');
const data = require('./data');
const fs = require('fs');
const path = require('path');
// The SDK tracks the CLI's patch number (0.3.N ↔ 2.1.N); the package blocks require('…/package.json'), so read it.
let SDK_VERSION = '?';
try { SDK_VERSION = JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json'), 'utf8')).version; } catch { /* keep ? */ }
function versionWarning(cliVersion) {
  const a = /\.(\d+)$/.exec(SDK_VERSION)?.[1], b = /\.(\d+)$/.exec(cliVersion || '')?.[1];
  return a && b && a !== b ? `Agent SDK ${SDK_VERSION} ↔ Claude Code ${cliVersion} 버전이 다릅니다. 동작은 설치된 CLI 기준이지만 프로토콜이 어긋날 수 있습니다. SDK 0.3.${b}가 공개되면 npm run sync-sdk (install-app이 자동 실행) 로 맞춰집니다.` : null;
}

const sessions = new Map(); // key → { key, cwd, input, abort, q, pending, sessionId, busy }
let nextReq = 1;

function queue() {
  const items = []; let wake = null, done = false;
  return {
    push(m) { items.push(m); wake?.(); },
    end() { done = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (items.length) { yield items.shift(); continue; }
        if (done) return;
        await new Promise((r) => { wake = r; });
        wake = null;
      }
    },
  };
}
// images: [{ type: 'image/png', data: <base64> }] become image blocks ahead of the text
const userMsg = (text, images = []) => ({
  type: 'user', parent_tool_use_id: null,
  message: { role: 'user', content: images.length ? [...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.type, data: i.data } })), { type: 'text', text }] : text },
});
const must = (key) => { const s = sessions.get(key); if (!s) throw new Error('no such chat'); return s; };

// emit(msg) receives every SDK message as-is plus ours: permission_request, permission_cancelled, stderr, error, closed.
function start({ key, cwd, text, images, resume, model, effort, permissionMode, title, agent }, emit) {
  if (sessions.has(key)) throw new Error('already running');
  const input = queue(), abort = new AbortController();
  const s = { key, cwd, input, abort, pending: new Map(), sessionId: resume || null, busy: true };
  sessions.set(key, s);
  s.q = query({ prompt: input, options: {
    cwd, resume: resume || undefined, model: model || undefined, effort: effort || undefined, permissionMode: permissionMode || undefined, title: title || undefined, agent: agent || undefined,
    includePartialMessages: true, abortController: abort,
    pathToClaudeCodeExecutable: data.findClaude(), env: data.env(), // the terminal's binary and PATH, even when launched from Finder
    canUseTool: (tool, inp, opts) => new Promise((resolve) => {
      const id = nextReq++;
      s.pending.set(id, resolve);
      emit({ type: 'permission_request', id, tool, input: inp, suggestions: opts.suggestions || [], blockedPath: opts.blockedPath || null, decisionReason: opts.decisionReason || null, title: opts.title || null });
      opts.signal?.addEventListener('abort', () => { if (s.pending.delete(id)) { emit({ type: 'permission_cancelled', id }); resolve({ behavior: 'deny', message: 'cancelled' }); } });
    }),
    stderr: (line) => emit({ type: 'stderr', line }),
  } });
  input.push(userMsg(text, images));
  (async () => {
    try {
      for await (const m of s.q) {
        if (m.type === 'system' && m.subtype === 'init') {
          s.sessionId = m.session_id;
          const w = !s.warned && versionWarning(m.claude_code_version);
          if (w) { s.warned = true; emit({ type: 'warning', message: w }); }
        }
        if (m.type === 'result') s.busy = false;
        emit(m);
      }
      emit({ type: 'closed' });
    } catch (e) {
      emit(e?.name === 'AbortError' ? { type: 'closed' } : { type: 'error', message: e?.message || String(e) });
    } finally { sessions.delete(key); }
  })();
  return { key, sessionId: s.sessionId };
}
function send(key, text, images) { const s = must(key); s.busy = true; s.input.push(userMsg(text, images)); return true; }
function permission(key, id, result) { const s = must(key); const r = s.pending.get(id); if (!r) return false; s.pending.delete(id); r(result); return true; }
const interrupt = (key) => must(key).q.interrupt();
function close(key) {
  const s = sessions.get(key); if (!s) return false;
  sessions.delete(key); // gone from list() right away; the reader loop finishes on its own
  s.input.end();
  for (const r of s.pending.values()) r({ behavior: 'deny', message: 'session closed' });
  s.pending.clear();
  s.q.close?.();
  s.abort.abort();
  return true;
}
const closeAll = () => { for (const k of [...sessions.keys()]) close(k); };
const list = () => [...sessions.values()].map((s) => ({ key: s.key, sessionId: s.sessionId, cwd: s.cwd, busy: s.busy, pending: [...s.pending.keys()] }));

module.exports = { start, send, permission, interrupt, close, closeAll, list, SDK_VERSION, versionWarning, _queue: queue, _userMsg: userMsg };
