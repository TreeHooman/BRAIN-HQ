# AI Hockey

**What it is:** a booking system for a hockey school (repo TreeHooman/ai-hockey, TypeScript). "Pay first, spot locks. No admin." Stripe (Apple Pay + card) locks the spot instantly; e-transfer is a second option with a 24h hold. Magic-link accounts. Next.js 16 + Supabase.

**Status:** live/active. Last commits on 2 Oct 2026: hosting PC auto-update as admin, bare domain → www redirect, one-click hosting-PC installer (Cloudflare tunnel, start-at-boot).

**Vocabulary:** block (multi-week run) → session (named recurring thing) → skate (one dated hour).

**Key facts to remember:**
- Read HANDOFF.md in the repo first.
- Age/level splitting deferred (the columns exist; it's a UI change only).
- Project Secrets/AI Hockey holds the installer + secrets (.env.local, tunnel-token.txt). Never read or move them.
