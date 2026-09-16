export type K2BConsistencyPresentationState = "GREEN" | "YELLOW" | "RED" | "UNVERIFIED" | "STALE";

/** K2B 업무상태는 실제결과 정합성 신호와 독립적으로 표시한다. */
export function presentK2BBusinessStatus(status: string | null | undefined): { label: string | null; className: string } {
  switch (status) {
    case "사용자반송":
      return { label: "사용자반송", className: "border-amber-200 bg-amber-50 text-amber-800" };
    case "오류/파일 재검토":
      return { label: "오류/파일 재검토", className: "border-amber-200 bg-amber-50 text-amber-800" };
    case "결과 확인 필요":
      return { label: "결과 확인 필요", className: "border-rose-200 bg-rose-50 text-rose-800" };
    // 정상처리와 legacy 업로드 완료는 업무상태 칸에 성공/진행 신호를 만들지 않는다.
    default:
      return { label: null, className: "" };
  }
}

/** 실제결과 정합성은 판정 확실성만 표현하며 K2B 업무상태를 참조하지 않는다. */
export function presentK2BConsistency(status: K2BConsistencyPresentationState): { icon: string; label: string; className: string } {
  switch (status) {
    case "GREEN": return { icon: "🟢", label: "정상", className: "border-emerald-200 bg-emerald-50 text-emerald-800" };
    case "YELLOW": return { icon: "🟡", label: "확인 필요", className: "border-amber-200 bg-amber-50 text-amber-800" };
    case "RED": return { icon: "🔴", label: "확인 필요", className: "border-rose-200 bg-rose-50 text-rose-800" };
    case "STALE": return { icon: "⚪", label: "검증 지연", className: "border-violet-200 bg-violet-50 text-violet-800" };
    default: return { icon: "⚪", label: "미검증", className: "border-slate-200 bg-slate-50 text-slate-600" };
  }
}
