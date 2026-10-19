'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const data = require('./data');
const chat = require('./chat');

data.setCacheDir(path.join(app.getPath('userData'), 'cache'));

const isMac = process.platform === 'darwin', isWin = process.platform === 'win32';
const TITLE = 'Claude Code Manager';
if (isWin) app.setAppUserModelId('local.claude-code-manager'); // = build.appId; HTML5 Notification needs it on Windows

let win;
const ptys = new Map(); // ptyId → node-pty process
let nextPty = 1;
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); }; // pty output can arrive after the window is gone

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: TITLE, autoHideMenuBar: !isMac, // Alt shows the menu; the app has its own header
    ...(!isMac && !app.isPackaged ? { icon: path.join(__dirname, '..', 'build', 'icon.png') } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, webviewTag: true },
  });
  if (!isMac) { win.on('page-title-updated', (e) => e.preventDefault()); win.on('focus', () => win.flashFrame(false)); } // keep the "(n)" badge title
  win.on('closed', () => { win = null; for (const p of ptys.values()) p.kill(); ptys.clear(); chat.closeAll(); });
  // links in rendered markdown open in the browser; the window itself never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { hash: process.env.CCM_VIEW || '' });
  if (process.env.CCM_SCREENSHOT) { // dev aid: CCM_SCREENSHOT=out.png [CCM_VIEW=stats|memory|memoryview] npm start
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      fs.writeFileSync(process.env.CCM_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      app.quit();
    }, Number(process.env.CCM_SCREENSHOT_DELAY) || 3500));
  }
}

// ---- read APIs ----
ipcMain.handle('sessions:list', () => data.listSessions());
ipcMain.handle('session:stats', (_e, id) => data.sessionStats(id));
ipcMain.handle('stats:global', () => data.globalStats());
ipcMain.handle('transcript:read', (_e, { sessionId, opts }) => data.transcript(sessionId, opts));
ipcMain.handle('transcript:search', (_e, q) => data.searchTranscripts(q));
ipcMain.handle('projects:list', () => data.listProjects());
ipcMain.handle('memory:list', () => data.listMemory());
ipcMain.handle('memory:read', (_e, file) => data.readMemory(file));
ipcMain.handle('memory:copy', (_e, req) => data.copyMemory(req));
ipcMain.handle('memory:write', (_e, { file, text }) => data.writeMemory(file, text));
ipcMain.handle('memory:delete', (_e, file) => data.deleteMemory(file));
ipcMain.handle('memory:create', (_e, req) => data.createMemory(req));

