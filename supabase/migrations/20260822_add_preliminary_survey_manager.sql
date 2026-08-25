-- 예비조사 추천/재추천/apply 및 1인 3건 측정자 배정 승인 권한.
-- 운영 DB에는 별도 승인 후 적용하며 기존 관리자는 애플리케이션에서 계속 허용한다.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_preliminary_survey_manager boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.is_preliminary_survey_manager IS
'예비조사 추천·재추천·적용 및 측정자 1인 3건 배정을 승인할 수 있는 담당자 권한';

NOTIFY pgrst, 'reload schema';
