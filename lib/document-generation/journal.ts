export const DOCUMENT_GENERATION_JOURNAL_ERROR =
  "이미 측정일지에 등록된 사업장입니다. 문서를 다시 생성할 수 없습니다.";

export async function findActualMeasurementJournal(supabase: any, target: any) {
  const exactMatchQuery = supabase
    .from("measurement_journal")
    .select("id")
    .eq("code", target.code)
    .eq("measurement_year", target.year)
    .eq("measurement_period", target.period)
    .limit(1)
    .maybeSingle();

  const linkedJournalQuery = target.journal_id
    ? supabase
        .from("measurement_journal")
        .select("id")
        .eq("id", target.journal_id)
        .limit(1)
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [
    { data: exactMatch, error: exactMatchError },
    { data: linkedJournal, error: linkedJournalError },
  ] = await Promise.all([exactMatchQuery, linkedJournalQuery]);

  if (exactMatchError) throw exactMatchError;
  if (linkedJournalError) throw linkedJournalError;

  return linkedJournal || exactMatch || null;
}
