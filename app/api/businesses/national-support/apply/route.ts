import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { normalizeContactName } from "@/lib/utils/data-utils";
import { resolveNationalSupportRepresentative } from "@/lib/national-support/representative";
import { syncToMasterTables } from "@/lib/sync/master-tables";
import { hasNationalSupportApplicationInformation, normalizeElevenDigitNumber } from "@/lib/national-support/eligibility";
import { enqueueAutomationJob, nationalSupportIdempotencyKey } from "@/lib/automation/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { nationalSupportCompatibilityProjection, readNationalSupportExecutionDecision } from "@/lib/national-support/automation-contract";
import { matchesNationalSupportTargetKey, NATIONAL_SUPPORT_TARGET_KEY_MISMATCH } from "@/lib/national-support/apply-boundaries";

/**
 * 건강디딤돌 자동 신청 API
 * POST /api/businesses/national-support/apply
 */
export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  try {
    // 권한 검증
    await checkPermission("journal:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const requestId = request.headers.get("Idempotency-Key")?.trim() || String(body.request_id || "").trim() || randomUUID();
    const {
      target_id,
      period: requestedPeriod,
      code: requestedCode,
      year: requestedYear,
      mode = "lookup_only",
      intent: requestedIntent,
    } = body;

    if (mode === "final_lookup") {
      return NextResponse.json({
        error: "최종 결과 조회는 내부 후속 작업으로만 실행할 수 있습니다.",
        errorCode: "NATIONAL_SUPPORT_FINAL_LOOKUP_INTERNAL_ONLY",
      }, { status: 400 });
    }

    let jobMode: "apply_if_missing" | "lookup_only" = mode === "apply_if_missing"
      ? mode
      : "lookup_only";
    const intent = requestedIntent === "direct" ? "direct" as const : "automatic" as const;

    // 필수 입력값 검증 (담당자명 및 연락처는 결과 조회 시 필수 항목이 아니므로 제외)
    if (!target_id || !requestedPeriod || !requestedCode || !requestedYear) {
      return NextResponse.json(
        { error: "필수 요청 항목이 누락되었습니다." },
        { status: 400 }
      );
    }

    const { data: canonicalTarget, error: targetError } = await createAdminClient()
      .from("measurement_target_business")
      .select("id, code, year, period, representative_name, industrial_accident_number, commencement_number, manager_name, manager_mobile, is_registered")
      .eq("id", target_id).maybeSingle();
    if (targetError) throw targetError;
    if (!canonicalTarget) {
      return NextResponse.json({ error: "대상 사업장 정보를 찾을 수 없습니다." }, { status: 404 });
    }
    if (!matchesNationalSupportTargetKey(
      { code: requestedCode, year: requestedYear, period: requestedPeriod }, canonicalTarget,
    )) {
      return NextResponse.json({
        error: "요청한 사업장 코드·연도·주기가 대상 사업장과 일치하지 않습니다.",
        errorCode: NATIONAL_SUPPORT_TARGET_KEY_MISMATCH,
      }, { status: 409 });
    }
    const { id: canonicalTargetId, code, year, period } = canonicalTarget;
    const executionTarget = {
      target_id: canonicalTargetId, code: String(code), year: Number(year), period: String(period),
    };
    const executionDecision = await readNationalSupportExecutionDecision(
      createAdminClient(), executionTarget, { intent, mode: jobMode },
    );
    if (executionDecision.action === "skip") {
      return NextResponse.json({ success: true, resultCode: executionDecision.resultCode,
        message: executionDecision.resultCode === "JOURNAL_REGISTERED_SKIP"
          ? "측정일지가 등록되어 자동 조회·신청을 시작하지 않았습니다. 직접 결과 조회는 가능합니다."
          : "거래종료 또는 활성 상태가 아닌 사업장은 건강디딤돌 조회·신청에서 제외됩니다." });
    }
    jobMode = executionDecision.mode === "apply_if_missing" ? "apply_if_missing" : "lookup_only";
    const { data: businessInfo, error: businessInfoError } = await createAdminClient()
      .from("business_info")
      .select("representative_name, national_support_representative_name")
      .eq("code", code)
      .maybeSingle();
    if (businessInfoError) throw businessInfoError;
    const effectiveRepresentative = resolveNationalSupportRepresentative(
      businessInfo?.national_support_representative_name,
      businessInfo?.representative_name || canonicalTarget.representative_name,
    );
    // 건강디딤돌 신청 대표자는 전용 override일 뿐, master 대표자 projection에
    // 전달할 값이 아니다. 기존 기본 대표자를 그대로 유지한다.
    const canonicalRepresentative = businessInfo?.representative_name || canonicalTarget.representative_name || null;
    if (!effectiveRepresentative) {
      return NextResponse.json({ error: "신청 대표자 정보가 없습니다." }, { status: 400 });
    }

    const normalizedSanjae = normalizeElevenDigitNumber(canonicalTarget.industrial_accident_number);
    const normalizedCommencement = normalizeElevenDigitNumber(canonicalTarget.commencement_number);
    if (!normalizedSanjae || !normalizedCommencement) {
      return NextResponse.json(
        { error: "저장된 산재관리번호와 사업개시번호가 각각 정확한 11자리여야 합니다. 상세에서 저장한 뒤 조회해 주세요." },
        { status: 400 },
      );
    }

    if (jobMode === "apply_if_missing" && !hasNationalSupportApplicationInformation({
      industrial_accident_number: normalizedSanjae,
      commencement_number: normalizedCommencement,
      representative_name: effectiveRepresentative,
      manager_name: canonicalTarget.manager_name,
      manager_mobile: canonicalTarget.manager_mobile,
    })) {
      return NextResponse.json(
        { error: "자동 신청에는 실제 담당자명과 010 휴대전화가 필요합니다." },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    // Enqueue 직전에도 상태/일지를 다시 읽는다. Worker와 신청 직전에도 재검사한다.
    const latestDecision = await readNationalSupportExecutionDecision(
      createAdminClient(), executionTarget, { intent, mode: jobMode },
    );
    if (latestDecision.action === "skip") {
      return NextResponse.json({ success: true, resultCode: latestDecision.resultCode,
        message: latestDecision.resultCode === "JOURNAL_REGISTERED_SKIP"
          ? "측정일지가 등록되어 자동 조회·신청을 시작하지 않았습니다."
          : "거래종료 또는 활성 상태가 아닌 사업장은 조회·신청하지 않습니다." });
    }
    jobMode = latestDecision.mode === "apply_if_missing" ? "apply_if_missing" : "lookup_only";

    // 대상 행의 수동 상태와 기존 공단 결과를 확인한다. 중복 실행은 durable lane에서 막는다.
    const { data: currentPlan, error: selectError } = await supabase
      .from("measurement_target_business")
      .select("national_support_status")
      .eq("id", canonicalTargetId)
      .single();

    if (selectError) {
      console.error("대상 사업장 조회 실패:", selectError);
      return NextResponse.json(
        { error: "대상 사업장 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // target의 수동 상태는 화면 표시용 placeholder일 수 있다. 실제 application
    // source를 먼저 확인해야 manual_internal 비대상이 조회 job 자체를 막지 않는다.
    const { data: existingApp, error: appError } = await supabase
      .from("national_support_application")
      .select("national_support_status, status_source, application_status, result")
      .eq("code", code)
      .eq("year", parseInt(String(year)))
      .eq("period", period)
      .maybeSingle();
    if (appError) throw appError;
    const hasManualInternalPlaceholder = existingApp?.status_source === "manual_internal";

    // 목록은 측정사업장/측정일지의 국고 상태를 보완해 표시할 수 있습니다.
    // 화면에서 "대상"으로 확인한 뒤 새로고침을 누른 경우, 대상 사업장 테이블의
    // 값이 비어 있어도 조회를 허용한다.
    if (currentPlan.national_support_status === "비대상" && !hasManualInternalPlaceholder &&
        !(intent === "direct" && jobMode === "lookup_only")) {
      return NextResponse.json(
        { error: "국고 지원 비대상 사업장입니다." },
        { status: 400 }
      );
    }

    // 수동 확인 placeholder는 외부 조회의 실제 결과가 아니므로 shortcut으로
    // 처리하지 않고 lookup job을 enqueue한다. source가 없던 legacy 행은
    // result/application_status라는 실제 결과 증거가 있을 때만 호환한다.
    const hasConfirmedExistingResult = existingApp && (
      existingApp.status_source === "confirmed_result" ||
      (existingApp.status_source == null && Boolean(existingApp.result || existingApp.application_status))
    );
    // 직접 조회는 저장된 과거 판정을 반환하지 않고 현재 공단 결과를 확인한다.
    if (intent === "direct" && hasConfirmedExistingResult) jobMode = "lookup_only";
    if (intent !== "direct" && hasConfirmedExistingResult && (existingApp.national_support_status === "대상" || existingApp.national_support_status === "비대상")) {
      const dbStatus = existingApp.national_support_status;

      // 계획 테이블(measurement_target_business) 즉시 성공 처리 및 상태 업데이트
      const { error: errTarget } = await supabase
        .from("measurement_target_business")
        .update({
          ...nationalSupportCompatibilityProjection(dbStatus === "대상" ? "SUPPORT" : "NON_SUPPORT"),
          national_support_status: dbStatus,
        })
        .eq("id", canonicalTargetId);

      if (errTarget) {
        console.error("즉시 동기화 계획 테이블 업데이트 실패:", errTarget);
      }

      // 마스터 테이블(measurement_business, business_info) 최종 확정 동기화
      try {
        const { data: targetBusiness } = await supabase
          .from("measurement_target_business")
          .select("business_name")
          .eq("id", canonicalTargetId)
          .single();
        
        const bName = targetBusiness?.business_name || "미등록 사업장";

        await syncToMasterTables(
          supabase,
          code,
          Number(year),
          period,
          bName,
          canonicalRepresentative,
          normalizedSanjae,
          normalizedCommencement,
          { updateBusinessInfo: false },
        );
      } catch (mbErr) {
        console.error(`즉시 동기화 마스터 테이블 업데이트 중 예외 발생 (code: ${code}):`, mbErr);
      }

      return NextResponse.json({
        success: true,
        message: `기존 건강디딤돌 신청결과(${dbStatus})가 즉시 반영되었습니다.`,
        instantSync: true,
        status: dbStatus,
      });
    }


    const jobPayload = {
      target_id: canonicalTargetId,
      sanjae: normalizedSanjae,
      commencement: normalizedCommencement,
      representative: effectiveRepresentative,
      contact_name: normalizeContactName(canonicalTarget.manager_name) || "",
      contact_phone: canonicalTarget.manager_mobile || "",
      period,
      code,
      year,
      requested_by: user.id,
      intent,
      mode: jobMode,
    };

    const automationJob = await enqueueAutomationJob(createAdminClient(), {
      jobType: "NATIONAL_SUPPORT",
      idempotencyKey: nationalSupportIdempotencyKey(
        jobMode === "apply_if_missing" ? "apply" : "lookup",
        String(code), year, period, requestId,
      ),
      targetKey: `national-support:${canonicalTargetId}`,
      requestPayload: jobPayload,
      requestedBy: Number(user.id),
    });

    // The target lane may return another user's or a scheduled active job.
    // Neither its identifier nor its payload belongs in this response.
    if (automationJob.requested_by !== Number(user.id)) {
      return NextResponse.json({
        error: "다른 건강디딤돌 작업이 진행 중입니다.",
        errorCode: "NATIONAL_SUPPORT_ALREADY_RUNNING",
      }, { status: 409 });
    }

    return NextResponse.json({
      success: true,
      message: jobMode === "apply_if_missing"
        ? "건강디딤돌 조회 및 자동 신청 작업이 백그라운드 작업자에 전달되었습니다."
        : "건강디딤돌 조회 작업이 백그라운드 작업자에 전달되었습니다. 결과는 잠시 후 반영됩니다.",
      jobId: automationJob.id,
      mode: automationJob.request_payload?.mode ?? jobMode,
    });

  } catch (error: any) {
    console.error("[NationalSupportQueue] API 처리 오류", {
      correlationId,
      errorCode: "NATIONAL_SUPPORT_API_FAILED",
      code: error?.code || null,
      message: error?.message || null,
    });
    return NextResponse.json(
      {
        error: "자동 신청 기동 중 내부 오류가 발생했습니다.",
        errorCode: "NATIONAL_SUPPORT_API_FAILED",
        correlationId,
      },
      { status: 500 },
    );
  }
}

