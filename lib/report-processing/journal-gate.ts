export const REPORT_PROCESSING_JOURNAL_REQUIRED_CODE = "JOURNAL_REQUIRED";
export const REPORT_PROCESSING_IDENTITY_REQUIRED_CODE = "REPORT_IDENTITY_REQUIRED";
export const REPORT_PROCESSING_JOURNAL_REQUIRED_MESSAGE =
  "등록된 측정일지가 없는 항목은 보고서 후속 처리를 실행할 수 없습니다.";

export type ReportProcessingJobType = "email" | "k2b";

export type ReportProcessingJournalIdentity = {
  code: string;
  year: number;
  period: string;
};

type JournalIdentitySource = {
  code?: unknown;
  year?: unknown;
  period?: unknown;
};

type JournalRow = {
  code?: unknown;
  measurement_year?: unknown;
  measurement_period?: unknown;
};

function toJournalIdentity(source: JournalIdentitySource): ReportProcessingJournalIdentity {
  const code = String(source.code ?? "");
  const year = Number(source.year);
  const period = String(source.period ?? "");

  if (!code.trim() || !Number.isInteger(year) || !period.trim()) {
    throw new Error(REPORT_PROCESSING_IDENTITY_REQUIRED_CODE);
  }

  return { code, year, period };
}

export function reportProcessingJournalIdentityKey(
  identity: ReportProcessingJournalIdentity,
): string {
  return JSON.stringify([identity.code, identity.year, identity.period]);
}

export function collectReportProcessingJournalIdentities(
  jobType: ReportProcessingJobType,
  targets: unknown[],
): ReportProcessingJournalIdentity[] {
  const identities = jobType === "email"
    ? targets.flatMap((target: any) => {
        if (!Array.isArray(target?.reports) || target.reports.length === 0) {
          throw new Error(REPORT_PROCESSING_IDENTITY_REQUIRED_CODE);
        }
        return target.reports.map((report: JournalIdentitySource) => toJournalIdentity(report));
      })
    : targets.map((target) => toJournalIdentity((target ?? {}) as JournalIdentitySource));

  return Array.from(
    new Map(
      identities.map((identity) => [reportProcessingJournalIdentityKey(identity), identity]),
    ).values(),
  );
}

export function hasRegisteredMeasurementJournal(
  journals: JournalRow[] | null | undefined,
  identity: ReportProcessingJournalIdentity,
): boolean {
  return Boolean(
    journals?.some(
      (journal) =>
        journal.code === identity.code &&
        Number(journal.measurement_year) === identity.year &&
        journal.measurement_period === identity.period,
    ),
  );
}

export async function findMissingRegisteredMeasurementJournals(
  supabase: any,
  identities: ReportProcessingJournalIdentity[],
): Promise<ReportProcessingJournalIdentity[]> {
  if (identities.length === 0) return [];

  const codes = Array.from(new Set(identities.map((identity) => identity.code)));
  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select("code, measurement_year, measurement_period")
    .in("code", codes);

  if (error) throw error;

  return identities.filter(
    (identity) => !hasRegisteredMeasurementJournal(journals, identity),
  );
}

export async function executeWithRegisteredMeasurementJournals<T>(
  supabase: any,
  identities: ReportProcessingJournalIdentity[],
  sideEffect: () => Promise<T>,
): Promise<
  | { executed: true; value: T }
  | { executed: false; missing: ReportProcessingJournalIdentity[] }
> {
  const missing = await findMissingRegisteredMeasurementJournals(supabase, identities);
  if (missing.length > 0) return { executed: false, missing };
  return { executed: true, value: await sideEffect() };
}
