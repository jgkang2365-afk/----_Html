# Windows 신규 사업장 문서 Worker 운영 절차

## 1. 운영 Supabase 적용

1. SQL Editor에서 `supabase/migrations/20260719_add_new_business_document_generation.sql`을 실행합니다.
2. `supabase/verification/20260719_verify_new_business_document_generation.sql`을 실행합니다.
3. `document-templates` bucket이 private인지 확인합니다.

## 2. 환경변수

깡통컴 `.env.local`에 다음 값을 설정합니다.

```env
DOCUMENT_WORKER_TOKEN=충분히_긴_임의의_비밀값
DOCUMENT_WORKER_API_URL=http://localhost:3000
DOCUMENT_OUTPUT_ROOT=Z:\data\측정팀\측정보고서
DOCUMENT_WORKER_POLL_SECONDS=5
```

Vercel에도 동일한 `DOCUMENT_WORKER_TOKEN`을 등록해야 Vercel API를 직접 사용할 수 있습니다.
로컬 Next 서버 API를 사용하는 현재 깡통컴 구성에서는 `DOCUMENT_WORKER_API_URL=http://localhost:3000`을 사용합니다.

## 3. Python 준비

관리자 PowerShell에서 프로젝트 폴더로 이동한 뒤 실행합니다.

```powershell
python -m pip install -r requirements-document-worker.in
```

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
