# Log

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
