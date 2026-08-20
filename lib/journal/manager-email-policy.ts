type JournalManagerContactValues = {
  manager_name?: string | null;
  manager_mobile?: string | null;
  manager_email?: string | null;
};

function resolveJournalManagerValue({
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

  const hasValue = (value: string | null | undefined) =>
    value !== null && value !== undefined && value.trim() !== "";

  return hasValue(currentValue)
    ? currentValue!
    : fallbackValues.find(hasValue) || "";
}

export function resolveJournalManagerContact({
  isEditMode,
  currentValues,
  fallbackValues = [],
}: {
  isEditMode: boolean;
  currentValues: JournalManagerContactValues;
  fallbackValues?: JournalManagerContactValues[];
}): Required<JournalManagerContactValues> {
  return {
    manager_name: resolveJournalManagerValue({
      isEditMode,
      currentValue: currentValues.manager_name,
      fallbackValues: fallbackValues.map((values) => values.manager_name),
    }),
    manager_mobile: resolveJournalManagerValue({
      isEditMode,
      currentValue: currentValues.manager_mobile,
      fallbackValues: fallbackValues.map((values) => values.manager_mobile),
    }),
    manager_email: resolveJournalManagerValue({
      isEditMode,
      currentValue: currentValues.manager_email,
      fallbackValues: fallbackValues.map((values) => values.manager_email),
    }),
  };
}

export function resolveJournalManagerEmail({
  isEditMode,
  currentValue,
  fallbackValues = [],
}: {
  isEditMode: boolean;
  currentValue: string | null | undefined;
  fallbackValues?: Array<string | null | undefined>;
}): string {
  return resolveJournalManagerValue({ isEditMode, currentValue, fallbackValues });
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
