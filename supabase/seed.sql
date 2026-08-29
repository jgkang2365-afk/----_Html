-- Deterministic synthetic fixtures for Local and Cloud Staging only.
-- No production row, PII, password, password hash, or session is copied here.
BEGIN;

-- Reset only the reserved synthetic fixture namespace so this seed is safe to
-- rerun in Local and Staging. Historical/confirmed guards require this order.
DELETE FROM public.preliminary_survey_v2_document_repair_audit
WHERE measurement_target_business_id BETWEEN 10001 AND 10025;

DELETE FROM public.preliminary_survey_v2_legacy_reconciliation
WHERE measurement_target_business_id BETWEEN 10001 AND 10025;

DELETE FROM public.measurement_journal
WHERE code LIKE 'SYN%';

DELETE FROM public.preliminary_survey
WHERE code LIKE 'SYN%';

DELETE FROM public.preliminary_survey_v2_plans
WHERE measurement_target_business_id BETWEEN 10001 AND 10025;

DELETE FROM public.user_schedule_blocks
WHERE note = 'Synthetic unavailable fixture';

DELETE FROM public.measurement_target_business
WHERE id BETWEEN 10001 AND 10025 OR code LIKE 'SYN%';

DELETE FROM public.business_info
WHERE code LIKE 'SYN%';

DELETE FROM public.users
WHERE id BETWEEN 9000 AND 9999;

INSERT INTO public.users (
  id, name, role, job, password_hash, survey_code, is_active,
  is_preliminary_survey_experienced, is_preliminary_survey_manager,
  is_preliminary_survey_support_assignable
) VALUES
  (9001, 'STAGING Admin Tester', '관리자', '측정', NULL, NULL, true, true, true, true),
  (9002, 'STAGING Preliminary Manager Tester', '사용자', '측정', NULL, NULL, true, true, true, true),
  (9101, 'Synthetic Surveyor A', '사용자', '측정', NULL, 'A', true, true, false, true),
  (9102, 'Synthetic Surveyor B', '사용자', '측정', NULL, 'B', true, true, false, true),
  (9103, 'Synthetic Surveyor C', '사용자', '측정', NULL, 'C', true, false, false, true),
  (9104, 'Synthetic Surveyor D', '사용자', '측정', NULL, 'D', true, true, false, true),
  (9105, 'Synthetic Surveyor F', '사용자', '측정', NULL, 'F', true, true, false, true),
  (9106, 'Synthetic Surveyor G', '사용자', '측정', NULL, 'G', true, true, false, true)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  job = EXCLUDED.job,
  password_hash = NULL,
  survey_code = EXCLUDED.survey_code,
  is_active = EXCLUDED.is_active,
  is_preliminary_survey_experienced = EXCLUDED.is_preliminary_survey_experienced,
  is_preliminary_survey_manager = EXCLUDED.is_preliminary_survey_manager,
  is_preliminary_survey_support_assignable = EXCLUDED.is_preliminary_survey_support_assignable;

