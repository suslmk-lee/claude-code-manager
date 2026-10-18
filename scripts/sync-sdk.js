// npm run sync-sdk — pin @anthropic-ai/claude-agent-sdk to the installed Claude Code's patch number (0.3.N ↔ 2.1.N).
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
// shell:true so `claude` / `npm` resolve through PATHEXT on Windows (claude.exe, npm.cmd); all args are fixed strings
const run = (cmd, opts = {}) => spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', ...opts })

const v = run('claude --version')
const cli = v.status === 0 && /\d+\.\d+\.\d+/.exec(v.stdout || '')
if (!cli) { console.log('claude CLI not found; keeping the current SDK'); process.exit(0) }
const want = `0.3.${cli[0].split('.')[2]}`

let cur = 'none'
try { cur = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@anthropic-ai/claude-agent-sdk/package.json'), 'utf8')).version } catch {}
if (cur === want) { console.log(`SDK ${cur} already matches Claude Code ${cli[0]}`); process.exit(0) }

if (run(`npm view @anthropic-ai/claude-agent-sdk@${want} version`).status === 0) {
  console.log(`SDK ${cur} → ${want} (Claude Code ${cli[0]})`)
  process.exit(run(`npm i -E @anthropic-ai/claude-agent-sdk@${want}`, { stdio: 'inherit' }).status || 0)
} else {
  console.log(`SDK ${want} is not published yet; keeping ${cur} (Claude Code ${cli[0]})`)
}
