export const COMPLETED_CALENDAR_COLOR_ID = "3";

const CALENDAR_LEAD_COLOR_MAP: Record<string, string> = {
  "한기문": "10",
  "배윤민": "6",
  "김민영": "6",
  "강종구": "9",
  "이주형": "5",
  "고유빈": "7",
};

type CompletionFields = {
  k2b_send_date?: string | null;
  electronic_invoice_date?: string | null;
  measurement_fee_business?: number | string | null;
};

export function isCalendarWorkCompleted(journal: CompletionFields | null | undefined) {
  if (!journal?.k2b_send_date) return false;

  return Boolean(
    journal.electronic_invoice_date ||
      Number(journal.measurement_fee_business) === 0,
  );
}

export function resolveCalendarColorId(
  calendarLead: string | null | undefined,
  journal: CompletionFields | null | undefined,
) {
  if (isCalendarWorkCompleted(journal)) {
    return COMPLETED_CALENDAR_COLOR_ID;
  }

  return CALENDAR_LEAD_COLOR_MAP[calendarLead?.trim() || ""] || "10";
}
