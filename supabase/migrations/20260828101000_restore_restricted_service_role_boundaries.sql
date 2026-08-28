-- The generic Data API grant migration runs on a fresh Cloud project after
-- all historical migrations. Re-apply the intentional restricted boundaries
-- as a separate forward-only migration so already-created Staging databases
-- receive the same effective privileges as a clean replay.

REVOKE ALL ON TABLE public.preliminary_survey_v2_plans FROM service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_plans TO service_role;
REVOKE ALL ON TABLE public.preliminary_survey_v2_measurement_assignments FROM service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_measurement_assignments TO service_role;
REVOKE ALL ON TABLE public.preliminary_survey_v2_history_recovery_batches FROM service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_history_recovery_batches TO service_role;
REVOKE ALL ON TABLE public.preliminary_survey_v2_history_recovery_audit FROM service_role;
GRANT SELECT ON TABLE public.preliminary_survey_v2_history_recovery_audit TO service_role;
REVOKE ALL ON TABLE public.preliminary_survey_v2_document_repair_audit FROM service_role;
GRANT SELECT, INSERT ON TABLE public.preliminary_survey_v2_document_repair_audit TO service_role;

REVOKE ALL ON FUNCTION public.is_preliminary_survey_v2_true_confirmed(bigint) FROM service_role;
REVOKE ALL ON FUNCTION public.guard_true_confirmed_preliminary_survey_v2_plan() FROM service_role;
REVOKE ALL ON FUNCTION public.guard_true_confirmed_preliminary_survey_v2_measurement_assignment() FROM service_role;
REVOKE ALL ON FUNCTION public.validate_preliminary_survey_v2_measurement_assignment() FROM service_role;
REVOKE ALL ON FUNCTION public.admin_repair_preliminary_survey_connection_unlocked(
  bigint, jsonb, jsonb, integer, text, text
) FROM service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_unlocked(
  bigint, date, integer, integer, jsonb, jsonb, text, text, text, integer, text, text, jsonb, jsonb, jsonb
) FROM service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_batch_unlocked(jsonb) FROM service_role;
REVOKE ALL ON FUNCTION public.persist_preliminary_survey_v2_plan_and_measurement_assignments(
  jsonb, jsonb, jsonb, boolean, integer
) FROM service_role;

NOTIFY pgrst, 'reload schema';
