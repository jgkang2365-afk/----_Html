import { K2BService } from "./k2b-service";
import type { K2BSubmissionResult } from "@/lib/k2b-verification";
import type { K2BGridRead } from "./k2b-original-sync";

/** 한 작업의 날짜별 조회는 단일 read-only 로그인 세션을 재사용하고 종료를 보장한다. */
export async function withK2BReadOnlySession<T>(
  credentials: { id?: string; password?: string } | undefined,
  operation: (k2b: K2BService) => Promise<T>,
): Promise<T> {
  const k2b = new K2BService();
  try {
    await k2b.init({ headless: true, readOnly: true });
    await k2b.login(credentials?.id, credentials?.password);
    return await operation(k2b);
  } finally {
    await k2b.quit();
  }
}

/** K2B 접수현황의 날짜별 읽기 전용 조회. 항상 headless이며 종료를 보장한다. */
export async function querySubmissionResultsForDate(
  resultDate: string,
  credentials?: { id?: string; password?: string },
): Promise<K2BSubmissionResult[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) throw new Error("K2B 검증일은 YYYY-MM-DD 형식이어야 합니다.");
  return withK2BReadOnlySession(credentials, k2b => k2b.querySubmissionResultsForDate(resultDate));
}

/** 원본 동기화 전용: 로그인 1회로 inclusive 기간을 조회하고 raw receipt를 보존할 수 있는 결과를 반환한다. */
export async function querySubmissionResultsForRange(
  fromDate: string,
  toDate: string,
  credentials?: { id?: string; password?: string },
): Promise<K2BGridRead> {
  return withK2BReadOnlySession(credentials, k2b => k2b.querySubmissionResultsForRange(fromDate, toDate));
}
