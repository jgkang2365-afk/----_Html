import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 예비조사 API
 * GET: 예비조사 목록 조회
 * POST: 예비조사 등록
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("survey:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim() || null;
    const businessNumber = searchParams.get("businessNumber")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const officeJurisdiction = searchParams.get("officeJurisdiction")?.trim() || null;
    const address = searchParams.get("address")?.trim() || null;
    const maxSequence = searchParams.get("maxSequence") === "true";

    const supabase = await createClient();

    // 순번 최대값 조회 요청인 경우
    if (maxSequence) {
      const { data: maxSequenceData, error: maxSequenceError } = await supabase
        .from("preliminary_survey")
        .select("sequence_number")
        .not("sequence_number", "is", null)
        .order("sequence_number", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (maxSequenceError) {
        return NextResponse.json(
          { error: "순번 조회 중 오류가 발생했습니다.", details: maxSequenceError.message },
          { status: 500 }
        );
      }

      return NextResponse.json({ maxSequence: maxSequenceData?.sequence_number || 0 });
    }

    // 1. 사업장정보 테이블에서 검색 조건에 맞는 전체 데이터 조회
    let businessInfoQuery = supabase
      .from("business_info")
      .select("code, business_name, business_number, address1, address2, office_jurisdiction")
      .not("business_name", "ilike", "%번외%"); // "*번외*" 포함 사업장 제외

    if (code) {
      businessInfoQuery = businessInfoQuery.ilike("code", `%${code}%`);
    }

    if (businessNumber) {
      businessInfoQuery = businessInfoQuery.ilike("business_number", `%${businessNumber}%`);
    }

    if (businessName) {
      // 콤마로 구분된 여러 사업장명 지원 (OR 조건)
      const terms = businessName.split(",").map(t => t.trim()).filter(Boolean);
      if (terms.length > 0) {
        // business_name.ilike.%term1%,business_name.ilike.%term2%...
        const orQuery = terms.map(term => `business_name.ilike.%${term}%`).join(",");
        businessInfoQuery = businessInfoQuery.or(orQuery);
      }
    }

    if (address) {
      // 콤마로 구분된 여러 주소 지원 (OR 조건)
      const terms = address.split(",").map(t => t.trim()).filter(Boolean);
      if (terms.length > 0) {
        // (address1 like term1 OR address2 like term1) OR (address1 like term2 OR address2 like term2)
        // supabase .or() syntax: column.operator.value,column.operator.value
        // address1.ilike.%term1%,address2.ilike.%term1%,address1.ilike.%term2%,address2.ilike.%term2%
        const orConditions = terms.flatMap(term => [
          `address1.ilike.%${term}%`,
          `address2.ilike.%${term}%`
        ]);
        businessInfoQuery = businessInfoQuery.or(orConditions.join(","));
      }
    }

    // 소재지 관할청 필터링 (business_info 테이블의 office_jurisdiction 필드 사용)
    if (officeJurisdiction) {
      // 부분 일치 검색 (대소문자 구분 없음)
      const searchTerm = officeJurisdiction.trim();

      // Supabase의 ilike는 부분 일치를 지원하므로 직접 사용
      // "대전지방고용노동청 보령지청" 전체 문자열로 검색
      businessInfoQuery = businessInfoQuery.ilike("office_jurisdiction", `%${searchTerm}%`);

      // 디버깅: 검색 조건 로그
      console.log("소재지 관할청 검색 조건:", searchTerm);
    }

    const { data: businessInfoList, error: businessInfoError } = await businessInfoQuery;

    // 디버깅: 검색 결과 로그
    if (officeJurisdiction) {
      console.log(`소재지 관할청 "${officeJurisdiction}" 검색 결과:`, {
        "매칭된 건수": businessInfoList?.length || 0,
        "샘플 코드": businessInfoList?.slice(0, 5).map((b: any) => ({
          code: b.code,
          office_jurisdiction: b.office_jurisdiction,
        })),
      });

      // 실제 데이터베이스에 어떤 관할청 값들이 있는지 샘플 확인
      if (!businessInfoList || businessInfoList.length === 0) {
        console.warn("검색 결과가 없습니다. 데이터베이스의 관할청 샘플 확인 중...");
        const { data: sampleData } = await supabase
          .from("business_info")
          .select("code, office_jurisdiction")
          .not("office_jurisdiction", "is", null)
          .limit(50);
        const uniqueOffices = [...new Set(sampleData?.map((b: any) => b.office_jurisdiction).filter(Boolean) || [])];
        console.log("데이터베이스의 관할청 샘플 (중복 제거, 상위 20개):", uniqueOffices.slice(0, 20));

        // 검색어와 유사한 값 찾기
        const similarOffices = uniqueOffices.filter((office: string) =>
          office.includes(officeJurisdiction) || officeJurisdiction.includes(office)
        );
        if (similarOffices.length > 0) {
          console.log("검색어와 유사한 관할청:", similarOffices);
        }
      }
    }

    if (businessInfoError) {
      console.error("사업장정보 검색 오류:", businessInfoError);
      // office_jurisdiction 컬럼이 없는 경우 (마이그레이션 미실행) fallback 처리
      if (businessInfoError.message?.includes("office_jurisdiction") || businessInfoError.code === "PGRST204") {
        console.warn("office_jurisdiction 컬럼이 없습니다. measurement_business에서 검색합니다.");

        // 기본 쿼리 재실행 (office_jurisdiction 제외)
        let fallbackQuery = supabase
          .from("business_info")
          .select("code")
          .not("business_name", "ilike", "%번외%"); // "*번외*" 포함 사업장 제외

        if (code) {
          fallbackQuery = fallbackQuery.ilike("code", `%${code}%`);
        }
        if (businessNumber) {
          fallbackQuery = fallbackQuery.ilike("business_number", `%${businessNumber}%`);
        }
        if (businessName) {
          fallbackQuery = fallbackQuery.ilike("business_name", `%${businessName}%`);
        }
        if (address) {
          fallbackQuery = fallbackQuery.or(`address1.ilike.%${address}%,address2.ilike.%${address}%`);
        }

        const { data: fallbackList, error: fallbackError } = await fallbackQuery;
        if (fallbackError) {
          return NextResponse.json(
            { error: "사업장정보 검색 중 오류가 발생했습니다.", details: fallbackError.message },
            { status: 500 }
          );
        }

        // measurement_business에서 관할청 필터링
        const codes = fallbackList?.map((b: any) => b.code) || [];
        let filteredCodes = codes;

        if (officeJurisdiction && codes.length > 0) {
          const { data: measurementBusinessList, error: mbError } = await supabase
            .from("measurement_business")
            .select("code, office_jurisdiction")
            .in("code", codes)
            .order("year", { ascending: false })
            .order("period", { ascending: false });

          if (!mbError && measurementBusinessList) {
            const codesByOffice = measurementBusinessList
              .filter((mb: any) => mb.office_jurisdiction && mb.office_jurisdiction === officeJurisdiction)
              .map((mb: any) => mb.code);
            filteredCodes = [...new Set(codesByOffice)];
          }
        }

        // 예비조사 테이블에서 검색
        let surveyQuery = supabase
          .from("preliminary_survey")
          .select("*")
          .order("sequence_number", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: false });

        if (filteredCodes.length > 0) {
          surveyQuery = surveyQuery.in("code", filteredCodes);
        } else if (code || businessNumber || businessName || address || officeJurisdiction) {
          return NextResponse.json({ surveys: [] });
        }

        const { data: surveys, error } = await surveyQuery;
        if (error) {
          console.error("예비조사 조회 오류:", error);
          return NextResponse.json(
            { error: "예비조사 조회 중 오류가 발생했습니다.", details: error.message },
            { status: 500 }
          );
        }

        return NextResponse.json({ surveys: surveys || [] });
      }

      return NextResponse.json(
        { error: "사업장정보 검색 중 오류가 발생했습니다.", details: businessInfoError.message },
        { status: 500 }
      );
    }

    // 검색 조건에 맞는 코드 목록
    const codes = businessInfoList?.map((b: any) => b.code) || [];

    // 검색 조건이 있지만 매칭되는 코드가 없는 경우 빈 배열 반환
    if (codes.length === 0 && (code || businessNumber || businessName || address || officeJurisdiction)) {
      return NextResponse.json({
        businesses: [],
        surveys: []
      });
    }

    // 2. 예비조사 테이블에서 해당 코드들로 검색
    let surveys: any[] = [];

    // 검색 조건이 없으면 전체 예비조사 목록 반환
    if (codes.length === 0 && !code && !businessNumber && !businessName && !address && !officeJurisdiction) {
      const { data: allSurveys, error: allSurveysError } = await supabase
        .from("preliminary_survey")
        .select("*")
        .order("sequence_number", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      if (allSurveysError) {
        console.error("예비조사 전체 목록 조회 오류:", allSurveysError);
      } else {
        surveys = allSurveys || [];
      }
    } else if (codes.length > 0) {
      // 검색 조건이 있으면 해당 코드들로 검색
      const surveyQuery = supabase
        .from("preliminary_survey")
        .select("*")
        .in("code", codes)
        .order("sequence_number", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });

      const { data: surveyData, error: surveyError } = await surveyQuery;

      if (surveyError) {
        console.error("예비조사 조회 오류:", surveyError);
      } else {
        surveys = surveyData || [];
      }
    }

    // 사업자번호 연동: 조회된 예비조사 목록의 코드를 이용해 business_info에서 사업자번호 조회
    if (surveys.length > 0) {
      const surveyCodes = [...new Set(surveys.map((s) => s.code).filter(Boolean))];

      if (surveyCodes.length > 0) {
        const { data: businessInfos, error: businessInfoError } = await supabase
          .from("business_info")
          .select("code, business_number")
          .in("code", surveyCodes);

        if (!businessInfoError && businessInfos) {
          // 코드별 사업자번호 맵 생성
          const businessNumberMap = new Map();
          businessInfos.forEach((info) => {
            if (info.code) {
              businessNumberMap.set(info.code, info.business_number);
            }
          });

          // 예비조사 목록에 사업자번호 추가
          surveys = surveys.map((survey) => ({
            ...survey,
            business_number: survey.code ? businessNumberMap.get(survey.code) || null : null
          }));
        }
      }
    }

    // 3. 각 사업장명별 미수금 횟수 계산 (측정비(사업장) - 입금액(사업장) > 0 인 건수)
    const businessNames = businessInfoList?.map((b: any) => b.business_name).filter((name: string) => name && name.trim()) || [];
    const unpaidCountMap = new Map<string, number>();

    if (businessNames.length > 0) {
      const { data: revenueData, error: revenueError } = await supabase
        .from("measurement_journal")
        .select("business_name, measurement_fee_business, deposit_amount_business")
        .not("business_name", "ilike", "%번외%")
        .in("business_name", businessNames);

      if (revenueError) {
        console.error("[ERROR] 미수횟수 조회 오류:", revenueError);
      }

      if (revenueData) {
        revenueData.forEach((item) => {
          const businessFee = Number(item.measurement_fee_business) || 0;
          const businessDeposit = Number(item.deposit_amount_business) || 0;
          const businessUnpaid = businessFee - businessDeposit;

          if (businessUnpaid > 0) {
            const count = unpaidCountMap.get(item.business_name) || 0;
            unpaidCountMap.set(item.business_name, count + 1);
          }
        });
      }
    }

    // 4. 사업장정보 데이터를 반환 형식으로 변환
    const businesses = businessInfoList?.map((business: any) => ({
      code: business.code,
      business_name: business.business_name,
      business_number: business.business_number || "",
      address: [business.address1, business.address2].filter(Boolean).join(" ").trim() || "",
      office_jurisdiction: business.office_jurisdiction || "",
      unpaid_count: unpaidCountMap.get(business.business_name) || 0,
    })) || [];

    return NextResponse.json({
      businesses: businesses,
      surveys: surveys
    });
  } catch (error) {
    console.error("예비조사 API 오류:", error);

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
        error: "예비조사 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("survey:write");

    const body = await request.json();
    console.log("[API] Survey POST body:", body);
    const {
      year,
      period,
      measurement_date,
      end_date,
      measurement_weekdays,
      code,
      business_name,
      measurer,
      survey_code,
      address,
      preliminary_surveyor,
      actual_measurer,
      report_writer,
    } = body;

    // 필수 필드 검증
    if (!measurement_date || !business_name) {
      return NextResponse.json(
        { error: "측정일과 사업장명은 필수 항목입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 전회 측정일로부터 3개월 이내인지 확인 (경고용)
    let warningMessage: string | null = null;
    if (code) {
      // measurement_journal에서 해당 코드의 가장 최근 측정일 조회
      const { data: latestJournal, error: journalError } = await supabase
        .from("measurement_journal")
        .select("measurement_start_date, measurement_end_date")
        .eq("code", code)
        .not("measurement_start_date", "is", null)
        .order("measurement_start_date", { ascending: false })
        .order("measurement_end_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!journalError && latestJournal) {
        // measurement_end_date 또는 measurement_start_date 중 더 최신 날짜 사용
        const endDate = latestJournal.measurement_end_date
          ? new Date(latestJournal.measurement_end_date).getTime()
          : 0;
        const startDate = latestJournal.measurement_start_date
          ? new Date(latestJournal.measurement_start_date).getTime()
          : 0;
        const lastMeasurementDate = endDate > startDate
          ? latestJournal.measurement_end_date
          : latestJournal.measurement_start_date;

        if (lastMeasurementDate) {
          const lastDate = new Date(lastMeasurementDate);
          const newDate = new Date(measurement_date);
          const monthsDiff = (newDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24 * 30); // 개월 차이

          if (monthsDiff < 3) {
            const daysDiff = Math.floor((newDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            warningMessage = `전회 측정일(${lastDate.toISOString().split('T')[0]})로부터 ${daysDiff}일(${monthsDiff.toFixed(1)}개월)이 지났습니다. 법령에 따라 측정일로부터 3개월이 지난 이후에 측정이 가능합니다. 그래도 등록하시겠습니까?`;
          }
        }
      }
    }

    // 1. 해당 일자 등록 업체 수 제한 (6개 미만이어야 함 -> 6개 이상이면 등록 불가)
    const { count: dateCount, error: dateCountError } = await supabase
      .from("preliminary_survey")
      .select("id", { count: "exact", head: true })
      .eq("measurement_date", measurement_date);

    if (dateCountError) {
      console.error("일자별 등록 건수 조회 오류:", dateCountError);
    } else if ((dateCount || 0) > 6) {
      return NextResponse.json(
        { error: `해당 일자(${measurement_date})에는 이미 6개를 초과하는 업체가 등록되어 있어 추가할 수 없습니다.` },
        { status: 400 }
      );
    }

    // 2. 동일 일자 측정자 중복 체크
    if (measurer) {
      const { data: sameDateSurveys, error: measurerCheckError } = await supabase
        .from("preliminary_survey")
        .select("measurer")
        .eq("measurement_date", measurement_date)
        .not("measurer", "is", null);

      if (measurerCheckError) {
        console.error("측정자 중복 체크 오류:", measurerCheckError);
      } else if (sameDateSurveys && sameDateSurveys.length > 0) {
        const newMeasurers = measurer.split(",").map((m: string) => m.trim());

        for (const survey of sameDateSurveys) {
          if (!survey.measurer) continue;
          const existingMeasurers = survey.measurer.split(",").map((m: string) => m.trim());

          // 교집합 확인
          const duplicates = newMeasurers.filter((nm: string) => existingMeasurers.includes(nm));
          if (duplicates.length > 0) {
            return NextResponse.json(
              { error: `측정자 [${duplicates.join(", ")}]님은 해당 일자(${measurement_date})에 이미 다른 일정(업체)이 배정되어 있습니다.` },
              { status: 400 }
            );
          }
        }
      }
    }

    // 순번 자동 계산 (현재 등록된 예비조사 중 가장 큰 순번 + 1)
    const { data: maxSequenceData, error: maxSequenceError } = await supabase
      .from("preliminary_survey")
      .select("sequence_number")
      .not("sequence_number", "is", null)
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    let sequenceNumber = 1;
    if (!maxSequenceError && maxSequenceData?.sequence_number) {
      sequenceNumber = maxSequenceData.sequence_number + 1;
    }

    // 예비조사 등록
    const { data: survey, error } = await supabase
      .from("preliminary_survey")
      .insert({
        year: year ? parseInt(year) : 2026,
        period: period || "상반기",
        measurement_date,
        end_date: end_date || measurement_date,
        measurement_weekdays: measurement_weekdays || null,
        code: code || null,
        business_name,
        measurer: measurer || null,
        survey_code: survey_code || null,
        address: address || null,
        preliminary_surveyor: preliminary_surveyor || null,
        actual_measurer: actual_measurer || null,
        report_writer: report_writer || null,
        sequence_number: sequenceNumber,
      })
      .select()
      .single();

    if (error) {
      console.error("예비조사 등록 오류:", error);
      return NextResponse.json(
        { error: "예비조사 등록 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    // 예비조사 등록 후 measurement_target_business 테이블의 measurement_date 업데이트
    if (code) {
      // 해당 코드의 모든 년도/반기 조합에 대해 측정일 업데이트
      // 가장 최근 예비조사의 측정일을 사용
      const { data: latestSurvey, error: latestSurveyError } = await supabase
        .from("preliminary_survey")
        .select("measurement_date")
        .eq("code", code)
        .not("measurement_date", "is", null)
        .order("measurement_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestSurveyError && latestSurvey?.measurement_date) {
        // measurement_target_business 테이블에서 해당 코드의 모든 레코드 업데이트
        const { error: updateError } = await supabase
          .from("measurement_target_business")
          .update({ measurement_date: latestSurvey.measurement_date })
          .eq("code", code);

        if (updateError) {
          console.error("measurement_target_business 측정일 업데이트 오류:", updateError);
          // 오류가 발생해도 예비조사 등록은 성공한 것으로 처리 (경고만 표시)
        }
      }
    }

    return NextResponse.json({
      survey,
      warning: warningMessage // 경고 메시지 포함 (있을 경우)
    }, { status: 201 });
  } catch (error) {
    console.error("예비조사 등록 API 오류:", error);

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
        error: "예비조사 등록 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
