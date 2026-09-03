from pathlib import Path
import re
import subprocess


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:220]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_replace_once(path: str, pattern: str, replacement: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE | re.DOTALL)
    if count != 1:
        raise SystemExit(f"{path}: expected one regex match, found {count}: {pattern[:220]!r}")
    file_path.write_text(next_text, encoding="utf-8")


# 1) Canonical business rule first.
doc_path = "docs/business-rules/preliminary-survey.md"
replace_once(
    doc_path,
    "> 정책 기준: 2026-09-03 사용자가 승인한 자동배정 날짜 우선순위·Preview 수정·동선 표시·8개 업체 검토 UI 규칙을 포함한 통합 운영 규칙",
    "> 정책 기준: 2026-09-03 사용자가 승인한 자동배정 날짜 우선순위·검토 후보 3안·업체구분/출처 표시·동선 환경진단·8개 업체 무스크롤 UI 규칙을 포함한 통합 운영 규칙",
)
old_review_block = """### 자동 배정 검토 화면

- 자동 배정 표는 **사업장 1개당 기본 1행**을 사용한다. 정상 동선 설명이나 보조 근거 때문에 동일 사업장을 별도 행으로 늘리지 않는다.
- 자동 배정 대상이 8개 이하이면 표 내부 세로 스크롤 없이 8개 사업장을 한 번에 검토할 수 있는 밀도로 표시한다. 9개 이상일 때만 표 내부 세로 스크롤을 허용한다.
- 동일주소와 검증된 차량 이동시간 30분 이하의 정상 route evidence는 기본 행에 반복 표시하지 않는다. 계산 근거와 audit에는 그대로 보존한다.
- 차량 이동시간 31~60분은 `동선 검토`, route 확인 불가는 `이동경로 확인 필요`, 60분 초과는 자동 묶음 불가를 알 수 있는 경고로 기본 행에 표시한다.
- 동선 경고의 상세정보에서는 가능하면 상대 사업장, 적용 날짜, 공통 수행자, 정방향·역방향·보수적 적용 시간을 확인할 수 있어야 한다.
"""
new_review_block = """### 자동 배정 검토 화면

- 자동 배정 표는 **사업장 1개당 기본 1행**을 사용한다. 정상 동선 설명이나 보조 근거 때문에 동일 사업장을 별도 행으로 늘리지 않는다.
- 각 사업장 행에는 `최초실시 / 타기관 신규 / 기존` 구분을 명시하고, 예비조사 값의 출처를 `미계산 / 자동계산 / 기존값(또는 기존값 유지) / 수정안 / 보정안`처럼 사용자가 구분할 수 있게 표시한다.
- 자동 배정 대상이 8개 이하이면 **표 내부뿐 아니라 자동배정 모달 본문에도 세로 스크롤이 생기지 않아야 한다.** 8개를 한 번에 검토할 수 있도록 행 높이와 보조문구를 압축한다.
- 9개 이상일 때는 모달 전체를 세로 스크롤시키지 않고 **사업장 표 영역에만 내부 세로 스크롤**을 허용한다. 사용자가 수정 패널을 연 경우에는 수정 입력을 위해 별도 검토 영역 스크롤을 허용할 수 있다.
- 동일주소와 검증된 차량 이동시간 30분 이하의 정상 route evidence는 기본 행에 반복 표시하지 않는다. 계산 근거와 audit에는 그대로 보존한다.
- 차량 이동시간 31~60분은 `동선 검토`, route 확인 불가는 `이동경로 확인 필요`, 60분 초과는 자동 묶음 불가를 알 수 있는 경고로 기본 행에 표시한다.
- 같은 행에서 동일한 동선 경고 문구를 여러 번 반복하지 않는다. 여러 상대 사업장 때문에 같은 경고가 발생하면 기본 행에는 경고를 1회 표시하고 상세정보에 상대 사업장별 근거를 묶어 보존한다.
- 동선 경고의 상세정보에서는 가능하면 상대 사업장, 적용 날짜, 공통 수행자, 정방향·역방향·보수적 적용 시간을 확인할 수 있어야 한다.
- Preview/비운영 환경에서 차량동선 provider가 설정되지 않은 경우 이를 계산 실패와 구분하여 화면에 명확히 알린다. provider가 없다는 이유로 미확인 route를 정상 route evidence로 간주하지 않는다.
- 자동배정 행의 `수정`을 열면 사용자가 날짜와 조사자를 직접 탐색하기 전에 **현재 snapshot의 hard rule과 같은 batch 충돌을 통과한 추천 후보를 최대 3개** 먼저 제시한다.
- 추천 후보는 `예비조사일 + 예비조사자 + 방식 + 간단한 추천근거`의 완성 조합으로 제시하고 1·2·3순위를 표시한다. 유효 후보가 1~2개뿐이면 억지로 3개를 만들지 않는다.
- 추천 후보를 선택하면 수정 입력값에 채우고, 최종 반영 전 기존과 동일한 서버 재검증을 다시 수행한다. 추천 후보가 없거나 업무상 다른 값이 필요한 경우에만 직접 수정 경로를 사용한다.
"""
replace_once(doc_path, old_review_block, new_review_block)
replace_once(
    doc_path,
    "- `Preview 일반 수정`: 지침 안의 예비조사일·예비조사자 수정은 서버 재검증 후 Preview에만 반영되고 `배정 확정` 전 DB write가 없어야 한다.\n- `정상 동선 표시`: 동일주소 또는 차량 30분 이하의 정상 route evidence가 자동배정 기본 행을 여러 줄의 `차량 N분` 텍스트로 늘리면 FAIL이다. 31~60분·미확인·60분 초과만 경고한다.\n- `8개 업체 검토`: 자동배정 대상 8개까지는 사업장당 1행을 유지하고 표 내부 세로 스크롤 없이 보여야 하며, 9개부터 내부 세로 스크롤을 허용한다.",
    "- `Preview 일반 수정`: 지침 안의 예비조사일·예비조사자 수정은 서버 재검증 후 Preview에만 반영되고 `배정 확정` 전 DB write가 없어야 한다.\n- `수정 추천 3안`: 수정 화면은 hard rule과 같은 batch 충돌을 통과한 완성 후보를 최대 3개 우선 제시하고, 유효 후보가 부족하면 실제 개수만 표시한다. 선택 후 최종 적용 전 서버가 다시 검증해야 한다.\n- `업체 구분·출처 표시`: H0527 같은 행에서 최초실시 여부와 현재 예비조사 값이 자동계산인지 기존값인지 수정안인지 사용자가 화면만 보고 구분할 수 있어야 한다.\n- `정상 동선 표시`: 동일주소 또는 차량 30분 이하의 정상 route evidence가 자동배정 기본 행을 여러 줄의 `차량 N분` 텍스트로 늘리면 FAIL이다. 31~60분·미확인·60분 초과만 경고하며 같은 경고문구를 한 행에 중복 표시하지 않는다.\n- `Preview Route provider`: 차량동선 provider가 Preview에 없으면 설정 누락을 명확히 표시하고 관련 대상은 미확인 상태로 남긴다. 거리 추정값으로 정상 판정을 만들면 FAIL이다.\n- `8개 업체 검토`: 자동배정 대상 8개까지는 사업장당 1행을 유지하며 **표와 모달 본문 모두 세로 스크롤 없이** 보여야 한다. 9개부터는 표 영역에만 내부 세로 스크롤을 허용한다.",
)

