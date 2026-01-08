# 인증 시스템 테스트 가이드

## 1. Supabase 대시보드 접속

### 1.1 Supabase 로그인
1. [Supabase 대시보드](https://supabase.com/dashboard) 접속
2. GitHub 또는 이메일로 로그인 (이미 로그인되어 있으면 스킵)

### 1.2 프로젝트 선택
1. 대시보드에서 측정일지 관리 시스템 프로젝트 선택
2. 프로젝트 대시보드가 열립니다

## 2. Authentication 메뉴 찾기

### 2.1 왼쪽 사이드바에서 찾기
1. 화면 왼쪽에 **사이드바 메뉴**가 있습니다
2. 아래쪽으로 스크롤하면 **"Authentication"** 메뉴가 보입니다
3. **Authentication** 클릭

### 2.2 Authentication 메뉴 구조
Authentication을 클릭하면 하위 메뉴가 나타납니다:
- **Overview**: 인증 개요
- **Users**: 사용자 관리 ← **여기입니다!**
- **Policies**: 정책 관리
- **Providers**: 인증 제공자 설정
- **URL Configuration**: URL 설정
- **Email Templates**: 이메일 템플릿

## 3. Email 인증 활성화

### 3.1 Email 제공자 활성화
1. 왼쪽 사이드바에서 **Authentication** > **Providers** 클릭
2. **Email** 항목 찾기
3. **Email** 토글이 꺼져 있으면 켜기 (Enable)
4. 저장 (보통 자동으로 저장됨)

**참고**: 기본적으로 Email은 활성화되어 있을 가능성이 높습니다.

## 4. 테스트 사용자 계정 생성

### 방법 1: Supabase 대시보드에서 직접 생성 (권장)

1. 왼쪽 사이드바에서 **Authentication** > **Users** 클릭
2. 페이지 상단 오른쪽에 **"Add user"** 또는 **"Create user"** 버튼이 있습니다
3. 버튼 클릭
4. 모달 창이 나타나면 다음 정보 입력:
   - **Email**: `test@example.com` (또는 원하는 이메일)
   - **Password**: `test1234` (또는 원하는 비밀번호)
   - **Auto Confirm User**: ✅ 체크 (이메일 인증 없이 바로 사용 가능)
5. **"Create user"** 또는 **"Add user"** 버튼 클릭
6. 사용자 목록에 새 사용자가 추가된 것을 확인

### 방법 2: SQL Editor에서 사용자 생성 (고급, 비권장)

SQL을 직접 실행하는 방법입니다. 방법 1이 더 간단하므로 방법 1을 권장합니다.

## 5. users 테이블에 정보 추가 (선택사항)

Supabase Auth에서 사용자를 만들었으면, `public.users` 테이블에도 정보를 추가하는 것이 좋습니다.

1. 왼쪽 사이드바에서 **SQL Editor** 클릭
2. **New query** 클릭
3. 다음 SQL 코드 입력:

```sql
-- users 테이블에 사용자 정보 추가
INSERT INTO public.users (email, name, role)
VALUES ('test@example.com', '테스트 사용자', '측정팀 직원')
ON CONFLICT (email) DO UPDATE
SET name = EXCLUDED.name,
    role = EXCLUDED.role;
```

4. **Run** 버튼 클릭 (또는 Ctrl+Enter)
5. 성공 메시지 확인

**참고**: 이 단계를 건너뛰어도 로그인은 가능하지만, 사용자 이름이 이메일 주소의 @ 앞부분으로 표시됩니다.

## 6. 애플리케이션에서 테스트

### 6.1 개발 서버 실행
터미널에서:
```bash
npm run dev
```

### 6.2 로그인 페이지 접속
브라우저에서 다음 URL 접속:
```
http://localhost:3001/login
```
(또는 개발 서버가 실행 중인 포트, 보통 3000 또는 3001)

### 6.3 로그인 테스트
1. 로그인 페이지가 표시되는지 확인
2. 이메일 입력 (예: `test@example.com`)
3. 비밀번호 입력 (예: `test1234`)
4. **"로그인"** 버튼 클릭
5. 성공하면 `/dashboard`로 자동 이동

### 6.4 로그인 상태 확인
1. 대시보드 페이지가 표시되는지 확인
2. 헤더 오른쪽에 사용자 이름과 이메일이 표시되는지 확인
3. **"로그아웃"** 버튼이 보이는지 확인

### 6.5 로그아웃 테스트
1. 헤더의 **"로그아웃"** 버튼 클릭
2. 로그인 페이지로 리다이렉트되는지 확인
3. 다시 로그인하지 않고 대시보드에 접근할 수 없는지 확인

## 7. 문제 해결

### "Invalid login credentials" 오류
**원인**: 이메일 또는 비밀번호가 잘못됨

**해결 방법**:
1. Supabase 대시보드 > Authentication > Users에서 사용자가 있는지 확인
2. 사용자의 이메일 주소를 정확히 입력했는지 확인
3. 비밀번호를 정확히 입력했는지 확인
4. 필요하면 Supabase 대시보드에서 사용자 비밀번호 재설정

### "Email not confirmed" 오류
**원인**: 이메일 인증이 완료되지 않음

**해결 방법**:
1. Supabase 대시보드 > Authentication > Users로 이동
2. 해당 사용자를 찾아 클릭
3. **"Confirm email"** 버튼 클릭
4. 또는 사용자 생성 시 **"Auto Confirm User"** 옵션을 체크했는지 확인

### 세션이 유지되지 않는 경우
**원인**: 브라우저 쿠키 문제

**해결 방법**:
1. 브라우저 개발자 도구 열기 (F12)
2. **Application** 탭 (Chrome) 또는 **Storage** 탭 (Firefox) 클릭
3. 왼쪽 메뉴에서 **Cookies** > `http://localhost:3001` 선택
4. `sb-`로 시작하는 쿠키가 있는지 확인
5. 쿠키가 없다면:
   - 브라우저의 쿠키 차단 설정 확인
   - 시크릿/프라이빗 모드가 아닌지 확인
   - 브라우저 캐시 삭제 후 재시도

### CORS 오류
**원인**: 환경 변수 설정 문제

**해결 방법**:
1. `.env.local` 파일 확인
2. `NEXT_PUBLIC_SUPABASE_URL`이 올바른지 확인
3. Supabase 대시보드 > Settings > API에서 Project URL 복사
4. `.env.local` 파일의 URL과 비교
5. 개발 서버 재시작

### "Missing Supabase environment variables" 오류
**원인**: 환경 변수가 설정되지 않음

**해결 방법**:
1. 프로젝트 루트에 `.env.local` 파일이 있는지 확인
2. 파일 내용 확인:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```
3. Supabase 대시보드 > Settings > API에서 값 복사
4. 개발 서버 재시작 (중요!)

## 8. 테스트 체크리스트

다음 항목들을 확인하세요:

- [ ] Supabase 대시보드에 로그인했음
- [ ] 프로젝트를 선택했음
- [ ] Authentication > Providers에서 Email이 활성화되어 있음
- [ ] Authentication > Users에서 테스트 사용자를 생성했음
- [ ] users 테이블에 사용자 정보를 추가했음 (선택사항)
- [ ] 개발 서버가 실행 중임
- [ ] 로그인 페이지(`/login`)에 접속할 수 있음
- [ ] 로그인 폼이 정상적으로 표시됨
- [ ] 로그인 시도 시 오류가 발생하지 않음
- [ ] 로그인 성공 시 대시보드로 이동함
- [ ] 헤더에 사용자 정보가 표시됨
- [ ] 로그아웃 버튼이 작동함
- [ ] 로그아웃 후 다시 로그인하지 않으면 접근할 수 없음

## 9. 다음 단계

인증 시스템이 정상적으로 작동하면:
- M2-T2: 권한 관리 시스템 구현
- 또는 M3: 핵심 기능 개발 시작
