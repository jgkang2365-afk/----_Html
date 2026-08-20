export const MES_MANAGER_CONTACT_FIELDS = [
  "manager_name",
  "manager_mobile",
  "manager_email",
] as const;

type MesManagerContactField = (typeof MES_MANAGER_CONTACT_FIELDS)[number];

const toLatestMesValue = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
};

export function normalizeMesManagerContactFields(
  source: Partial<Record<MesManagerContactField, unknown>>,
): Record<MesManagerContactField, unknown> {
  return {
    manager_name: toLatestMesValue(source.manager_name),
    manager_mobile: toLatestMesValue(source.manager_mobile),
    manager_email: toLatestMesValue(source.manager_email),
  };
}