canonical_blob = subprocess.check_output(["git", "hash-object", doc_path], text=True).strip()

# 2) Planner version/canonical reference.
types_path = "lib/preliminary-survey-v2/reverse-planner/types.ts"
replace_once(types_path, 'export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.3.2";',
             'export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.3.3";')
regex_replace_once(
    types_path,
    r'export const PRELIMINARY_SURVEY_CANONICAL_SHA = "[0-9a-f]{40}";',
    f'export const PRELIMINARY_SURVEY_CANONICAL_SHA = "{canonical_blob}";',
)
replace_once(
    types_path,
    "  routeEvidence?: PlannerRouteEvidence[];\n  previewToken?: string;\n}",
    "  routeEvidence?: PlannerRouteEvidence[];\n  previewToken?: string;\n  routeProviderConfigured?: boolean;\n}",
)

# 3) Expose ranked candidate pool for the reviewed-candidate suggestions.
solver_path = "lib/preliminary-survey-v2/reverse-planner/solver.ts"
replace_once(solver_path, "function candidatesFor(snapshot: PlanningSnapshot, target: PlannerTarget): PlannerCandidate[] {",
             "function generatedCandidatesFor(snapshot: PlanningSnapshot, target: PlannerTarget): PlannerCandidate[] {")
replace_once(
    solver_path,
    "}\n\nfunction emptyCandidateReason(snapshot: PlanningSnapshot, target: PlannerTarget): ReversePlannerReason {",
    "}\n\nexport function rankedCandidatesForTarget(snapshot: PlanningSnapshot, target: PlannerTarget): PlannerCandidate[] {\n"
    "  const keep = existingCandidate(snapshot, target);\n"
    "  return [...(keep ? [keep] : []), ...generatedCandidatesFor(snapshot, target)];\n"
    "}\n\nfunction emptyCandidateReason(snapshot: PlanningSnapshot, target: PlannerTarget): ReversePlannerReason {",
)
replace_once(
    solver_path,
    "        const keep = existingCandidate(snapshot, target);\n        choices.set(target.id, [...(keep ? [keep] : []), ...candidatesFor(snapshot, target)]);",
    "        choices.set(target.id, rankedCandidatesForTarget(snapshot, target));",
)

