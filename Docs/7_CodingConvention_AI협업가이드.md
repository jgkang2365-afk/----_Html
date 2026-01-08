# Coding Convention & AI Collaboration Guide (코딩 컨벤션 및 AI 협업 가이드)

**프로젝트명**: 측정일지 관리 시스템  
**버전**: v1.0  
**작성일**: 2025-01-27

---

## 1. 핵심 원칙

### 1.1 "신뢰하되, 검증하라" 원칙

- AI가 생성한 코드는 항상 검토하고 테스트해야 합니다.
- 자동 생성된 코드의 로직을 이해하고, 필요 시 수정하세요.
- 특히 비즈니스 로직(번호 부여, 데이터 검증 등)은 반드시 검증하세요.

### 1.2 코드 품질 우선

- 작동하는 코드보다 올바른 코드를 작성하세요.
- 단기적 해결책보다 장기적 유지보수를 고려하세요.
- 코드 리뷰를 통해 품질을 유지하세요.

---

## 2. 프로젝트 설정 및 기술 스택

### 2.1 기술 스택 버전

**프론트엔드**:
- Next.js: 14.0.0 이상 (App Router 사용)
- React: 18.2.0 이상
- TypeScript: 5.0.0 이상
- Tailwind CSS: 3.3.0 이상

**백엔드**:
- Next.js API Routes (프론트엔드와 통합)
- Python 3.11+ (Excel 처리용, 선택적)

**데이터베이스**:
- PostgreSQL 15+ (Supabase)
- Prisma 또는 Supabase Client (ORM/쿼리 빌더)

**도구**:
- ESLint: 8.0.0 이상
- Prettier: 3.0.0 이상
- Git: 버전 관리

### 2.2 버전 관리 원칙

- **의존성 버전 고정**: package.json에 정확한 버전 명시 (^ 사용 최소화)
- **주요 업데이트 전 검토**: Breaking change가 있는 업데이트는 신중하게 검토
- **Changelog 유지**: 주요 변경사항을 기록

---

## 3. 아키텍처 및 모듈성

### 3.1 폴더 구조

```
/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes
│   │   ├── auth/          # 인증 관련 API
│   │   ├── journal/       # 측정일지 API
│   │   ├── survey/        # 예비조사 API
│   │   ├── dashboard/     # 대시보드 API
│   │   ├── sales/         # 매출관리 API
│   │   └── sync/          # Excel 동기화 API
│   ├── dashboard/         # 대시보드 페이지
│   ├── journal/           # 측정일지 페이지
│   ├── survey/            # 예비조사 페이지
│   ├── summary/           # 측정정보 요약 페이지
│   ├── sales/             # 매출관리 페이지
│   ├── login/             # 로그인 페이지
│   ├── layout.tsx         # 루트 레이아웃
│   └── page.tsx           # 홈 페이지
├── components/            # 재사용 가능한 컴포넌트
│   ├── ui/                # 기본 UI 컴포넌트
│   ├── layout/            # 레이아웃 컴포넌트
│   └── features/          # 기능별 컴포넌트
├── lib/                   # 유틸리티 함수
│   ├── db/               # 데이터베이스 관련
│   ├── utils/            # 일반 유틸리티
│   │   ├── number-assignment.ts  # 번호 부여 로직
│   │   └── date-utils.ts         # 날짜 유틸리티
│   └── sync/             # Excel 동기화
├── types/                 # TypeScript 타입 정의
├── hooks/                 # 커스텀 훅
├── styles/                # 전역 스타일
└── public/                # 정적 파일
```

### 3.2 컴포넌트 분리 원칙

- **단일 책임 원칙**: 각 컴포넌트는 하나의 책임만 가져야 함
- **재사용성**: 공통 기능은 컴포넌트로 분리
- **컴포넌트 크기**: 한 파일당 300줄 이하 권장
- **네이밍**: 
  - 컴포넌트: PascalCase (예: `MeasurementJournalForm`)
  - 파일명: 컴포넌트명과 동일 (예: `MeasurementJournalForm.tsx`)

### 3.3 파일 네이밍 규칙

- **컴포넌트**: PascalCase (예: `UserProfile.tsx`)
- **유틸리티 함수**: camelCase (예: `formatDate.ts`)
- **타입 정의**: PascalCase (예: `MeasurementJournal.ts`)
- **상수**: UPPER_SNAKE_CASE (예: `MAX_RETRY_COUNT.ts`)
- **API Routes**: kebab-case (예: `app/api/journal/[id]/route.ts`)

