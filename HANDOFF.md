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

## 2026-10-05 handoff #5: Google Calendar (option a, read-only iCal) BUILT
- `src/lib/calendar.ts` (new, no deps): fetches iCal feeds (Google secret address, Outlook, iCloud, any https .ics), parses VEVENT (TZID via Intl, all-day, DURATION, RRULE DAILY/WEEKLY/MONTHLY/YEARLY with INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY/BYMONTH/BYSETPOS, EXDATE, RECURRENCE-ID overrides, CANCELLED). 10 min cache, keeps last good data on errors.
- Security: feed URLs live only in `config/hq.local.json` (`calendar.feeds`), never sent to the dashboard or put in errors. https only; localhost/private-IP/IPv6-literal hosts blocked, and redirects are followed by hand so each hop gets the same check; 15 s timeout, 8 MB cap; max 10 feeds. Event descriptions are not read (only title, time, location).
- API: `GET /api/calendar?from&to` (YYYY-MM-DD, max 400 days), `POST /api/calendar/feeds {name,url}` (fetches once to check before saving), `DELETE /api/calendar/feeds/:id`, `POST /api/calendar/sync`. `/api/state` has `calendar: {feeds (no URL), upcoming (next 15 days)}`.
- UI: Settings → Calendar (paste the address, status, Sync now, Remove). Calendar view shows events in green (per-feed colour), and they're included in "Next up". Command screen has a Schedule panel, "STARTS IN N MIN" alerts (45 min ahead) and radar blips.
- hq-brain MCP: new read-only `calendar_events {days}` tool, so the morning brief can include today's events. (Tool calls can now be async.)
- Tested on a copy (port 8812) with stubbed network (this sandbox can't reach Google): recurrence/DST/EXDATE/override unit checks, add/reject flows, no URL in any API response, Playwright laptop + phone screenshots, no console errors.
- **Not done:** first real feed on the owner's PC (needs the HQ restart). Option (b) Gmail digest mission is next. Optionally tell the morning-brief mission to call `calendar_events`.

## 2026-10-05 handoff #6: Outbox (approved email/calendar), Code screen, NOVA redesign
- **Outbox** (`src/lib/outbox.ts`, `data/outbox.json`): JARVIS drafts via hq-brain `email_draft` / `calendar_draft` (drop → orchestrator → outbox), or the owner composes in the UI. Nothing goes out until the owner presses Approve (with a confirm). Send = one `claude -p` run in **act mode** (`RunOptions.act` in `claude.ts`): no built-in tools (`--tools ""`), no hq-brain, no agent rules, `--allowedTools` = only the connector's prefix (`mcp__<server name, non-alnum→_>`), no `--strict-mcp-config` (so claude.ai connectors load), fast model, 4 min. The payload is passed as data, and the run must end with `SENT|DRAFTED|DONE|FAILED`. Connectors are discovered with `claude mcp list` (cached 10 min, Settings → "Check connectors"); override the names with `connectors.email` / `connectors.calendar` in `hq.local.json`. A crash mid-send marks the item failed on restart (it is never auto-retried).
- Agent rules updated: email/calendar only through the draft tools; `act on any account` keeps the Outbox as its single exception. hardDeny now blocks Edit/Write in `**/LoanCentral-Test/**`.
- **Code screen** (`src/lib/code.ts`, `data/code/<slug>.json`): one resumable session per project, build level capped by project.maxPermission/autonomy, read-only if any path matches LoanCentral-Test. It runs from the HQ root with `--add-dir` for the project folders (so HQ's own deny rules keep working). Live steps come through the ops map (`kind: "code"`). API: `GET/POST /api/code/:slug`, `/stop`, `/new`. Stop kills the run.
- **NOVA look** (`web/nova.css`, `web/nova.js`, `web/views.js`): WebGL deep-space scene (nebula, parallax stars, holo floor; reacts to the pointer and to busy state), shader plasma core with gyroscope rings, projects orbit the core (drag to spin, hover for details, click to open), glass panels with pointer light + spring 3D tilt, magnetic buttons, cursor halo + click shockwave, holographic page assembly + light sweep. Removed: radar, sparkline, system grid, ticker, scanlines, corner brackets. Command = Today timeline (calendar + reminders with a NOW line) · core + ask · Needs you (approvals, outbox, overdue, events starting soon, deadline countdown) + quick actions. Fonts: Inter / Space Grotesk / JetBrains Mono. Reduced motion freezes it; with no WebGL it falls back to a plain dark background. Calm theme unaffected.
- Tested on a copy with a fake CLI: outbox validate/add/edit/send (fake connector), act-mode args, code session with live steps + diffs + stop/busy guard, screenshots at 1440 and 390 (no sideways scroll), no console errors. **Not tested against the real CLI:** connector names from `claude mcp list`, whether connectors load in `-p` with `--setting-sources project`, whether the claude.ai Gmail connector can send (if not, HQ saves a Gmail draft). First real send will tell; check `data/outbox.json` `result`.

## 2026-10-05 handoff #7: voice orb, Stark HUD, hideable sidebar, colour coding
- Core is now an **AI voice orb** (`coreDraw` in `web/nova.js`, canvas 2D, supersampled): layered closed light-waves + 96-bar frequency ring. Idle breathes; **listening uses the real mic level** (getUserMedia + AnalyserNode, started/stopped with the `.listening` class; falls back to a synthetic level); **speaking** follows `speechSynthesis.speaking`; thinking adds swirling comet arcs (violet). The label reads ONLINE / LISTENING / THINKING / SPEAKING.
- Stark-style radial HUD around it (`hudRings()` SVG): tick scale, segmented ring, brackets (faster when busy), and a live diagnostics fan (runs / queue / inbox / outbox via `hudFan()` in `cmdFill`), plus a clock. Desktop side panels are angled like holo screens on a curved desk (`.nv-desk`) and straighten on hover. Project satellites are holographic badges (initials hex, health-coloured progress arc, rotating ticks).
- **Sidebar hidden by default on desktop**: ☰ button top-left (or the M key) opens it as a drawer; it closes on navigation / outside click / Esc. Settings → Look & feel → Sidebar: Hidden / Always shown (`localStorage hq-side`).
- Command cleanup: "Needs you" grouped Urgent (red) / Waiting on you (amber) / Coming up (blue); Today rows colour-coded (events green, reminders amber, happening now highlighted); "watch" health rows, the empty Missions panel and the HUD degree numbers were removed.
- `scripts/UPDATE-HQ.cmd`: updates from the newest `brain-hq*.zip` in Downloads (backup → stop → copy src/web/config/scripts + docs → start). It keeps brain/, data/ and hq.local.json.

## 2026-10-05 handoff #8: parallel agents, Code grid, Tasks, hands-free, briefing, eye boot
- **Orchestrator runs in parallel** (`active` map replaces `current`): one background lane (scheduled/followup) + `tasks.maxParallel` (default 3) owner runs (tasks, manual, approvals). Two runs never share a project. Owner runs skip the daily cap (as manual did).
- **Tasks** (`trigger: "task"`, `taskId` = root run id): `POST /api/tasks`, `/:id/reply` (resumes the lead session), `/:id/cancel`, `GET /api/tasks`. Sub-agents = `queue_followup` from a task run (inherit `taskId`/effort). Chat `queue_followup` now becomes a Task. When the whole tree finishes → one notify (phone) + `task-done/issue` activity.
- **Code** (`src/lib/code.ts`): many sessions, keyed by file name (`data/code/<id>.json`; old `<slug>.json` still load). `GET/POST /api/code`, `GET/POST/PUT/DELETE /api/code/:id`, `/stop`. Cap `code.maxParallel` (4). Text ("says") steps are kept so the UI shows decisions.
- **Effort**: `--effort low|medium|high` (RunOptions.effort, never for Haiku). UI: Auto/Low/Med/High next to the model switch; `api()` wrapper in live.js adds it to any body with `tier`.
- **Front-end** `web/live.js` + `live.css` (load last): agent network (SVG wires + packets), comms feed, session grid + drawer, Tasks view, "Hey JARVIS" wake word (continuous SpeechRecognition; restarts on end; ignores while speaking), guided briefing (`Brief`, spotlight + zoom + waypoint + speech, voice next/back/stop), `Cine.show` one-shot camera, phone tab bar + drawer sidebar, eye boot (`hudBoot` override; hud.js now boots on DOMContentLoaded). Default view: Code on desktop, JARVIS on phone. Mobile skips the getUserMedia analyser.
- Tested on the copy with the fake CLI (parallel code sessions + 2 parallel tasks, reports, screenshots 1600 and 390, no console errors). Not tested: real `--effort` on the owner's CLI version, wake word on iOS Safari.

## 2026-10-05 handoff #9: Spotify, bring-in sessions, terminal Code look, focus panel, simpler Tasks
- **Spotify** (`src/lib/spotify.ts`, `web/music.js`): OAuth code + PKCE, no client secret. Owner makes a free app at developer.spotify.com, pastes the Client ID in Settings → Spotify, and presses Connect on the PC (redirect `http://127.0.0.1:<port>/api/spotify/callback`; override with `spotify.redirectUri`). Refresh token is stored only in `config/hq.local.json` and rotated; the access token is kept in memory only. Routes: `/api/spotify` (status, no secrets), `/client`, `/login`, `/callback` (GET, protected by state + PKCE), `/now`, `/devices`, `/control`, `/play`, `/disconnect`. The top-bar music button opens the player. Voice and typed commands ("play X", "skip", "pause", "volume up", "what's playing") are handled locally before JARVIS chat. Playback control needs Premium. Tested with a mocked fetch only, not against real Spotify.
- **Bring in session** (Code): `code.external(slug)` lists Claude Code transcripts in `~/.claude/projects/<encoded folder>` (or `CLAUDE_CONFIG_DIR`) for the project's folders. `code.importSession` copies the .jsonl into HQ's own project dir and resumes the copy, so cwd and settings stay HQ's and the original is untouched.
- **Code screen** restyled as a flat terminal (`.tui`): octagon agent map with dotted ring and spokes, boxes titled in the border, project-colour outlines, filters (All / Working / Needs a look), and a hideable agent map (hidden by default on phones). No space background on this view.
- **Project colours**: `projColor(slug)` (palette, or a `color` "#rrggbb" in project.json, set from Setup). `paintProjects()` tags project links and cards after every render.
- **Command focus panel**: when a project is in focus, it shows that project's next step, reminders and milestones in the next 30/60 days, approvals and outbox drafts, goals, and live work.
- **Tasks** simplified: one box plus "Send"; project, permission (plain words), model and effort sit behind an options summary; a 3-step "how it works" strip; the agent map shows only while something runs.
- Phone: subtitles and Brief button hidden, project page shows a summary card (the edit form is behind Edit), and the tabs scroll. Colourful emoji were replaced with SVG icons or text; `font-variant-emoji: text` is set globally.

## 2026-10-05 handoff #10: wheel picker, form drafts, now-playing HUD, Code side by side
- `web/picker.js`: every date, time and date-time input gets a scrolling wheel picker with quick picks. The native input stays, hidden, so FormData is unchanged. Wheels snap to the centre band using `scroll-padding-top: 80px`; don't remove it, or AM/PM snaps wrong.
- Drafts: unfinished form fields are saved to sessionStorage per view, form and name, and restored after re-renders; they're cleared on submit. Background refresh now skips while an input in `#view` is focused or the picker is open. This fixes the reminder time resetting.
- `musicHud()` (music.js): floating HUD "now playing" at the top-left of the Command stage, desktop only.
- Code layout "Side by side" (desktop): up to 3 sessions as full chat columns, each with its own input, live steps and project tint. Pins are in `hq-code-split`. A tile's ⇥ button or the drawer's "Open side by side" adds a session.

## 2026-10-05 handoff #11: Canvas (inspired by Morphy's canvas + focus view)
- `src/lib/canvas.ts` and `/api/canvas[/:id]` (GET/POST/PUT/DELETE): layouts in `data/canvas/<id>.json`. Card types: project, agent (ref = code session id), checklist (ref = goal id) and note (text). Cards are validated and clamped; at most 60 cards and 60 canvases.
- `web/canvas.js` and `web/canvas.css`, view `#canvas/<id>`:
  - Board: tabs for open canvases, a breadcrumb (double-click to rename), and a dotted board. Drag empty space to pan; the mouse wheel pans and Ctrl+wheel zooms. Toolbar: add, zoom, fit, undo/redo. Minimap at bottom-right.
  - Cards: drag a card by its header (it snaps to an 8px grid) and resize it from the corner.
  - Focus: drag an agent card to the right edge, or press ⇥, to open it in a focus column (up to 2, kept in `hq-cv-focus`).
  - Agent cards are live chats (`/api/code/:id`) with their own model picker.
  - The project card shows Working / Need you / Canvases / Shipped, plus New chat, New canvas and the agents list.
  - Checklists tick goal steps through `/api/goals/:id/steps/:sid`.
  - The first visit auto-creates a "Main canvas" for the focused project, containing its sessions and goals.
- Phone: cards are stacked with no panning.
- Codex/GPT agents (shown in Morphy) are not added. The engine stays Claude Code; adding another engine would be a separate, opt-in piece of work.
- Follow-up: chat messages everywhere use a compact `codeMsgHTML` (override in canvas.js). Steps fold into "› N steps · last action · +a −r" and expand on click. The input bar has a model picker, a lock (`readOnly` → the session runs at "read" level for that message, enforced server-side in `code.send`) and a reactor send button; Enter sends. Canvas has Canvas / Columns modes (Columns = up to 3 chats filling the screen, `hq-cv-cols`). Stark layer: HUD corner brackets, a glowing dot, and a header shimmer plus scan line while an agent works.

## 2026-10-05 handoff #12: renamed to LUTHUR, permission modes, usage readout, fixes
- Product and assistant are now **LUTHUR**: `config/hq.json` assistant.name, title, brand, manifest and the user-visible strings. The wake word also matches luther/luthor/luthur. Folder names, the `X-HQ` header, the `hq-*` storage keys and internal prompts are unchanged.
- Code chats: per-chat thinking level (disabled for Haiku). Permission mode `mode`: safe = allowlist; auto = acceptEdits plus Bash/Edit/Write; bypass = `--permission-mode bypassPermissions`. Bypass is not yet tested against the real CLI. HQ's alwaysDeny/hardDeny lists are passed in every mode.
- Usage: `runStats()` reads context (the last assistant call's input + cache tokens), the context window (modelUsage), `total_cost_usd` and any `rate_limit_event`, and saves them as `session.usage`, shown under the chat header.
- Fixes: raw stream-json/base64 no longer becomes reply text; the session drawer is pinned right (it sat left and swept across the screen on close); long text wraps.

## 2026-10-05 handoff #13: Workspace (several Google accounts: Mail + Drive, read-only)
- `src/lib/google.ts` and `/api/google*`: the owner's own Google Cloud OAuth "Desktop app" client (id and secret in `config/hq.local.json`), installed-app flow with PKCE and a loopback redirect `http://127.0.0.1:<port>/api/google/callback`. Scopes are only `gmail.readonly` and `drive.readonly`, plus openid/email.
- Accounts: up to 12, each with id `g-<sha256(email)[:10]>`, a label, a colour and a refresh token. Access tokens are kept in memory only. An `invalid_grant` marks the account signed out but doesn't delete it. Remove also revokes the token at Google.
- Mail: Gmail REST list plus metadata (cached for 60 s per account and query), and read with plain-text body extraction (HTML is stripped server-side). The dashboard escapes everything and never renders mail HTML.
- Drive: list, search, folders, type filters and shared drives. Previews: Sheets via the Sheets API (tabs, 500×52 cells; falls back to CSV export of the first tab), Docs and Slides as plain text, and CSV/TXT. Open links get `authuser=<email>` so they open in the right account.
- `web/workspace.js` and `web/workspace.css`, view `#workspace`: account chips (All plus one per company), Mail/Drive tabs, list plus reader; on phone the reader replaces the list. The Accounts panel holds setup, label, colour, reconnect and remove.
- With accounts connected, the Command Inbox panel reads from them directly (no Claude run) and links to `#workspace/mail/<acct>/<id>`.
- Security: `hostOk()` in server.ts blocks API requests whose Host is a foreign domain (DNS-rebinding guard). It allows IPs, localhost, single-label names, *.ts.net and config `allowedHosts`.
- Writing (follow-up), opt-in per account through "Allow writing": a re-consent that adds the `gmail.send`, `documents` and `spreadsheets` scopes (`include_granted_scopes`). Granted scopes are saved as `account.scopes`.
  - Email: the Outbox payload takes an optional `from` (account id; `validate` also accepts a label or email through `google.findAccount`) plus `threadId`, `inReplyTo` and `references`. `outbox.send` then sends directly through `google.sendMail` (RFC 2822 built by hand; header values have CR/LF stripped). The `email_draft` MCP tool accepts `from`.
  - The Workspace composer (Compose, Reply, and the Outbox's New/Edit when a write account exists) always saves to the Outbox first, then Send means approve-and-send.
  - "Write with LUTHUR" uses `src/lib/compose.ts`: a no-tools Sonnet run, with any quoted email passed as data. It returns `{subject, body}`.
  - Docs and Sheets: `createFile` (doc or sheet), `sheetSet` (batchUpdate with USER_ENTERED; edited from the preview grid with "Edit cells", which adds 3 spare rows and 1 spare column), `docAppend` and `docReplace` (replaceAllText). Each is confirmed in the UI and logged to `data/activity.jsonl` as `google-*`.
  - Nothing can delete mail or files, or share them. The Docs API must be enabled (setup step 2).

## 2026-10-05 handoff #14: space backgrounds
- The holo grid floor is gone. `SCENE_FS` in nova.js has 4 vistas: s0 nebula plus ringed gas giant, s1 sunrise over a planet's limb, s2 black hole with a lensed sky, s3 spiral galaxy. They crossfade through `uA`/`uN`/`uX` and slowly push in (`uZ`). Mouse parallax moves near objects more than far stars.
- `web/space.js`: the playlist (`spaceView()` feeds the shader) plus the owner's wallpapers in `HQ\backgrounds\`. That folder is created at startup and listed at `/api/backgrounds`; files are served at `/bg/<name>` with a strict name regex, an extension whitelist and Range support for video. Wallpapers render as `#nova-wall` img/video with a crossfade and Ken Burns push-in. The Settings card "Background" picks which views, the interval, and Next view, saved per viewer in `hq-space`.
- Follow-up: the default background is now just the original nebula (scene 4) with no floor and no cycling. Preferences moved to the key `hq-space2`. Stars come from a crisp 2D layer, `#nova-stars` in space.js: about 1 star per 1500 px², following a power-law magnitude, with star-temperature colours, halos, and spikes on roughly the brightest 3%. Planet views draw their own shader stars so the planets cover them, and they render at full resolution (`sceneRes`).
- Settings sections fold into drop-downs. Open sections are remembered in `hq-set-open`; the fold wrapper in space.js re-folds the Spotify and Background wrappers after they redraw.

## 2026-10-05 handoff #15: Google Calendar through Workspace accounts, phone declutter
- `calendar.readonly` is now in the base scopes, so existing accounts need Reconnect; `status.accounts[].cal` reports it. `google.calKick/calEvents/calSync/calFeeds` fetch per account per month (selected calendars, up to 15; `singleEvents`; 10-minute TTL). `calendar.ts` merges them into `feedStatus()` and `events()`, so the Calendar page, Upcoming, briefings and `/api/state` all include them. The Google feeds have id `g:<acct>` and the account's hex colour (CSS `.gcal.c-acct` with `--gc`); they're managed in Workspace, not removed in Settings. iCal feeds still work alongside.
- Phone: the top-left menu button is hidden (the tab bar's More is the only menu). On Command, the model/effort pickers fold behind one chip (`cmdTiersFold`), Upcoming and Inbox show 3 items, Needs-you groups show 2 plus "+N more", and Quick actions (`.nv-quick`) is hidden.
- Music seek: the HUD and popover progress bars (`.mus-seek`) take click or drag and send `spotify.control("seek", ms)`. Progress is interpolated between polls (`musicPos`).
- Long panels: `foldPanels()` in space.js adds "Show more ▾" to any `.card`/`.nv-panel` taller than ~55–62% of the screen. On desktop Command the limit is the space left above the bottom of the screen. Panels with form fields are skipped, as are Code, Canvas, Workspace and Tasks.
- Explain: `web/explain.js` with `/api/explain` (`src/lib/explain.ts`), a no-tools Haiku run that gets the project summary as context. Results are cached for 24 h by text hash, and concurrent identical asks share one run. The ✦ button appears on hover over item rows (selector `XP_SEL`); Alt+click and phone long-press work too.
- Music: when a player context is active, a single song is added to the queue and then skipped to (`/me/player/queue` + `next`), so the playlist carries on afterwards. "queue …" only adds it.
- Usage: `src/lib/usage.ts` logs every `runClaude` result to `data/usage.jsonl` through `onRunResult(r, o)`, recording source (from runId), model family, cost equivalent, output tokens and context. The file rotates at 3 MB. The last `rate_limit_event` goes to `data/usage-rate.json`. `/api/usage` returns today, 7 days, last 5 h, by source and by model. `web/usage.js` puts a strip on the Code page with a drop-down for the details, including each session's context fill.
- Brain sync: `src/lib/brainsync.ts` runs after each Code turn that changed files or reports something done. Turns are batched per session, at most one Haiku run per 3 minutes, with no tools and JSON-only output. LUTHUR then applies the result itself: a `log.md` entry (source "LUTHUR (from Code)"), nextStep, stage and health, goal steps done, milestones done, and a line under `## Notes` in plan.md. Only ids that were offered are accepted. Each run is logged as `brain-sync` in activity.
- Power: `lowPower()` (nova.js; auto on touch or phone; `hq-power` = full|saver) runs the scene at ~5 fps and 35% resolution, the orb at ~20 fps, and draws the stars once. hud.js `bgLoop` now stops when its canvas is hidden; it used to compute particles behind the NOVA scene. The choice is in the Background card (Motion).
- Default page is Command on every device.

## Handoff #16 (updates, speed, polish)
- **One-click updates**: `src/lib/updater.ts` + `web/update.js` (Settings → Updates). Checks newest commit of `update.repo`/`update.branch` (defaults in updater.ts), compare API for "what's new", downloads that exact commit's zipball, runs `scripts/UPDATE-HQ.ps1 -Zip -Sha -HqPid` via a short-lived launcher (so `taskkill /T` on HQ doesn't kill it). Script backs up, restores the backup on copy failure, always restarts (`start-hq.vbs --silent`), writes `data/version.json`, logs to `data/update.log`. Key: fine-grained, Contents read-only, saved in `config/hq.local.json` `update.token`, never returned to the browser. Windows only for apply.
- **Speed**: auto quality governor (`Perf` in nova.js) steps scene resolution/frame rate down when frames drop; nebula 20 fps at half res, planets 30 fps; orb canvas DPR capped at 2; stars 15 fps and skipped when hidden; Google Fonts non-blocking.
- **Load flash** fixed: page hidden behind a spinner until first render (`hq-ready`, 6 s fallback).
- **Orbit**: drag direction fixed (front projects follow the finger), `touch-action: pan-y`, pointercancel; phones show only the front project's name and keep labels on screen.
- Phones keep their own background choice (`hq-space2-phone`, nebula only). Shader scroll parallax direction fixed.
- Readability: brighter text tokens, solid-ish surfaces, Settings sections are proper rows. Side panels pop toward you on hover (not flattened).
- Work pages (`web/work.js`, `web/work.css`): project progress bar from goal steps, health labels, relative "updated", roadmap milestones on their own lane + TODAY marker, calendar weekend tint and "+" hover, nicer inbox zero.

## Handoff #17 (screen, history, chats, desktop app, update sequence)
- **Command Screen** (`web/screen.js`, `src/lib/screen.ts`, `src/lib/browser.ts`): "pull up …" / "brief me". Websites open in a real headless Chrome (own profile `data/screen-browser`, `--remote-debugging-pipe`, no port) streamed as MJPEG (`/api/browser/live`, same-site only) with click/scroll/type/paste forwarding; reader view fallback via `/api/screen/read` (public hosts only, private IPs refused after every redirect); web search via DuckDuckGo HTML; quest briefings `/api/screen/brief` (Haiku, no tools). Each MJPEG part is closed by the next boundary and sent twice on connect (Chrome only paints a part once the next starts).
- **History** (`src/lib/history.ts`, `web/history.js`): runs opt in with `history` in RunOptions; stored in `data/history.jsonl` + `brain/history/YYYY-MM.md` (gitignored); hq-brain `history_search`. **Chats tab** ported from `claude/fervent-feynman-g1q94a`: `src/lib/transcripts.ts` reads Claude Code session files for the HQ folder; `listChats/getChat/continueChat` in orchestrator (LUTHUR's own background sessions filtered out); copy `claude --resume <id>`.
- **Desktop app** (ported): `scripts/INSTALL-APP.cmd` / `UNINSTALL-APP.cmd` (LUTHUR.lnk with `web/luthur.ico`); `start-hq.vbs` skips a second server, waits for `/api/live`, opens a Chrome→Edge app window with its own profile. `ADD-DESKTOP-ICON.cmd` calls INSTALL-APP.
- **Update sequence** overlay: stages Download → Install → Restart → Online driven by real server state; red only for installer errors.
- Not ported from fervent-feynman (by design): JARVIS→Luthor rename, `luthor` brain project, its `web/icon.ico`.

## Handoff #18 (permissions, voice reading, smoother opening)
- **Voice = full permission**: the dashboard marks a message as voice when it follows a spoken transcript (`window.hqVoiceAt`, api() adds `voice:true` for /chat and /code/*). Chat runs at the autonomy ceiling, Code runs in `bypass`. Off switch: Settings → Autonomy (`assistant.voiceFull`). Typed stays as configured. HQ deny lists apply in every mode.
- **Task approval**: chat follow-ups (new Tasks) and follow-ups from scheduled missions become approvals ("Start task: …") unless `assistant.taskApproval` is off or the chat passed `owner_approved: true`. Sub-agents of an approved task run straight away. Approving a chat task enqueues it as a Task.
- **Voice can open and read things**: hq-brain `google_mail_search` / `google_drive_search` (metadata only) and `show_on_screen` (drop type `screen`, accepted only from chat runs → `data/screen-cmd.json` → `chat().screen`). The dashboard opens it on the Command screen and reads it aloud (speech) or summarises via the no-tools briefing model; the agent never sees email/file bodies. Voice "read it out" / "summarise this" / "pull up …" are handled locally (`scrVoice`).
- **Opening scan**: canvas at ≤1.25× DPR, no shadowBlur (stroked glow), iris pre-rendered once; WebGL scene, orb and stars wait until the scan ends (`window.hqBooting`).
- App window opens maximized (`--start-maximized`).

## 2026-10-06 handoff #19 (readability and longer voice turns)
- **Small HUD text** (`web/nova.css`, `web/live.css`, commit `457ae6a`): brighter secondary labels; Command inbox previews use 12 px medium-weight Inter with stronger contrast. Installed and checked in the live dashboard.
- **Voice pauses** (`web/app.js`, `web/live.js`, commit `f2b51ff`): tap-to-talk waits 3.2 seconds after the last recognised words before sending; if the browser ends recognition early, it restarts and keeps the transcript for the same turn. Tapping the mic again finishes immediately. Hands-free wake commands also wait 3.2 seconds and append later speech segments instead of sending on the first final result.
- **Verification**: both JavaScript files passed syntax checks; a simulated recogniser test covered an early cutoff, resumed speech and one final send. The live updater reports `f2b51ff3dba17232d4d652c96b7375fa5049b7b7` installed with no error. A real microphone check on the owner's browser and iPhone is still needed; browser speech services control their own recognition limits and may beep on restarts.

## 2026-10-06 handoff #20 (upgrade block 1)
- Installed modeless work windows, shared task editing, Dailies routines, goal workstreams/dependencies, exact plan resolution, selected Google-file editing, conversation follow-up queue, voice volume and desktop follow-up listening.
- Consolidated LUTHUR/Missions and Projects/Roadmap navigation, added repository scope picker and GitHub project links, War Room shortcut/mobile logo, panel borders and hideable HUD.
- Details and remaining device/provider checks: docs/UPGRADE-BLOCK-1.md. Obsidian and broader guarded computer control remain in docs/BACKLOG.md.
- Verified isolated API/browser fixtures, desktop/phone layouts, reopened completed steps, mocked Google saves and MCP selected-file capability boundaries. Test scripts and screenshots are in the parent workspace tests/ and artifacts/upgrade-block/; production brain/data/config were excluded from test copying.
- Existing signed-in Claude/Codex routing, task scheduler budgets and hard limits remain authoritative. No commits, publishing or external messages were performed.
- Install status: updated app files are copied and hash-verified in the local HQ installation. Automatic local-server restart was rejected as blocked by policy. The existing process remains running; backend activation requires an owner restart, followed by a browser refresh. Source backups are in the parent workspace artifacts/upgrade-block/installed-backup/ (code/docs only).

## 2026-10-06 handoff #21 (chat memory and visible assistant work)
- Added src/lib/chat-memory.ts: 30-day automatic idle cleanup (two attempts/day), no-tools signed-in CLI extraction into checked Markdown, safe failure retention, active/reopened protection, searchable memories and matching answer-history compaction.
- Matching old dashboard-owned Claude transcripts can retire; outside sessions and historical backups remain protected. History has Memory & cleanup controls. MCP chat_memory_search retrieves durable context.
- Operational assistant prompt now covers diagnosis, fix options, authorized verified fixes, review passes and reports. web/upgrade.js Work process popout shows real tool events, delegated tasks and latest report while keeping selected-item context. Voice/typed process and pronoun commands added.
- Isolated memory/provider-boundary/browser tests and prior desktop/mobile/task/Google mock checks passed. See docs/ASSISTANT-MEMORY.md. Installed code only; production chats were not cleaned. Local server restart remains pending after the prior policy rejection.

## 2026-10-06 handoff #22 (Command conversation/scroll fix)
- Removed automatic long-panel folding from cmdReply and nvScreen. Conversation now has one bounded scroll area with naturally wrapping turns instead of clipping each response.
- Fixed folded HUD panel fade placement: overrides the inherited gradient-border inset/mask so the shade sits at the bottom rather than drawing a black horizontal edge through text.
- Isolated browser regression passed at 1600px, 1000px and 390px: chat wheel scrolling, no folding overlay, stable screen height/content, no accidental popouts/navigation, no horizontal overflow. Fixture screenshots: parent artifacts/command-fix/. Frontend-only; refresh loads this fix without a server restart.

## 2026-10-06 handoff #23 (War Room header spacing)
- Replaced the large greeting/title area with a compact War Room title and smaller status chips. Reduced top padding and aligned music/live widgets with the side cards; focus/calendar widgets retain their 12px spacing beneath them.
- Installed upgrade.css with prior CSS saved at parent artifacts/command-fix/spacing-before.css. Checked wide desktop visually; desktop/tablet/phone scroll/layout checks passed. Refresh activates this frontend-only fix.

## 2026-10-06 handoff #24 (transparent holographic HUD/search)
- upgrade.css now gives the top HUD a transparent cyan/violet glass finish, light blur, fine corner marks and translucent controls. Search and message bars have angled-radius frames, luminous icons and keyboard focus treatment; search palette/results use matching holographic surfaces.
- Installed CSS; prior version saved at parent artifacts/command-fix/hud-before.css. Checked desktop visuals, opening/filtering/closing search, and 390px mobile layout without sideways overflow. No behavior or backend changes; refresh activates it.

## 2026-10-06 handoff #25 (HUD button order)
- Swapped the first two top HUD controls: Menu is first, then the War Room logo shortcut. DOM order matches visual/keyboard order. Frontend-only; refresh activates it.

## 2026-10-06 handoff #26 (useful HUD controls)
- Streamlined the top bar: navigation, eye shortcut, search, briefing, Voice menu and project focus. Voice menu contains conversation toggle/volume; redundant wake button and clock are hidden. War Room hides duplicate top message box, music preview and status pills because composer/music/status are already on the page. Other views retain message/status/music access.
- Slash shortcut focuses War Room composer when top message box is hidden. Mobile conversation button starts tap-to-talk. Installed JS/CSS; checked desktop visuals, composer focus, Voice controls and phone overflow. Refresh activates this change.
- Recent small changes also installed: Dailies renamed Daily throughout navigation; eye shortcut uses transparent eye.svg and no framed button.

## 2026-10-06 handoff #27 (Command screen-local opening)
- Choices inside the Screen launcher now display in that same panel. Project/goal/file/mail selections use the existing editors inline; Needs you, History and Outbox stay local. Back/Home use Screen history without changing the main Command route. War Room clicks outside Screen retain modeless windows.
- Selected inline content supplies chat/file context and live refresh; detached edit drafts are cached when navigating back. Slash and regular chat composer remain available.
- Isolated browser checks passed: inline project-plan save, approvals/history/outbox, Back/Home, selected project/file identity, mocked Sheet preview, no navigation/popouts and mobile layout. Frontend-only installed; refresh activates it.

## 2026-10-06 handoff #28 (continuous conversation and voice choices)
- Desktop Command microphone now toggles continuous conversation. Settings offers device/browser voices, previews, rate/pitch, configurable turn pause (default 1.8s), and optional Fast routing for casual speech. Mobile retains tap-to-talk per turn.
- Signed-in Claude/Codex chat output can provide redacted in-memory partial replies; Command polls every 500ms and shows them before completion. Final persistence and spoken summaries remain based on completed replies. Ordinary conversation prompt avoids unnecessary tools and preambles.
- Isolated parser, simulated microphone/voice selection, end-to-end partial-chat and full upgrade regressions passed. Actual provider startup/device microphone latency remains unmeasured. See docs/VOICE-CONVERSATION.md.
- Installed code/docs only with hash verification and backups. Refresh activates frontend; local-server restart is required for backend partial replies. Automatic restart was not retried after the prior policy rejection.

## 2026-10-06 handoff #29 (Claude conversation usage)
- Conversation now shows Claude context tokens used/capacity and percentage, last reported five-hour/weekly plan utilization and reset times beside model controls. Keeps last Claude context visible during Codex backup; Codex retains its status label without stats.
- Uses existing /chat claudeUsage and /usage signals. Missing or expired signals show unavailable; tooltips identify last reported timestamps. Polls every 30s idle/10s busy alongside the existing War Room usage display.
- Isolated browser checks passed for Codex backup with Claude numbers, missing/expired/rejected usage signals, no JavaScript errors and phone overflow. Frontend-only installed with code backup and hash verification; refresh activates it.

## 2026-10-06 handoff #30 (quiet holographic notifications)
- Moved HUD notification cards from upper right to lower left, above the activity tray when present. Translucent cyan glass, smaller typography and two-card stack reduce obstruction; hover/focus expands clipped text.
- Click, Enter or Space dismiss notices. Existing timed dismissal and warning colors remain. Phone sizing stays inside viewport; reduced-motion styling added.
- Isolated browser checks passed for desktop placement, two-card limit, keyboard/click dismissal, phone bounds and no JS errors. Frontend files installed and hash-verified with code-only backups; refresh activates them.

## 2026-10-06 handoff #31 (PC wake-only listener and quick acknowledgment)
- Opt-in Settings PC listener runs compiled Windows System.Speech helper while dashboard is minimized; idle wake grammar only, then Yes/capture one request. Attempts to restore existing LUTHUR window. No idle dictation is sent. Stop in Settings; server exit ends helper. Native listener and browser continuous mode are mutually exclusive.
- Local spoken acknowledgment responds before model work. Casual voice stays Fast; new Deep work toggle defaults on for voiced work requests with high effort. Typed tier unchanged. No extra speculative model call.
- Local /pc-voice bridge claims events once across windows. Helper build/grammar check passed without microphone; isolated native bridge and existing voice browser/parser checks passed. Owner microphone/background window checks remain; native listener waits through submitted chat and 8s playback grace before waking again.
- Installed code/docs/helper with code-only backup and hash verification. Restart local HQ server and refresh to activate PC switch; no automatic restart performed. No Windows execution policy was changed. Details: docs/VOICE-CONVERSATION.md.

## 2026-10-06 handoff #32 (quiet launch, one app window, endpoint readiness)
- Removed startup hum/rising scan tone and boot blips from both opening animation paths. Regular interaction sounds remain configured separately.
- Compiled app-window helper serializes launcher calls with a Windows mutex and restores the existing visible LUTHUR window. start-hq.vbs and LUTHUR.cmd route through it. Existing duplicate windows are not force-closed; browser tabs opened manually are outside launcher control.
- Settings PC listener switch now stays disabled until /pc-voice responds; older running servers show clear restart instructions instead of No such endpoint.
- Helper compiled and mutex check passed; isolated browser startup hum and endpoint-readiness checks passed. Actual launch/focus behavior requires owner check. Installed code/helper only with hash verification and backups. Server restart still requires owner action after previous policy rejection.

## 2026-10-06 handoff #33 (inline confirmations)
- Replaced native browser confirm prompts throughout dashboard with asynchronous uiConfirm messages beside the initiating action, using the existing holographic panel/button style. Delete and unsaved-edit prompts stay inside work windows; other confirmations attach to the containing form/card.
- Explicit Confirm/Cancel, Escape cancellation, safe cancel focus, trigger disabled while pending and automatic cancellation if its panel is removed. Existing confirmation gates remain in place for external saves/sends and autonomy settings.
- All modified scripts passed syntax checks. Isolated browser checks passed: cancel/Escape do not delete, confirm deletes once, dirty-window close requires confirmation, phone bounds, no native dialogs/JS errors. Frontend-only installed and hash-verified with code-only backups; refresh activates it.

## 2026-10-06 handoff #34 (startup chime and varied welcomes)
- New welcome.js plays a gentle three-note sine chime after opening animation, followed by one of six short welcome greetings without consecutive repetition. Uses selected voice/rate/pitch and volume, and respects global mute. No rising rev/hum returns.
- Voice Settings offers independent startup chime/spoken welcome switches and preview. Once per window session, no replay on ordinary refresh. Browser autoplay restrictions defer until first interaction. Does not interrupt an active spoken reply.
- Isolated mock-audio browser checks passed for chime, varied greeting, selected voice/volume, switches, refresh and no JS errors. Real device automatic playback remains browser-dependent. Frontend-only installed and hash-verified with code-only backups; refresh loads controls, reopening starts welcome.

## 2026-10-06 handoff #35 (automatic full screen)
- Desktop launcher now passes --start-fullscreen to Chrome/Edge. Reopening restores the existing LUTHUR window and requests F11 only if it is foreground and does not already match monitor bounds, avoiding accidental full-screen exit. Single-window mutex remains.
- Compiled launcher and mutex/monitor-bounds checks passed. No live window was manipulated during verification; actual Chrome/Edge full-screen behavior remains an owner opening check. F11 exits full screen. Installed launcher/source with code-only backups and hash verification; next desktop launch applies, no backend restart needed.

## 2026-10-06 handoff #36 (PIN access protection and scan/check audio)
- Added salted-scrypt PIN lock, authenticated HttpOnly/SameSite sessions, five-attempt/minute throttling and 12h expiry. Owner-requested PIN initialized by updated backend; no plaintext PIN stored in runtime data. All dashboard APIs/private backgrounds require unlock; existing OAuth callbacks retain state/PKCE validation.
- Holographic PIN screen on new window session; Settings Lock and Ctrl+Alt+L revoke sessions and stop PC listener. Browser speech/commands pause; existing authorized background missions continue. PC wake helper carries authenticated session and launcher treats locked 401 as already running.
- Subtle scan pings and real operation-progress/completion/error tones; separate sound toggle, speech suppression, volume/mute and no replay of prior history. No revving oscillator.
- Isolated API/browser checks passed for locked read/write rejection, wrong/right PIN, cookie flags, session revocation, phone bounds and sound controls. Authenticated wake helper compiled/grammar checked without microphone. Installed code/docs/helper with hash verification and code-only backup; backend restart REQUIRED to activate. Older server leaves screen locked with restart message. See docs/ACCESS-LOCK.md; disk files are not encrypted.

## 2026-10-06 handoff #37 (wake switch reconnect and restart shortcut)
- Verified live 8800 server still returns 404 for /api/access and /api/pc-voice; backend updates remain inactive. No automatic restart retried after policy block.
- Wake status now distinguishes missing endpoint, locked session and disconnected server. Successful background status poll re-enables the checkbox automatically, fixing a disabled switch remaining stuck after recovery.
- Added owner-run scripts/RESTART-LUTHUR.cmd combining existing STOP-HQ and start-hq.vbs. It was not executed by the agent.
- Isolated browser check passed for missing endpoint message and automatic switch recovery. Installed frontend/restart script with code-only backup/hash verification; owner must run restart to activate backend and PIN.

## 2026-10-06 handoff #38 (automatic four-digit PIN sign-in)
- PIN field submits automatically at four numeric digits; Enter/button remain alternatives. Duplicate submissions prevented and failed PIN clears/focuses field.
- Login waits for valid protection endpoint before accepting input. Missing old-server endpoint shows one-time restart guidance rather than raw No such endpoint. Periodic readiness check re-enables PIN automatically after restart without weakening server protection.
- Confirmed live server still reports 404 for /api/access. Isolated browser test passed for old-server disabled form, readiness recovery, wrong PIN rejection and automatic correct-PIN sign-in without clicking Unlock. Frontend installed/hash verified; owner-run server restart remains necessary.

## 2026-10-06 handoff #39 (wake to real conversation and selected voice)
- Fixed native wake listener using separate Windows Yes/One moment voice and dictation path. Helper now detects wake (optionally trailing request), emits a versioned wake event and exits; browser takes over continuous recognition, chosen-voice acknowledgment and normal agent chat.
- End conversation re-arms native wake listener; explicit PC switch off cancels re-arming. Protocol check explains restart if old backend lacks handoff. Native helper is silent.
- Compiled and validated both wake grammars without microphone. Isolated mocked browser check passed for chosen voice, ongoing mic, follow-up delivered to chat once and end/re-arm. Live old helper stopped using authenticated local API before code replacement; server not automatically restarted. Restart/refresh and owner mic check required. See docs/VOICE-CONVERSATION.md.

## 2026-10-06 handoff #40 (speech visibility and reliable turns)
- Command now shows Listening/Hearing, recognized words, sending/sent/queued status and recoverable microphone/send errors. Send now, Edit text, Retry unsent turn and Retry mic keep owner control close to the message box.
- SpeechRecognition snapshots replace interim words by result index, join final segments with spaces and preserve unfinished words across recognizer restarts. Wake names only match at the start of a sentence. Assistant speech pauses recognition without discarding a pending turn, then resumes with a fallback timer.
- Isolated mocked browser checks passed for transcript replacement, multi-result spacing, failed-send retention/retry, pending words across playback/restart, mobile bounds, mic error controls and existing wake-to-agent handoff. Real microphone accuracy remains browser/device-dependent.
- Frontend-only installation with code-only backups/hash verification; refresh activates this update. Earlier wake backend changes still require the previously described restart if not yet activated.

## 2026-10-06 handoff #41 (War Room model consoles and restricted routing)
- Twin holographic ChatGPT/Codex and Claude model consoles flank the core; engine switch above, shared manual controls on LUTHUR and Code. Device-local default is Codex/Auto/Low. Astra initializes Low on explicit selection, is authorized for one accepted/queued request, then returns to Auto; reload never restores authorization. This prioritizes explicit permission over the owner's conflicting default-Astra phrase; optional clarification was requested.
- Auto chat uses Luna/Haiku for ordinary replies, Sol 6.1/Sonnet for heavy work. Dedicated coding uses Sol 6.1/Sonnet unless manually overridden. Background deep tiers no longer select Astra or Opus. Voice Deep overrides are bypassed for explicit model-policy requests. Queued follow-ups retain chosen models.
- Backend validates model/provider/effort and Astra consent. Direct initial “use [model]” request can override for that turn. Provider switching preserves recent context with separate session types. Codex now receives explicit reasoning effort. Existing permission ceilings remain.
- Isolated fake CLI/API and browser checks passed for routing/consent, switching, coding, history continuation, voice/model/effort, queued selections, desktop/mobile bounds, speech feedback and wake handoff. No real model calls made. Installed with code-only backups/hash verification. LOCAL SERVER RESTART + refresh required; old backend is blocked from silently ignoring routing. See docs/MODEL-CONTROLS.md.

## 2026-10-06 handoff #42 (visible boot after PIN sign-in)
- Root cause: DOMContentLoaded ran and marked the startup scan while PIN protection hid all dashboard surfaces. The scan had finished before the owner unlocked.
- Startup now waits for protection to unlock and the dashboard to render, then runs the original eye/scan sequence and welcome. A visible-completion session marker replaces the previously consumed hidden-start marker; old windows receive the restored sequence once after refresh/sign-in. Ordinary refresh avoids replay; manual Replay boot remains available. Reduced-motion behavior is respected.
- Isolated browser checks passed for locked/no scan, legacy marker recovery, visible/non-inert eye animation after PIN, skip/completion, no repeat on refresh and full manual replay. PIN auto-sign-in regression passed. Frontend-only install with code-only backups/hash verification; refresh activates this fix, no server restart needed for boot.

## 2026-10-06 handoff #43 (clear voice state and matching core graphics)
- Replaced mic-button-based core status with shared recognition/playback state. Mic is only Listening after onstart, Hearing/Captured follow transcript events, and speaking takes priority over busy/conversation mode. Reconnect, pause, blocked mic, idle, sending and thinking states have plain captions.
- Core center has a mic/speaker/work icon, readable label and hint; green ready/cyan hearing/violet thinking/amber speaking colors and distinct calm pulse/wave/spin graphics retain the existing HUD. Input feedback matches the primary state and separates last-turn delivery. LUTHUR conversation gets a compact matching badge.
- Calm ready state no longer invents a synthetic voice waveform. Reduced-motion states redraw once and retain static labels/colors; no extra always-on recording path added. Stale button live classes no longer imply microphone readiness. Speech display updates avoid repeatedly scrambling or announcing unchanged state.
- Isolated speech/recognition mocks verified readiness, hearing/captured, thinking while mic remains on, speaking priority/classes/colors, resume, permission error, idle, LUTHUR badge and mobile bounds. Speech-feedback and boot-after-unlock regressions passed. Frontend-only installed with code-only backup/hash verification; refresh activates this update.

## 2026-10-06 handoff #44 (useful speech without filler acknowledgments)
- Removed automatic request-acceptance “One moment” / “I’ll look into that,” native-wake handoff “Yes? I’m listening,” and browser wake-only “Yes?”. Existing visual states confirm wake/listening/processing; useful result playback and chosen voice remain.
- Saved explicit owner preference to start spoken replies with useful answers/results rather than filler acknowledgments. Runtime preference context applies to new turns without backend changes.
- Isolated mocked wake/chat test verified silent wake and request acceptance, one follow-up chat submission, end/re-arm, silent browser wake and useful chosen-voice result playback. Frontend-only installed with code-only backups/hash verification; refresh activates.

## 2026-10-06 handoff #45 (speaker echo no longer becomes owner speech)
- Pause browser recognition before every speech playback path. Resume only after native playback/queue ends plus a one-second speaker cooldown; the recovery timer cannot reopen listening during a long reply. Guard stopped recognizer results/start/error/end callbacks by identity and retain pending owner words.
- Stop an active one-shot recognizer during playback; ignore its late results. Temporarily pause/re-arm an active PC wake helper and discard claimed native events timestamped during playback/cooldown, including late delivery. The shared voice UI shows Mic paused during cooldown and only returns to Listening after recognition starts.
- Isolated mocked speaker regression passed for early pause, long playback, cooldown, stale transcripts/callbacks, retained owner words, genuine follow-up and superseded playback. Voice-state, speech-feedback, native handoff and boot regressions passed (speech-feedback rerun alone after concurrent boot/auth interference). Actual room acoustics remain an owner check. Frontend-only installed with code-only backups/hash verification; refresh activates, no server restart needed for this fix.

## 2026-10-06 handoff #46 (Operations stays out of the way)
- Removed new-operation auto-expansion that overwrote the saved owner collapse choice. The down arrow now keeps the feed folded through new/replacement operations and refreshes until the owner uses the up arrow. Folded desktop feed is a compact translucent Operations tab, hiding details and stats instead of occupying the full screen width. Arrow labels/expanded state match visibility.
- Isolated browser checks passed for replacement operations, empty/new feed, saved collapse after refresh, explicit reopening, compact desktop dimensions and mobile bounds. Existing mobile feed hiding remains. Frontend installed with code-only backup/hash checks; refresh activates.

## 2026-10-06 handoff #47 (Sonnet/Sol default; explicit Astra and Opus permission)
- Owner correction supersedes cheap Luna/Haiku routing and earlier Astra default. Replies, coding, background work and auth checks use Sonnet/latest CLI alias or Sol 6.1 (newest available signed-in catalog Sol). Removed older/light choices from UI and backend allowlist.
- Astra and Opus both require per-request explicit approval, including server chat/code validation. Selecting alone does not approve; Allow once or an explicit leading use/you-can-use request grants one turn. Approval consumed before submission/at queueing, not restored by reload; queued requests preserve their approved selection. Auto never escalates to either. Low effort remains the default.
- Isolated fake-CLI API checks passed for defaults, both restricted models, negation, text permission and provider switches; coding and browser controls/one-turn/reload/queue/mobile regressions passed. Saved owner preference in both brains. Code-only install/hash checks done; backend restart via desktop Restart LUTHUR and refresh required. No paid model calls made.

## 2026-10-06 handoff #48 (clickable live Operations and multi-agent popouts)
- Operations cards open a large modeless operation inspector; Multi-agent loop opens a large live loop window instead of the previous task list. Mouse and Enter/Space activation supported. Existing popout move/resize/close controls retained; duplicate operation clicks focus the same window and separate windows remain usable without changing War Room route.
- Show published updates, full available action targets/results/diffs, model, worker, status, elapsed time and counts. Live feed refreshes existing windows every 1.5s and through Operations updates, preserving scroll position away from bottom. Last captured operation retained when removed from live feed; loop shows standby when empty. Window message footer gets activity context through scrMaterial. No new agents or paid calls added.
- Isolated browser checks passed for card and loop click/keyboard opening, live updates/completion, data escaping, duplicate focus, conversation context, close, standby and mobile bounds; Operations saved-collapse regression passed. Frontend installed with code-only backups/hash verification; refresh activates.

## 2026-10-06 handoff #49 (force stop button and named voice interruption)
- Persistent Stop now/Resume LUTHUR button sits above popouts and is hidden by PIN lock. Stop silences browser speech, aborts microphones, clears queued follow-ups and stops/re-arms no native listener. Server cancels tracked chat/code/background child processes and queued runs, disables goal workstreams, and persists a scheduling hold until explicit Resume; reminders remain enabled. New chat/code submissions blocked while held. Spawn callbacks honour cancellation even if PID arrives late; cancelled chat cannot fall back to another model. Stopped operations show cancelled/Stopped.
- During ordinary listening, exact stop requests act immediately without a model call. During playback, a separate stop-only browser recognizer accepts named LUTHUR/Luther stop/stop-now variants and discards ordinary speech; ignores stop phrases present in current synthesized text. Regular speech echo protection retained. Missed/denied/hidden-browser recognition remains possible; button is always the fallback. No promise to undo completed edits.
- Isolated fake-CLI tests killed only test chat/code children, cancelled a queued task, verified protected stop, blocked new work, busy cleanup and explicit resume. Browser mock tests passed for voice interruption, ordinary echo/quoted phrase rejection, button/resume, late speech suppression, cleared queue/mics and mobile bounds. Speaker echo, voice-state and speech-feedback regressions passed after resetting isolated stop state. Installed with code-only backups/hash checks; local backend restart + refresh required. No real agent/paid model calls made.

## 2026-10-07 handoff #50 (scrambling center labels and signal-driven orb)
- Owner clarified during implementation: keep the newer center icon/label/hint and useful state colors; scramble the words in the middle. Center words now scramble only on transitions; input panel and accessible label remain plain. Top duplicate status remains hidden. Reduced motion skips scramble.
- Replaced clock-driven synthetic speaking syllables and idle orb drift with native speech-boundary envelopes and measured microphone volume/frequency bars. Silence stops voice phase; no-boundary voices use steady glow. Recognized speech gives a small event cue only when no samples exist. Thinking motion remains explicitly a work indicator. Native TTS does not expose output PCM, so output is word timing rather than claimed measured loudness.
- Isolated browser checks passed for center statuses/icons/colors, one transition scramble, measured input response, silence, word pulse decay, no-boundary fallback, end/reduced motion. Voice-state, speaker echo and force-stop UI regressions passed. Confirmed owner visual preference saved in both brains. Frontend installed with code-only backups/hash checks; refresh activates, no server restart needed for this visual change.

## 2026-10-07 handoff #51 (Codex online badge beside Claude)
- Added Codex vital beside Claude in War Room. Status distinguishes online, checking, sign-in needed, unavailable CLI and unknown status, with matching green/amber/red dot. Online means local CLI sign-in ready, not a paid network health probe; tooltip states local sign-in status.
- Async bounded `codex login status` check caches for 60 seconds and returns only a normalized state through /state. No model requests, credential file reads or raw sign-in output exposed. The actual local probe returned online.
- Browser smoke check verified every badge state and mobile bounds; scripts passed syntax checks. Installed code-only backups/hash verification. Backend restart via Restart LUTHUR and refresh required to activate live Codex status.

## 2026-10-07 handoff #52 (persistent adaptive model selection)
- Owner supersedes one-request authorization and strong defaults: Auto ChatGPT uses Luna 6 for chat / Sol 6.1 for heavier work and coding; Claude uses Haiku / Sonnet. Selected Astra/Opus remains authorized until switched, including reload, while easy turns use lighter models. Leading explicit use instructions force one turn and save subsequent adaptive selection. Background fast work restored to light models, premium never auto-escalates.
- Removed Allow once and startup premium reset. Independent unique select labels, isolated menu events and selective value updates avoid cross-side interactions; browser verifies focus/selection isolation. Queued choices and manual effort preserved. Server policy version 3 prevents older backend silently ignoring routing.
- Isolated fake-CLI API, coding and mocked browser tests passed; checked desktop/mobile screenshots and syntax. No paid model calls. Code-only installed backups/hash checks; desktop Restart LUTHUR + refresh required.

## 2026-10-07 handoff #53 (desktop hologram wake companion)
- PC wake events open/restore a distinct compact Chrome/Edge companion via app-window helper; old pc-wake foreground-full-dashboard calls removed. Companion is translucent, topmost and single-instance by distinct title/mutex; full app remains separate and reusable. Native title bar supports dragging. Dismiss or Full app returns wake listening without cancelling tasks; Stop now retains cancellation.
- Reuses chosen voice, saved adaptive model controls, shared chat, protected cookie session, actual voice-status/orb, transcript/turn controls and latest published activity. Overlay initial load checks protection without relocking every window; unavailable/expired auth requires PIN. Main UI pauses ordinary recognition/playback and cannot claim overlay events. Event claim is authenticated; 30s heartbeat lease plus native-close release avoids permanent ownership after closing. Background listener still requires enabled settings/server/Windows speech + browser mic permission on first use.
- Isolated protected API/browser mocks passed handoff, playback ownership, states, live activity, dismiss/reload/relock and compact bounds; model-controls, voice-state, echo and legacy wake handoff regressions passed. Native C# helpers compiled; actual desktop translucent/topmost behavior and physical-mic wake need an interactive check after restart. No paid model calls or real desktop listener started. Installed code backups/hash verified; desktop Restart LUTHUR, refresh/unlock, enable PC wake listener.

## 2026-10-07 handoff #54 (separate accurate provider usage/context)
- Adds protected live Codex account/rateLimits/read via bounded local app-server, cached 60s: no inference, API keys or credential reads. Prefers multi-bucket limits, five-hour means exactly 300 minutes, percent units explicit, reset seconds converted. Actual read-only local probe passed.
- ChatGPT/Codex last-turn context from known-session token_count metadata, not accumulated turn input. Separate provider cards/conversation strips and four orb arcs; quota report age/reset/offline handling distinguishes stale/unavailable without guessing zero. Model-card clearance avoids overlap.
- Claude context uses last assistant model's window and input+cache usage; missing metadata clears old context. CLI rate snapshots keep timestamps/units and stop graphing after five minutes/reset; Code removes invented 200k capacity and old cross-provider session context.
- Isolated fake RPC, last-token fixture, fake Claude telemetry, browser accuracy/mobile/overlap and model-control/routing regression checks passed. Live quota probe was read-only, no paid generation. Installed backups/hash checks; owner Restart LUTHUR and refresh required. See docs/USAGE-ACCURACY.md for sources/limits.

## 2026-10-07 handoff #55 (wake conversation inactivity)
- Desktop conversations and browser wake turns return to wake-only after five seconds without owner speech. Playback plus echo cooldown, agent work, queued turns, ongoing speech and unsent/editable words defer the timeout. Recognition restarts do not reset it.
- Native PC handoff uses existing conversation exit/rearm; browser keeps wake recognition but clears unnamed-speech arming. Lock/Force Stop cannot rearm through this timer. Mobile tap-to-talk is unchanged.
- Deterministic inactivity tests and isolated browser playback/PC rearm, wake handoff and speaker-echo regressions passed. No paid calls or real microphone sessions. Installed frontend verified; refresh LUTHUR to activate.

## 2026-10-07 handoff #56 (compact War Room conversation)
- Conversation log and streaming reply limited to 26% viewport height / 240px maximum, retaining internal scrolling and header. Reduces previous 55% / 520px history area. Scroll stays inside the panel; standalone hologram reply unchanged.
- Browser layout checked at 1920x1080, 1024x768 and 390x844 with long history and scroll access. Installed frontend hash verified; refresh to activate.

## 2026-10-07 handoff #57 (usage-smart coding manager)
- Code entry now Talk to LUTHUR with project/repository chooser and reuse of existing workroom. Existing sessions use manager flow; published Markdown brief/status/plan/report/handoff available in chat.
- One model call for direct work; optionally max two sequential focused workers and one manager review, shared turn deadline, no retries or recursive fanout. CLI agent tools disabled; Code MCP followup queue hidden. Parent/worker activity uses existing operation view. Stop/failure halts chain.
- Fresh CLI context with bounded Markdown handoff; casual chat preserves substantive handoff. No resumed growing transcript or extra brain-sync model call. Provider/model permissions inherited; worker-generated premium instructions cannot authorize Astra/Opus. Auto casual Luna/Haiku, code/continuation Sol/Sonnet.
- Fake-provider integration, bounds/failure/cancel/premium and browser repo reuse/notes passed; model-policy/Code regressions passed. Installed code-only backups, syntax and hashes verified. Restart LUTHUR + refresh required. See docs/CODE-WORKROOM.md.

## 2026-10-07 handoff #58 (create project and chat purpose on canvas)
- Add to canvas now includes Reason / chat name and inline New project form with name, summary and optional repository folder. Registered-folder projects return to the menu selected for a named chat; folderless ideas add a project overview without leaving canvas. Existing project/chat paths retained. Start captures selection before closing modal. Partial creation retry reuses the created project.
- Isolated browser test passed project creation, folderless overview, folder registration/selection, named chat, correct project/card and retained canvas route. No model calls. Installed frontend verified; refresh to activate.

## 2026-10-07 handoff #59 (guided briefing and visible action targets)
- Late command routing restores actual Brief tour for typed/spoken briefing aliases before Screen quest/search or chat. General tours visit Daily, relevant War Room sections and individual next-move project pages; approval route repaired. Current project/document brief stays scoped. Bogus Search: me is cleared on overview. Known external/document material can still use Screen briefing.
- Tour waits for destination mount before highlighting. Next/back/pause/resume voice controls restored; lock/Force Stop ends tour. Opening work windows/screens adds a brief cyan highlight and scrolls into view. Named-project or existing-target action opens its work surface before chat, keeping correct target context; original action execution remains responsible for actual changes.
- Isolated browser checks passed aliases without search/quest/model requests, voice controls, Daily route/spotlight, scoped project, target before chat context and Stop. Frontend syntax/backups/hashes checked; refresh to activate.

## 2026-10-07 handoff #60 (independent War Room card hover)
- Removes side-column transforms and grouped hover/focus lift. Each side panel keeps its own holographic angle and only the hovered card straightens/lifts. Keyboard focus lifts an individual card when no card is hovered; pointer hover takes priority over a previously focused card. Parent columns remain stationary; touch/reduced motion do not use hover movement.
- Browser layout check with actual stylesheet cascade passed four independent cards, unchanged sibling matrices/bounds, focus priority, stationary columns and reduced motion. Installed CSS hash verified; refresh to activate.

## 2026-10-07 handoff #61 (movable music player)
- Adds labeled MUSIC drag handle, close button and keyboard arrow movement. Pointer capture moves the player within viewport bounds; saved device-local position restored on reopen. Once moved, outside clicks keep the floating player open; X/Escape close it. Resize clamps it into view, long contents scroll, playback/volume/seek controls do not initiate dragging.
- Isolated browser mocked-Spotify check passed drag, no control calls on movement, outside-use persistence, restored position, playback control and smaller viewport containment. No real music/account action. Installed frontend syntax/hash verified; refresh to activate.
