# JARVIS / HQ handoff (2026-10-05, round 2 built)

## Where JARVIS lives
- **Folder:** `C:\Users\antho\OneDrive\Project Secrets\HQ` (NOT inside LoanBot)
- **Dashboard:** http://localhost:8800 (opens by itself at Windows sign-in)
- **Full technical notes:** `HQ\HANDOFF.md` (see "handoff #4") and `HQ\CLAUDE.md`

## Do this first (1 minute)
The new look is built but the running HQ is still the old version. Restart it:
1. Double-click `HQ\scripts\STOP-HQ.cmd`
2. Double-click `HQ\scripts\START-HQ.cmd`

## What's new
- Command screen (now the home screen): glowing JARVIS core, project rings, alerts, live stats, deadline countdown, radar, and an ask box.
- Live "coding effect": while JARVIS or a mission works, a terminal-style panel at the bottom shows every step, with green/red change lines and a running count.
- Boot screen; **Power down** (sidebar bottom) plays a shutdown and goes dark. Click to wake. It only turns the screen off; missions keep running.
- Smooth gliding sidebar and page transitions; game-style pop-up confirmations.
- Model switch: Fast / Balanced / **Opus** on Command and JARVIS (Opus uses your Pro limit faster, so it warns you).
- Project switcher in the top bar, or **Ctrl+1–9** (Ctrl+0 = all projects).
- **Ctrl+K** searches everything. Mission Planner: drag steps, click for details, tick when done.
- Settings → Look & feel: HUD or Calm theme, sound on/off.
- Uses the full screen width now.
- **Google Calendar (read-only):** Settings → Calendar → paste your Google "Secret address in iCal format" (calendar.google.com → ⚙ Settings → your calendar → Integrate calendar). Events show on Calendar and Command (Schedule panel + "starts in N min" alerts). The address stays on your PC only.

## Prompt to paste in a new session (folder: Project Secrets\HQ)
> Read HANDOFF.md ("handoff #4") and CLAUDE.md first. The JARVIS HUD is built. Check HQ is restarted (curl localhost:8800/api/live should return JSON), then send one real JARVIS chat and confirm the live operations panel shows the steps correctly. Fix anything off. Then help me hook up Google Calendar and Gmail (read-only) using the options in HANDOFF.md "Not done / next" item 4. Ask me which option before building.

## Questions waiting for you
- Should **Power down** also stop the HQ server? (Right now it only turns the screen off.)
- Calendar: done (iCal link). Gmail: next up is option 2, a daily read-only digest mission.
- NeuroWeb (not found), GenBot (= GenBets-P?), Blueprint Estimator (keep or archive?).
- Phone alerts: install ntfy, subscribe in Settings → Notifications, press Send test.
