ALTER TABLE public.preliminary_survey
ADD COLUMN IF NOT EXISTS assignee_manual_override boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.preliminary_survey.assignee_manual_override IS
'예비조사자, 실측정자, 보고서 담당을 자동 매핑하지 않고 사용자 입력값으로 우선 저장하는지 여부';