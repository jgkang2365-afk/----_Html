import { addCalendarDays, parseDateOnly } from "./calendar";

export interface ScheduleBlockRange {
  user_id: number | string;
  start_date: string;
  end_date: string;
}

export function buildScheduleBlockKeys(blocks: ScheduleBlockRange[]): Set<string> {
  const blockedKeys = new Set<string>();
  for (const block of blocks) {
    if (!parseDateOnly(block.start_date) || !parseDateOnly(block.end_date) || block.end_date < block.start_date) {
      continue;
    }
    let cursor = block.start_date;
    while (cursor <= block.end_date) {
      blockedKeys.add(`${block.user_id}:${cursor}`);
      cursor = addCalendarDays(cursor, 1);
    }
  }
  return blockedKeys;
}