---

## 4. AI 소통 원칙 (프롬프트 엔지니어링)

### 4.1 효과적인 지시 방법

#### 좋은 예시:
```
"측정일지 검색 기능을 구현해주세요. 
- 검색 조건: 측정년도, 측정주기, 사업장명, 지정한계_관할지청, 주소
- 검색 결과는 최신 자료 우선 정렬
- '*번외*' 포함 사업장은 제외
- 참조: Docs/3_UserFlow_사용자흐름도.md 섹션 3"
```

#### 나쁜 예시:
```
"검색 기능 만들어줘"
```

### 4.2 컨텍스트 제공

- 관련 문서 참조 (PRD, TRD, User Flow 등)
- 기존 코드 스니펫 제공
- 비즈니스 로직 설명
- 예상되는 에지 케이스 언급

### 4.3 단계별 요청

- 큰 기능을 작은 단위로 나누어 요청
- 각 단계가 완료된 후 다음 단계로 진행
- 중간 결과를 검토하고 피드백 제공

### 4.4 코드 리뷰 요청

```
"생성된 코드를 리뷰해주세요. 
특히 다음 사항을 확인해주세요:
1. 성능 최적화 여부
2. 에러 처리 완전성
3. 타입 안정성
4. 접근성 준수"
```

---

## 5. 코드 품질 및 보안

### 5.1 TypeScript 사용 규칙

- **엄격 모드 사용**: `tsconfig.json`에서 `strict: true`
- **any 타입 금지**: 가능한 한 구체적인 타입 사용
- **타입 정의**: 모든 함수의 매개변수와 반환값에 타입 명시
- **인터페이스 우선**: 타입 별칭보다 인터페이스 사용 (확장 가능성)

**예시**:
```typescript
// 좋은 예시
interface MeasurementJournal {
  id: number;
  code: string;
  measurementYear: number;
  measurementPeriod: '상반기' | '하반기';
}

// 나쁜 예시
const journal: any = { ... };
```

### 5.2 에러 처리

- **모든 비동기 작업에 try-catch 사용**
- **사용자 친화적인 에러 메시지 제공**
- **에러 로깅**: 서버 사이드 에러는 로그에 기록

**예시**:
```typescript
// 좋은 예시
try {
  const result = await updateJournal(id, data);
  return { success: true, data: result };
} catch (error) {
  console.error('Failed to update journal:', error);
  return { 
    success: false, 
    error: '측정일지 업데이트에 실패했습니다. 다시 시도해주세요.' 
  };
}

// 나쁜 예시
const result = await updateJournal(id, data); // 에러 처리 없음
```

### 5.3 보안 체크리스트

- ✅ **SQL Injection 방지**: 파라미터화된 쿼리 또는 ORM 사용
- ✅ **XSS 방지**: 사용자 입력 Sanitization
- ✅ **CSRF 보호**: Next.js 기본 CSRF 보호 활용
- ✅ **인증/권한 체크**: 모든 보호된 API에 인증 및 권한 체크
- ✅ **환경 변수**: 민감한 정보는 환경 변수로 관리
- ✅ **입력 검증**: 모든 사용자 입력 검증
- ✅ **비밀번호**: 해시 처리 (bcrypt 등)

### 5.4 환경 변수 관리

- **.env.local**: 로컬 개발용 (Git에 커밋하지 않음)
- **.env.example**: 환경 변수 템플릿 (Git에 커밋)
- **Vercel 환경 변수**: 프로덕션 환경 변수 설정

**예시**:
```typescript
// .env.local
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
SUPABASE_SERVICE_ROLE_KEY=xxx

// .env.example
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## 6. 코드 스타일 가이드

### 6.1 일반 규칙

- **들여쓰기**: 2 spaces (탭 사용 금지)
- **줄 길이**: 최대 100자
- **세미콜론**: 사용 (ESLint 규칙 준수)
- **따옴표**: 작은따옴표 사용 (Prettier 설정)

### 6.2 변수 및 함수 네이밍

- **변수/함수**: camelCase
- **상수**: UPPER_SNAKE_CASE
- **컴포넌트**: PascalCase
- **파일명**: 컴포넌트는 PascalCase, 유틸리티는 camelCase

**예시**:
```typescript
// 변수
const measurementYear = 2024;
const totalCount = 100;

// 함수
function calculateRevenue(year: number): number {
  // ...
}

