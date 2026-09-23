const projectionFields = [
  "measurement_date", "measurer_id", "collaborators", "daily_staff", "business_name",
];

const calendarDisplayFields = [
  "address", "manager_name", "manager_mobile", "notes", "is_registered",
];

export function businessSyncTriggers(updates: Record<string, unknown>) {
  const projectSchedule = projectionFields.some((field) => Object.prototype.hasOwnProperty.call(updates, field));
  const syncCalendar = projectSchedule
    || calendarDisplayFields.some((field) => Object.prototype.hasOwnProperty.call(updates, field));
  return { projectSchedule, syncCalendar };
}
