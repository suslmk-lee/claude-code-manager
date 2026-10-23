// node scripts/bump-version.js [--dry-run] — patch +1 in package.json and package-lock.json (root + packages[""]).
// Runs before every pack/dist so each build has a distinct version; `npm start` / `npm test` don't bump.
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const dry = process.argv.includes('--dry-run')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')
const pkgRaw = read('package.json')
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(JSON.parse(pkgRaw).version)
if (!m) { console.error('bump-version: package.json version is not x.y.z'); process.exit(1) }
const from = m.slice(1, 4).join('.'), to = `${m[1]}.${m[2]}.${+m[3] + 1}`
// re-serialize with 2-space JSON, keeping the file's own line endings
function write(f, raw, edit) {
  const j = JSON.parse(raw)
  edit(j)
  let out = JSON.stringify(j, null, 2) + '\n'
  if (raw.includes('\r\n')) out = out.replace(/\n/g, '\r\n')
  if (!dry) fs.writeFileSync(path.join(root, f), out)
}
write('package.json', pkgRaw, (j) => { j.version = to })
if (fs.existsSync(path.join(root, 'package-lock.json')))
  write('package-lock.json', read('package-lock.json'), (j) => { j.version = to; if (j.packages && j.packages['']) j.packages[''].version = to })
console.log(`version ${from} → ${to}${dry ? ' (dry run)' : ''}`)
