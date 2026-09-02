# 측정정보 요약 Canonical UI 이식 v1.0

## 범위
- PR #75의 측정정보 요약/선택 인쇄 UI를 현재 main에 선별 이식
- 기본 정보 표시를 현재 V2 Canonical 역할에 맞춰 4+4 배열로 정리
  - 1행: 공문연번 / 연번 / 5인 이상 연번 / 보고서 담당
  - 2행: 예비조사일 / 예비조사자 / 측정자(공시료) / 측정 참여자
- 목록/모바일/상세/선택 인쇄에서 동일 역할 명칭 사용
- 측정일지 수정 모달 `측정자`를 `측정 참여자`로 변경

## 역할 원천
- 역할 표시는 해당 code + year + period의 exact measurement_target_business만 사용
- 측정 참여자: target collaborators 또는 해당 측정일 daily_staff collaborators
- 보고서 담당: target measurer_id 또는 해당 측정일 daily_staff measurer_id
- 측정자(공시료): V2 persisted measurement assignment, public_sample_code 우선
- 예비조사자/예비조사일: V2 plan
- 다른 년도/주기의 target, previous journal measurer, legacy survey measurer를 측정 참여자 fallback으로 사용하지 않음

## 검증
- focused source guard: PASS
- npm test: 553/553 PASS
- tsc: PASS
- lint: PASS
- Vercel Preview production build: READY

DB migration 및 Production business-data 변경 없음.