# 4) API: route-provider diagnostics + up to 3 batch-valid suggestion candidates.
route_path = "app/api/preliminary-survey-v2/reverse-planner/route.ts"
replace_once(
    route_path,
    'import { planPreliminarySurveyGivenFixedAssignments, validateCandidateForSave, validateCandidateHardRules } from "@/lib/preliminary-survey-v2/reverse-planner/solver";',
    'import { planPreliminarySurveyGivenFixedAssignments, rankedCandidatesForTarget, validateCandidateForSave, validateCandidateHardRules } from "@/lib/preliminary-survey-v2/reverse-planner/solver";',
)
replace_once(
    route_path,
    '      return NextResponse.json({ ...output, routeStats: resolved.stats,\n        routeEvidence: resolved.snapshot.routeEvidence, previewToken });',
    '      return NextResponse.json({ ...output, routeStats: resolved.stats,\n        routeEvidence: resolved.snapshot.routeEvidence, previewToken,\n        routeProviderConfigured: Boolean(process.env.KAKAO_REST_API_KEY) });',
)
replace_once(
    route_path,
    '    if (body.action !== "apply" && body.action !== "override" && body.action !== "validate_adjustment") {',
    '    if (body.action !== "apply" && body.action !== "override" && body.action !== "validate_adjustment"\n        && body.action !== "suggest_adjustments") {',
)
suggestion_block = r'''
    if (body.action === "suggest_adjustments") {
      const targetId = Number(body.targetId);
      const target = frozenSnapshot.targets.find((item) => item.id === targetId);
      if (!Number.isInteger(targetId) || !target) {
        return NextResponse.json({ error: "추천 후보 대상 사업장을 확인해 주세요." }, { status: 400 });
      }
      if (target.protected) return NextResponse.json({ success: true, suggestions: [] });
      const parsed = parseReviewAdjustments(frozenSnapshot, body.reviewAdjustments);
      parsed.candidates.delete(targetId);
      parsed.violations.delete(targetId);
      if (parsed.violations.size) {
        return NextResponse.json({
          error: "이미 반영한 다른 수정안을 먼저 확인해 주세요.",
          code: "REVIEW_ADJUSTMENT_REQUIRES_OVERRIDE",
          violations: Object.fromEntries(parsed.violations),
        }, { status: 409 });
      }
      const current = output.results.find((item) => item.targetId === targetId)?.candidate ?? null;
      const pool = [...(current ? [current] : []), ...rankedCandidatesForTarget(frozenSnapshot, target)];
      const uniquePool: PlannerCandidate[] = [];
      const candidateKeys = new Set<string>();
      for (const candidate of pool) {
        const key = `${candidate.preliminaryDate}|${candidate.surveyMethod}|${[...candidate.participantUserIds].sort((a, b) => a - b).join(",")}`;
        if (candidateKeys.has(key)) continue;
        candidateKeys.add(key);
        uniquePool.push(candidate);
      }
      const preferred: Array<Record<string, unknown>> = [];
      const alternates: Array<Record<string, unknown>> = [];
      const preferredDates = new Set<string>();
      let attempts = 0;
      for (const candidate of uniquePool) {
        if (attempts >= 80 || preferred.length >= 3) break;
        attempts += 1;
        const forced = new Map(parsed.candidates);
        forced.set(targetId, candidate);
        const adjusted = planPreliminarySurveyGivenFixedAssignments(frozenSnapshot, { forcedCandidates: forced });
        if (reviewAdjustmentConflictTargets(adjusted, forced).length) continue;
        const selected = adjusted.results.find((item) => item.targetId === targetId)?.candidate ?? null;
        if (!sameReviewCandidate(selected, candidate)) continue;
        const suggestion = {
          targetId,
          preliminaryDate: candidate.preliminaryDate,
          surveyMethod: candidate.surveyMethod,
          participantUserIds: candidate.participantUserIds,
          reasons: candidate.reasons,
        };
        if (!preferredDates.has(candidate.preliminaryDate)) {
          preferredDates.add(candidate.preliminaryDate);
          preferred.push(suggestion);
        } else {
          alternates.push(suggestion);
        }
      }
      while (preferred.length < 3 && alternates.length) preferred.push(alternates.shift()!);
      return NextResponse.json({ success: true, suggestions: preferred.slice(0, 3) });
    }

'''
replace_once(route_path, '    if (body.action === "override") {', suggestion_block + '    if (body.action === "override") {')

