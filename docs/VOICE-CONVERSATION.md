# Voice and continuous conversation

On desktop, the Command/War Room microphone toggles continuous conversation. It stays listening across turns while ignoring speech during assistant playback. Recognition can still restart internally when the browser speech service ends a session. Mobile retains tap-to-talk per turn.

Settings → Voice & conversation offers available browser/device voices with previews, speaking speed, pitch, and Quick (1.2s), Natural (1.8s default), or Relaxed (3.2s) pauses before sending. Preferences are device-local. Optional Fast routing applies to casual spoken conversation; recognized work requests keep the chosen model. Custom reference voices require a separate speech provider and are not included.

Command displays partial reply text while the signed-in CLI generates it, with 500ms polling. Final replies still drive saved conversation and spoken summaries. Claude uses partial-message events; Codex supports incremental agent-message events when emitted. Draft replies are redacted and kept only in memory. Provider startup and tool execution still affect response time.

Verified with isolated fake-provider fixtures, incremental parser tests, end-to-end busy-chat partial output, simulated desktop recognition, native voice-picker mocks, and existing desktop/mobile upgrade regression. No real microphone or provider latency benchmark was performed. Actual installed Claude CLI supports partial-message output.

Frontend changes activate after refresh. Backend partial replies require restarting the local HQ server. Code-only backups are in the parent workspace artifacts/voice-conversation/installed-backup; production data/config were excluded.

## PC wake-only listener and faster spoken acknowledgment

Settings → Voice & conversation now has an opt-in PC wake listener. A compiled Windows .NET helper uses the installed English speech recognizer and default microphone. Only the wake grammar is loaded while idle: “Hey LUTHUR”/“LUTHUR” with common pronunciation variants. After “Yes?”, it captures one request for up to 12 seconds and sends its text to the local dashboard. Unrelated idle speech never becomes a chat request. The helper tries to restore/focus an existing LUTHUR window; keep that window and the local server running. Windows can restrict foreground activation. It does not launch a missing app window.

The listener speaks an immediate local acknowledgment, then the existing signed-in model performs the request. Browser voice also acknowledges an accepted request immediately. Fast handles casual speech; the new Deep thinking checkbox defaults on for spoken work requests and selects Deep/high effort. Turn it off to retain the chosen work tier. Typed requests keep their chosen model. This is a local acknowledgment followed by one model answer, not a speculative answer from a second model.

Wake listener is off until enabled, and must be re-enabled after a server restart. It pauses recognition during the submitted chat and briefly afterward to avoid hearing playback. Continuous Conversation takes over from the native listener; re-enable the PC switch for background wake-only use. Stop it with the Settings switch. Closing the server stops its helper. Multiple dashboard windows claim each request only once.

Build scripts/pc-wake.cs with the installed .NET Framework C# compiler, referencing System.Speech and System.Web.Extensions. scripts/pc-wake.exe --check validates grammar without opening the microphone. Compilation and grammar loading passed on this PC; isolated voice-flow and bridge tests passed. Real microphone accuracy, foreground restoration and background end-to-end interaction remain owner checks. No Windows execution policy was changed.

## Updated wake handoff

The native helper now only detects a wake phrase (optionally with a following request), sends a wake event, and exits. It no longer speaks in the default Windows voice or uses Windows dictation to capture a separate command. The dashboard starts its existing continuous conversation recognizer, acknowledges in the selected browser voice, and submits following turns through normal chat. “End conversation” re-arms the native wake listener. Disabling the PC switch cancels automatic re-arming. A protocol version check prevents enabling this flow against an older server.

Compilation and wake/wake-with-request grammar checks passed without opening a microphone. An isolated browser test with speech mocks verified selected-voice acknowledgment, continuous mic activation, one spoken follow-up delivered to /chat, and re-arm after ending conversation. The real owner microphone remains a check after restart. Backend restart plus browser refresh is required. The prior helper was stopped through the authenticated local API before replacing its executable; the server was not restarted automatically.

## Visible listening and recoverable speech

Command now displays when the microphone is ready, when speech is detected, the recognized words, and when a turn is sending/sent or queued. Speak after Listening appears; recognition pauses during LUTHUR playback. Send now submits buffered words immediately. Edit text pauses the mic while you correct the message box; sending it resumes conversation. Failed requests retain their text with Retry unsent turn. Microphone errors offer Retry mic after browser permission or device issues are resolved.

Interim recognition replaces prior partial words instead of concatenating them. Unsent words survive recognition restarts and assistant playback. Silence still determines turn submission using the chosen pause setting. Simulated browser recognition and network-failure checks passed; actual microphone/service accuracy is not guaranteed. Refresh loads this frontend update.

## Clear voice graphics

The War Room core now uses a shared state derived from recognition readiness, new transcript events, queued/send state, chat work and speech playback. Green mic means Listening; cyan means Hearing you or Words captured; violet means Thinking/Sending; amber speaker and moving bars mean Speaking, with the mic paused. Idle is quiet, reconnecting says Mic connecting, and blocked recognition shows Mic needs attention. The core label changes directly without scrambling. The input feedback uses the same primary state while last-turn delivery is separate. The LUTHUR page has a compact matching status badge.

Readiness waits for the recognizer's onstart instead of treating conversation mode or a lit button as proof of listening. Graphics stay calm while ready and respond during heard speech; unavailable audio analysis does not invent a loud microphone waveform. Speaking animation is decorative playback status, not a measured audio level. Reduced motion keeps static colors, icons and labels and redraws on state changes. No new always-on listener or additional recording path was added.

