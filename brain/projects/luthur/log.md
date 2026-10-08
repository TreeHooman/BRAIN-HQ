# Log

## 2026-10-08 01:25 · claude
Level 4 build (docs/L4-PROGRESS.md). Outcome → brief → plan of checked steps → verified result, or one question only the owner can answer.
Built: speed (timing.ts stage timings, fastpath.ts no-model answers, memo.ts cache, per-turn brain facts, SSE /api/chat/stream, TTS prefetch, /api/chat/cancel, background runs below normal priority, chat goes first), intake.ts briefs (chat tools brief_update/brief_start, Work panel web/l4.js), plans.ts durable plans (deps, scope locks, budgets, journal, restart-safe), evidence.ts (checks + independent review + bounded repair), failures.ts (transient/quota/auth/permanent/uncertain, retries with backoff, stall watchdog), questions.ts (ask_owner; answer resumes the step; silence never approves), project-state.ts (STATE.md), signals.ts (mail/calendar → projects). Alfred patterns: docs/ALFRED-PATTERNS.md (MIT, ideas only).
Validated on copies: l4-test 31/31 (fake CLI), earlier suites unchanged; 6 real-model tasks (code fix, brain update, email draft, owner decision, vague chat → plan, research with web on the copy only). Real runs found 8 bugs, all fixed.
Latency (real Claude, first text): time / next step / waiting 2.5-3.8 s → 0.02 s; model turns unchanged (CLI start ≈1 s each). Persistent chat process measured, left off (later turns −0.6-1 s, first turn +1.5 s).
Switched on: fastpath, intake. Ready, off until the owner switches: plans, retries, projectState. Signals off (needs real mail check). Research needs WebSearch/WebFetch allowed (owner decision).

## 2026-10-08 07:15 · claude
Outbox sends now queue (src/lib/outbox.ts): a second Send while one is running waits its turn instead of failing with "Another item is being sent" (owner hit it cancelling a calendar event). Send marks the item "sending" at once, so pressing again is "Already handled". Calendar Cancel reuses an existing Outbox removal instead of making copies, and hides an event while its removal is sending or done (2 h, until the feed catches up). The first removal of "test test luthur test" had actually worked; 5 leftover duplicate drafts discarded. Tested on a copy with a fake CLI: two removals sent back to back, both sent in order.

## 2026-10-08 06:55 · claude
Calendar day Cancel rework (owner: "has a confirm button at the bottom, built badly, doesn't delete some"). Causes: the shared confirm box landed under the Add form with "Confirm/Cancel" buttons; the calendar shows duplicate reminders (same title+time) once, so Cancel removed only one copy; Google events only went to the Outbox. Now: press Cancel, the same button becomes "Sure? Cancel it" for 4 s, press again; every copy in the group is removed; a Google event's delete is created in the Outbox and sent at once (the second press is the owner's approval). The form's bottom button says "Close". Tested on a copy in the browser: duplicate pair removed in one go, inline confirm shown. Google event removal not tested (copy has no calendar connector).

## 2026-10-08 06:35 · claude
Calendar day pop-up (click a day on Calendar) has Cancel on every item (web/app.js dayModal): reminders and milestones are deleted from HQ after a confirm; a Google Calendar event becomes a "delete" draft in the Outbox and is only removed when the owner presses Send there.

## 2026-10-08 06:20 · claude
(1) Context clues for end of turn (web/live.js turnPauseFor): unfinished phrases ("remind me to", "can you", "set an alarm for", "I want", joining words, a lone name) wait base+2 s; finished-sounding ones (full questions, endings like please/now/today/tomorrow/a time or number, yes/no/ok) answer at 70% of base (0.7 s at the default 1 s). (2) "Hey LUTHUR" stays on: the PC listener is forgotten on every restart/unlock (needs a session cookie), so the main window now turns it back on itself whenever the mic is free (web/voice.js pcVoicePoll); unticking it in Settings is remembered (localStorage hq-pcwake=0). In-app hands-free now defaults on (hq-wake).

## 2026-10-08 06:05 · claude
Owner: "very slow still; when I talk I want it to stop talking and let me finish (Jarvis is more of a listener); sometimes it doesn't pick up words". (1) Barge-in (web/voice-stream.js): goes quiet on the first 2 non-echo words (was 3) and no longer sends on the first final chunk: keeps listening across pauses and sends after the normal turn silence (turnPauseFor, longer after "and/um"). (2) Spoken requests with work words (check, plan, update, fix…) no longer switch to Deep + high effort by default (Settings → Voice "Use Deep thinking for spoken work requests" is now opt-in, hq-voice-deep=1). (3) Chat timing in activity.jsonl: event "chat" now has model, effort, firstMs (first text), spokenMs (the <spoken> sentence complete), totalMs. Next: read those numbers after real use to see where the remaining seconds go; recognition misses come from Chrome's Web Speech (a local Whisper engine would be the bigger fix).

## 2026-10-08 04:55 · claude
Owner: "better but still not great". Chat history 04:33-04:38 UTC shows unnamed room speech still answered and stop phrases sent to the model (it replied "Quiet." out loud), but the restart had not happened (scripts/pc-wake.exe.next still waiting), so the voice fixes were likely not loaded yet. Widened local stop handling in web/wake-idle.js (no model call, no reply): shut (the fuck) up, be/go quiet, hold up/on, turn off (only at the end or "turn off now/please/Luther"), go away, fuck off, leave me alone, "not talking to you", "talking to my friend", plus utterances made only of stop words and filler ("no no stop stop stop"). Ending on "hey Luther" counts as calling him back, not a stop. Checked against the real phrases from the history. Corrected today's Claude log entry times to UTC commit times.

## 2026-10-08 03:42 · claude
Stop means stop (owner ask): "Luther stop", "stop", "shut up", "stop listening", "go to sleep", "that's all", "never mind", "goodbye" now all go quiet at once, mute the answer still on its way (and any other speech), close the conversation and listen only for "Hey LUTHUR"; the next accepted request lifts the mute (web/wake-idle.js stopTalking, wrapping force-stop.js hushSpeech + speak/speakAlways). Plain "stop" always gets through, even without the name. "Force stop" unchanged.

## 2026-10-08 03:38 · claude
Side panel fix (owner: "doesn't pop up when I don't have LUTHUR open"). The main window told the server it was on screen whenever document.visibilityState was "visible", which stays true when the window is just behind other windows, so the wake word went to the hidden main window and the hologram never opened. It now also requires document.hasFocus() (web/voice.js), so unless LUTHUR is the window in use, "Hey LUTHUR" opens the side panel.

_Older entries: archive/_
