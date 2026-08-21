export const SURVEY_TAB_IDS = ["plans", "list", "search", "schedule-blocks"] as const;
export type SurveyTabId = (typeof SURVEY_TAB_IDS)[number];
export const SURVEY_TAB_ORDER_STORAGE_KEY = "preliminarySurvey.tabOrder.v1";

export function restoreSurveyTabOrder(value: string | null): SurveyTabId[] {
  if (!value) return [...SURVEY_TAB_IDS];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) return [...SURVEY_TAB_IDS];
    const known = parsed.filter((id): id is SurveyTabId => SURVEY_TAB_IDS.includes(id as SurveyTabId));
    if (new Set(known).size !== known.length || parsed.some((id) => !SURVEY_TAB_IDS.includes(id as SurveyTabId))) {
      return [...SURVEY_TAB_IDS];
    }
    const restored = [...known];
    for (const [defaultIndex, id] of SURVEY_TAB_IDS.entries()) {
      if (!restored.includes(id)) restored.splice(Math.min(defaultIndex, restored.length), 0, id);
    }
    return restored;
  } catch {
    return [...SURVEY_TAB_IDS];
  }
}

export function moveSurveyTab(order: SurveyTabId[], dragged: SurveyTabId, target: SurveyTabId) {
  if (dragged === target) return order;
  const next = order.filter((id) => id !== dragged);
  next.splice(next.indexOf(target), 0, dragged);
  return next;
}
