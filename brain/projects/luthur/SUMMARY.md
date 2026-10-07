# LUTHUR

**What it is:** The owner's local AI chief of staff and project hub (code name HQ). A dashboard at localhost:8800 with the War Room (voice orb + conversation), Code workrooms, Tasks/Missions, Canvas, Workspace (Google Mail/Drive/Calendar), Daily routines and the brain.

**Status:** building, used daily. Code on GitHub `TreeHooman/BRAIN-HQ` (branch `claude/relaxed-turing-tnsbre`, which the in-app updater follows).

**Engines:** Claude Code CLI (primary) and Codex CLI (backup), both on subscriptions. Auto routing: Haiku/Luna for chat, Sonnet/Sol for work; Opus/Astra only when the owner selects them.

**Current focus:**
- Token efficiency (bare text runs, stable prompts, chat rollover, smaller tool sets).
- Mobile layout and clearer navigation.
- Owner checks of voice/wake word and the desktop hologram.

**Key facts to remember:**
- PIN lock protects the dashboard; the hash lives only in data/access-lock.json.
- Agents never push, deploy or send; email/calendar go through the Outbox after approval.
- HANDOFF.md has an auto-updating "Current state" block built from this project's log/plan.
