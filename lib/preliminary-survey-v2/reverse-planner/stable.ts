function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}
export function stableStringify(value: unknown) { return JSON.stringify(normalize(value)); }
export function deterministicHash(value: unknown) {
  const input = stableStringify(value); let first = 2166136261; let second = 2246822519;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index); first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ code, 3266489917);
  }
  const hex = (item: number) => (item >>> 0).toString(16).padStart(8, "0");
  return `${hex(first)}${hex(second)}${hex(first ^ second)}${hex(Math.imul(first, second))}`;
}
