# Model controls and routing

War Room has an engine switch above the core and independent ChatGPT/Codex and Claude model menus. The same controls appear on the LUTHUR page and coding sessions. Engine/model/effort preferences are saved on this device across requests, navigation and reload. Model select labels have unique targets; events stay inside the selected control and unchanged menus are not reassigned.

Auto uses Luna 6 for ordinary ChatGPT conversations and Sol 6.1 for coding or heavier work. Claude Auto uses Haiku for ordinary conversations and the current Sonnet alias for coding or heavier work. The heavy-work classifier uses request terms for coding, debugging, review, research, reports, planning and analysis; dedicated Code sessions always count as coding. This is deterministic routing rather than an additional model call. Short ambiguous follow-ups may use the lighter model.

Selecting Astra or Opus authorizes that model until the owner switches away. Easy requests still use Luna or Haiku; heavier requests can use the selected premium model. There is no Allow once button and reload does not clear selection. A leading explicit “use Astra/Opus” instruction forces that model for that request and saves the selection for later adaptive use. Negated and embedded model mentions do not authorize it. Queued turns retain their model choice at submission. Auto never selects Astra or Opus. Manual Luna, Sol, Haiku or Sonnet choices use that selected model. Low/Med/High stay owner controlled; voice Deep does not overwrite them.

Server validation requires the selected premium authorization flag on chat and Code requests. Existing account, project permissions and PIN protection still apply. Models run through signed-in subscribed CLIs; no token-billed API integration added. Background workers use Luna/Haiku for fast work and Sol/Sonnet for other work; they do not escalate to premium models autonomously.

The October 7 owner instruction supersedes the earlier October 6 strong-default and one-request preference. Isolated fake-CLI API tests verify actual model routing, authorization, explicit overrides, low effort, provider switching and Code defaults. Browser tests verify independent control focus/selections, persistence, queued snapshots and desktop/mobile bounds. No paid model calls made.

Activation: use the desktop Restart LUTHUR shortcut, then refresh. Frontend requires /api/models version 3 to avoid silently routing through an older backend. Code-only backups are under artifacts/adaptive-models/installed-backup.