WITH fixtures(code, business_name, business_type) AS (
  VALUES
    ('SYN001', 'Synthetic Existing Business', '기존업체'),
    ('SYN002', 'Synthetic First Measurement', '최초실시'),
    ('SYN003', 'Synthetic External New', '타기관 신규'),
    ('SYN004', 'Synthetic Single Day', '기존업체'),
    ('SYN005', 'Synthetic Multi Day', '기존업체'),
    ('SYN006', 'Synthetic Writer Participates', '기존업체'),
    ('SYN007', 'Synthetic Writer Missing', '기존업체'),
    ('SYN008', 'Synthetic Staff Block', '기존업체'),
    ('SYN009', 'Synthetic Unrecommended', '기존업체'),
    ('SYN010', 'Synthetic Provisional Plan', '기존업체'),
    ('SYN011', 'Synthetic True Confirmed', '기존업체'),
    ('SYN012', 'Synthetic Confirmed Date Missing', '기존업체'),
    ('SYN013', 'Synthetic Confirmed Surveyor Missing', '기존업체'),
    ('SYN014', 'Synthetic Assignment Group One', '기존업체'),
    ('SYN015', 'Synthetic Assignment Group Two A', '기존업체'),
    ('SYN016', 'Synthetic Assignment Group Two B', '기존업체'),
    ('SYN017', 'Synthetic Assignment Group Three A', '기존업체'),
    ('SYN018', 'Synthetic Assignment Group Three B', '기존업체'),
    ('SYN019', 'Synthetic Assignment Group Three C', '기존업체'),
    ('SYN020', 'Synthetic Assignment Group Four A', '기존업체'),
    ('SYN021', 'Synthetic Assignment Group Four B', '기존업체'),
    ('SYN022', 'Synthetic Assignment Group Four C', '기존업체'),
    ('SYN023', 'Synthetic Assignment Group Four D', '기존업체'),
    ('SYN024', 'Synthetic Deletable Plan', '기존업체'),
    ('SYN025', 'Synthetic History Protected Plan', '기존업체')
)
INSERT INTO public.business_info (
  code, business_name, business_type, address1, business_number, year
)
SELECT
  code, business_name, business_type,
  '서울특별시 테스트구 검증로 ' || substring(code from 4)::integer,
  lpad((1000000000 + substring(code from 4)::integer)::text, 10, '0'),
  2026
FROM fixtures
ON CONFLICT (code) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  business_type = EXCLUDED.business_type,
  address1 = EXCLUDED.address1,
  business_number = EXCLUDED.business_number,
  year = EXCLUDED.year;

WITH fixtures(id, code, business_name, business_type, rule_type) AS (
  VALUES
    (10001, 'SYN001', 'Synthetic Existing Business', 'existing', 'existing'),
    (10002, 'SYN002', 'Synthetic First Measurement', 'first_measurement', 'general_new'),
    (10003, 'SYN003', 'Synthetic External New', 'external_new', 'other_org_new'),
    (10004, 'SYN004', 'Synthetic Single Day', 'existing', 'existing'),
    (10005, 'SYN005', 'Synthetic Multi Day', 'existing', 'existing'),
    (10006, 'SYN006', 'Synthetic Writer Participates', 'existing', 'existing'),
    (10007, 'SYN007', 'Synthetic Writer Missing', 'existing', 'existing'),
    (10008, 'SYN008', 'Synthetic Staff Block', 'existing', 'existing'),
    (10009, 'SYN009', 'Synthetic Unrecommended', 'existing', 'existing'),
    (10010, 'SYN010', 'Synthetic Provisional Plan', 'existing', 'existing'),
    (10011, 'SYN011', 'Synthetic True Confirmed', 'existing', 'existing'),
    (10012, 'SYN012', 'Synthetic Confirmed Date Missing', 'existing', 'existing'),
    (10013, 'SYN013', 'Synthetic Confirmed Surveyor Missing', 'existing', 'existing'),
    (10014, 'SYN014', 'Synthetic Assignment Group One', 'existing', 'existing'),
    (10015, 'SYN015', 'Synthetic Assignment Group Two A', 'existing', 'existing'),
    (10016, 'SYN016', 'Synthetic Assignment Group Two B', 'existing', 'existing'),
    (10017, 'SYN017', 'Synthetic Assignment Group Three A', 'existing', 'existing'),
    (10018, 'SYN018', 'Synthetic Assignment Group Three B', 'existing', 'existing'),
    (10019, 'SYN019', 'Synthetic Assignment Group Three C', 'existing', 'existing'),
    (10020, 'SYN020', 'Synthetic Assignment Group Four A', 'existing', 'existing'),
    (10021, 'SYN021', 'Synthetic Assignment Group Four B', 'existing', 'existing'),
    (10022, 'SYN022', 'Synthetic Assignment Group Four C', 'existing', 'existing'),
    (10023, 'SYN023', 'Synthetic Assignment Group Four D', 'existing', 'existing'),
    (10024, 'SYN024', 'Synthetic Deletable Plan', 'existing', 'existing'),
    (10025, 'SYN025', 'Synthetic History Protected Plan', 'existing', 'existing')
)
INSERT INTO public.measurement_target_business (
  id, code, year, period, business_name, address, measurement_date,
  measurement_start_date, measurement_end_date, plan_based_year, plan_based_period,
  measurer_id, collaborators, daily_staff, business_type,
  preliminary_survey_rule_type, process_changed, is_registered
)
SELECT
  id, code, 2026, '하반기', business_name,
  '서울특별시 테스트구 검증로 ' || (id - 10000),
  CASE WHEN id = 10005 THEN '2026-09-10,2026-09-11' ELSE '2026-09-10' END,
  DATE '2026-09-10', CASE WHEN id = 10005 THEN DATE '2026-09-11' ELSE DATE '2026-09-10' END,
  2026, '상반기', 9101,
  CASE WHEN id = 10007 THEN 'Synthetic Surveyor B' ELSE 'Synthetic Surveyor A' END,
  CASE
    WHEN id = 10005 THEN '[{"date":"2026-09-10","measurer_id":9101,"collaborators":["Synthetic Surveyor B"]},{"date":"2026-09-11","measurer_id":9101,"collaborators":["Synthetic Surveyor A"]}]'::jsonb
    WHEN id = 10006 THEN '[{"date":"2026-09-10","measurer_id":9101,"collaborators":["Synthetic Surveyor A"]}]'::jsonb
    WHEN id = 10007 THEN '[{"date":"2026-09-10","measurer_id":9101,"collaborators":["Synthetic Surveyor B"]}]'::jsonb
    ELSE NULL
  END,
  business_type, rule_type, false, false
