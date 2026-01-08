# 데이터베이스 마이그레이션 가이드

## 마이그레이션 실행 방법

### Supabase SQL Editor 사용 (권장)

1. [Supabase 대시보드](https://supabase.com/dashboard) 접속
2. 프로젝트 선택
3. 왼쪽 메뉴에서 **SQL Editor** 클릭
4. **New query** 클릭
5. `001_initial_schema.sql` 파일의 내용을 복사하여 붙여넣기
6. **Run** 버튼 클릭 (또는 Ctrl+Enter)
7. 성공 메시지 확인

### 명령줄 사용 (선택적)

Supabase CLI가 설치되어 있다면:

```bash
supabase db push
```

## 마이그레이션 파일 구조

- `001_initial_schema.sql`: 초기 스키마 생성 (모든 테이블, 인덱스, 제약조건)
- 향후 변경사항은 `002_xxx.sql`, `003_xxx.sql` 형식으로 추가

## 생성되는 테이블

1. **business_info** - 사업장정보
2. **measurement_business** - 측정사업장
3. **measurement_journal** - 측정일지 (가장 중요)
4. **preliminary_survey** - 예비조사
5. **measurement_summary** - 측정정보 요약
6. **sync_log** - 동기화 로그
7. **users** - 사용자 (인증용)

## 확인 방법

마이그레이션 실행 후:

1. Supabase 대시보드 > **Table Editor**에서 테이블 목록 확인
2. 각 테이블의 컬럼과 인덱스 확인
3. `http://localhost:3000/api/test-db` 접속하여 연결 테스트

## 문제 해결

### 오류 발생 시

1. SQL Editor에서 오류 메시지 확인
2. 오류가 발생한 부분만 수정하여 다시 실행
3. 이미 생성된 테이블이 있으면 `CREATE TABLE IF NOT EXISTS`로 인해 오류 없이 스킵됨

### 테이블 삭제 후 재생성

```sql
-- 주의: 모든 데이터가 삭제됩니다!
DROP TABLE IF EXISTS measurement_summary CASCADE;
DROP TABLE IF EXISTS preliminary_survey CASCADE;
DROP TABLE IF EXISTS measurement_journal CASCADE;
DROP TABLE IF EXISTS measurement_business CASCADE;
DROP TABLE IF EXISTS business_info CASCADE;
DROP TABLE IF EXISTS sync_log CASCADE;
DROP TABLE IF EXISTS users CASCADE;
```

그 후 마이그레이션 파일을 다시 실행하세요.

