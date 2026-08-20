export type K2BCalendarSyncTarget = {
  code: string;
  year: number | string;
  period: string;
};

export async function requestK2BCalendarSync(
  apiUrl: string | undefined,
  workerToken: string | undefined,
  target: K2BCalendarSyncTarget,
  fetchImpl: typeof fetch = fetch,
) {
  if (!apiUrl) throw new Error("캘린더 동기화 서버 API URL이 없습니다.");
  if (!workerToken) throw new Error("캘린더 동기화 Worker 인증 토큰이 없습니다.");

  console.log("[K2B Calendar Client] fetch-start");
  const response = await fetchImpl(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${workerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(target),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.success) {
    throw new Error(body?.error || `캘린더 동기화 서버 요청 실패 (${response.status})`);
  }

  return body;
}
