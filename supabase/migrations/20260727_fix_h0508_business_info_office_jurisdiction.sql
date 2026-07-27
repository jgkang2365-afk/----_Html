-- H0508의 관할값은 선택 문서 정의 판정에 사용되므로, 확인된 기존값에서만 정확히 보정한다.
BEGIN;

UPDATE public.business_info
SET office_jurisdiction = '경기'
WHERE code = 'H0508'
  AND office_jurisdiction = '중부지방고용노동청 경기지청';

COMMIT;
