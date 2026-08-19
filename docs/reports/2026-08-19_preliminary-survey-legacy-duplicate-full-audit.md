# preliminary_survey 초기 중복 전수검사

- 실행일: 2026-08-19
- 브랜치: `feature/preliminary-survey-v2-automation-pause` (작업 시작 기준 HEAD: eec0bb9)
- 작업 유형: **운영 DB READ-ONLY 검사 전용** (INSERT/UPDATE/DELETE/UPSERT/migration/UNIQUE 생성 없음)
- 기준 설계: `docs/reports/2026-08-19_preliminary-survey-core-model-and-rebalancing-design.md` §15~19, §29~35

> 결론 구분 표기
> - **[사실]** : 운영 DB/코드에서 직접 확인
> - **[업무규칙]** : 사용자 확정 정책
> - **[제안]** : 기술적 다음 단계

---

## 1. 작업 범위

- `preliminary_survey` 전체 데이터 기준 중복 전수검사 (1회성).
- 검사 키: `(code, year, period, measurement_date)`.
- 범위 확정: **2026년 상세 전수검사 / 2025년 이번에는 상세검사 제외 / UNIQUE 적용 직전 2025년까지 포함 충돌 여부 1회 확인**.
- DB write 0건, migration 실행 0건, Calendar write 0건, V2 데이터 변경 0건.

---

## 2. 검사 시점 기준선

| 항목 | 값 | 비고 |
|---|---|---|
| `preliminary_survey` 총 행 | **495** | 이전 보고서 496 → H0508 id 699 삭제 반영 (정상) |
| V2 plan 총 | 43 | auto 26 / manual 17 |
| link set / null | 18 / null 25 | V2 plan 연계 target 기준 |
| audit | 15 | |
| 정책 `enabled` | `false` | |
| H0508 legacy | 08-03 1건 + 08-25 1건 | 정상 |

- **[사실]** 기준선은 이전 보고서와 일치하며, 차이는 H0508 중복 정리로 인한 -1뿐. 검사에 영향 없음.

---

## 3. 실제 schema

운영 DB에서 `preliminary_survey` 컬럼 조회로 확인:

- **존재**: `id, code, year, period, business_name, measurement_date, end_date, measurement_weekdays, measurer, survey_code, address, preliminary_surveyor, actual_measurer, report_writer, sequence_number, date_details, google_event_id, assignee_manual_override, notes, created_at, updated_at, created_by`
- `year` / `period` **실제 존재** (운영 DB). `year`는 숫자(2026), `period`는 문자열(`상반기`/`하반기`/`상반기(수시)`).
- `measurement_date`는 DATE (2026-04-11 multi_date migration에서 TEXT화된 target과 달리 legacy는 날짜형).
- NULL: `code`/`year`/`period`/`measurement_date` 모두 **0건**.
- PK: `id`. FK: repo 정의의 `fk_preliminary_survey_code`는 migration 002에서 제거됨.
- **UNIQUE constraint: 없음**. index: `idx_preliminary_survey_code`, `idx_preliminary_survey_date`, `idx_preliminary_survey_business_name`.

---

## 4. repository schema와 drift

| 항목 | repo (`lib/db/migrations/001`) | 운영 DB | drift |
|---|---|---|---|
| `year` | **없음** | 존재 (integer) | **있음** — 정의 migration 누락 |
| `period` | **없음** | 존재 (text) | **있음** — 정의 migration 누락 |
| `notes` | **없음** | 존재 | **있음** |
| `sequence_number` | 추가됨 (021) | 존재 | 없음 |
| `date_details`/`google_event_id` | 추가됨 (20260411) | 존재 | 없음 |
| `assignee_manual_override` | 추가됨 (20260713) | 존재 | 없음 |
| UNIQUE | 없음 | 없음 | 일치 (UNIQUE 없음) |

**[사실]** `year`/`period`/`notes`는 repo migration 정의가 없으나 운영 DB에 존재하는 drift 상태. UNIQUE 적용 전에 해당 컬럼 정의 migration을 포함해야 한다 (설계 §30과 일치).

---

## 5. 검사 키

- 후보: `(code, year, period, measurement_date)`.
- `business_name`은 UNIQUE 키에 넣지 않음 (변경 가능, 중복 판정 보조자료로만 사용).

---

## 6. 전체 통계

| 항목 | 값 |
|---|---:|
| 총 행 | 495 |
| 고유 code | 350 |
| year 분포 | 2026: 495 (전부 2026년 데이터) |
| period 분포 | 상반기 335 / 상반기(수시) 1 / 하반기 159 |
| google_event_id set / null | 420 / 75 |
| sequence_number NULL | 0 |

- **[사실]** 현재 legacy 데이터는 전부 2026년이다. 2025년 legacy 행은 존재하지 않는다.

---

## 7. NULL 현황

| 항목 | 건수 |
|---|---:|
| code NULL | 0 |
| year NULL | 0 |
| period NULL | 0 |
| measurement_date NULL | 0 |

