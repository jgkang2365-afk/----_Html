-- legacy preliminary_survey 중복 방어: schema drift 보정 + UNIQUE constraint
--
-- 목적: (code, year, period, measurement_date) 조합의 중복 legacy 행 재발 방지.
-- 전수검사(2026-08-19) 결과 중복 0건, key NULL 0건, 정상 다일 측정은 measurement_date가
-- 달라 UNIQUE와 충돌하지 않음을 확인 후 작성.
--
-- 안전성: idempotent(ADD COLUMN IF NOT EXISTS / 조건부 ADD CONSTRAINT),
-- 기존 데이터 무변경, destructive DDL 없음.
-- 정상 운영 constraint는 재실행 시 제거·재생성하지 않는다 (없을 때만 생성).

-- ---------- 1. schema drift 보정 ----------
-- 운영 DB에는 존재하지만 repository migration 정의가 누락된 컬럼을 정식으로 정의한다.
-- 신규 환경에서는 생성, 기존 운영 DB에서는 이미 존재하므로 안전하게 통과한다.
ALTER TABLE public.preliminary_survey
  ADD COLUMN IF NOT EXISTS year integer;
ALTER TABLE public.preliminary_survey
  ADD COLUMN IF NOT EXISTS period text;
ALTER TABLE public.preliminary_survey
  ADD COLUMN IF NOT EXISTS notes text;

-- ---------- 2. UNIQUE constraint (조건부 생성) ----------
-- PostgreSQL UNIQUE는 NULL을 서로 동일하지 않은 값으로 취급하므로,
-- (code, year, period, measurement_date) 어느 컬럼이 NULL이면 중복 방지가 우회될 수 있다.
-- 전수검사 기준 해당 4개 컬럼은 모두 NOT NULL 값이므로 정상 UNIQUE로 충분하다.
-- (이후 NULL 행이 유입되는 경우 partial index 또는 NOT NULL 강제를 별도 검토)
--
-- 이미 동일 이름·테이블의 UNIQUE constraint가 존재하면 그대로 유지하고 재생성하지 않는다.
-- 동일 이름이지만 UNIQUE가 아니거나 대상 테이블이 다르면 조용히 통과시키지 않고 예외로 보고한다.
DO $$
DECLARE
  constraint_exists boolean;
  is_valid_unique boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    JOIN pg_class AS t ON t.oid = c.conrelid
    JOIN pg_namespace AS n ON n.oid = t.relnamespace
    WHERE c.conname = 'uq_preliminary_survey_code_year_period_measurement_date'
      AND n.nspname = 'public'
      AND t.relname = 'preliminary_survey'
  ) INTO constraint_exists;

  IF NOT constraint_exists THEN
    ALTER TABLE public.preliminary_survey
      ADD CONSTRAINT uq_preliminary_survey_code_year_period_measurement_date
      UNIQUE (code, year, period, measurement_date);
    RAISE NOTICE 'created constraint uq_preliminary_survey_code_year_period_measurement_date';
  ELSE
    -- 동일 이름 constraint가 존재하는 경우: UNIQUE 타입인지 확인해 기대 구조와 일치하는지 검증한다.
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint AS c
      JOIN pg_class AS t ON t.oid = c.conrelid
      JOIN pg_namespace AS n ON n.oid = t.relnamespace
      WHERE c.conname = 'uq_preliminary_survey_code_year_period_measurement_date'
        AND n.nspname = 'public'
        AND t.relname = 'preliminary_survey'
        AND c.contype = 'u'
    ) INTO is_valid_unique;
    IF NOT is_valid_unique THEN
      RAISE EXCEPTION 'constraint uq_preliminary_survey_code_year_period_measurement_date exists but is not UNIQUE (unexpected state)';
    END IF;
    RAISE NOTICE 'constraint uq_preliminary_survey_code_year_period_measurement_date already exists, kept as-is';
  END IF;
END
$$;

COMMENT ON CONSTRAINT uq_preliminary_survey_code_year_period_measurement_date ON public.preliminary_survey
  IS '동일 사업장+년도+주기+측정일의 legacy 예비조사 중복 방지. 다일 측정은 measurement_date가 달라 별도 행으로 허용.';

-- ---------- 3. 기존 단일 인덱스 ----------
-- idx_preliminary_survey_code / date / business_name은 기존 조회 패턴(code/date/business_name 검색,
-- 정렬)에 사용되므로 특별한 이유 없이 삭제하지 않는다. UNIQUE가 이들을 대체하지 않는다.

NOTIFY pgrst, 'reload schema';
