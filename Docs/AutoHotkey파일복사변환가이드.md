# AutoHotkey를 이용한 Excel 파일 자동 복사/변환 가이드

## 상황 요약

- **원본 파일 위치**: `Z:\data\측정팀\자동화 툴\MES 프로그램 DB`
- **대상 위치**: `C:\Users\USER\Desktop\cursor\측정일지_Html\`
- **파일**: `사업장정보.xls`, `측정사업장.xls`
- **업데이트 주기**: 일일 2회 (MES 프로그램에서 자동 다운로드)
- **접근 제한**: Z:\ 경로에 직접 접근 불가
- **해결 방법**: AutoHotkey 스크립트로 자동 복사/변환

## 핵심 질문: Z:\ 경로의 파일도 .xlsx로 변환해야 하나요?

### 답변: **예, .xlsx로 변환하는 것을 강력히 권장합니다** ✅

## 이유

1. **xlsx 라이브러리의 .xls 지원 제한**
   - Node.js의 `xlsx` 라이브러리는 오래된 .xls 형식을 제대로 읽지 못할 수 있음
   - 실제로 테스트에서 "Bad ExternSheet" 오류 발생

2. **안정적인 동기화**
   - .xlsx 형식은 현대적인 Excel 형식으로 읽기 안정적
   - 데이터 파싱 오류 가능성 최소화

3. **일관된 형식**
   - 모든 파일이 .xlsx 형식으로 통일되면 관리 용이

## AutoHotkey 스크립트 구현 방안

### 방안 1: 파일 복사 + Excel COM 객체로 변환 (권장)

```autohotkey
; Excel 파일 자동 복사 및 변환 스크립트
; Z:\ 경로에서 프로젝트 폴더로 파일을 복사하고 .xlsx로 변환

#NoEnv
#SingleInstance Force

; 경로 설정
SourceDir := "Z:\data\측정팀\자동화 툴\MES 프로그램 DB"
TargetDir := "C:\Users\USER\Desktop\cursor\측정일지_Html"

; 파일 목록
Files := ["사업장정보.xls", "측정사업장.xls"]

; Excel COM 객체 생성
xlApp := ComObjCreate("Excel.Application")
xlApp.Visible := False
xlApp.DisplayAlerts := False

Loop, % Files.Length()
{
    SourceFile := SourceDir "\" Files[A_Index]
    TargetFileXls := TargetDir "\" Files[A_Index]
    TargetFileXlsx := TargetDir "\" StrReplace(Files[A_Index], ".xls", ".xlsx")
    
    ; 파일 존재 확인
    If FileExist(SourceFile)
    {
        ; Excel로 열기
        xlWorkbook := xlApp.Workbooks.Open(SourceFile)
        
        ; .xlsx 형식으로 저장
        xlWorkbook.SaveAs(TargetFileXlsx, 51)  ; 51 = xlOpenXMLWorkbook (.xlsx)
        xlWorkbook.Close(False)
        
        ; 로그 기록
        FileAppend, %A_Now% - 파일 변환 완료: %Files[A_Index]`n, %TargetDir%\sync_log.txt
    }
    Else
    {
        FileAppend, %A_Now% - 파일 없음: %SourceFile%`n, %TargetDir%\sync_log.txt
    }
}

xlApp.Quit()
ExitApp
```

### 방안 2: 파일만 복사 (간단하지만 비권장)

```autohotkey
; 단순 복사 (변환 없음)
; 주의: .xls 파일을 그대로 복사하면 읽기 오류 가능

SourceDir := "Z:\data\측정팀\자동화 툴\MES 프로그램 DB"
TargetDir := "C:\Users\USER\Desktop\cursor\측정일지_Html"

Files := ["사업장정보.xls", "측정사업장.xls"]

Loop, % Files.Length()
{
    SourceFile := SourceDir "\" Files[A_Index]
    TargetFile := TargetDir "\" Files[A_Index]
    
    If FileExist(SourceFile)
    {
        FileCopy, %SourceFile%, %TargetFile%, 1  ; 1 = 덮어쓰기
    }
}
```

### 방안 3: 파일 감시 + 자동 변환 (고급)

```autohotkey
; 파일 변경 감시 후 자동 변환
; 파일이 업데이트될 때마다 자동으로 변환

