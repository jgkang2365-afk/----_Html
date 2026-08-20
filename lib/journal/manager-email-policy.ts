type JournalManagerContactValues = {
  manager_name?: string | null;
  manager_mobile?: string | null;
  manager_email?: string | null;
};

function resolveJournalManagerValue({
  isEditMode,
  currentValue,
  latestValue,
}: {
  isEditMode: boolean;
  currentValue: string | null | undefined;
  latestValue?: string | null;
}): string {
  if (isEditMode) {
    return currentValue ?? "";
  }

  const hasValue = (value: string | null | undefined) =>
    value !== null && value !== undefined && value.trim() !== "";

  return hasValue(latestValue) ? latestValue! : "";
}

export function resolveJournalManagerContact({
  isEditMode,
  currentValues,
  latestValues = {},
}: {
  isEditMode: boolean;
  currentValues: JournalManagerContactValues;
  latestValues?: JournalManagerContactValues;
}): Required<JournalManagerContactValues> {
  return {
    manager_name: resolveJournalManagerValue({
      isEditMode,
      currentValue: currentValues.manager_name,
      latestValue: latestValues.manager_name,
    }),
    manager_mobile: resolveJournalManagerValue({
      isEditMode,
      currentValue: currentValues.manager_mobile,
      latestValue: latestValues.manager_mobile,
    }),
    manager_email: resolveJournalManagerValue({
      isEditMode,
      currentValue: currentValues.manager_email,
      latestValue: latestValues.manager_email,
    }),
  };
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
