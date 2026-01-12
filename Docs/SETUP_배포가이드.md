# 배포 가이드

## Vercel을 사용한 배포

이 프로젝트는 Vercel을 사용하여 배포할 수 있습니다.

## 배포 전 준비사항

### 1. Git 저장소 설정

프로젝트를 Git 저장소에 푸시합니다:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-repository-url>
git push -u origin main
```

### 2. 환경 변수 준비

배포 시 다음 환경 변수들을 Vercel에 설정해야 합니다:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Vercel 배포 절차

### 방법 1: Vercel 웹 대시보드 사용 (권장)

1. [Vercel](https://vercel.com)에 접속하여 계정 생성 또는 로그인
2. "Add New..." → "Project" 클릭
3. Git 저장소 연결:
   - GitHub, GitLab, 또는 Bitbucket에서 저장소 선택
   - 또는 "Import Git Repository"로 저장소 URL 입력
4. 프로젝트 설정:
   - **Framework Preset**: Next.js (자동 감지)
   - **Root Directory**: `./` (기본값)
   - **Build Command**: `npm run build` (기본값)
   - **Output Directory**: `.next` (기본값)
5. 환경 변수 설정:
   - "Environment Variables" 섹션에서 다음 변수들을 추가:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
   - 각 변수에 Production, Preview, Development 환경을 선택
6. "Deploy" 버튼 클릭
7. 배포 완료 후 제공되는 URL로 접속 확인

### 방법 2: Vercel CLI 사용

1. Vercel CLI 설치:
   ```bash
   npm i -g vercel
   ```

2. 로그인:
   ```bash
   vercel login
   ```

3. 프로젝트 배포:
   ```bash
   vercel
   ```

4. 프로덕션 배포:
   ```bash
   vercel --prod
   ```

## 배포 후 확인사항

### 1. 데이터베이스 마이그레이션

배포된 애플리케이션의 데이터베이스가 최신 스키마를 사용하는지 확인합니다:

1. Supabase 대시보드 → SQL Editor 접속
2. `lib/db/migrations/` 폴더의 모든 마이그레이션 파일을 순서대로 실행
3. 특히 다음 마이그레이션이 최신인지 확인:
   - `011_update_users_for_simple_auth.sql`
   - `012_update_role_term.sql`
   - `014_fix_users_role_check.sql`

### 2. 초기 사용자 설정

배포 후 초기 사용자를 설정합니다:

1. 로컬 환경에서 `.env.local` 파일에 프로덕션 Supabase 정보 설정 (선택사항)
2. 또는 배포된 환경에서 직접 데이터베이스에 접근하여 사용자 생성

**중요**: 초기 사용자 스크립트(`npm run init-users`)는 로컬 환경에서만 실행 가능합니다. 프로덕션 환경에서는 Supabase SQL Editor를 사용하거나 API를 통해 사용자를 생성해야 합니다.

### 3. 기능 테스트

배포된 사이트에서 다음 기능들을 테스트합니다:

- [ ] 로그인 기능
- [ ] 대시보드 조회
- [ ] 측정일지 검색 및 수정
- [ ] 예비조사 입력
- [ ] 매출관리 조회
- [ ] 사용자 관리 (관리자만)

## 환경 변수 관리

### Vercel 대시보드에서 환경 변수 수정

1. Vercel 대시보드 → 프로젝트 선택
2. "Settings" → "Environment Variables" 메뉴
3. 환경 변수 추가/수정/삭제
4. 변경 후 재배포 필요

### 환경 변수 확인

배포된 사이트의 환경 변수가 올바르게 설정되었는지 확인:

- 브라우저 개발자 도구 → Network 탭
- API 요청 헤더 확인
- 또는 `/api/test-db` 엔드포인트 접속하여 확인

## 문제 해결

### 배포 실패

- 빌드 로그 확인: Vercel 대시보드 → Deployments → 실패한 배포 → Build Logs
- 환경 변수 누락 확인
- TypeScript 오류 확인

### 환경 변수 오류

- 변수명 철자 확인 (대소문자 구분)
- `NEXT_PUBLIC_` 접두사 확인
- 값에 따옴표나 공백이 없는지 확인

### 데이터베이스 연결 오류

- Supabase 프로젝트가 활성 상태인지 확인
- 환경 변수 값이 올바른지 확인
- Supabase 대시보드에서 네트워크 접근 제한 확인

## 참고 자료

- [Vercel 공식 문서](https://vercel.com/docs)
- [Next.js 배포 가이드](https://nextjs.org/docs/deployment)
- [Supabase 환경 변수 가이드](https://supabase.com/docs/guides/getting-started/local-development#environment-variables)
