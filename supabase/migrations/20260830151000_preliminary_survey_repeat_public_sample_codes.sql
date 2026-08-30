-- 동일일 동일 측정자 공시료 코드: A/AA (관리자 명시 예외만 AAA)로 저장한다.
-- 기존 행은 재작성하지 않는다. 새 apply 또는 관리자 예외에서만 새 규칙을 사용한다.
ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  DROP CONSTRAINT IF EXISTS preliminary_survey_v2_measurement_assignments_survey_code_check;
ALTER TABLE public.preliminary_survey_v2_measurement_assignments
  ADD CONSTRAINT preliminary_survey_v2_measurement_assignments_survey_code_check
  CHECK (survey_code IN ('A','AA','AAA','B','BB','BBB','C','CC','CCC','D','DD','DDD','F','FF','FFF','G','GG','GGG'));

COMMENT ON COLUMN public.preliminary_survey_v2_measurement_assignments.survey_code IS
  'users.survey_code의 반복 코드 snapshot. 1건 A, 2건 AA, 3건 AAA는 관리자 직접 예외만 허용한다.';

CREATE OR REPLACE FUNCTION public.validate_preliminary_survey_v2_measurement_assignment()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  configured_survey_code text;
BEGIN
  SELECT upper(btrim(COALESCE(survey_code, ''))) INTO configured_survey_code
    FROM public.users WHERE id = NEW.assignee_user_id AND is_active IS NOT FALSE;
  IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED';
  END IF;
  IF NEW.survey_code NOT IN (
    configured_survey_code,
    configured_survey_code || configured_survey_code,
    configured_survey_code || configured_survey_code || configured_survey_code
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH';
  END IF;
  NEW.survey_code_source := 'users.survey_code';
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

-- 현재 Workbench가 사용하는 assignment-group RPC의 기존 optimistic-lock, approval, audit
-- 불변식은 base로 보존한다. wrapper는 입력 코드를 base code로 정규화해 검증을 재사용하고,
-- 이번 apply 대상 row에만 반복 코드를 부여한다. 기존 확정/과거 row를 일괄 재작성하지 않는다.
ALTER FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(jsonb, jsonb, jsonb, boolean, integer)
  RENAME TO persist_preliminary_survey_v2_plan_and_assignment_groups_base;

CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(
  p_plans jsonb,
  p_assignments jsonb,
  p_assignment_baseline jsonb,
  p_approve_third_assignment boolean DEFAULT false,
  p_approved_by_user_id integer DEFAULT NULL
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment_item jsonb;
  configured_survey_code text;
  base_assignments jsonb;
BEGIN
  -- 3번째는 자동추천·예비조사 담당자 승인이 아닌 관리자 직접 예외만 허용한다.
  IF p_approve_third_assignment IS TRUE AND NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_approved_by_user_id AND role = '관리자'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED';
  END IF;

  FOR assignment_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) LOOP
    SELECT upper(btrim(COALESCE(survey_code, ''))) INTO configured_survey_code
      FROM public.users WHERE id = (assignment_item->>'assignee_user_id')::integer AND is_active IS NOT FALSE;
    IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G')
       OR upper(btrim(COALESCE(assignment_item->>'survey_code', ''))) <> repeat(
         configured_survey_code, char_length(upper(btrim(COALESCE(assignment_item->>'survey_code', ''))))
       )
       OR char_length(upper(btrim(COALESCE(assignment_item->>'survey_code', '')))) NOT BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH';
    END IF;
    IF char_length(upper(btrim(assignment_item->>'survey_code'))) = 3 AND p_approve_third_assignment IS NOT TRUE THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED';
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_agg(
    assignment_item || jsonb_build_object('survey_code', left(upper(btrim(assignment_item->>'survey_code')), 1)
  ), '[]'::jsonb) INTO base_assignments
  FROM jsonb_array_elements(COALESCE(p_assignments, '[]'::jsonb)) assignment_item;

  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_and_assignment_groups_base(
    p_plans, base_assignments, p_assignment_baseline, p_approve_third_assignment, p_approved_by_user_id
  );

  WITH affected_targets AS (
    SELECT DISTINCT (plan_item->>'measurement_target_business_id')::bigint AS target_id
    FROM jsonb_array_elements(p_plans) plan_item
  ), ranked AS (
    SELECT assignment.id, target_plan.measurement_target_business_id AS target_id,
      repeat(upper(btrim(user_row.survey_code)),
      row_number() OVER (
        PARTITION BY assignment.measurement_date, assignment.assignee_user_id
        -- 기존 row를 먼저 두어 새 apply만 CC/CCC로 바꾸고 과거 row는 보존한다.
        ORDER BY (target_plan.measurement_target_business_id IN (SELECT target_id FROM affected_targets)),
          assignment.created_at, target_plan.measurement_target_business_id
      )::integer) AS next_survey_code
    FROM public.preliminary_survey_v2_measurement_assignments assignment
    JOIN public.preliminary_survey_v2_plans target_plan ON target_plan.id = assignment.plan_id
    JOIN public.users user_row ON user_row.id = assignment.assignee_user_id
    WHERE assignment.measurement_date IN (
      SELECT DISTINCT (item->>'measurement_date')::date FROM jsonb_array_elements(p_assignments) item
    )
  )
  UPDATE public.preliminary_survey_v2_measurement_assignments assignment
    SET survey_code = ranked.next_survey_code
    FROM ranked
    JOIN affected_targets ON affected_targets.target_id = ranked.target_id
    WHERE assignment.id = ranked.id
      AND assignment.survey_code IS DISTINCT FROM ranked.next_survey_code;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups_base(jsonb, jsonb, jsonb, boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(jsonb, jsonb, jsonb, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_and_assignment_groups(jsonb, jsonb, jsonb, boolean, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback (별도 승인 후): wrapper를 DROP하고 base 함수를 원래 이름으로 rename한 뒤,
-- survey_code CHECK/trigger 정의를 20260823130000 이전 검증본으로 복원한다. 기존 데이터 DELETE/UPDATE는 없다.
