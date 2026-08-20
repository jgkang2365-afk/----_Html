export function resolveJournalManagerEmail({
  isEditMode,
  currentValue,
  fallbackValues = [],
}: {
  isEditMode: boolean;
  currentValue: string | null | undefined;
  fallbackValues?: Array<string | null | undefined>;
}): string {
  if (isEditMode) {
    return currentValue ?? "";
  }

  return currentValue || fallbackValues.find((value) => Boolean(value)) || "";
}

export function normalizeJournalManagerEmailForSave(
  value: string | null | undefined,
): string | null {
  return value === "" || value === null || value === undefined ? null : value;
}

export function resolveJournalManagerEmailUpdate(
  updates: Record<string, unknown>,
  existingValue: string | null | undefined,
): unknown {
  return Object.prototype.hasOwnProperty.call(updates, "manager_email")
    ? updates.manager_email
    : existingValue;
}
