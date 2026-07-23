-- 20260723_move_coordinates_to_business_info.sql 적용 후 좌표가 이관되지 않은
-- 환경을 위한 멱등 보정 migration.
--
-- 기존 migration의 `NOT (NULL BETWEEN ...)` 조건은 SQL 3값 논리에서 NULL이
-- 되어 좌표가 비어 있는 행을 제외했다. NULL을 명시적으로 처리한다.
WITH ranked_coordinates AS (
  SELECT
    target.code,
    target.latitude,
    target.longitude,
    target.geocoded_address,
    target.geocoded_source_address,
    target.geocoding_error,
    target.geocoded_at,
    target.geocode_provider,
    target.coordinate_locked,
    row_number() OVER (
      PARTITION BY target.code
      ORDER BY target.geocoded_at DESC NULLS LAST, target.updated_at DESC NULLS LAST
    ) AS coordinate_rank
  FROM public.measurement_target_business target
  WHERE target.latitude BETWEEN 33 AND 39
    AND target.longitude BETWEEN 124 AND 132
)
UPDATE public.business_info info
SET
  latitude = ranked.latitude,
  longitude = ranked.longitude,
  geocoded_address = ranked.geocoded_address,
  geocoded_source_address = COALESCE(
    ranked.geocoded_source_address,
    NULLIF(trim(info.address1), ''),
    NULLIF(trim(info.address2), '')
  ),
  geocoding_status = 'SUCCESS',
  geocoding_error = NULL,
  geocoded_at = ranked.geocoded_at,
  geocode_provider = ranked.geocode_provider,
  coordinate_locked = COALESCE(ranked.coordinate_locked, false)
FROM ranked_coordinates ranked
WHERE ranked.coordinate_rank = 1
  AND info.code = ranked.code
  AND (
    info.latitude IS NULL
    OR info.longitude IS NULL
    OR info.latitude NOT BETWEEN 33 AND 39
    OR info.longitude NOT BETWEEN 124 AND 132
  );
