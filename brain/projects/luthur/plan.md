# LUTHUR: plan

## Goal
A fast, token-smart assistant the owner can talk to anywhere (PC, phone, desktop hologram) that runs their projects.

## Phases
1. Core brain, dashboard, missions (done).
2. Voice, War Room, Code workrooms, Workspace (done, being polished).
3. Efficiency and mobile: cheap model calls, phone-first layout (in progress).
4. Later: Obsidian notes (see docs/BACKLOG.md). Guarded computer control: first version done 2026-10-07.

## Owner checks
- Desktop control: say "Luther, take control", check the bar appears, then ask it to open Notepad and type a line (press Allow on the bar). Say "release control" after.
- Wake word: with LUTHUR on screen, "Hey LUTHUR" listens in the app (no hologram); minimized, a small corner hologram opens (not full screen).
- PC control: say "Luther, pull up YouTube in Chrome", "open Spotify", then "find red running shoes on Amazon" (LUTHUR's browser on the War Room). It must ask before anything like Buy or Send.
- Voice: while LUTHUR is talking, say "Luther, open my calendar": it should stop and do the new request. Screens should open while it is still answering.
- Voice: LUTHUR starts speaking before the full answer is done, and waits when you trail off on "and…" or "um…".
- Restart LUTHUR (scripts/RESTART-LUTHUR.cmd) and refresh so the 2026-10-07 token fixes and auto handoff go live.
- Say "Hey LUTHUR" with the app minimized: the hologram opens, listens and answers in your voice choice.
- Hologram stays on top and see-through; drag it by the title bar.
- First real Outbox email send from a Workspace account with writing allowed.
- Phone: open the dashboard and check the new mobile layout.

## Open questions
- Should "Power down" also stop the HQ server?
