import { K2BService } from "./k2b-service";
import type { K2BSubmissionResult } from "@/lib/k2b-verification";

/** K2B 접수현황의 날짜별 읽기 전용 조회. 항상 headless이며 종료를 보장한다. */
export async function querySubmissionResultsForDate(
  resultDate: string,
  credentials?: { id?: string; password?: string },
): Promise<K2BSubmissionResult[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) throw new Error("K2B 검증일은 YYYY-MM-DD 형식이어야 합니다.");
  const k2b = new K2BService();
  try {
    await k2b.init({ headless: true, readOnly: true });
    await k2b.login(credentials?.id, credentials?.password);
    return await k2b.querySubmissionResultsForDate(resultDate);
  } finally {
    await k2b.quit();
  }
}
