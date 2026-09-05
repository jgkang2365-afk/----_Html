# Report Explorer Helper

`tools/report-explorer-helper`는 보고서 저장 드라이브에 접근 가능한 Windows PC에서만 실행하는 표준 라이브러리 기반 loopback 서비스입니다. `127.0.0.1:17653`에만 바인딩되며 파일을 수정·삭제·이동하는 API는 제공하지 않습니다.

## 실행

개발 또는 Python 설치 환경에서는 다음을 실행합니다.

```powershell
tools\report-explorer-helper\run-report-explorer-helper.bat
```

기본 보고서 루트는 `Z:\data\측정팀\측정보고서`이고, 필요하면 실행 전 `REPORT_STORAGE_ROOT` 환경 변수로 바꿉니다. 폴더 구조는 `<YYYY>년\<상반기|하반기>\사업장 폴더`여야 하며, 네트워크 드라이브 또는 루트 연결 실패는 `STORAGE_ROOT_UNAVAILABLE`으로 응답합니다.

```powershell
$env:REPORT_STORAGE_ROOT = 'Y:\공유\측정보고서'
tools\report-explorer-helper\run-report-explorer-helper.bat
```

`GET http://127.0.0.1:17653/health`는 설정된 저장소 루트와 접근 가능 여부만 반환하고 사업장 폴더를 열거하지 않는 상태 확인용이라 Origin 없이도 호출할 수 있습니다. Origin이 있으면 동일한 허용 목록을 검사합니다. 서비스는 콘솔에서 `Ctrl+C`로 안전하게 종료되며, 자동 시작된 경우 작업 관리자에서 `ReportExplorerHelper.exe` 또는 Python 프로세스를 종료하면 됩니다.

## 브라우저 API와 보안

운영 EXE의 브라우저 API는 다음 **정확한 Production Origin만** 받습니다.

- `https://html-tan-six.vercel.app`

Vercel Preview Origin(`*.vercel.app`)은 환경 변수에 넣어도 허용하지 않습니다. `/report-explorer/search`와 `/report-explorer/open`은 Origin이 없거나 목록에 없으면 `FORBIDDEN_ORIGIN`으로 거부하고, OPTIONS preflight도 같은 규칙을 적용합니다. Private Network Access preflight가 `Access-Control-Request-Private-Network: true`를 보내면 `Access-Control-Allow-Private-Network: true`로 응답합니다.

개발과 테스트는 운영 설치와 분리해 명시적으로만 허용합니다. 소스 트리의 `run-report-explorer-helper.bat`은 기본적으로 `REPORT_EXPLORER_ENVIRONMENT=development`를 설정하여 `http://localhost:3000`, `http://127.0.0.1:3000`을 허용합니다. 테스트는 `REPORT_EXPLORER_ENVIRONMENT=test`에서 `http://localhost:3001`, `http://127.0.0.1:3001`만 기본 허용합니다. 추가 localhost 또는 사내 개발 Origin이 꼭 필요할 때만 각각 `REPORT_EXPLORER_DEVELOPMENT_ALLOWED_ORIGINS`, `REPORT_EXPLORER_TEST_ALLOWED_ORIGINS`에 쉼표 또는 세미콜론으로 지정합니다. 설치된 EXE는 환경 변수를 지정하지 않으면 항상 Production 정책으로 시작합니다.

운영 도메인을 바꿀 때는 `report_explorer_helper.py`의 `PRODUCTION_ORIGIN`, 이 문서, Python Origin 계약 테스트를 같은 변경으로 갱신하고 EXE를 다시 빌드·배포해야 합니다. Preview URL을 Production Origin의 대체값으로 사용하지 않습니다.

검색 요청은 다음 형태입니다.

```json
{"year": 2026, "period": "상반기", "businessNames": ["(주) 한결", "한결 주식회사"]}
```

