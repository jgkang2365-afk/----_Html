import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET(request: Request) {
  try {
    // 권한 체크
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    console.log(`[API /api/journal/businesses] Request: code=${code}, year=${year}, period=${period}`);

    const supabase = await createClient();

    // 특정 코드로 조회하는 경우
    if (code) {
      // 1. business_info 조회 (기본 정보)
      const { data: businessInfo, error: infoError } = await supabase
        .from("business_info")
        .select("*")
        .eq("code", code)
        .maybeSingle();

      if (infoError && infoError.code !== "PGRST116") {
        console.error("사업장정보 조회 오류:", infoError);
      }

      // 2. measurement_business의 모든 과거 이력 조회 (우선순위 데이터 추출용)
      // 최신순 정렬: year DESC, period DESC
      const { data: allBusinessHistory, error: historyError } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .order("year", { ascending: false })
        .order("period", { ascending: false });

      if (historyError) {
        console.error("측정사업장 이력 조회 오류:", historyError);
      }

      // 요청한 연도/주기에 해당하는 데이터 찾기 (Base Data)
      let baseBusinessData = null;
      if (year && period && allBusinessHistory) {
        baseBusinessData = allBusinessHistory.find(
          (b: any) => b.year === parseInt(year) && b.period === period
        );
      }

      // 요청한 데이터가 없으면 가장 최신 데이터 사용 (Fallback)
      if (!baseBusinessData && allBusinessHistory && allBusinessHistory.length > 0) {
        baseBusinessData = allBusinessHistory[0];
      }

      // 우선순위에 따른 기본값 추출 (2026 상반기 -> 2025 하반기 -> ...)
      // 찾고자 하는 필드들의 첫 번째 non-null 값을 찾음
      const findFirstValue = (field: string) => {
        if (!allBusinessHistory) return null;
        for (const record of allBusinessHistory) {
          if (record[field]) return record[field];
        }
        return null;
      };

      const prioritizedDefaults = {
        industrial_accident_number: findFirstValue("industrial_accident_number"),
        commencement_number: findFirstValue("commencement_number"),
        manager_email: findFirstValue("manager_email"),
        invoice_email: findFirstValue("invoice_email"), // 계산서 메일
        manager_name: findFirstValue("manager_name"),
        manager_mobile: findFirstValue("manager_mobile"),
        manager_position: findFirstValue("manager_position"),
        phone: findFirstValue("phone"),
        fax: findFirstValue("fax"),
        business_number: findFirstValue("business_number"),
        representative_name: findFirstValue("representative_name"),
        address: findFirstValue("address"),
      };

      // 3. measurement_journal 조회 (담당자 정보 우선순위: journal > business)
      // 최근 5개 journal 데이터에서 담당자 정보 및 산재관리번호 등을 찾아옴 (마지막 데이터가 비어있을 수 있으므로)
      let journalManagerInfo: Record<string, any> = {};
      const { data: recentJournals, error: journalError } = await supabase
        .from("measurement_journal")
        .select("manager_name, manager_mobile, manager_email, manager_position, phone, fax, invoice_email, industrial_accident_number, commencement_number")
        .eq("code", code)
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .limit(5);

      if (!journalError && recentJournals && recentJournals.length > 0) {
        // 최근 데이터부터 순회하며 값이 있는 필드를 찾아서 채움
        const fieldsToFind = [
          "manager_name", "manager_mobile", "manager_email",
          "manager_position", "phone", "fax",
          "invoice_email", "industrial_accident_number", "commencement_number"
        ];

        for (const field of fieldsToFind) {
          for (const journal of recentJournals) {
            // journal을 safe하게 접근
            const val = (journal as any)[field];
            if (val && !journalManagerInfo[field]) {
              journalManagerInfo[field] = val;
              // 해당 필드를 찾았으므로 다음 필드로 넘어감 (모든 필드에 대해 가장 최신 값을 찾음)
              break;
            }
          }
        }
      }

      // 데이터 병합 (우선순위: Journal (최신 순회) > Business (요청년도) > Business (과거이력 우선순위) > Info)
      console.log(`[API /api/journal/businesses] prioritizedDefaults for ${code}:`, prioritizedDefaults);
      console.log(`[API /api/journal/businesses] journalManagerInfo for ${code}:`, journalManagerInfo);

      const business = {
        ...businessInfo,
        ...baseBusinessData, // 요청한 연도의 기본 데이터

        // 주소: 요청연도 > 과거이력 > Info
        address: baseBusinessData?.address || prioritizedDefaults.address || businessInfo?.address1 || businessInfo?.address2 || "",

        // 사업자번호 등 기본 정보: 요청연도 > 과거이력 > Info
        business_number: baseBusinessData?.business_number || prioritizedDefaults.business_number || businessInfo?.business_number || "",
        representative_name: baseBusinessData?.representative_name || prioritizedDefaults.representative_name || businessInfo?.representative_name || "",

        // 산재관리번호 (우선순위: BaseData(요청연도) > History(과거이력, 값이 있는 경우만) > Journal(최근일지))
        // 주의: BaseData에 값이 있더라도 빈 문자열이면 History를 찾아야 함
        industrial_accident_number: (baseBusinessData?.industrial_accident_number || "") || prioritizedDefaults.industrial_accident_number || journalManagerInfo?.industrial_accident_number || "",

        // 개시번호
        commencement_number: (baseBusinessData?.commencement_number || "") || prioritizedDefaults.commencement_number || journalManagerInfo?.commencement_number || "",

        // 담당자 정보: BaseData > History > Journal
        manager_name: (baseBusinessData?.manager_name || "") || prioritizedDefaults.manager_name || journalManagerInfo?.manager_name || "",
        manager_position: (baseBusinessData?.manager_position || "") || prioritizedDefaults.manager_position || journalManagerInfo?.manager_position || "",
        manager_mobile: (baseBusinessData?.manager_mobile || "") || prioritizedDefaults.manager_mobile || journalManagerInfo?.manager_mobile || "",

        // 이메일: BaseData > History > Journal
        // 주의: BaseData에 값이 있더라도 빈 문자열이면 History를 찾아야 함
        manager_email: (baseBusinessData?.manager_email || "") || prioritizedDefaults.manager_email || journalManagerInfo?.manager_email || "",
        invoice_email: (baseBusinessData?.invoice_email || "") || prioritizedDefaults.invoice_email || journalManagerInfo?.invoice_email || "", // 계산서 메일

        // 연락처: BaseData > History > Journal > Info
        phone: (baseBusinessData?.phone || "") || prioritizedDefaults.phone || journalManagerInfo?.phone || businessInfo?.phone || "",
        fax: (baseBusinessData?.fax || "") || prioritizedDefaults.fax || journalManagerInfo?.fax || businessInfo?.fax || "",
      };

      // 4. measurement_target_business 조회 (비고 데이터 활용)
      if (year && period) {
        const { data: targetData, error: targetError } = await supabase
          .from("measurement_target_business")
          .select("notes")
          .eq("code", code)
          .eq("year", parseInt(year))
          .eq("period", period)
          .maybeSingle();

        if (!targetError && targetData?.notes) {
          (business as any).special_notes = targetData.notes;
        }
      }

      console.log(`[API /api/journal/businesses] Final Business Object for ${code}:`, {
        industrial_accident_number: business.industrial_accident_number,
        invoice_email: business.invoice_email,
        manager_name: business.manager_name,
        prioritizedDefaults_sanjae: prioritizedDefaults.industrial_accident_number,
        base_sanjae: baseBusinessData?.industrial_accident_number
      });

      return NextResponse.json({
        business,
        _debug: {
          journalManagerInfo,
          recentJournalsCount: recentJournals ? recentJournals.length : 0,
          baseBusinessData: baseBusinessData ? {
            year: baseBusinessData.year,
            period: baseBusinessData.period,
            industrial_accident_number: baseBusinessData.industrial_accident_number,
            invoice_email: baseBusinessData.invoice_email
          } : "null",
          prioritizedDefaults,
          historyCount: allBusinessHistory ? allBusinessHistory.length : 0,
          historySample: allBusinessHistory ? allBusinessHistory.slice(0, 3).map((h: any) => ({
            year: h.year,
            period: h.period,
            sanjae: h.industrial_accident_number,
            email: h.invoice_email
          })) : []
        }
      });
    }

    // 전체 목록 조회
    // business_info 테이블에서 데이터 조회 (사업장명 기준)
    const { data: businessInfoList, error: infoError } = await supabase
      .from("business_info")
      .select("code, business_name")
      .order("business_name", { ascending: true });

    if (infoError) {
      console.error("사업장정보 목록 조회 오류:", infoError);
    }

    // measurement_business 테이블에서도 조회
    // "*번외*" 포함 사업장 제외
    const { data: businessDataList, error: businessError } = await supabase
      .from("measurement_business")
      .select("code, business_name")
      .not("business_name", "ilike", "%번외%")
      .order("business_name", { ascending: true });

    if (businessError) {
      console.error("측정사업장 목록 조회 오류:", businessError);
      return NextResponse.json(
        { error: "측정사업장 목록을 불러오는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 중복 제거하여 병합
    const businessMap = new Map<string, { code: string; business_name: string }>();

    (businessInfoList || []).forEach((b: any) => {
      if (!businessMap.has(b.code)) {
        businessMap.set(b.code, { code: b.code, business_name: b.business_name });
      }
    });

    (businessDataList || []).forEach((b: any) => {
      if (!businessMap.has(b.code)) {
        businessMap.set(b.code, { code: b.code, business_name: b.business_name });
      }
    });

    const businesses = Array.from(businessMap.values());

    return NextResponse.json({ businesses });
  } catch (error) {
    console.error("측정사업장 목록 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "측정사업장 목록을 불러오는 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

