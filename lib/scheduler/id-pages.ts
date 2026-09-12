export async function forEachAscendingIdPage<T extends { id: number }>(
  pageSize: number,
  load: (afterId: number, limit: number) => Promise<T[]>,
  visit: (row: T) => Promise<void>,
  onVisitError?: (row: T, error: unknown) => void,
) {
  let lastId = 0;
  for (;;) {
    const page = await load(lastId, pageSize);
    if (page.length === 0) return;
    for (const row of page) {
      if (!onVisitError) {
        await visit(row);
      } else {
        try { await visit(row); } catch (error) { onVisitError(row, error); }
      }
    }
    lastId = page[page.length - 1].id;
    if (page.length < pageSize) return;
  }
}
