' Starts the HQ server with no console window (if it isn't already running), waits until it answers,
' then opens the dashboard as its own app window (Chrome, else Edge, else the default browser).
' Pass --silent to start the server only (no window).
Const PORT = 8800
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
hq = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
url = "http://localhost:" & PORT & "/"
sh.CurrentDirectory = hq
If Not fso.FolderExists(hq & "\data") Then fso.CreateFolder(hq & "\data")

Function Up()
  On Error Resume Next
  Dim x : Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 1000, 1000, 1000, 1000
  x.open "GET", "http://127.0.0.1:" & PORT & "/api/live", False
  x.send
  Up = (Err.Number = 0 And (x.status = 200 Or x.status = 401))
End Function

If Not Up() Then
  sh.Run "cmd /c node --no-warnings src\server.ts >> data\server.log 2>&1", 0, False
  For i = 1 To 40   ' wait up to ~20s for the server
    WScript.Sleep 500
    If Up() Then Exit For
  Next
End If

openWin = True
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--silent" Then openWin = False
End If
If openWin Then
  ' Serialize launches, restore the existing window and avoid duplicate app windows.
  If fso.FileExists(hq & "\scripts\app-window.exe") Then
    sh.Run """" & hq & "\scripts\app-window.exe""", 0, False
    WScript.Quit
  End If
  If sh.AppActivate("LUTHUR") Then WScript.Quit
  ' Own browser profile: keeps extensions and other sites away from HQ, and gives it its own window.
  prof = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\LUTHUR\window"
  args = " --app=" & url & " --start-fullscreen --no-first-run --no-default-browser-check --user-data-dir=""" & prof & """"
  On Error Resume Next
  sh.Run "chrome" & args, 1, False
  If Err.Number <> 0 Then
    Err.Clear
    sh.Run "msedge" & args, 1, False
    If Err.Number <> 0 Then
      Err.Clear
      sh.Run url, 1, False
    End If
  End If
End If
