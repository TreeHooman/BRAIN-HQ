# LoanCentral Discord: plan

## Lending upgrade v3.1 (overnight build, set up 2026-10-09)
Goal: the fastest, most transparent loan **tracker** for Verified Lenders. Same request-ticket flow; strictly one loan per borrower; a lender is one button from funding once they claim; everything happens and is recorded in the ticket chat, not DMs.

**Where:** `LoanBot/discord-bot-next/` only (a copy of the live bot, no token, no live database). Tests: `venv\Scripts\python -m pytest tests -q`.
**Hard rules for the build:** never read `.env` or any token; never start the bot or connect to Discord; never touch `discord-bot/` (live) or `LoanCentral-Test`; the bot never sets, suggests or calculates interest; never asks for or stores ID/paystubs/selfies; posts are drafts only (the owner posts); every change comes with tests and the full suite passes.

Steps, in priority order (stop cleanly at the budget; finished steps must be complete and tested):
1. **Strictly one loan per borrower.** `max_live_loans` default 1. A borrower with an open request OR any live loan (claimed/active/unpaid) can't open a request, be claimed again, or receive a `/loan` offer. Clear messages saying why. Tests for every path (request, claim, /loan offer, after repay = allowed again, after unpaid = blocked).
2. **One-button funding.** The request form takes the borrower's payment handle with the method (PayPal.me name, Cash App $cashtag, Venmo @user; strict format checks, no free links). After a lender claims, the ticket shows a funding card for that lender: a link button that opens the payment app with the amount filled in (PayPal `paypal.me/<name>/<amount><CUR>`, Cash App `cash.app/$<tag>/<amount>`, Venmo `venmo.com/<user>?txn=pay&amount=<amount>&note=REQ-xxxx`), plus **Sent ✅**. Sent posts a receipt in the ticket and asks the borrower to press **I got the money**. Handle shown only inside the private ticket. Tests for parsing + link building.
3. **Ticket receipts.** Every step posts one short line in the ticket chat (claimed by, sent, confirmed, payment recorded + balance left, extension asked/approved, repaid/unpaid/refunded) and the loan card at the top stays up to date. Fill any gaps in today's flow.
4. **Trust card at the top of each ticket.** Borrower: loans repaid, on-time rate, total repaid, unpaid history, account age, time in server, open loans. On claim, the lender's record (verified since, loans funded, repaid rate). Facts only, no scores that imply credit checks.
5. **Reddit-style ticket codes (behind a switch).** `$sent`, `$confirm`, `$paid <amount>` / `$paid` (full), `$unpaid`, `$extend <date>`, `$status` typed in the ticket chat, same permissions as the buttons. Needs Discord's Message Content intent, so it stays OFF until `features.json` has `"text_codes": true` (owner turns the intent on in the Developer Portal first). The bot must start normally with it off.
6. **Reminders in the ticket.** Due in 3 days, 1 day, due today; overdue day 1, 3, 7. At overdue day 3 the lender gets a **Mark unpaid** button. Posted in the ticket (mentions), not DMs.
7. **Scam guard (same switch as 5).** Warn in the ticket and log to mods when a message asks for a fee first, gift cards, crypto, "verification payment", or documents.
8. **Weekly stats post** in the mod log (requests opened, claimed, repaid, unpaid, totals by currency); no interest figures.
9. **Nightly database backup** (SQLite backup API into `backups/`, keep 14).
10. **Draft posts** in `posts/`: rules + how-it-works in tracker wording (LoanCentral records loans, doesn't lend or set terms; only Verified Lenders lend; one loan at a time; keep everything in the ticket). Drafts only.
11. **CHANGES.md for the owner:** what changed, how to swap it in, settings to run (`/settings set max_live_loans 1`), what to test with an alt.

## Owner, after the overnight build
- Read `discord-bot-next/CHANGES.md` and the result in LUTHUR's Tasks.
- Swap in: STOP-DISCORD-BOT.bat → back up `discord-bot` → copy the changed files from `discord-bot-next` into `discord-bot` (keep `.env` and `loancentral_discord.db`) → START-DISCORD-BOT.bat. Then `/settings set max_live_loans 1`.
- Test in the main server (preview) with your alt: request with a payment handle → claim → funding link opens the app with the amount → Sent → I got the money → Record payment.
- Optional: Developer Portal → Bot → Privileged Gateway Intents → Message Content ON, then set `"text_codes": true` for the $ codes and scam guard.
- Still open: reset the bot token (it was in a screenshot), then SET-TOKEN-FROM-CLIPBOARD.bat.

## Launch
- `/setup preview:False` (scam filter on), restore 30/3 waits
- Post the reworded rules/guides (the owner pastes them)

## Later
- Shared login with the website (maybe); separate dashboards one click apart
