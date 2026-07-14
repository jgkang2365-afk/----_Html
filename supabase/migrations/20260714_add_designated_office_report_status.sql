ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_designated_office_report_manager BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.is_designated_office_report_manager IS
  '지정기관선정신고서 접수 여부 변경 담당자 권한';
ALTER TABLE public.measurement_journal
  ADD COLUMN IF NOT EXISTS designated_office_report_status VARCHAR(10) NOT NULL DEFAULT '미접수';

UPDATE public.measurement_journal
SET designated_office_report_status = '미접수'
WHERE designated_office_report_status IS NULL
   OR designated_office_report_status NOT IN ('접수', '미접수');

ALTER TABLE public.measurement_journal
  DROP CONSTRAINT IF EXISTS measurement_journal_designated_office_report_status_check;

ALTER TABLE public.measurement_journal
  ADD CONSTRAINT measurement_journal_designated_office_report_status_check
  CHECK (designated_office_report_status IN ('접수', '미접수'));

COMMENT ON COLUMN public.measurement_journal.designated_office_report_status IS
  '천안 지정기관선정신고서 접수 상태: 접수 또는 미접수';