// 상수
const MAX_RETRY_COUNT = 3;
const DEFAULT_PAGE_SIZE = 20;

// 컴포넌트
function MeasurementJournalForm() {
  // ...
}
```

### 6.3 주석 규칙

- **함수 주석**: JSDoc 형식 사용
- **복잡한 로직**: 인라인 주석으로 설명
- **TODO 주석**: 향후 개선 사항 표시

**예시**:
```typescript
/**
 * 측정일지의 공문연번을 자동으로 부여합니다.
 * 
 * @param designatedOffice - 지정한계_관할지청
 * @param measurementYear - 측정년도
 * @returns 공문연번 (예: "천-001")
 */
async function assignDocumentNumber(
  designatedOffice: string,
  measurementYear: number
): Promise<string> {
  // 마지막 공문연번 조회
  const lastNumber = await getLastDocumentNumber(designatedOffice);
  
  // 번호 증가 (001, 002, 003...)
  const nextNumber = incrementNumber(lastNumber);
  
  return formatDocumentNumber(designatedOffice, nextNumber);
}
```

### 6.4 React 컴포넌트 규칙

- **함수 컴포넌트 사용**: 클래스 컴포넌트 사용 금지
- **Hooks 사용**: useState, useEffect 등
- **Props 타입 정의**: 인터페이스로 명시

**예시**:
```typescript
interface MeasurementJournalFormProps {
  journalId?: number;
  onSave: (data: MeasurementJournal) => void;
  onCancel: () => void;
}

export function MeasurementJournalForm({
  journalId,
  onSave,
  onCancel,
}: MeasurementJournalFormProps) {
  const [formData, setFormData] = useState<MeasurementJournal | null>(null);
  
  // ...
}
```

---

## 7. 테스트 및 디버깅

### 7.1 테스트 전략

- **단위 테스트**: 유틸리티 함수, 비즈니스 로직
- **통합 테스트**: API 엔드포인트, 데이터베이스 연동
- **E2E 테스트**: 주요 사용자 시나리오 (선택적)

### 7.2 디버깅 워크플로우

1. **문제 재현**: 문제를 재현할 수 있는 최소한의 시나리오 작성
2. **로그 확인**: 브라우저 콘솔, 서버 로그 확인
3. **단계별 디버깅**: console.log 또는 디버거 사용
4. **가설 검증**: 문제 원인에 대한 가설을 세우고 검증
5. **수정 및 테스트**: 수정 후 반드시 테스트

### 7.3 로깅 규칙

- **개발 환경**: 상세한 로그 출력
- **프로덕션 환경**: 에러 로그만 출력
- **로그 레벨**: 
  - `console.log`: 개발용 디버깅
  - `console.warn`: 경고 메시지
  - `console.error`: 에러 메시지 (프로덕션에서도 출력)

**예시**:
```typescript
if (process.env.NODE_ENV === 'development') {
  console.log('Debug info:', data);
}