# 5) Modal supports a feature-level body scroll opt-out.
modal_path = "components/ui/Modal.tsx"
replace_once(
    modal_path,
    "  resizable?: boolean;\n  error?: string | null;\n}",
    "  resizable?: boolean;\n  error?: string | null;\n  bodyScroll?: boolean;\n}",
)
replace_once(
    modal_path,
    "  resizable = false,\n  error: parentError = null,\n}) => {",
    "  resizable = false,\n  error: parentError = null,\n  bodyScroll = true,\n}) => {",
)
replace_once(
    modal_path,
    '          "px-4 sm:px-8 pb-6 sm:pb-8 overflow-y-auto custom-scrollbar flex-1 min-h-0",\n          // 리사이즈 핸들이 내용을 가리지 않도록 하단 패딩 추가',
    '          "px-4 sm:px-8 pb-6 sm:pb-8 flex-1 min-h-0",\n          bodyScroll ? "overflow-y-auto custom-scrollbar" : "overflow-hidden",\n          // 리사이즈 핸들이 내용을 가리지 않도록 하단 패딩 추가',
)

# 6) Auto-assignment review UI.
ui_path = "components/features/FixedAssigneeReversePlanner.tsx"
replace_once(
    ui_path,
    "interface ReviewAdjustment {\n  targetId: number;\n  preliminaryDate: string;\n  participantUserIds: number[];\n}\n",
    "interface ReviewAdjustment {\n  targetId: number;\n  preliminaryDate: string;\n  participantUserIds: number[];\n}\n\n"
    "interface ReviewSuggestion extends ReviewAdjustment {\n  surveyMethod: \"field\" | \"phone\";\n  reasons: string[];\n}\n",
)
replace_once(
    ui_path,
    'const violationText = (value: string) => violationLabels[value] ?? "운영지침 확인이 필요합니다.";\n',
    '''const violationText = (value: string) => violationLabels[value] ?? "운영지침 확인이 필요합니다.";

const businessTypeLabel: Record<PlannerTarget["businessType"], string> = {
  first_measurement: "최초실시",
  external_new: "타기관 신규",
  existing: "기존",
};

const suggestionReason = (reasons: string[]) => {
  const labels = [
    reasons.includes("KEEP_EXISTING") ? "기존값 유지" : null,
    reasons.includes("PRIMARY_DATE") ? "정책 우선 후보" : null,
    reasons.includes("FALLBACK_DATE") ? "fallback 후보" : null,
    reasons.includes("EXPERIENCED_SOLO") ? "경력자 단독" : null,
    reasons.includes("EXPERIENCED_AND_INEXPERIENCED") ? "경력+비경력" : null,
  ].filter(Boolean);
  return labels.join(" · ") || "운영지침 검증 완료";
};

type RouteWarning = { label: string; detail: string };
function collapseRouteWarnings(items: RouteWarning[]) {
  const grouped = new Map<string, string[]>();
  for (const item of items) grouped.set(item.label, [...(grouped.get(item.label) ?? []), item.detail]);
  return [...grouped.entries()].map(([label, details]) => ({
    label,
    detail: [...new Set(details)].join("\n"),
  }));
}
''',
)
replace_once(
    ui_path,
    "  const [reviewAdjustments, setReviewAdjustments] = useState<Map<number, ReviewAdjustment>>(new Map());",
    "  const [reviewAdjustments, setReviewAdjustments] = useState<Map<number, ReviewAdjustment>>(new Map());\n"
    "  const [reviewSuggestions, setReviewSuggestions] = useState<ReviewSuggestion[]>([]);\n"
    "  const [suggestionsLoading, setSuggestionsLoading] = useState(false);\n"
    "  const [suggestionError, setSuggestionError] = useState<string | null>(null);",
)
replace_once(
    ui_path,
    "      setSnapshot(result.snapshot);\n      setReviewAdjustments(new Map());\n      setCanOverride(result.canOverride === true);",
    "      setSnapshot(result.snapshot);\n      setReviewAdjustments(new Map());\n      setReviewSuggestions([]);\n      setSuggestionError(null);\n      setCanOverride(result.canOverride === true);",
)
replace_once(
    ui_path,
    "      setPreview(result);\n      setReviewAdjustments(new Map());",
    "      setPreview(result);\n      setReviewAdjustments(new Map());\n      setReviewSuggestions([]);\n      setSuggestionError(null);",
)
load_suggestions = r'''
  const loadReviewSuggestions = async (targetId: number) => {
    if (!preview) return;
    setSuggestionsLoading(true);
    setSuggestionError(null);
    setReviewSuggestions([]);
    try {
      const result = await request("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest_adjustments",
          measurementDate,
          previewToken: preview.previewToken,
          targetId,
          reviewAdjustments: [...reviewAdjustments.values()],
        }),
      });
      setReviewSuggestions((result.suggestions ?? []) as ReviewSuggestion[]);
    } catch (caught) {
      setSuggestionError(caught instanceof Error ? caught.message : "추천 후보를 계산하지 못했습니다.");
    } finally {
      setSuggestionsLoading(false);
    }
  };

'''
replace_once(ui_path, "  const openOverride = (targetId: number) => {", load_suggestions + "  const openOverride = (targetId: number) => {")
replace_once(
    ui_path,
    "    setOverrideReason(\"\");\n    setOverrideViolations([]);\n    setError(null);\n  };",
    "    setOverrideReason(\"\");\n    setOverrideViolations([]);\n    setReviewSuggestions([]);\n    setSuggestionError(null);\n    setError(null);\n    void loadReviewSuggestions(targetId);\n  };",
)
replace_once(
    ui_path,
    "    size=\"full\"\n  >\n    <div className=\"space-y-4 pt-4\" data-testid=\"preliminary-survey-auto-assignment-modal\">",
    "    size=\"full\"\n    bodyScroll={false}\n  >\n    <div className={`${overrideTargetId != null ? \"overflow-y-auto pr-1\" : \"overflow-hidden\"} flex h-[calc(92vh-108px)] min-h-0 flex-col gap-2 pt-2`} data-testid=\"preliminary-survey-auto-assignment-modal\">",
)
replace_once(
    ui_path,
    '      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 p-3">',
    '      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 p-2">',
)
replace_once(
    ui_path,
    '      {notice && <p className="text-sm font-medium text-emerald-700" role="status">{notice}</p>}\n      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}',
    '      {notice && <p className="text-sm font-medium text-emerald-700" role="status">{notice}</p>}\n      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}\n      {preview?.routeProviderConfigured === false && Number(preview.routeStats?.requiredPairs ?? 0) > 0 && <div data-testid="preliminary-survey-route-provider-warning" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">현재 Preview 환경에 Kakao 차량동선 API가 설정되지 않아 이동경로 대상은 자동 판정할 수 없습니다. 운영 데이터 문제와 구분하여 환경 설정을 확인해 주세요.</div>}',
)
replace_once(
    ui_path,
    '        className={`${snapshotTargetCount > 8 ? "max-h-[55vh] overflow-auto" : "overflow-x-auto"} rounded-lg border border-surface-200 bg-white`}>',
    '        className={`${snapshotTargetCount > 8 ? "min-h-0 flex-1 overflow-auto" : "shrink-0 overflow-x-auto overflow-y-hidden"} rounded-lg border border-surface-200 bg-white`}>',
)
# Compress table header.
for old, new in [
    ('<th className="w-48 px-3 py-3">사업장</th>', '<th className="w-48 px-2 py-2">사업장</th>'),
    ('<th className="w-28 px-3 py-3">측정예정일</th>', '<th className="w-28 px-2 py-2">측정예정일</th>'),
    ('<th className="w-48 px-3 py-3">측정자(공시료)</th>', '<th className="w-48 px-2 py-2">측정자(공시료)</th>'),
    ('<th className="w-36 px-3 py-3">측정 참여자</th>', '<th className="w-36 px-2 py-2">측정 참여자</th>'),
    ('<th className="w-28 px-3 py-3">보고서 담당</th>', '<th className="w-28 px-2 py-2">보고서 담당</th>'),
    ('<th className="w-28 bg-primary-50 px-3 py-3 text-primary-900">예비조사일</th>', '<th className="w-28 bg-primary-50 px-2 py-2 text-primary-900">예비조사일</th>'),
    ('<th className="w-40 bg-primary-50 px-3 py-3 text-primary-900">예비조사자</th>', '<th className="w-40 bg-primary-50 px-2 py-2 text-primary-900">예비조사자</th>'),
    ('<th className="w-20 px-3 py-3">방식</th>', '<th className="w-20 px-2 py-2">방식</th>'),
    ('<th className="w-40 px-3 py-3">상태</th>', '<th className="w-40 px-2 py-2">상태</th>'),
]:
    replace_once(ui_path, old, new)

