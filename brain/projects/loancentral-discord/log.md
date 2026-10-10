# Log

## 2026-10-09 23:40 · claude
Owner decisions: strictly one loan per borrower; tracker not facilitator (keep tickets, Verified Lenders only, one-button funding after claim, all in the ticket chat); test in the main server (preview); overnight build in a copy. Made LoanBot/discord-bot-next (copy without .env, live db or logs; 31/31 tests pass) and pointed the project folder at it. Wrote Lending upgrade v3.1 in plan.md (11 steps) for LUTHUR overnight.

## 2026-10-09 19:21 · mission runmv1rpvvtx4x9
Prep for the 10 Oct decision (interest-rate + ID/paystub policy). FACTS: the old #borrowers-read post set "30-45% interest" as the server standard and asked for ID, 2 paystubs, an ID selfie and a phone number (DISCORD-PLAN.md s.1-2, 10). The drafted posts (posts/rules.txt rule 6 and 9, borrower-guide.txt, become-a-lender.txt) and the bot (bot.py FOOTER, ledger.py) already take the opposite line: the bot never sets/suggests/calculates interest, nobody posts ID/paystubs/bank details/selfies in the server, terms are between borrower and lender. OPTIONS: (A, recommended) adopt as drafted: the server publishes no rate and collects no documents; the repay amount is the offer and is recorded only; lenders may ask privately and the borrower decides. Reason: a published "30-45% for up to 3 weeks" is several hundred % APR, which makes the server look like the lender's organiser; ID piles in mod/lender-readable tickets are an identity-theft and Discord-rules risk; it matches the Reddit side. (B) keep a rate guideline: only after legal advice; not advised. (C) keep the rate but drop the ID collection: halfway, still the licensing risk. OWNER MUST: say A/B/C (2 min); if A, tell Luther to log the decision and tick both goal steps, then post rules.txt etc. via the bot (owner restarts) when launch checklist is done. Not legal advice. Not verified: the live main-server channel text (I can't see Discord).

## 2026-10-03 12:05 · history
Security pass: fixed two bot copies running; single-instance lock; live / max_requests_per_day / max_offers_per_day settings. Bot invited to the main server in preview; test ticket REQ-0002 open.

## 2026-10-03 03:00 · history
Built the test server "LoanCentral Dev" with new rules, guides and roles.
