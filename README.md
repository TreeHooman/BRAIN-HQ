# HQ: your business brain

A local dashboard plus an assistant that plans, tracks and works on all your projects, including while you're away. It runs only on this PC (http://localhost:8800), and nothing is published.

## First run (once)

1. **Sign Claude in for background work:** double-click `scripts\SIGN-IN-CLAUDE.cmd` and sign in when your browser opens. Without this, reminders still work but the assistant and missions wait.
2. **Install the app (once):** double-click `scripts\INSTALL-APP.cmd`. It adds an **HQ** icon to your Desktop and Start menu (right-click it in Start → Pin to taskbar). Clicking it starts HQ if needed and opens it in its own window. Remove with `UNINSTALL-APP.cmd`.
   **Open HQ:** the HQ icon, or `scripts\START-HQ.cmd`. It also opens at every Windows sign-in (installed via `scripts\INSTALL-STARTUP.cmd`; undo with `REMOVE-STARTUP.cmd`).
3. **Phone alerts (optional):** install the free **ntfy** app, tap **+**, and subscribe to the topic shown in HQ → Settings → Notifications. Then press **Send test**.

## What's where

| Screen | What it's for |
|---|---|
| **Home** | Today's reminders, the morning brief, approvals waiting on you, project cards |
| **Projects** | One page per project: summary, plan, log, missions, dates, setup |
| **Calendar** | Reminders, milestones and deadlines by month. Click a day to add one |
| **Roadmap** | Timeline of every project's phases and milestones |
| **Inbox** | Dump thoughts. "Sort with assistant" files them into the right projects |
| **Assistant** | Chat with Claude about your business. It can update the brain, set reminders and queue work |
| **Missions** | Background jobs, approvals, run history, usage-limit status |
| **Settings** | Budget, permission ceiling, keep-awake, notifications, Claude connection |

The bar at the top saves any thought straight to the Inbox. Press **/** to jump to it.

## How it works

- **The brain** (`brain/`) is plain files and the source of truth. `INDEX.md` is a tiny auto-built map of every project. Each project has `project.json` (fields), `SUMMARY.md` (short), `plan.md`, and `log.md` (dated, with old entries archived automatically).
- **The engine** is Claude Code running headless (`claude -p`) on your subscription, so there's no API bill. HQ's orchestrator decides what runs, when, with which model and permission. While idle it uses zero tokens.
- **hq-brain** (`src/mcp/hq-brain.ts`) is an MCP server that gives Claude cheap, structured access to the brain (read the index, update a project, add a reminder, queue a follow-up, ask for approval).

### Missions: work while you're away
- Each mission is one fresh, scoped Claude session with a time cap. It writes results back into the brain and ends with a summary, which becomes a notification.
- **Handoffs:** a mission can queue follow-up missions (max 2 per run, max 3 deep) and ask for approval for anything beyond its level.
- **Usage limits:** when Claude says you're out of usage, HQ pauses, reads the reset time, sleeps (no tokens), then **resumes the same session automatically** and pings your phone once.
- **Budget presets:** `light` (default) = 6 missions/day, 15 min each. Chat doesn't count.
- **Skip-if-unchanged:** missions can skip themselves when nothing they watch has changed.
- **Keep-awake:** by default the PC stays awake while missions are queued. Set "Always" in Settings for multi-day autonomy. Missions can't run while the PC is off; they catch up when it's back on.

### Permission levels
| Level | Can do on its own |
|---|---|
| read | Read files, GitHub (read-only) and the web; report back |
| plan | The above, plus update the brain (notes, reminders, decisions, follow-ups) |
| build | The above, plus edit code in the project's folders and run tests (dev only) |

The effective level is always the **lowest** of: the mission's level, the project's ceiling (Setup tab), and the global ceiling (Settings).
**Never, at any level:** pushing, committing, deploying, posting publicly, touching real r/LoanCentral or the live Discord server, editing LoanBot 2.0 code, reading secrets, moving money. These rules are in `config/agent-rules.md` and enforced by tool deny-lists in `config/permissions.json`. An approved request can lift one specific item for one run; `hardDeny` items can never be lifted.

Honest limit: at build level a mission can run `node`/`python`, so a determined script could still write files the deny-lists protect. Keep build missions scoped to project folders and review their runs.

## Future-proofing

- **New models:** missions pick a tier (fast, balanced or deep), never a model. `config/models.json` maps tiers to the `haiku`/`sonnet`/`opus` aliases, which always point at the newest model. Pin exact ids there if you want.
- **New projects:** use "+ New project" in the UI, or tell the assistant "start a project called X". Projects come from `brain/templates/project/`, so edit the template to change what every new project starts with.
- **Frontier / bigger projects:** add `kind: frontier`, give it phases, a permission ceiling and folders, then point recurring missions at it. Missions, tiers and permissions are all data, not code.
- **More tools:** add MCP servers in `config/mcp.json` with a `minLevel`. Only missions at that level or higher see them, which keeps token use down.
- **New mission types:** drop a JSON file in `missions/library/` and it appears under "Add from template".
- **Other Claude sessions:** to give any Claude Code session your brain, run
  `claude mcp add hq-brain -- node "C:\Users\antho\OneDrive\Project Secrets\HQ\src\mcp\hq-brain.ts"`

## Files

```
HQ/
  brain/            ← the brain (source of truth; synced by OneDrive)
  config/           ← hq.json, models.json, permissions.json, mcp.json, agent-rules.md
                      hq.local.json = your private settings (ntfy topic): don't share
  missions/library/ ← mission templates
  data/             ← runtime state: queue/runs, chat history, activity log (safe to delete)
  src/              ← server.ts, lib/ (brain, orchestrator, claude runner, notify), mcp/hq-brain.ts
  web/              ← the dashboard (plain HTML/CSS/JS) + legacy/ (old LoanCentral HQ page)
  scripts/          ← START-HQ, STOP-HQ, SIGN-IN-CLAUDE, INSTALL-/REMOVE-STARTUP, INSTALL-/UNINSTALL-APP
```

Requires Node.js 24+ (TypeScript runs natively, with no build step and no npm packages).
