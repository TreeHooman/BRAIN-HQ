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
## Current state (auto, 2026-10-07 09:41 UTC)
- Stage: building · health: good
- Next step: Owner: Settings → Updates → install, then Restart LUTHUR. Check the phone War Room and Code's Talk to LUTHUR box.

### Waiting on the owner
- Restart LUTHUR (scripts/RESTART-LUTHUR.cmd) and refresh so the 2026-10-07 token fixes and auto handoff go live.
- Say "Hey LUTHUR" with the app minimized: the hologram opens, listens and answers in your voice choice.
- Hologram stays on top and see-through; drag it by the title bar.
- First real Outbox email send from a Workspace account with writing allowed.
- Phone: open the dashboard and check the new mobile layout.

### Latest work (newest first, last 8; full log: brain/projects/luthur/log.md)
- **2026-10-07 03:05 · claude**: Token + speed pass: text-only runs (Explain, briefings, brain-sync, Write with LUTHUR, memory cleanup, sign-in check) now run bare: no tools/MCP, own system prompt. They had been loading every account connector (~542k tokens) and failing; now ~2k. Settings sources off (drops duplicate CLAUDE.md/agent rules, ~1.5k/call…
- **2026-10-07 02:36 · claude**: Codex equal-permission backup (owner rule): Claude leads, Codex may take any run with the same permission. Removed the Codex plan cap in chat and the build-mission Claude-only gate; queue_followup gains optional engine claude|codex, carried through approvals and enqueue. Runs with extraAllow or a Claude session stay o…
- **2026-10-07 02:05 · claude**: Made music player movable with MUSIC drag header, X close, keyboard arrows, stored position and viewport bounds. Detached player stays open across outside clicks, with playback/volume/seek kept separate from dragging. Mocked browser verified movement, no music action from dragging, restored position, control click and…
- **2026-10-07 02:00 · claude**: Detached War Room hover movement from side columns. Each card keeps its holographic angle and only hovered card lifts/straightens. Keyboard focus works independently when nothing is hovered; hover takes priority over an old focused card. Browser measured sibling transforms/bounds unchanged, columns stationary and redu…
- **2026-10-07 01:56 · claude**: Restored typed/voice briefing to guided Brief tour ahead of conflicting Screen quest/search routing; general briefing uses local state, zero model calls. Added Daily and separate project next moves, correct approvals route, navigation readiness, voice tour controls, lock/Stop guards. Work windows/screens briefly highl…
- **2026-10-07 01:49 · claude**: Added project creation directly in Add to canvas, optional repository folder and chat reason/name. New folder-backed project returns selected; idea-only project gets an overview card. Stays on canvas; avoids duplicate creation on partial retry. Isolated browser flow and syntax passed, no model calls; installed fronten…
- **2026-10-07 01:46 · claude**: Added LUTHUR coding manager: repository workroom reuse, Markdown brief/status/plan/report/durable handoff, fresh bounded CLI context. One direct call or up to two sequential workers plus final review, shared time limit, no recursive/native fanout or auto retries, failure/stop halts chain. Worker model/permission ceili…
- **2026-10-07 01:29 · claude**: Shrank War Room conversation history and streaming reply to 26% viewport height, capped at 240px, with internal scrolling and header retained. Checked long history at desktop, laptop and mobile dimensions. Installed frontend verified; refresh to activate.
<!-- AUTO:END -->
- Model console default engine is now Claude: `modelEngine()` falls back to Claude, and a one-time `hq-engine-claude-default` flag resets the old stored Codex default once; later manual picks persist. Refresh to activate.
