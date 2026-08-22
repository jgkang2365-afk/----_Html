-- 예비조사 V2 plan에 귀속되는 날짜별 측정자(공시료) 배정 원천.
-- 기존 20260822_* migration은 수정·재실행하지 않는다.
-- Rollback(운영 적용 후 별도 승인): 앱을 이전 버전으로 되돌린 뒤 이 파일이 만든 RPC,
-- trigger, table 순으로 제거한다. 기존 plan/찐확정 lock migration은 제거하지 않는다.

CREATE TABLE IF NOT EXISTS public.preliminary_survey_v2_measurement_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.preliminary_survey_v2_plans(id) ON DELETE CASCADE,
  measurement_date date NOT NULL,
  assignee_user_id integer NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  survey_code text NOT NULL CHECK (survey_code IN ('A', 'B', 'C', 'D', 'F', 'G')),
  survey_code_source text NOT NULL DEFAULT 'users.survey_code'
    CHECK (survey_code_source = 'users.survey_code'),
  assignment_reason text NOT NULL CHECK (btrim(assignment_reason) <> ''),
  approval_required boolean NOT NULL DEFAULT false,
  approved_by_user_id integer REFERENCES public.users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_preliminary_survey_v2_assignment_plan_date UNIQUE (plan_id, measurement_date),
  CONSTRAINT preliminary_survey_v2_assignment_approval_check CHECK (
    (approval_required = false AND approved_by_user_id IS NULL AND approved_at IS NULL)
    OR (approval_required = true AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_preliminary_survey_v2_assignment_date_assignee
  ON public.preliminary_survey_v2_measurement_assignments(measurement_date, assignee_user_id);

COMMENT ON TABLE public.preliminary_survey_v2_measurement_assignments IS
  '예비조사 V2 plan별·실제 측정일별 공시료 담당자 원천. 예비조사자/보고서 담당자와 분리한다.';
COMMENT ON COLUMN public.preliminary_survey_v2_measurement_assignments.survey_code IS
  '저장 시 users.survey_code와 일치 검증한 A/B/C/D/F/G 공시료 코드 snapshot.';

CREATE OR REPLACE FUNCTION public.is_preliminary_survey_v2_true_confirmed(p_target_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.measurement_target_business business
    JOIN public.measurement_journal journal
      ON journal.code = business.code
     AND journal.measurement_year = business.year
     AND btrim(replace(journal.measurement_period, '(수시)', '')) = btrim(replace(business.period, '(수시)', ''))
    WHERE business.id = p_target_id
  );
$$;

-- app.* custom setting은 service_role도 임의 설정할 수 있으므로 bypass가 아니다.
-- 기존 관리자 repair SECURITY DEFINER wrapper의 owner(postgres)에서만 flag를 인정한다.
CREATE OR REPLACE FUNCTION public.guard_true_confirmed_preliminary_survey_v2_plan()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  old_target_id bigint := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.measurement_target_business_id END;
  new_target_id bigint := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.measurement_target_business_id END;
BEGIN
  IF current_setting('app.preliminary_survey_admin_repair', true) = 'on' AND current_user = 'postgres' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF (old_target_id IS NOT NULL AND public.is_preliminary_survey_v2_true_confirmed(old_target_id))
     OR (new_target_id IS NOT NULL AND public.is_preliminary_survey_v2_true_confirmed(new_target_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_LOCKED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_true_confirmed_preliminary_survey_v2_measurement_assignment()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  old_target_id bigint;
  new_target_id bigint;
BEGIN
  IF current_setting('app.preliminary_survey_admin_repair', true) = 'on' AND current_user = 'postgres' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT measurement_target_business_id INTO old_target_id
    FROM public.preliminary_survey_v2_plans WHERE id = OLD.plan_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT measurement_target_business_id INTO new_target_id
    FROM public.preliminary_survey_v2_plans WHERE id = NEW.plan_id;
  END IF;
  IF (old_target_id IS NOT NULL AND public.is_preliminary_survey_v2_true_confirmed(old_target_id))
     OR (new_target_id IS NOT NULL AND public.is_preliminary_survey_v2_true_confirmed(new_target_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'TRUE_CONFIRMED_LOCKED';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_true_confirmed_preliminary_survey_v2_plan ON public.preliminary_survey_v2_plans;
CREATE TRIGGER trg_guard_true_confirmed_preliminary_survey_v2_plan
BEFORE INSERT OR UPDATE OR DELETE ON public.preliminary_survey_v2_plans
FOR EACH ROW EXECUTE FUNCTION public.guard_true_confirmed_preliminary_survey_v2_plan();

DROP TRIGGER IF EXISTS trg_guard_true_confirmed_preliminary_survey_v2_measurement_assignment
  ON public.preliminary_survey_v2_measurement_assignments;
CREATE TRIGGER trg_guard_true_confirmed_preliminary_survey_v2_measurement_assignment
BEFORE INSERT OR UPDATE OR DELETE ON public.preliminary_survey_v2_measurement_assignments
FOR EACH ROW EXECUTE FUNCTION public.guard_true_confirmed_preliminary_survey_v2_measurement_assignment();

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
  IF NEW.survey_code IS DISTINCT FROM configured_survey_code THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH';
  END IF;
  NEW.survey_code := configured_survey_code;
  NEW.survey_code_source := 'users.survey_code';
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_preliminary_survey_v2_measurement_assignment
  ON public.preliminary_survey_v2_measurement_assignments;
CREATE TRIGGER trg_validate_preliminary_survey_v2_measurement_assignment
BEFORE INSERT OR UPDATE ON public.preliminary_survey_v2_measurement_assignments
FOR EACH ROW EXECUTE FUNCTION public.validate_preliminary_survey_v2_measurement_assignment();

CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
  p_plans jsonb,
  p_assignments jsonb,
  p_assignment_baseline jsonb,
  p_approve_third_assignment boolean DEFAULT false,
  p_approved_by_user_id integer DEFAULT NULL
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  assignment jsonb;
  plan jsonb;
  business_row public.measurement_target_business;
  configured_survey_code text;
  legacy_plans jsonb;
  expected_measurement_dates text[];
  current_assignment_baseline jsonb;
  approval_required_for_group boolean;
  approval_required_for_assignment boolean;
  existing_approval_preserved boolean;
  existing_approved_by_user_id integer;
  existing_approved_at timestamptz;
BEGIN
  IF p_plans IS NULL OR jsonb_typeof(p_plans) <> 'array' OR jsonb_array_length(p_plans) = 0
     OR p_assignments IS NULL OR jsonb_typeof(p_assignments) <> 'array'
     OR p_assignment_baseline IS NULL OR jsonb_typeof(p_assignment_baseline) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_PLAN_ASSIGNMENT_PAYLOAD';
  END IF;
  IF p_approve_third_assignment AND NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_approved_by_user_id
      AND (role = '관리자' OR is_preliminary_survey_manager IS TRUE)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_ASSIGNMENT_APPROVER';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_assignments) item
    GROUP BY item->>'measurement_target_business_id', item->>'measurement_date'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DUPLICATE_MEASUREMENT_ASSIGNMENT';
  END IF;

  -- 같은 측정일 전체를 직렬화한다. 서로 다른 측정자를 골랐더라도 균등배정 snapshot이
  -- 바뀌는 동시 apply를 허용하지 않는다.
  FOR assignment IN
    SELECT DISTINCT jsonb_build_object('measurement_date', value->>'measurement_date')
    FROM jsonb_array_elements(p_assignments)
    ORDER BY jsonb_build_object('measurement_date', value->>'measurement_date')
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'preliminary-measurement-assignment|' || COALESCE(assignment->>'measurement_date', ''), 0));
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'targetId', existing_plan.measurement_target_business_id,
      'measurementDate', existing.measurement_date::text,
      'userId', existing.assignee_user_id
    ) ORDER BY existing_plan.measurement_target_business_id, existing.measurement_date, existing.assignee_user_id), '[]'::jsonb)
  INTO current_assignment_baseline
  FROM public.preliminary_survey_v2_measurement_assignments existing
  JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing.plan_id
  WHERE existing.measurement_date IN (
    SELECT DISTINCT (item->>'measurement_date')::date FROM jsonb_array_elements(p_assignments) item
  ) AND existing_plan.measurement_target_business_id NOT IN (
    SELECT DISTINCT (item->>'measurement_target_business_id')::bigint FROM jsonb_array_elements(p_plans) item
  );
  IF current_assignment_baseline IS DISTINCT FROM p_assignment_baseline THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DRAFT_ASSIGNMENT_BASELINE_CHANGED';
  END IF;

  FOR plan IN SELECT value FROM jsonb_array_elements(p_plans) LOOP
    IF (plan->>'measurement_target_business_id') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PLAN_BUSINESS_ID_REQUIRED';
    END IF;
    SELECT * INTO business_row FROM public.measurement_target_business
      WHERE id = (plan->>'measurement_target_business_id')::bigint FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'TARGET_NOT_FOUND'; END IF;
    IF (plan->>'source_address') IS DISTINCT FROM business_row.address
       OR COALESCE(plan->'source_daily_staff', 'null'::jsonb) IS DISTINCT FROM COALESCE(business_row.daily_staff, 'null'::jsonb)
       OR (plan->>'source_collaborators') IS DISTINCT FROM business_row.collaborators THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'DRAFT_SOURCE_CONTEXT_CHANGED';
    END IF;
    IF business_row.measurement_end_date IS NOT NULL
       AND business_row.measurement_end_date::date <> business_row.measurement_date::date THEN
      IF business_row.daily_staff IS NULL OR jsonb_typeof(business_row.daily_staff) <> 'array' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
      END IF;
      SELECT array_agg(DISTINCT day->>'date' ORDER BY day->>'date') INTO expected_measurement_dates
      FROM jsonb_array_elements(business_row.daily_staff) day
      WHERE day->>'date' ~ '^\d{4}-\d{2}-\d{2}$';
      IF cardinality(expected_measurement_dates) < 2
         OR expected_measurement_dates[1] <> business_row.measurement_date::text
         OR expected_measurement_dates[cardinality(expected_measurement_dates)] <> business_row.measurement_end_date::text
         OR cardinality(expected_measurement_dates) <> jsonb_array_length(business_row.daily_staff) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
      END IF;
    ELSE
      expected_measurement_dates := ARRAY[business_row.measurement_date::text];
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'measurement_target_business_id')::bigint = business_row.id
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PLAN_MEASUREMENT_ASSIGNMENT_REQUIRED';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) item
      WHERE (item->>'measurement_target_business_id')::bigint = business_row.id
        AND NOT (item->>'measurement_date' = ANY(expected_measurement_dates))
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DATE_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(expected_measurement_dates) expected_date WHERE NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_assignments) item
        WHERE (item->>'measurement_target_business_id')::bigint = business_row.id
          AND item->>'measurement_date' = expected_date
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_DAILY_STAFF_INCOMPLETE';
    END IF;
  END LOOP;

  FOR assignment IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
    IF (assignment->>'measurement_target_business_id') IS NULL OR (assignment->>'measurement_date') IS NULL
       OR (assignment->>'assignee_user_id') IS NULL OR (assignment->>'survey_code') NOT IN ('A', 'B', 'C', 'D', 'F', 'G')
       OR btrim(COALESCE(assignment->>'assignment_reason', '')) = '' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'INVALID_MEASUREMENT_ASSIGNMENT_PAYLOAD';
    END IF;
    SELECT upper(btrim(COALESCE(survey_code, ''))) INTO configured_survey_code
    FROM public.users WHERE id = (assignment->>'assignee_user_id')::integer AND is_active IS NOT FALSE;
    IF configured_survey_code NOT IN ('A', 'B', 'C', 'D', 'F', 'G') OR configured_survey_code <> assignment->>'survey_code' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_SURVEY_CODE_MISMATCH';
    END IF;
  END LOOP;

  -- client의 approval_required는 저장 근거가 아니다. 이번 apply 후 남는 전체
  -- (측정일, 측정자) 그룹을 target ID 순으로 결정해 세 번째부터만 승인 대상으로 한다.
  -- 이미 같은 row에 기록된 승인은 재저장으로 지우지 않는다.
  WITH final_rows AS (
    SELECT existing_plan.measurement_target_business_id AS target_id,
      existing.measurement_date, existing.assignee_user_id, false AS is_proposed
    FROM public.preliminary_survey_v2_measurement_assignments existing
    JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing.plan_id
    WHERE existing_plan.measurement_target_business_id NOT IN (
      SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
      FROM jsonb_array_elements(p_plans) item
    )
    UNION ALL
    SELECT (item->>'measurement_target_business_id')::bigint,
      (item->>'measurement_date')::date, (item->>'assignee_user_id')::integer, true
    FROM jsonb_array_elements(p_assignments) item
  ), numbered_rows AS (
    SELECT *, row_number() OVER (
      PARTITION BY measurement_date, assignee_user_id ORDER BY is_proposed, target_id
    ) AS assignment_position
    FROM final_rows
  )
  SELECT EXISTS (
    SELECT 1
    FROM numbered_rows numbered
    WHERE numbered.is_proposed
      AND numbered.assignment_position > 2
      AND NOT EXISTS (
        SELECT 1
        FROM public.preliminary_survey_v2_measurement_assignments existing
        JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing.plan_id
        WHERE existing_plan.measurement_target_business_id = numbered.target_id
          AND existing.measurement_date = numbered.measurement_date
          AND existing.assignee_user_id = numbered.assignee_user_id
          AND existing.approval_required IS TRUE
      )
  ) INTO approval_required_for_group;
  IF approval_required_for_group AND (p_approve_third_assignment IS NOT TRUE OR p_approved_by_user_id IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED';
  END IF;

  SELECT jsonb_agg(plan || jsonb_build_object('target' || '_id', plan->'measurement_target_business_id'))
    INTO legacy_plans FROM jsonb_array_elements(p_plans) plan;
  -- 새 plan은 이 원자 RPC만 생성한다. 구형 wrapper는 아래에서 기존 plan 수정 전용으로 제한한다.
  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_batch_unlocked(legacy_plans);

  DELETE FROM public.preliminary_survey_v2_measurement_assignments existing
  USING public.preliminary_survey_v2_plans plan
  WHERE existing.plan_id = plan.id
    AND plan.measurement_target_business_id IN (
      SELECT (item->>'measurement_target_business_id')::bigint FROM jsonb_array_elements(p_plans) item
    )
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_assignments) proposed
      WHERE (proposed->>'measurement_target_business_id')::bigint = plan.measurement_target_business_id
        AND proposed->>'measurement_date' = existing.measurement_date::text
    );

  FOR assignment IN SELECT value FROM jsonb_array_elements(p_assignments) LOOP
    WITH final_rows AS (
      SELECT existing_plan.measurement_target_business_id AS target_id,
        existing.measurement_date, existing.assignee_user_id, false AS is_proposed
      FROM public.preliminary_survey_v2_measurement_assignments existing
      JOIN public.preliminary_survey_v2_plans existing_plan ON existing_plan.id = existing.plan_id
      WHERE existing_plan.measurement_target_business_id NOT IN (
        SELECT DISTINCT (item->>'measurement_target_business_id')::bigint
        FROM jsonb_array_elements(p_plans) item
      )
      UNION ALL
      SELECT (item->>'measurement_target_business_id')::bigint,
        (item->>'measurement_date')::date, (item->>'assignee_user_id')::integer, true
      FROM jsonb_array_elements(p_assignments) item
    ), numbered_rows AS (
      SELECT *, row_number() OVER (
      PARTITION BY measurement_date, assignee_user_id ORDER BY is_proposed, target_id
      ) AS assignment_position
      FROM final_rows
    )
    SELECT numbered.assignment_position > 2,
      COALESCE(existing.approval_required, false), existing.approved_by_user_id, existing.approved_at
    INTO approval_required_for_assignment, existing_approval_preserved,
      existing_approved_by_user_id, existing_approved_at
    FROM numbered_rows numbered
    LEFT JOIN public.preliminary_survey_v2_plans existing_plan
      ON existing_plan.measurement_target_business_id = numbered.target_id
    LEFT JOIN public.preliminary_survey_v2_measurement_assignments existing
      ON existing.plan_id = existing_plan.id
     AND existing.measurement_date = numbered.measurement_date
     AND existing.assignee_user_id = numbered.assignee_user_id
    WHERE numbered.is_proposed
      AND numbered.target_id = (assignment->>'measurement_target_business_id')::bigint
      AND numbered.measurement_date = (assignment->>'measurement_date')::date
      AND numbered.assignee_user_id = (assignment->>'assignee_user_id')::integer;
    existing_approval_preserved := approval_required_for_assignment AND existing_approval_preserved;

    INSERT INTO public.preliminary_survey_v2_measurement_assignments (
      plan_id, measurement_date, assignee_user_id, survey_code, assignment_reason,
      approval_required, approved_by_user_id, approved_at
    ) SELECT plan.id, (assignment->>'measurement_date')::date,
      (assignment->>'assignee_user_id')::integer, assignment->>'survey_code', assignment->>'assignment_reason',
      approval_required_for_assignment,
      CASE WHEN existing_approval_preserved THEN existing_approved_by_user_id
        WHEN approval_required_for_assignment THEN p_approved_by_user_id ELSE NULL END,
      CASE WHEN existing_approval_preserved THEN existing_approved_at
        WHEN approval_required_for_assignment THEN CURRENT_TIMESTAMP ELSE NULL END
    FROM public.preliminary_survey_v2_plans plan
    WHERE plan.measurement_target_business_id = (assignment->>'measurement_target_business_id')::bigint
    ON CONFLICT (plan_id, measurement_date) DO UPDATE SET
      assignee_user_id = EXCLUDED.assignee_user_id,
      survey_code = EXCLUDED.survey_code,
      survey_code_source = EXCLUDED.survey_code_source,
      assignment_reason = EXCLUDED.assignment_reason,
      approval_required = EXCLUDED.approval_required,
      approved_by_user_id = EXCLUDED.approved_by_user_id,
      approved_at = EXCLUDED.approved_at,
      updated_at = CURRENT_TIMESTAMP;
  END LOOP;
  RETURN;
