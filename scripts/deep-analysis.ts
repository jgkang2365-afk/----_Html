import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function analyzeRootCause() {
    console.log("=== 근본 원인 분석 시작 ===");

    // 1. measurement_business (업로드 원본) 분석
    const { data: rawData, error: rawError } = await supabase
        .from("measurement_business")
        .select("code, business_name, year, period, future_measurement_date, business_category")
        .eq("year", 2026);

    if (rawError) {
        console.error("원본 데이터 조회 실패:", rawError);
        return;
    }

    console.log(`\n1. measurement_business (2026년) 데이터 분석`);
    console.log(`- 총 건수: ${rawData.length}`);

    // 중복 코드 확인
    const codeMap = new Map();
    rawData.forEach(row => {
        const count = codeMap.get(row.code) || 0;
        codeMap.set(row.code, count + 1);
    });

    const duplicates = Array.from(codeMap.entries()).filter(([code, count]) => count > 1);
    console.log(`- 중복된 코드 수: ${duplicates.length}`);
    if (duplicates.length > 0) {
        console.log(`- 중복 예시:`, duplicates.slice(0, 3));
    }

    // 주요 필드 누락 여부
    const missingDate = rawData.filter(r => !r.future_measurement_date).length;
    const missingCategory = rawData.filter(r => !r.business_category).length;
    console.log(`- 금회예정일 누락 건수: ${missingDate}`);
    console.log(`- 업종분류 누락 건수: ${missingCategory}`);


    // 2. measurement_target_business (화면 표시용) 분석
    const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("code, business_name, year, period, future_measurement_date, business_category")
        .eq("year", 2026); // 조회 조건을 API와 동일하게 맞춤

    if (targetError) {
        console.error("대상 데이터 조회 실패:", targetError);
        return;
    }

    console.log(`\n2. measurement_target_business (2026년) 데이터 분석`);
    console.log(`- 총 건수: ${targetData.length}`);

    // 매핑 상태 확인
    const rawCodes = new Set(rawData.map(r => r.code));
    const targetCodes = new Set(targetData.map(r => r.code));

    const missingInTarget = rawData.filter(r => !targetCodes.has(r.code));
    console.log(`- 원본에는 있으나 타겟(화면용)에 없는 건수: ${missingInTarget.length}`);
    if (missingInTarget.length > 0) {
        console.log(`- 누락 예시: ${missingInTarget[0].business_name} (${missingInTarget[0].code})`);
    }

    // 3. API 응답 시뮬레이션 (매핑 로직 검증)
    console.log(`\n3. 매핑 로직 시뮬레이션`);
    let mappingFailures = 0;

    targetData.forEach(target => {
        const match = rawData.find(raw => raw.code === target.code);
        if (!match) {
            mappingFailures++;
        } else {
            // 매칭은 됐는데 데이터가 다른지 확인
            if (target.business_category !== match.business_category) {
                // console.log(`- 데이터 불일치 (${target.code}): 원본[${match.business_category}] vs 타겟[${target.business_category}]`);
            }
        }
    });
    // console.log(`- 코드 매칭 실패 건수: ${mappingFailures}`);

    // 타겟 테이블 자체의 데이터 상태
    const targetMissingDate = targetData.filter(r => !r.future_measurement_date).length;
    const targetMissingCategory = targetData.filter(r => !r.business_category).length;
    console.log(`- 타겟 테이블 내 금회예정일 누락: ${targetMissingDate}`);
    console.log(`- 타겟 테이블 내 업종분류 누락: ${targetMissingCategory}`);

    console.log("=== 분석 종료 ===");
}

analyzeRootCause();
