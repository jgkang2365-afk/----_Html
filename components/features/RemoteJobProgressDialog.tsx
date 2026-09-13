"use client";

import { Check, Loader2, X } from "lucide-react";

export type RemoteJobTone = "blue" | "green" | "amber" | "red" | "slate";
export type RemoteJobProgressView = { step: number; heading: string; detail: string; tone: RemoteJobTone };
export const REMOTE_JOB_STEPS = ["요청 전달", "깡통컴에서 처리 중", "결과 확인", "완료"];

const colors: Record<RemoteJobTone, string> = { blue: "border-blue-600 bg-blue-600", green: "border-emerald-600 bg-emerald-600", amber: "border-amber-500 bg-amber-500", red: "border-red-600 bg-red-600", slate: "border-slate-500 bg-slate-500" };
const panels: Record<RemoteJobTone, string> = { blue: "border-blue-100 bg-blue-50/50", green: "border-emerald-100 bg-emerald-50/60", amber: "border-amber-200 bg-amber-50", red: "border-red-200 bg-red-50", slate: "border-slate-200 bg-slate-50" };

export type RemoteJobProgressDetail = { label: string; value: string };

export default function RemoteJobProgressDialog({ title, view, running, onClose, onCancel, cancelLabel = "작업 중단", cancelPending = false, details = [] }: { title: string; view: RemoteJobProgressView; running: boolean; onClose: () => void; onCancel?: () => void | Promise<void>; cancelLabel?: string; cancelPending?: boolean; details?: RemoteJobProgressDetail[] }) {
  const canCancel = running && Boolean(onCancel);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={title}>
    <div className="relative flex max-h-[90dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white px-7 py-8 shadow-2xl sm:px-10 sm:py-12">
      <button type="button" onClick={onClose} title="진행 화면을 닫아도 작업은 백그라운드에서 계속됩니다." aria-label="진행 화면 닫기. 작업은 백그라운드에서 계속됩니다." className="absolute right-5 top-5 rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
      <div className="shrink-0">
        <h2 className="pr-8 text-center text-2xl font-bold tracking-tight text-slate-950 sm:text-[28px]">{title}</h2>
        <ol className="mt-10 flex items-start" aria-label="작업 진행 단계">{REMOTE_JOB_STEPS.map((label, index) => { const complete = index < view.step || view.step === 3; const current = index === view.step && view.step !== 3; return <li key={label} className="relative flex flex-1 flex-col items-center text-center">{index > 0 && <span className={`absolute right-1/2 top-4 h-0.5 w-full ${index <= view.step ? "bg-emerald-500" : "bg-slate-200"}`} />}<span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold text-white ${complete ? "border-emerald-600 bg-emerald-600" : current ? colors[view.tone] : "border-slate-200 bg-slate-200"}`}>{complete ? <Check className="h-4 w-4" /> : index + 1}</span><span className={`mt-2 w-24 text-xs font-semibold leading-5 sm:w-32 sm:text-sm ${complete ? "text-emerald-700" : current ? "text-blue-700" : "text-slate-500"}`}>{label}</span></li>; })}</ol>
      </div>
      <div className="min-h-0 overflow-y-auto flex-1 px-0.5">
        <section className={`mt-8 flex min-h-44 flex-col items-center justify-center rounded-xl border px-5 py-7 text-center ${panels[view.tone]}`} aria-live="polite">{running ? <Loader2 className="mb-4 h-11 w-11 animate-spin text-blue-600" /> : <span className={`mb-4 flex h-10 w-10 items-center justify-center rounded-full text-white ${colors[view.tone]}`}>{view.tone === "green" ? <Check className="h-5 w-5" /> : <X className="h-5 w-5" />}</span>}<p className="break-words text-lg font-bold tracking-tight text-slate-950">{view.heading}</p><p className="mt-2 break-words text-sm leading-6 text-slate-600">{view.detail}</p></section>
        {details.length > 0 && <details className="mt-5 rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-xs text-slate-600"><summary className="cursor-pointer font-semibold text-slate-700">오류 상세 보기</summary><dl className="mt-3 grid max-h-48 gap-2 overflow-y-auto pr-1">{details.map(({ label, value }) => <div key={label} className="grid grid-cols-[5.5rem_1fr] gap-2"><dt className="text-slate-500">{label}</dt><dd className="break-all text-slate-700">{value}</dd></div>)}</dl></details>}
      </div>
      <div className="mt-8 shrink-0 flex justify-center">{canCancel ? <button type="button" onClick={() => void onCancel?.()} className="inline-flex min-w-40 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 disabled:opacity-60" disabled={cancelPending}>{cancelPending ? "중단 요청 중..." : cancelLabel}</button> : running ? <p className="text-xs text-slate-500">진행 화면을 닫아도 작업은 백그라운드에서 계속됩니다.</p> : <button type="button" onClick={onClose} className="min-w-40 rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800">닫기</button>}</div>
    </div>
  </div>;
}
