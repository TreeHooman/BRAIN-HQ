# Assistant memory and visible work — 2026-10-06

## Chat cleanup

History → Memory & cleanup controls retention (default 30 days, adjustable 7–365) and automatic cleanup. While idle, LUTHUR attempts up to two old archived chats per day. Manual cleanup uses the same safeguards. Extraction uses the signed-in Claude CLI with no tools, not token API billing.

Each eligible chat is processed into `brain/chat-memory/<chat-id>.md`: facts/preferences, decisions, completed work/findings, and unresolved work. Long conversations are processed in parts. The complete note is atomically saved and reread before removing the archive. If extraction, parsing or verification fails, the original stays. Chats above 120,000 characters stay for manual review. Current/reopened sessions and recent chats stay.

Matching LUTHUR answer-history records are removed from JSONL and their identifiable monthly Markdown blocks. Matching old HQ SDK Claude transcripts can also retire, provided no later turns exist. Outside Claude/Codex sessions, historical backups, unknown provider metadata and unrelated run history are not deleted. Existing backups are not retroactively altered. Memory notes are retained and searchable through `chat_memory_search`.

## Visible assistant work

Diagnosis, bug, check, fix, review, pass and report requests open a modeless Work process window. It shows actual live operations, delegated task links and the latest assistant report. It preserves the selected project/goal/file context for follow-ups. The buttons ask for an issue explanation, possible fixes, an authorized fix with verification, or a review report.

Examples: “edit LoanCentral plan”, “tell me what the issue is”, “what are the possible fixes?”, “fix it and verify the change”, “do a review pass and give me a report”, “show the process”, “pull this up”. Typed and spoken requests share the same handling. Existing browser speech recognition and permission ceilings remain in force.

Assistant instructions require evidence-based diagnosis, showing affected work before edits, actual execution when authorized, and reporting changes, validation, remaining risks and next steps. Tool events supply the process display; no simulated progress is shown. This is a conversational operational assistant, not a claim of sentience or unrestricted computer control.

## Validation and install

Isolated tests passed for memory-before-delete, extraction failure, corrupt archives, active/recent protection, retained outside transcripts, memory search, retention validation/UI, selected process context and pronoun opening. Earlier desktop/mobile/task/Google mock suites also passed. Real microphone recognition and connected-provider editing still need owner-device use. No production chats were cleaned during implementation.

Updated app files are installed. Backend activation requires a local HQ server restart; the preceding automatic restart attempt was blocked by policy and has not been repeated.
