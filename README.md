# Claude Code Manager

Electron desktop UI over the local Claude Code state in `~/.claude`.
No database of its own: sessions, status, transcripts, jobs and memory are read straight from
Claude Code's files, and lifecycle actions are delegated to the `claude` CLI.

```
npm install     # macOS: rebuilds node-pty for Electron; Windows: uses node-pty's N-API prebuilds (no compiler needed)
npm start       # run from source
npm test        # node:test (`node --test`, auto-discovers test/*.test.js), no Electron needed
npm run pack    # macOS: dist/mac-arm64/Claude Code Manager.app  (unsigned, runs from Dock)
                # Windows: dist/win-unpacked/Claude Code Manager.exe  (unsigned)
npm run dist    # macOS: dist/Claude Code Manager-<version>-arm64.dmg
                # Windows: dist/Claude Code Manager Setup <version>.exe  (NSIS, per-user, pick the folder)
npm run install-app   # sync-sdk + pack + quit the running copy + replace the installed app + relaunch
                      #   (--no-launch to skip launching, --dry-run to print the steps only)
npm run sync-sdk      # pin the Agent SDK to the installed Claude Code's patch number
npm run pack:mac / dist:mac / pack:win / dist:win   # explicit per-platform targets
```

Install (macOS): drag the .app from the DMG (or `cp -R "dist/mac-arm64/Claude Code Manager.app" /Applications/`).
`install-app` puts it in `/Applications`.
Install (Windows): run the NSIS setup, or `npm run install-app`, which copies `dist/win-unpacked` to
`%LOCALAPPDATA%\Programs\Claude Code Manager` (a running copy is closed first, `taskkill /F` after 5s) and
creates a Start Menu shortcut. No code signing, so SmartScreen may warn on a setup downloaded elsewhere.
Windows pack/dist pass `-c.npmRebuild=false`: node-pty ships prebuilt binaries, so no Python / VS Build Tools.
The bundle is unsigned (`identity: null`); a build made on this machine carries no quarantine flag and opens
normally. node-pty's native binaries are unpacked from asar so the embedded terminal works when packaged.
The app icon is drawn in `build/icon.html` (SVG); `npm run icon` renders it to `build/icon.png`, which
electron-builder converts to `icon.icns` (macOS) / `icon.ico` (Windows) at pack time. Dev runs (`npm start`) set the Dock icon from the PNG.
The Agent SDK's optional platform packages (`@anthropic-ai/claude-agent-sdk-<platform>`, a bundled Claude
binary of ~230MB) are excluded from the bundle: the app always runs the Claude Code you installed.

## What it shows

- **세션 ▾** (hover or click) — a flyout listing every session (running background agents, your
  interactive terminals, old transcripts) grouped like `claude agents`: 핀 (`jobs/pins.json`, toggle
  from the header) → 입력 대기 (`needs`/blocked) → 작업 중 → 완료 → 트랜스크립트만. Each row: name,
  last detail or pending question, PR/artifact links (`children` in `jobs/<id>/state.json`), age.
- **Account chip** (header, right): initials avatar + "이름 · 조직" from the profile Claude Code stores after
  login (`~/.claude.json` oauthAccount) and `claude auth status`; the popover shows email, org/role, plan,
  auth method, CLI version and the 5h/7d usage bars. Shows "로그인 필요" when logged out.
- **Status line** under the session header, like the TUI's: model (last assistant record), git branch with `*`
  when dirty (live `git` in the cwd), context size / window (input + cache tokens of the last response),
  5h / 7d account usage with time to reset (from Claude Code's cached utilization, statusline cache as
  fallback), permission mode, the linked PR/MR (`pr-link` records), and the last prompt with its time.
- **Right-click** a row or tab for 열기 / 붙기·떼기 / 이름 변경 / 핀 / 중지 / 재시작 / 삭제. Rename writes
  `jobs/<id>/state.json` (name + respawn `--name`) and the session's `custom-title.json`; a live session also
  gets `/rename` typed into its attached terminal. Delete is `claude rm` for background sessions, or removes
  the transcript file for sessions that only exist as a transcript.
- **통계** — everything aggregated: tiles, a daily bar chart (output/total tokens, responses, tool calls;
  30/90 days or all), per-project and per-model tables, top tools, and an API-rate estimate from an
  editable price table (USD per MTok, stored in localStorage; subscription usage is not billed this way).
  Per-session scans keep per-model and per-day buckets, so the whole page is a sum of cached scans.
