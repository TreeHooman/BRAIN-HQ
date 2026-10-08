# Decisions

Newest first. What was decided, and why.

- **2026-10-07** [luthur] LUTHUR gets an initiative loop, on by default: it picks up to 2 small jobs per scan (4/day) from deadlines, reminders, goal steps and next steps. Rules decide what starts on its own; everything else asks. _Why:_ Owner wants Jarvis-level autonomy; picking work itself is the biggest gap, and it reuses the existing rule/approval gates so nothing new can act without the owner's say-so.
- **2026-10-07** [hq] Desktop control loosened at the owner's request: app Allows are remembered across sessions ("forget allowed apps" resets), and terminals can be typed in once Allowed. Kept: owner-only start, no passwords/payment numbers, own dashboard and bar off-limits, background missions can't use it. _Why:_ owner wanted control closer to Claude's without re-approving every session.
- **2026-10-07** [hq] Desktop control added: owner-started sessions only, per-app Allow on an always-on-top bar, no passwords/payment numbers, terminals view-only, own dashboard off-limits, 10 min idle / 60 min max. Owner chose full control of their signed-in Chrome (instead of view-only). _Why:_ owner wants LUTHUR to work on the PC like Claude does; the session and approval gates keep injected page text from starting or widening control.
- **2026-10-07** [hq] Computer control as three guarded abilities, not full control: open pages/searches in the owner's Chrome, open allowlisted apps, and drive LUTHUR's own separate browser (asks before send/post/buy/delete, never types passwords or payment numbers). Chat only. _Why:_ LUTHUR reads untrusted pages and emails; free control of the signed-in desktop would let injected text act on the owner's accounts.
- **2026-10-07** [hq] Claude stays in the main seat; Codex shares the brain and gets the same permission as Claude (up to build). Claude may deploy Codex whenever needed, and Codex covers chats and missions during Claude limits. _Why:_ owner wants Codex as a full backup, not a read/plan-only stand-in.
- **2026-10-06** [loancentral] Prioritize LoanCentral growth in this order: survive Reddit API changes, strengthen Discord and explore other suitable outreach channels, bring relevant users to the website, then consider monetization after stable growth. _Why:_ The owner clarified that continuity comes first and revenue should wait until reach and website use are established.
- **2026-10-05** [hq] HQ built as the business brain: plain files in /brain, Claude Code as the agent engine (subscription, no API bill), autonomy up to build (dev only). _Why:_ one place to plan and track every project, reusing Claude Code instead of rebuilding an agent loop.
- **2026-10-03** [loancentral-discord] The Discord bot runs standalone as "LoanCentral" on the host PC (own SQLite, no Reddit data); separate Reddit and Discord dashboards one click apart.
- **2026-10-02** [loancentral] No interest % shown anywhere: amount and repay amount only.
- **2026-10-02** [reddit] Main no-bot approach: the Reddit-first AutoMod method (Reddit stays the front door). Screen-reader lab parked as the backup.
- **2026-10-02** [reddit] Strict [REQ] title format enforced by Reddit's title rule; the pinned AutoMod comment stays pinned.
- **2026-10-02** [loancentral] New pages are built in a sandbox copy of the website and integrated later behind an off switch (dormant until switch day).
- **2026-10-02** [loancentral] Verified Lender flair only; no tiers.
- **2026-10-01** [loancentral] If Reddit says no: r/LoanCentral + website ledger. If yes: keep the bot and add the dashboard.
- **2026-10-01** [loancentral] Goal order: survive, then grow, then make money. Lawyer first. _Why:_ the API closes March 2027.
- **2026-10-01** [loancentral] US and Canada only; new loans in USD/CAD.
- **2026-10-01** [loancentral] Devvit ruled out for lending (LoanLedger rejection).
