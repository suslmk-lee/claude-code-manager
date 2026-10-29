// npm run install-app [--no-launch] [--dry-run] — pack the app, replace the installed copy, relaunch it.
// A running copy is asked to quit first (force-killed after 5s) so the install dir can be swapped safely.
//   macOS:   /Applications/Claude Code Manager.app          (install-app.sh logic, ported)
//   Windows: %LOCALAPPDATA%\Programs\Claude Code Manager    + Start Menu shortcut
// --dry-run prints the steps without running or touching anything.
const { spawn, spawnSync, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const launch = !argv.includes('--no-launch')
const dry = argv.includes('--dry-run')
const NAME = 'Claude Code Manager'

// Windows: run detached. Started from the app's own terminal (or by a Claude session it hosts), quitting the app kills
// this script with it, mid-install; a detached copy outlives the app and relaunches the installed one. Output → log file.
if (process.platform === 'win32' && !dry && !process.env.CCM_INSTALL_CHILD) {
  const log = path.join(os.tmpdir(), 'ccm-install-app.log')
  const fd = fs.openSync(log, 'w')
  spawn(process.execPath, [__filename, ...argv], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, CCM_INSTALL_CHILD: '1' } }).unref()
  console.log(`install-app continues in the background (quits and relaunches the app) · log: ${log}`)
  process.exit(0)
}

const say = (m) => console.log(dry ? `[dry-run] ${m}` : m)
// shell:true for npm.cmd; every command string below is built from fixed text and resolved paths
const sh = (cmd) => {
  say(`$ ${cmd}`)
  if (dry) return 0
  const r = spawnSync(cmd, { cwd: root, shell: true, stdio: 'inherit' })
  return r.status == null ? 1 : r.status
}
const quiet = (cmd) => spawnSync(cmd, { shell: true, stdio: 'ignore' }).status
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const must = (code, what) => { if (code) { console.error(`${what} failed (${code})`); process.exit(code) } }
// total size of a directory tree, human readable (du -sh)
function dirSize(p) {
  let n = 0
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    const f = path.join(p, e.name)
    n += e.isDirectory() ? dirSize(f) : fs.lstatSync(f).size
  }
  return n
}
const human = (n) => n >= 2 ** 30 ? (n / 2 ** 30).toFixed(1) + 'G' : (n / 2 ** 20).toFixed(0) + 'M'

// Windows: a copy running from dist\win-unpacked (or the install dir) locks its files, so it quits before the pack, not after
const winImage = `${NAME}.exe`
const winRunning = () => (spawnSync(`tasklist /FI "IMAGENAME eq ${winImage}" /NH`, { shell: true, encoding: 'utf8' }).stdout || '').includes(winImage)
function winQuit() {
  say(`taskkill /IM "${winImage}" (graceful), /F after 5s if still running`)
  if (dry || !winRunning()) return
  console.log('quitting running app…')
  quiet(`taskkill /IM "${winImage}"`)
  for (let i = 0; i < 5 && winRunning(); i++) sleep(1000)
  if (winRunning()) quiet(`taskkill /F /IM "${winImage}"`)
  sleep(500)   // let Windows release file handles before dist / the install dir is replaced
}

must(sh('node scripts/sync-sdk.js'), 'sync-sdk')   // SDK patch number follows the installed Claude Code
if (process.platform === 'win32') winQuit()
must(sh('npm run pack'), 'pack')

if (process.platform === 'darwin') {
  const APP = `/Applications/${NAME}.app`
  const SRC = path.join(root, 'dist/mac-arm64', `${NAME}.app`)
  const proc = `${NAME}.app/Contents/MacOS`
  // by process name and by path: a copy relaunched by macOS at login once slipped past the path match, kept running the
  // old binary under the freshly copied bundle, and `open -a` only brought that stale window forward
  const pids = () => (spawnSync(`pgrep -x "${NAME}"; pgrep -f "${proc}/${NAME}"`, { shell: true, encoding: 'utf8' }).stdout || '').split(/\s+/).filter(Boolean)
  const running = () => pids().length > 0
  say(`quit running app (osascript, pkill after 5s) if "${NAME}" is running`)
  if (!dry && running()) {
    console.log(`quitting running app… (pid ${pids().join(', ')})`)
    quiet(`osascript -e 'quit app "${NAME}"'`)
    for (let i = 0; i < 5 && running(); i++) sleep(1000)
    if (running()) { quiet(`pkill -x "${NAME}"`); quiet(`pkill -f "${proc}/${NAME}"`); sleep(1000) }
    if (running()) { console.error(`could not quit the running app (pid ${pids().join(', ')}) — quit it yourself and rerun`); process.exit(1) }
  }
  must(sh(`rm -rf "${APP}"`), 'rm')
  must(sh(`ditto "${SRC}" "${APP}"`), 'ditto')
  if (launch) {
    sh(`open -a "${APP}"`)
    let pid = []
    for (let i = 0; i < 10 && !(pid = pids()).length; i++) sleep(500)
    console.log(pid.length ? `relaunched (pid ${pid.join(', ')})` : 'relaunch: no process seen after 5s — open the app yourself')
  }
  say(dry ? `installed → ${APP}` : `installed → ${APP} (${human(dirSize(APP))})`)
} else if (process.platform === 'win32') {
  const SRC = path.join(root, 'dist', 'win-unpacked')
  const DEST = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', NAME)
  const LNK = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`)
  const EXE = path.join(DEST, `${NAME}.exe`)
  winQuit()   // again: started during the pack
  say(`replace ${DEST} with a copy of ${SRC}`)
  if (!dry) {
    if (!fs.existsSync(SRC)) { console.error(`missing ${SRC}`); process.exit(1) }
    fs.rmSync(DEST, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(DEST), { recursive: true })
    fs.cpSync(SRC, DEST, { recursive: true })
  }
  say(`create Start Menu shortcut ${LNK} → ${EXE} (PowerShell WScript.Shell)`)
  if (!dry) {
    // paths go through env vars so PowerShell quoting never depends on them
    const ps = '$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:CCM_LNK);$s.TargetPath=$env:CCM_EXE;' +
      '$s.WorkingDirectory=$env:CCM_DIR;$s.IconLocation=$env:CCM_EXE+",0";$s.Save()'
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      env: { ...process.env, CCM_LNK: LNK, CCM_EXE: EXE, CCM_DIR: DEST }, stdio: 'inherit',
    })
  }
  if (launch) {
    say(`launch ${EXE}`)
    if (!dry) spawnSync('explorer.exe', [EXE], { stdio: 'ignore' })   // detached from this console, like `open -a`
  }
  say(dry ? `installed → ${DEST}` : `installed → ${DEST} (${human(dirSize(DEST))})`)
} else {
  console.error(`install-app: unsupported platform ${process.platform}`)
  process.exit(1)
}
