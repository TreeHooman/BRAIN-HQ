# Luthor

**What it is:** HQ's dashboard assistant (formerly JARVIS). Name/persona live in `config/hq.json` → `assistant`.

**Status:** live

**Where chats live:**
- This page → **Chats** tab lists every chat (current + archived), newest first; click one to read it.
- Files: `data/chat/current.json` and `data/chat/archive/` (gitignored, never committed: chats can hold private details).
- `assistant.project` in `config/hq.json` picks which project page shows the chats (default `luthor`).

**Key facts to remember:**
- Engine is Claude Code (`claude -p`), chat permission `plan` by default.
