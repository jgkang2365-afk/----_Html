-- 2026-07-28 엑셀 동기화가 되돌린 H0508 관할값을, 확인된 이전 전체명에서만 재정정한다.
BEGIN;

UPDATE public.business_info
SET office_jurisdiction = '경기'
WHERE code = 'H0508'
  AND office_jurisdiction = '중부지방고용노동청 경기지청';

COMMIT;
