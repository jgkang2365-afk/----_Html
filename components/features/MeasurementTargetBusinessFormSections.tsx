"use client";

import React from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  MeasurementDayFormWithUiKey,
  changeMeasurementDayReportWriter,
  createEmptyMeasurementDayForm,
  swapMeasurerForMeasurementDateTransition,
} from "@/lib/business/measurement-day-form";
import {
  TARGET_BUSINESS_TYPE_OPTIONS,
  TargetBusinessFormValues,
} from "@/lib/business/target-business-form";
import { isMeasurementStaffUnavailable } from "@/lib/business/measurement-day-availability";
import { formatBusinessNumber } from "@/lib/utils/business-number";
import {
  getNationalSupportDisplayStatus,
  hasNationalSupportApplicationInformation,
  hasNationalSupportLookupInformation,
} from "@/lib/national-support/eligibility";

export interface MeasurementFormUser {
  id: number;
  name: string;
}

interface MeasurementTargetBusinessFormSectionsProps {
  mode: "create" | "edit";
  value: TargetBusinessFormValues;
  onChange: (patch: Partial<TargetBusinessFormValues>) => void;
  businessCategories: Array<{ value: string; label: string }>;
  officeOptions: Array<{ value: string; label: string }>;
  planManagerOptions: Array<{ value: string; label: string }>;
  measurers: MeasurementFormUser[];
  measurementDays: MeasurementDayFormWithUiKey[];
  blockedKeys: Set<string>;
  onMeasurementDaysChange: (
    days: MeasurementDayFormWithUiKey[],
    linkMeasurerId?: number | null
  ) => void;
  onYearChange?: (year: number) => void;
  onPeriodChange?: (period: string) => void;
  onCodeChange?: (code: string) => void;
  onBusinessCategoryChange?: (businessCategory: string) => void;
  onProcessChangedTouched?: () => void;
}

const PERIOD_OPTIONS = [
  { value: "상반기", label: "상반기" },
  { value: "상반기(수시)", label: "상반기(수시)" },
  { value: "하반기", label: "하반기" },
  { value: "하반기(수시)", label: "하반기(수시)" },
];

const availableMeasurersForDate = (
  measurers: MeasurementFormUser[],
  date: string | null | undefined
) => {
  const isAfterTransition = !date || date >= "2026-06-09";
  return measurers.filter((member) =>
    isAfterTransition ? member.name !== "배윤민" : member.name !== "김민영"
  );
};

interface MeasurementDayAssignmentCardProps {
  day: MeasurementDayFormWithUiKey;
  index: number;
  measurers: MeasurementFormUser[];
  fallbackDate: string | null | undefined;
  blockedKeys: Set<string>;
  canRemove: boolean;
  onDateChange: (date: string) => void;
  onMeasurerChange: (measurerId: number | null) => void;
  onCollaboratorChange: (name: string, checked: boolean) => void;
  onRemove: () => void;
}

