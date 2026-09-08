type K2BQueueClient = {
  // SupabaseClient.rpc는 스키마 제네릭을 사용한다. 이 queue 경계에서는 반환값을
  // 런타임으로 검증해 특정 SupabaseClient 타입을 강제하지 않는다.
  rpc: (...args: any[]) => any;
};

/** K2B 업로드는 검증과 같은 durable queue로만 등록한다. */
export async function enqueueSerializedK2BUpload(
  client: K2BQueueClient,
  payload: unknown,
): Promise<string> {
  const { data, error } = await client.rpc("enqueue_k2b_upload_job", { p_payload: payload }) as {
    data: unknown;
    error: unknown | null;
  };
  if (error instanceof Error) throw error;
  if (error) throw new Error(String(error));
  if (typeof data !== "string" || !data) throw new Error("K2B 업로드 작업 ID를 받지 못했습니다.");
  return data;
}
