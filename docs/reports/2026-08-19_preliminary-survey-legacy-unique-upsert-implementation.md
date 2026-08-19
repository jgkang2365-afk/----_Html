# preliminary_survey UNIQUE + UPSERT 구현

- 실행일: 2026-08-19
- 브랜치: `feature/preliminary-survey-legacy-unique-upsert` (base: origin/main 782d02b)
- 작업 유형: legacy `preliminary_survey` 중복 방어 구현 (schema drift 정리 + UNIQUE + UPSERT 전환)
- V2 정책: `process_changed_preliminary_survey.enabled = false` 유지 (ON 하지 않음)

> 결론 구분 표기
> - **[사실]** : 운영 DB/코드에서 직접 확인
> - **[제안]** : 기술적 구현 내용

---

## 1. 목적

`(code, year, period, measurement_date)` 조합의 legacy `preliminary_survey` 중복 재발 방지.

- 4차 전수검사 결과: 중복 0건, key NULL 0건, 정상 다일 측정은 measurement_date가 달라 충돌 없음.
- 이번 작업은 그 방어 구조를 실제로 구현하고 운영 DB에 적용.

---

## 2. 시작 기준선

| 항목 | 값 |
|---|---|
| branch | feature/preliminary-survey-legacy-unique-upsert (base origin/main 782d02b) |
| `preliminary_survey` 행 수 | 495 |
| `(code,year,period,measurement_date)` 중복 | 0 |
| key NULL (code/year/period/measurement_date) | 0 |
| 정책 `enabled` | false |

---

## 3. preflight 결과

- 중복 그룹 0, NULL 0, 타입 확인: `year`=integer, `period`=text.
- 다일 측정(H0508 등 13그룹 34행)은 measurement_date가 서로 달라 UNIQUE와 충돌하지 않음을 확인.
- **[사실]** 중단 조건(§54) 해당 없음 → migration 적용 승인.

---

## 4. schema drift 보정

- 운영 DB에 존재하지만 repo migration 정의가 누락된 `year`/`period`/`notes`를 `ADD COLUMN IF NOT EXISTS`로 정식 정의.
- 신규 환경에서는 생성, 기존 운영 DB에서는 안전하게 통과 (idempotent).

---

## 5. UNIQUE 구조

- constraint: `uq_preliminary_survey_code_year_period_measurement_date`
- `UNIQUE (code, year, period, measurement_date)`
- PostgreSQL UNIQUE는 NULL을 서로 동일하지 않은 값으로 취급하므로, 4개 컬럼 모두 NOT NULL 값임을 전수검사로 확인 후 정상 UNIQUE 채택.
- 기존 단일 index(`idx_preliminary_survey_code`/`date`/`business_name`)는 조회 패턴에 사용되므로 유지.
- **[사실]** 운영 DB에 적용 완료 (SQL Editor "Success"), constraint 존재 확인.

---

## 6. Integrated Sync 변경

`app/api/businesses/route.ts`

- 기존: find → update/insert.
- 변경: 기존 행은 관리 필드만 UPDATE, 신규 행은 `upsert(onConflict: "code,year,period,measurement_date")` 사용.
- race 시 unique violation(23505)이면 해당 행 조회 후 관리 필드만 UPDATE.
- 보존 필드: `preliminary_surveyor`/`survey_code`/`google_event_id`/`assignee_manual_override`/`notes`/`created_at`/`created_by` — Integrated Sync가 갱신하지 않음.
- 관리 필드: `end_date`/`report_writer`/`actual_measurer`/`business_name` (기존 책임 범위 유지).
- 측정일 변경/다일/stale date 삭제 동작은 기존 로직 유지.

---

## 7. Survey POST 변경

`app/api/survey/route.ts`

- 기존: 중복 체크 없이 INSERT.
- 변경: 동일 `(code, year, period, measurement_date)` legacy 행 존재 시 **409 반환** (신규 등록 목적이므로 기존 행을 덮어쓰지 않음).
- race 시 UNIQUE 위반(23505)도 409로 처리.
- 기존 row null overwrite 방지: 등록은 신규 insert만 수행하므로 기존 행 필드 무변경.

---

## 8. excel-sync 변경

`lib/sync/excel-sync.ts` (Strict Sync / 수기 등록 데이터 보정 블록)

- 기존: `onConflict: "code,year,period"` (새 UNIQUE와 불일치).
- 변경:
  - measurement_date가 있는 행: `onConflict: "code,year,period,measurement_date"` upsert.
  - measurement_date가 없는 행: `(code, year, period)`로 기존 행 조회 후 **UPDATE만 수행** (신규 INSERT 금지, 중복 방지).
