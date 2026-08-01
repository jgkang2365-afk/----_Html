SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('preliminary_survey_plans', 'user_schedule_blocks');

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'uq_preliminary_survey_plans_one_active',
    'idx_preliminary_survey_plans_workload',
    'idx_user_schedule_blocks_user_dates'
  )
ORDER BY indexname;

SELECT p.proname, pg_get_function_identity_arguments(p.oid)
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'persist_preliminary_survey_recommendation',
    'confirm_preliminary_survey_plan',
    'cancel_preliminary_survey_plan'
  )
ORDER BY p.proname;

SELECT name, is_preliminary_survey_experienced,
  is_preliminary_survey_support_assignable, is_active, job
FROM public.users
WHERE name IN ('이태환', '한기문', '이주형', '강종구', '고유빈', '김민영', '배윤민')
ORDER BY name;

-- 기존 테이블은 구조나 데이터가 변경되지 않았는지 별도로 비교한다.
SELECT COUNT(*) AS legacy_preliminary_survey_count FROM public.preliminary_survey;
