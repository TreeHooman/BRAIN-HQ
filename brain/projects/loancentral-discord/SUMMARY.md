# LoanCentral Discord (LoanBot 3.0)

**What it is:** a standalone Discord bot "LoanCentral" (discord.py 2.7, SQLite) in LoanBot/discord-bot. Flow: the borrower clicks "Request a loan", which opens a private ticket; Verified Lenders claim it; it becomes read-only when closed. No Reddit data.

**Status:** live in the MAIN LoanCentral server (~6,123 members) in **preview**: only mods, Verified Lenders and the "LoanCentral Tester" role see #loan-requests. 31 tests pass. Security pass done (single-instance lock, request/offer caps).

**Current focus:**
- The owner's lender-claim test on REQ-0002 (TEST ONLY).

**Blockers / risks:**
- Decision pending: stop publishing "30-45% interest" and stop collecting ID/paystubs in the server (recommended).
- Discord's monetization rules likely rule out paid lender tools.

**Key facts to remember:**
- Read discord-bot/HANDOFF.md first. Test server: "LoanCentral Dev".
- Launch checklist: restore 30/3 waits; `/setup preview:False` turns on the scam filter.
- Agents never touch the live server; the owner restarts the bot (STOP/START bats).
