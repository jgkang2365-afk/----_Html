# 측정자 고정형 역산 플래너 Route Lazy Evaluation v0.1

기준일: 2026-09-02
Canonical blob SHA: `aca759e7d785231cc89bc656ba635eb367f65de3`

## 구현 범위

- 화면 조회용 Snapshot과 Preview 계산용 Snapshot을 분리했다.
- GET, 대상 조회, 고정 측정자 확정, Apply에서는 Route provider를 호출하지 않는다.
- Preview는 route-free provisional solve 뒤 `date → userId → targetIds` index로 실제 공유 직원 pair만 수집한다.
- 동일주소는 주소 정규화 후 provider 호출 없이 `SAME_ADDRESS` 근거로 처리한다.
- Preview Route evidence는 사용자·측정일·source fingerprint에 묶인 HMAC token으로 15분간 동결한다.
- Apply/관리자 예외는 DB 원천을 다시 읽고 token의 frozen evidence로 strict solve한다. 새 Route 호출은 없다.
- 성공 cache는 방향을 보존한 provider 좌표 key를 사용하고, 일시 실패는 90초 negative cache로 폭주만 막는다.
- `measurementDate - 45 calendar days`를 제거하고 Canonical working-day 후보의 실제 최솟값을 조회 시작일로 사용한다.
- Preview에 필요한 pair, 동일주소, cache hit, 외부 호출, 실패/미확인 통계를 표시하고 주소 원문은 로그에 남기지 않는다.

## Route 판단 경계

- 실제 측정팀: 같은 실제 측정일에 동일 직원이 두 target에 포함된 pair만 검토한다.
- 예비조사 방문: 같은 예비조사일에 동일 수행자가 두 방문을 수행하는 pair만 검토한다.
- 유선, 단순 같은 날짜, 서로 다른 수행조, 보고서 담당만 같은 경우는 Route 대상이 아니다.
- provider 실패나 호출량 guard는 자동 정상 근거가 아니며 관련 target만 `ROUTE_EVIDENCE_REQUIRED`로 낮춘다.

## Migration ledger reconciliation

### 비교 결과

`Git migration files`, `supabase_migrations.schema_migrations`, 실제 object를 Production과 Staging에서 READ-ONLY로 비교했다.

- Reverse Planner v1/v1.1 migration 이름은 양쪽 ledger에 모두 존재한다.
- MCP 적용 당시 생성된 ledger version과 Git filename timestamp는 일치하지 않는다.
- Production/Staging의 `apply_preliminary_survey_v2_reverse_planner` 정의 hash는 모두 `6cd07482a78d9397470a6f62bc74c398`다.
- Production/Staging의 `confirm_preliminary_survey_v2_fixed_assignment` 정의 hash는 모두 `d38754ed3febb2ed31095ce43aeefd75`다.
- 양쪽 모두 fixed assignment table, planner audit table, nullable `public_sample_code` column이 존재한다.
- assignment 핵심 보호/검증 trigger 3개는 양쪽 정의가 같다.
- Staging에만 Git/Production에 없는 `trg_normalize_preliminary_survey_v2_public_sample_codes_after_g` trigger가 1개 더 존재한다.

### 안전 판단

실제 object가 일치하는 v1/v1.1 migration을 재실행하지 않는다. Ledger version을 실제 검증 없이 임의 INSERT/repair하지 않는다.
Staging 전용 추가 trigger는 현재 적용 RPC와 별개인 schema drift이므로 별도 원인 확인 전 Production에 복제하거나 Staging에서 삭제하지 않는다.
향후 CLI migration history 정합화는 `migration repair` 대상 version mapping과 Staging 전용 trigger의 출처를 확정한 뒤 별도 승인 작업으로 수행한다.

## 데이터 변경

- Production business-data write: 0
- Production backfill: 0
- 이번 Route 개선용 DB migration: 0
- Staging synthetic fixture: `ZRP9020`, `ZRP9021`의 비어 있던 좌표만 Route 검증용으로 입력했다. Production 데이터에는 복사하지 않았다.

## 검증 결과

- 단위/회귀: Route Lazy focused 8/8 PASS, 전체 `npm test` 544/544 PASS
- 정적 검증: `npx tsc --noEmit` PASS, ESLint 신규 오류 0, `npm run build` PASS, `git diff --check` PASS
- Vercel Preview 배포: READY. Deployment Protection 때문에 별도 headless session의 Preview 직접 접근은 Vercel 로그인으로 차단됐다.
- 대체 경로: 같은 Production build를 `NEXT_PHASE=phase-production-build`로 로컬 기동하여 background scheduler를 비활성화하고, Production DB는 READ-ONLY로 연결했다.
- browser mode: headless Chromium
- session: `route-lazy-local-prod-readonly` (독립 session)
- URL: `http://127.0.0.1:3212/survey`
- 사용자 Desktop 입력 사용: 0
- Orca computer 사용: 0
- 공유 Orca browser 사용: 0
- 실제 측정일 `2026-09-02`: planning target 6건, snapshot target 131건, candidate/required pair 4건, 동일주소 0건, cache hit 0건, 외부 Route 호출 4건, 성공 4건
- 화면 표시: `경로 확인: 필요 4쌍 · 동일주소 0쌍 · 캐시 0쌍 · 외부 조회 4회`, target별 차량 시간 표시 PASS
- Network: Preview POST 1건, HTTP 200
- Console error: 0
- Production 무변경 교차확인: 검증 시작 이후 planner audit, fixed assignment, plan, measurement assignment 변경 건수 모두 0
- 화면 캡처: `C:\Users\USER\orca\artifacts\route-lazy-pr82\production-readonly-preview.png`

Apply는 Production에서 실행하지 않았다. Preview token/frozen Route evidence 재사용과 Apply Route provider 0회는 focused test로 검증했으며, Staging authenticated Apply E2E는 Preview Deployment Protection 우회용 인증 수단이 없어 미검증으로 남긴다.