old_route_block = '''              const routeWarnings = (preview?.routeEvidence ?? [])
                .filter((item) => (item.leftTargetId === target.id || item.rightTargetId === target.id)
                  && !item.sameAddress && (item.durationMinutes == null || item.durationMinutes > 30))
                .map((item) => {
                  const otherId = item.leftTargetId === target.id ? item.rightTargetId : item.leftTargetId;
                  const otherTarget = snapshot?.targets.find((entry) => entry.id === otherId);
                  const otherOccupancy = [...(snapshot?.actualMeasurementOccupancy ?? []), ...(snapshot?.existingSurveyOccupancy ?? [])]
                    .find((entry) => entry.targetId === otherId);
                  const otherLabel = otherTarget ? `${otherTarget.code} ${otherTarget.name}`
                    : otherOccupancy?.businessCode ?? `대상 ${otherId}`;
                  const sharedNames = (item.sharedUserIds ?? []).map((id) => userById.get(id)?.name).filter(Boolean).join(" · ");
                  const label = item.durationMinutes == null ? "이동경로 확인 필요"
                    : item.durationMinutes <= 60 ? `동선 검토 ${item.durationMinutes}분`
                      : `동선 불가 ${item.durationMinutes}분`;
                  const detail = `${item.date} · ${otherLabel}${sharedNames ? ` · 공통 ${sharedNames}` : ""}`
                    + ` · 정방향 ${item.forwardDurationMinutes ?? "-"}분 · 역방향 ${item.reverseDurationMinutes ?? "-"}분`
                    + ` · 적용 ${item.effectiveDurationMinutes ?? item.durationMinutes ?? "-"}분`;
                  return { label, detail };
                });
              const isReviewAdjusted = reviewAdjustments.has(target.id);'''