- **[사실]** 검사 키 4개 컬럼의 NULL이 모두 0건이므로, UNIQUE 적용 시 NULL 관련 충돌은 없다.

---

## 8. 중복 그룹 목록

### `(code, year, period, measurement_date)` 중복 그룹

**[사실] 중복 그룹 0건.**

- 2026년 전체 495행을 위 키로 집계한 결과, **COUNT>1 그룹이 하나도 없다**.
- 2025년 행은 없으므로 충돌 대상 없음.

---

## 9. 오류 중복

- **0건.** 같은 사업장+년도+주기+측정일의 동일 의미 legacy 행이 2개 이상 존재하는 사례는 없음.
- H0508 과거 중복(id 697/699 08-03)은 이미 정리 완료.

---

## 10. 정상 복수행

같은 `(code, year, period)`이지만 `measurement_date`가 달라 **정상 다일 측정**인 그룹 13건(34행) 존재:

| code | period | 측정일 (측정일수) | 행 수 |
|---|---|---|---|
| H0463 | 상반기 | 05-08,05-11,05-12,05-13,05-14 (5일) | 5 |
| H0231 | 상반기 | 06-24,06-25,06-26,07-06 (4일) | 4 |
| H0102 | 상반기 | 03-16,03-17,03-18 (3일) | 3 |
| H0221 | 상반기 | 06-01,06-04,06-10 (3일) | 3 |
| H0102 | 하반기 | 09-14,09-15,09-16 (3일) | 3 |
| H0260 | 상반기 | 04-21,04-22 (2일) | 2 |
| H0268 | 상반기 | 05-19,05-20 (2일) | 2 |
| H0476 | 상반기 | 06-15,06-16 (2일) | 2 |
| H0389 | 상반기 | 06-09,06-10 (2일) | 2 |
| H0495 | 상반기 | 06-30,07-14 (2일) | 2 |
| H0498 | 하반기 | 07-13,07-28 (2일) | 2 |
| H0260 | 하반기 | 08-12,08-13 (2일) | 2 |
| H0508 | 하반기 | 08-03,08-25 (2일) | 2 |

- **[사실]** 각 행의 `measurement_date`가 모두 다르므로 `(code,year,period,measurement_date)` 키로는 중복이 아니다. 다일 측정의 정상 별도 행이다.
- 이 그룹들의 target도 동일하게 다일(daily_staff 2~5건)로 확인됨 (H0508: daily_staff 2건, H0463: 5건, H0231: 4건 등).

---

## 11. 불명확 대상

- **0건.** 분류가 필요한 중복 후보 자체가 없음.

---

## 12. H0508 정상 상태 재확인

| id | measurement_date | actual_measurer | report_writer |
|---|---|---|---|
| 697 | 2026-08-03 | 강종구, 이태환 | 강종구 |
| 701 | 2026-08-25 | 강종구 | 강종구 |

- **[사실]** 08-03 1건 + 08-25 1건으로 정상. target(698) daily_staff 2건과 일치. journal은 2026 하반기 1건(seq 2, 08-03~08-03).

---

## 13. target 연계 검증

- **[사실]** legacy 495행 전부가 `(code, year, period)`로 `measurement_target_business`와 매칭됨 (matched 495 / unmatched 0).
- 즉 현재 legacy 데이터는 모두 유효한 측정대상사업장과 연결된다.

---

## 14. journal 영향

- 다일 그룹 코드들의 `measurement_journal` 존재 확인:
  - H0260(2026 하반기 seq 34), H0389(2026 상반기 seq 108), H0268(seq 87), H0221(seq 102), H0102(seq 29), H0463(seq 80), H0508(seq 2), H0476(seq 116), H0231(seq 132), H0495(seq 16) 등 — 측정일지 등록된 사업장 존재.
- **[사실]** 중복 행이 없으므로 journal 충돌은 없음. 기존 다일 행들은 journal과 정상 연계.

---

## 15. Calendar 영향

- **[사실]** 중복 후보가 0건이므로 Calendar 중복 이벤트 가능성 없음.
- `google_event_id` 420건 보유(전 행의 84.8%). orphan 가능성은 없음.
- Google Calendar write는 수행하지 않음.

---

## 16. legacy write path

`preliminary_survey` write 경로 전수:

| 경로 | 종류 | 위치 |
|---|---|---|
| 측정대상사업장 저장 (Integrated Sync) | INSERT/UPDATE/DELETE | `app/api/businesses/route.ts:814,868,872` |
| 예비조사 POST | INSERT | `app/api/survey/route.ts:715,725` |
| 예비조사 PUT/DELETE | UPDATE/DELETE | `app/api/survey/[id]/route.ts:154,327` |
| 공시료 코드 재정렬 | UPDATE | `lib/utils/survey-assignment.ts:168` |
| sequence_number 재정렬 | UPDATE | `lib/utils/survey-sequence.ts:40-41` |
| Calendar google_event_id | UPDATE | `lib/google/sync-service.ts:97,167,174,181` |
| 엑셀 동기화 | UPSERT 시도(제약 부재로 실패 가능) | `lib/sync/excel-sync.ts:2201` |

