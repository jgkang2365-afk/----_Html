# 측정일지_웹 — 예비조사 운영지침 및 측정자 고정형 역산 플래너 인수인계서 v0.2

기준일: 2026-09-02  
Canonical: `docs/business-rules/preliminary-survey.md`  
Canonical Git blob SHA: `aca759e7d785231cc89bc656ba635eb367f65de3`  
Planner version: `fixed-assignee-reverse-planner-v1.0.0`

> 저장소와 제공 경로에서 v0.1 원문을 찾지 못해 현행 Canonical과 승인된 2차 작업지시서를 기준으로 v0.2를 독립 작성했다.

## 1. 운영 계약

사용자가 실제 측정일별 측정자를 명시 확정한다. 역산 플래너는 그 값을 입력으로만 사용하고 변경하지 않는다. 실제 측정팀, 보고서 담당, 경력 원천, 일정, 기존 plan, route evidence와 capacity를 하나의 `PlanningSnapshot`으로 동결한 뒤 pure solver가 `AUTO_ASSIGNED / MANUAL_REQUIRED / SOURCE_INVALID`와 `KEEP_EXISTING / CREATE / REPLACE / NONE`을 분리해 반환한다.

Preview는 SELECT와 계산만 수행한다. Apply 직전에 같은 원천을 다시 읽고 fingerprint가 다르면 `SOURCE_CHANGED`로 0건 저장한다.

## 2. v0.2 보강 사항

1. **Legacy Workbench safety lock**  
   구형 작업대의 추천 생성·적용·업체 재추천 버튼을 비활성화했다. workbench recommend/apply와 구형 group recommend/confirm을 서버에서도 `410 LEGACY_WORKBENCH_DISABLED`로 차단한다.

2. **고정 측정자 authoritative source 분리**  
   `preliminary_survey_v2_fixed_assignments`를 신설한다. fixed row는 사용자의 `측정자 확정` 실행으로만 생성된다.

3. **기존 assignment는 확정값이 아님**  
   `preliminary_survey_v2_measurement_assignments`가 존재해도 fixed row가 없으면 `FIXED_ASSIGNEE_NOT_CONFIRMED`이다. 자동 backfill하지 않는다. H0527 과거 불일치 assignment를 fixed로 승격하지 않는 회귀를 유지한다.

4. **base code와 표시 code 분리**  
   `users.survey_code` 및 assignment `survey_code`는 단일 base code다. 새 nullable `public_sample_code`가 실제 표시 코드이며 조회는 `public_sample_code ?? survey_code`다.

5. **C / CC / CCC 정규화**  
   같은 실제 측정일·같은 고정 측정자를 한 그룹으로 묶고 사업장 코드 natural sort, target id 순으로 base code를 반복한다. 4건 이상도 표시값을 만들되 hard-rule 경고와 audit을 남긴다.

6. **기존 자동 측정자 배정 엔진 사용 금지**  
   reverse planner는 `assignMeasurementAssignees()`를 호출하지 않는다. fixed assignee는 출력 후보가 아니라 입력이다.

7. **Preview/Apply source fingerprint**  
   fixed, 측정일, daily staff, collaborators, 보고서 담당, 사용자 경력·활성·base code, 일정, 기존 plan/assignment, 보호상태, route evidence, 작성 counter, Canonical SHA, planner version을 결정론적으로 fingerprint한다. route의 단순 captured timestamp는 fingerprint에서 제외한다.

8. **관리자 override와 일반 수동수정 분리**  
   정상 Apply와 `MANUAL_OVERRIDE`는 별도 action이다. 관리자만 구체 경고, 예외 사유, 명시 확인, before/after, 실제 측정팀, fixed, participant, actor, fingerprint와 version을 기록해 저장할 수 있다. 존재하지 않는 target/user, 날짜 구조 오류와 stale source는 관리자도 우회할 수 없다.

9. **planner/audit 구조**  
   도메인은 `lib/preliminary-survey-v2/reverse-planner/`에 있고 외부 DB·route 수집은 API 경계에서 수행한다. Apply/override만 append-only `preliminary_survey_v2_planner_audit`에 기록한다. Preview audit insert는 없다.

