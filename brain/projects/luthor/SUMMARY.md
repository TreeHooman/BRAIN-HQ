# Luthor

**What it is:** HQ's dashboard assistant (formerly JARVIS). Name/persona live in `config/hq.json` → `assistant`.

**Status:** live

**Where chats live (one store for both):**
- Claude Code's own session files for the HQ folder (`~/.claude/projects/<HQ path>/*.jsonl`). Dashboard chats (`claude -p`) and Claude Code sessions opened on the HQ folder (Claude app Code tab or terminal) both land there.
- This page → **Chats** tab lists them all, labelled *dashboard* or *Claude app*. Open one → **Continue in Luthor**, or run `claude --resume <id>` in the HQ folder to keep going in Claude.
- Only user/assistant text is shown; tool output, thinking and system reminders are hidden. Nothing is copied into git.
- Not included: regular claude.ai chats (no export) and Code sessions opened on another folder.

**Key facts to remember:**
- Engine is Claude Code (`claude -p`), chat permission `plan` by default.
