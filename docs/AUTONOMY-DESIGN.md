# LUTHUR autonomy design (draft, 2026-10-07; nothing built yet)

Goal: LUTHUR asks less over time, but every change is still logged, can be undone, and has a ceiling enforced in code.
Borrowed from Alfred Black: trust is a ladder the owner grants, LUTHUR may only *propose* a step up, a step down
is instant, and everything it does is a record.

## How it works today (checked in code)
- Brain writes (`project_log`, `project_update`, `reminder_done`, `decision_log`…) apply straight away at `plan` level.
  `brainsync.ts` does the same after Code turns. Gap: no record of what changed, no undo, nothing marks a change as routine.
- The only approval gate is **starting a new task** (`ingestDrop`, `assistant.taskApproval`): it is all-or-nothing.
- Once a task is approved, its sub-agents already run without stopping. Missions don't pause between steps.
- Limits: Claude runs get `permissions.json` deny lists. **Codex `build` runs don't** (they can write `config/`). Fix that first.

## What changes in HQ code
1. **Brain audit + undo**: `src/lib/brain-audit.ts`. Every hq-brain write tool and `brainsync` appends
   `{at, run, engine, tool, project, field, before, after, class}` to `data/brain-audit.jsonl`.
   The dashboard gets a "Brain changes" list with **Undo** (it restores `before`).
2. **Routine vs non-routine**: one function `classify(change)` in `brain-audit.ts`.
   - Routine (apply + log): log entry, nextStep, health, stage moving forward one step, reminder done, goal step done,
     milestone done, Notes section in plan.md.
   - Non-routine (becomes a "Brain change" approval with a diff; applies when the owner approves): replacing SUMMARY/plan,
     stage → live/done/paused, moving a stage backward, a decision marked as a pivot, removing goals/milestones, tags/paths/repos.
3. **Fast-approve rules**: `config/autonomy-rules.json` (owner-only; agents are already denied `config/**`).
   `ingestDrop` checks the rules before it creates a "Start task" approval. On a match it queues the task and logs
   `auto-approved` with the rule id, and the end-of-task report says so.
   Rule shape: `{id, project?, maxPermission, engine?, titleMatch?, maxMinutes, mode: "live"|"shadow"}`.
4. **Learned suggestions**: `approvals.json` already stores approve/reject. A daily code-only pass (no model call)
   groups decisions by key `(project, permission, kind)`. After **5 approvals and 0 rejections in 30 days** it shows a card:
   "Always allow plan-level tasks for GenBot?" A yes writes a rule in `shadow` mode.
   A rejection, or an Undo of an auto-approved task's work, **turns that rule off at once** and logs why.
5. **Run to finish**: an approved task gets a budget (`maxMinutes`, `maxSubtasks`) and runs to the end.
   It sends one report at the end (what changed, which brain changes, anything flagged) instead of check-ins.

## Gates no rule can lift (checked in code before any rule is read; an unknown case → ask)
- Hard limits in `agent-rules.md`: push/deploy/commit/merge, restarting live services, public posts, LoanCentral-Test,
  live r/LoanCentral or Discord, secrets, money, sign-ups.
- Outbox sends (email/calendar) always wait for Send. `request_approval` items are never auto-approved.
- Never above `autonomy.maxLevel` or a project's `maxPermission`. Rules can only cover `read`/`plan` at first.
  `build` rules come in phase 4, and only for projects the owner lists.
- Background runs can't create missions or rules, or change rules (unchanged).

## Examples of fast-approve patterns
- Plan-level research or planning tasks on any project, ≤15 min.
- Follow-up "update brain after mission X" tasks (plan, same project).
- Read-only checks: `hq_check`, stale-project sweeps, reminder clean-up.
- Build on `luthur` scratch copies only (`HQ_PORT` test copy), never the live `data/`.
- Counterexample (never a rule): anything touching LoanCentral live, sending, pushing, restarting.

## Rollout
0. **Enforcement first**: Codex sandbox outside HQ + config snapshot/rollback, dead-letter for unreadable drops,
   crash-requeue cap. Autonomy only grows on limits the code enforces.
1. **Brain audit + routine/non-routine + Undo.** Run 1 week and read the log together.
2. **Fast-approve rules** written by the owner, each one in `shadow` mode for 1 week ("would have auto-approved"),
   then live.
3. **Learned suggestions** with instant demotion.
4. **Run to finish** with budgets. Build-level rules only for projects the owner lists.
