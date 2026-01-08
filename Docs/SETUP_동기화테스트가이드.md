# Excel 동기화 테스트 가이드

## 빠른 테스트 (로그인 없이)

개발 환경에서 로그인 없이 동기화를 테스트할 수 있는 전용 엔드포인트를 제공합니다.

### 1. 터미널에서 직접 테스트

#### 모든 파일 동기화
```bash
curl -X POST http://localhost:3000/api/test-sync
```

#### 사업장정보만 동기화
```bash
curl -X POST "http://localhost:3000/api/test-sync?type=business-info"
```

#### 측정사업장만 동기화
```bash
curl -X POST "http://localhost:3000/api/test-sync?type=measurement-business"
```

#### 동기화 로그 조회
```bash
curl http://localhost:3000/api/test-sync
```

### 2. 브라우저에서 테스트

브라우저 주소창에 직접 입력:
```
http://localhost:3000/api/test-sync
```

또는 개발자 도구 콘솔에서:
```javascript
// 모든 파일 동기화
fetch('/api/test-sync', { method: 'POST' })
  .then(res => res.json())
  .then(data => console.log(data));

// 동기화 로그 조회
fetch('/api/test-sync')
  .then(res => res.json())
  .then(data => console.log(data));
```

## 정상적인 사용 (로그인 필요)

### 1. 로그인 계정 생성

Supabase 대시보드에서 사용자를 생성해야 합니다:

1. Supabase 대시보드 접속
2. **Authentication** → **Users** 메뉴 클릭
3. **Add user** → **Create new user** 클릭
4. 이메일과 비밀번호 입력
5. **Auto Confirm User** 체크 (이메일 인증 없이 바로 사용 가능)
6. **Create user** 클릭

### 2. users 테이블에 사용자 정보 추가

Supabase SQL Editor에서 실행:

```sql
-- 사용자 정보 추가 (이메일은 위에서 생성한 사용자와 동일해야 함)
INSERT INTO users (email, name, role)
VALUES ('your-email@example.com', '사용자 이름', '측정팀 직원')
ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role;
```

또는 관리자로 설정:
```sql
INSERT INTO users (email, name, role)
VALUES ('admin@example.com', '관리자', '관리자')
ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role;
```

### 3. 로그인 후 대시보드에서 동기화

1. 브라우저에서 `/login` 접속
2. 생성한 계정으로 로그인
3. `/dashboard` 접속
4. "수동 동기화" 버튼 클릭

## 문제 해결

### "이 엔드포인트는 개발 환경에서만 사용할 수 있습니다" 오류

**원인**: 프로덕션 환경에서 테스트 엔드포인트 접근 시도

**해결**: 개발 환경(`npm run dev`)에서만 사용 가능합니다.

### "Excel 파일을 찾을 수 없습니다" 오류

**원인**: 프로젝트 루트에 Excel 파일이 없음

**해결**:
1. 프로젝트 루트 디렉토리에 다음 파일이 있는지 확인:
   - `사업장정보.xlsx` (또는 `사업장정보.xls`)
   - `측정사업장.xlsx` (또는 `측정사업장.xls`)
2. 파일이 다른 위치에 있다면, `lib/sync/excel-sync.ts`에서 파일 경로를 수정

### "Invalid login credentials" 오류

**원인**: Supabase에 사용자가 없거나 비밀번호가 잘못됨

**해결**:
1. Supabase 대시보드에서 사용자 생성 확인
2. 이메일과 비밀번호가 정확한지 확인
3. `users` 테이블에 사용자 정보가 추가되었는지 확인

### 동기화는 성공했지만 데이터가 보이지 않음

**원인**: 데이터베이스 조회 권한 문제

**해결**:
1. Supabase 대시보드 > **Table Editor**에서 데이터 확인
2. `business_info` 및 `measurement_business` 테이블 확인
3. `sync_log` 테이블에서 동기화 로그 확인

## 테스트 체크리스트

- [ ] Excel 파일이 프로젝트 루트에 있음
- [ ] 개발 서버 실행 중 (`npm run dev`)
- [ ] 테스트 엔드포인트 호출 성공
- [ ] 동기화 로그에 "성공" 상태 기록됨
- [ ] 데이터베이스에 데이터 저장됨
- [ ] (선택) 로그인 후 대시보드에서 동기화 상태 확인

