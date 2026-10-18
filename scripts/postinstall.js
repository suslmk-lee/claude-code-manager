// postinstall — rebuild native deps for Electron.
// node-pty 1.1 ships N-API prebuilds for win32 (x64/arm64), which load in any Electron, so Windows skips the
// rebuild (it would need Python + VS Build Tools for nothing). macOS keeps the original rebuild step.
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

if (process.platform === 'win32') {
  const dir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds', `win32-${process.arch}`)
  if (fs.existsSync(path.join(dir, 'pty.node'))) {
    console.log(`node-pty prebuilt binary found (win32-${process.arch}); skipping electron-builder install-app-deps`)
    process.exit(0)
  }
}
const r = spawnSync('electron-builder install-app-deps', { stdio: 'inherit', shell: true, cwd: path.join(__dirname, '..') })
process.exit(r.status == null ? 1 : r.status)
