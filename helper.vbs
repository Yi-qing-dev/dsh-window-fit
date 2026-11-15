' Runs the window-fit helper with no visible window.
' Arguments: 0 = helper.ps1 path, 1 = width ratio, 2 = height ratio, 3 = timeout seconds.
Option Explicit
Dim shell, command
If WScript.Arguments.Count < 4 Then WScript.Quit 2
command = "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass" _
  & " -File " & Chr(34) & WScript.Arguments(0) & Chr(34) _
  & " -WidthRatio " & WScript.Arguments(1) _
  & " -HeightRatio " & WScript.Arguments(2) _
  & " -TimeoutSeconds " & WScript.Arguments(3)
Set shell = CreateObject("WScript.Shell")
' 0 = hidden window, False = do not wait for the helper
shell.Run command, 0, False
