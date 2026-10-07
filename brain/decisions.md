# Decisions

Newest first. What was decided, and why.

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
