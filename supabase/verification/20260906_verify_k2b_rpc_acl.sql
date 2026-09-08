-- K2B SECURITY DEFINER RPC의 실제 catalog 상태를 읽기 전용으로 검증한다.
-- verification_passed는 네 함수 모두 postgres 소유, search_path=public이고
-- PUBLIC/anon/authenticated 실행 불가, service_role 실행 가능일 때만 true다.
WITH expected(signature, expected_owner, expected_search_path) AS (
  VALUES
    ('public.enqueue_k2b_automation_job(text,jsonb)', 'postgres', 'public'),
    ('public.enqueue_k2b_verify_job(date,bigint)', 'postgres', 'public'),
    ('public.enqueue_k2b_upload_job(jsonb)', 'postgres', 'public'),
    ('public.claim_k2b_legacy_direct_job(jsonb)', 'postgres', 'public')
),
catalog AS (
  SELECT
    expected.signature,
    expected.expected_owner,
    expected.expected_search_path,
    procedure.oid AS function_oid,
    namespace.nspname AS schema_name,
    pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
    COALESCE(procedure.prosecdef, false) AS security_definer,
    configuration.search_path,
    EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) AS public_execute,
    COALESCE(
      pg_catalog.has_function_privilege(
        pg_catalog.to_regrole('anon'),
        procedure.oid,
        'EXECUTE'
      ),
      false
    ) AS anon_execute,
    COALESCE(
      pg_catalog.has_function_privilege(
        pg_catalog.to_regrole('authenticated'),
        procedure.oid,
        'EXECUTE'
      ),
      false
    ) AS authenticated_execute,
    COALESCE(
      pg_catalog.has_function_privilege(
        pg_catalog.to_regrole('service_role'),
        procedure.oid,
        'EXECUTE'
      ),
      false
    ) AS service_role_execute
  FROM expected
  LEFT JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(expected.signature)
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  LEFT JOIN LATERAL (
    SELECT pg_catalog.split_part(setting, '=', 2) AS search_path
    FROM pg_catalog.unnest(
      COALESCE(procedure.proconfig, ARRAY[]::text[])
    ) AS setting
    WHERE setting LIKE 'search_path=%'
    LIMIT 1
  ) AS configuration ON true
)
SELECT
  signature,
  function_oid IS NOT NULL AS function_exists,
  schema_name,
  owner_name,
  security_definer,
  search_path,
  public_execute,
  anon_execute,
  authenticated_execute,
  service_role_execute,
  (
    function_oid IS NOT NULL
    AND schema_name = 'public'
    AND owner_name = expected_owner
    AND security_definer
    AND search_path = expected_search_path
    AND NOT public_execute
    AND pg_catalog.to_regrole('anon') IS NOT NULL
    AND NOT anon_execute
    AND pg_catalog.to_regrole('authenticated') IS NOT NULL
    AND NOT authenticated_execute
    AND pg_catalog.to_regrole('service_role') IS NOT NULL
    AND service_role_execute
  ) AS verification_passed
FROM catalog
ORDER BY signature;