// ---- lifecycle via CLI ----
ipcMain.handle('agent:action', (_e, { action, id }) => data.agentAction(action, id));
ipcMain.handle('pins:set', (_e, { id, on }) => data.setPinned(id, on));
ipcMain.handle('cli:version', () => data.cliVersion());
ipcMain.handle('usage:get', () => data.usage());
ipcMain.handle('account:get', () => data.account());
ipcMain.handle('git:info', (_e, cwd) => data.gitInfo(cwd));
ipcMain.handle('agents:respawnAll', () => data.respawnAll());
ipcMain.handle('session:rename', (_e, req) => data.renameSession(req));
ipcMain.handle('session:deleteTranscript', (_e, req) => data.deleteTranscript(req));
ipcMain.handle('session:new', (_e, req) => data.newSession(req));
ipcMain.handle('session:resumeBg', (_e, req) => data.resumeInBackground(req));
let badgeN = 0;
ipcMain.on('app:badge', (_e, n) => {
  n = Number(n) || 0;
  if (isMac) app.dock?.setBadge(n ? String(n) : '');
  else { // no dock: count in the title, flash the taskbar when it grows
    if (process.platform === 'linux') app.setBadgeCount(n);
    if (win && !win.isDestroyed()) { win.setTitle(n ? `(${n}) ${TITLE}` : TITLE); if (n > badgeN && !win.isFocused()) win.flashFrame(true); else if (!n) win.flashFrame(false); }
  }
  badgeN = n;
});
ipcMain.on('win:focus', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } });
ipcMain.handle('dialog:pickDir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---- SDK chat sessions ----
const chatEmit = (key) => (msg) => send('chat:event', { key, msg });
ipcMain.handle('chat:start', (_e, req) => chat.start(req, chatEmit(req.key)));
ipcMain.handle('chat:send', (_e, { key, text, images }) => chat.send(key, text, images));
ipcMain.handle('chat:permission', (_e, { key, id, result }) => chat.permission(key, id, result));
ipcMain.handle('chat:interrupt', (_e, key) => chat.interrupt(key));
ipcMain.handle('chat:close', (_e, key) => chat.close(key));
ipcMain.handle('chat:list', () => chat.list());

ipcMain.on('wv:preload', (e) => { e.returnValue = 'file://' + path.join(__dirname, 'webview-preload.js'); });
// browser pane screenshots: captured here (the sandboxed renderer has no Buffer for toPNG) and saved under
// userData/shots so Claude can Read them by path; a small data URL comes back for the chip thumbnail
ipcMain.handle('shots:capture', async (_e, { wcId, rect, name }) => {
  const wc = webContents.fromId(wcId);
  if (!wc) throw new Error('webview not found');
  const img = await wc.capturePage(rect || undefined);
  const dir = path.join(app.getPath('userData'), 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${String(name || 'shot').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40)}.png`);
  fs.writeFileSync(file, img.toPNG());
  const size = img.getSize();
  return { file, thumb: img.resize({ height: 36 }).toDataURL(), width: size.width, height: size.height };
});
// pasted / dropped images for terminal sessions: saved as files whose paths go into the message
ipcMain.handle('shots:saveData', (_e, { dataUrl, name }) => {
  const m = /^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('not an image data url');
  const dir = path.join(app.getPath('userData'), 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${String(name || 'paste').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40)}.${m[2] === 'jpeg' ? 'jpg' : m[2]}`);
  fs.writeFileSync(file, Buffer.from(m[3], 'base64'));
  return file;
});
// "소스 열기": `code -g file:line` when the VS Code CLI exists, else the default app for the file
ipcMain.handle('source:open', (_e, { cwd, loc }) => new Promise((resolve) => {
  const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(String(loc || '').trim());
  if (!m) return resolve({ ok: false, error: 'bad location' });
  const file = path.isAbsolute(m[1]) ? m[1] : path.join(cwd || app.getPath('home'), m[1]);
  if (!fs.existsSync(file)) return resolve({ ok: false, error: `파일 없음: ${file}` });
  const { execFile } = require('child_process');
  const target = m[2] ? `${file}:${m[2]}${m[3] ? ':' + m[3] : ''}` : file;
  // Windows: `code` is code.cmd, which execFile can't run without a shell → quote the arg ourselves (paths may have spaces)
  const [args, o] = isWin ? [['-g', `"${target}"`], { shell: true, windowsHide: true }] : [['-g', target], {}];
  execFile('code', args, { env: data.env(), ...o }, (err) => {
    if (!err) return resolve({ ok: true, via: 'code', file });
    shell.openPath(file).then((msg) => resolve({ ok: !msg, via: 'open', file, error: msg || undefined }));
  });
}));