new_route_block = '''              const routeWarnings = collapseRouteWarnings((preview?.routeEvidence ?? [])
                .filter((item) => (item.leftTargetId === target.id || item.rightTargetId === target.id)
                  && !item.sameAddress && (item.durationMinutes == null || item.durationMinutes > 30))
                .map((item) => {
                  const otherId = item.leftTargetId === target.id ? item.rightTargetId : item.leftTargetId;
                  const otherTarget = snapshot?.targets.find((entry) => entry.id === otherId);
                  const otherOccupancy = [...(snapshot?.actualMeasurementOccupancy ?? []), ...(snapshot?.existingSurveyOccupancy ?? [])]
                    .find((entry) => entry.targetId === otherId);
                  const otherLabel = otherTarget ? `${otherTarget.code} ${otherTarget.name}`
                    : otherOccupancy?.businessCode ?? `대상 ${otherId}`;
                  const sharedNames = (item.sharedUserIds ?? []).map((id) => userById.get(id)?.name).filter(Boolean).join(" · ");
                  const label = item.durationMinutes == null ? "이동경로 확인 필요"
                    : item.durationMinutes <= 60 ? `동선 검토 ${item.durationMinutes}분`
                      : `동선 불가 ${item.durationMinutes}분`;
                  const detail = `${item.date} · ${otherLabel}${sharedNames ? ` · 공통 ${sharedNames}` : ""}`
                    + ` · 정방향 ${item.forwardDurationMinutes ?? "-"}분 · 역방향 ${item.reverseDurationMinutes ?? "-"}분`
                    + ` · 적용 ${item.effectiveDurationMinutes ?? item.durationMinutes ?? "-"}분`;
                  return { label, detail };
                }));
              const isReviewAdjusted = reviewAdjustments.has(target.id);
              const valueSourceLabel = isReviewAdjusted ? "수정안"
                : result?.decision === "AUTO_ASSIGNED" && result.mutation === "KEEP_EXISTING" ? "기존값 유지"
                  : candidate ? "자동계산" : plan ? "기존값" : repair ? "보정안" : "미계산";
              const visibleRouteWarnings = routeWarnings.filter((warning) => warning.label !== status.label);'''
