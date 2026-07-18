import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { normalizeContactName, normalizeRepresentativeName } from "@/lib/utils/data-utils";
import { syncToMasterTables } from "@/lib/sync/master-tables";
import { hasNationalSupportApplicationInformation, normalizeElevenDigitNumber } from "@/lib/national-support/eligibility";

/**
 * 건강디딤돌 자동 신청 API
 * POST /api/businesses/national-support/apply
 */
export async function POST(request: NextRequest) {
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
    const {
      target_id,
      sanjae,
      commencement,
      representative,
      contact_name,
      contact_phone,
      period,
      code,
      year,
      mode = "lookup_only",
    } = body;

    const jobMode = mode === "apply_if_missing" || mode === "final_lookup"
      ? mode
      : "lookup_only";

    // 필수 입력값 검증 (담당자명 및 연락처는 결과 조회 시 필수 항목이 아니므로 제외)
    if (!target_id || !sanjae || !commencement || !representative || !period || !code || !year) {
      return NextResponse.json(
        { error: "필수 요청 항목이 누락되었습니다." },
        { status: 400 }
      );
    }

    const normalizedSanjae = normalizeElevenDigitNumber(sanjae);
    const normalizedCommencement = normalizeElevenDigitNumber(commencement);
    if (!normalizedSanjae || !normalizedCommencement) {
      return NextResponse.json(
        { error: "산재관리번호와 사업개시번호는 각각 정확한 11자리여야 합니다." },
        { status: 400 },
      );
    }

    if (period.includes("(수시)")) {
      return NextResponse.json(
        { error: "수시 주기는 건강디딤돌 지원 대상이 아닙니다." },
        { status: 400 }
      );
    }

    if (jobMode === "apply_if_missing" && !hasNationalSupportApplicationInformation({
      industrial_accident_number: normalizedSanjae,
      commencement_number: normalizedCommencement,
      representative_name: representative,
      manager_name: contact_name,
      manager_mobile: contact_phone,
    })) {
      return NextResponse.json(
        { error: "자동 신청에는 실제 담당자명과 010 휴대전화가 필요합니다." },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    // 중복 전송 방지를 위한 락(Lock) 확인 및 설정
    const { data: currentPlan, error: selectError } = await supabase
      .from("measurement_target_business")
      .select("sync_status, national_support_status")
      .eq("id", target_id)
      .single();

    if (selectError) {
      console.error("대상 사업장 조회 실패:", selectError);
      return NextResponse.json(
        { error: "대상 사업장 정보를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 목록은 측정사업장/측정일지의 국고 상태를 보완해 표시할 수 있습니다.
    // 화면에서 "대상"으로 확인한 뒤 새로고침을 누른 경우, 대상 사업장 테이블의
    // 값이 비어 있어도 조회를 허용하고 아래 락 단계에서 "대상"으로 맞춥니다.
    if (currentPlan.national_support_status === "비대상") {
      return NextResponse.json(
        { error: "국고 지원 비대상 사업장입니다." },
        { status: 400 }
      );
    }

    if (currentPlan.sync_status === "신청중" || currentPlan.sync_status === "조회중") {
      return NextResponse.json(
        { error: "이미 해당 사업장에 대한 결과 조회 작업이 진행 중입니다." },
        { status: 400 }
      );
    }

    const { data: duplicateJobs, error: duplicateJobError } = await supabase
      .from("background_jobs")
      .select("id")
      .eq("job_type", "national_support")
      .in("status", ["pending", "processing", "cancel_requested"])
      .contains("payload", { target_id, mode: jobMode })
      .limit(1);
    if (duplicateJobError) {
      return NextResponse.json(
        { error: "건강디딤돌 중복 작업 확인에 실패했습니다." },
        { status: 500 },
      );
    }
    if (duplicateJobs && duplicateJobs.length > 0) {
      return NextResponse.json(
        { error: "이미 해당 사업장의 결과 조회 작업이 대기 중이거나 진행 중입니다." },
        { status: 409 },
      );
    }

    // 기존 건강디딤돌 신청결과 테이블을 조회하여 결과 존재 시 즉시 동기화 처리
    const { data: existingApp, error: appError } = await supabase
      .from("national_support_application")
      .select("national_support_status")
      .eq("code", code)
      .eq("year", parseInt(String(year)))
      .eq("period", period)
      .maybeSingle();

    if (!appError && existingApp && (existingApp.national_support_status === "대상" || existingApp.national_support_status === "비대상")) {
      const dbStatus = existingApp.national_support_status;

      // 계획 테이블(measurement_target_business) 즉시 성공 처리 및 상태 업데이트
      const { error: errTarget } = await supabase
        .from("measurement_target_business")
        .update({
          sync_status: "성공",
          sync_error_message: null,
          national_support_status: dbStatus,
          industrial_accident_number: normalizedSanjae,
          commencement_number: normalizedCommencement,
          representative_name: representative || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target_id);

      if (errTarget) {
        console.error("즉시 동기화 계획 테이블 업데이트 실패:", errTarget);
      }

      // 마스터 테이블(measurement_business, business_info) 최종 확정 동기화
      try {
        const { data: targetBusiness } = await supabase
          .from("measurement_target_business")
          .select("business_name")
          .eq("id", target_id)
          .single();
        
        const bName = targetBusiness?.business_name || "미등록 사업장";

        await syncToMasterTables(
          supabase,
          code,
          Number(year),
          period,
          bName,
          representative || null,
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


    // 조회 작업 락과 입력값만 저장합니다. 결과가 나오기 전에는 대상 여부를 확정하지 않습니다.
    const { data: lockedPlan, error: lockError } = await supabase
      .from("measurement_target_business")
      .update({
        sync_status: "조회중",
        sync_error_message: null,
        industrial_accident_number: normalizedSanjae,
        commencement_number: normalizedCommencement,
        representative_name: representative || null,
      })
      .eq("id", target_id)
      .or("sync_status.is.null,sync_status.not.in.(신청중,조회중)")
      .select("id")
      .maybeSingle();

    if (lockError) {
      console.error("락 설정 실패:", lockError);
      return NextResponse.json(
        { error: "자동 신청 상태를 변경하는 데 실패했습니다." },
        { status: 500 }
      );
    }
    if (!lockedPlan) {
      return NextResponse.json(
        { error: "다른 요청이 먼저 조회 작업을 시작했습니다." },
        { status: 409 },
      );
    }

    // 배포 서버는 Python 크롤러를 직접 실행하지 않습니다. 공용 DB 대기열에 등록하면
    // 백그라운드 WorkerDaemon이 작업을 가져가 공단 조회와 결과 반영을 수행합니다.
    const { data: queuedJob, error: queueError } = await supabase
      .from("background_jobs")
      .insert({
        job_type: "national_support",
        status: "pending",
        payload: {
          target_id,
          sanjae: normalizedSanjae,
          commencement: normalizedCommencement,
          representative: normalizeRepresentativeName(representative) || representative,
          contact_name: normalizeContactName(contact_name) || "",
          contact_phone: contact_phone || "",
          period,
          code,
          year,
          requested_by: user.id,
          mode: jobMode,
        },
      })
      .select("id")
      .single();

    if (queueError) {
      await supabase
        .from("measurement_target_business")
        .update({
          sync_status: "실패",
          sync_error_message: `조회 작업 등록 실패: ${queueError.message}`,
        })
        .eq("id", target_id);

      return NextResponse.json(
        { error: "건강디딤돌 조회 작업을 등록하지 못했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: jobMode === "apply_if_missing"
        ? "건강디딤돌 조회 및 자동 신청 작업이 백그라운드 작업자에 전달되었습니다."
        : "건강디딤돌 조회 작업이 백그라운드 작업자에 전달되었습니다. 결과는 잠시 후 반영됩니다.",
      jobId: queuedJob.id,
    });

  } catch (error: any) {
    console.error("자동 신청 API 기동 오류:", error);
    return NextResponse.json(
      { error: error.message || "자동 신청 기동 중 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

