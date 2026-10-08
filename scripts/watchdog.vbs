' LUTHUR watchdog (docs/AWAY-MODE.md). Started by start-hq.vbs; one copy runs per signed-in session.
' Every minute it checks that the HQ server answers. After 3 misses in a row it starts the server again and writes
' one line to data\watchdog.log (HQ reads it for the health card). It never restarts a server you stopped on purpose:
' STOP-HQ.cmd writes data\hq-stopped.flag and start-hq.vbs removes it.
Const PORT = 8800
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
hq = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
sh.CurrentDirectory = hq

' Only one watchdog: quit if another wscript is already running this file.
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
n = 0
For Each p In wmi.ExecQuery("SELECT CommandLine FROM Win32_Process WHERE Name = 'wscript.exe'")
  If Not IsNull(p.CommandLine) Then
    If InStr(1, p.CommandLine, "watchdog.vbs", 1) > 0 Then n = n + 1
  End If
Next
If n > 1 Then WScript.Quit

Function Up()
  On Error Resume Next
  Dim x : Set x = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  x.setTimeouts 3000, 3000, 5000, 5000
  x.open "GET", "http://127.0.0.1:" & PORT & "/api/access", False
  x.send
  Up = (Err.Number = 0 And (x.status = 200 Or x.status = 401))
End Function

Sub Note(text)
  On Error Resume Next
  Dim d : d = Now
  Dim stamp : stamp = Year(d) & "-" & Right("0" & Month(d), 2) & "-" & Right("0" & Day(d), 2) & "T" & Right("0" & Hour(d), 2) & ":" & Right("0" & Minute(d), 2) & ":" & Right("0" & Second(d), 2)
  Dim f : Set f = fso.OpenTextFile(hq & "\data\watchdog.log", 8, True)
  f.WriteLine stamp & " " & text
  f.Close
  ' Keep the log small: past ~200 KB start a fresh one.
  If fso.GetFile(hq & "\data\watchdog.log").Size > 200000 Then fso.DeleteFile hq & "\data\watchdog.log", True
End Sub

misses = 0
Note "watchdog started"
Do
  WScript.Sleep 60000
  If fso.FileExists(hq & "\data\hq-stopped.flag") Then
    misses = 0
  ElseIf Up() Then
    misses = 0
  Else
    misses = misses + 1
    If misses >= 3 Then
      Note "restart: server did not answer for 3 minutes"
      sh.Run "cmd /c node --no-warnings src\server.ts >> data\server.log 2>&1", 0, False
      misses = 0
      WScript.Sleep 60000 ' give it time to start before checking again
    End If
  End If
Loop
