# Spec: 사용자 계정 활성/비활성(일시 중지) 기능 구현

## 1. 개요
- **목적**: 사용자를 완전히 삭제하지 않고도 시스템 접속을 차단할 수 있는 기능을 제공하여 데이터 무결성을 보존하고 유연한 사용자 관리를 가능하게 함.
- **주요 기능**:
    - 사용자 테이블에 활성 상태(`is_active`) 필드 추가.
    - 로그인 시 해당 필드를 체크하여 비활성 사용자 접속 차단.
    - 관리자 페이지에서 사용자별 활성/비활성 상태 토글 기능 제공.

## 2. 분석 및 전략
- **Forest (사전 분석)**:
    - `users` 테이블 구조 및 현재 데이터 확인.
    - `app/api/auth/login/route.ts`의 인증 흐름 분석.
    - `components/features/UserManagement.tsx` UI 구조 분석.
- **Tree (정밀 수정)**:
    - **DB**: `is_active` 컬럼 추가 마이그레이션 (`DEFAULT true`).
    - **Auth**: 로그인 쿼리에 `is_active` 조건 추가 및 실패 메시지 처리.
    - **API**: 사용자 생성/수정 API에서 `is_active` 필드 지원.
    - **UI**: 사용자 목록에 상태 표시 및 활성/비활성 전환 버튼 추가.
- **Forest (사후 검증)**:
    - 비활성화된 사용자로 로그인 시도 시 차단 여부 확인.
    - 관리자가 실시간으로 상태를 변경할 수 있는지 확인.
    - 비활성 상태에서도 과거 데이터(사업장 담당 내역 등)가 유지되는지 확인.

## 3. 구현 계획 (Phases)

### Phase 1: 데이터베이스 스키마 확장
- [ ] `lib/db/migrations/045_add_is_active_to_users.sql` 생성 및 실행.
    - `ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT true;`

### Phase 2: 백엔드 인증 및 API 강화
- [ ] `app/api/auth/login/route.ts` 수정:
    - 사용자 조회 시 `is_active` 필드 포함.
    - `is_active`가 `false`인 경우 로그인 거부 및 안내 메시지 반환.
- [ ] `app/api/users/route.ts` 및 `app/api/users/[id]/route.ts` 수정:
    - GET: `is_active` 필드 반환.
    - POST: 신규 생성 시 활성 상태 기본값 처리.
    - PATCH: `is_active` 상태 업데이트 지원.

### Phase 3: 관리자 UI 개선
- [ ] `components/features/UserManagement.tsx` 수정:
    - `User` 인터페이스에 `is_active` 추가.
    - 사용자 목록 테이블에 '상태' 컬럼 추가.
    - 수정 모달 또는 목록 작업 버튼에 '비활성화/활성화' 토글 기능 추가.
    - 비활성 사용자의 경우 시각적으로 구분(예: 회색 톤) 처리.

## 4. UAT (사용자 수락 테스트)
- [ ] 관리자가 사용자를 '비활성'으로 변경할 수 있는가?
- [ ] '비활성' 상태인 사용자가 로그인을 시도했을 때 적절한 안내 메시지와 함께 차단되는가?
- [ ] '비활성' 사용자를 다시 '활성'으로 변경했을 때 즉시 접속이 가능한가?
- [ ] 계정 비활성 시에도 해당 사용자가 담당하던 사업장 정보가 그대로 유지되는가?
