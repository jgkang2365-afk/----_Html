# 환경 변수 설정 가이드

## Supabase 프로젝트 생성

1. [Supabase](https://supabase.com)에 접속하여 계정 생성 (무료)
2. "New Project" 클릭
3. 프로젝트 정보 입력:
   - **Name**: 측정일지 관리 시스템 (또는 원하는 이름)
   - **Database Password**: 강력한 비밀번호 설정 (기억해두세요!)
   - **Region**: 가장 가까운 지역 선택
4. 프로젝트 생성 완료 대기 (약 2분)

## 환경 변수 설정

1. Supabase 대시보드에서 프로젝트 선택
2. **Settings** > **API** 메뉴로 이동
3. 다음 정보를 복사:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** 키 → `SUPABASE_ANON_KEY`
   - **service_role** 키 → `SUPABASE_SERVICE_ROLE_KEY` (주의: 이 키는 서버에서만 사용)

4. 프로젝트 루트에 `.env.local` 파일 생성:

```env
# Supabase 설정
NEXT_PUBLIC_SUPABASE_URL=your_project_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_URL=your_project_url_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

**중요**: 
- `NEXT_PUBLIC_` 접두사가 붙은 변수는 클라이언트 사이드에서 접근 가능합니다.
- `SUPABASE_SERVICE_ROLE_KEY`는 절대 클라이언트에 노출되면 안 됩니다!
- `.env.local` 파일은 Git에 커밋하지 마세요 (이미 .gitignore에 포함됨)

## 연결 테스트

환경 변수를 설정한 후:

1. 개발 서버 재시작:
   ```bash
   npm run dev
   ```

2. 브라우저에서 다음 URL 접속:
   ```
   http://localhost:3000/api/test-db
   ```

3. 성공 응답 예시:
   ```json
   {
     "success": true,
     "message": "데이터베이스 연결 성공"
   }
   ```

## 문제 해결

### "Missing Supabase environment variables" 오류
- `.env.local` 파일이 프로젝트 루트에 있는지 확인
- 환경 변수 이름이 정확한지 확인
- 개발 서버를 재시작했는지 확인

### 연결 실패
- Supabase 프로젝트가 활성화되어 있는지 확인
- 네트워크 연결 확인
- Supabase 대시보드에서 프로젝트 상태 확인

