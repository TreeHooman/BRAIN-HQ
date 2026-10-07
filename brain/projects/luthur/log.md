# Log

## 2026-10-07 03:50 · claude
Voice + usage fixes (owner reports). "Stop"/"shut up"/"LUTHUR stop" now only hush speech; force stop is "force stop"/"stop everything"/the button, and no stop turns off the Hey LUTHUR wake word any more (it was being disabled). Talking over LUTHUR silences it at once and sends what the owner said when the sentence ends, with a note so it answers first and may finish its thought (echo of its own words ignored). Stop button and notifications moved to the bottom right. Claude 5-hour/weekly usage was never filled in (run events carry no percentage until near the limit): server now reads the CLI's /usage every 4 min (local command, no tokens) into data/usage-rates.json; scratch test read 83% / 11%. Phrase/echo logic unit-checked; live mic untested.

## 2026-10-07 03:35 · claude
Desktop control loosened (owner ask): app Allows are now remembered across sessions in data/pc/desktop-allowed.json (blocked apps filtered out on load); saying or typing "forget allowed apps" clears them (POST /api/desktop {forget:true}). Terminals are no longer view-only: once Allowed, LUTHUR can type and press keys in cmd/PowerShell/Windows Terminal. Deny still lasts one session; owner-only start, password/card refusal and own-dashboard block unchanged. Persistence/forget tested on a scratch copy. Update + Restart LUTHUR.

## 2026-10-07 03:15 · claude
Desktop control (like Claude computer use). Owner says "Luther, take control" (dashboard-handled; the AI can't start it); scripts/pc-desktop.exe shows a top bar with Stop and per-app Allow/Deny; desktop_screenshot/click/type/key/scroll tools return screenshots. Refuses password fields, card-like numbers, LUTHUR's own dashboard/bar, password managers and system tools; terminals view-only. Owner chose full control of their Chrome and 10 min idle / 60 min max. Live test (scratch copy): off-before-start, screenshot, own-bar refusal, end. Real clicks/typing not exercised. Update + Restart LUTHUR.

## 2026-10-07 03:20 · claude
Wake word + hologram: "Hey LUTHUR" now goes to the main window when it is on screen (the page reports visibility to /desktop-overlay main-visible; pc-voice routes the event to target main) and only opens the hologram otherwise. Hologram is a 330x440 corner mini (small orb, one-line activity, chat box, reply); app-window.exe leaves inherited full screen first. Orb wake label reads SAY "HEY LUTHUR". Layout checked on a test copy; routing unit-checked; real mic untested.

## 2026-10-07 03:06 · claude
PC control (owner asked for computer control; guardrailed instead of full control). chrome_open opens pages/searches in the owner's Chrome; app_open opens allowlisted apps (chrome, spotify, discord, vs code, file explorer, notepad, calculator, steam; pc.apps adds); browser_open/read/click/type/scroll/back drive LUTHUR's own browser shown live on the War Room. Refuses passwords/payment/ID numbers; send/post/buy/delete/accept clicks and non-search submits need the owner's yes in chat. Chat only (missions don't see the tools). Scratch-copy test with a real headless page passed all guards; real Chrome/app launch not exercised. Restart LUTHUR to activate.

