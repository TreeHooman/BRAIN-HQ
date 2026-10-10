# Reddit: plan

1. Resubmission: DRAFT READY below (owner checks the 6 facts, then sends by 31 Oct; reminder 24 Oct).
2. r/ModSupport modmail (Message 1), if not sent yet.
3. Post the dated mod recusal rule in the wiki. DRAFT BELOW (owner posts; due 2026-10-08 12:00).
4. Remove r/LoanCentralEU from the host machine's bot config (manual, on the host).
5. Switch day (months away): paste automod-SWITCH-DAY-r-LoanCentral.yaml; wiki/pinned post explains the pinned AutoMod link.

## Draft: Data Access Request resubmission (drafted 2026-10-09)
Basis: denial 2 Oct, ticket 18545859 ("Responsible Builder Policy and/or lacks necessary details"). Strategy: much narrower, specific, plain. Reply on the same ticket/form, whichever Reddit's current Data API access form is. Could not read the denial email body or the form's exact fields (tools only list subjects), so map the text below onto the form's questions.

---
**Subject:** Resubmission: single-community moderator record-keeping tool (r/LoanCentral), app "loancentral"

Hello,

I'm resubmitting request 18545859 with a much narrower scope and more detail.

**Who/what:** I am a moderator of r/LoanCentral, a community where members arrange small peer-to-peer loans in USD or CAD between themselves. "LoanBot" (app "loancentral", account u/LoanCentral) is a moderation and record-keeping tool for that one subreddit. It does not lend, hold, transfer or process money, set terms, or charge interest. It is not commercial: no ads, no data sales, no AI training, no sharing of Reddit content with third parties. It is non-commercial and free to users. [CONFIRM: no paid features exist, or list them honestly]

**Scope (one subreddit only):** r/LoanCentral. It does not read, search or crawl any other subreddit. Other communities have been removed from its configuration (r/LoanCentralEU removed). [CONFIRM done on host]

**What it does with the API:**
1. Reads new posts and comments in r/LoanCentral to detect the sub's own command syntax (e.g. `[REQ]` posts, `$loan`, `!confirm`, `!paid`) and records the agreed loan terms (amount, repayment amount, due date) that the two members themselves posted.
2. Replies in the thread with a confirmation and posts/updates flair (Funded / Repaid / Unpaid) as AutoModerator-style moderation.
3. Applies moderator-decided actions (flair, and bans only after a human moderator confirms an unpaid report). [CONFIRM: is there still any automatic ban? If yes, state it is disabled or mod-approved only]
4. Sends a private message only to a user who invoked a command themselves (e.g. an account link request). It sends no unsolicited or bulk messages. [CONFIRM: $login DM behavior]

**Data stored, and why:**
| Data | Why | Retention |
|---|---|---|
| Reddit username | Identify borrower/lender in the ledger | While the loan record exists; deleted/anonymised on request |
| Post/comment IDs of loan threads | Link a loan record to the public thread | Same |
| Loan terms posted by the members (amount, currency, repay amount, due date, payment method label) | The ledger is the purpose of the tool | Same |
| Loan status history (funded, repaid, unpaid, mod actions with mod name) | Dispute resolution, transparent mod log | Same |
| Link between Reddit username and the member's site sign-in (Google account ID) | Lets a member view their own loans; the user chooses to link it | Until the user unlinks or requests deletion |
Not stored: post/comment text beyond the command and terms, message contents, users' other activity, karma/profile data beyond what a mod checks by hand, payment details or ID documents. [CONFIRM: no phone numbers/IDs stored; Phase 0 check pending]
Deletion: users can request deletion/anonymisation (privacy policy at loancentral.net); we honour Reddit content deletion signals. [CONFIRM link and that deletion tool is deployed on host]

**Access pattern:** one authenticated app/bot account, OAuth, polling one subreddit at low volume (est. [FILL: requests/min; typically well under the free-tier 100/min], a few hundred events a day), respecting rate limit headers and the User-Agent rules.

