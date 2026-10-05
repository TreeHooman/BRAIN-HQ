# LoanCentral

**What it is:** r/LoanCentral (~7.5k members), LoanBot 2.0 (Python/PRAW, PostgreSQL) and the loancentral.net Flask site. Record-keeping for peer loans. It doesn't lend, handle payments or set terms.

**Status:** live. LoanBot runs on Reddit's Data API until Reddit's dates. The public API closes **March 2027**; the Data Access Request (ticket 18545859) was **denied 2 Oct** with a template.

**Current focus:**
- Phase 0 housekeeping (by 8 Oct): deploy merged changes, US/CA sub rule, close r/LoanCentralEU, ModSupport modmail, repo secrets check, phone numbers, bot wiki.
- The Reddit-first flow is live on loancentral.net in **Test mode** (dormant switch). Switch day is months away.
- Resubmit the access request before **31 Oct** (see the Reddit project).

**Blockers / risks:**
- Devvit rejects lending apps (LoanLedger precedent), so there's no Devvit path.
- No API after March 2027, so the no-bot mode must be ready (AutoMod + site + modmail verification).

**Key facts to remember:**
- Goal order: survive → grow → monetize. Lawyer before any paid feature. Never sell borrower data (FCRA risk).
- Test only in r/LoanCentralDev; never the real sub.
- The LoanCentral-Test repo is LoanBot 2.0 live code: read-only. Pushing doesn't deploy; the hosting PC does.
- Full history: /legacy/loancentral-hq.html (the old HQ page) and LoanBot/reddit-first/HANDOFF.md.
