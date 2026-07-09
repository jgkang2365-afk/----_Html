' Launch the MES tray supervisor without showing a console window.
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set shell = CreateObject("WScript.Shell")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
          Chr(34) & currentDir & "\mes-tray.ps1" & Chr(34)
shell.Run command, 0, False
