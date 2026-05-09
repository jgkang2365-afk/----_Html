# Spec: 측정일지 수정 모달 미작동 문제 해결

## 1. 개요
최근 업데이트 이후 '측정계획 > 검색 결과' 화면에서 '수정' 버튼을 클릭해도 편집 모달이 열리지 않는 회귀 버그가 발생함. 이를 해결하기 위해 이벤트 핸들링 및 상태 관리 로직을 점검하고 수정함.

## 2. 분석 결과 및 원인 추정
- **이벤트 전파 차단**: `JournalSearch.tsx`의 수정 버튼에 추가된 `e.preventDefault()` 및 `e.stopPropagation()`이 UI 프레임워크나 상위 컴포넌트의 기대를 저해할 가능성.
- **상태 업데이트 레이스 컨디션**: `handleSelectJournal`에서 모달을 즉시 열고 백그라운드에서 데이터를 페치하는 로직이 React 렌더링 사이클과 충돌할 가능성.
- **폼 초기화 실패**: `JournalEditForm.tsx`의 파생 상태(Derived State) 계산 로직에서 초기 렌더링 시 발생할 수 있는 잠재적 오류.
- **데이터 불일치**: `selectedEntry`가 백그라운드에서 갱신될 때, `JournalEditForm`이 동일한 `id`를 `key`로 사용하고 있어 내부 상태(`formData`)가 갱신되지 않는 문제.

## 3. 해결 계획

### Phase 1: JournalSearch.tsx 수정
- 수정 버튼의 `onClick` 핸들러에서 불필요한 이벤트 전파 차단 로직 제거.
- `handleSelectJournal` 로직을 보다 안정적인 순서로 재조정.

### Phase 2: JournalEditForm.tsx 수정
- `entry` 프롭 변경 시 내부 `formData` 상태를 동기화하는 로직 보강.
- 파생 상태 계산 시 `NaN`이나 `undefined`에 대한 방어 로직 강화.
- `formatCurrency` 등 유틸리티 함수 사용 시 안전성 확보.

### Phase 3: 검증
- 수정 후 '수정' 버튼 클릭 시 모달이 정상적으로 열리는지 확인.
- 백그라운드 데이터 로딩 후 폼 데이터가 최신으로 유지되는지 확인.
- 측정비 합계 자동 계산이 정상 작동하는지 확인.

## 4. 상세 변경 내용

### JournalSearch.tsx
```tsx
// 버튼 클릭 핸들러 수정
onClick={() => handleSelectJournal(entry)}
```

### JournalEditForm.tsx
- `useEffect`를 통한 `entry` -> `formData` 동기화 로직 점검 (이미 존재하지만, 누락된 필드가 있는지 확인).
- `derivedFeeTotal` 계산 로직의 안정성 강화.

---
**주의**: 1,000줄 이상의 파일을 전체 재작성하지 않고 필요한 부분만 정밀 수정(FTF 프로토콜 준수).
