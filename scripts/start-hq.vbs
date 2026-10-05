' Starts the HQ server with no console window, then opens the dashboard as an app window.
' Pass --silent to start the server only (no window).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
hq = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = hq
If Not fso.FolderExists(hq & "\data") Then fso.CreateFolder(hq & "\data")
sh.Run "cmd /c node --no-warnings src\server.ts >> data\server.log 2>&1", 0, False

openWin = True
If WScript.Arguments.Count > 0 Then
  If WScript.Arguments(0) = "--silent" Then openWin = False
End If
If openWin Then
  WScript.Sleep 2500
  On Error Resume Next
  sh.Run "chrome --app=http://localhost:8800/ --window-size=1440,920", 1, False
  If Err.Number <> 0 Then
    Err.Clear
    sh.Run "msedge --app=http://localhost:8800/ --window-size=1440,920", 1, False
  End If
  If Err.Number <> 0 Then
    Err.Clear
    sh.Run "http://localhost:8800/", 1, False
  End If
End If
