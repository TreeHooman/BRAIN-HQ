# Level 4 handoff (2026-10-08)

## Owner checklist (test these first)
1. Restart LUTHUR (`scripts/RESTART-LUTHUR.cmd`). Ask "what time is it", "what's next on LUTHUR" and "is anything waiting for me": the answers should be instant (no thinking pause).
2. Describe a multi-step job by voice (e.g. "work out what it would take to move my project notes into a database and plan it"). A task brief should appear bottom-right (Work panel) with at most 2 questions. Correct it by voice, then say "go" (or "go anyway").
3. Ask something long, then talk over the answer: it should stop, with no late reply.
4. Decide:
   - Switch on `l4.plans`, `l4.retries` and `l4.projectState` in `config/hq.json` (then restart), once you're happy with the brief flow.
   - Whether research may use WebSearch/WebFetch (`config/permissions.json`, read/plan allow lists). Today they are denied when agents run unattended. Risk if allowed: a malicious page could get an agent to fetch a URL carrying brain text.

## What is on now
- `l4.fastpath`: simple app questions answered from HQ's data, no model call.
- `l4.intake`: complex chat requests become a reviewable brief; "go" starts it. With `l4.plans` off, "go" runs it as one ordinary Task.

## Ready but off (owner switches)
- `l4.plans`: "go" runs the brief as a plan of steps with dependencies, checks chosen up front, an independent review, bounded repairs, questions for the owner, and restart-safe progress.
- `l4.retries`: bounded retries with backoff for temporary failures of tasks and missions (plan steps always retry).
- `l4.projectState`: generated `brain/projects/<slug>/STATE.md`.

## Not ready
- `l4.signals` (mail/calendar → projects): tested on simulated items only; check it on real mail first.
- `chat.persistent` (one Claude process for the chat): later replies 0.6–1.0 s faster, first reply 1.5 s slower. Left off.

## Validation (on isolated copies)
- `docs/validation-2026-10-09/l4-test.mjs`: 31/31 (simulated model, real server and files). Earlier suites unchanged (only the 2 known autonomy-test failures, same as before).
- Real Claude: code fix with tests, brain update, email draft, owner decision, vague chat → plan all verified; research verified only with web tools allowed on the copy.
- Speed (first text): time / next step / waiting 2.5–3.8 s → 0.02 s. Model turns unchanged (~1 s of each is the Claude CLI starting).

## For the next session
Details, design and limits: `docs/L4-PROGRESS.md`. Alfred patterns: `docs/ALFRED-PATTERNS.md`. How to run the tests: `HANDOFF.md` → Testing.
