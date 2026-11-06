// npm run release [--no-dist] [--no-commit] — build this platform's installer (dist), commit the version bump, then publish a
// GitHub Release tagged v<version> with the installer attached. The app polls that feed and offers the update in its header.
// Needs `gh` logged in. If the tag's release already exists (the other platform published first) the file is just added.
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const argv = process.argv.slice(2)
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...opts })
if (!argv.includes('--no-dist') && run('node', ['scripts/dist.js']).status) process.exit(1)
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const tag = `v${version}`
const files = fs.readdirSync(path.join(root, 'dist')).filter((f) => f.includes(version) && /\.(dmg|exe)$/i.test(f)).map((f) => path.join('dist', f))
if (!files.length) { console.error(`release: no installer for ${version} in dist/`); process.exit(1) }
if (!argv.includes('--no-commit')) { // the tag should point at the commit that carries this version
  run('git', ['add', 'package.json', 'package-lock.json'])
  if (spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: root }).status) run('git', ['commit', '-q', '-m', `Version: repo at ${tag} (released)`])
  if (run('git', ['push', '-q', 'origin', 'HEAD']).status) process.exit(1)
}
const exists = spawnSync('gh', ['release', 'view', tag], { cwd: root, stdio: 'ignore' }).status === 0
const r = exists ? run('gh', ['release', 'upload', tag, ...files, '--clobber'])
  : run('gh', ['release', 'create', tag, ...files, '--title', tag, '--generate-notes'])
if (!r.status) console.log(`${exists ? 'added to' : 'published'} release ${tag}: ${files.join(', ')}`)
process.exit(r.status == null ? 1 : r.status)
