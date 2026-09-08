type K2BJournalWrite = PromiseLike<{ error: unknown | null }>;

export class K2BJournalPersistenceError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = "K2BJournalPersistenceError";
  }
}

/** DB 반영 실패를 K2B 업로드 성공으로 오인하지 않도록 강제한다. */
export async function requireK2BJournalPersistence(write: K2BJournalWrite): Promise<void> {
  const { error } = await write;
  if (error) throw new K2BJournalPersistenceError(error);
}
