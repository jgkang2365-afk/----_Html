# Plan: 측정비 동기화 및 데이터 정합성 개선

## 1. 개요
- 작업명: 측정비 동기화 버그 수정
- 담당: Antigravity (AI Assistant)
- 상태: [진행 중 - Phase 1, 2 완료]

## 2. 작업 단계 (Phases)

### Phase 1: SummaryTable.tsx 정합성 강화 (완료)
- [x] `SummaryEntry` 인터페이스 업데이트
- [x] `handleEdit` 초기화 로직 수정
- [x] 합계 자동 계산 `useEffect` 구현
- [x] 수정 모달 UI에 합계 필드 추가
- [x] `handleSave` 데이터 전송 로직 보완

### Phase 2: JournalSearch.tsx 리프레시 로직 개선 (완료)
- [x] `JournalEntry` 인터페이스 누락 필드 추가
- [x] `handleSaveSuccess` 비동기 처리 로직 개선 (Race Condition 해결)
- [x] `handleSearch` 연동 보완

### Phase 3: 최종 검증 및 테스트 (진행 예정)
- [ ] 시나리오별 UAT 수행
- [ ] DB 정합성 최종 확인

## 3. 컨텍스트 메모 (Context Notes)
- `SalesManagement.tsx`의 리프레시 로직을 벤치마킹할 것.
- `JournalEditForm.tsx`의 기존 계산 로직을 `SummaryTable.tsx`에 이식할 때 예외 처리에 주의할 것.
