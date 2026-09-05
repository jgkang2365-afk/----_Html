# Report Explorer Helper

`tools/report-explorer-helper`는 보고서 저장 드라이브에 접근 가능한 Windows PC에서만 실행하는 loopback 서비스입니다. `127.0.0.1:17653`에만 바인딩되며, 파일을 수정·삭제·이동하는 API는 제공하지 않습니다.

## 저장소와 복구 동작

기본 보고서 루트는 `Z:\data\측정팀\측정보고서`입니다. 실행 전에만 `REPORT_STORAGE_ROOT`로 바꿀 수 있으며, 폴더 구조는 `<YYYY>년\<상반기|하반기>\사업장 폴더`입니다.

```powershell
$env:REPORT_STORAGE_ROOT = 'Y:\공유\측정보고서'
tools\report-explorer-helper\run-report-explorer-helper.bat
```

Z: 등 드라이브가 헬퍼 실행 뒤 잠시 끊어져도 헬퍼 listener는 계속 실행됩니다. `/health`와 검색은 `STORAGE_ROOT_UNAVAILABLE`을 반환하고, 드라이브가 다시 연결되면 **헬퍼를 재시작하지 않아도** 다음 요청에서 루트를 다시 canonicalize하여 정상 경로로 복구합니다. 따라서 RaiDrive 재로그인·드라이브 재연결 후에는 화면에서 `연결 확인` 또는 검색을 다시 실행하면 됩니다.

`GET http://127.0.0.1:17653/health`는 저장소의 접근 가능 여부만 반환하며 사업장 폴더를 열거하지 않습니다. 서비스는 콘솔에서는 `Ctrl+C`로 안전하게 종료합니다.

## 브라우저 API와 Origin

운영 EXE의 브라우저 API는 다음 정확한 Production Origin만 받습니다.

- `https://html-tan-six.vercel.app`

`/report-explorer/search`와 `/report-explorer/open`은 Origin이 없거나 허용 목록에 없으면 `FORBIDDEN_ORIGIN`으로 거부합니다. Vercel Preview Origin(`*.vercel.app`)은 어떤 환경 변수로도 허용하지 않습니다. Private Network Access preflight에는 필요한 허용 헤더를 응답합니다.

개발·테스트는 운영 설치와 분리해 명시적으로만 허용합니다. 소스 트리의 `run-report-explorer-helper.bat`은 development 모드에서 localhost:3000만, test 모드는 localhost:3001만 기본 허용합니다. 설치된 EXE는 환경 변수를 지정하지 않으면 Production 정책으로 시작합니다.

## 검색 및 열기 계약

검색 요청은 다음 형태입니다.

```json
{"year": 2026, "period": "상반기", "businessNames": ["(주) 한결"]}
```

한 요청에서 반기 폴더를 한 번만 읽고, 사업장명은 비교 시에만 NFC·공백·대소문자·`(주)`/`㈜`/`주식회사` 표기를 정규화합니다. 정확 일치를 우선하고 없을 때만 부분 일치 전체를 반환합니다. 열기 API는 검색으로 발급한 일회성 `resultId`만 받고 원본 경로는 받지 않습니다. 결과 ID는 메모리에만 있으며 기본 5분 뒤 만료됩니다.

열기 전에도 루트·반기·대상 경로를 다시 canonicalize하고 허용 범위와 디렉터리 존재를 확인합니다. root escape, 만료, 위조 ID는 거부합니다.

## EXE 설치와 자동 시작

GUI에서 EXE를 만들고 설치하려면 PowerShell에서 다음 스크립트를 순서대로 실행합니다. 관리자 권한은 필요하지 않습니다.

```powershell
tools\report-explorer-helper\build-report-explorer-helper.ps1
tools\report-explorer-helper\install-report-explorer-helper-autostart.ps1
```

빌드 결과는 `tools\report-explorer-helper\dist\ReportExplorerHelper.exe`입니다. 설치 스크립트는 EXE만 `%LOCALAPPDATA%\MeasurementJournal\ReportExplorerHelper`에 복사하고, 현재 사용자 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`에 직접 실행 경로를 등록합니다. 설치 대상 헬퍼가 실행 중이면 교체하지 않고 중단합니다.

해제는 `uninstall-report-explorer-helper-autostart.ps1`입니다. 예상하지 않은 등록값·설치 경로·실행 중 PID를 발견하면 삭제하지 않고 중단합니다. 재부팅이나 로그아웃은 설치·복구 절차에 필요하지 않습니다.

## 오류 코드

| 코드 | HTTP | 의미 |
| --- | --- | --- |
| `STORAGE_ROOT_UNAVAILABLE` | 503 | 드라이브 또는 저장소 루트 접근 불가 |
| `STORAGE_PERMISSION_DENIED` | 403 | 저장소 읽기 권한 없음 |
| `YEAR_NOT_FOUND` / `PERIOD_NOT_FOUND` | 404 | 요청 연도 또는 반기 폴더 없음 |
| `RESULT_NOT_FOUND` | 404 | 알 수 없거나 만료된 결과 ID |
| `PATH_NOT_ALLOWED` | 403 | 허용된 저장소 범위 밖 경로 |
| `FORBIDDEN_ORIGIN` | 403 | 허용되지 않은 브라우저 Origin |