FROM fixtures
ON CONFLICT (id) DO UPDATE SET
  business_name = EXCLUDED.business_name,
  measurement_date = EXCLUDED.measurement_date,
  measurement_start_date = EXCLUDED.measurement_start_date,
  measurement_end_date = EXCLUDED.measurement_end_date,
  measurer_id = EXCLUDED.measurer_id,
  collaborators = EXCLUDED.collaborators,
  daily_staff = EXCLUDED.daily_staff,
  business_type = EXCLUDED.business_type,
  preliminary_survey_rule_type = EXCLUDED.preliminary_survey_rule_type;

INSERT INTO public.user_schedule_blocks (user_id, start_date, end_date, block_type, note)
VALUES (9101, '2026-08-10', '2026-08-10', 'unavailable', 'Synthetic unavailable fixture');

WITH planned(target_id, responsible_id, recommended_date) AS (
  VALUES
    (10010, 9101, DATE '2026-08-20'),
    (10011, 9101, DATE '2026-08-20'),
    (10012, 9101, NULL::date),
    (10014, 9101, DATE '2026-08-20'),
    (10015, 9101, DATE '2026-08-20'), (10016, 9101, DATE '2026-08-20'),
    (10017, 9101, DATE '2026-08-20'), (10018, 9101, DATE '2026-08-20'),
    (10019, 9101, DATE '2026-08-20'),
    (10020, 9101, DATE '2026-08-20'), (10021, 9101, DATE '2026-08-20'),
    (10022, 9101, DATE '2026-08-20'), (10023, 9101, DATE '2026-08-20'),
    (10024, 9101, DATE '2026-08-20'),
    (10025, 9101, DATE '2026-08-20')
)
INSERT INTO public.preliminary_survey_v2_plans (
  id, measurement_target_business_id, recommended_date,
  responsible_user_id, participant_user_ids, participant_names,
  status, plan_origin, source_measurement_date, source_responsible_user_id,
  source_rule_type, survey_method, recommendation_reason
)
SELECT
  ('00000000-0000-0000-0000-' || lpad(target_id::text, 12, '0'))::uuid,
  target_id, recommended_date, responsible_id,
  jsonb_build_array(responsible_id), jsonb_build_array('Synthetic Surveyor A'),
  'recommended', 'automatic', '2026-09-10', 9101,
  'existing', 'phone', jsonb_build_object('fixture', true)
FROM planned;

