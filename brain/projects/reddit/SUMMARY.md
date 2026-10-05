# Reddit (API & compliance)

**What it is:** the workstream that keeps LoanCentral allowed on Reddit: Data API access, app registration, AutoMod rules and policy compliance.

**Status:** app registered 27 Sep. Data Access Request **denied** 2 Oct (ticket 18545859: "Responsible Builder Policy and/or lacks necessary details"). The reply asking why is pending. The Reddit-first AutoMod flow is fully tested in r/LoanCentralDev.

**Current focus:**
- Resubmission draft: describe LoanBot narrowly as a single-sub mod + record-keeping tool; list stored data and why; remove or explain red flags ($login DMs, auto-ban on unpaid, Google link, paid features).

**Blockers / risks:**
- The "approval" ticket 18545872 for OCR/scanners is UNVERIFIED (timestamps inconsistent). Nothing automatic is aimed at Reddit until it's verified (Gmail "Show original" DKIM or r/ModSupport).
- The spam filter may flag the loancentral.net domain in many comments.

**Key facts to remember:**
- Deadlines: 31 Oct last day for new access requests · 13 Nov RSS ends · 30 Nov migration bounty deadline · 12 Jan 2027 unregistered apps cut off · March 2027 public API closes.
- r/LoanCentral already uses AutoMod, so its removal rules still work (new subs have enforcement off).
- The mod recusal rule (dated) still needs posting in the wiki.