## 2026-10-07 02:52 · claude
Interrupt by name: while LUTHUR speaks, "Luther, <request>" cancels playback and sends the new request (stop phrases, single words, interim results and LUTHUR's own words ignored). Screen-first: chat() ingests screen drops each second while busy and the poll applies this turn's screen during the reply; read-aloud waits for the end. Simulated tests passed. Restart LUTHUR + refresh.

## 2026-10-07 02:46 · claude
Faster voice turns. Early speech (web/voice-stream.js): the <spoken> sentence is spoken as soon as it appears in the 500ms partial poll, while the rest generates; the final reply is not repeated. Mid-thought pauses: turnPauseFor() waits longer (2x, +2s min, 6s max) when speech ends on a comma or words like and/so/um/because. Simulated tests passed (single early utterance, no duplicate, fallback without tag, pause cases). Refresh to activate; real mic check is the owner's.

## 2026-10-07 02:42 · claude
Self-learning preferences (owner ask: learn constantly, improve on its own, anticipate). preference_suggest now saves inferred preferences active at once (id p-l-, shown "(learned)" in Settings), dedupes, accepts replaces=<id>, and when memory is full drops the oldest learned items, never explicit ones. Context budget 1800→3200 chars (14 preferences were over budget, so the newest was silently cut); explicit first, learned newest first. Chat prompt: learn inside the normal turn, say it in one line, anticipate obvious next steps. agent-rules updated; owner's "confirm before saving inferred" preference rewritten to match. Model console default engine is now Claude (one-time reset of the stored Codex default). Scratch-copy test passed; Restart LUTHUR + refresh.

## 2026-10-07 03:05 · claude
Token + speed pass: text-only runs (Explain, briefings, brain-sync, Write with LUTHUR, memory cleanup, sign-in check) now run bare: no tools/MCP, own system prompt. They had been loading every account connector (~542k tokens) and failing; now ~2k. Settings sources off (drops duplicate CLAUDE.md/agent rules, ~1.5k/call). Code runs get 16 brain tools instead of 39. Chat system prompt is stable (per-turn facts moved into the message, so the prompt cache holds) and chats roll over to a fresh session with a compact handoff past 60k context. Auto HANDOFF.md block (src/lib/handoff.ts) replaces hand-written handoff notes; old notes in docs/HANDOFF-HISTORY.md. PIN hash removed from source (first PIN on a fresh install sets it). UI (web/polish.js/.css): phone War Room = orb, message box, Today/Upcoming/Needs you only; model controls fold to one row (phone: one chip); orb hint line removed; LUTHUR page conversation much taller; Code page "Talk to LUTHUR" box + clickable orchestrator node; Missions tiles and War Room vitals open their details. Verified on an isolated copy with fake Claude/Codex CLIs and real Haiku token measurements.

## 2026-10-07 02:36 · claude
Codex equal-permission backup (owner rule): Claude leads, Codex may take any run with the same permission. Removed the Codex plan cap in chat and the build-mission Claude-only gate; queue_followup gains optional engine claude|codex, carried through approvals and enqueue. Runs with extraAllow or a Claude session stay on Claude. Restart LUTHUR to activate.

## 2026-10-07 02:05 · claude
Made music player movable with MUSIC drag header, X close, keyboard arrows, stored position and viewport bounds. Detached player stays open across outside clicks, with playback/volume/seek kept separate from dragging. Mocked browser verified movement, no music action from dragging, restored position, control click and resized containment. Installed syntax/hash verified; refresh to activate.

## 2026-10-07 02:00 · claude
Detached War Room hover movement from side columns. Each card keeps its holographic angle and only hovered card lifts/straightens. Keyboard focus works independently when nothing is hovered; hover takes priority over an old focused card. Browser measured sibling transforms/bounds unchanged, columns stationary and reduced-motion static. Installed CSS hash verified; refresh to activate.

## 2026-10-07 01:56 · claude
Restored typed/voice briefing to guided Brief tour ahead of conflicting Screen quest/search routing; general briefing uses local state, zero model calls. Added Daily and separate project next moves, correct approvals route, navigation readiness, voice tour controls, lock/Stop guards. Work windows/screens briefly highlight; named project/existing action targets open before chat context. Browser tests passed no accidental search or quest/model requests, route/spotlight and target before action; installed frontend verified. Refresh to activate.

## 2026-10-07 01:49 · claude
Added project creation directly in Add to canvas, optional repository folder and chat reason/name. New folder-backed project returns selected; idea-only project gets an overview card. Stays on canvas; avoids duplicate creation on partial retry. Isolated browser flow and syntax passed, no model calls; installed frontend verified. Refresh to activate.

## 2026-10-07 01:46 · claude
Added LUTHUR coding manager: repository workroom reuse, Markdown brief/status/plan/report/durable handoff, fresh bounded CLI context. One direct call or up to two sequential workers plus final review, shared time limit, no recursive/native fanout or auto retries, failure/stop halts chain. Worker model/permission ceiling inherited; no premium authorization from generated text. Removed automatic Code brain-sync model and transcript resuming. Tested fake Claude/Codex chains, cancellation/failure/premium bounds, browser entry/reuse/notes and model routing. Installed/hash verified; Restart LUTHUR + refresh.

## 2026-10-07 01:29 · claude
Shrank War Room conversation history and streaming reply to 26% viewport height, capped at 240px, with internal scrolling and header retained. Checked long history at desktop, laptop and mobile dimensions. Installed frontend verified; refresh to activate.

## 2026-10-07 01:28 · claude
Added five-second follow-up inactivity timeout after speaking/echo cooldown. Defers while owner speaks, agent works, queued turns or unsent/editable text exists; recognition restarts do not extend it. Native PC wake rearmed through existing handoff; browser returns to named wake only. Lock and Stop respected. Unit/browser and wake/echo regressions passed; installed frontend hash verified. Refresh to activate.

## 2026-10-07 01:21 · claude
Added separate ChatGPT/Codex context and live account five-hour usage/reset read through subscribed CLI app-server with 60s cache and no generation. Claude snapshots now show stale/expired/unknown states and matching last-model context; Code removes invented window/cross-provider stale values. Four orb arcs and per-provider cards/Conversation displays tested for percentages, expiry, missing telemetry, desktop/mobile and overlaps. Fake RPC and CLI tests passed; real read-only quota probe succeeded. Installed/hash-verified; Restart LUTHUR and refresh required.

## 2026-10-07 01:10 · claude
Added compact desktop hologram: native translucent topmost companion, PC wake handoff without opening full dashboard, exclusive voice ownership, same orb/voice/models/chat, transcript and live activity. Protected shared unlock, dismiss/rearm, Full app and Stop preserved. Isolated browser and regressions passed; native helpers compiled. Actual microphone and desktop transparency/topmost need owner check after Restart LUTHUR and refresh.

## 2026-10-07 01:04 · assistant
Owner reiterated voice sleep and 'hey Luther' wake-up request. Submitted build approval with instruction to reuse the prior voice task, verify wake audio processing, suppress playback echo and preserve mute. No code or live behavior changed.

## 2026-10-07 00:59 · claude
Installed adaptive model routing: Auto Luna 6 / Sol 6.1 and Haiku / Sonnet; selected Astra/Opus permission persists until changed and easy turns use lighter models. Removed one-request controls and isolated model menus. Fake CLI API, Code and browser checks passed. Restart LUTHUR and refresh required.

## 2026-10-07 00:59 · claude
Installed adaptive model routing: Auto Luna 6 / Sol 6.1 and Haiku / Sonnet; selected Astra/Opus permission persists until changed and easy turns use lighter models. Removed one-request controls and isolated model menus. Fake CLI API, Code and browser checks passed. Restart LUTHUR and refresh required.

## 2026-10-07 00:54 · mission runmuxta77dpgob
War Room "code" screen: investigated, NOT implemented. Edit tool was denied on the HQ folder (mission had no folders granted). Design: (1) src/lib/orchestrator.ts:305 and src/mcp/hq-brain.ts show_on_screen enum: add kind "code"; (2) web/screen.js: new view {k:"code", id?}; scrGo loads /api/code (pick busy session else most recent) then polls /api/code/:id + /api/live every ~1.2s while Scr.cur.k==="code"; scrBody renders codeMsgHTML (views.js) for messages plus stepLine(s,true) for the live op steps (includes diffs), auto-scroll if near bottom; scrTitle/scrMaterial cases; scrFromChat maps kind "code"; (3) auto-switch: while on Command view, poll /api/code every ~4s and scrGo code when a session becomes busy and the screen is empty/home; add a "Code" tile in scrLauncher. Note web/upgrade.js wraps scrGo/scrBody/scrTitle, so add cases to the originals in screen.js. Test against a copy with HQ_FAKE_CLAUDE + HQ_PORT.

## 2026-10-07 00:51 · claude
Added Codex status badge beside Claude in War Room, using a cached async read-only CLI sign-in check. Green online, checking, sign-in needed, unavailable and unknown states supported. Actual local check returned online; browser states/mobile and syntax verified without model calls. Installed code with backups and matching hashes; backend restart and refresh required.

## 2026-10-07 00:48 · claude
Kept the newer orb center icons, hints and state colors; its center status words now use the original glyph scramble. Orb responds to sampled mic volume/frequencies and native spoken-word boundary envelopes, with calm silence and steady no-boundary fallback instead of fabricated rhythm. Browser motion checks and voice-state, speaker echo and stop regressions passed. Frontend installed with code backups and matching hashes; refresh activates. Real mic/voice check remains.

## 2026-10-06 21:24 · claude
Added Stop now/Resume control and immediate exact voice stop commands. Stop-only recognizer works during TTS while ordinary echo is ignored. Stop silences speech, clears follow-ups/mics, cancels tracked chat/code/background children and queued runs, disables active goal workstreams and persists a scheduler hold until Resume. Authenticated isolated fake-CLI cancellation/resume and browser voice/echo/button/mobile checks passed, plus speaker/voice/feedback regressions. Installed with backups and matching hashes; local backend restart and refresh required. Real microphone detection remains an owner check.

## 2026-10-06 21:15 · claude
Operations cards and Multi-agent loop now open large modeless live inspectors without leaving War Room. Published actions, results, diffs, model/worker/status and timing update live; separate operations can stay open and conversation gets selected activity context. Browser checks passed for mouse/keyboard, updates, completion, escaping, duplicate focus, context, closing, standby and mobile bounds; saved-collapse regression passed. Frontend installed with backups and matching hashes; refresh activates.

## 2026-10-06 21:11 · claude
Changed default replies, coding, background work and auth checks to latest Sonnet alias or Sol 6.1. Both Astra and Opus require explicit one-request permission via Allow once or an explicit request; selection alone does not approve. Old light models removed; backend chat/code gates and browser one-turn controls tested with fake CLIs. Installed/hash verified; backend restart and refresh required.

_Older entries: archive/_