INSERT INTO public.measurement_journal (
  code, measurement_year, measurement_period, designated_office,
  business_name, measurement_start_date, measurement_end_date, completion_status
) VALUES
  ('SYN011', 2026, '하반기', '서울테스트지청', 'Synthetic True Confirmed', '2026-09-10', '2026-09-10', '완료'),
  ('SYN012', 2026, '하반기', '서울테스트지청', 'Synthetic Confirmed Date Missing', '2026-09-10', '2026-09-10', '완료'),
  ('SYN013', 2026, '하반기', '서울테스트지청', 'Synthetic Confirmed Surveyor Missing', '2026-09-10', '2026-09-10', '완료')
ON CONFLICT (code, measurement_year, measurement_period) DO NOTHING;

WITH assignment_fixture(target_id, assignment_date, approval_required, approved) AS (
  VALUES
    (10014, DATE '2026-09-21', false, false),
    (10015, DATE '2026-09-22', false, false), (10016, DATE '2026-09-22', false, false),
    (10017, DATE '2026-09-23', true, true), (10018, DATE '2026-09-23', true, true),
    (10019, DATE '2026-09-23', true, true),
    (10020, DATE '2026-09-24', false, false), (10021, DATE '2026-09-24', false, false),
    (10022, DATE '2026-09-24', false, false), (10023, DATE '2026-09-24', false, false),
    (10024, DATE '2026-09-25', false, false)
)
INSERT INTO public.preliminary_survey_v2_measurement_assignments (
  id, plan_id, measurement_date, assignee_user_id, survey_code,
  assignment_reason, approval_required, approval_group_fingerprint,
  approved_by_user_id, approved_at
)
SELECT
  ('10000000-0000-0000-0000-' || lpad(target_id::text, 12, '0'))::uuid,
  ('00000000-0000-0000-0000-' || lpad(target_id::text, 12, '0'))::uuid,
  assignment_date, 9102, 'B', 'Synthetic assignment group fixture',
  approval_required,
  CASE WHEN approved THEN repeat('0', 32) ELSE NULL END,
  CASE WHEN approved THEN 9001 ELSE NULL END,
  CASE WHEN approved THEN TIMESTAMPTZ '2026-08-01 00:00:00+00' ELSE NULL END
FROM assignment_fixture;

INSERT INTO public.preliminary_survey (
  id, code, measurement_date, business_name, preliminary_surveyor,
  year, period
) VALUES (
  50025, 'SYN025', '2026-09-10', 'Synthetic History Protected Plan',
  'Synthetic Surveyor A', 2026, '하반기'
);

INSERT INTO public.preliminary_survey_v2_legacy_reconciliation (
  id, batch_id, measurement_target_business_id, legacy_preliminary_survey_id,
  code, measurement_year, measurement_period, measurement_date,
  legacy_preliminary_date, legacy_preliminary_surveyor,
  matched_responsible_user_ids, source_hash, classification,
  applied_plan_id, reconciliation_status, source_snapshot
) VALUES (
  '20000000-0000-0000-0000-000000010025',
  '20000000-0000-0000-0000-000000000001',
  10025, 50025, 'SYN025', 2026, '하반기', '2026-09-10',
  '2026-08-20', 'Synthetic Surveyor A', '[9101]'::jsonb,
  repeat('a', 64), 'V2_ALREADY_AUTHORITATIVE',
  '00000000-0000-0000-0000-000000010025',
  'existing_v2_preserved', '{"fixture":true}'::jsonb
);

-- Local/Staging use custom server-side authentication. Keep the public API key
-- read-only only for the one Realtime signal table intentionally consumed by
-- the external document worker; all business data and RPCs stay server-only.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.document_job_pending_signals TO anon, authenticated;

SELECT setval('users_id_seq', GREATEST((SELECT max(id) FROM public.users), 1));
SELECT setval('measurement_target_business_id_seq', GREATEST((SELECT max(id) FROM public.measurement_target_business), 1));
SELECT setval('measurement_journal_id_seq', GREATEST((SELECT max(id) FROM public.measurement_journal), 1));
SELECT setval('preliminary_survey_id_seq', GREATEST((SELECT max(id) FROM public.preliminary_survey), 1));

COMMIT;
