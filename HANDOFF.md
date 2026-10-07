# HQ / LUTHUR handoff

Short, current guide for a new session. The block at the bottom regenerates itself from `brain/projects/luthur/`
(every 30 s while HQ runs). Older build notes (#1-#62): `docs/HANDOFF-HISTORY.md`. Feature docs: `docs/*.md`.

## Recording your work (don't append handoff sections here)
- Add a dated entry to `brain/projects/luthur/log.md` (newest first) and update `nextStep` in its `project.json`.
- Things only the owner can verify (mic, devices, real accounts) go under `## Owner checks` in `brain/projects/luthur/plan.md`. Remove a line once it is confirmed and it disappears from the block below.
- Change this hand-written part only when the architecture or a rule changes.
- **Commit before the owner presses Update.** The in-app updater copies the pushed commit over `src/`, `web/`, `config/`, `scripts/` and `docs/`, so uncommitted edits there are lost (a backup goes to `backup/<time>/`).

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
- `src/lib/codex.ts`: Codex CLI. Claude leads; Codex may take any run with the same permission (owner rule, 2026-10-07). `queue_followup` accepts `engine`. `src/lib/model-policy.ts`: Auto routing (Luna/Haiku for chat, Sol/Sonnet for work); Astra/Opus only when selected.
- `src/lib/pc-control.ts`: chat-only PC control: `chrome_open` (owner's Chrome, open only), `app_open` (allowlist, `pc.apps` in config, `pc.enabled:false` turns all off), `browser_*` (drives LUTHUR's screen browser by element ref; passwords/payment refused, send/buy/post/delete clicks and non-search submits need `owner_confirmed`). MCP → server via `data/pc/req-*.json` / `res-*.json` (250 ms poll).
- `src/lib/desktop-control.ts` + `scripts/pc-desktop.exe` (.cs): owner-started desktop control (screenshots, click, type, keys) with an always-on-top Stop/Allow bar. See `docs/DESKTOP-CONTROL.md`.
- `src/mcp/hq-brain.ts`: zero-dep stdio MCP. Write tools hidden at `read`; `chatOnly` tools only for `chat-*` runs; `code-*` runs get the small `CODE_SET`.
- `src/lib/code.ts` + `code-manager.ts`: Code workrooms. LUTHUR manages, with at most 2 sequential workers + 1 review per turn and fresh context each turn. Notes are in `data/code/workrooms/<id>/`.
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
Test orchestrator/engine changes on a COPY of HQ with `HQ_FAKE_CLAUDE=<fake cli .mjs>`, `HQ_FAKE_CODEX=<fake>` and `HQ_PORT`, never the live `data/`. Set BOTH fakes: with only the Claude fake, a Codex-selected test still calls the real Codex account. A fake CLI is in `docs/validation-2026-10-05/fake-cli.mjs`. Restarting the live server: the owner runs `scripts/RESTART-LUTHUR.cmd` (frontend-only changes just need a refresh).

## Updates
The owner's install updates from GitHub `TreeHooman/BRAIN-HQ`, branch `claude/relaxed-turing-tnsbre` (Settings → Updates, `src/lib/updater.ts`). Push only when the owner asks.

<!-- AUTO:START (generated from brain/projects/luthur; edit those files, not this block) -->
## Current state (auto, 2026-10-07 10:19 UTC)
- Stage: building · health: good
- Next step: Update + Restart LUTHUR. Try "Luther, take control", then ask it to open Notepad and type a line (Allow on the bar). Also chrome_open/app_open and LUTHUR browser checks. Report anything off.

### Waiting on the owner
- Desktop control: say "Luther, take control", check the bar appears, then ask it to open Notepad and type a line (press Allow on the bar). Say "release control", then take control again: Notepad shoul…
- Wake word: with LUTHUR on screen, "Hey LUTHUR" listens in the app (no hologram); minimized, a small corner hologram opens (not full screen).
- PC control: say "Luther, pull up YouTube in Chrome", "open Spotify", then "find red running shoes on Amazon" (LUTHUR's browser on the War Room). It must ask before anything like Buy or Send.
- Voice: while LUTHUR is talking, say "Luther, open my calendar": it should stop and do the new request. Screens should open while it is still answering.
- Voice: LUTHUR starts speaking before the full answer is done, and waits when you trail off on "and…" or "um…".
- Restart LUTHUR (scripts/RESTART-LUTHUR.cmd) and refresh so the 2026-10-07 token fixes and auto handoff go live.
- Say "Hey LUTHUR" with the app minimized: the hologram opens, listens and answers in your voice choice.
- Hologram stays on top and see-through; drag it by the title bar.
- First real Outbox email send from a Workspace account with writing allowed.
- Phone: open the dashboard and check the new mobile layout.

### Latest work (newest first, last 8; full log: brain/projects/luthur/log.md)
- **2026-10-07 03:35 · claude**: Desktop control loosened (owner ask): app Allows are now remembered across sessions in data/pc/desktop-allowed.json (blocked apps filtered out on load); saying or typing "forget allowed apps" clears them (POST /api/desktop {forget:true}). Terminals are no longer view-only: once Allowed, LUTHUR can type and press keys …
- **2026-10-07 03:15 · claude**: Desktop control (like Claude computer use). Owner says "Luther, take control" (dashboard-handled; the AI can't start it); scripts/pc-desktop.exe shows a top bar with Stop and per-app Allow/Deny; desktop_screenshot/click/type/key/scroll tools return screenshots. Refuses password fields, card-like numbers, LUTHUR's own …
- **2026-10-07 03:20 · claude**: Wake word + hologram: "Hey LUTHUR" now goes to the main window when it is on screen (the page reports visibility to /desktop-overlay main-visible; pc-voice routes the event to target main) and only opens the hologram otherwise. Hologram is a 330x440 corner mini (small orb, one-line activity, chat box, reply); app-wind…
- **2026-10-07 03:06 · claude**: PC control (owner asked for computer control; guardrailed instead of full control). chrome_open opens pages/searches in the owner's Chrome; app_open opens allowlisted apps (chrome, spotify, discord, vs code, file explorer, notepad, calculator, steam; pc.apps adds); browser_open/read/click/type/scroll/back drive LUTHUR…
- **2026-10-07 02:52 · claude**: Interrupt by name: while LUTHUR speaks, "Luther, <request>" cancels playback and sends the new request (stop phrases, single words, interim results and LUTHUR's own words ignored). Screen-first: chat() ingests screen drops each second while busy and the poll applies this turn's screen during the reply; read-aloud wait…
- **2026-10-07 02:46 · claude**: Faster voice turns. Early speech (web/voice-stream.js): the <spoken> sentence is spoken as soon as it appears in the 500ms partial poll, while the rest generates; the final reply is not repeated. Mid-thought pauses: turnPauseFor() waits longer (2x, +2s min, 6s max) when speech ends on a comma or words like and/so/um/b…
- **2026-10-07 02:42 · claude**: Self-learning preferences (owner ask: learn constantly, improve on its own, anticipate). preference_suggest now saves inferred preferences active at once (id p-l-, shown "(learned)" in Settings), dedupes, accepts replaces=<id>, and when memory is full drops the oldest learned items, never explicit ones. Context budget…
- **2026-10-07 03:05 · claude**: Token + speed pass: text-only runs (Explain, briefings, brain-sync, Write with LUTHUR, memory cleanup, sign-in check) now run bare: no tools/MCP, own system prompt. They had been loading every account connector (~542k tokens) and failing; now ~2k. Settings sources off (drops duplicate CLAUDE.md/agent rules, ~1.5k/call…
<!-- AUTO:END -->
- Model console default engine is now Claude: `modelEngine()` falls back to Claude, and a one-time `hq-engine-claude-default` flag resets the old stored Codex default once; later manual picks persist. Refresh to activate.