WatchDir := "Z:\data\측정팀\자동화 툴\MES 프로그램 DB"
TargetDir := "C:\Users\USER\Desktop\cursor\측정일지_Html"

; 파일 변경 감시 설정
WatchFiles := ["사업장정보.xls", "측정사업장.xls"]

; Excel COM 객체 (전역)
xlApp := ComObjCreate("Excel.Application")
xlApp.Visible := False
xlApp.DisplayAlerts := False

; 파일 변환 함수
ConvertFile(SourceFile, TargetFileXlsx) {
    Global xlApp
    xlWorkbook := xlApp.Workbooks.Open(SourceFile)
    xlWorkbook.SaveAs(TargetFileXlsx, 51)
    xlWorkbook.Close(False)
}

; 주기적 확인 (5분마다)
SetTimer, CheckFiles, 300000  ; 300000ms = 5분

CheckFiles:
    Loop, % WatchFiles.Length()
    {
        SourceFile := WatchDir "\" WatchFiles[A_Index]
        TargetFileXlsx := TargetDir "\" StrReplace(WatchFiles[A_Index], ".xls", ".xlsx")
        
        ; 파일이 존재하고 변경되었는지 확인
        FileGetTime, SourceTime, %SourceFile%, M
        FileGetTime, TargetTime, %TargetFileXlsx%, M
        
        If (SourceTime > TargetTime)
        {
            ConvertFile(SourceFile, TargetFileXlsx)
            FileAppend, %A_Now% - 파일 업데이트 및 변환: %WatchFiles[A_Index]`n, %TargetDir%\sync_log.txt
        }
    }
Return
```

## 권장 실행 방법

### 옵션 1: Windows 작업 스케줄러 + AutoHotkey 스크립트

1. **AutoHotkey 스크립트 저장**
   - 파일명: `excel-sync.ahk`
   - 위치: 적절한 위치 (예: `C:\Scripts\excel-sync.ahk`)

2. **작업 스케줄러 설정**
   - 일일 2회 실행 (오전 9시, 오후 6시)
   - 실행 프로그램: `C:\Program Files\AutoHotkey\AutoHotkey.exe`
   - 인수: `C:\Scripts\excel-sync.ahk`

### 옵션 2: AutoHotkey 컴파일 + 작업 스케줄러

1. **스크립트를 .exe로 컴파일**
   - AutoHotkey 컴파일러 사용
   - `excel-sync.exe` 생성

2. **작업 스케줄러에서 .exe 실행**
   - 더 간단하고 빠름

### 옵션 3: 파일 감시 스크립트 (항상 실행)

- AutoHotkey 스크립트를 시작 프로그램에 등록
- 파일 변경 시 자동 변환

## 최종 권장 사항

1. **Z:\ 경로의 파일을 .xlsx로 변환하여 복사** ✅
   - 방안 1 (Excel COM 객체 사용) 권장
   - 가장 안정적이고 확실한 방법

2. **변환된 파일 저장 위치**
   - `C:\Users\USER\Desktop\cursor\측정일지_Html\사업장정보.xlsx`
   - `C:\Users\USER\Desktop\cursor\측정일지_Html\측정사업장.xlsx`

3. **실행 주기**
   - MES 프로그램 업데이트 시점과 맞춰서 설정
   - 일일 2회 (오전 9시, 오후 6시) 또는 파일 감시 방식

4. **에러 로깅**
   - 변환 성공/실패 로그 기록
   - 문제 발생 시 추적 가능

## 확인 사항

1. **Z:\ 경로 접근 가능 여부**
   - AutoHotkey 스크립트에서 Z:\ 경로에 접근 가능한지 확인
   - 네트워크 드라이브인 경우 연결 상태 확인

2. **Excel 설치 여부**
   - Excel COM 객체 사용을 위해 Excel이 설치되어 있어야 함
   - Office 365, Excel 2016 이상 권장

3. **파일 사용 중 확인**
   - MES 프로그램이 파일을 사용 중일 때는 변환 실패 가능
   - 재시도 로직 추가 고려

## 결론

**Z:\ 경로의 파일은 .xlsx로 변환하여 복사하는 것을 권장합니다.**

이유:
- xlsx 라이브러리의 .xls 지원이 불안정함
- .xlsx 형식이 더 안정적으로 읽을 수 있음
- AutoHotkey + Excel COM 객체로 자동 변환 가능

