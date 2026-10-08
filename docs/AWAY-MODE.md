# Away mode

Goal: the owner is away for months and runs LUTHUR from their phone. LUTHUR keeps working, controls its own usage,
learns from results, and says when something is wrong. Built 2026-10-08 (night). Tests: `docs/validation-2026-10-10/away-test.mjs` (17).

## What it does (code)
| Piece | File | What |
|---|---|---|
| Phone access | `src/lib/remote.ts` | Reads `tailscale status` / `tailscale serve status`. HQ stays on 127.0.0.1; `tailscale serve --bg 8800` gives `https://<pc>.<tailnet>.ts.net/` (HTTPS, so the phone mic works), reachable only from the owner's Tailscale devices (never Funnel). The Away card's Turn on button runs serve. Phone alerts (ntfy) open that address. |
| Health | `src/lib/health.ts` | Every 5 min: Claude/Codex sign-in, disk space, phone access, work stuck >24 h, usage reserve, crash restarts. One phone alert per problem (again after 12 h). Optional dead-man ping `health.pingUrl` in `config/hq.local.json` (e.g. healthchecks.io), the only way to hear about a PC that is off. |
| Watchdog | `scripts/watchdog.vbs` | Started by `start-hq.vbs` (one copy). Checks the server every minute; 3 misses → starts it again, one line in `data/watchdog.log`. `STOP-HQ.cmd` writes `data/hq-stopped.flag` so a deliberate stop stays stopped; starting removes it. |
| Usage pacing | `src/lib/pacing.ts` | Config `pacing`. Background work (scheduled missions, initiative, follow-ups) goes to Codex or waits when Claude's weekly use is ahead of an even pace (+10 points), the 5-hour window is past 80%, or only the 15% reserve is left. The owner's chat and own tasks are never held back. |
| Outcome learning | `src/lib/outcomes.ts` | 👍/👎 on every finished task/plan (Tasks page, Away card, or by voice: chat tool `rate_work`). 👎 + note → `brain/projects/<slug>/lessons.md` (or `brain/lessons.md`), read by every later run and by the planner. 👎 on work a fast-approve rule started turns the rule off. Reliability (30 days, "said done but wasn't") on the Away card and in the evening debrief. |
| Habits | `src/lib/patterns.ts` | Code-only scan of chat history (60 days): the same kind of ask on 3+ days at a regular weekday/time → "Do it before I ask" → a scheduled plan-level mission. Announced once on the phone; "No" hides it 60 days. |
| UI | `web/away.js`, `web/away.css` | Today → Away mode card; 👍/👎 on Tasks reports. |
| API | `src/server.ts` | `GET /api/away`, `POST /api/away/health`, `POST /api/remote/serve|unserve`, `GET /api/outcomes`, `POST /api/outcomes/rate`, `POST /api/habits/:key`. |

## Before you leave (owner checklist; things code can't do)
Run `scripts/AWAY-CHECK.cmd` (read-only) to see what is done and what is left; step-by-step list in `brain/projects/luthur/away-setup.md`. The dead-man ping URL can be pasted on the Away card.

1. **Phone:** Tailscale app signed in to the same account (already: iPhone is on the tailnet). Open the Away card's address on the phone, unlock with the PIN, Add to Home Screen. ntfy app subscribed to your topic.
2. **PC never sleeps:** done 2026-10-08 (`keepAwake` = `always`; Windows sleep/hibernate on mains = never).
3. **Power cut:** BIOS/UEFI → "Restore on AC power loss" = Power On. A small UPS helps with flickers.
4. **Comes back after a reboot:** Windows must sign in by itself so the Startup shortcut (`HQ.lnk`, already installed) starts LUTHUR and the watchdog. Use Sysinternals Autologon (stores the password encrypted) or `netplwiz`. Trade-off: anyone at the PC gets your desktop; keep the PC somewhere private.
5. **Windows Update:** set active hours, or pause updates for the trip; after an update reboot, step 4 brings LUTHUR back.
6. **Dead-man alert:** free healthchecks.io check (period 10 min, grace 30 min) → put `"health": { "pingUrl": "https://hc-ping.com/<id>" }` in `config/hq.local.json`. It emails/texts you when the pings stop (PC off, no internet).
7. **Fixing sign-ins from away:** Claude/Codex sign-ins need the PC. Windows Home has no Remote Desktop host, so install Chrome Remote Desktop (or similar) and test it over mobile data. Sign in to Claude (`scripts\SIGN-IN-CLAUDE.cmd`) and Codex fresh right before leaving.
8. **Dry run:** 3-5 days away from the PC using only the phone, before the real trip.

## Not done (needs a decision)
- Shipping while away: agents still can never push, deploy, post or restart live services. A narrow per-project permission (e.g. "deploy the dev bot after tests pass") would need the owner's decision and its own guard.
- `l4.signals` (mail/calendar → projects) is still off until checked on real mail.
