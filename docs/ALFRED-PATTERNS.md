# Patterns adapted from Alfred (2026-10-08)

Source: https://github.com/ssdavidai/alfred (MIT; notice in `packages/alfred-vault/LICENSE`, "Copyright (c) 2025 ssdavidai").
Read: `docs/design/matter-engine.md`, `docs/FAILURE-MODES.md`, `docs/specs/issue-115-ha-tier4-autonomy.md`.
**No code was copied.** Alfred is a multi-service platform (Temporal workers, Postgres/SQLite stores, Docker, a web app);
LUTHUR keeps its single Node process and files. Only small mechanisms were re-implemented in LUTHUR's own style.

| Alfred idea | Where it is in LUTHUR | What we took / left |
|---|---|---|
| **Journal first, refuse rather than warn** ("verbs, not writes"; every mutation journaled with actor and run id) | `plans.ts` journal per plan; `signals.jsonl`; existing `brain-audit.ts` | Every plan step event (ready, started, repair, asked, answered, verified, failed) is appended with time and run id. Left: a SQL event store. |
| **Runs are accountable and retry-safe** (run id on every write; idempotent "mint"; re-runs harmless) | `failures.ts`, `outbox.add(key)`, `brain.addLog` same-day dedupe, `questions.ask` dedupe, `startBrief` marks first | A retried/resumed run can't double a draft, a log entry, a question or a start. Uncertain runs resume with "check what's done first". |
| **The cursor is the accepted ledger, not the schedule** (a missed run widens the next window) | `plans.advance` reconcile; runs save their session id at stream start | After a restart, a plan continues from what is recorded as done; a cut-off step resumes its own session. |
| **Projections are generated, never read back as authority** | `project-state.ts` → `brain/projects/<slug>/STATE.md` | STATE.md is rebuilt from records, marked "don't edit", excluded from brain-audit. The owner edits the sources. |
| **Doctrine split: confirmed vs proposed** (machine provenance is "proposed"; silence/"thanks" is not approval) | STATE.md sections (confirmed / assumptions / learned); `questions.ts` (no timeout); "go anyway" assumptions labelled "not confirmed" | Silence never approves anything; a recommended default is recorded as an assumption, never as the owner's answer. |
| **Wrong-matter attribution pollutes context** ("mismatch → context pollution") | `signals.match` | Ambiguous or weak matches stay unlinked instead of guessed; every link records its reason. |
| **Make failure loud** (the systemic "looks fine but isn't": no liveness surface) | stall watchdog (`claude.ts stallMs`), failure classes, plan "needs verification", debrief | A stalled run is stopped and classified; unverifiable work is "needs your check", never "done". |
| **Staged rollout per category, not one global flag** (Alfred's single live/shadow env was a finding) | `config/hq.json` `l4.*` switches; existing autonomy rules with trial → live | Each capability (fast path, intake, plans, retries, review, signals, project state) is switched on separately after its validation. |
| **Owner-approved autonomy by task type** (Tier ladder, locked defaults, snapshots before risky writes) | existing `autonomy.ts` rules + guard snapshots; plans inherit brief permission ≤ project ceiling | Unchanged; plans never raise permission. Left: Alfred's tier-4 "act on real systems" — LUTHUR's hard limits forbid it. |
| **LLM does only what only it can do** (judgment), arithmetic and state transitions in code | evidence checks, scope conflicts, budgets, retries, signals, fast path are code; the model plans, works and reviews | No model calls for routing, checks or bookkeeping. |
