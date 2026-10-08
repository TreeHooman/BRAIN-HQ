# HQ / LUTHUR handoff

Short, current guide for a new session. The block at the bottom regenerates itself from `brain/projects/luthur/`
(every 30 s while HQ runs). Older build notes (#1-#62): `docs/HANDOFF-HISTORY.md`. Feature docs: `docs/*.md`.

## Recording your work (don't append handoff sections here)
- Add a dated entry to `brain/projects/luthur/log.md` (newest first) and update `nextStep` in its `project.json`.
- Things only the owner can verify (mic, devices, real accounts) go under `## Owner checks` in `brain/projects/luthur/plan.md`. Remove a line once it is confirmed and it disappears from the block below.
- Change this hand-written part only when the architecture or a rule changes.
- **Make it GitHub ready before any push or Update (owner rule).** The in-app updater copies the pushed commit over `src/`, `web/`, `config/`, `scripts/` and `docs/`, so uncommitted or unpushed edits there are lost (a backup goes to `backup/<time>/`). When you push, or the owner mentions Update: `git status --short` must be empty (commit leftovers from other sessions too, after reading their diff), push with `git push origin HEAD:claude/relaxed-turing-tnsbre`, check `HEAD` equals `origin/claude/relaxed-turing-tnsbre`, then tell the owner Update is safe.

## What it is
LUTHUR (folder/code name HQ) is the owner's local business brain and assistant. The dashboard runs at http://localhost:8800
(127.0.0.1 only, PIN-locked). It starts at sign-in via `scripts/start-hq.vbs` and opens as a desktop app window. Node 24 runs
the `.ts` files directly, with no npm dependencies.

## Architecture (where things are)
- `src/server.ts`: HTTP + JSON API + static `web/`. Non-GET needs header `X-HQ: 1`; `hostOk()` DNS-rebinding guard; PIN gate (`src/lib/access-lock.ts`, hash in `data/access-lock.json`, the first PIN entered on a fresh install becomes the PIN).
- `src/lib/orchestrator.ts`: 30 s tick (drop ingest, reminders, auto handoff, schedules, pause/resume, goal workstreams), parallel runs (1 background lane + `tasks.maxParallel` owner lanes), Tasks, dashboard chat (`sendChat`).
- `src/lib/claude.ts`: runs `claude -p` (stream-json). Run shapes:
  - normal: tools per permission level + hq-brain MCP only (`--strict-mcp-config`), `--setting-sources ""`, agent rules appended.
  - `bare` (and any `act` run that allows nothing): no tools, no MCP, `--system-prompt` only (~2k tokens). Use it for every text-only job.
  - `act`: Outbox sends through account connectors (loads every connector, which is huge; avoid).
- `src/lib/guard.ts`: code-enforced limits for every `build` run (Claude and Codex). Codex build runs work in the first safe project folder (never HQ, a folder around it, or LoanCentral-Test; else `data/codex-work`). HQ's `config/`, `src/` and `scripts/` are snapshotted before the run: `config/`+`scripts/` changes are put back, `src/` changes are reported (owner may be editing), and copies go to `data/guard/<run>/` + `log.jsonl`. HQ's own writes (`store.writeText`) update the snapshot. Unreadable `data/drop` files go to `drop/bad/` (newest 50); a run cut off by more than 2 restarts fails. Plan for more autonomy: `docs/AUTONOMY-DESIGN.md`.
- `src/lib/brain-audit.ts`: every agent brain write (hq-brain write tools via `callTool`, `brainsync`, approved brain changes) is recorded as file-level before/after versions (gzipped blobs by hash in `data/brain-audit/`, newest 1500 changes). Undo (`POST /api/brain-changes/:id/undo`) puts back files that still match. Background runs (not `chat-*`, `code-*` or interactive) send non-routine changes (new project; name/kind/paths/repos/maxPermission; stage to live/done/paused or backwards; rewriting over half of a SUMMARY/plan; removing goal steps) to the approvals queue as `brainOp`.
- `src/lib/autonomy.ts`: owner fast-approve rules in `config/autonomy-rules.json` (7-day trial, then live unless a matched task was rejected; build rules only for listed projects). Suggestions come from `data/autonomy/decisions.jsonl` (5+ approvals, 0 rejections in 30 days; never build). Undoing a brain change made by a rule-started task turns the rule off. Task budgets: `tasks.maxSubtasks` / `tasks.maxTaskMinutes`. UI: `web/autonomy.js` inside Missions & approvals.
- `src/lib/initiative.ts`: the initiative loop, code only. Every `everyHours` (default 4, 8:00-22:00) it reads each project's milestones (≤14 days), reminders (≤3 days), next open goal step and nextStep (skips "Owner: …", paused/done, busy projects) and picks ≤2 jobs (≤4/day), one per project. `orchestrator.initiativeScan()` routes each: a live rule starts it as a Task, otherwise a "Start task" approval (one alert per scan). Picks aren't repeated for 7 days (30 after a reject). HQ itself is plan-only; build only for listed build projects with folders. Settings sit in `config/autonomy-rules.json` (`initiative`), state in `data/initiative.json`; UI card on Missions & approvals; `GET /api/initiative`, `POST /api/initiative/settings|scan`.
- `src/lib/verify.ts`: verify-before-done. Build runs on a project with folders: folders snapshotted before/after (no git needed), project checks run when files changed (config `verify.checks[slug]`, else npm test / venv pytest), report compared with the real changes. Mismatch or failed check → `run.verify.ok=false` → task "issue" ("needs a look"); a "Checked by HQ" block is appended to the output. `taskStatus` uses only the latest verified run. A latest report saying "Result: Partly" makes the task "partly" (amber).
- `src/lib/debrief.ts`: evening debrief, code only. `orchestrator.debrief()` gathers today's reported tasks (done/partly/issue), background runs, pending approvals, brain changes, initiative picks, tomorrow's milestones/reminders and overdue count; `maybeDebrief()` (tick) writes `data/debriefs/<date>.md` once a day from config `debrief.hour` (21) and sends one alert only if something happened (`state.notified.debrief`). `GET /api/debrief` = `{latest, now}`; `S.debrief` feeds the "Evening debrief" card on Today ("So far today" previews). Tests: `docs/validation-2026-10-08/debrief-test.mjs` (5).
- `src/lib/watch.ts`: email/calendar watcher, code only. Each minute turns the mail glance cache (`mail.ts`) and calendar caches into Needs-you cards (`data/watch.json`, `S.watch`, rendered in `web/nova.js` + `hud.js`): important/action-looking unread mail, new/moved/cancelled events (7 days), clashes. New items alert the phone. Config `watch` in `hq.json`.
- `src/lib/memory-search.ts`: one ranked, code-only search over the whole brain plus `data/history.jsonl` (BM25, cached by file mtimes). hq-brain `memory_search`, `GET /api/memory/search`, History → Search all.
- `src/lib/codex.ts`: Codex CLI. Claude leads; Codex may take any run with the same permission (owner rule, 2026-10-07). `queue_followup` accepts `engine`. `src/lib/model-policy.ts`: Auto routing (Luna/Haiku for chat, Sol/Sonnet for work); Astra/Opus only when selected. On Windows, build runs add `-c windows.sandbox="unelevated"`: without it Codex 0.160 runs workspace-write as read-only (check `sandbox_policy` in `~/.codex/sessions/*.jsonl`).
- `src/lib/pc-control.ts`: chat-only PC control: `chrome_open` (owner's Chrome, open only), `app_open` (allowlist, `pc.apps` in config, `pc.enabled:false` turns all off), `browser_*` (drives LUTHUR's screen browser by element ref; passwords/payment refused, send/buy/post/delete clicks and non-search submits need `owner_confirmed`). MCP → server via `data/pc/req-*.json` / `res-*.json` (250 ms poll).
- `src/lib/desktop-control.ts` + `scripts/pc-desktop.exe` (.cs): owner-started desktop control (screenshots, click, type, keys) with an always-on-top Stop/Allow bar. See `docs/DESKTOP-CONTROL.md`.
- `src/lib/tts.ts` + `web/eleven-voice.js`: ElevenLabs voice. The page keeps calling `speechSynthesis`; the shim routes `speak()` to `/api/tts/speak` (MP3) and fakes `speaking`/`pending`/`cancel` and the utterance events, so voice modules need no changes. Key and voice live in `config/hq.local.json` (`elevenlabs`), never sent to the page; spoken text capped ~320 chars; on errors/no credits it falls back to the device voice (owner's pick, else best en-GB). Settings → Voice has the card.
- `src/mcp/hq-brain.ts`: zero-dep stdio MCP. Write tools hidden at `read`; `chatOnly` tools only for `chat-*` runs; `code-*` runs get the small `CODE_SET`.
- `src/lib/code.ts` + `code-manager.ts`: Code workrooms. LUTHUR manages, with at most 2 sequential workers + 1 review per turn and fresh context each turn. Notes are in `data/code/workrooms/<id>/`.
- Live code view: `web/live-builds.js` shows build-level mission/task ops (`/api/live`) as tiles at the top of the Code page, with a drawer streaming each step's diff. Codex diffs come from `narrate.WorkspaceWatch` (a build run's workspace is compared after every command or edit, so shell-made changes show too), falling back to `narrate.fileChangeDiff()` (git diff). Secret filtering judges only the file and its folder (`isSecretPath`), because every project sits under "Project Secrets".
- `src/lib/brain.ts`: all brain I/O; regenerates `brain/INDEX.md`. `src/lib/handoff.ts`: the auto block below.
- Frontend `web/`: `index.html` loads `app.js` (views/router) then layered modules (`hud.js`, `nova.js`, `live.js`, `upgrade.js`, voice modules…, `polish.js` last). Later files wrap earlier globals; keep that load order. `polish.js/.css`: phone War Room tabs, compact model row, Code "Talk to LUTHUR" box, clickable status tiles.

## Token rules (keep LUTHUR cheap)
- Text-only model jobs: `bare: true` with a short `system`. Never use `act` without connectors you need.
- Keep chat/mission system prompts stable; put per-turn facts in the prompt (a changing system prompt breaks the prompt cache).
- Chat rolls to a fresh session with a compact handoff past `chat.rolloverTokens` (default 60k context).
- New hq-brain tools cost tokens on every call: add them to `CODE_SET` only if coding runs need them.
- Measured (2026-10-07, Haiku "OK"): bare 2.0k, code 17.7k, chat/mission plan 17.2k tokens of context. Before the fix, text-only runs asked for ~542k and failed.

## Hard limits (also in config/agent-rules.md)
No push/deploy/publish by agents; never edit `LoanBot/LoanCentral-Test`; never read secrets (`.env`, `config/hq.local.json` tokens, credentials). Email and calendar go only through the Outbox, after the owner approves.

## Testing
Test orchestrator/engine changes on a COPY of HQ with `HQ_FAKE_CLAUDE=<fake cli .mjs>`, `HQ_FAKE_CODEX=<fake>` and `HQ_PORT`, never the live `data/`. Set BOTH fakes: with only the Claude fake, a Codex-selected test still calls the real Codex account. A fake CLI is in `docs/validation-2026-10-05/fake-cli.mjs`. Suites: `docs/validation-2026-10-05/run-tests.mjs` (15 checks, unlocks with a test PIN) `docs/validation-2026-10-07/phase0-test.mjs` (guard checks) `docs/validation-2026-10-07/autonomy-test.mjs` (13 autonomy checks; 2 currently fail on a copy with the live config, before and after verify) and `docs/validation-2026-10-08/verify-test.mjs` (10, needs `fake-verify-cli.mjs` copied in as `fake-cli.mjs`). Restarting the live server: the owner runs `scripts/RESTART-LUTHUR.cmd` (frontend-only changes just need a refresh).

## Updates
The owner's install updates from GitHub `TreeHooman/BRAIN-HQ`, branch `claude/relaxed-turing-tnsbre` (Settings → Updates, `src/lib/updater.ts`). Push only when the owner asks.
- The working folder IS the live install. Code changes go live with a restart (`scripts/RESTART-LUTHUR.cmd`); Update is only for pulling GitHub, and it overwrites unpushed `src/`/`web/`/`config/`/`scripts/` edits.
- Local branch `luthur-work` tracks that remote branch under a different name, so a plain `git push` refuses: use `git push origin HEAD:claude/relaxed-turing-tnsbre`.

<!-- AUTO:START (generated from brain/projects/luthur; edit those files, not this block) -->
## Current state (auto, 2026-10-08 04:50 UTC)
- Stage: building · health: good
- Next step: Evening debrief is built (src/lib/debrief.ts). Next: ask the owner which LUTHUR upgrade comes next; the Jarvis plan's remaining phase is self-improvement through tested proposals (docs/AUTONOMY-DESIGN.md).

### Waiting on the owner
- Voice stop: ask LUTHUR something long, then say "Luther stop" (or "stop listening"): he goes quiet, doesn't finish the answer out loud, and ignores normal talk until you say "Hey LUTHUR" again.
- Side panel: after a restart, click into another app (LUTHUR behind it or minimized) and say "Hey LUTHUR": the small side panel should pop up and answer.
- Voice: after a restart, say "Hey LUTHUR, what time is it". After he answers, talk normally: he should NOT respond. Say "Hey LUTHUR" again: he should. Say "Luther, stop listening": he goes back to wai…
- Evening debrief: after a restart, open Today and press "So far today" on the Evening debrief card. At 21:00 one 🌙 alert should arrive (only if LUTHUR did something today) and the card shows it.
- Tasks page: refresh (Ctrl+R); the cards and the agent lines no longer flicker. After a restart, a task whose report says "Partly done" shows an amber "partly done" label, not green "done".
- Daily schedule: refresh, then click the 18:00 Phase 0 reminder (edit window opens), press "Open ↗" (Schedule popout: add a reminder, ○ marks done), and click the red "overdue" pill at the top.
- Initiative picks: approve the 2 "Initiative ·" cards (LoanCentral Phase 0, Reddit recusal rule), read their reports; if useful press Go live now on the plan-level rule. Reject a weak pick later: it s…
- Restart LUTHUR so the initiative card shows the real next look (8:00 next morning after 22:00, not "Today 22:38").
- Decide the Discord interest-rate + ID/paystub policy by Oct 10 (loancentral-discord); ask LUTHUR or Claude to lay out options and log the decision.
- Chat: open LUTHUR → Conversation; it starts on the newest message and stays there after you send. The Claude and Codex usage lines above it don't overlap.
- ElevenLabs: Settings → Voice → paste the sk_ key, Save, Preview: LUTHUR speaks in the "LUTHUR" voice. With no credits it falls back to a British device voice.
- Voice noise: talk with fans/wind going; when you stop, LUTHUR shows "Say Hey LUTHUR" after ~5 s and ignores everything until you say the name.
- War Room conversation panel: opens on the newest message and stays there as replies arrive.
- Voice: while LUTHUR talks, say "stop": it should go quiet and Hey LUTHUR stays on in Settings. Then ask something and talk over the answer: it should stop and answer you. Check the War Room 5H ring s…
- Desktop control: say "Luther, take control", check the bar appears, then ask it to open Notepad and type a line (press Allow on the bar). Say "release control", then take control again: Notepad shoul…
- Wake word: with LUTHUR on screen, "Hey LUTHUR" listens in the app (no hologram); minimized, a small corner hologram opens (not full screen).
- PC control: say "Luther, pull up YouTube in Chrome", "open Spotify", then "find red running shoes on Amazon" (LUTHUR's browser on the War Room). It must ask before anything like Buy or Send.
- Voice: while LUTHUR is talking, say "Luther, open my calendar": it should stop and do the new request. Screens should open while it is still answering.
- Voice: LUTHUR starts speaking before the full answer is done, and waits when you trail off on "and…" or "um…".
- Say "Hey LUTHUR" with the app minimized: the hologram opens, listens and answers in your voice choice.
- Hologram stays on top and see-through; drag it by the title bar.
- First real Outbox email send from a Workspace account with writing allowed.
- Phone: open the dashboard and check the new mobile layout.

### Latest work (newest first, last 8; full log: brain/projects/luthur/log.md)
- **2026-10-08 04:55 · claude**: Owner: "better but still not great". Chat history 04:33-04:38 UTC shows unnamed room speech still answered and stop phrases sent to the model (it replied "Quiet." out loud), but the restart had not happened (scripts/pc-wake.exe.next still waiting), so the voice fixes were likely not loaded yet. Widened local stop hand…
- **2026-10-08 03:42 · claude**: Stop means stop (owner ask): "Luther stop", "stop", "shut up", "stop listening", "go to sleep", "that's all", "never mind", "goodbye" now all go quiet at once, mute the answer still on its way (and any other speech), close the conversation and listen only for "Hey LUTHUR"; the next accepted request lifts the mute (web…
- **2026-10-08 03:38 · claude**: Side panel fix (owner: "doesn't pop up when I don't have LUTHUR open"). The main window told the server it was on screen whenever document.visibilityState was "visible", which stays true when the window is just behind other windows, so the wake word went to the hidden main window and the hologram never opened. It now …
- **2026-10-08 03:33 · claude**: Voice fixes (owner: "listens when I'm not talking to him", "5 s of silence"). Chat history showed room noise sent as turns ("a", "s", "has", "UNITA a bad") and "Luther stop listening" sent as a question. (1) Name required: after a request is answered LUTHUR goes straight back to "Hey LUTHUR" (0.7 s, was a 5 s open fol…
- **2026-10-08 03:21 · claude**: Built the evening debrief (owner chose 21:00). New src/lib/debrief.ts words it; orchestrator.debrief() gathers today's reported tasks (done / partly / needs a look), background runs and failures, approvals waiting, brain changes, initiative picks, tomorrow's milestones and reminders, overdue count. No model call. Writ…
- **2026-10-08 03:14 · claude**: Owner approved both initiative picks; both reports were useful (Reddit recusal rule drafted into the brain, nothing posted; LoanCentral Phase 0 consolidated into an 8-item owner checklist, honestly "Partly done"). Fixes: (1) Tasks page flicker: lists compared with box.innerHTML, which the browser re-serializes, so eve…
- **2026-10-08 03:09 · claude**: Owner check passed: after the restart, a build task on GenBot ("Add a line saying verify test to LUTHUR-TEST.md") ended with "Checked by HQ: ✓ matches the report · 1 file changed", Changed: GenBot/LUTHUR-TEST.md, no project checks found. Verify-before-done works live.
- **2026-10-08 03:00 · claude**: Committed + pushed the initiative work (323b98f). Built verify-before-done: new src/lib/verify.ts. A build run on a project with folders is snapshotted before/after (skips node_modules, venv, __pycache__, logs, dbs); when files changed HQ runs the project's checks (config verify.checks per project, else npm test / pyt…
<!-- AUTO:END -->
- Model console default engine is now Claude: `modelEngine()` falls back to Claude, and a one-time `hq-engine-claude-default` flag resets the old stored Codex default once; later manual picks persist. Refresh to activate.
