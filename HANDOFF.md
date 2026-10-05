# HQ handoff (built 2026-10-05)

## What it is
A local business brain + autonomous assistant for the owner's projects. The dashboard is at http://localhost:8800, opened at Windows sign-in by `scripts/start-hq.vbs` through a Startup-folder shortcut. The owner's choices: dark UI; Windows toasts + ntfy phone push (headline only by default); autonomy ceiling **build (dev only)**; budget **light**; starter mission **daily morning brief 08:00**; assistant = chat box + brain-dump sorting; views = projects, reminders/calendar, roadmap.

## Architecture
- `src/server.ts`: http server (127.0.0.1 only) + JSON API + static `web/`. Non-GET requests need the `X-HQ: 1` header (CSRF guard).
- `src/lib/orchestrator.ts`: 30s tick: ingest `data/drop/` (follow-ups/approvals/missions written by hq-brain), fire due reminders, enqueue scheduled missions (only the latest missed occurrence; new schedules start from now), resume after usage-limit pauses, keep-awake, run the next queued mission (one at a time; chat runs alongside). Runs live in `data/runs/*.json` (older ones go to archive/).
- `src/lib/claude.ts`: finds the CLI (config → CLAUDE_BIN → PATH → ~/.local/bin → newest `%APPDATA%/Claude/claude-code/<ver>/<hash>/claude.exe`), builds args per level from `config/permissions.json`, writes a per-run MCP config (`data/mcp/<runId>.json`, deleted after), prompt via stdin, parses `--output-format json`, classifies ok/error/limit/auth/timeout, and parses reset times. Token savers: `--strict-mcp-config` (only hq-brain, not every connector), `--setting-sources project`, `--disable-slash-commands`, `--tools` per level. Strips the parent Claude session's env vars.
- `src/mcp/hq-brain.ts`: zero-dependency stdio MCP server. `HQ_LEVEL=read` hides write tools; `mission_schedule` is chat-only; `project_update` can't change `maxPermission`.
- `src/lib/brain.ts`: all brain file I/O; regenerates `brain/INDEX.md` on every change.
- Permission = min(mission, project.maxPermission, config autonomy). Follow-ups are capped at the parent run's level (chat follow-ups may go up to the ceiling). Max 2 follow-ups per run (light), max depth 3.

## Verified (2026-10-05)
- MCP initialize/list/call; read level hides write tools.
- CLI arg parsing at read/plan/build (reaches auth); auth error detection.
- With a fake CLI (`HQ_FAKE_CLAUDE`): follow-up chain (stops at depth 3, permission clamped), approvals, approve → run with extraAllow (hardDeny filtered), usage limit → pause until the parsed reset → resume with `--resume`, chat round-trip.
- UI: Home, Projects, project page, Roadmap, Calendar render with no console errors.

## Live status (2026-10-05, ~01:35)
- **Claude CLI signed in** (`claude auth login`, claude.ai **Pro** plan). Sign-in gotcha: after approving in the browser, the code it shows must be pasted back into the terminal. The first attempt failed for exactly that reason. Credentials: `~/.claude/.credentials.json` (never read it).
- **First live mission passed:** Morning brief → Run now: Haiku, plan level, 22 s, used hq-brain tools, saved `brain/briefs/2026-10-05.md`, shown on Home.
- HQ is running (started via `scripts/start-hq.vbs`); the Startup shortcut `HQ.lnk` is installed, so it opens at every Windows sign-in.
- Pro has tighter usage limits than Max: keep the budget on **light**. The pause/resume on limits was tested with a fake CLI, but not yet against a real limit message.

## Still open
- **JARVIS chat and voice:** not yet tried live by the owner (Assistant screen, 🎙 / Alt+J, 🔊 toggle). Voice input uses Edge's speech service.
- **Real usage-limit message:** the parser handles `|epoch`, "resets 3pm", "resets in 2h"; anything else falls back to a 60 min pause. Check `data/runs/*.json` the first time it happens.
- **ntfy:** the owner installs the app and subscribes to the topic in Settings → Notifications, then presses Send test.
- **Projects needing the owner's input:** NeuroWeb (not found anywhere), GenBot (= GenBets-P?), Blueprint Estimator (found on GitHub, not on the owner's list: keep or archive?).
- **Small brief inaccuracy:** the first brief called REQ-0002 a "test server" ticket. It's actually in the MAIN server, in preview mode. The SUMMARY is correct; Haiku shortened it wrongly.

