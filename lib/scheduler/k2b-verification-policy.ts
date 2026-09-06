import { K2B_VERIFY_UNRESOLVED_DAYS } from "@/lib/constants/k2b-verification";

/** KST YYYY-MM-DD를 달력 기준으로 하루 전으로 이동한다. UTC 변환을 거치지 않는다. */
export function getPreviousKSTCalendarDate(kstDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kstDate)) throw new Error("KST 날짜 형식이 올바르지 않습니다.");
  const [year, month, day] = kstDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  return cursor.toISOString().slice(0, 10);
}

/** 전일 전송분과 아직 확정되지 않은 최근 검증분을 함께 재확인할 하한일이다. */
export function getK2BVerifyUnresolvedSince(resultDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) throw new Error("K2B 검증일 형식이 올바르지 않습니다.");
  const [year, month, day] = resultDate.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day));
  cursor.setUTCDate(cursor.getUTCDate() - K2B_VERIFY_UNRESOLVED_DAYS);
  return cursor.toISOString().slice(0, 10);
}
