# Storage 동기화 테스트 가이드

## 테스트 환경 선택

### 옵션 1: 배포된 사이트에서 테스트 (권장)

**장점:**
- 실제 프로덕션 환경과 동일한 조건으로 테스트
- Storage 기능이 정상 작동하는지 확인 가능
- 여러 사용자가 동시에 테스트 가능

**접속 방법:**
1. 배포된 사이트 URL 접속 (예: `https://your-project.vercel.app`)
2. 로그인 후 대시보드로 이동
3. 파일 업로드 및 동기화 테스트

**주의사항:**
- 배포 환경에서는 로컬 파일 시스템 fallback이 작동하지 않습니다
- Storage에 파일이 업로드되어 있어야 동기화가 가능합니다

### 옵션 2: 로컬 개발 환경에서 테스트

**개발 서버 실행:**
```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)에 접속하세요.

**환경 변수:**
`.env.local` 파일에 Supabase 설정이 필요합니다.

## 테스트 전 확인사항

### 1. Supabase Storage 설정 확인
- ✅ `excel-files` 버킷 생성 확인
- ✅ SELECT 정책 (파일 읽기) 설정 확인
- ✅ INSERT 정책 (파일 업로드) 설정 확인

### 2. 파일 업로드 테스트

1. **대시보드 접속**
   - 로그인 후 대시보드 페이지로 이동
   - "Excel 파일 업로드" 섹션 확인

2. **파일 업로드**
   - 파일 타입 선택: "사업장정보" 또는 "측정사업장"
   - Excel 파일 선택
   - "파일 업로드" 버튼 클릭
   - 업로드 성공 메시지 확인

3. **Supabase Storage 확인**
   - Supabase 대시보드 → Storage → `excel-files` 버킷
   - `business-info/` 또는 `measurement-business/` 폴더에 파일이 업로드되었는지 확인

### 3. Storage 동기화 테스트

1. **수동 동기화 실행**
   - 대시보드의 "Excel 파일 동기화 상태" 섹션에서
   - "수동 동기화" 버튼 클릭
   - 또는 "사업장정보 동기화", "측정사업장 동기화" 버튼 클릭

2. **동기화 결과 확인**
   - 동기화 성공/실패 메시지 확인
   - 동기화 로그에서 기록 수 확인 (records_processed, records_inserted, records_updated)

3. **데이터베이스 확인**
   - Supabase 대시보드 → Table Editor
   - `business_info` 또는 `measurement_business` 테이블에서 데이터 확인

## 테스트 시나리오

### 시나리오 1: Storage 파일만 있는 경우
1. 로컬 파일 시스템에 Excel 파일이 없는 상태
2. Storage에 파일 업로드
3. 동기화 실행 → Storage 파일 사용

### 시나리오 2: Storage와 로컬 파일 모두 있는 경우
1. Storage에 파일 업로드
2. 로컬 파일 시스템에도 파일 존재
3. 동기화 실행 → Storage 파일 우선 사용

### 시나리오 3: 로컬 파일만 있는 경우 (로컬 개발 환경만 해당)
1. Storage에 파일 없음
2. 로컬 파일 시스템에 파일 존재
3. 동기화 실행 → 로컬 파일 사용
4. **참고**: 배포 환경에서는 로컬 파일 fallback이 작동하지 않습니다

## 문제 해결

### 동기화가 Storage 파일을 사용하지 않는 경우
- Supabase Storage 정책이 올바르게 설정되었는지 확인
- 브라우저 콘솔에서 에러 메시지 확인
- 서버 로그 확인 (Vercel 배포 환경의 경우)

### 파일 업로드는 되지만 동기화가 실패하는 경우
- 파일 형식 확인 (.xls, .xlsx)
- 파일 내용 확인 (필수 컬럼 존재 여부)
- 동기화 로그의 error_message 확인

### 로컬 파일을 사용하는 경우 (로컬 개발 환경만 해당)
- Storage에 파일이 업로드되었는지 확인
- 파일 경로가 명시적으로 지정되지 않았는지 확인
- **로컬 개발 환경에서만** 로컬 파일 fallback이 작동
- **배포 환경에서는 Storage에 파일이 반드시 있어야 함**

## 참고

- Storage에서 파일을 읽는 로직은 `lib/sync/excel-sync.ts`의 `getLatestFileFromStorage` 함수 참고
- 동기화 함수는 Storage 우선, 로컬 파일 fallback 순서로 동작
- 파일 경로가 명시적으로 지정된 경우 해당 경로의 파일 사용
