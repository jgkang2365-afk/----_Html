export interface ReportWriterSurvey {
  code: string | null;
  year: number | null;
  period: string | null;
  measurement_date: string | null;
  end_date: string | null;
  sequence_number: number | null;
  report_writer: string | null;
}

function periodOrder(period: string | null, measurementDate: string | null): number {
  const value = (period || "").trim();
  if (value.includes("하반기") || value === "2H") return 2;
  if (value.includes("상반기") || value === "1H") return 1;
  const quarter = value.match(/(?:제?([1-4])분기|^Q([1-4])$)/i);
  if (quarter) return Number(quarter[1] || quarter[2]) <= 2 ? 1 : 2;
  if (value.includes("수시")) {
    const month = Number(dateOrder(measurementDate).slice(5, 7));
    return month >= 1 && month <= 6 ? 1 : month >= 7 && month <= 12 ? 2 : 0;
  }
  return 0;
}

function dateOrder(date: string | null): string {
  const value = (date || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function rank(row: ReportWriterSurvey): [number, number, string, string, number] {
  return [
    Number.isInteger(row.year) ? row.year! : 0,
    periodOrder(row.period, row.measurement_date),
    dateOrder(row.measurement_date),
    dateOrder(row.end_date),
    Number.isInteger(row.sequence_number) ? row.sequence_number! : 0,
  ];
}

function compareRank(a: ReportWriterSurvey, b: ReportWriterSurvey): number {
  const left = rank(a);
  const right = rank(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

/** Latest survey is authoritative. Empty, unknown or conflicting latest assignments remain unassigned. */
export function latestReportWriters(
  surveys: ReportWriterSurvey[],
  measurementStaffNames: string[],
): Record<string, string | null> {
  const staff = new Set(measurementStaffNames.map((name) => name.trim()).filter(Boolean));
  const latest = new Map<string, ReportWriterSurvey[]>();
  const incompleteCodes = new Set<string>();
  for (const survey of surveys) {
    const code = survey.code?.trim();
    if (!code) continue;
    if (!Number.isInteger(survey.year) || !periodOrder(survey.period, survey.measurement_date) || !dateOrder(survey.measurement_date)) {
      incompleteCodes.add(code);
      continue;
    }
    const current = latest.get(code);
    if (!current || compareRank(survey, current[0]) > 0) latest.set(code, [survey]);
    else if (compareRank(survey, current[0]) === 0) current.push(survey);
  }
  const result: Record<string, string | null> = {};
  for (const [code, rows] of latest) {
    const names = rows.map((row) => row.report_writer?.trim() || "");
    result[code] = !incompleteCodes.has(code) && names.every((name) => name && staff.has(name) && name === names[0])
      ? names[0]
      : null;
  }
  for (const code of incompleteCodes) result[code] = null;
  return result;
}

export function matchesLatestReportWriter(
  selectedName: string,
  item: { type: "measurement" | "other"; code?: string | null },
  latestByCode: Record<string, string | null>,
): boolean {
  if (!selectedName) return true;
  const code = item.code?.trim();
  return item.type === "measurement" && Boolean(code) && latestByCode[code!] === selectedName;
}
