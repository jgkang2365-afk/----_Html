# Phase: 모달 자동 닫힘 버그 수정 [COMPLETED]

## 상황
- 모달 내 입력 시 `onClose` 함수 재생성으로 인한 `Modal.tsx`의 `useEffect` 재실행 및 `history.back()` 호출 버그 발생.

## 목표
- `Modal.tsx`의 `onClose` 의존성 제거 및 로직 안정화.

## 작업 목록
- [x] `components/ui/Modal.tsx` 수정 (onCloseRef 도입)
- [x] 수정 사항 검증 (로직 분석을 통한 검증 완료)

## 테스트 하네스
- 직접적인 자동화 테스트 코드는 없으나, 코드 변경 후 브라우저 동작 확인 필요. (사용자 확인 요청)
