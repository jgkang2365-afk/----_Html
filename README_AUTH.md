# 인증 시스템 설정 가이드

## 개요

간단한 이름 기반 인증 시스템을 사용합니다. Supabase Auth 대신 자체 세션 기반 인증을 사용합니다.

## 데이터베이스 마이그레이션

1. `lib/db/migrations/011_update_users_for_simple_auth.sql` 파일을 Supabase SQL Editor에서 실행합니다.

2. 또는 Supabase 대시보드 > SQL Editor에서 직접 실행:

```sql
-- 1. email 컬럼 제약조건 제거
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- 2. name 컬럼에 UNIQUE 제약조건 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_name_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_name_key UNIQUE (name);
    END IF;
END $$;

-- 3. password_hash 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- 4. 인덱스 재생성
DROP INDEX IF EXISTS idx_users_email;
CREATE INDEX IF NOT EXISTS idx_users_name ON users(name);
```

## 초기 사용자 데이터 생성

초기 사용자 데이터를 생성하려면 다음 스크립트를 실행합니다:

```bash
npm run init-users
```

또는:

```bash
npx tsx scripts/init-users.ts
```

⚠️ **중요**: 초기 사용자는 비밀번호 없이 생성됩니다. 사용자가 최초 로그인 시 비밀번호를 설정합니다.

### 사용자 목록

- **이태환** (사용자)
- **강종구** (관리자) ⭐
- **배윤민** (사용자)
- **고유빈** (사용자)
- **김민영** (사용자)
- **양세경** (사용자)
- **이주형** (사용자)
- **한기문** (사용자)

## 로그인 방법

### 최초 로그인 (비밀번호 설정)
1. 로그인 페이지 접속: `/login`
2. 이름 입력 (예: "강종구")
3. 이름을 입력하면 자동으로 최초 설정 필요 여부를 확인합니다
4. "비밀번호 설정" 화면이 표시되면 비밀번호를 입력합니다
5. "비밀번호 설정 및 로그인" 버튼 클릭
6. 설정한 비밀번호로 자동 로그인됩니다

### 일반 로그인
1. 로그인 페이지 접속: `/login`
2. 이름 입력
3. 비밀번호 입력
4. "로그인" 버튼 클릭

## 비밀번호 변경

로그인 후 다음 API를 사용하여 비밀번호를 변경할 수 있습니다:

```typescript
// POST /api/auth/change-password
{
  "currentPassword": "현재 비밀번호",
  "newPassword": "새 비밀번호"
}
```

## 관리자 비밀번호 리셋

관리자(강종구)만 다른 사용자의 비밀번호를 리셋할 수 있습니다:

```typescript
// POST /api/auth/reset-password
{
  "userName": "사용자 이름",
  "newPassword": "새 비밀번호"
}
```

## 관리자(강종구) 비밀번호 초기화

관리자 비밀번호를 초기화하려면 다음 방법 중 하나를 사용하세요:

### 방법 1: 스크립트 실행 (권장)

```bash
npm run reset-admin-password
```

또는:

```bash
npx tsx scripts/reset-admin-password.ts
```

### 방법 2: SQL 직접 실행

Supabase SQL Editor에서 다음 SQL을 실행:

```sql
-- 관리자(강종구) 비밀번호 초기화
UPDATE users
SET password_hash = NULL,
    updated_at = NOW()
WHERE name = '강종구' AND role = '관리자';
```

### 초기화 후 로그인 방법

1. 로그인 페이지(`/login`)로 이동
2. 이름에 "강종구" 입력
3. 비밀번호 설정 모드가 자동으로 표시됨
4. 비밀번호를 2번 입력하여 설정
5. "비밀번호 설정 및 로그인" 버튼 클릭
6. 설정한 비밀번호로 자동 로그인

## 주요 변경사항

1. **Supabase Auth 제거**: 더 이상 Supabase Auth를 사용하지 않습니다.
2. **세션 관리**: 쿠키 기반 세션 관리 (7일 유지)
3. **비밀번호 해싱**: bcryptjs 사용
4. **이름 기반 로그인**: 이메일 대신 이름으로 로그인

## 환경 변수

`.env.local` 파일에 다음 변수가 설정되어 있어야 합니다:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 문제 해결

### 로그인이 안 될 때

1. 데이터베이스 마이그레이션이 실행되었는지 확인
2. 초기 사용자 데이터가 생성되었는지 확인 (`npm run init-users`)
3. 브라우저 개발자 도구 > Application > Cookies에서 `auth_session` 쿠키 확인

### 비밀번호 리셋이 안 될 때

1. 관리자로 로그인했는지 확인
2. 사용자 이름이 정확한지 확인 (대소문자 구분)
3. 새 비밀번호가 최소 4자 이상인지 확인

## 보안 주의사항

1. **기본 비밀번호 변경 필수**: 초기 비밀번호(`password123`)는 반드시 변경하세요.
2. **HTTPS 사용**: 프로덕션 환경에서는 반드시 HTTPS를 사용하세요.
3. **쿠키 보안**: 프로덕션 환경에서는 쿠키의 `secure` 옵션이 자동으로 활성화됩니다.