END;
$$;

-- legacy API는 기존 plan의 수동 예비조사 필드만 수정할 수 있다. 새 plan을 assignment 없이
-- 만드는 우회 경로는 차단하며, 기존 assignment 행은 건드리지 않는다.
CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan_batch(p_plans jsonb)
RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_plans, '[]'::jsonb)) item
    WHERE item->>'plan_origin' <> 'manual'
       OR NOT EXISTS (
      SELECT 1 FROM public.preliminary_survey_v2_plans existing
      WHERE existing.measurement_target_business_id = (item->>'target_id')::bigint
        AND existing.source_measurement_date IS NOT DISTINCT FROM (item->>'source_measurement_date')::date
        AND existing.source_rule_type IS NOT DISTINCT FROM item->>'source_rule_type'
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_PLAN_CREATE_DISABLED';
  END IF;
  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_batch_unlocked(p_plans);
END;
$$;

CREATE OR REPLACE FUNCTION public.persist_preliminary_survey_v2_plan(
  p_target_id bigint, p_recommended_date date, p_responsible_user_id integer,
  p_experienced_reviewer_id integer, p_participant_user_ids jsonb, p_participant_names jsonb,
  p_status text, p_plan_origin text, p_source_measurement_date text,
  p_source_responsible_user_id integer, p_source_rule_type text, p_survey_method text,
  p_recommendation_reason jsonb, p_route_evidence jsonb, p_warnings jsonb
) RETURNS SETOF public.preliminary_survey_v2_plans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.preliminary_survey_v2_plans
    WHERE measurement_target_business_id = p_target_id
      AND p_plan_origin = 'manual'
      AND source_measurement_date IS NOT DISTINCT FROM p_source_measurement_date::date
      AND source_rule_type IS NOT DISTINCT FROM p_source_rule_type
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'LEGACY_PLAN_CREATE_DISABLED';
  END IF;
  RETURN QUERY SELECT * FROM public.persist_preliminary_survey_v2_plan_unlocked(
    p_target_id, p_recommended_date, p_responsible_user_id, p_experienced_reviewer_id,
    p_participant_user_ids, p_participant_names, p_status, p_plan_origin,
    p_source_measurement_date, p_source_responsible_user_id, p_source_rule_type,
    p_survey_method, p_recommendation_reason, p_route_evidence, p_warnings
  );
END;
$$;

ALTER TABLE public.preliminary_survey_v2_measurement_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.preliminary_survey_v2_plans FROM service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_plans TO service_role;
REVOKE ALL ON TABLE public.preliminary_survey_v2_measurement_assignments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_measurement_assignments TO service_role;
REVOKE ALL ON FUNCTION public.is_preliminary_survey_v2_true_confirmed(bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_true_confirmed_preliminary_survey_v2_plan() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_true_confirmed_preliminary_survey_v2_measurement_assignment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_preliminary_survey_v2_measurement_assignment() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb, jsonb, jsonb, boolean, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb, jsonb, jsonb, boolean, integer)
  TO service_role;

NOTIFY pgrst, 'reload schema';

-- Rollback SQL (별도 승인 후 실행):
-- REVOKE EXECUTE ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb,jsonb,jsonb,boolean,integer) FROM service_role;
-- DROP FUNCTION IF EXISTS public.persist_preliminary_survey_v2_plan_and_measurement_assignments(jsonb,jsonb,jsonb,boolean,integer);
-- DROP TRIGGER IF EXISTS trg_validate_preliminary_survey_v2_measurement_assignment ON public.preliminary_survey_v2_measurement_assignments;
-- DROP TRIGGER IF EXISTS trg_guard_true_confirmed_preliminary_survey_v2_measurement_assignment ON public.preliminary_survey_v2_measurement_assignments;
-- DROP TABLE IF EXISTS public.preliminary_survey_v2_measurement_assignments;
-- 이후 plan guard는 직전 검증 완료 migration 정의로 복원한다.
