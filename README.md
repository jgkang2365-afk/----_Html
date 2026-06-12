# 측정일지 관리 시스템

측정사업장 정보를 자동으로 동기화하고 측정일지를 생성·관리하는 웹 플랫폼

## 기술 스택

- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- ESLint, Prettier

## 시작하기

### 의존성 설치

```bash
npm install
```

### 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 확인하세요.

## 프로젝트 구조

```
/app
  /api          # API Routes
  /dashboard    # 대시보드 페이지
  /survey       # 예비조사 페이지
  /journal      # 측정일지 페이지
  /summary      # 측정정보 요약 페이지
  /sales        # 매출관리 페이지
/components     # 재사용 가능한 컴포넌트
/lib            # 유틸리티 함수
/types          # TypeScript 타입 정의
/hooks          # 커스텀 훅
/styles         # 전역 스타일
```

## 빌드

```bash
npm run build
```

## 배포

Vercel을 사용하여 배포할 수 있습니다.


## 버전 관리 및 변경 이력

### v0.2.1 (2026-06-12)
- **이메일 주소 가독성 개선**: 담당자 이메일, 계산서 메일(1), 계산서 메일(2) 입력 필드 및 전회 이메일 정보 텍스트 영역에 모노스페이스 고정폭 폰트(`email-mono-font`)를 적용하여 영문 `J`, `i`, `l`, `1` 등 모호한 문자들의 가독성과 식별성을 향상시켰습니다.

