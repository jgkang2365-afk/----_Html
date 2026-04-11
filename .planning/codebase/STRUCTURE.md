# Project Structure - 측정일지 관리 시스템

프로젝트의 디렉토리 및 파일 구조 정의서입니다.

## Directory Overview

```text
root/
├── app/                 # Next.js App Router (UI & API)
│   ├── api/             # API 엔드포인트 (Auth, Sync, Automation)
│   ├── dashboard/       # 대시보드 화면
│   ├── (auth)/          # 로그인 및 인증 페이지
│   └── ...              # 탭별 화면 (Journal, Sync 등)
├── components/          # 공통 React 컴포넌트
├── lib/                 # 핵심 비즈니스 로직 및 라이브러리
│   ├── automation/      # K2B 자동화 관련 서비스
│   ├── sync/            # 엑셀 동기화 로직 (excel-sync.ts 등)
│   ├── google/          # 구글 서비스 연동 로그
│   ├── utils/           # 유틸리티 함수 (알고리즘, 포맷터)
│   └── supabase/        # Supabase 클라이언트 설정
├── supabase/            # DB 스키마 및 마이그레이션 파일
├── public/              # 정적 자원 (이미지, 폰트)
└── .planning/           # [GSD2] 프로젝트 관리 및 코드베이스 매핑 문서
```

## Key Files
- `lib/sync/excel-sync.ts`: 약 2,300 라인 규모의 핵심 파싱 및 동기화 엔진.
- `lib/automation/k2b-service.ts`: K2B 자동화 주입 로직.
- `측정일지 구현 정보.txt`: 시스템의 근간이 되는 비즈니스 요건 문서.
