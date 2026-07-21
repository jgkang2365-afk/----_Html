-- 측정대상사업장 테이블에 좌표 및 Geocoding 관련 컬럼 추가
ALTER TABLE public.measurement_target_business
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision,
  ADD COLUMN geocoded_address text,
  ADD COLUMN geocoded_source_address text,
  ADD COLUMN geocoding_status text DEFAULT 'PENDING',
  ADD COLUMN geocoding_error text,
  ADD COLUMN geocoded_at timestamp with time zone,
  ADD COLUMN geocoding_method text DEFAULT 'AUTO',
  ADD COLUMN coordinate_locked boolean DEFAULT false;

-- geocoding_status 제약 조건 추가 (PENDING, SUCCESS, FAILED, ADDRESS_MISSING, STALE)
ALTER TABLE public.measurement_target_business
  ADD CONSTRAINT chk_measurement_target_business_geocoding_status
  CHECK (geocoding_status IN ('PENDING', 'SUCCESS', 'FAILED', 'ADDRESS_MISSING', 'STALE'));

-- geocoding_method 제약 조건 추가 (AUTO, MANUAL)
ALTER TABLE public.measurement_target_business
  ADD CONSTRAINT chk_measurement_target_business_geocoding_method
  CHECK (geocoding_method IN ('AUTO', 'MANUAL'));

-- 설명 주석 추가
COMMENT ON COLUMN public.measurement_target_business.latitude IS '위도';
COMMENT ON COLUMN public.measurement_target_business.longitude IS '경도';
COMMENT ON COLUMN public.measurement_target_business.geocoded_address IS 'Geocoding 결과 반환된 정규화 주소';
COMMENT ON COLUMN public.measurement_target_business.geocoded_source_address IS 'Geocoding 수행 대상이었던 원본 주소';
COMMENT ON COLUMN public.measurement_target_business.geocoding_status IS 'Geocoding 진행 상태 (PENDING, SUCCESS, FAILED, ADDRESS_MISSING, STALE)';
COMMENT ON COLUMN public.measurement_target_business.geocoding_error IS 'Geocoding 실패 시 에러 메시지';
COMMENT ON COLUMN public.measurement_target_business.geocoded_at IS 'Geocoding 완료 시각';
COMMENT ON COLUMN public.measurement_target_business.geocoding_method IS '좌표 획득 방식 (AUTO: 자동 변환, MANUAL: 수동 보정)';
COMMENT ON COLUMN public.measurement_target_business.coordinate_locked IS '수동 보정 등으로 인한 좌표 고정 여부 (true인 경우 자동 Geocoding이 덮어쓰지 않음)';

-- 조회 성능 향상을 위한 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_measurement_target_business_geocoding_status
  ON public.measurement_target_business (geocoding_status);
