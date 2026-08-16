-- 연계측정자: 예비조사와 실제 측정을 연결하는 기준 인원 (사업장 단위 1명).
-- 정의: 예비조사자이면서 전체 측정기간 중 최소 하루 실제 측정에 참여해야 한다.
-- 보고서 담당자(measurer_id)와 다를 수 있다.
ALTER TABLE public.measurement_target_business
  ADD COLUMN IF NOT EXISTS link_measurer_id integer REFERENCES public.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.measurement_target_business.link_measurer_id IS
  '연계측정자: 예비조사와 실제 측정을 연결하는 기준 인원. 예비조사자이면서 전체 측정기간 중 최소 하루 실제 측정에 참여해야 한다. 보고서 담당자(measurer_id)와 별개.';
