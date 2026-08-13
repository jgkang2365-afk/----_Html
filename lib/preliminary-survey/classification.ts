interface PreviousMeasurementRow {
  measurement_year?: unknown;
  measurement_period?: unknown;
  measurement_start_date?: unknown;
  measurement_end_date?: unknown;
}

function isEarlierMeasurementPeriod(
  measurementYear: unknown,
  measurementPeriod: unknown,
  targetYear: number,
  targetPeriod: string,
) {
  const rowYear = Number(measurementYear);
  if (!Number.isInteger(rowYear)) return false;
  if (rowYear < targetYear) return true;
  if (rowYear > targetYear) return false;
  return targetPeriod.startsWith("하반기") && String(measurementPeriod || "").startsWith("상반기");
}

export function hasPreviousMeasurementValueFromRows(
  currentTarget: Record<string, any> | null | undefined,
  journalRows: PreviousMeasurementRow[],
  targetYear: number,
  targetPeriod: string,
) {
  if (
    currentTarget?.previous_measurement_date ||
    currentTarget?.last_measurement_date
  ) {
    return true;
  }

  return journalRows.some(
    (row) =>
      isEarlierMeasurementPeriod(
        row.measurement_year,
        row.measurement_period,
        targetYear,
        targetPeriod,
      ) && Boolean(row.measurement_end_date || row.measurement_start_date),
  );
}
