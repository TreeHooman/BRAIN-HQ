# Decisions

Newest first. What was decided, and why.

- **2026-10-05** [hq] HQ may send email and change the calendar, but only through the Outbox: every item needs the owner's click, and the send runs with only that one connector allowed. _Why:_ the owner wants JARVIS to act, but an instruction hidden in an email it reads must never be able to send mail as them.
- **2026-10-05** [hq] Calendar comes in through the read-only iCal secret address, stored only in config/hq.local.json. _Why:_ simplest option, no Google developer account or extra dependencies needed, and it works with Outlook and iCloud too.
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