- **대화 tab: tool rows hidden by default** — ⚙ tool calls (Bash, Write, …) and their 도구 결과 rows are hidden
  unless the 도구 호출 checkbox in the bar is on (remembered). A full-text search hit inside a tool row reveals them.
- **Terminal look (모양 button in the terminal bar)** — a theme gallery with preview swatches (Dracula, One Dark,
  Tokyo Night, Catppuccin, Nord, Gruvbox, Solarized, Flexoki, Kanagawa, Everforest, Night Owl, Rosé Pine, Cobalt2,
  Octocat, Hacker …) and a font picker: installed monospace families are detected (canvas width probe), any other
  family can be typed, plus size. Applies live to every open terminal and shell; saved in localStorage.
- **셸 panel (bottom, VS Code style)** — a plain terminal (your login shell) started in the session's working folder,
  for commands you want to run next to the session without them entering the conversation (unlike `!cmd` in the
  prompt). Toggle with ⌃` (menu 탭 → 셸 패널), or the 셸 button at the right of the sub-tab row; it sits under
  whichever sub-tab is open, drag its top edge to resize (height remembered), and hiding keeps the shell running.
  One shell per session tab; `exit` or 닫기 ends it, 다시 열기 starts a fresh one. Open/closed state is remembered.
  A session working inside `<project>/.claude/worktrees/<name>` gets its shell at `<project>`; the 워크트리로 cd
  button in the bar jumps into the worktree and back.
- **Terminal tab and Claude Code's fullscreen renderer** — Claude Code (2.1.30x) always draws attached background
  sessions with its fullscreen renderer (alternate screen, in-app scrolling; the `tui` setting and
  `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` do not apply to them). Wheel scrolling therefore scrolls the TUI, and after a
  wheel-up its auto-follow pauses. The app sends the TUI's `scroll:bottom` key (Ctrl+End) ahead of the first keystroke
  after a wheel-up, so typing, ↑ for history or Enter lands back at the prompt like a classic terminal. The TUI's own
  "Jump to bottom" button is clickable too.
- **Terminal tab, live-log mode** — when there is no TUI to attach to (an SDK chat owned by this app, or an
  interactive session open in another terminal) the terminal shows a read-only live log instead: the last
  40 turns rendered terminal-style (❯ prompt, ● reply, ⚙ tool, ↳ result, ✱ 완료), then the transcript tail
  as it grows. Attaching (background sessions) resets the terminal and takes over.
- **대화 (transcript viewer)** — a session's conversation without attaching: user / Claude text rendered as
  Markdown (`marked`, GFM tables, raw HTML escaped, only http/mailto links which open in the browser;
  `**bold**` also closes before Korean particles), the TUI's turn footer (✱ 완료 · 24.7s · 10:32, from
  `system/turn_duration`) and the ※ recap line (`system/away_summary`, consecutive repeats folded), tool calls
  (one line each), tool results (collapsed). Paged from the end (200 turns, "더 보기" prepends and keeps your
  place), in-conversation filter, subagent chatter skipped. The session flyout's search box filters rows as
  you type; Enter runs a full-text search over every transcript (grep narrows files, then parsed turns give
  role-aware snippets) and a hit opens that session at that turn.
- **Respawn after a Claude Code update** — the flyout's top bar shows the installed CLI version and how many
  running background sessions were started on an older build (from `~/.claude/sessions/*.json`); "모두 재시작"
  runs `claude respawn --all` after a confirm. A session's header shows its version badge (yellow when stale).
- **Session head** (title, badges, actions, status line) is collapsed to a thin strip under the tabs; hovering the strip slides it down over the pane (fade/slide animation, short open/close delays), so the terminal never reflows.
- **Tab strip**: open tabs, their order and the selected tab are remembered across restarts (only a first run with nothing saved opens every running session); drag a tab to reorder (⌘1–9 follow the new order); when tabs overflow, ‹ › arrows appear at both ends and the mouse wheel scrolls the strip sideways.
- **Shortcuts** (app menu "탭", so they work while the terminal has focus): ⌘1–9 / ⌘0 switch tabs (⌥digit
  too, fleet-style), ⌃Tab / ⌃⇧Tab next/previous, ⌘W closes the tab (never the window), ⌘N new session,
  ⌘K opens the session list with the search box focused, ⌘⇧1–4 switch 터미널 / 대화 / 통계 / 메모리, ⌃` toggles the shell panel.
  Windows variant: Ctrl+Shift+N / K / W new session / search / close tab, Ctrl+1–9 tabs, Ctrl+Alt+1–4 sub-views,
  Ctrl+Shift+C / V copy / paste in the terminal.
- **Needs-input alerts** — when a background session flips to blocked/`needs`, a macOS notification fires
  (click → that tab), the tab gets an 입력 badge until opened, and the Dock icon plus the 세션 ▾ button show
  how many sessions are waiting. Sessions already waiting at launch are counted but not re-notified.
- **Tabs** — running sessions open as tabs at start; picking a session in the flyout adds a tab.
  Closing a tab only detaches. The tab body shows live status from `~/.claude/sessions` and
  `~/.claude/jobs`, token/tool/model stats scanned
  incrementally from the transcript JSONL, and an embedded terminal that runs
  `claude attach <id>` (live background session) or `claude --resume <id>` (stopped one).
- **메모리** — all `~/.claude/projects/*/memory/*.md` across projects, filter by project,
  jump to the session that wrote it, and copy a memory into another project
  (adds `copiedFrom:` to its frontmatter and a line to that project's `memory/MEMORY.md`). Edit (whole
  file, frontmatter included, ⌘S) and delete are in the detail header; both keep the `memory/MEMORY.md`
  index line in sync (rewritten only when name/description change, removed on delete). ＋ next to the project
  filter creates a new memory (project, slug, type, one-line description) with the same frontmatter Claude Code
  writes, adds the index line, and opens it in the editor.
- **새 세션** — `claude --bg --name <name>` in a folder you pick, then attaches. Optional model (alias or full id,
  `[1m]` suffix for the 1M context), effort, permission mode and agent map 1:1 to the CLI flags; the last
  choices are remembered per machine (localStorage).
  If the folder is not trusted yet, `claude` is opened interactively in the embedded terminal instead.

## Browser pane (web development)

In a session tab, "브라우저" (right of the sub-tabs) opens a browser panel beside the terminal or chat: a
persistent `<webview>` (its own cookie store, URL remembered per project, popups open in place, draggable
divider, devtools). "요소 선택" injects a picker into the page: hover highlights, click captures the element
and suppresses the page's own click (Shift+click keeps picking, Esc cancels). Each pick becomes a chip with
selector, text, size and whatever source hints the page carries (`data-v-inspector` / Vite & Vue inspector
attributes, React dev fiber component chain + `_debugSource`, Vue component chain). The chips are prepended
as a `[선택한 요소]` block to the next chat message, or pasted into the attached terminal (bracketed paste,
so it lands in the prompt without sending). `src/webview-preload.js` is the picker; it is unpacked from asar.
Each pick also saves a cropped screenshot (📷 saves the whole page) under the app's `shots/` folder and puts
the path in the block, so Claude can Read the image from either chat or terminal. Console errors/warnings
are collected per session (toolbar badge) and attached as a block on click. "소스 열기" on a chip opens the
hinted file at its line via the VS Code CLI (`code -g`), falling back to the default app. Load failures show
an inline error with a hint; certificate errors can be allowed per host for internal sites.

## SDK chat (stage 5)

In the 대화 tab, a session that is not running (transcript-only, or a stopped background session) gets a
composer: Enter sends, Shift+Enter breaks a line, 중단 interrupts the turn. Assistant text streams into the
last turn, tool calls and results render like the transcript viewer, and the transcript on disk is reloaded
after each turn. Tool permissions show a card (허용 / 이 세션에서 항상 허용 / 거부); Claude's questions
show their options as buttons (multi-select and free text supported). A pending card on a non-active tab
adds the 입력 badge and a notification. Closing the tab ends the chat process; the transcript remains and
can be resumed in the terminal or by sending another message. 새 세션 → 실행 방식 "챗" opens a placeholder
tab in the chosen folder (model / effort / permission / agent apply, name becomes the session title); the
first message creates the session and the tab takes the real session id. Print-mode sessions do not need
the folder to be trusted first.

While a turn runs, an activity row at the bottom shows a spinner, the current phase (생각 중 / 답변 작성 중 /
<tool> 실행 중 · Ns / 결과 검토 중 / 권한 대기 / 컨텍스트 압축 중), elapsed seconds and output tokens; each
tool line carries a spinner that turns into ✓/✖ when its result lands, and the turn ends with the same
✱ 완료 · Ns footer as the TUI. Running terminal sessions show the daemon's current activity text instead.

Permission cards show why Claude Code asked (`decisionReason`, e.g. a path outside the working directory
or a compound command the auto-mode classifier would not approve) and offer 허용 (this call), 항상 허용
(the suggested rules), <tool> 전체 허용 (every call of that tool for this session, nothing written to
settings) and 거부. In auto mode the classifier approves most calls itself; only escalations reach a card.

Images: paste or drop them into either composer (up to 8, long side shrunk to 1568px). In SDK chat they go
as image blocks ahead of the text and the user turn shows thumbnails (the on-disk transcript shows a
🖼 badge); for running terminal sessions they are saved under the app's `shots/` folder and the paths are
appended as `[첨부 이미지] <path>` lines, which Claude reads with its Read tool.

Running background sessions are two-way live without stopping them: the 대화 tab tails the transcript
file (new turns appear as the session writes them, from either surface) and its composer types the message
into the session's `claude attach` client — one attach pty per session, shared with the terminal tab (a
hidden one is opened on demand and reused when the terminal tab is shown). Sends are disabled while the
session waits for a permission/question (answer in the terminal tab). "챗으로 전환" still stops the session
and continues through the SDK when you want permission/question cards. Sessions open in another terminal
are read-only live.

Hand-off both ways: "터미널로 넘기기" closes the chat process, waits for it to exit, runs
`claude --bg --resume <id>` (same id, daemon-managed; `--name` only for sessions that never had a daemon job,
because a job's saved options plus any flag make the daemon start a copy) and attaches the terminal tab; in a
folder the daemon does not trust yet it falls back to a local `claude --resume` in the terminal tab, where the
trust prompt can be answered; on a running
background session the 대화 tab offers "중지하고 여기서 이어가기" (stop, then the composer appears).

`src/chat.js` drives a session through `@anthropic-ai/claude-agent-sdk` (pinned exactly; its patch number
tracks the CLI's — `0.3.N` ↔ `2.1.N`; `npm run sync-sdk` pins it to the installed CLI when that version is
published, and `install-app` runs it first (`scripts/sync-sdk.js`, plain Node, also on Windows); the chat shows a warning banner while they drift): one
long-lived `query()` per session fed by a message queue, running the installed `claude` binary with the
terminal's PATH so hooks, plugins, settings and transcripts are identical. Every SDK message is relayed to
the renderer as `chat:event`; tool permissions and Claude's questions (`AskUserQuestion`) arrive as
`permission_request` and are answered over `chat:permission` (`allow` with `updatedPermissions` /
`updatedInput.answers`, or `deny`). Verified with real sessions: multi-turn in one process, streaming
partials, Bash tool round-trip, host-side deny, question answered. Chat is only for sessions the app
owns (new, or resumed non-live ones) — a live background session keeps its single daemon process.

## Layout

| File | Role |
|---|---|
| `src/data.js` | all reads/writes of `~/.claude` and `claude` CLI calls; plain Node, unit-tested |
| `src/main.js` | Electron main: IPC, `fs.watch` change notifications, node-pty terminals, app menu |
| `src/chat.js` | SDK-driven chat sessions (queue → `query()`, permission/question round-trip) |
| `src/preload.js` | the `window.api` bridge |
| `src/renderer/` | vanilla HTML/CSS/JS + xterm.js, no bundler |

Dev aid: `CCM_SCREENSHOT=out.png CCM_VIEW='tab=terminal&sel=<short id>' npm start` captures a screenshot and quits (`view=memory` for the memory page, `flyout=1` to open the session menu).

Sessions spawned by the app (terminal, chat, CLI calls) get a cleaned environment: the markers a parent
Claude Code session leaves in its children's env (`CLAUDE_CODE_CHILD_SESSION`, session id, messaging
socket/token, …) are dropped, otherwise an app started from inside a Claude Code session would run its
sessions as "child sessions" with transcript saving off.

The `~/.claude` file formats are Claude Code internals and change between versions;
`data.js` only reads the handful of fields it needs and tolerates unknown lines.
