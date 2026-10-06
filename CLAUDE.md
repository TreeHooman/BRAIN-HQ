# HQ: instructions for Claude sessions in this folder

HQ is the owner's business brain and autonomous assistant. Read `HANDOFF.md` before changing HQ's code.

@config/agent-rules.md

## When working on the brain (not the code)
- `brain/` is the source of truth. Start with `brain/INDEX.md`; open a project's `SUMMARY.md` before its `plan.md`/`log.md`.
- Past LUTHUR answers (chats, Code, explanations, briefings, missions) are in `brain/history/YYYY-MM.md` (newest at the bottom). Search there when the owner refers to something discussed before.
- `INDEX.md` is auto-generated. Change `brain/projects/<slug>/project.json` instead (or use the hq-brain MCP tools).
- After meaningful work on any project (in any session), record it: a dated entry in that project's `log.md` (newest first), updated `nextStep`/`stage`/`health` in `project.json`, decisions in `brain/decisions.md`, dates in `brain/milestones.json` / `brain/reminders.json`.

## When working on HQ's code
- Node 24 runs `.ts` directly (type stripping): use `import type` for type-only imports, `.ts` extensions in imports, no enums/namespaces/parameter properties. No npm dependencies.
- Claude Code (`claude -p`) is primary. Codex CLI is a signed-in backup for chats and read/plan missions during Claude limits. No direct token-billed API calls.
- Test orchestrator changes against a COPY of HQ with `HQ_FAKE_CLAUDE=<fake cli .mjs>` and `HQ_PORT`, not the real `data/`.
