-- preliminary_survey_v2_legacy_reconciliation은 2026 하반기 legacy 원천을
-- source_snapshot으로 보존하는 감사/추적 테이블이다.
--
-- 현재 legacy_preliminary_survey_id의 live FK(ON DELETE RESTRICT)가
-- measurement_target_business의 측정일 변경 후 preliminary_survey mirror를
-- 이전 날짜에서 새 날짜로 교체하는 정상 동기화를 차단한다.
-- H0527/H0528에서 23503으로 재현되었다.
--
-- 감사 row에는 source_snapshot과 scalar legacy id를 그대로 보존하되,
-- 이미 캡처된 과거 source id가 현재 운영 mirror row의 생명주기를 잠그지 않게 한다.
-- assignment 테이블의 legacy source FK는 이 변경의 대상이 아니다.

ALTER TABLE public.preliminary_survey_v2_legacy_reconciliation
  DROP CONSTRAINT IF EXISTS preliminary_survey_v2_legacy__legacy_preliminary_survey_id_fkey;

COMMENT ON COLUMN public.preliminary_survey_v2_legacy_reconciliation.legacy_preliminary_survey_id IS
  'Reconciliation 당시 캡처한 historical preliminary_survey id. source_snapshot과 함께 감사 식별자로 보존하며 현재 운영 preliminary_survey row를 잠그는 live FK로 사용하지 않는다.';