- measurement_target_business 대상 upsert(`onConflict: "code,year,period"`)는 target 테이블의 정상 UNIQUE이므로 유지.

---

## 9. 다일 측정 처리

- 각 측정일은 `measurement_date`가 달라 별도 행으로 유지됨 (UNIQUE와 충돌 없음).
- 일정 감소 시 stale 날짜 legacy 행은 기존 Integrated Sync DELETE 동작 유지.
- **[사실]** H0508 08-03 + 08-25 2행 유지 확인.

---

## 10. H0508 회귀

| id | measurement_date | actual_measurer |
|---|---|---|
| 697 | 2026-08-03 | 강종구, 이태환 |
| 701 | 2026-08-25 | 강종구 |

- UNIQUE 적용 후에도 2행 정상 유지.

---

## 11. Calendar 영향

- Integrated Sync UPSERT/UPDATE는 `google_event_id`를 보존하므로 Calendar event 중복 생성 없음.
- 기존 캘린더 동기화(`syncBusinessToCalendar`) 경로 변경 없음.
- **[사실]** 이번 작업에서 Calendar write 없음.

---

## 12. 테스트

- 신규: `tests/preliminary-survey-legacy-unique-upsert.test.ts` (11건)
  - UNIQUE migration 구조 / Integrated Sync UPSERT+23505 / 보존 필드 / Survey POST 409 / excel-sync conflict key / V2 PAUSE 무영향.
- `npx tsc --noEmit`: 통과.
- lint: 신규·변경 파일 경고 0.
- 관련 테스트 124건(PAUSE/plans/steady-state/group/recommend/confirm/role-separation/admin-repair/k2b-calendar): 전부 통과.
- 전체 테스트: 427/431 통과. 실패 4건은 **변경 전 main에서도 동일하게 실패하던 기존 실패**
  - `national-support-flow-structure` (기존 알려진 실패)
  - `preliminary-survey-v2-3a-ui` 1건, `preliminary-survey-v2-persist-source-fix` 2건 (V2 migration 소스 검증, 이번 변경과 무관)

---

## 13. 운영 DB 적용 결과

- migration 적용: `supabase/migrations/20260819_preliminary_survey_unique.sql` (SQL Editor "Success")
- 적용 후 확인:
  - constraint `uq_preliminary_survey_code_year_period_measurement_date` 존재
  - duplicate group 0
  - key NULL 0
  - H0508 2행 유지
  - 정책 `enabled=false` 유지

---

## 14. row count 전후

| 시점 | row count |
|---|---:|
| 적용 전 | 495 |
| 적용 후 | 495 |

- 변화 없음 (작업 중 신규 데이터 유입 없음).

---

## 15. 정책 OFF 확인

- `preliminary_survey_policy_settings.process_changed_preliminary_survey.enabled = false` 유지.
- V2 자동 추천/생성/재조정 로직 변경 없음.

---

## 16. 남은 위험

- PostgreSQL UNIQUE는 NULL 중복을 막지 않으므로, 향후 NULL measurement_date 행 유입 시 방어 우회 가능. 현재 key NULL 0건이며, 유입 시 partial index 또는 NOT NULL 강제를 별도 검토.
- Survey PUT/DELETE(`[id]`)는 id 기반이라 UNIQUE의 직접 영향 없음 (기본 유지).
- excel-sync measurement_date 없는 행은 개별 UPDATE라 대량 시 성능 주의 (기존과 유사한 보정 범위).

---

## 17. 다음 Phase

- 설계 보고서(`2026-08-19_preliminary-survey-core-model-and-rebalancing-design.md`)의 Phase 순서대로:
  - Phase A: 측정대상사업장 ↔ V2 자동생성 결합 제거 (별도 작업)
  - Phase B: 메인 측정자/조력자 구조 적용 (main_measurer_id/helper_ids)
  - Phase D: 찐확정 판정 공통 함수 (journal 존재 기준)
  - 이번 작업은 V2와 무관하게 legacy 안정성만 개선.

---

## 부록. 변경 파일

- `supabase/migrations/20260819_preliminary_survey_unique.sql` (신규)
- `app/api/businesses/route.ts` (Integrated Sync UPSERT)
- `app/api/survey/route.ts` (POST 중복 방어)
- `lib/sync/excel-sync.ts` (conflict key 정합화)
- `tests/preliminary-survey-legacy-unique-upsert.test.ts` (신규)

민감정보(비밀값·DB 접속정보·개인정보 원문)는 포함하지 않았다.
