# LUTHUR: plan

## Goal
A fast, token-smart assistant the owner can talk to anywhere (PC, phone, desktop hologram) that runs their projects.

## Phases
1. Core brain, dashboard, missions (done).
2. Voice, War Room, Code workrooms, Workspace (done, being polished).
3. Efficiency and mobile: cheap model calls, phone-first layout (in progress).
4. Later: Obsidian notes (see docs/BACKLOG.md). Guarded computer control: first version done 2026-10-07.

## Owner checks
- Level 4 speed: after a restart ask "what time is it", "what's next on LUTHUR" and "is anything waiting for me": answers should be instant (no thinking pause). Open /api/timing to see the numbers.
- Level 4 intake: tell LUTHUR a multi-step job by voice (e.g. "work out what it would take to move my project notes into a database and plan it"). A Task brief appears bottom-right (Work panel) with at most 2 questions; correct it by voice, then say "go" (or "go anyway").
- Level 4 interrupt: ask something long, talk over the answer: the answer stops AND the model stops generating (no late reply).
- Level 4 decision: switch on l4.plans, l4.retries and l4.projectState in config/hq.json (then restart) when you are happy with the brief flow; decide whether research may use WebSearch/WebFetch (config/permissions.json read/plan allow lists).
- Calendar: click a day, press Cancel on a reminder (it disappears) and on a Google event (a delete draft appears in the Outbox; Send removes it). Voice: after a restart "Hey LUTHUR" is on by itself, no Settings trip.
- Voice stop: ask LUTHUR something long, then say "Luther stop" (or "stop listening"): he goes quiet, doesn't finish the answer out loud, and ignores normal talk until you say "Hey LUTHUR" again.
- Side panel: after a restart, click into another app (LUTHUR behind it or minimized) and say "Hey LUTHUR": the small side panel should pop up and answer.
- Voice: after a restart, say "Hey LUTHUR, what time is it". After he answers, talk normally: he should NOT respond. Say "Hey LUTHUR" again: he should. Say "Luther, stop listening": he goes back to waiting for his name. Replies should start about 1-2 s sooner.
- Evening debrief: after a restart, open Today and press "So far today" on the Evening debrief card. At 21:00 one 🌙 alert should arrive (only if LUTHUR did something today) and the card shows it.
- Tasks page: refresh (Ctrl+R); the cards and the agent lines no longer flicker. After a restart, a task whose report says "Partly done" shows an amber "partly done" label, not green "done".
- Daily schedule: refresh, then click the 18:00 Phase 0 reminder (edit window opens), press "Open ↗" (Schedule popout: add a reminder, ○ marks done), and click the red "overdue" pill at the top.
- Initiative picks: approve the 2 "Initiative ·" cards (LoanCentral Phase 0, Reddit recusal rule), read their reports; if useful press Go live now on the plan-level rule. Reject a weak pick later: it shows "you said no".
- Restart LUTHUR so the initiative card shows the real next look (8:00 next morning after 22:00, not "Today 22:38").
- Decide the Discord interest-rate + ID/paystub policy by Oct 10 (loancentral-discord); ask LUTHUR or Claude to lay out options and log the decision.
- Chat: open LUTHUR → Conversation; it starts on the newest message and stays there after you send. The Claude and Codex usage lines above it don't overlap.
- ElevenLabs: Settings → Voice → paste the sk_ key, Save, Preview: LUTHUR speaks in the "LUTHUR" voice. With no credits it falls back to a British device voice.
- Voice noise: talk with fans/wind going; when you stop, LUTHUR shows "Say Hey LUTHUR" after ~5 s and ignores everything until you say the name.
- War Room conversation panel: opens on the newest message and stays there as replies arrive.
- Voice: while LUTHUR talks, say "stop": it should go quiet and Hey LUTHUR stays on in Settings. Then ask something and talk over the answer: it should stop and answer you. Check the War Room 5H ring shows a Claude %.
- Desktop control: say "Luther, take control", check the bar appears, then ask it to open Notepad and type a line (press Allow on the bar). Say "release control", then take control again: Notepad should not ask again. "Forget allowed apps" resets.
- Wake word: with LUTHUR on screen, "Hey LUTHUR" listens in the app (no hologram); minimized, a small corner hologram opens (not full screen).
- PC control: say "Luther, pull up YouTube in Chrome", "open Spotify", then "find red running shoes on Amazon" (LUTHUR's browser on the War Room). It must ask before anything like Buy or Send.
- Voice: while LUTHUR is talking, say "Luther, open my calendar": it should stop and do the new request. Screens should open while it is still answering.
- Voice: LUTHUR starts speaking before the full answer is done, and waits when you trail off on "and…" or "um…".
- Say "Hey LUTHUR" with the app minimized: the hologram opens, listens and answers in your voice choice.
- Hologram stays on top and see-through; drag it by the title bar.
- First real Outbox email send from a Workspace account with writing allowed.
- Phone: open the dashboard and check the new mobile layout.

## Open questions
- Should "Power down" also stop the HQ server?