console.error('Error occurred:', error);
```

---

## 8. 성능 최적화

### 8.1 데이터베이스 쿼리 최적화

- **인덱스 활용**: 자주 검색되는 컬럼에 인덱스 생성
- **필요한 컬럼만 SELECT**: `SELECT *` 사용 금지
- **JOIN 최적화**: 필요한 테이블만 JOIN
- **페이징**: 대량 데이터 조회 시 LIMIT/OFFSET 사용

### 8.2 React 최적화

- **메모이제이션**: useMemo, useCallback 적절히 사용
- **코드 스플리팅**: 동적 import 사용
- **이미지 최적화**: Next.js Image 컴포넌트 사용
- **불필요한 리렌더링 방지**: React.memo 사용

### 8.3 API 최적화

- **캐싱**: 자주 조회되는 데이터는 캐싱
- **배치 처리**: 여러 요청을 하나로 묶기
- **응답 크기 최적화**: 필요한 데이터만 반환

---

## 9. Git 워크플로우

### 9.1 브랜치 전략

- **main**: 프로덕션 배포용
- **develop**: 개발 통합 브랜치
- **feature/**: 기능 개발 브랜치 (예: `feature/journal-search`)
- **fix/**: 버그 수정 브랜치 (예: `fix/number-assignment`)

### 9.2 커밋 메시지 규칙

**형식**: `[타입] 간단한 설명`

**타입**:
- `feat`: 새로운 기능
- `fix`: 버그 수정
- `docs`: 문서 수정
- `style`: 코드 스타일 변경 (포맷팅 등)
- `refactor`: 코드 리팩토링
- `test`: 테스트 추가/수정
- `chore`: 빌드 설정, 의존성 등

**예시**:
```
feat: 측정일지 검색 기능 구현
fix: 공문연번 자동 부여 로직 수정
docs: README 업데이트
refactor: 번호 부여 함수 리팩토링
```

### 9.3 Pull Request 규칙

- **제목**: 명확하고 간결하게
- **설명**: 
  - 변경 사항 요약
  - 관련 이슈/태스크 번호
  - 테스트 방법
- **코드 리뷰**: 최소 1명 이상의 리뷰 후 머지

---

## 10. 문서화

### 10.1 코드 문서화

- **주요 함수**: JSDoc 주석 작성
- **복잡한 로직**: 인라인 주석으로 설명
- **API 엔드포인트**: 요청/응답 형식 문서화

### 10.2 README 작성

- 프로젝트 개요
- 설치 및 실행 방법
- 환경 변수 설정
- 주요 기능 설명
- 개발 가이드

### 10.3 변경 이력 유지

- 주요 변경사항을 CHANGELOG.md에 기록
- 버전 번호 관리 (Semantic Versioning)

---

## 11. AI 협업 시 주의사항

### 11.1 코드 생성 요청 시

- ✅ 구체적인 요구사항 제공
- ✅ 관련 문서 참조
- ✅ 예상되는 에지 케이스 언급
- ✅ 기존 코드 스타일 준수 요청

### 11.2 코드 리뷰 요청 시

- ✅ 특정 관점 요청 (성능, 보안, 접근성 등)
- ✅ 잠재적 문제점 확인 요청
- ✅ 개선 제안 요청

### 11.3 버그 수정 요청 시

- ✅ 문제 재현 방법 제공
- ✅ 에러 메시지 및 로그 제공
- ✅ 예상되는 원인 가설 제시

### 11.4 리팩토링 요청 시

- ✅ 리팩토링 목적 명시
- ✅ 기존 코드의 문제점 설명
- ✅ 개선 방향 제시

---

## 12. 체크리스트

### 12.1 코드 작성 전

- [ ] 요구사항 명확히 이해
- [ ] 관련 문서 확인 (PRD, TRD, User Flow 등)
- [ ] 기존 코드 스타일 확인
- [ ] 필요한 타입 정의 확인

### 12.2 코드 작성 중

- [ ] TypeScript 타입 명시
- [ ] 에러 처리 구현
- [ ] 입력 검증 구현
- [ ] 주석 작성 (복잡한 로직)

### 12.3 코드 작성 후

- [ ] 코드 스타일 확인 (Prettier, ESLint)
- [ ] 타입 체크 통과
- [ ] 기능 테스트
- [ ] 에러 케이스 테스트
- [ ] 성능 확인 (필요 시)

### 12.4 커밋 전

- [ ] 불필요한 코드 제거
- [ ] 주석 정리
- [ ] 커밋 메시지 작성
- [ ] 관련 파일 모두 포함 확인

---

## 13. 자주 발생하는 문제 및 해결 방법

### 13.1 TypeScript 오류

**문제**: 타입 오류 발생  
**해결**: 
- 타입 정의 확인
- `as` 타입 단언 최소화
- `any` 타입 사용 금지

### 13.2 데이터베이스 연결 오류

**문제**: 데이터베이스 연결 실패  
**해결**: 
- 환경 변수 확인
- Supabase 프로젝트 설정 확인
- 네트워크 연결 확인

### 13.3 Excel 파싱 오류

**문제**: Excel 파일 파싱 실패  
**해결**: 
- 파일 형식 확인 (.xls vs .xlsx)
- 열 이름 매핑 확인
- 데이터 형식 검증

### 13.4 성능 문제

**문제**: 쿼리 또는 페이지 로딩이 느림  
**해결**: 
- 데이터베이스 인덱스 확인
- 쿼리 최적화
- 불필요한 리렌더링 방지
- 캐싱 적용

---

## 14. 참고 자료

- **Next.js 문서**: https://nextjs.org/docs
- **TypeScript 문서**: https://www.typescriptlang.org/docs/
- **Tailwind CSS 문서**: https://tailwindcss.com/docs
- **Supabase 문서**: https://supabase.com/docs
- **React 문서**: https://react.dev/

---

이 가이드는 프로젝트 진행에 따라 업데이트될 수 있습니다. 새로운 규칙이나 모범 사례가 발견되면 이 문서에 추가하세요.