export const MeasurementDayAssignmentCard: React.FC<MeasurementDayAssignmentCardProps> = ({
  day,
  index,
  measurers,
  fallbackDate,
  blockedKeys,
  canRemove,
  onDateChange,
  onMeasurerChange,
  onCollaboratorChange,
  onRemove,
}) => {
  const assignmentDate = day.date || fallbackDate;
  const allDayMeasurers = availableMeasurersForDate(measurers, assignmentDate);
  const dayMeasurers = allDayMeasurers.filter(
    (member) => !isMeasurementStaffUnavailable(member.id, assignmentDate, blockedKeys)
  );
  const unavailableMeasurers = allDayMeasurers.filter((member) =>
    isMeasurementStaffUnavailable(member.id, assignmentDate, blockedKeys)
  );

  return (
    <Card
      className="group relative border-slate-200 bg-white p-3"
      data-measurement-day-key={day.uiKey}
    >
      {canRemove && (
        <button
          type="button"
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600 opacity-0 shadow-sm transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={onRemove}
          aria-label={`측정일 ${index + 1} 삭제`}
        >
          ×
        </button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">
            측정일 {index + 1}
          </label>
          <Input
            type="date"
            value={day.date}
            onChange={(event) => onDateChange(event.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-slate-500">보고서 담당자</label>
          <Select
            options={[
              { value: "", label: "선택" },
              ...dayMeasurers.map((member) => ({ value: String(member.id), label: member.name })),
              ...unavailableMeasurers
                .filter((member) => member.id === day.measurerId)
                .map((member) => ({
                  value: String(member.id),
                  label: `${member.name} (불가 일정)`,
                })),
            ]}
            value={day.measurerId?.toString() || ""}
            onChange={(event) =>
              onMeasurerChange(event.target.value ? Number(event.target.value) : null)
            }
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold text-slate-500">
            측정 참여자 (복수 선택)
          </label>
          <div className="flex flex-wrap gap-2 rounded border border-slate-200 bg-slate-50 p-2">
            {[
              ...dayMeasurers,
              ...unavailableMeasurers.filter((member) => day.collaborators.includes(member.name)),
            ].map((member) => {
              const unavailable = isMeasurementStaffUnavailable(
                member.id,
                assignmentDate,
                blockedKeys
              );
              return (
                <label
                  key={member.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded p-0.5 hover:bg-white"
                >
                  <input
                    type="checkbox"
                    checked={day.collaborators.includes(member.name)}
                    disabled={unavailable && !day.collaborators.includes(member.name)}
                    onChange={(event) => onCollaboratorChange(member.name, event.target.checked)}
                    className="h-3.5 w-3.5 rounded"
                  />
                  <span className="text-xs text-slate-600">
                    {member.name}
                    {unavailable ? " (불가 일정)" : ""}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h4 className="mb-3 border-b border-slate-200 pb-2 text-base font-bold text-slate-800">
    {children}
  </h4>
);

export const MeasurementTargetBusinessFormSections: React.FC<
  MeasurementTargetBusinessFormSectionsProps
> = ({
  mode,
  value,
  onChange,
  businessCategories,
  officeOptions,
  planManagerOptions,
  measurers,
  measurementDays,
  blockedKeys,
  onMeasurementDaysChange,
  onYearChange,
  onPeriodChange,
  onCodeChange,
  onBusinessCategoryChange,
  onProcessChangedTouched,
}) => {
  const isCreate = mode === "create";
  const contactReadOnlyClass = isCreate ? "" : "bg-slate-50 text-slate-700";
  const selectedOffice = value.designated_office ?? value.office_jurisdiction ?? "";
  const displayedStatus = value.is_registered_text || value.is_registered || "미실시";

  const updateDay = (
    index: number,
    update: (day: MeasurementDayFormWithUiKey) => MeasurementDayFormWithUiKey,
    linkMeasurerId?: number | null
  ) => {
    const nextDays = measurementDays.map((day, dayIndex) =>
      dayIndex === index ? update(day) : day
    );
    onMeasurementDaysChange(nextDays, linkMeasurerId);
  };

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>기본 정보</SectionTitle>
        <div className="grid grid-cols-6 gap-4">
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              사업장 코드{isCreate && <span className="text-red-500"> *</span>}
            </label>
            {isCreate ? (
              <div className="flex items-center">
                <span className="inline-flex h-10 items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-100 px-3 text-sm font-bold text-slate-700">
                  H
                </span>
                <Input
                  value={(value.code || "").replace(/^H/, "")}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
                    const code = digits ? `H${digits}` : "";
                    onCodeChange?.(code);
                    if (!onCodeChange) onChange({ code });
                  }}
                  className="rounded-l-none"
                  placeholder="0001 (숫자 4자리)"
                  maxLength={4}
                  required
                />
              </div>
            ) : (
              <Input value={value.code || ""} disabled className="bg-slate-100 text-slate-500" />
            )}
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              측정년도{isCreate && <span className="text-red-500"> *</span>}
            </label>
            <Input
              type={isCreate ? "number" : "text"}
              value={value.year ?? ""}
              disabled={!isCreate}
              className={isCreate ? "" : "bg-slate-100 text-slate-500"}
              onChange={(event) => {
                const year = Number(event.target.value);
                onYearChange?.(year);
                if (!onYearChange) onChange({ year });
              }}
              required={isCreate}
            />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              측정주기{isCreate && <span className="text-red-500"> *</span>}
            </label>
            <Select
              options={PERIOD_OPTIONS}
              value={value.period || ""}
              onChange={(event) => {
                onPeriodChange?.(event.target.value);
                if (!onPeriodChange) onChange({ period: event.target.value });
              }}
              className={value.period?.includes("(수시)") ? "font-bold text-red-500" : ""}
            />
          </div>
          <div className="col-span-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              사업장명{isCreate && <span className="text-red-500"> *</span>}
            </label>
            <Input
              value={value.business_name || ""}
              onChange={(event) => onChange({ business_name: event.target.value })}
              required={isCreate}
            />
          </div>
          <div className="col-span-3">
            <label className="mb-1 block text-sm font-medium text-slate-700">사업자등록번호</label>
            <Input
              value={
                isCreate ? value.business_number || "" : formatBusinessNumber(value.business_number)
              }
              disabled={!isCreate}
              className={isCreate ? "" : "cursor-not-allowed bg-slate-100 text-slate-500"}
              title={
                !isCreate
                  ? "사업자등록번호는 사업장정보/측정사업장 엑셀 동기화 기준으로 반영됩니다."
                  : undefined
              }
              onChange={(event) =>
                onChange({
                  business_number: event.target.value.replace(/\D/g, "").slice(0, 10),
                })
              }
            />
            {!isCreate && (
              <p className="mt-1 text-[11px] text-slate-400">
                사업장정보/측정사업장 엑셀 동기화 기준으로 자동 반영됩니다.
              </p>
            )}
          </div>
          <div className="col-span-6">
            <label className="mb-1 block text-sm font-medium text-slate-700">소재지</label>
            <Input
              value={value.address || ""}
              onChange={(event) => onChange({ address: event.target.value })}
            />
          </div>
          <div className="col-span-6">
            <label className="mb-1 block text-sm font-medium text-slate-700">업종</label>
            <Select
              options={businessCategories.map((category) =>
                category.value === "" ? { ...category, label: "선택" } : category
              )}
              value={value.business_category || ""}
              onChange={(event) => {
                onBusinessCategoryChange?.(event.target.value);
                if (!onBusinessCategoryChange) onChange({ business_category: event.target.value });
              }}
            />
          </div>
          <div className="col-span-6 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-sm font-medium text-slate-700">사업장 유형</p>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {TARGET_BUSINESS_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={value.business_type === option.value}
                    onChange={(event) =>
                      onChange({ business_type: event.target.checked ? option.value : null })
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  {option.label}
                </label>
              ))}
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={value.process_changed === true}
                  onChange={(event) => {
                    onProcessChangedTouched?.();
                    onChange({ process_changed: event.target.checked });
                  }}
                  className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                />
                공정변경
              </label>
            </div>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>연락 및 사업장 정보</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">전화번호</label>
            <Input
              readOnly={!isCreate}
              className={contactReadOnlyClass}
              value={value.phone || ""}
              onChange={(event) => onChange({ phone: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">팩스</label>
            <Input
              readOnly={!isCreate}
              className={contactReadOnlyClass}
              value={value.fax || ""}
              onChange={(event) => onChange({ fax: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">근로자수</label>
            <Input
              type={isCreate ? "number" : "text"}
              min={isCreate ? "0" : undefined}
              readOnly={!isCreate}
              className={contactReadOnlyClass}
              value={value.total_employees ?? ""}
              onChange={(event) =>
                onChange({
                  total_employees: event.target.value === "" ? null : Number(event.target.value),
                })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">계산서 이메일</label>
            <Input
              readOnly={!isCreate}
              className={contactReadOnlyClass}
              value={value.invoice_email || ""}
              onChange={(event) => onChange({ invoice_email: event.target.value })}
            />
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>관리 정보</SectionTitle>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">계획담당</label>
            <Select
              options={planManagerOptions}
              value={value.plan_manager || ""}
              onChange={(event) => onChange({ plan_manager: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">지정지청</label>
            <Select
              options={officeOptions.map((option) =>
                option.value ? option : { ...option, label: "선택" }
              )}
              value={selectedOffice}
              onChange={(event) => onChange({ designated_office: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">국고지원여부</label>
            <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
              {isCreate
                ? value.period?.includes("(수시)")
                  ? "비대상"
                  : hasNationalSupportApplicationInformation({
                        industrial_accident_number: value.sanjae,
                        commencement_number: value.commencement,
                        representative_name: value.representative_name,
                        manager_name: value.manager_name,
                        manager_mobile: value.manager_mobile,
                      })
                    ? "자동 신청"
                    : hasNationalSupportLookupInformation({
                          industrial_accident_number: value.sanjae,
                          commencement_number: value.commencement,
                          representative_name: value.representative_name,
                        })
                      ? "조회 대기"
                      : "정보 부족"
                : getNationalSupportDisplayStatus({
                    ...value,
                    industrial_accident_number: value.sanjae || value.industrial_accident_number,
                    commencement_number: value.commencement || value.commencement_number,
                  })}
            </div>
            {value.period?.includes("(수시)") && (
              <p className="mt-1 text-[11px] font-semibold text-red-600">
                수시 주기는 건강디딤돌 비대상으로 처리됩니다.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-blue-100 bg-blue-50/40 p-4">
        <div className="mb-3 border-b border-blue-200 pb-2">
          <h4 className="text-sm font-bold text-blue-800">건강디딤돌 정보</h4>
          <p className="mt-1 text-[11px] text-slate-500">
            일부 정보만 입력해도 저장할 수 있으며, 조회에는 산재·개시번호 11자리와 대표자명이
            필요합니다.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">산재관리번호</label>
            <Input
              value={value.sanjae || ""}
              onChange={(event) =>
                onChange({ sanjae: event.target.value.replace(/\D/g, "").slice(0, 11) })
              }
              placeholder="11자리 숫자"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">사업개시번호</label>
            <Input
              value={value.commencement || ""}
              onChange={(event) =>
                onChange({ commencement: event.target.value.replace(/\D/g, "").slice(0, 11) })
              }
              placeholder="11자리 숫자"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">대표자명</label>
            <Input
              value={value.representative_name || ""}
              onChange={(event) => onChange({ representative_name: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">
              측정업무 담당자
            </label>
            <Input
              value={value.manager_name || ""}
              onChange={(event) => onChange({ manager_name: event.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">휴대전화</label>
            <Input
              value={value.manager_mobile || ""}
              onChange={(event) => onChange({ manager_mobile: event.target.value })}
              placeholder="010-0000-0000"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">담당자 이메일</label>
            <Input
              type="email"
              value={value.manager_email || ""}
              onChange={(event) => onChange({ manager_email: event.target.value })}
              placeholder="name@example.com"
            />
          </div>
        </div>
        {!isCreate && value.sync_status && (
          <div className="mt-3 text-xs text-slate-600">
            현재 조회 상태:{" "}
            <span className="font-bold">
              {getNationalSupportDisplayStatus({
                ...value,
                industrial_accident_number: value.sanjae || value.industrial_accident_number,
                commencement_number: value.commencement || value.commencement_number,
              })}
            </span>
            {value.sync_status === "실패" && value.sync_error_message && (
              <p className="mt-1 font-semibold text-red-600">사유: {value.sync_error_message}</p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg bg-slate-50 p-4">
        <SectionTitle>측정 일정 및 인력 배정</SectionTitle>
        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-700">계획진행</label>
          <select
            className={`block h-10 w-full rounded-md border-gray-300 px-3 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 ${
              displayedStatus === "실시" || displayedStatus === "확정"
                ? "bg-green-100 text-green-700"
                : displayedStatus === "거래종료" ||
                    displayedStatus === "종료" ||
                    displayedStatus === "거래 종료"
                  ? "bg-red-50 text-red-500"
                  : "bg-yellow-100 text-yellow-800"
            }`}
            value={
              displayedStatus === "실시" || displayedStatus === "확정"
                ? "실시"
                : displayedStatus === "거래종료" ||
                    displayedStatus === "종료" ||
                    displayedStatus === "거래 종료"
                  ? "거래종료"
                  : "미실시"
            }
            onChange={(event) => onChange({ is_registered_text: event.target.value })}
          >
            <option value="미실시">미실시</option>
            <option value="실시">실시</option>
            <option value="거래종료">거래종료</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">거래종료는 날짜 자동 상태보다 우선합니다.</p>
        </div>
        <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-2">
          <span className="text-sm font-bold text-slate-800">날짜별 배정</span>
          <Button
            type="button"
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={() =>
              onMeasurementDaysChange([...measurementDays, createEmptyMeasurementDayForm()])
            }
          >
            + 일자 추가
          </Button>
        </div>
        <div className="space-y-4">
          {measurementDays.map((day, index) => (
            <MeasurementDayAssignmentCard
              key={day.uiKey}
              day={day}
              index={index}
              measurers={measurers}
              fallbackDate={value.future_measurement_date}
              blockedKeys={blockedKeys}
              canRemove={measurementDays.length > 1}
              onDateChange={(date) => {
                const transition = swapMeasurerForMeasurementDateTransition(
                  day,
                  day.date || value.future_measurement_date,
                  date || value.future_measurement_date,
                  value.link_measurer_id
                );
                updateDay(
                  index,
                  () => ({
                    ...transition.day,
                    uiKey: day.uiKey,
                    date,
                  }),
                  transition.linkMeasurerId
                );
              }}
              onMeasurerChange={(measurerId) => {
                const available = availableMeasurersForDate(
                  measurers,
                  day.date || value.future_measurement_date
                );
                const reportWriter = available.find((member) => member.id === measurerId);
                updateDay(index, () => ({
                  ...changeMeasurementDayReportWriter(day, measurerId, reportWriter?.name),
                  uiKey: day.uiKey,
                }));
              }}
              onCollaboratorChange={(name, checked) =>
                updateDay(index, () => ({
                  ...day,
                  collaborators: checked
                    ? Array.from(new Set([...day.collaborators, name]))
                    : day.collaborators.filter((collaborator) => collaborator !== name),
                }))
              }
              onRemove={() =>
                onMeasurementDaysChange(measurementDays.filter((_, dayIndex) => dayIndex !== index))
              }
            />
          ))}
        </div>
      </section>

      <section>
        <label className="mb-1 block text-sm font-medium text-slate-700">비고</label>
        <textarea
          className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          rows={3}
          value={value.notes || ""}
          onChange={(event) => onChange({ notes: event.target.value })}
        />
      </section>
    </div>
  );
};
