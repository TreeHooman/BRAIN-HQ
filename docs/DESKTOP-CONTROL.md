# Desktop control

LUTHUR can see the owner's screen and use the mouse and keyboard, like Claude's computer use, inside a session only the owner starts.

- **Start / end:** say or type "Luther, take control" (or "take control of my PC"); "release control" ends it. These phrases are handled by the dashboard (`web/desktop-control.js` → `POST /api/desktop`), never by the model, so the AI cannot start a session. Force stop, the bar's Stop button, 10 minutes without actions or 60 minutes total also end it.
- **Bar:** `scripts/pc-desktop.exe` shows an always-on-top bar at the top of the primary screen: "LUTHUR has control", Stop, and Allow/Deny when LUTHUR first acts in an app. Approvals last for the session.
- **Tools (chat only):** `desktop_screenshot`, `desktop_click`, `desktop_type`, `desktop_key`, `desktop_scroll`. Each action returns a fresh screenshot (MCP image content; Codex may not see images).
- **Never:** typing into password fields (UI Automation `IsPassword`) or card/account-like numbers; acting on LUTHUR's own dashboard (window titles with LUTHUR/localhost:8800, `app-window`), the bar itself, password managers, system tools (regedit, Task Manager, Settings, UAC, mmc). Terminals are view-only (no typing or keys).
- **Owner choice (2026-10-07):** the owner's signed-in Chrome is fully controllable once Allowed. Send/post/buy/delete/accept steps rely on the model asking first (agent rules); unlike LUTHUR's own browser this is not technically enforced.
- **Primary monitor only.**

Build the helper (no dependencies; .NET Framework compiler that ships with Windows):

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe -nologo -target:winexe -out:scripts\pc-desktop.exe -r:System.Windows.Forms.dll -r:System.Drawing.dll -r:System.Web.Extensions.dll -r:C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationClient.dll -r:C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\UIAutomationTypes.dll -r:C:\Windows\Microsoft.NET\Framework64\v4.0.30319\WPF\WindowsBase.dll scripts\pc-desktop.cs
```

`scripts/pc-desktop.exe --check` prints the screen size without showing anything.
