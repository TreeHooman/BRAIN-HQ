# LUTHUR engines and memory

Claude handles normal chat and missions. On a Claude usage pause, new chats and read/plan missions use the signed-in Codex CLI. Existing Claude missions keep their own session. Build missions wait for Claude; backup chat is capped at plan permission. A Codex-backed chat keeps its Codex session when continued. The handoff includes only a bounded recent excerpt, not the whole conversation.

HQ chats and agent answers are saved in `brain/history/YYYY-MM.md` and the dashboard History view. Local Codex chats started outside HQ appear there as read-only search results; their transcripts stay in Codex's own session store and are loaded only when opened. `external_chat_search` lets LUTHUR find those chats on request. Outside chat reasoning and tool output are not imported.

Confirmed preferences live in `brain/preferences.md`. Inferred preferences live in `brain/preference-suggestions.md` until accepted. Both are short, editable Markdown. Only relevant confirmed preferences are injected into prompts, capped at 1,800 characters. Challenger is selected in the assistant view and uses its own scoped preferences. Direct orders override stored style.

Token policy: start with the small index, open one project summary as needed, use the fast model for simple work, balanced by default, deep only for hard tasks. Delegate longer tasks, avoid repeated history reads, and leave short project logs. Do not run a separate model to inspect every message for preferences.
