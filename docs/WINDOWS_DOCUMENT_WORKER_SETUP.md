# Windows 신규 사업장 문서 Worker 운영 절차

## 1. 운영 Supabase 적용

1. SQL Editor에서 `supabase/migrations/20260719_add_new_business_document_generation.sql`을 실행합니다.
2. SQL Editor에서 `supabase/migrations/20260719_add_document_worker_realtime_wakeup.sql`을 실행합니다.
3. `supabase/verification/20260719_verify_new_business_document_generation.sql`을 실행합니다.
4. `supabase/verification/20260719_verify_document_worker_realtime_wakeup.sql`을 실행합니다.
5. `document-templates` bucket이 private인지 확인합니다.

## 2. 환경변수

깡통컴 `.env.local`에 다음 값을 설정합니다.

```env
DOCUMENT_WORKER_TOKEN=충분히_긴_임의의_비밀값
DOCUMENT_WORKER_API_URL=http://localhost:3000
DOCUMENT_OUTPUT_ROOT=Z:\data\측정팀\측정보고서
DOCUMENT_WORKER_REALTIME_ENABLED=true
DOCUMENT_WORKER_RECOVERY_POLL_SECONDS=300
SUPABASE_URL=https://프로젝트참조.supabase.co
SUPABASE_REALTIME_KEY=NEXT_PUBLIC_SUPABASE_ANON_KEY와_동일한_값
```

Vercel에도 동일한 `DOCUMENT_WORKER_TOKEN`을 등록해야 Vercel API를 직접 사용할 수 있습니다.
로컬 Next 서버 API를 사용하는 현재 깡통컴 구성에서는 `DOCUMENT_WORKER_API_URL=http://localhost:3000`을 사용합니다.

## 3. Python 준비

관리자 PowerShell에서 프로젝트 폴더로 이동한 뒤 실행합니다.

```powershell
py -3.14 -m venv .venv-document-worker
.\.venv-document-worker\Scripts\python.exe -m pip install --upgrade pip
.\.venv-document-worker\Scripts\python.exe -m pip install -r requirements-document-worker.in
```

문서 Worker 전용 가상환경을 사용하므로 다른 자동화의 Python 패키지와 충돌하지 않습니다. `server-tray.ps1`은 이 가상환경을 우선 사용하고, 없을 때만 시스템 `python.exe`로 대체합니다.

Microsoft Excel과 한글이 설치되어 있어야 하며, 해당 Windows 사용자로 두 프로그램을 한 번씩 정상 실행한 뒤 닫습니다.

## 4. 템플릿 등록

관리자 계정으로 `문서 템플릿 관리` 메뉴에서 2026년 하반기 템플릿 3개를 등록하고 활성화합니다.

- 일반 예비조사표: `.hwpx`
- 현장 예비조사표: `.hwpx`
- 화학물질입력 및 측정계획: `.xlsm`

샘플 원본은 구조 검증에만 사용하며 Git 저장소에 커밋하지 않습니다.

검증된 일반 HWPX 누름틀:

`measurement_year`, `measurement_period`, `business_name`, `representative_name`, `address`, `business_category`, `phone`, `main_product`, `fax`, `total_employees`, `manager_name`, `manager_email`, `manager_contact`, `preliminary_surveyor`, `business_number`, `industrial_accident_number`

검증된 현장 HWPX 누름틀:

`measurement_year`, `measurement_period`, `business_name`, `representative_name`, `address`, `business_category`, `phone`, `main_product`, `fax`, `total_employees`, `manager_name`, `manager_email`, `manager_contact`

검증된 XLSM 위치:

- 시트: `측정계획(양식)`
- B1: 사업장명·연도·주기
- G1: 담당자명
- C2: 담당자 메일
- F2: 담당자 연락처
- I2: 계산서 메일
- `xl/vbaProject.bin` 포함 확인

## 5. H0507 실제 COM 통합 검증

실제 템플릿 경로를 지정해 실행합니다.

```powershell
python scripts/verify_document_worker_templates.py `
  --general "C:\경로\일반 사업장명(예비조사표-26하).hwpx" `
  --field "C:\경로\현장 예비조사표(26하).hwpx" `
  --xlsm "C:\경로\★ 회사명(26하)_화학물질입력 및 측정계획(V2.0).xlsm" `
  --output-root "Z:\data\측정팀\측정보고서"
```

테스트 fixture는 `H0507`, 2026년 하반기를 사용합니다. 최종 경로는 다음과 같습니다.

```text
Z:\data\측정팀\측정보고서\2026년\하반기\(((미확정 사업장)))\H0507 통합검증 사업장
```

생성된 HWPX 누름틀 값, XLSM B1/G1/C2/F2/I2, VBA, 서식, 수식, 병합, 버튼과 인쇄영역을 직접 확인합니다.

## 6. 자동 시작

