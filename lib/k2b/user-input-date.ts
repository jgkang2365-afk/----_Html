import { isValidDateString } from '@/lib/utils/date-validator';
import { getKSTDateString } from '@/lib/utils/date-utils';

export const K2B_FUTURE_SEND_DATE_ERROR = 'K2B 전송일은 오늘 이후 날짜로 저장할 수 없습니다.';

/** 사용자 입력 경계에서만 호출한다. 워커 관측값·실제결과 승인은 별도 신뢰 경로다. */
export function validateUserEnteredK2BSendDate(value: unknown, today = getKSTDateString()): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isValidDateString(value)) return 'K2B 전송일 형식을 확인해주세요.';
  return value > today ? K2B_FUTURE_SEND_DATE_ERROR : null;
}
