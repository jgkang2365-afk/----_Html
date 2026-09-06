import { measurementDayFormsFrom } from '@/lib/business/measurement-day-form';
import { normalizeTargetBusinessStatus } from '@/lib/business/target-business-form';
import { isValidDateString } from '@/lib/utils/date-validator';

export interface ReportProcessingTargetSchedule {
    measurement_date?: string | null;
    daily_staff?: unknown;
    is_registered?: unknown;
}

export function isReportProcessingTargetActive(target: ReportProcessingTargetSchedule | null | undefined): target is ReportProcessingTargetSchedule {
    return target != null && normalizeTargetBusinessStatus(target.is_registered) === '실시';
}

/**
 * 보고서 처리의 측정일은 target 일정의 실제 일자만 사용한다.
 * 다일 일정은 daily_staff에 명시된 날짜를 그대로 읽으며, 시작/종료일 사이를 생성하지 않는다.
 */
export function measurementDatesForReportProcessing(target: ReportProcessingTargetSchedule | null | undefined): string[] {
    if (!isReportProcessingTargetActive(target)) return [];

    return Array.from(new Set(
        measurementDayFormsFrom({
            dailyStaff: target.daily_staff,
            measurementDate: target.measurement_date,
        })
            .map((day) => day.date.trim())
            .filter((date) => isValidDateString(date)),
    )).sort((left, right) => left.localeCompare(right));
}

export function matchesReportProcessingMeasurementDate(dates: readonly string[], measurementDate: string | null): boolean {
    return !measurementDate || dates.includes(measurementDate);
}

export function reportProcessingMeasurementDateLabel(dates: readonly string[]): string {
    if (dates.length === 0) return '-';
    if (dates.length === 1) return dates[0];
    return `${dates[0]} 외 ${dates.length - 1}일`;
}