## JARVIS HUD redesign: BUILT 2026-10-05 (see "handoff #4" at the bottom for current status; the notes below are the original plan)
The owner asked for (1) a cleaner, modern, easier-on-the-eyes UI with better findability, then (2) a full JARVIS/Iron Man HUD look (see **`docs/HUD-BRIEF.md`**: the full brief plus the live-effects request), and (3) live, game-style narration and effects while JARVIS or a mission works.

**Done:**
- `web/style.css` rewritten: the calm modern theme (tokens, Segoe UI Variable, softer surfaces). New classes it defines that app.js doesn't use yet: `.tiles/.tile`, `.chips/.chip`, `.toolbar`, `.nav-group`, `.searchbtn`, `.pal*` (command palette), `.proj.h-good|h-watch|h-risk` (health strip), `.proj .sum/.meta`, `.flash`.
- `web/hud.css` (new): HUD theme overrides under `[data-theme="hud"]`, plus components for the Command view (`.cmd`, `.core-wrap` with rings `.r1-.r5` and `.orb`, `.ring-row` progress rings, `.alert-row`, `.sysgrid`, `.countdown`, `.radar`, `.spark`, `.ping`), Mission Planner (`.goal`, `.graph`, `.edge.flow`, `.node`), boot sequence (`.boot*`), ticker (`.ticker .lbl .track`), warp transitions (`.warp-out/.warp-in`, `.holo-in`), `.tilt`, `.glitch`, and reduced-motion handling.
- `web/index.html` rewritten: theme bootstrap (`localStorage hq-theme`, default `hud`), Google Fonts (Orbitron/Rajdhani/JetBrains Mono), `#bgfx` canvas + `.scan` overlay, grouped nav with SVG icons (Command, Today=#home, JARVIS, Projects, Planner, Calendar, Roadmap, Inbox, Missions, Settings), `#openPal` search button, `#clock`, `#ticker`, the `#pal` palette markup and the `#boot` container. Loads `app.js` then **`hud.js` (doesn't exist yet → 404)**.
- Backend: `brain.ts` gained goals (`listGoals/saveGoal/deleteGoal/setStepDone`, `brain/goals.json`, included in INDEX.md) and `searchBrain(q)`. `server.ts` gained `GET /api/search?q=`, `POST /api/goals`, `DELETE /api/goals/:id`, `PATCH /api/goals/:id/steps/:sid {done}`, and `goals` in `/api/state`. The MCP server gained `goal_list`, `goal_save`, `goal_step_done`. Seeded goal "Survive the Reddit API shutdown" (7 steps). Verified: search works, the index regenerates, the MCP tool list loads.
- **The running HQ server is still the OLD process** (started before these changes). Restart it (`scripts/STOP-HQ.cmd` then `START-HQ.cmd`) so the goals and search APIs exist.

**Not done (next session):**
1. **`web/hud.js`**: Command view `vCommand` (core SVG + orb reacting to `status.running/chatBusy`/voice, project progress rings, alerts, system grid, next-deadline countdown, radar, ask-box → `/api/chat` with a decode effect on the reply), Mission Planner `vPlanner` (node graph, drag reorder → `POST /api/goals` with the reordered steps, click a node for details, tick → PATCH, "Break down with JARVIS" → chat), the Ctrl+K palette (views, actions, projects, reminders, milestones, missions, inbox, decisions, plus debounced `/api/search`), boot sequence (once per session, skippable), `#bgfx` particles/grid canvas (rAF, mouse pull, paused when hidden), live clock, ticker from `S.activity`, Web Audio blips (muted by default; `localStorage hq-sound`), panel tilt, count-up/scramble helpers, warp transitions on hashchange, reduced-motion fallbacks.
2. **`web/app.js` wiring**: add `command` and `planner` to the views map; make the default route `command`; `#openPal` + Ctrl+K; Projects toolbar (search + stage chips); Home tiles; use `.proj h-<health>` cards; a theme toggle (HUD/Calm) in Settings; replace `toast()` in the HUD theme with game-style notifications (`hudNotify`).
3. **Live operations feed**: this edit was written but NOT applied (the script failed on shell quoting; nothing changed). Plan: in `claude.ts` switch to `--output-format stream-json --verbose`, parse stdout line by line, add `narrate(event)` that maps tool_use events to short status lines (hq-brain tools, Read/Edit/Bash/WebSearch…) and an `onStep` callback; keep `interpret()` picking the final `{"type":"result"}` line. In `orchestrator.ts`, add an in-memory `ops` map (`opStart/opEnd`, `liveOps()`) fed from `execute()` and `sendChat()`. In `server.ts`, add `GET /api/live`. In the UI, poll `/api/live` every ~1s while anything is busy and show an "OPERATION IN PROGRESS" overlay with typed step lines, elapsed time and blips; the core goes into its busy state. **Write the Python patch to a scratch file and run it** (heredocs in this shell break on backslashes and quotes).
4. Verify in the preview (launch config `hq` in `LoanBot/.claude/launch.json`, port 8800; stop the real HQ first or use `HQ_PORT`), then restart the real HQ.

## How to resume in a new session
1. Read this file, then `brain/INDEX.md`.
2. Check HQ is up: `curl localhost:8800/api/state` (or open the dashboard). If it's down, run `scripts/START-HQ.cmd`.
3. Check auth: `<claude.exe> auth status` → `loggedIn: true`.
4. After any project work, patch `brain/projects/<slug>/` (log.md + project.json).

## Ideas for later
- Cloud fallback for missions while the PC is off (Claude Code cloud sessions / routines).
- Weekly review mission (template exists, disabled), deadline-watch template (disabled).
- Optional `claude install` native CLI for a stable path (the bundled desktop copy changes path on updates; findClaude handles that).

## 2026-10-05 later: plugins + next task
- Installed account-wide: **frontend-design** (claude-plugins-official) and **design** (knowledge-work-plugins), plus **context7** and **playwright** (claude-plugins-official). They load only in new sessions.
- **Plugin status (checked 2026-10-05, new session):** both are in `~/.claude/plugins/installed_plugins.json` and `enabledPlugins` in `~/.claude/settings.json`. The `design:*` skills load (accessibility-review, design-critique, design-handoff, design-system, ux-copy, user-research, research-synthesis). Its connectors (Figma, Notion, Linear, Slack, Atlassian, Intercom) need OAuth in claude.ai connector settings / `/mcp`, and Asana fails to connect (no dynamic client registration); none of these are needed for HQ. The **frontend-design** skill didn't show up in the Desktop session's skill list, but its file is at `~/.claude/plugins/cache/claude-plugins-official/frontend-design/<sha>/skills/frontend-design/SKILL.md`, so read it directly. For the HUD, the owner's brief (`docs/HUD-BRIEF.md`) pins the look and wins where they conflict; use the skill for restraint and the quality floor (focus, reduced motion, mobile, contrast).
- Next task the owner wants: futuristic JARVIS look for `web/` (boot animation, glowing core that pulses when listening/talking, glass panels, smooth page transitions, typing replies, subtle grid/particles, count-up numbers). No new dependencies; respect prefers-reduced-motion.
- A short copy of this handoff for the owner is at `HQ/JARVIS-HANDOFF.md`.

## 2026-10-05 handoff #3: more plugins, so restart in a new session
- The owner added **context7** and **playwright** (claude-plugins-official). Installed + enabled now: frontend-design, design, context7, playwright. New plugins load only in a **new** session.
- Use them for the JARVIS build: **playwright** to open http://localhost:8800 (or the `HQ_PORT` test copy), click through views and take screenshots for the owner; **context7** only if you need library docs (HQ has no deps, so rarely); **frontend-design** for the quality floor (its SKILL.md path is above if it isn't in the skill list).
- **Nothing in the JARVIS build changed in this session.** It only recorded plugin status and re-read the code. The "Not done" list under "IN PROGRESS: JARVIS HUD redesign" is still the plan, in that order.
- Integration points already found (so you don't have to re-derive them):
  - `web/app.js`: views map is in `render()` (~line 133); default route `"home"` in `parseHash()` and `let route`; `toast()` at line 24; `projectCard()` at ~158 (switch to `.proj h-<health>` + `.sum/.meta`); `vSettings` at ~563 (add the HUD/Calm toggle); keydown handler at ~613 (add Ctrl+K); 6 s refresh loop at the bottom. Globals hud.js can use: `S`, `route`, `api`, `act`, `esc`, `md`, `render`, `refresh`, `speak`, `listen`, `fmtWhen`, `ago`, `projName`, `toDate`, `ymd`.
  - `web/hud.css` already styles everything hud.js needs (classes listed in the IN PROGRESS section). `web/style.css` has `.tiles/.chips/.toolbar/.pal*/.proj.h-*/.flash`.
  - Live ops feed: `src/lib/claude.ts` `buildArgs()` line 72 (`--output-format json` → `stream-json --verbose`), `runClaude()` stdout handler at line 103 (parse lines, call `o.onStep`), `interpret()` already picks the last `{` line, so make sure it picks `{"type":"result"}`. `src/lib/orchestrator.ts`: `execute()` calls `runClaude` at ~339, `sendChat()` at ~429; add the `ops` map + `liveOps()` there. `src/server.ts`: add `["GET", /^\/api\/live$/, () => orch.liveOps()]` to `routes`. Update the fake CLI used in tests to emit stream-json lines.
  - Goals data: `brain/goals.json`, type `Goal { id, title, project, why, due, steps: {id,title,due,done}[] }`. API: `POST /api/goals` (full goal, for reorder), `PATCH /api/goals/:id/steps/:sid {done}`, `DELETE /api/goals/:id`; `S.goals` in `/api/state`.
- The running HQ is still the OLD process: `/api/search` and `/api/live` return 404 until it restarts (`scripts/STOP-HQ.cmd` then `START-HQ.cmd`). Restarting the owner's own local dashboard is fine; it is not a live service.
- **Round 2 requests added (same evening):** see "Round 2 requests" at the bottom of `docs/HUD-BRIEF.md`: a reel-style multi-agent terminal feed, effect text for narration, boot + **shutdown** screens, a smooth gliding sidebar indicator and transitions, a one-click **Opus** switch (already the `deep` tier), and a fast **project switcher**. Build order for the next session: (1) hud.js core (boot/shutdown, bg, clock, ticker, palette, sidebar glide, transitions), (2) app.js wiring + model switch + project switcher, (3) live ops backend (stream-json → `/api/live`), (4) the reel-style ops grid UI on top of it, (5) Planner, (6) verify with Playwright screenshots. The real-server shutdown endpoint needs the owner's OK before it's wired.

## 2026-10-05 handoff #4: JARVIS HUD built (code done; real HQ NOT restarted yet)
**All six build steps are done** and were tested on a scratch copy of HQ (port 8811, fake CLI). The real HQ on :8800 is still the OLD process: the restart was blocked by the permission classifier, so **the owner restarts it** (`scripts\STOP-HQ.cmd`, then `scripts\START-HQ.cmd`). Until then `/api/live` and `/api/search` return 404 and the dashboard runs the old server (the new UI tolerates that).

**Files changed**
- `src/lib/narrate.ts` (new): turns stream-json into steps `{id, kind, tool, verb, target, result, ok, added, removed, diff}`. Friendly hq-brain wording ("Updating LoanCentral", "Setting reminder"), `redact()` for tokens/`KEY=value`/bearer/long strings, no diff/content for secret-looking paths (`.env`, token, credential, .pem…).
- `src/lib/claude.ts`: `--output-format stream-json --verbose`; `onStep` option feeds the narrator; `interpret()` picks the `{"type":"result"}` line (falls back to the last JSON line; non-JSON stdout used as error text).
- `src/lib/orchestrator.ts`: in-memory `ops` map (`opStart`/`opEnd`/`liveOps()`), fed from `execute()` and `sendChat()`; finished ops linger 25 s.
- `src/server.ts`: `GET /api/live`.
- `web/hud.js` (new, ~750 lines): sound (muted default, `hq-sound`), scramble/typewriter/reveal/count-up, game-style notifications (`hudNotify`, replaces `toast()` in HUD theme), clock + countdowns, ticker, particle/grid canvas (paused when hidden/asleep, static under reduced motion), gliding sidebar glow, view entrance animation, tilt, project focus + switcher (`hq-project`, Ctrl/Alt+1–9, Ctrl+0 = all), model switch Fast/Balanced/Opus (`hq-tier`, Opus warning), Ctrl+K palette (views, actions, projects, focus, reminders, milestones, missions, goals, inbox, decisions + debounced `/api/search`), boot (once per session) + shutdown (screen only, click/key to wake), reel-style ops dock polling `/api/live`, Command view, Mission Planner.
- `web/app.js`: default route `command`; views `command`/`planner`; `render()` sets `#view[data-view]` and calls `hudAfterRender`; `renderChrome()` calls `hudChrome`; Projects filter toolbar + stage chips; Home tiles; new project cards; JARVIS screen uses the tier switch and syncs focus; mission forms label models by name with the Opus warning and default to the focused project; Settings has Look & feel (theme, sound, replay boot, power down); boot runs on `DOMContentLoaded` (after hud.js).
- `web/index.html`: `#psw` switcher, `#ops` dock, `#powerBtn`. `web/hud.css`: Round-2 component styles appended. `web/style.css`: views use full width (reading pages capped at 1500px), narrow-column overflow fixes.

**Verified on the copy (Playwright, 1440×900, 1920×1080, 390×844):** no console errors; boot; Command (core, rings, alerts, system count-up, countdown, radar); ask box → chat → ops tile streaming steps with diff lines, `✓ 506 passed`, `API_TOKEN=•••`, friendly brain steps → reply revealed; Planner graph + edges + step details; palette ranking; switcher; Projects filter; Today tiles; JARVIS; Settings; shutdown + wake; Calm theme; no sideways scroll on phone (Settings checked after the last fix only by code, not re-measured). Screenshots: `HQ/.playwright-mcp/*.png` (plus Playwright's `page-*.yml` snapshots; delete the folder when done).

**Not done / next**
1. Owner restarts HQ (above), then a first **real** chat to confirm stream-json parsing against the real CLI (the fake CLI's event shapes were modelled on Claude Code's stream-json; check `data/runs/*.json` and the ops tile if anything looks off).
2. The scratch copy server on :8811 may still be running (stopping it was declined). It's harmless; it dies with the session or via Task Manager (node.exe on 8811).
3. **Owner decision pending:** should "Power down" also stop the HQ server (`POST /api/shutdown`)? Currently screen-only.
4. **New owner request: Google Calendar + Gmail in HQ.** Not started. Options to put to the owner: (a) Calendar via the secret iCal (.ics) address from Google Calendar settings, fetched by the server and shown on Calendar/Command (no deps, read-only; the URL is a secret, so it goes in `config/hq.local.json` and must never be printed); (b) Gmail/Calendar through the claude.ai connectors in a scheduled mission that summarizes unread mail and today's events into the brain (needs those connectors added to HQ's per-run MCP config, which is `--strict-mcp-config` today); (c) Google OAuth app in HQ (most work; the owner must create the Google Cloud credentials). Read-only only; never send mail (agent hard limits).
5. Brain not yet updated for this work (no `hq` project log entry).

## 2026-10-05: JARVIS renamed to Luthor
- Assistant name/persona: `config/hq.json` → `assistant` (`project: "luthor"` picks the page that lists chats).
- New brain project `luthor`; its page has a **Chats** tab (current + archived). API: `GET /api/chats`, `GET /api/chats/:id`. Raw chats stay in `data/chat/` (gitignored).
- Chats are unified: `src/lib/transcripts.ts` reads Claude Code session files for the HQ folder (read-only, text only). `POST /api/chats/:id/continue` makes any chat the live Luthor chat (resumes its session).
- Desktop app: `scripts/INSTALL-APP.cmd` makes Desktop + Start menu shortcuts (icon `web/icon.ico`). `start-hq.vbs` now waits for the server (polls /api/live), uses its own browser profile (`%LOCALAPPDATA%\HQ\window`), Edge → Chrome → default browser.