10. **다일 batch 검색**  
    선택 날짜가 target `measurement_date` 또는 `daily_staff[].date`에 있으면 포함하며 발견 후 해당 사업장의 전체 측정기간을 snapshot에 넣는다. 날짜별 fixed는 독립이고 plan은 공유한다.

11. **route evidence snapshot 고정**  
    route provider는 solver 밖에서 호출한다. 동일주소 또는 검증된 vehicle duration만 자동결정 근거다. provider/좌표 실패는 관련 대상만 `ROUTE_EVIDENCE_REQUIRED`로 낮춘다.

12. **headless 독립 브라우저 검증**  
    worktree 전용 headless agent-browser 독립 session을 사용한다. Orca computer, 사용자 Desktop 입력, 공유 브라우저 직접 조작은 사용하지 않는다.

13. **Preview DB 차이 시 다중 검증 경로**  
    Staging synthetic fixture UI E2E, Production READ-ONLY snapshot 비교, 배포 후 Production READ-ONLY smoke를 조합한다. Preview에 Production H-code가 없다는 이유로 중단하지 않는다.

14. **Production READ-ONLY smoke**  
    Production에서는 조회·모달·Preview 표시만 검증한다. Apply E2E와 synthetic 생성은 Staging에서만 수행한다.

## 3. DB와 보안

- migration은 fixed table, planner audit table, nullable public code와 service-role 전용 confirm/apply RPC만 추가한다.
- 신규 table은 RLS를 켜고 `PUBLIC / anon / authenticated` 권한을 제거한다.
- RPC는 `SECURITY DEFINER SET search_path = ''`이며 실행권한을 service role에만 부여한다.
- 서버는 cookie session을 확인하고 DB 함수도 관리자/예비조사 담당 권한과 활성 사용자를 재검증한다.
- Apply는 target/fixed row를 잠그고 plan, assignment, public code 그룹 정규화, audit을 한 transaction에서 처리한다.
- 8월 backfill, 기존 fixed 자동 생성, 기존 public code backfill은 없다.

## 4. 화면과 downstream

예비조사 계획 화면의 상단에 날짜 → 전체 사업장 → 날짜별 측정자 확정 → Preview → 정상안 적용 흐름을 배치한다. 고정 측정자, 측정 참여자, 보고서 담당, 예비조사자, 작성자, reviewer를 다른 열로 유지한다.

측정일지는 단일일 표시를 보존하고 다일이면 다음처럼 날짜별 persisted assignment를 모두 표시한다.

```text
09/14 이태환(A)
09/15 한기문(B)
09/16 고유빈(F)
```

V2 plan이 존재하면 display model 전체는 V2/target 원천만 사용하며 빈 필드를 legacy로 보충하지 않는다.

## 5. 결정사항

| 결정사항 | 선택한 권고안 | 대안 | 선택 이유 | 영향 범위 |
|---|---|---|---|---|
| Preview 저장 | stateless fingerprint | draft table | DB write 0, stale guard와 rollback 단순화 | Preview/API |
| fixed 원천 | 별도 table | 기존 assignment 재사용 | 사용자 확정과 과거 자동배정을 구분 | DB/API/UI |
| public code | nullable 새 column | 기존 survey_code 의미 확장 | 기존 row·PR #77 표시 호환 | DB/측정일지 |
| mutation | decision과 분리 | 상태 하나로 저장 | KEEP_EXISTING과 자동판정 동시 표현 | solver/audit |
| route 오류 | 관련 대상만 manual | batch 전체 실패 | 보수적 자동결정과 batch 지속 | snapshot/solver |
| v0.1 부재 | v0.2 독립 작성 | 미확인 문서 덮어쓰기 | 알려지지 않은 원본 보존 | 문서 |

## 6. rollback

코드는 merge revert로 되돌린다. DB 변경은 additive이므로 이전 코드가 신규 table/column을 참조하지 않으면 정상 동작한다. `public_sample_code`는 nullable이고 기존 row backfill이 없으며 기존 column 삭제·rename은 없다.
