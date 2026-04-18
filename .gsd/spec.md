# Project Specification: 측정일지 번호 부여 제외 및 기타매출 분류

## 1. 개요
측정일지 등록 시 특정 상황에서 번호(공문연번, 연번, 5인 이상 연번)를 자동으로 부여하지 않고 등록할 수 있는 기능을 제공한다. 이 기능은 특정 권한을 가진 사용자에게만 허용되며, 해당 데이터는 '기타매출'로 자동 분류되어 관리된다.

## 2. 요구사항 (Requirements)
- **R1. 권한 기반 노출**: '일지담당자(is_journal_manager)' 또는 '관리자' 권한이 있는 사용자에게만 번호 부여 제외 체크박스가 노출되어야 한다.
- **R2. 번호 부여 제외**: 체크박스 선택 시, 시스템은 공문연번, 연번, 5인 이상 연번을 생성하지 않고 `NULL`로 저장한다.
- **R3. 매출 자동 분류**: 번호 부여를 제외한 일지는 `revenue_type` 필드가 '기타매출'로 자동 설정되어야 한다. (기본값은 '측정매출')
- **R4. 수동 수정 제한**: 번호 부여 제외 상태에서는 연번 필드들이 비활성화되거나 편집 시 `NULL`로 유지되어야 한다.

## 3. 기술 설계 (Technical Design)

### 3.1 Data Model (Database)
`measurement_journal` 테이블에 다음 필드를 추가한다:
- `is_skip_numbering` (BOOLEAN, DEFAULT FALSE): 번호 부여 제외 플래그
- `revenue_type` (VARCHAR(50), DEFAULT '측정매출'): 매출 구분 ('측정매출', '기타매출')

### 3.2 UI/UX (Frontend)
- `JournalEditForm.tsx`:
    - 로그인 사용자 정보에서 `is_journal_manager` 확인.
    - 권한이 있는 경우 "일련번호 자동 부여 제외 (기타매출 분류)" 체크박스 표시.
    - 체크 시 실시간으로 번호 필드 비우기 및 UI 힌트 제공.

### 3.3 API Logic (Backend)
- `app/api/journal/route.ts` (POST) & `app/api/journal/[id]/route.ts` (PUT/PATCH):
    - `is_skip_numbering` 필드 수신.
    - `is_skip_numbering`이 true인 경우 `assignAllNumbers`를 호출하지 않고 명시적으로 번호 필드를 `null`로 할당.
    - `revenue_type`을 '기타매출'로 강제 설정.

## 4. 예외 처리
- 번호 부여 제외된 일지에 나중에 수동으로 번호를 넣으려 할 경우, `is_skip_numbering` 플래그를 해제하도록 유도한다.
- `UNIQUE` 제약 조건: 기존 `measurement_journal`의 유니크 제약조건(`designated_office`, `measurement_year`, `measurement_period`, `document_number`)에서 `document_number`가 NULL인 경우 PostgreSQL에서는 중복 체크가 허용되므로(NULL은 서로 다르다고 판단), 수동 번호 미부여 시 충돌 문제는 발생하지 않는다.

## 5. 단계별 체크포인트 (GSD Phase)
1. **Discuss**: 요구사항 확인 및 상세 설계 승인 (현재 단계)
2. **Plan**: 상세 구현 계획서(PLAN.md) 작성 및 승인
3. **Execute**: DB 마이그레이션 -> API 수정 -> UI 수정
4. **Verify**: 단위 테스트 및 수동 검증