- **[사실]**
  - Integrated Sync(`businesses/route.ts`)는 `measurement_date` 기반 find → update/insert 방식. 응용 레벨 1행 유지 (DB UNIQUE 없음).
  - `survey/route.ts` POST는 **중복 체크 없이 무조건 INSERT** (`route.ts:714-732`).
  - `excel-sync.ts:2201`은 `onConflict:"code,year,period"` upsert를 시도하나 DB에 해당 UNIQUE가 없어 실패 가능 (주석 명시).

---

## 17. 중복 발생 가능 원인

- **[사실]** 현재 데이터에는 중복이 0건이지만, 향후 발생 가능 경로:
  1. Integrated Sync 동시 요청/중간 상태에서 같은 측정일 중복 INSERT (race)
  2. SurveyForm POST 중복 체크 없음 (중복 INSERT 가능)
  3. excel-sync upsert의 UNIQUE 부재로 중복 발생 가능
  4. 과거 import/스크립트 경로

---

## 18. UNIQUE 키 적합성 판정

**[판정] A — `UNIQUE(code, year, period, measurement_date)` 즉시 적용 가능**

조건 충족:
- 정상 복수행 없음 (다일은 measurement_date가 달라 충돌 없음)
- NULL 0건 (code/year/period/measurement_date 전부 NOT NULL 값)
- 기존 오류 중복 0건 (정리 불필요)
- 코드 재사용 확인: 동일 code = 동일 business_name (350 고유 code, 같은 code의 사업장명 변화 없음)
- year/period 포맷 안정: year=2026 단일, period=상반기/하반기/상반기(수시) 표준값

**[제안]**
- UNIQUE 적용 전에 `year`/`period`/`notes` 컬럼 정의 migration을 선행해야 한다 (drift 해소).
- UNIQUE index는 `(code, year, period, measurement_date)`로 생성. 장기적으로 target_id 기반 `(target_id, measurement_date)` 강화는 설계 §17·§19 유지.

---

## 19. NULL 처리 제안

- **[사실]** 현재 NULL이 0건이므로 즉시 UNIQUE 적용에 장애 없음.
- **[제안]** 향후 방어적으로, NULL measurement_date 행이 생성될 가능성을 차단하기 위해 `measurement_date NOT NULL` 유지 및 저장 로직에서 NULL 강제 확인. PostgreSQL 일반 UNIQUE는 NULL을 동일로 보지 않으므로, 만약 NULL 행이 생기면 partial index(`WHERE measurement_date IS NOT NULL`) 또는 `NULLS NOT DISTINCT`(지원 시) 검토. 현재는 해당 사항 없음.

---

## 20. UPSERT 전환 대상

- `survey/route.ts` POST: 중복 체크 없이 INSERT → **UPSERT 전환 대상**.
- Integrated Sync `businesses/route.ts`: find→update/insert → **UPSERT 전환 대상**.
- `excel-sync.ts:2201`: `onConflict` upsert를 실제 동작하도록 UNIQUE 부여 후 정상화.
- Calendar `google_event_id` UPDATE는 키 무관 단건 업데이트라 그대로 유지.

---

## 21. 삭제/정리 후보

- **없음.** 오류 중복 0건, 불명확 0건이므로 삭제·수정 대상이 없다.
- 삭제 후보 id: N/A

---

## 22. 다음 migration 전제조건

1. `year`/`period`/`notes` 컬럼 정의 migration (repo drift 해소) — 필수
2. `UNIQUE (code, year, period, measurement_date)` 생성 — 필수 (전수검사 결과 충돌 0건)
3. Survey POST · Integrated Sync UPSERT 전환 — 필수
4. excel-sync upsert 정상화 — 권장
5. 2025년 데이터: 현재 없음. 단 UNIQUE 적용 직전에 2025년까지 포함 충돌 여부 1회 재확인 (사용자 확정 범위)

---

## 23. 다음 작업 권장안

**[제안]**
1. **UNIQUE migration 설계 확정**: `year`/`period` 정의 + `(code,year,period,measurement_date)` UNIQUE (충돌 0건이므로 안전).
2. **Survey POST / Integrated Sync UPSERT 전환**: DB UNIQUE와 이중 방어.
3. 그 다음 사용자 승인 후 오류 중복 정리·UPSERT·UNIQUE 적용을 별도 작업으로 수행.
4. UNIQUE 적용 직전 2025년 데이터 충돌 재확인.

이번 작업에서는 어떤 DB 변경도 수행하지 않았으며, 사용자 승인을 기다린다.

---

## 부록. 검사 방법

- 운영 DB READ-ONLY 조회: 전체 `preliminary_survey` 행 SELECT 후 메모리 GROUP BY (495행 규모, 구조적으로 적합).
- 중복 후보 0건 확인 후 상세 조회 불필요.
- 다일 그룹은 `(code,year,period)` 그룹핑으로 재확인, target·journal·calendar 연계는 batch lookup으로 검증.
- 민감정보(비밀값·연락처·전체 dump)는 포함하지 않았다.