**Why not fewer permissions:** record-keeping from a human-typed command needs read of the sub's new posts/comments; confirmations and flair need write on that sub only. Requested scopes: read, submit/comment, flair, modposts/modflair. [CONFIRM actual scopes in code; drop anything unused]

**Responsible Builder Policy:** we do not use Reddit data to train models, do not resell or sublicense it, do not scrape or de-anonymise users, do not run OCR/scanning on Reddit content, and do not operate outside the one community that I moderate. Moderators act with recusal rules (a mod cannot act on their own loan; all mod actions are logged) [wiki rule once posted: link it].

**Contingency (shows we're not dependent on bulk access):** we've built a version that works with AutoMod only, no Data API, so we're asking for the narrowest access that keeps the existing community working while it migrates.

Contact: u/[FILL] / loancentral08@gmail.com. Happy to answer any follow-up or share a walkthrough.

Thank you,
[name / u/depotern?]
---

### Red flags: how each is handled in the draft
- `$login` DMs: framed as user-invoked only (not unsolicited). Verify actual behavior.
- Auto-ban on unpaid: framed as human-mod-confirmed only. Verify; if the bot bans automatically, either turn it off before sending or state it honestly.
- Google link: stated as an optional user-chosen link, minimal ID stored.
- Paid features: draft says none. Verify (if any exist, remove or disclose; don't hide them).
- Multi-sub (r/LoanCentralEU, r/borrow etc.): single sub only; EU removed.
- Interest/ID collection (Discord side): out of scope for Reddit; keep it out of this text but don't contradict it.
- OCR/scanning: stated not done. Ticket 18545872 "approval" still unverified, don't cite it.

### Owner checklist before sending (about 5 min)
1. Confirm the [CONFIRM] facts above (esp. auto-ban, `$login` DM, paid features, scopes, request volume).
2. Fill [FILL] (contact/name, request rate).
3. Paste into the Reddit Data API access form / reply to ticket 18545859; send by 31 Oct (reminder 24 Oct).
4. Tell me; I'll tick s1/s4 and log it. I send nothing for you.
Unverified: the denial email's exact wording and what the form asks (couldn't read bodies); that every factual claim matches current bot code (didn't read LoanCentral-Test).

## Draft: Mod recusal rule (wiki)
Source behaviour (already enforced in prototypes mod.html / verify.html): a mod cannot verify themselves or act on their own loan; every verification is logged (who verified whom), and any mod can undo it.

Suggested wiki page: `modrules` (or add to the mods/rules page). Mods-only edit permission if you want it tamper-evident.

---
**Moderator recusal rule** (effective YYYY-MM-DD, set to the day you post)

1. A moderator may not act on anything they are personally involved in. This includes their own verification, their own loans or requests (as borrower or lender), loans of family/household/close associates, and disputes or UNPAID reports naming them.
2. In those cases the mod recuses: they do not verify, remove, ban, flair, or rule on it, and must ask another moderator to handle it.
3. Where tools allow, the system blocks this (a mod can't verify themselves or act on their own loan). Where it can't, it's enforced by this rule.
4. All verifications and mod actions on loans are logged with the acting mod's name. Any mod can review or undo an action; undoing is not penalised.
5. A mod who breaks this rule may be removed from the team by the head mod.
6. Users who think a mod had a conflict can message modmail; a different mod will review.

Adopted: YYYY-MM-DD by the LoanCentral mod team.
---

## Owner checklist (about 2 min, on real r/LoanCentral, you only)
1. Decide: keep rule 5 (removal) and the family clause? Trim if not wanted. Recommend keeping both.
2. Set the date: use the day you post (the reminder says "dated").
3. Go to reddit.com/r/LoanCentral/wiki/create/modrules (or edit the existing rules page), paste, save.
4. Optional: link it from the sidebar/rules. Don't announce it until the other mods agree.
5. Tell me; I'll tick the goal step and log the date.

Unverified: whether a recusal page/wording already exists on the live wiki (couldn't check Reddit); whether other mods have agreed to the wording.
