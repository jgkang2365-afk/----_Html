interface DailyStaffEntry {
  date?: unknown;
  main_measurer_id?: unknown;
  helper_ids?: unknown;
  // 현재 저장 데이터의 기존 필드명. 위 필드가 없는 데이터에만 사용한다.
  measurer_id?: unknown;
  collaborators?: unknown;
}

function integer(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function legacyNames(value: unknown): string[] {
  return [...new Set(values(value).map(String).map((item) => item.trim()).filter(Boolean))];
}

export function measurementStaffForDate(input: {
  dailyStaff: unknown;
  measurementDate: string | null;
  collaborators: unknown;
  userNameById: Map<number, string>;
}) {
  const entries = Array.isArray(input.dailyStaff) ? input.dailyStaff as DailyStaffEntry[] : [];
  const entry = entries.find((item) => String(item?.date ?? "") === input.measurementDate);
  if (entry) {
    // 운영 legacy daily_staff의 measurer_id는 보고서 담당자이고 collaborators는
    // 역할 구분 없는 실제 측정 참여자다. 명시적인 신형 필드가 있는 경우에만
    // main/helper 의미로 읽고, legacy 필드에서 역할을 추론하지 않는다.
    const mainId = integer(entry.main_measurer_id);
    const explicitHelpers = values(entry.helper_ids).flatMap((value) => {
      const id = integer(value);
      if (id != null) return input.userNameById.get(id) ?? [];
      const name = String(value).trim();
      return name ? [name] : [];
    });
    const participants = legacyNames(entry.collaborators);
    return {
      mainMeasurer: mainId == null ? "-" : input.userNameById.get(mainId) ?? "-",
      helper: explicitHelpers.join(", ") || "-",
      measurementParticipants: participants.join(", ") || "-",
      source: "daily_staff" as const,
    };
  }

  // collaborators에는 역할 정보가 없으므로 첫 사람을 메인측정자로 승격하지 않는다.
  return {
    mainMeasurer: "-",
    helper: "-",
    measurementParticipants: legacyNames(input.collaborators).join(", ") || "-",
    source: "collaborators" as const,
  };
}
