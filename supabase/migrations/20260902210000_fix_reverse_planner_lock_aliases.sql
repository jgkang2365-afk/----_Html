-- PL/pgSQL 변수와 resource-key query alias의 이름 충돌을 제거한다. Forward-only, no backfill.

DO $$
DECLARE
  current_definition text;
  corrected_definition text;
BEGIN
  SELECT pg_get_functiondef(proc.oid)
  INTO current_definition
  FROM pg_proc proc
  JOIN pg_namespace namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname = 'apply_preliminary_survey_v2_reverse_planner'
    AND pg_get_function_identity_arguments(proc.oid)
      = 'p_planner_run_id uuid, p_source_fingerprint text, p_canonical_sha text, p_planner_version text, p_plans jsonb, p_assignments jsonb, p_actor_user_id integer, p_override_reason text';

  IF current_definition IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42883', MESSAGE = 'REVERSE_PLANNER_APPLY_RPC_NOT_FOUND';
  END IF;

  corrected_definition := replace(
    current_definition,
    E'      SELECT CASE WHEN plan_item->>''survey_method'' = ''phone''\n        THEN ''reverse-planner-survey|phone|'' || plan_item->>''preliminary_date'' || ''|'' || plan_item->>''responsible_user_id''\n        ELSE ''reverse-planner-survey|field|'' || plan_item->>''preliminary_date'' || ''|'' || participant.value\n      END AS lock_key\n      FROM jsonb_array_elements(p_plans) plan_item\n      LEFT JOIN LATERAL jsonb_array_elements_text(\n        CASE WHEN plan_item->>''survey_method'' = ''field'' THEN plan_item->''participant_user_ids'' ELSE ''[null]''::jsonb END\n      ) participant ON true\n      UNION ALL\n      SELECT ''reverse-planner-public-group|'' || assignment_item->>''measurement_date'' || ''|'' || assignment_item->>''assignee_user_id''\n      FROM jsonb_array_elements(p_assignments) assignment_item',
    E'      SELECT CASE WHEN plan_payload.value->>''survey_method'' = ''phone''\n        THEN ''reverse-planner-survey|phone|'' || plan_payload.value->>''preliminary_date'' || ''|'' || plan_payload.value->>''responsible_user_id''\n        ELSE ''reverse-planner-survey|field|'' || plan_payload.value->>''preliminary_date'' || ''|'' || participant.value\n      END AS lock_key\n      FROM jsonb_array_elements(p_plans) plan_payload(value)\n      LEFT JOIN LATERAL jsonb_array_elements_text(\n        CASE WHEN plan_payload.value->>''survey_method'' = ''field'' THEN plan_payload.value->''participant_user_ids'' ELSE ''[null]''::jsonb END\n      ) participant ON true\n      UNION ALL\n      SELECT ''reverse-planner-public-group|'' || assignment_payload.value->>''measurement_date'' || ''|'' || assignment_payload.value->>''assignee_user_id''\n      FROM jsonb_array_elements(p_assignments) assignment_payload(value)'
  );

  IF corrected_definition = current_definition
     OR position('plan_payload.value' IN corrected_definition) = 0
     OR position('assignment_payload.value' IN corrected_definition) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'REVERSE_PLANNER_LOCK_ALIAS_PATCH_NOT_APPLIED';
  END IF;
  EXECUTE corrected_definition;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_preliminary_survey_v2_reverse_planner(
  uuid, text, text, text, jsonb, jsonb, integer, text
) TO service_role;

NOTIFY pgrst, 'reload schema';
