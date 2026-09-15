import { isValidDateString } from '@/lib/utils/date-validator';
import { getKSTDateString } from '@/lib/utils/date-utils';

export const K2B_FUTURE_SEND_DATE_ERROR = 'K2B 전송일은 오늘 이후 날짜로 저장할 수 없습니다.';

/** 사용자 입력 경계에서만 호출한다. 워커 관측값·실제결과 승인은 별도 신뢰 경로다. */
export function validateUserEnteredK2BSendDate(value: unknown, today = getKSTDateString()): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isValidDateString(value)) return 'K2B 전송일 형식을 확인해주세요.';
  return value > today ? K2B_FUTURE_SEND_DATE_ERROR : null;
}

/**
 * 기존 행의 사용자 수정 경계에서만 호출한다.
 * 이미 저장된 미래값을 그대로 재전송하는 것은 다른 필드의 저장을 막지 않되,
 * 새로운 미래값으로의 변경은 계속 차단한다.
 */
export function validateUserEnteredK2BSendDateChange(
  value: unknown,
  existingValue: unknown,
  today = getKSTDateString(),
): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isValidDateString(value)) return 'K2B 전송일 형식을 확인해주세요.';
  if (value === existingValue) return null;
  return value > today ? K2B_FUTURE_SEND_DATE_ERROR : null;
}
