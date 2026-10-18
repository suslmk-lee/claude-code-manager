#!/bin/sh
# npm run install-app — pack the app, replace the copy in /Applications, relaunch it.
# A running copy is asked to quit first (force-killed after 5s) so the bundle can be swapped safely.
set -e
cd "$(dirname "$0")/.."
APP="/Applications/Claude Code Manager.app"
SRC="dist/mac-arm64/Claude Code Manager.app"

sh scripts/sync-sdk.sh   # SDK patch number follows the installed Claude Code
npm run pack

if pgrep -f "Claude Code Manager.app/Contents/MacOS" >/dev/null; then
  echo "quitting running app…"
  osascript -e 'quit app "Claude Code Manager"' >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do pgrep -f "Claude Code Manager.app/Contents/MacOS" >/dev/null || break; sleep 1; done
  pkill -f "Claude Code Manager.app/Contents/MacOS" 2>/dev/null || true
fi

rm -rf "$APP"
ditto "$SRC" "$APP"
[ "$1" = "--no-launch" ] || open -a "$APP"
echo "installed → $APP ($(du -sh "$APP" | cut -f1))"
