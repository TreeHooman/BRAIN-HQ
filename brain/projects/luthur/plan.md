# LUTHUR: plan

## Goal
A fast, token-smart assistant the owner can talk to anywhere (PC, phone, desktop hologram) that runs their projects.

## Phases
1. Core brain, dashboard, missions (done).
2. Voice, War Room, Code workrooms, Workspace (done, being polished).
3. Efficiency and mobile: cheap model calls, phone-first layout (in progress).
4. Later: Obsidian notes (see docs/BACKLOG.md). Guarded computer control: first version done 2026-10-07.

## Owner checks
- Images + drafts (after RESTART-LUTHUR + Ctrl+R): paste a screenshot into the Code box, type half a sentence, close the workroom and the window, reopen: text and image are still there. Send it: LUTHUR describes the image. After another restart the box is empty.
- Solo review (after RESTART-LUTHUR): ask a Code workroom for a small file change without workers; the reply ends with an "Independent review" section and the agents line shows LUTHUR · review.
- Pause vs stop (Ctrl+R first): mid-conversation say "Luther pause": he goes quiet, then "Hey LUTHUR, what did I just ask?" still knows. Say "Luther stop": quiet + toast "Stopped · fresh start"; the chat is empty and nothing you said before comes back.
- Wake visual (after RESTART-LUTHUR + Ctrl+R): with LUTHUR in front say "Hey LUTHUR": the War Room shows HEARD YOU straight away, before you finish the sentence.
- Code models (after RESTART-LUTHUR): send a Code request; under the reply a line lists each agent and its model (LUTHUR · manager, workers, LUTHUR · review).
- Listening switch (War Room, after Update + Ctrl+R): Always listening → just talk, he answers with no name; "stop talking" only hushes him (stays Always); "switch to Luther mode" flips to Hey LUTHUR, "switch to always listening" flips back. Hey LUTHUR mode → "Hey Luther, what time is it" in one breath answers instantly.
- Wake word (after a restart): Settings → Voice → Wake word says "On"; press Test (should say Heard: HEY_LUTHER). TV/talk nearby shouldn't wake him; if he misses you, raise Sensitivity.
- Voice back-and-forth (refresh first): "Hey LUTHUR, what time is it", then ask a follow-up without the name within 8 s: he answers. Talk over him: he stops on your first word. Stay quiet ~8 s: he goes back to waiting for "Hey LUTHUR".
- Away mode: rate a finished task 👎 with a note ("always…"); give a similar task: its report should follow the lesson. Or say "that last task was wrong because …".
- Level 4 speed: after a restart ask "what time is it", "what's next on LUTHUR" and "is anything waiting for me": answers should be instant (no thinking pause). Open /api/timing to see the numbers.
- Level 4 intake: tell LUTHUR a multi-step job by voice (e.g. "work out what it would take to move my project notes into a database and plan it"). A Task brief appears bottom-right (Work panel) with at most 2 questions; correct it by voice, then say "go" (or "go anyway").
- Level 4 interrupt: ask something long, talk over the answer: the answer stops AND the model stops generating (no late reply).
- Level 4 trial week (to 15 Oct): one real job a day, score it in brain/projects/luthur/l4-trial.md; review on 15 Oct (Level 4 if no false "done").
- Calendar: after a restart, Cancel a Google event already deleted: its Outbox card ends "sent · already gone", not failed. War Room conversation looks like the LUTHUR tab and updates when you chat elsewhere. Voice: after a restart "Hey LUTHUR" is on by itself, no Settings trip.
- Voice stop: ask LUTHUR something long, then say "Luther stop" (or "stop listening"): he goes quiet, doesn't finish the answer out loud, and ignores normal talk until you say "Hey LUTHUR" again.
- Evening debrief: after a restart, open Today and press "So far today" on the Evening debrief card. At 21:00 one 🌙 alert should arrive (only if LUTHUR did something today) and the card shows it.
- Initiative picks: approve the 2 "Initiative ·" cards (LoanCentral Phase 0, Reddit recusal rule), read their reports; if useful press Go live now on the plan-level rule. Reject a weak pick later: it shows "you said no".
- Decide the Discord interest-rate + ID/paystub policy by Oct 10 (loancentral-discord); ask LUTHUR or Claude to lay out options and log the decision.
- ElevenLabs: Settings → Voice → paste the sk_ key, Save, Preview: LUTHUR speaks in the "LUTHUR" voice. With no credits it falls back to a British device voice.
- Voice noise: talk with fans/wind going; when you stop, LUTHUR shows "Say Hey LUTHUR" after ~5 s and ignores everything until you say the name.
- Voice: while LUTHUR talks, say "stop": it should go quiet and Hey LUTHUR stays on in Settings. Then ask something and talk over the answer: it should stop and answer you. Check the War Room 5H ring shows a Claude %.
- Desktop control: say "Luther, take control", check the bar appears, then ask it to open Notepad and type a line (press Allow on the bar). Say "release control", then take control again: Notepad should not ask again. "Forget allowed apps" resets.
- PC control: say "Luther, pull up YouTube in Chrome", "open Spotify", then "find red running shoes on Amazon" (LUTHUR's browser on the War Room). It must ask before anything like Buy or Send.
- Voice: while LUTHUR is talking, say "Luther, open my calendar": it should stop and do the new request. Screens should open while it is still answering.
- Voice: LUTHUR starts speaking before the full answer is done, and waits when you trail off on "and…" or "um…".
- Hologram stays on top and see-through; drag it by the title bar.
- First real Outbox email send from a Workspace account with writing allowed.
- Phone: open the dashboard and check the new mobile layout.

## Open questions
- Should "Power down" also stop the HQ server?
