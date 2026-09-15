# Local Supabase 운영 데이터 복제

## 목적

개발 서버는 Production DB에 직접 연결하지 않는다.
실제 업무 데이터가 필요한 개발/검증은 Production을 READ_ONLY로 조회해 Docker Local Supabase에 복제한 뒤 로컬에서 수행한다.

기본 흐름:

`Production READ_ONLY → Docker Local Supabase → localhost 개발서버`

## 안전 경계

- Production source는 프로젝트 ref `xjxqbwvcgffunqnkmoqw`만 허용한다.
- Production 조회 코드는 `select`만 사용한다.
- Local import 대상 PostgreSQL은 `localhost` 또는 `127.0.0.1`만 허용한다.
- `password`, `token`, `secret`, `api_key` 계열 컬럼은 복제 시 NULL 처리한다.
- 자동화/작업 큐(`automation_jobs`, `background_jobs`, `mes_sync_queue`, `k2b_sync_state` 등)는 복제하지 않는다.
- Production snapshot 파일은 디스크에 저장하지 않고 메모리에서 Local DB로 전달한다.

## 최초 1회

Production 조회용 값은 Git에 포함하지 않는 `.env.production-readonly.local`에 둔다.
이 파일은 Next.js가 자동 로드하지 않으며 snapshot 스크립트에서만 명시적으로 읽는다.
## 실행

Docker Local Supabase가 준비된 개발 PC에서:

1. `npm run db:local:bootstrap-prod`
2. 개발 서버 재시작: `npm run dev:turbo`

`db:local:bootstrap-prod`는 다음 순서로 실행한다.

1. Local Supabase schema/seed reset
2. Supabase CLI가 발급한 Local URL/anon/service-role/DB URL을 `.env.local`에 반영
3. Production 업무 데이터를 READ_ONLY로 조회
4. Local 업무 테이블의 synthetic fixture를 실제 snapshot으로 교체
5. `TEST_USER_NAME` / `TEST_USER_PASSWORD`가 있으면 해당 운영 사용자 프로필에 로컬 로그인 암호만 새로 설정
6. 테이블별 row count 일치 확인

## 데이터 갱신

운영 데이터가 바뀌어 다시 가져올 때도 동일하게:

`npm run db:local:bootstrap-prod`

을 실행한다. Production에는 write하지 않는다.

## 금지

- `.env.local`을 Production Supabase에 연결한 상태로 개발 write 검증
- `.env.production-readonly.local`을 Git에 commit
- Production snapshot 데이터를 파일로 commit
- Local DB의 자동화 큐를 Production과 동기화
