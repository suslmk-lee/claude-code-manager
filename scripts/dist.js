// npm run dist — installer for the current platform. Explicit per-platform targets because build.mac.target is "dir"
// (what `pack` and install-app use); a bare `electron-builder` would only emit the dir again on macOS.
// Windows passes npmRebuild=false: node-pty ships N-API prebuilds, a node-gyp rebuild would need VS Build Tools.
const { spawnSync } = require('child_process')
const args = { darwin: '--mac dmg', win32: '--win nsis -c.npmRebuild=false' }[process.platform]
if (!args) { console.error(`dist: unsupported platform ${process.platform}`); process.exit(1) }
const r = spawnSync(`electron-builder ${args}`, { stdio: 'inherit', shell: true, cwd: require('path').join(__dirname, '..') })
process.exit(r.status == null ? 1 : r.status)
