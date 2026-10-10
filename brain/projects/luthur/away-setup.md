# Away mode: your manual steps (checked 2026-10-08 02:35)

Already done for you: LUTHUR keeps the PC awake (keepAwake = always), Windows never sleeps/hibernates on mains power,
LUTHUR starts at sign-in, the watchdog restarts it if it crashes, Tailscale is connected and starts with Windows,
LUTHUR is shared on Tailscale, your iPhone (iphone-14) is on Tailscale, phone alerts (ntfy) work.

Re-check any time: double-click `scripts\AWAY-CHECK.cmd` (read-only; it changes nothing).

## Tomorrow (about 20 minutes, in this order)
1. ✅ (confirmed working 2026-10-09) **Phone test (2 min).** On the iPhone, with Tailscale on: open https://desktop-aklj0fo.tail2bfce5.ts.net/, enter your PIN, Share → Add to Home Screen. Ask LUTHUR something. Then turn Wi-Fi off and try again on mobile data.
2. **Tailscale keys (2 min).** Both keys expire in 177 days (3 Apr 2027); after that the phone can't reach the PC. Go to login.tailscale.com/admin/machines → `desktop-aklj0fo` → ⋯ → **Disable key expiry**. Same for `iphone-14`.
3. **Dead-man alert (5 min).** healthchecks.io → sign up (free) → Add Check: period 10 min, grace 30 min → Integrations: your email (and phone if you like). Copy the ping URL (https://hc-ping.com/…), paste it on LUTHUR → Today → Away mode → Dead-man ping → Save. You'll get an email if the PC is ever off or offline.
4. **Remote desktop (5 min).** In Chrome on the PC: remotedesktop.google.com/access → Set up remote access → install → pick a name and a 6+ digit PIN. On the iPhone install "Chrome Remote Desktop", sign in with the same Google account, test it on mobile data. This is how you fix a Claude/Codex sign-in from away.
5. **Automatic sign-in after a restart (3 min).** Without it, a power cut or Windows update leaves the PC at the login screen and LUTHUR off. Get Sysinternals **Autologon** from Microsoft (learn.microsoft.com/sysinternals/downloads/autologon), run it, type your Windows password, **Enable**. Trade-off: anyone at the PC gets your desktop, so keep it somewhere private.
6. **BIOS power-on (5 min, needs a restart).** Restart → press Del or F2 at boot → find "Restore on AC Power Loss" / "AC Back" / "After Power Failure" → **Power On** → Save & Exit. (Do step 5 first so LUTHUR comes back by itself after this restart: a good test.)

## Before the trip
- Optional: Windows Update → Pause updates (up to 5 weeks), or set active hours.
- Right before leaving: `scripts\SIGN-IN-CLAUDE.cmd` and `codex login`, so both sign-ins are fresh.
- Optional: a small UPS for power flickers.
- Dry run: 3-5 days using only the phone. Rate each result 👍/👎 so LUTHUR learns.
- Decide: may LUTHUR ever ship/deploy anything while you're away? (Today: never.)
