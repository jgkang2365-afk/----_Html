# 배포 진행 안내

## 현재 상태
- ✅ Vercel CLI 설치 완료
- ✅ Vercel 로그인 완료
- ⚠️ 환경 변수 설정 필요

## 배포 방법

### 옵션 1: Vercel 웹 대시보드 사용 (권장)

1. [Vercel 대시보드](https://vercel.com/dashboard) 접속
2. "Add New..." → "Project" 클릭
3. Git 저장소 연결 (GitHub/GitLab/Bitbucket)
4. 프로젝트 설정에서 환경 변수 추가:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_URL=your_supabase_url
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   ```
5. "Deploy" 클릭

### 옵션 2: Vercel CLI로 환경 변수 설정 후 배포

```bash
# 환경 변수 추가 (각각 실행)
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production

# 배포 실행
vercel --prod
```

## 환경 변수 값 확인

로컬 `.env.local` 파일에서 다음 값들을 확인하세요:
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

## 배포 후 작업

1. Supabase 대시보드에서 마이그레이션 실행
2. 배포된 사이트에서 로그인 테스트
3. 기능 테스트
