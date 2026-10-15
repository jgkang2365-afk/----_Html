import React from "react";
import { isRepeatedPublicSampleCode } from "@/lib/preliminary-survey-v2/public-sample-display";
import type { PreliminarySurveyDisplayModel } from "@/lib/preliminary-survey-v2/display-model";

export function PublicSampleCodeBadge({ code }: { code: string | null | undefined }) {
  const value = code?.trim() ? code : "-";
  return <span data-public-sample-code={value} className={isRepeatedPublicSampleCode(value)
    ? "inline-block rounded bg-red-600 px-1.5 py-0.5 font-bold leading-tight text-white"
    : "font-medium"}>{value}</span>;
}

export function PublicSampleAssignment({
  name, code, sourceLabel,
}: { name: string | null | undefined; code: string | null | undefined; sourceLabel?: string }) {
  if (!name?.trim() || name === "-") return <span>-</span>;
  if (!code?.trim() || code === "-") return <span>{sourceLabel && `${sourceLabel} `}{name.trim()} (코드 없음)</span>;
  return <span className="inline-flex max-w-full flex-wrap items-center gap-x-0.5 whitespace-nowrap">
    {sourceLabel && <span className="mr-1 text-[11px] text-slate-600">{sourceLabel}</span>}
    <span>{name.trim()}(</span><PublicSampleCodeBadge code={code} /><span>)</span>
  </span>;
}

export function PublicSampleDisplay({ model }: { model: PreliminarySurveyDisplayModel }) {
  if (model.measurementPublicSampleAssignments?.length) return <span className="inline-flex flex-wrap gap-x-2 gap-y-1">
    {model.measurementPublicSampleAssignments.map((assignment) => <span key={assignment.measurementDate} className="inline-flex items-center gap-1">
      <span className="text-xs text-slate-600">{assignment.measurementDate.slice(5).replace("-", "/")}</span>
      <PublicSampleAssignment name={assignment.assignee} code={assignment.publicSampleCode} />
    </span>)}
  </span>;
  return <PublicSampleAssignment name={model.measurementPublicSampleAssignee} code={model.publicSampleCode} />;
}
