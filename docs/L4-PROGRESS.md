# Level 4 build: progress (resume here)

Goal (owner, 2026-10-08): describe an outcome → LUTHUR helps clarify it → works on its own within permissions until a
verified result or a decision only the owner can make. Level 4 counts only for task categories that pass validation.
Hard limits, Outbox and permission enforcement unchanged. Runtime self-modification is a later phase.

## Status (2026-10-08): built and validated; unattended parts waiting for the owner's switch
| Switch (`config/hq.json` → `l4`) | State | Validation |
|---|---|---|
| `fastpath` (no-model answers) | **on** | real model bench + l4-test |
| `intake` (briefs from chat) | **on** (attended: owner says go) | real chat run + l4-test |
| `plans` (go → checked plan) | off, **ready** | l4-test 31/31 + 6 real tasks |
| `retries` (tasks/missions) | off, **ready** (plan steps always retry) | l4-test |
| `projectState` (STATE.md) | off, **ready** | l4-test |
| `signals` (mail/calendar → projects) | off, needs a look at real mail first | l4-test only (fake cards) |
| `chat.persistent` (reused CLI process) | off, **not worth it yet** | bench: later turns −0.6–1.0 s, first turn +1.5 s |

## Design (extends what exists)
| Phase | Module | Hooks into |
|---|---|---|
| 1 Speed | `timing.ts`, `fastpath.ts`, `memo.ts`; per-turn brain facts (`contextFacts`) | `claude.ts` stream timing/stall/priority/session capture, `sendChat`, `runNext` (chat first), `tts.prefetch`, `/api/chat/cancel`, `/api/chat/stream`, `runClaudeTurn` |
| 2 Intake | `intake.ts` | chat tools `brief_update`/`brief_start` (owner's "go" checked), `/api/briefs`, `web/l4.js` |
| 3 Durable | `plans.ts`, `failures.ts` | `execute`/`handleResult` (drops read before settling)/`runNext`/`tick`/`start`, cancel, force stop |
| 4 Evidence | `evidence.ts` | per-kind checks, review pass, bounded repair, approval waits, "needs your check" |
| 5 Blockers | `questions.ts` | hq-brain `ask_owner` (non-committal recommendation refused), `answer_question`, `/api/questions` |
| 6 Memory | `project-state.ts`, `signals.ts` | tick, `project_get part:"state"`, debrief (plans + decisions needed) |
| 7 Alfred | `docs/ALFRED-PATTERNS.md` | ideas only (MIT, no code copied) |
| 8 Acceptance | `docs/validation-2026-10-09/` | `l4-test.mjs` (31), `real-tasks.mjs`, `latency-bench.mjs`, `run-regression.mjs` |

## Results
- l4-test (simulated model, real server/MCP/files): **31/31**. Earlier suites: unchanged (2 known autonomy failures, same on the commit before L4).
- Real model (Claude, isolated copy): code fix + tests ✓ verified (HQ npm test + hidden test + reviewer); brain update ✓;
  email draft ✓ (1 draft, nothing sent); owner decision ✓ (asked, used the answer, waited for the brain-change OK);
  vague chat → brief ✓ (2 material questions with defaults) → plan ✓; research ✓ **only with web tools allowed** (see limits).
- Bugs found by real runs and fixed: drops read after settling (question → "failed"; draft → "missing"), dedupe ignored
  failed drafts, planner "draft" for documents, "no check" analysis steps, status phrases required inside an email,
  owner-decision not asked, whole-plan rewrite looping repairs instead of waiting for approval, "go" waiting for the planner.

## Latency (real Claude Haiku, client-measured first text, median of 3)
| Request | Before | After |
|---|---|---|
| What time is it? | 3.8 s | 0.02 s |
| Next step on LUTHUR? | 3.5 s | 0.02 s |
| Anything waiting for me? | 2.5 s | 0.02 s |
| Status of my projects | 3.0 s | 2.9 s |
| Thanks, that's all | 1.5 s | 1.6 s (0.6–0.9 s with `chat.persistent`, later turns) |
Stage split of a model turn: CLI start ≈ 1.0 s, model first text ≈ 0.6–2.5 s, each tool round-trip ≈ 1 s.

## Known limits / next
- Research needs WebSearch/WebFetch on the allow list (`config/permissions.json` read/plan): denied today in headless runs. Owner decision (risk: an injected page could make an agent fetch a URL carrying brain text).
- Persistent chat: first turn of a process is slower (+1.5 s, cause unknown; likely prompt-cache warm-up). Revisit.
- Voice timings (speech end → first audio, cancel) are recorded from the dashboard but need the owner's real use.
- Signals only link and propose; validate on real mail before switching on.

## Log (newest first)
- 2026-10-08: built phases 1-8; validated; intake on; plans/retries/projectState ready for the owner's switch.
- 2026-10-08 (earlier): started. Reused: tasks/sub-agents, verify.ts, brain-audit, autonomy rules, initiative, debrief, early speech, barge-in, force stop.
