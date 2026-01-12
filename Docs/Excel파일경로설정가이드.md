# Excel 파일 경로 설정 가이드

## Excel 파일 경로 변경

Excel 파일 동기화 경로를 `Z:\data\측정팀\자동화 툴\MES 프로그램 DB` 폴더로 변경했습니다.

## 경로 설정 방법

### 방법 1: 기본 경로 사용 (현재 설정)

코드에 기본 경로가 하드코딩되어 있습니다:
```
Z:\data\측정팀\자동화 툴\MES 프로그램 DB
```

이 경로에서 다음 파일들을 찾습니다:
- `사업장정보.xlsx` 또는 `사업장정보.xls`
- `측정사업장.xlsx` 또는 `측정사업장.xls`

### 방법 2: 환경 변수로 경로 지정 (선택사항)

다른 경로를 사용하려면 `.env.local` 파일에 환경 변수를 추가할 수 있습니다:

```env
EXCEL_FILE_PATH=Z:\data\측정팀\자동화 툴\MES 프로그램 DB
```

또는 다른 경로:
```env
EXCEL_FILE_PATH=D:\ExcelFiles
```

## 파일 위치

Excel 파일들은 다음 위치에 있어야 합니다:

```
Z:\data\측정팀\자동화 툴\MES 프로그램 DB\
  ├── 사업장정보.xlsx (또는 .xls)
  └── 측정사업장.xlsx (또는 .xls)
```

## 주의사항

### 1. 네트워크 드라이브 접근

`Z:` 드라이브가 네트워크 드라이브인 경우:
- 로컬 개발 환경에서 실행할 때 Z: 드라이브에 접근할 수 있어야 합니다
- 네트워크 연결이 끊어지면 파일을 읽을 수 없습니다

### 2. Vercel 배포 환경 제한

**중요:** Vercel 배포 환경에서는:
- 네트워크 드라이브(Z:)에 접근할 수 없습니다
- 로컬 파일 시스템에 접근할 수 없습니다
- 서버리스 환경이므로 파일 시스템 접근이 제한됩니다

**해결 방법:**
- 로컬 개발 환경에서만 사용
- 또는 파일 업로드 기능 구현 (Supabase Storage 등)

### 3. 파일 접근 권한

프로그램이 실행되는 계정이 다음 경로에 읽기 권한이 있어야 합니다:
```
Z:\data\측정팀\자동화 툴\MES 프로그램 DB
```

## 테스트 방법

1. **파일 경로 확인:**
   - 파일 탐색기에서 `Z:\data\측정팀\자동화 툴\MES 프로그램 DB` 경로 접근 확인
   - `사업장정보.xlsx`, `측정사업장.xlsx` 파일 존재 확인

2. **로컬 개발 환경에서 테스트:**
   ```bash
   npm run dev
   ```
   - 대시보드 → "수동 동기화" 버튼 클릭
   - 동기화 성공 여부 확인

3. **오류 발생 시:**
   - 파일 경로가 올바른지 확인
   - 파일 접근 권한 확인
   - 파일명이 정확한지 확인 (공백, 대소문자 주의)

## 환경 변수 설정 예시

`.env.local` 파일 예시:

```env
# Supabase 설정
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Excel 파일 경로 (선택사항, 기본값: Z:\data\측정팀\자동화 툴\MES 프로그램 DB)
EXCEL_FILE_PATH=Z:\data\측정팀\자동화 툴\MES 프로그램 DB
```

## 변경 사항 요약

- ✅ Excel 파일 경로를 `Z:\data\측정팀\자동화 툴\MES 프로그램 DB`로 변경
- ✅ 환경 변수 `EXCEL_FILE_PATH`로 경로 커스터마이징 가능
- ⚠️ Vercel 배포 환경에서는 작동하지 않음 (로컬 개발 환경에서만 사용)
