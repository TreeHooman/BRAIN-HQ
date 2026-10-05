# JARVIS HUD brief (from the owner, 2026-10-05)

The owner wants HQ to look and feel like Iron Man's JARVIS HUD: alive, cinematic and advanced, but still usable and fast. They shared 6 reference images: cyan holographic HUD panels, concentric rotating rings, radar, bar charts, angled glass panels and a "LMNTRIX" Jarvis-style dashboard. Brief, condensed:

## Visual language
- Background: deep space black-blue `#03060d`, with a faint animated hex/grid pattern and a vignette.
- Glow: cyan `#00e5ff`; amber `#ffb300` for warnings; red `#ff3b5c` for alerts.
- Glass panels: translucent, backdrop blur, 1px glowing borders, clipped/angled corners (clip-path) and corner brackets.
- Type: Orbitron/Rajdhani for headings, JetBrains Mono for data, letter-spaced uppercase labels.
- Subtle scanlines, a chromatic-aberration flicker on hover, and bloom glows.

## Centerpiece
- An animated "core": concentric rotating rings, dashed arcs turning at different speeds and directions, tick marks, and a pulsing orb that reacts to activity and voice.
- A particle field behind it, pulled gently toward the mouse.

## Motion (the most important part)
1. **Boot sequence**, 3–5 s and skippable: typed "INITIALIZING SYSTEMS…" → rings draw in → panels assemble with a stagger → "ALL SYSTEMS ONLINE".
2. **Panels:** spring entrances, a slight 3D tilt toward the cursor, a glow sweep on hover, and a holographic open/close (scaleY from the center line plus flicker).
3. **Data:** numbers count up, text decodes/scrambles into place, sparklines draw themselves, gauges sweep, and a live clock shows seconds.
4. **Ambient:** radar sweep, waveform, blinking LEDs and "system ping" ripples.
5. **View transitions:** a warp/zoom or panels folding away, never a hard cut.
6. **Sound:** Web Audio blips and a boot hum, muted by default behind a toggle.
7. Respect `prefers-reduced-motion`.

## Layout
- Center: the core plus the JARVIS command input ("How can I help, sir?") with streaming-style replies.
- Left: missions/projects with progress rings. Right: live stats, alerts and system health.
- Top: name, status, clock. Bottom: ticker/log stream.
- Ctrl+K command palette with fuzzy search and keyboard navigation.
- Mobile: swipeable cards around the core.

## Mission Planner view
- Goals broken into steps, shown as a holographic node graph with animated energy lines.
- Drag to reorder steps; click a node for details; progress fills as arcs.
- Data goes through one module. Use the real HQ API (`/api/goals`, `brain/goals.json`), not localStorage.

## Live operation effects (added later by the owner)
"When I give a task and it does something, it has cool effects while it works and kinda says what's happening, like a movie/video game UI."
- While JARVIS (chat) or a mission runs, show a live operations feed that narrates each step ("Scanning HQ index…", "Updating LoanCentral…", "Setting reminder…") with scan effects, an elapsed timer and blips.
- The owner's own actions (save, add, complete) get game-style HUD notifications instead of plain toasts.

## Constraints
- Keep HQ's real data and API. Plain JS/CSS with no build step (it runs from Node's static server). CDN libraries such as GSAP or Three.js are allowed, but it must degrade gracefully offline.
- Keep the calm theme as an option (Settings toggle, `localStorage hq-theme` = `hud` | `calm`).

## Round 2 requests from the owner (2026-10-05, evening)
Reference: Instagram reel by @programmergrind (https://www.instagram.com/reel/DeFOlenmKC7/). Instagram blocks the caption without a login, but the video frame is visible. It shows a **multi-agent terminal grid**: a parent thread at the top ("make the login button blue", then a "▶ Orchestrating… (34m 28s · 6 subagents)" line), and below it a grid of tiles, one per agent (claude-1…4, codex-1/2). Each tile streams its tool calls live (`Write(file)`, `Read`, `Search`, `Bash(...)`, `Edited`), with indented result lines ("Wrote 218 lines", "Found 460 files", "✓ 506 passed"), green `+` and red `−` diff lines, and a playful spinner verb at the bottom ("Spelunking…", "Wrangling…", "Grokking…", "Pondering…", "Schlepping…", "Untangling…"). A status bar along the bottom reads "6/6 subagents running · 1,300 calls · +64,139 −7,221".

What the owner wants, in their words, condensed:
1. **"This coding effect"**: when JARVIS or a mission works, show a terminal-style live feed like the reel: one tile per running operation (chat, each mission and follow-up), streaming each tool call with a verb, its target and a short result, diff-coloured `+`/`−` lines for edits, a rotating spinner verb, and a bottom status bar (operations running · tool calls · lines +/−, elapsed). Feed it from the stream-json live ops plan (HANDOFF "Live operations feed"). Extend `narrate()` to keep `{tool, target, result, added, removed}` per step: Edit/Write give line counts, Bash gives the command (secrets redacted, truncated), and hq-brain tools give friendly words ("Updating LoanCentral", "Setting reminder"). Never show file contents from `.env`/token paths.
2. **Words with cool effects that describe what's happening** during code and actions: decode/scramble-in text for each new step, typewriter for narration, a glow pulse on the active line, and game-style HUD notifications for the owner's own actions (save, add, complete, approve).
3. **Boot-up screen AND a shut-down screen.** Boot: as already planned. Shutdown: a "Power down" button (sidebar foot or palette command "Shut down HQ") that plays a reverse sequence (panels fold away, rings collapse into the orb, "JARVIS OFFLINE", fade to black). It is visual only by default (the page goes dark; click to wake, which replays a short boot). Offer a separate confirm option that actually stops the HQ server (`POST /api/shutdown`, then the server exits). Ask before wiring that, because it stops missions and reminders until the next sign-in or START-HQ.
4. **Smooth, less clicky movement, more futuristic sidebar**: no hard cuts. Use a sliding glow indicator that glides between nav items (one absolutely-positioned element animated with transform), hover light-trails, the warp transition between views (render the new view, then animate it in; never blank), and `scroll-behavior: smooth`. Optionally use the View Transitions API (`document.startViewTransition`) when available, with a CSS fallback. Keep it fast: animate only transform/opacity, and respect reduced motion.
5. **Use high-level Opus when needed**: Opus already exists as the `deep` tier (`config/models.json`: fast=haiku, balanced=sonnet, deep=opus). Make it one click: a model switch in the Command ask-box and on the JARVIS screen (Fast / Balanced / **Opus**, labelled by model name, remembered in `localStorage hq-tier`, sent as `tier` to `/api/chat`), and the same on "Run now". Show a small warning when Opus is picked: the owner is on **Pro**, and Opus uses the usage limit much faster. Missions keep their own tier.
6. **Switch between projects fast**: a project switcher in the top bar (dropdown/chips plus palette entries "Switch to <project>") that sets the active project focus everywhere: JARVIS chat focus (`sessionStorage chatProject`), the Command view's highlighted project ring, and the default project for new reminders/missions. Use Ctrl+1…9 for the first nine projects, and show the active project in the top bar with its health LED.
