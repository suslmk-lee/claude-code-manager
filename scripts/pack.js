// npm run pack — unpacked app for the current platform (dist/mac-arm64/*.app or dist/win-unpacked).
// Windows passes npmRebuild=false: node-pty ships N-API prebuilds, a node-gyp rebuild would need VS Build Tools.
const { spawnSync } = require('child_process')
const args = { darwin: '--mac dir', win32: '--win dir -c.npmRebuild=false' }[process.platform]
if (!args) { console.error(`pack: unsupported platform ${process.platform}`); process.exit(1) }
const r = spawnSync(`electron-builder ${args}`, { stdio: 'inherit', shell: true, cwd: require('path').join(__dirname, '..') })
process.exit(r.status == null ? 1 : r.status)
