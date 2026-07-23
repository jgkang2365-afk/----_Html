-- 사업장 좌표를 연도/주기 레코드가 아닌 business_info 기본 위치로 관리한다.
ALTER TABLE public.business_info
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS geocoded_address text,
  ADD COLUMN IF NOT EXISTS geocoded_source_address text,
  ADD COLUMN IF NOT EXISTS geocoding_status text DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS geocoding_error text,
  ADD COLUMN IF NOT EXISTS geocoded_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS geocode_provider text,
  ADD COLUMN IF NOT EXISTS coordinate_locked boolean DEFAULT false;

ALTER TABLE public.business_info
  DROP CONSTRAINT IF EXISTS chk_business_info_geocoding_status;

ALTER TABLE public.business_info
  ADD CONSTRAINT chk_business_info_geocoding_status
  CHECK (geocoding_status IN ('PENDING', 'SUCCESS', 'FAILED', 'ADDRESS_MISSING', 'STALE'));

-- 기존 대상 레코드 중 정상 좌표 한 건만 골라 기본정보로 최초 이관한다.
-- 이미 business_info에 정상 좌표가 있으면 절대 덮어쓰지 않는다.
WITH ranked_coordinates AS (
  SELECT
    target.code,
    target.latitude,
    target.longitude,
    target.geocoded_address,
    target.geocoded_source_address,
    target.geocoding_status,
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
  geocoded_source_address = ranked.geocoded_source_address,
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

CREATE INDEX IF NOT EXISTS idx_business_info_geocoding_status
  ON public.business_info (geocoding_status);

COMMENT ON COLUMN public.business_info.latitude IS '사업장 기본 위도(WGS84)';
COMMENT ON COLUMN public.business_info.longitude IS '사업장 기본 경도(WGS84)';
COMMENT ON COLUMN public.business_info.geocoded_source_address IS '현재 좌표 산출에 사용한 정규화 전 주소';
COMMENT ON COLUMN public.business_info.coordinate_locked IS '관리자가 검증하여 자동 갱신을 막은 좌표 여부';
