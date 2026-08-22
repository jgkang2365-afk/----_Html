import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";
import { loadGroupRecommendationTargets, loadV2AutomationPolicy } from "@/lib/preliminary-survey-v2/service";
import { isPreliminarySurveyV2AutomationEnabled } from "@/lib/preliminary-survey-v2/policy";
import { buildGroupRecommendation } from "@/lib/preliminary-survey-v2/group-recommendation";

export const dynamic = "force-dynamic";

/**
 * 주소 기반 예비조사 일정 묶음 추천 (READ-ONLY)
 *
 * - 측정대상사업장의 주소(좌표) + 가능 예비조사일 + 예비조사 인력을 기준으로
 *   가까운 사업장을 같은 날짜로 묶는 추천을 계산한다.
 * - 이 API는 SELECT + 순수 계산만 수행하며 운영 데이터를 저장/변경하지 않는다.
 * - measurement_journal row가 존재하는 찐확정 사업장은 제외된다.
 * - 추천과 확정은 분리: 여기서는 추천만 반환한다.
 * - 예비조사 자동추천 정책이 OFF이면 추천을 계산하지 않고 enabled=false를 반환한다.
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("survey:read");
    const { searchParams } = new URL(request.url);
    const yearText = searchParams.get("year");
    const year = yearText ? Number(yearText) : null;
    const period = searchParams.get("period") || null;
    const targetIds = searchParams.get("targetIds")
      ? searchParams.get("targetIds")!.split(",").map(Number).filter(Number.isFinite)
      : undefined;

    const supabase = await createClient();
    const policy = await loadV2AutomationPolicy(supabase);
    if (!isPreliminarySurveyV2AutomationEnabled(policy)) {
      return NextResponse.json({
        enabled: false,
        reason: "POLICY_DISABLED",
        message: "예비조사 자동추천 정책이 중지되어 있습니다.",
        groups: [], blocked: [], targetCount: 0,
      });
    }

    if (!targetIds?.length && (year == null || !Number.isInteger(year) || !period)) {
      return NextResponse.json({ error: "INVALID_FILTER" }, { status: 400 });
    }

    const targets = await loadGroupRecommendationTargets(supabase, {
      year: year ?? undefined,
      period: period ?? undefined,
      targetIds,
    });
    const output = buildGroupRecommendation(targets);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      targetCount: targets.length,
      enabled: true,
      ...output,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "GROUP_RECOMMENDATION_FAILED";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
