-- 기존업체 예비조사 추천 확장 검증
-- 모든 점검 결과를 한 결과표에서 확인한다.

SELECT
  '1. source_rule_type 컬럼' AS check_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'preliminary_survey_plans'
      AND column_name = 'source_rule_type'
      AND is_nullable = 'NO'
  ) THEN 'OK' ELSE 'MISSING' END AS result

UNION ALL

SELECT
  '2. 기존업체 방문 가정 모드',
  CASE WHEN EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.preliminary_survey_plans'::regclass
      AND conname = 'preliminary_survey_plans_visit_mode_check'
      AND pg_get_constraintdef(oid) LIKE '%existing_field_visit%'
  ) THEN 'OK' ELSE 'MISSING' END

UNION ALL

SELECT
  '3. 추천 저장 함수',
  CASE WHEN pg_get_functiondef(
    'public.persist_preliminary_survey_recommendation(bigint,timestamp with time zone,text,integer,integer,text,date,integer,date,text,jsonb,integer,jsonb,jsonb,integer)'::regprocedure
  ) LIKE '%source_rule_type = target_rule_type%'
  THEN 'OK' ELSE 'MISSING' END

UNION ALL

SELECT
  '4. 기존 계획 분류 snapshot 누락',
  CASE WHEN NOT EXISTS (
    SELECT 1
    FROM public.preliminary_survey_plans
    WHERE source_rule_type IS NULL
  ) THEN 'OK' ELSE 'MISSING' END;