Simulated browser checks passed for readiness, hearing/captured, thinking with mic ready, speech taking priority, playback resume, mic errors, idle, LUTHUR status, phone bounds, speech feedback and boot restoration. Real microphone accuracy remains dependent on the browser/device. Refresh activates these frontend changes.

## Silent acknowledgments

Wake activation and accepted spoken requests no longer say “Yes?”, “I’m listening,” “One moment,” or “I’ll look into that.” Listening/Sending/Thinking graphics provide confirmation. Only useful answers, results, requested narration and relevant errors are spoken. The owner's confirmed reply preference also asks the agent to start with substance and skip filler. Startup welcome remains a separate opening greeting.

## Speaker feedback protection

Every browser speech path now pauses recognition before playback starts, including replies, previews and welcome greetings. Listening stays paused until playback actually ends, then waits one second for speaker sound to clear. A recovery timer checks speech playback and its queue rather than reopening the mic after an estimated duration. Old microphone sessions cannot deliver buffered words or change the current mic state after they are stopped. Unsent owner words remain available when listening resumes.

The PC wake helper is temporarily paused for playback when it was active; claimed wake events from playback or its cooldown are discarded even if delivered late. The UI shows Speaking followed by Mic paused, then Listening once recognition starts. Speak after Listening appears; speaking over LUTHUR on speakers is intentionally not captured. This uses playback gating rather than acoustic echo cancellation. Simulated playback, stale callbacks, long speech, cooldown and follow-up checks passed; actual speaker/microphone behavior needs an owner check. Refresh activates this frontend fix.

## Force stop

Stop now is available above the dashboard and popouts. It immediately cancels browser speech, closes microphone sessions, clears pending spoken/text follow-ups and requests cancellation of LUTHUR's current chat, coding sessions and delegated/background runs. Queued runs are cancelled and active goal workstreams disabled. Agent scheduling stays paused across reloads/restarts until Resume LUTHUR; reminders still work. Resume enables fresh work and scheduling but does not restart cancelled tasks or automatically reopen the mic. Stopping cannot undo edits already made.

While normal conversation is listening, “LUTHUR stop,” “Luther stop now,” “stop now” and similar exact stop requests run immediately without an AI turn. During speech, an additional recognizer accepts only a named stop phrase such as “LUTHUR stop now”; other speech is discarded. A phrase quoted by the current synthesized reply is ignored to reduce self-triggering. This stop-only recognizer does not submit transcripts to chat. It needs browser microphone permission and a usable microphone while the app is visible; detection still depends on browser recognition. Use the button if voice is unavailable or missed.

Authenticated stop/resume APIs terminate only LUTHUR's tracked agent child processes, not the server or other PC applications. Tests used isolated fake CLI processes to verify cancellation, queued-task cancellation, blocking new work and explicit resume; mocked browser checks covered playback stop, echo rejection, named voice stop, quoted phrase suppression, queue clearing and mobile bounds. Backend restart and refresh are required for activation.

## Restored holographic labels and responsive orb (October 7)

The newer center icon, Listening/Hearing/Thinking/Speaking label, hint and state colors remain. Status words in the middle now use the original glyph scramble on state changes. The owner clarified that this newer orb layout is preferred. Repeated polling does not restart the scramble; the input panel and accessible label stay plain, and reduced motion keeps the final readable words.

Orb waves respond to real microphone volume while listening, and radial bars use microphone frequency samples. Silence stops the voice-driven phase movement. If samples are unavailable, actual recognized-word events provide a small activity cue rather than fabricated microphone volume. Thinking has a distinct work indicator. Spoken output pulses use native speech word-boundary events, with decay between words; native TTS does not expose an output PCM stream, so this is timing feedback rather than measured speech loudness. Voices without boundary events get a steady speaking glow. End, pause and cancel stop the speech signal. Speaker feedback protection and force stop stay intact.

Isolated browser checks passed for center labels/icons/colors, one scramble per state change, sampled input reaction, silence, boundary pulse decay, steady fallback, speech end and reduced motion. Existing voice-state, speaker echo and force-stop UI regressions passed. Frontend-only update; refresh activates it. Owner microphone/voice timing remains a real-device check.

## Early speech and mid-thought pauses (October 7)

`web/voice-stream.js` (loaded last) watches the 500ms partial-reply poll. As soon as the reply's `<spoken>…</spoken>` sentence is complete, LUTHUR says it while the rest of the answer is still generating; the final reply for that turn is then not spoken again. Turns whose partial never contains the tag fall back to normal final-reply speech. Same voice rules as before (voice replies on, or a spoken turn within 10 minutes); Force stop respected.

`turnPauseFor()` in `web/live.js` extends the silence before sending when the words end mid-thought (a comma, or "and", "so", "um", "because", "the", "to"…): double the chosen pause, at least +2s, max 6s. Used by the main turn timer and the post-playback resend in `speech-feedback.js`. Simulated tests passed; no real microphone test yet.

## Interrupt by name and screen-first (October 7)

While LUTHUR speaks, the mic is still closed to normal speech (speaker echo), but the stop listener now also accepts "Luther, <request>" (two or more words, final result only, not words LUTHUR is itself saying): playback is cancelled and the request is sent as a new voice turn. "Luther stop" keeps its force-stop meaning. Code: `web/voice-stream.js` wraps `StopMonitor.start`.

Screen requests made during a reply now apply while LUTHUR is still writing/speaking: `chat()` ingests drops at most once a second while the chat is busy, and the busy branch of the chat poll calls `chatWhileBusy()` → `scrFromChat` for screens from this turn. Read-aloud/summary screens still wait for the end. Simulated tests passed.
