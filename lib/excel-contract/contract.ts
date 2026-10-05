export type ExcelField = {
  key: string;
  label: string;
  source: string;
  export: boolean;
  template: boolean;
  import: boolean;
  writable: boolean;
  required?: boolean;
  aliases?: readonly string[];
  parse?: (value: string) => string | number | null;
};

export const headersFor = (fields: readonly ExcelField[], kind: "export" | "template") =>
  fields.filter((field) => field[kind]).map((field) => field.label);

export function exportRow(fields: readonly ExcelField[], values: Record<string, unknown>) {
  return Object.fromEntries(fields.filter((field) => field.export).map((field) =>
    [field.label, values[field.key] ?? ""]));
}

export function importRow(fields: readonly ExcelField[], row: Record<string, unknown>) {
  const result: Record<string, string | number | null> = {};
  for (const field of fields) {
    if (!field.import || !field.writable) continue;
    const header = [field.label, ...(field.aliases || [])].find((name) => row[name] !== undefined && row[name] !== null);
    if (!header) continue;
    const value = String(row[header]).trim();
    result[field.key] = field.parse ? field.parse(value) : value;
  }
  return result;
}