// ---- embedded terminal ----
// One `claude attach` client per background session, shared by the terminal tab and by chat-tab sends.
const attachPtys = new Map(); // session short id → ptyId
const ptyLast = new Map();    // ptyId → { at, sawPrompt }
function openPty(args, cwd, cols, rows, shell = false) {
  const id = nextPty++;
  let exe = data.findClaude();
  if (shell) { [exe, args] = isWin ? [process.env.ComSpec || 'cmd.exe', []] : [process.env.SHELL || '/bin/zsh', ['-l']]; } // the user's own shell, login so PATH/aliases load
  else if (isWin && /\.(cmd|bat)$/i.test(exe)) { args = ['/c', exe, ...args]; exe = process.env.ComSpec || 'cmd.exe'; } // ConPTY can't launch scripts directly
  const p = pty.spawn(exe, args, {
    name: 'xterm-256color', cols: cols || 120, rows: rows || 40,
    cwd: cwd && fs.existsSync(cwd) ? cwd : app.getPath('home'),
    env: { ...data.env(), TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'en_US.UTF-8' },
  });
  ptys.set(id, p);
  ptyLast.set(id, { at: Date.now(), sawPrompt: false });
  if (args[0] === 'attach') attachPtys.set(args[1], id);
  p.onData((d) => { const m = ptyLast.get(id); if (m) { m.at = Date.now(); if (d.includes('❯')) m.sawPrompt = true; } send('pty:data', { id, data: d }); });
  p.onExit(({ exitCode }) => { ptys.delete(id); ptyLast.delete(id); for (const [k, v] of attachPtys) if (v === id) attachPtys.delete(k); send('pty:exit', { id, code: exitCode }); });
  return id;
}
ipcMain.handle('pty:open', (_e, { args = [], cwd, cols, rows, shell }) => {
  if (shell) return openPty([], cwd, cols, rows, true); // plain shell in the session's folder (the 셸 sub-tab)
  const existing = args[0] === 'attach' && attachPtys.get(args[1]);
  if (existing && ptys.has(existing)) { // the chat tab already attached: reuse, nudge the TUI to repaint at this size
    const p = ptys.get(existing);
    try { p.resize(Math.max(20, (cols || 120) - 1), rows || 40); setTimeout(() => { try { p.resize(cols || 120, rows || 40); } catch { /* gone */ } }, 60); } catch { /* gone */ }
    return existing;
  }
  return openPty(args, cwd, cols, rows);
});
// Type a message into a running background session through its attach client (hidden one if the terminal tab is closed).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ipcMain.handle('pty:sendToSession', async (_e, { short, cwd, text }) => {
  if (!/^[0-9a-f]{8}$/.test(short)) throw new Error('bad id');
  let id = attachPtys.get(short);
  if (!id || !ptys.has(id)) {
    id = openPty(['attach', short], cwd, 140, 40);
    const t0 = Date.now(); // ponytail: ready = prompt glyph seen and 600ms of quiet (max 10s)
    while (Date.now() - t0 < 10000) { const m = ptyLast.get(id); if (!m) throw new Error('attach exited'); if (m.sawPrompt && Date.now() - m.at > 600) break; await sleep(150); }
  }
  const p = ptys.get(id); if (!p) throw new Error('attach not available');
  p.write('\x1b[200~' + text + '\x1b[201~');
  await sleep(120);
  p.write('\r');
  return { ok: true, ptyId: id };
});

// ---- live transcript tail (one watched file at a time) ----
let tail = null; // { sessionId, file, offset, watcher, timer }
function stopTail() { if (tail) { tail.watcher?.close(); clearTimeout(tail.timer); tail = null; } }
ipcMain.handle('transcript:watch', async (_e, sessionId) => {
  if (tail?.sessionId === sessionId) return true;
  stopTail();
  const file = await data.findTranscript(sessionId);
  if (!file) return false;
  const t = { sessionId, file, offset: fs.statSync(file).size, watcher: null, timer: null, busy: false };
  const pump = async () => {
    if (t.busy || tail !== t) return;
    t.busy = true;
    try {
      const size = fs.statSync(t.file).size;
      if (size < t.offset) t.offset = 0;
      if (size > t.offset) {
        const turns = [];
        t.offset = await data.streamLines(t.file, t.offset, (line) => data.ingestTurn(line, turns));
        if (turns.length && tail === t) send('transcript:append', { sessionId, turns });
      }
    } catch { /* file rotated */ } finally { t.busy = false; }
  };
  try { t.watcher = fs.watch(t.file, () => { clearTimeout(t.timer); t.timer = setTimeout(pump, 150); }); } catch { return false; }
  tail = t;
  return true;
});
ipcMain.handle('transcript:unwatch', () => { stopTail(); return true; });
ipcMain.on('pty:write', (_e, { id, data: d }) => ptys.get(id)?.write(d));
ipcMain.on('pty:resize', (_e, { id, cols, rows }) => { try { ptys.get(id)?.resize(cols, rows); } catch { /* exited */ } });
ipcMain.on('pty:kill', (_e, { id }) => ptys.get(id)?.kill());

// ---- change notifications: fs.watch, debounced ----
function watch(dir, opts, event, filter) {
  let t;
  try {
    fs.watch(dir, opts, (_ev, name) => {
      if (filter && !filter((name || '').replace(/\\/g, '/'))) return; // Windows reports backslashes
      clearTimeout(t);
      t = setTimeout(() => send(event), 500);
    });
  } catch (e) { console.warn('watch failed', dir, e.message); }
}

