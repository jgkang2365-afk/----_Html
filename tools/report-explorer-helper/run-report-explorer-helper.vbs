Set shell = CreateObject("WScript.Shell")
helperDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd.exe /c """ & helperDirectory & "\run-report-explorer-helper.bat""", 0, False
