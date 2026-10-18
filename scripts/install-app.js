// npm run install-app [--no-launch] [--dry-run] — pack the app, replace the installed copy, relaunch it.
// A running copy is asked to quit first (force-killed after 5s) so the install dir can be swapped safely.
//   macOS:   /Applications/Claude Code Manager.app          (install-app.sh logic, ported)
//   Windows: %LOCALAPPDATA%\Programs\Claude Code Manager    + Start Menu shortcut
// --dry-run prints the steps without running or touching anything.
const { spawnSync, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const root = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const launch = !argv.includes('--no-launch')
const dry = argv.includes('--dry-run')
const NAME = 'Claude Code Manager'

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

must(sh('node scripts/sync-sdk.js'), 'sync-sdk')   // SDK patch number follows the installed Claude Code
must(sh('npm run pack'), 'pack')

if (process.platform === 'darwin') {
  const APP = `/Applications/${NAME}.app`
  const SRC = path.join(root, 'dist/mac-arm64', `${NAME}.app`)
  const proc = `${NAME}.app/Contents/MacOS`
  const running = () => quiet(`pgrep -f "${proc}"`) === 0
  say(`quit running app (osascript, pkill after 5s) if "${proc}" is running`)
  if (!dry && running()) {
    console.log('quitting running app…')
    quiet(`osascript -e 'quit app "${NAME}"'`)
    for (let i = 0; i < 5 && running(); i++) sleep(1000)
    quiet(`pkill -f "${proc}"`)
  }
  must(sh(`rm -rf "${APP}"`), 'rm')
  must(sh(`ditto "${SRC}" "${APP}"`), 'ditto')
  if (launch) sh(`open -a "${APP}"`)
  say(dry ? `installed → ${APP}` : `installed → ${APP} (${human(dirSize(APP))})`)
} else if (process.platform === 'win32') {
  const SRC = path.join(root, 'dist', 'win-unpacked')
  const DEST = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', NAME)
  const LNK = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`)
  const EXE = path.join(DEST, `${NAME}.exe`)
  const image = `${NAME}.exe`
  const running = () => (spawnSync(`tasklist /FI "IMAGENAME eq ${image}" /NH`, { shell: true, encoding: 'utf8' }).stdout || '').includes(image)

  say(`taskkill /IM "${image}" (graceful), /F after 5s if still running`)
  if (!dry && running()) {
    console.log('quitting running app…')
    quiet(`taskkill /IM "${image}"`)
    for (let i = 0; i < 5 && running(); i++) sleep(1000)
    if (running()) quiet(`taskkill /F /IM "${image}"`)
    sleep(500)   // let Windows release file handles before the dir is replaced
  }
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
