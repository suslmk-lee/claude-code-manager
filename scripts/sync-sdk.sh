#!/bin/sh
# npm run sync-sdk — pin @anthropic-ai/claude-agent-sdk to the installed Claude Code's patch number (0.3.N ↔ 2.1.N).
set -e
cd "$(dirname "$0")/.."
CLI=$(claude --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
[ -n "$CLI" ] || { echo "claude CLI not found; keeping the current SDK"; exit 0; }
N=${CLI##*.}
CUR=$(node -p "JSON.parse(require('fs').readFileSync('node_modules/@anthropic-ai/claude-agent-sdk/package.json','utf8')).version" 2>/dev/null || echo none)
WANT="0.3.$N"
if [ "$CUR" = "$WANT" ]; then echo "SDK $CUR already matches Claude Code $CLI"; exit 0; fi
if npm view "@anthropic-ai/claude-agent-sdk@$WANT" version >/dev/null 2>&1; then
  echo "SDK $CUR → $WANT (Claude Code $CLI)"
  npm i -E "@anthropic-ai/claude-agent-sdk@$WANT"
else
  echo "SDK $WANT is not published yet; keeping $CUR (Claude Code $CLI)"
fi
