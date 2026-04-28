# Spec: 캘린더 자동화 시스템 재가동 및 4/24~28 데이터 업데이트

## 1. 개요
- **목적**: 캘린더 동기화 기능을 다시 활성화하고, 4월 24일부터 28일까지의 측정 데이터를 시스템 DB 및 구글 캘린더에 정확히 반영함.
- **주요 기능**:
    - 캘린더 동기화 일시 중지 플래그 해제.
    - 엑셀 파일(사업장정보, 측정사업장)을 통한 DB 최신화.
    - 특정 기간(4/24~4/28) 데이터의 캘린더 강제 동기화.

## 2. 분석 및 전략
- **Forest (사전 분석)**:
    - `lib/google/sync-service.ts`의 `IS_DISABLED` 변수가 `true`로 설정되어 동기화가 차단된 상태임.
    - `lib/sync/excel-sync.ts`의 `syncAllFiles`는 Supabase Storage의 엑셀 파일을 읽어 DB를 업데이트함.
    - `debug-calendar.log`에서 `403 (Rate Limit)` 및 `404 (Not Found)` 오류가 확인됨.
- **Tree (정밀 수정)**:
    - **Reactivation**: `lib/google/sync-service.ts`의 `IS_DISABLED`를 `false`로 변경.
    - **Data Update**: `syncAllFiles`를 실행하여 4/24~28 데이터가 포함된 엑셀 내용을 DB에 반영.
    - **Force Sync**: 4/24~4/28 기간의 `measurement_business` 데이터를 조회하여 구글 캘린더로 전송하는 스크립트 작성 및 실행.
    - **Stability**: `403` 오류 방지를 위해 동기화 로직에 `delay` 추가 고려.
- **Forest (사후 검증)**:
    - 구글 캘린더에 4/24~28 일정들이 정상적으로 생성/수정되었는지 확인.
    - `debug-calendar.log`를 통해 API 오류 발생 여부 재점검.
    - DB의 `google_event_id`가 정상적으로 기록되었는지 확인.

## 3. 구현 계획 (Phases)

### Phase 1: 시스템 활성화 및 DB 업데이트
- [x] `lib/google/sync-service.ts`의 `IS_DISABLED = false` 설정.
- [x] `syncAllFiles` 실행 스크립트 작성 및 수행 (4/24~28 데이터 반영).

### Phase 2: 특정 기간 데이터 캘린더 동기화
- [x] 2026-04-24 ~ 2026-04-28 기간의 측정 사업장 데이터를 DB에서 추출.
- [x] 추출된 데이터를 루프를 돌며 구글 캘린더로 강제 전송 (`syncBusinessToCalendar` 활용).
- [x] API 할당량 보호를 위해 요청 간 500ms~1s 지연 추가.

### Phase 3: 안정성 강화 및 검증
- [x] `404 Not Found` 발생 시 기존 ID를 제거하고 새로 생성하도록 로직 보강 여부 검토.
- [x] 최종 로그 확인 및 작업 완료 보고.

## 4. UAT (사용자 수락 테스트)
- [x] 4/24~28 일정들이 구글 캘린더에 표시되는가?
- [x] 일정의 상세 내용(사업장명, 담당자, 연락처 등)이 엑셀/DB와 일치하는가?
- [x] 동기화 로그에 더 이상 중대한 API 오류가 기록되지 않는가?