replace_once(ui_path, old_route_block, new_route_block)
replace_once(
    ui_path,
    '<td className="px-2 py-2"><div className="font-semibold text-text-900">{target.code}</div><div className="truncate text-text-700" title={target.name}>{target.name}</div></td>',
    '<td className="px-2 py-2"><div className="font-semibold text-text-900">{target.code}</div><div className="truncate text-text-700" title={target.name}>{target.name}</div><div className="mt-1 flex flex-wrap gap-1 text-[11px]"><span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">{businessTypeLabel[target.businessType]}</span><span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">{valueSourceLabel}</span></div></td>',
)
old_fixed_block = '''                  return <div key={day.date}>
                    <select aria-label={`${target.code} ${day.date} 고정 측정자`} value={fixed?.assigneeUserId ?? ""}
                      onChange={(event) => event.target.value
                        ? void confirmFixed(target.id, day.date, Number(event.target.value))
                        : undefined}
                      className="h-9 w-full rounded-md border border-surface-300 bg-white px-2 text-sm">
                      <option value="" disabled={Boolean(fixed)}>자동</option>
                      {priority.map((user) => user && <option key={user.id} value={user.id}>{user.name}({user.baseCode ?? "-"}){day.collaboratorUserIds.includes(user.id) ? " · 참여" : ""}</option>)}
                    </select>
                    {fixed && <div className="mt-1 text-xs font-medium text-emerald-700">✓ 고정</div>}
                    {!fixed && automatic && <div className="mt-1 text-xs font-medium text-primary-700">자동 · {userById.get(automatic.assigneeUserId)?.name ?? "-"}({automatic.publicSampleCode})</div>}
                    {fixed?.nonParticipantConfirmed && <div className="mt-1 text-xs font-medium text-amber-700">⚠ 측정 참여자가 아닌 직원을 선택했습니다.</div>}
                  </div>;'''
new_fixed_block = '''                  return <div key={day.date} className="flex items-center gap-1">
                    <select aria-label={`${target.code} ${day.date} 고정 측정자`} value={fixed?.assigneeUserId ?? ""}
                      onChange={(event) => event.target.value
                        ? void confirmFixed(target.id, day.date, Number(event.target.value))
                        : undefined}
                      className="h-8 min-w-0 flex-1 rounded-md border border-surface-300 bg-white px-2 text-sm">
                      <option value="" disabled={Boolean(fixed)}>자동</option>
                      {priority.map((user) => user && <option key={user.id} value={user.id}>{user.name}({user.baseCode ?? "-"}){day.collaboratorUserIds.includes(user.id) ? " · 참여" : ""}</option>)}
                    </select>
                    {fixed && <span className="shrink-0 text-xs font-semibold text-emerald-700" title="고정 측정자">✓</span>}
                    {!fixed && automatic && <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-primary-700" title={`자동 · ${userById.get(automatic.assigneeUserId)?.name ?? "-"}(${automatic.publicSampleCode})`}>자동 {userById.get(automatic.assigneeUserId)?.name ?? "-"}</span>}
                    {fixed?.nonParticipantConfirmed && <span className="shrink-0 text-xs font-semibold text-amber-700" title="측정 참여자가 아닌 직원을 선택했습니다.">⚠</span>}
                  </div>;'''
replace_once(ui_path, old_fixed_block, new_fixed_block)
replace_once(
    ui_path,
    '{routeWarnings.length > 0 && <div className="mt-1 space-y-0.5 text-xs font-medium text-amber-700">{routeWarnings.map((warning, index) => <div key={`${warning.label}-${index}`} title={warning.detail}>{warning.label}</div>)}</div>}',
    '{visibleRouteWarnings.length > 0 && <div className="mt-1 space-y-0.5 text-xs font-medium text-amber-700">{visibleRouteWarnings.map((warning) => <div key={warning.label} title={warning.detail}>{warning.label}</div>)}</div>}',
)
recommendation_panel = r'''        <div className="mb-3 rounded-md border border-surface-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2"><div className="text-sm font-semibold text-text-900">지침에 맞는 추천 후보</div><div className="text-xs text-text-500">최대 3개</div></div>
          {suggestionsLoading && <p className="mt-2 text-sm text-text-500">현재 일정·인원·동선을 기준으로 후보를 확인하는 중...</p>}
          {suggestionError && <p className="mt-2 text-sm font-medium text-amber-700">{suggestionError}</p>}
          {!suggestionsLoading && !suggestionError && reviewSuggestions.length === 0 && <p className="mt-2 text-sm text-text-600">현재 batch에서 자동 지침을 통과한 추천 후보가 없습니다. 아래 직접 수정에서 값을 지정해 검증해 주세요.</p>}
          {reviewSuggestions.length > 0 && <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">{reviewSuggestions.map((suggestion, index) => <button type="button" key={`${suggestion.preliminaryDate}-${suggestion.participantUserIds.join("-")}`} onClick={() => { setOverrideDate(suggestion.preliminaryDate); setOverrideMethod(suggestion.surveyMethod); setOverrideParticipants(suggestion.participantUserIds); setOverrideViolations([]); }} className="rounded-md border border-primary-200 bg-primary-50/40 p-3 text-left hover:border-primary-400 hover:bg-primary-50">
            <div className="text-xs font-bold text-primary-700">{index + 1}순위</div>
            <div className="mt-1 font-semibold text-text-900">{suggestion.preliminaryDate} · {suggestion.surveyMethod === "field" ? "방문" : "유선"}</div>
            <div className="mt-1 text-sm text-text-700">{participantText(suggestion.participantUserIds)}</div>
            <div className="mt-1 text-xs text-text-500">{suggestionReason(suggestion.reasons)}</div>
          </button>)}</div>}
        </div>
        <div className="mb-2 text-sm font-semibold text-text-900">직접 수정</div>
'''
replace_once(
    ui_path,
    '        {overrideViolations.length > 0 && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><div className="font-medium">확인할 위반사항</div><ul className="mt-1 list-disc pl-5">{overrideViolations.map((violation) => <li key={violation}>{violationText(violation)}</li>)}</ul></div>}\n        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">',
    recommendation_panel + '        {overrideViolations.length > 0 && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><div className="font-medium">확인할 위반사항</div><ul className="mt-1 list-disc pl-5">{overrideViolations.map((violation) => <li key={violation}>{violationText(violation)}</li>)}</ul></div>}\n        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">',
)
replace_once(
    ui_path,
    '<div className="flex justify-end"><Button variant="secondary" onClick={onClose} disabled={working}>닫기</Button></div>',
    '<div className="mt-auto flex justify-end"><Button variant="secondary" onClick={onClose} disabled={working}>닫기</Button></div>',
)

