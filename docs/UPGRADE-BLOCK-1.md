# Upgrade block 1 — 2026-10-06

## Delivered

- War Room: cards start nearer the top, green/cyan/purple section outlines, holographic panel styling, and a hide/show top HUD (Alt+H). Quick War Room button and Alt+W are available globally; the mobile tab uses the LUTHUR logo.
- Modeless work windows: project plans, reminders, milestones, daily tasks, recurring routines, goal steps, goals, delegated task reports, approvals, Google files and mail. Windows can be dragged, resized, opened together, and closed separately. Unsaved edits survive state refreshes.
- Editing: shared task controls across Dailies, project work, Calendar reminders, Planner, Canvas, Roadmap and War Room. Goal edits/completion/deletion reconcile linked Dailies items, and completion advances a matching project next step. Removing a delegated task retains its run history; working tasks must be stopped first.
- Dailies replaces Today in navigation. Routines have a time, selected weekdays, and dated completion that resets for each day; today's goals remain separate from the reusable routine.
- Goals support workstreams, agent roles, instructions and dependencies. Dependency cycles and missing ids are rejected. Ready steps create separate tasks using the existing engine, parallel scheduler, budget and permission ceilings; successors wait for successful prerequisites. Failed work and reopened completed steps are retried explicitly. Removing a goal stops its work.
- LUTHUR and Missions share a hub with Conversation, Missions & approvals, Saved chats and Tasks links. Projects and Roadmap share a hub. Existing URLs still work.
- Conversations: War Room shows recent turns from the same persisted assistant conversation. The assistant distinguishes discussion from action requests. Follow-ups sent while busy are queued with their original window context. Desktop conversation mode accepts follow-up speech without repeating the wake word, and avoids hearing its own speech.
- Voice volume slider and a voice command such as “voice volume 50 percent”. Browser speech recognition still finishes turns after a silence; mobile uses tap-to-talk.
- Exact plan opening: local goals and project plans are resolved before broad web search, including scale/growth wording. Active windows give follow-up edits the exact project, goal/step or file identity. Project plan windows refresh as LUTHUR writes.
- Google Docs and Sheets can be edited inside work windows when writing is already enabled on the connected account. Selected-file MCP tools can read/edit only that active file; read permission hides the write tools. Email remains read-only in these windows. Existing Workspace account connections are reused.
- Code chats have a project/repository-folder picker. The chosen folder is checked against the project's registered paths and persists with the session. GitHub repositories can be linked to a project and opened from the picker; this does not add a GitHub account connection or publishing permissions.
- Music HUD and small War Room instruments open their relevant controls/details without leaving War Room.

## Verification

- Isolated server with fixture projects and a fake signed-in CLI; no production brain, keys or accounts copied into testing.
- Backend: routine persistence/validation, bidirectional linked daily completion, goal cycle rejection, scoped repository validation, task rename/completion/removal, and independent/dependent workstream scheduling.
- Browser: desktop and 390px phone layouts, multiple windows, task edits, unsaved plan protection, Dailies completion, combined hubs, repository picker, live plan refresh, mobile logo and no sideways overflow.
- Google provider mocked: cell-save coordinates, document replacement, selected-file context, and MCP read/write/no-active-file boundaries. No real Google file was changed by these checks.
- Real microphone, phone speech recognition and edits against a connected Google account still need owner use to confirm device/provider behavior.

## Saved for later

- Obsidian: connect notes and goal context after core task/goal behavior settles; start with opening linked notes and selected imports, then consider two-way editing. LUTHUR remains the authority for task state and agent assignments.
- Guarded full computer control: owner wants broader model/computer autonomy and fewer permission interruptions, with guardrails to discuss. Keep current hard limits and permission ceilings until those concrete guardrails are agreed.
- Optional deeper GitHub integration: authenticated repository browsing/sync, issues and pull-request workflows are separate from the repository association delivered here.

