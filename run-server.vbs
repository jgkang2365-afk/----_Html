' 측정일지 로컬 서버를 터미널 창 없이 백그라운드로 실행하는 VBScript
' Run 메서드의 두 번째 인자 '0'은 창을 숨김(Hidden) 처리하는 옵션입니다.

Set WshShell = CreateObject("WScript.Shell")
WshShell.Run chr(34) & "c:\Users\USER\Desktop\안티그래티비\측정일지_html\run-server.bat" & Chr(34), 0
Set WshShell = Nothing
