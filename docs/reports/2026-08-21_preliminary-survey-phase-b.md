# 예비조사 Phase B 구현 보고서

## Git 기준

- 시작 main SHA: `555ae773484bd1533d4b0d252f0fa12592e93ebe`
- 작업 branch: `feature/preliminary-survey-phase-b`
- 최종 head SHA: 최종 커밋/PR의 head 기준(보고서 작성 뒤 확정)

## 주요 변경

- 예비조사 탭 기본 순서를 `계획 → 목록 → 검색 → 제외 일정`으로 변경했다.
- HTML5 drag & drop으로 탭 순서를 바꾸고 버전이 포함된 localStorage 키에 저장한다.
- 손상 저장값은 기본 순서로 복구하고, 누락 탭은 기본 위치에 보완하며 `기본 순서로 복원`을 제공한다.
- 예비조사 계획의 업체별 카드 렌더링을 제거하고 12개 필수 컬럼의 테이블 작업대로 변경했다.
- 계획과 목록이 같은 workbench API와 V2 plan source-of-truth를 사용한다.
- 목록은 측정대상사업장의 최초실시·타기관 신규·기존업체를 통합 조회하며 구분/상태/예비조사일/측정예정일/조사자/방식 필터를 제공한다.
- 상세 모달에서 예비조사일·조사방식·조사자 수동 저장과 업체별 재추천을 제공한다.

## 날짜 추천 정책과 엔진

- 추천 시작점은 `measurement_target_business.measurement_date`다.
- 최초실시는 `-3 영업일`부터 더 이전 날짜를 탐색한다.
- 타기관 신규는 `-30 영업일`부터 더 이전 날짜를 탐색한다.
- 기존업체는 유선 기본값과 유연한 후보 범위를 사용한다.
- 주말과 현재 공휴일 snapshot을 제외한다.
- 단일 `recommendBatch` 엔진이 전체/기간(`range`)과 업체(`target_business`) scope를 처리한다.
- 정렬 우선순위는 최초실시, 타기관 신규, 기존업체다.
- 경력 조건은 hard constraint로 적용하며 Phase B 대상은 비경력자 단독을 자동 추천하지 않는다.
- 거리/동선 판정과 기존 업무량 제약은 기존 V2 자산을 재사용한다.

## 추천안, 업체별 재추천, minimum-change

- `추천 생성`은 읽기 전용 계산 결과를 브라우저 메모리의 임시안으로만 유지한다.
- `추천안 적용` 또는 수동 저장에서만 기존 V2 저장 RPC를 호출해 `plan_origin=manual` 가확정으로 저장한다.
- 업체별 재추천은 같은 엔진을 target scope로 실행하고, 다른 기존 plan은 existing assignment로 유지해 날짜·조사자·업무량·경력·동선 충돌을 재검증한다.
- 전체 추천에서도 문제없는 기존 manual plan은 유지하고, 미추천·구형 automatic·source 변경 plan만 대상으로 삼는다.
- 재추천 결과는 자동 저장하지 않고 변경안과 대안 후보일을 사용자에게 보여준 뒤 적용한다.

## 상태 모델

- 미추천: plan 없음
- 추천: 메모리의 임시 추천안
- 조정 필요: 엔진이 hard constraint를 만족하는 안을 찾지 못함
- 가확정: 사용자가 적용/수동 저장한 manual plan
- 재검토 필요: source 측정예정일 변경 또는 자동 생성된 구형 plan
- 찐확정: 해당 code/year/period의 유효한 `measurement_journal` row 존재
- 찐확정 판정은 `sequence_number`를 사용하지 않으며 일반 수정/재추천 버튼을 차단한다.

## 기존 구조 보존

- 기존 `preliminary_survey_v2_plans`, service, API, audit, admin repair, legacy sync를 삭제하지 않았다.
- 기존 automatic V2 plan은 가확정으로 자동 신뢰하지 않고 `재검토 필요`로 표시한다.
- 기존 target-save 자동생성/자동추천 호출 제거 상태와 PAUSE 정책 OFF 게이트를 유지했다.
- 사용자가 명시적으로 실행하는 Phase B 작업대만 별도 경로로 제공한다.
- `MeasurementTargetBusinessManagement.tsx`에 예비조사 작업 UI를 추가하지 않았다.
- 보고서 담당자, 예비조사 responsible(link), 실제 측정 인원을 분리했다.
- 예비조사 경로 순서와 측정 경로 순서를 혼용하지 않았다.

## DB/schema

- schema/migration 변경 없음.
- 운영 DB INSERT/UPDATE/DELETE 또는 migration 적용 없음.
- 브라우저 검증 중 추천 생성/적용 버튼을 통한 운영 데이터 쓰기 없음.

## 테스트 결과

- `npx tsc --noEmit`: 통과
- `npx tsx --test tests/preliminary-survey-phase-b.test.ts`: 6/6 통과
- 기존 핵심 회귀: 109/109 통과
- `npm test`: 362/362 통과
- `npm run build`: 통과
- 첫 병렬 빌드는 Windows `.next/export` 캐시 정리에서 `ENOTEMPTY`가 발생했고, 작업공간 생성 캐시만 정리한 뒤 단독 재실행해 통과했다.

## 브라우저 실제 검증

- `npm run dev:turbo -- --port 3100`: 서버 컴파일 및 Ready 확인
- 실제 브라우저 자동화: 미검증
- 사유: 로컬 `agent-browser` 실행 파일이 없고 인앱/Chrome 브라우저 연결 목록도 비어 있어 화면 상호작용을 수행할 수 없었다.
- 따라서 탭 drag & drop, 새로고침 복원, 테이블 표시, 상세 수정/재추천, 적용 흐름을 실제 화면에서 완료했다고 주장하지 않는다.
- 개발 서버는 확인 후 종료했다.

## 알려진 제한사항

- 실제 브라우저 연결이 가능한 환경에서 지시서 27절의 15개 UI 시나리오를 재검증해야 한다.
- 실제 외부 차량 경로 API 응답과 운영 데이터 조합은 이번 로컬 검증에서 실행하지 않았다.
- 찐확정 관리자 정비는 기존 admin repair 경로를 유지하며 새 작업대 일반 모달에서는 제공하지 않는다.

## 남은 TODO

- 브라우저 연결 환경에서 실제 화면 회귀 검증을 수행한다.
- 새 시스템 안정화 후 별도 Phase에서 기존 V2 plan을 `automatic / manual / 실제 사용·확정 / 미사용 구형`으로 분류하고 각각 유지·마이그레이션·archive·삭제 여부를 결정한다.
- 새 시스템 안정화 확인 전 구형 V2 데이터를 삭제하지 않는다.

## 모델별 작업 수행 현황

| 모델 | 추론 강도 | 수행 작업 | 결과/반영 여부 | 실행/사용량 |
| --- | --- | --- | --- | --- |
| Codex 주 작업자(실제 세부 모델명 미표시) | 실제 표시값 확인 불가 | 구조 분석, 구현, 테스트, 빌드, 브라우저 연결 시도, 보고서/Git 작업 | 코드 및 보고서 반영 | 단일 세션, 토큰/credits 확인 불가 |

- 요청 라우팅값은 작업 시작 시 적용을 시도했으나 이 세션에서 실제 모델명과 reasoning effort 메타데이터가 노출되지 않아 추정하지 않았다.
- 하위 worker/agent는 사용하지 않았다.
- 브라우저 검증용 `agent-browser`와 인앱 브라우저 연결 시도는 환경 부재로 실패했으며 코드 반영에는 사용하지 않았다.