// Accelerators per platform. Off mac, menu accelerators fire before the page, so Ctrl+N/K/W (and the stock Edit
// menu's Ctrl+C/V/…) would steal keys from the xterm terminal (^C interrupt, ^W/^K line editing): use Ctrl+Shift+… there.
const ACC = isMac
  ? { new: 'CmdOrCtrl+N', search: 'CmdOrCtrl+K', close: 'CmdOrCtrl+W', sub: (n) => `CmdOrCtrl+Shift+${n}` }
  : { new: 'Ctrl+Shift+N', search: 'Ctrl+Shift+K', close: 'Ctrl+Shift+W', sub: (n) => `Ctrl+Alt+${n}` };
// non-mac Edit menu: roles stay (items work) but registerAccelerator:false leaves the keys to Chromium / xterm
const editMenu = isMac ? { role: 'editMenu' } : { label: '편집', submenu: ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'selectAll'].map((r) => r === 'separator' ? { type: 'separator' } : { role: r, registerAccelerator: false }) };

// App menu: keeps Edit (clipboard shortcuts) and adds tab shortcuts as accelerators, so they work even
// while the embedded terminal has focus. The default menu's ⌘W (close window) is replaced by "탭 닫기".
function buildMenu() {
  const key = (action, arg) => () => send('shortcut', { action, arg });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    editMenu,
    { label: '탭', submenu: [
      { label: '새 세션…', accelerator: ACC.new, click: key('new') },
      { label: '세션 목록 · 대화 검색', accelerator: ACC.search, click: key('search') },
      { type: 'separator' },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ label: `${n}번째 탭`, accelerator: `CmdOrCtrl+${n}`, click: key('tab', n) })),
      { label: '마지막 탭', accelerator: 'CmdOrCtrl+0', click: key('tab', 0) },
      { label: '다음 탭', accelerator: 'Ctrl+Tab', click: key('next') },
      { label: '이전 탭', accelerator: 'Ctrl+Shift+Tab', click: key('prev') },
      { label: '탭 닫기 (세션은 유지)', accelerator: ACC.close, click: key('close') },
      { type: 'separator' },
      { label: '터미널', accelerator: ACC.sub(1), click: key('sub', 'terminal') },
      { label: '대화', accelerator: ACC.sub(2), click: key('sub', 'transcript') },
      { label: '통계', accelerator: ACC.sub(3), click: key('sub', 'stats') },
      { label: '메모리', accelerator: ACC.sub(4), click: key('sub', 'memory') },
      { type: 'separator' },
      { label: '셸 패널 보이기/숨기기', accelerator: 'Ctrl+`', click: key('shell') },
    ] },
    { label: '보기', submenu: [{ role: 'reload', ...(isMac ? {} : { registerAccelerator: false }) /* Ctrl+R = shell history search */ }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: '윈도우', submenu: [{ role: 'minimize' }, ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [])] },
  ]));
}

app.whenReady().then(() => {
  if (!app.isPackaged) app.dock?.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); // dev runs show our icon too
  buildMenu();
  createWindow();
  watch(path.join(data.HOME, 'sessions'), {}, 'sessions:changed');
  watch(path.join(data.HOME, 'jobs'), { recursive: true }, 'sessions:changed', (n) => n.endsWith('state.json') || n.endsWith('pins.json'));
  watch(data.PROJECTS, { recursive: true }, 'memory:changed', (n) => n.includes('/memory/'));
  watch(data.PROJECTS, { recursive: true }, 'sessions:changed', (n) => n.endsWith('custom-title.json'));
});
// certificate errors in the browser pane: denied unless the user allowed that host (sites with private CAs)
const trustedHosts = new Set();
ipcMain.handle('wv:trustHost', (_e, host) => { if (/^[\w.-]+(:\d+)?$/.test(host)) trustedHosts.add(host); return [...trustedHosts]; });
app.on('certificate-error', (e, wc, url, _err, _cert, cb) => {
  let host = ''; try { host = new URL(url).host; } catch { /* leave */ }
  if (wc.getType && wc.getType() === 'webview' && trustedHosts.has(host)) { e.preventDefault(); cb(true); } else cb(false);
});
// the browser pane's <webview>: popups open in the same view, no node access
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  contents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) contents.loadURL(url); return { action: 'deny' }; });
  contents.on('will-attach-webview', (e, prefs) => { prefs.nodeIntegration = false; prefs.contextIsolation = true; });
});
app.on('window-all-closed', () => app.quit());