서비스는 요청당 반기 폴더를 `os.scandir`로 한 번만 읽고, NFC·공백·대소문자·`(주)`/`㈜`/`주식회사` 표기를 비교용으로만 정규화합니다. 정확 일치 결과를 우선하며, 없을 때만 부분 일치 결과 전체를 반환합니다. `POST /report-explorer/open`은 검색 결과의 `resultId` 하나만 받고 원본 경로는 절대 받지 않습니다. 결과 ID는 메모리에만 보관되고 기본 5분 후 만료되며 `REPORT_EXPLORER_RESULT_TTL_SECONDS`로 30~3600초 범위에서 조절할 수 있습니다.

열기 직전에도 대상 경로를 다시 canonicalize하여 현재 보고서 루트와 검색한 반기 루트 내부의 존재하는 디렉터리인지 확인합니다. root escape, 만료 또는 위조된 ID는 거부합니다.

## 배포와 자동 시작

PyInstaller 단일 EXE를 만들려면 다음을 실행합니다. PyInstaller가 없다면 출력된 명령처럼 현재 사용자 범위에만 설치하면 되며 관리자 권한은 필요하지 않습니다.

```powershell
tools\report-explorer-helper\build-report-explorer-helper.ps1
```

빌드한 EXE는 `tools\report-explorer-helper\dist\ReportExplorerHelper.exe`에 생성됩니다. 현재 사용자 로그인 시 자동 시작하려면 다음을 실행합니다.

```powershell
tools\report-explorer-helper\install-report-explorer-helper-autostart.ps1
```

설치 전 EXE 빌드가 반드시 필요하며 관리자 권한은 필요하지 않습니다. 설치 스크립트는 `ReportExplorerHelper.exe`만 `%LOCALAPPDATA%\MeasurementJournal\ReportExplorerHelper`에 복사하고, `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 값을 해당 EXE의 직접 실행 경로로 등록합니다. `.py`, `.bat`, `.vbs`는 운영 설치 폴더에 복사하지 않으며, 기존 Python 배포의 알려진 런타임 파일도 EXE 복사 성공 뒤 정리합니다.

해제는 `uninstall-report-explorer-helper-autostart.ps1`을 실행합니다. 등록값이나 설치 경로가 예상값과 다르거나, 정확히 확인된 설치 대상 헬퍼 PID가 실행 중이면 삭제하지 않고 중단합니다. 실행 중인 프로세스는 자동 종료하지 않습니다.

## 고정 Python·HTTP 계약

외부에서 사용하는 Python API는 다음 세 개입니다.

```python
ReportExplorerError(code, http_status, message)
ReportExplorerService(root, launcher=None, token_ttl_seconds=300, clock=time.monotonic)
create_server(host='127.0.0.1', port=17653, service=None)
```

`ReportExplorerService`는 `health()`, `search(year, period, business_names)`, `open_result(result_id)`를 제공합니다. HTTP는 `GET /health`, `POST /report-explorer/search`, `POST /report-explorer/open`만 지원하며, POST payload는 각각 정확히 `{year, period, businessNames}`와 `{resultId}` 키만 허용합니다. 오류 body는 항상 아래 형태입니다.

```json
{"error":{"code":"INVALID_REQUEST","message":"..."}}
```

| 코드 | HTTP 상태 | 의미 |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | 경로, JSON 또는 payload 계약 위반 |
| `STORAGE_ROOT_UNAVAILABLE` | 503 | 드라이브 또는 저장소 루트 접근 불가 |
| `STORAGE_PERMISSION_DENIED` | 403 | 저장소 폴더 읽기 권한 없음 |
| `YEAR_NOT_FOUND` | 404 | 연도 폴더 없음 |
| `PERIOD_NOT_FOUND` | 404 | 반기 폴더 없음 |
| `RESULT_NOT_FOUND` | 404 | 알 수 없거나 만료된 resultId |
| `PATH_NOT_ALLOWED` | 403 | root/반기 범위를 벗어난 경로 |
| `OPEN_FAILED` | 500 | Windows 탐색기 실행 실패 |
| `FORBIDDEN_ORIGIN` | 403 | Origin 허용 목록 위반 |

## 로그와 오류 코드

로그는 `%LOCALAPPDATA%\MeasurementJournal\ReportExplorerHelper\logs\report-explorer-helper.log`에 최대 1MB 파일 4개 순환으로 기록됩니다.

오류 코드와 HTTP 상태는 위 고정 계약을 따릅니다.