`server-tray.ps1`은 `DOCUMENT_WORKER_TOKEN`이 설정되어 있으면 Next 서버와 `document_worker.py`를 함께 숨김 실행합니다.
기존과 같이 `register-startup.bat`을 관리자 권한으로 한 번 실행하면 로그인 시 서버 트레이가 시작됩니다.

Worker 로그:

- `logs/document-worker.log`
- `logs/document-worker-error.log`

Worker는 한 번에 하나의 PENDING 작업만 원자적으로 선점합니다. 사용자가 열어 둔 Excel 또는 한글 프로세스는 종료하지 않습니다.
## Realtime 작업 감지

기본 실행은 Supabase Realtime Broadcast 신호와 300초 복구 폴링을 함께 사용합니다.

1. Worker 시작 시 `/claim`을 즉시 호출하여 기존 `PENDING` 작업을 모두 처리합니다.
2. DB 트리거는 작업이 `PENDING`으로 전환될 때 `status`, `job_type`만 Broadcast합니다.
3. Worker는 신호를 직접 실행 데이터로 사용하지 않고 인증된 `/claim` API를 호출합니다.
4. 중복 신호는 Worker 내부 단일 실행 lock으로 합쳐집니다.
5. Realtime 장애 중에도 300초마다 `/claim`을 호출합니다.

`document_generation_jobs`에는 연락처 등 스냅샷이 있으므로 테이블 자체를 anon Postgres Changes에 공개하지 않습니다. Broadcast topic에는 작업 ID나 개인정보가 포함되지 않습니다. `SUPABASE_REALTIME_KEY`에는 service-role secret이 아니라 기존 anon key를 사용합니다.

정상 시작 로그:

```text
문서 Worker 시작 version=2026.07.19.4 ... realtime=True recovery=300s
Realtime 연결 시작
Realtime WebSocket 연결 성공
Realtime 구독 성공 topic=document-worker-jobs event=document_generation_pending
```

Realtime을 끄고 복구 폴링만 사용할 때:

```env
DOCUMENT_WORKER_REALTIME_ENABLED=false
DOCUMENT_WORKER_RECOVERY_POLL_SECONDS=300
```

## Python 3.14 의존성

```powershell
py -3.14 -m venv .venv-document-worker
.\.venv-document-worker\Scripts\python.exe -m pip install --upgrade pip
.\.venv-document-worker\Scripts\python.exe -m pip install -r requirements-document-worker.in
```

Worker는 `websockets==16.1.1`을 사용합니다. 이 버전은 Windows Python 3.14용 wheel을 제공합니다. 공식 `realtime` Python 패키지 2.31.0의 필수 범위인 `websockets<16`에는 Windows Python 3.14 wheel이 없어 사용하지 않습니다.

## Migration 적용 확인

SQL Editor에서 다음 파일 전체를 실행합니다.

```text
supabase/migrations/20260719_add_document_worker_realtime_wakeup.sql
```

검증 파일:

```text
supabase/verification/20260719_verify_document_worker_realtime_wakeup.sql
```

핵심 확인 SQL:

```sql
SELECT trigger_name, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'document_generation_jobs'
  AND trigger_name = 'trg_document_generation_pending_wakeup';
```

`INSERT`, `UPDATE` 두 행이 조회되어야 합니다. 작업 테이블의 직접 publication 여부는 `false`가 정상이며 Broadcast가 사용하는 `realtime.messages`가 `supabase_realtime` publication에 포함되어 있어야 합니다.

## Windows 수동 통합 테스트

1. `git pull origin main`을 실행합니다.
2. `py -3.14 -m venv .venv-document-worker`를 실행합니다.
3. `.\.venv-document-worker\Scripts\python.exe -m pip install -r requirements-document-worker.in`을 실행합니다.
4. `.env.local`에 Realtime 환경변수를 설정합니다.
5. SQL Editor에서 Realtime wake-up migration을 실행합니다.
6. 트레이의 `Restart server`를 누르거나 PC를 재부팅합니다.
7. 문서 Worker 로그에서 Realtime 구독 성공을 확인합니다.
8. 웹에서 신규 문서 생성을 요청합니다.
9. 수 초 내 `Realtime 신규 문서 작업 신호 수신`과 `/claim` 실행을 확인합니다.
10. HWPX와 XLSM 결과 및 DB 완료 상태를 확인합니다.
11. 같은 신호가 중복되어도 파일이 한 번만 생성되는지 확인합니다.
12. Realtime 연결을 차단한 상태에서 작업을 등록하고 최대 5분 내 복구 폴링 처리를 확인합니다.
13. 연결 복구 후 다시 수 초 내 실행되는지 확인합니다.

Worker 로그는 `logs/document-worker.log`, 오류 로그는 `logs/document-worker-error.log`에서 확인합니다. 강제 종료된 `PROCESSING` 작업을 자동 재대기시키는 정책은 이번 변경에 포함하지 않았으므로, 문서 생성 중 PC 전원이 꺼진 경우 DB 상태를 운영자가 확인해야 합니다.
