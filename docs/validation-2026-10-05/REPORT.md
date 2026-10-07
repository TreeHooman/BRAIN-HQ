# LUTHUR local reliability test — 2026-10-05

Result: 15 checks passed, 0 failed in the final run.

Tested an isolated copy of the current application on ports 18880/18881 using its existing HQ_FAKE_CLAUDE hook. No real AI calls or account connections were used. Notification delivery went only to a local HTTP receiver. Production application source, settings, and business data were not edited. Only this report folder was added. All test servers and child processes were stopped afterward.

## Passed

- API writes without the required request header are rejected.
- Project memory is saved through the normal API.
- A background task completes and persists its result without any frontend connected.
- A due reminder reaches the local notification receiver.
- Email proposals remain drafts without a Send action.
- Saved memory and task results survive a server restart; the reminder is not repeated.
- A persisted interrupted/running task is recovered and completed after startup.
- A proposed task waits for explicit approval before execution.
- A simulated quota response pauses its task and records a resume time.
- Simulated authentication failure is classified correctly.
- Simulated provider error is classified correctly.
- A hanging simulated provider is terminated at its timeout.
- Hard-denied tools remain outside the generated allowlist despite an explicit extraAllow request.
- Read-only brain access hides and rejects the project_write tool.
- An interrupted outbound send is marked failed with a check-before-retry instruction, instead of automatically sending again.

## Interpretation and limits

These results verify application mechanics, not LUTHUR's reasoning quality. No live Claude answer-quality benchmark, speech recognition, microphone, phone notification delivery, or real email/calendar integration was tested. Memory checks cover storage/retrieval, not a model remembering preferences. Recovery used an injected durable interrupted-run record, not a physical power failure. The task ran with no frontend at all; a visual close/reopen exercise was not performed. Permission checks cover the tested API/MCP boundaries and generated arguments, not comprehensive shell sandbox security.

The first harness run reported two reminder-related failures because the receiver compared an encoded Unicode HTTP title with plain text. The notification had arrived correctly. The harness was corrected to decode that title; a fresh-data rerun passed all 15 checks. Both runs' evidence is retained.

## Evidence and reproduction

- results.json: final assertions, notification records, scope limits.
- results-first-pass.json: retained initial harness results.
- server.log: isolated server lifecycle log.
- run-tests.mjs and fake-cli.mjs: reusable test harness and simulated provider.
- Disposable application copy: C:\Users\antho\AppData\Local\Temp\luthur-qa-20261005-184822

The harness must run in a disposable application copy with empty brain/data, the original project templates, and a safe config: localhost port 18880; notification server http://127.0.0.1:18881; toast off; mail off; no real accounts or MCP connections. Never run it inside the live HQ directory.
