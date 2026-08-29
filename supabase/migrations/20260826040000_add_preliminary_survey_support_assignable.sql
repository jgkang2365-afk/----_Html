-- Canonicalize a user capability column that previously existed only in deployed schema.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_preliminary_survey_support_assignable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.users.is_preliminary_survey_support_assignable IS
  '예비조사 책임자 또는 경력 검토자 후보로 사용할 수 있는 사용자 여부';