# 7) Document env requirement to prevent preview-only route failures from recurring.
env_path = ".env.example"
replace_once(
    env_path,
    "# 카카오 Local REST API Settings (Server Side)\nKAKAO_REST_API_KEY=",
    "# 카카오 Local REST API Settings (Server Side)\n# Vercel Preview에서 자동배정 Route UAT를 할 때도 Preview scope에 동일 변수명을 설정해야 합니다.\nKAKAO_REST_API_KEY=",
)

# 8) Regression coverage.
test_path = "tests/preliminary-survey-reverse-planner.test.ts"
replace_once(
    test_path,
    'import { planPreliminarySurveyGivenFixedAssignments, validateCandidateHardRules } from "../lib/preliminary-survey-v2/reverse-planner/solver";',
    'import { planPreliminarySurveyGivenFixedAssignments, rankedCandidatesForTarget, validateCandidateHardRules } from "../lib/preliminary-survey-v2/reverse-planner/solver";',
)
marker = '\ntest("v1.1 정상 Apply만 재활성화하고 legacy manual write는 계속 차단한다", () => {'
test_file = Path(test_path)
test_text = test_file.read_text(encoding="utf-8")
if marker not in test_text:
    raise SystemExit("test insertion marker missing")
addition = r'''

test("H0527 수정 추천 pool은 최초실시 상위 3개 날짜를 -3 → -5 순으로 보존한다", () => {
  const h0527 = target({
    businessType: "first_measurement",
    days: [{ date: "2026-09-02", collaboratorUserIds: [5], reportWriterUserId: 5 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-02", assigneeUserId: 5, confirmedAt: "x", updatedAt: "x" }],
  });
  const input = fixture({ targets: [h0527] });
  const dates = [...new Set(rankedCandidatesForTarget(input, h0527).map((candidate) => candidate.preliminaryDate))].slice(0, 3);
  assert.deepEqual(dates, ["2026-08-28", "2026-08-27", "2026-08-26"]);
});

test("자동배정 검토 UI는 업체구분·출처·추천3안·route 환경진단·모달 무스크롤 계약을 가진다", () => {
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  const modal = readFileSync("components/ui/Modal.tsx", "utf8");
  const env = readFileSync(".env.example", "utf8");
  assert.match(ui, /first_measurement: "최초실시"/);
  assert.match(ui, /candidate \? "자동계산"/);
  assert.match(ui, /action: "suggest_adjustments"/);
  assert.match(ui, /지침에 맞는 추천 후보/);
  assert.match(ui, /bodyScroll=\{false\}/);
  assert.match(ui, /collapseRouteWarnings/);
  assert.match(ui, /visibleRouteWarnings/);
  assert.match(route, /body\.action !== "suggest_adjustments"/);
  assert.match(route, /rankedCandidatesForTarget/);
  assert.match(route, /preferred\.slice\(0, 3\)/);
  assert.match(route, /routeProviderConfigured: Boolean\(process\.env\.KAKAO_REST_API_KEY\)/);
  assert.match(modal, /bodyScroll\?: boolean/);
  assert.match(modal, /bodyScroll \? "overflow-y-auto custom-scrollbar" : "overflow-hidden"/);
  assert.match(env, /Vercel Preview[\s\S]*KAKAO_REST_API_KEY/);
});
'''
test_file.write_text(test_text.replace(marker, addition + marker, 1), encoding="utf-8")

print(f"patched UAT follow-up against canonical blob {canonical_blob}")
