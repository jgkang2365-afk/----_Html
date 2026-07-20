import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";
import { spawn } from "child_process";
import * as fs from "fs";

// env.local 환경 변수 파일 로드
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// 안전보건공단 건강디딤돌 결과 매핑 정의
// SUPPORT -> "대상", NON_SUPPORT -> "비대상", NO_RESULT -> "조회 결과 없음", STANDBY -> "대기"
interface ReconcileResult {
  code: string;
  businessName: string;
  representativeName: string;
  sanjae: string;
  commencement: string;
  dbStatus: string | null;      // 현재 DB 국고지원 상태
  crawlerResult: string;        // 공단 크롤링 결과 코드
  crawlerResultKo: string;      // 공단 크롤링 결과 한글명
  isMatch: boolean;             // 일치 여부
  detail: string;               // 세부 내용
}

// 개별 사업장에 대한 공단 크롤링 실행 함수
function runCrawler(
  sanjae: string, 
  commencement: string, 
  representative: string,
  year: string,
  period: string
): Promise<{ status: string; result?: string; message?: string }> {
  return new Promise((resolve) => {
    const pythonScript = path.join(process.cwd(), "scratch/apply_national_support_cli.py");
    
    // 대표자명 정제
    let repName = (representative || "").trim();
    if (repName.includes(",")) {
      repName = repName.split(",")[0].trim();
    }
    repName = repName.replace(/외\s*\d*\s*(인|명|)/g, "").trim();

    const crawler = spawn("python", [
      pythonScript,
      "--sanjae", (sanjae || "").replace(/-/g, "").trim(),
      "--commencement", (commencement || "").replace(/-/g, "").trim(),
      "--representative", repName,
      "--year", year,
      "--period", period
    ]);

    let stdoutData = "";
    let stderrData = "";

    crawler.stdout.on("data", (data) => {
      stdoutData += data.toString();
    });

    crawler.stderr.on("data", (data) => {
      stderrData += data.toString();
    });

    crawler.on("close", (exitCode) => {
      if (exitCode === 0) {
        const lines = stdoutData.split("\n").map(l => l.trim()).filter(Boolean);
        let resultJson: any = null;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (lines[i].startsWith("{") && lines[i].endsWith("}")) {
            try {
              resultJson = JSON.parse(lines[i]);
              break;
            } catch (e) {
              // 파싱 오류 무시
            }
          }
        }
        if (resultJson) {
          resolve(resultJson);
        } else {
          resolve({ status: "ERROR", message: "크롤러 JSON 응답 파싱 실패: " + stdoutData });
        }
      } else {
        resolve({ status: "ERROR", message: stderrData || `크롤러 프로세스 종료 코드: ${exitCode}` });
      }
    });
  });
}

// 메인 실행 함수
async function main() {
  const isTestMode = process.argv.includes("--test");
  const limitCount = isTestMode ? 3 : 9999;
  
  console.log(`[대사 검증 스크립트] 기동 완료. 테스트 모드: ${isTestMode ? "활성화" : "비활성화"}`);
  console.log(`[안내] 이 스크립트는 DB 데이터를 수정하지 않으며, 오직 조회 검증용입니다.`);

  // 1. DB에서 2026년 상반기 측정 대상 사업장 목록 추출
  const year = 2026;
  const periodPattern = "%상반기%";
  
  const { data: targets, error } = await supabase
    .from("measurement_target_business")
    .select("code, business_name, representative_name, industrial_accident_number, commencement_number, national_support_status")
    .eq("year", year)
    .ilike("period", periodPattern)
    .order("code", { ascending: true });

  if (error) {
    console.error("DB 조회 오류:", error);
    process.exit(1);
  }

  if (!targets || targets.length === 0) {
    console.log("조회할 대상 사업장이 존재하지 않습니다.");
    return;
  }

  console.log(`\nDB에서 총 ${targets.length}개의 2026년 상반기 대상 사업장을 조회했습니다.`);
  
  // 테스트 모드인 경우 3개만 샘플링
  const runList = targets.slice(0, limitCount);
  console.log(`실행 대상 사업장 수: ${runList.length}개\n`);

  const results: ReconcileResult[] = [];
  
  // 동시성 풀 제어 (Concurrency = 4)
  const CONCURRENCY = 4;
  let activeCount = 0;
  let currentIndex = 0;
  const total = runList.length;

  const startReconcile = (): Promise<void> => {
    return new Promise((resolve) => {
      const next = async () => {
        if (currentIndex >= total) {
          if (activeCount === 0) {
            resolve();
          }
          return;
        }

        const index = currentIndex++;
        const target = runList[index];
        activeCount++;

        console.log(`[진행] [${index + 1}/${total}] 코드: ${target.code} - ${target.business_name} 조회 시작...`);
        
        try {
          const crawlerRes = await runCrawler(
            target.industrial_accident_number || "",
            target.commencement_number || "",
            target.representative_name || "",
            "2026",
            "상반기"
          );

          let crawlerResult = "UNKNOWN";
          let crawlerResultKo = "실패/미확인";
          
          if (crawlerRes.status === "SUCCESS") {
            crawlerResult = crawlerRes.result || "STANDBY";
            if (crawlerResult === "SUPPORT") {
              crawlerResultKo = "대상";
            } else if (crawlerResult === "NON_SUPPORT") {
              crawlerResultKo = "비대상";
            } else if (crawlerResult === "NO_RESULT") {
              crawlerResultKo = "조회결과없음";
            } else if (crawlerResult === "STANDBY") {
              crawlerResultKo = "대기";
            }
          } else {
            console.error(`  [오류] ${target.business_name} 조회 실패:`, crawlerRes.message);
          }

          // 일치 여부 비교
          const dbStatus = target.national_support_status;
          let isMatch = false;
          let detail = "";

          if (dbStatus === "대상" && crawlerResult === "SUPPORT") {
            isMatch = true;
            detail = "대상 상태 일치";
          } else if (dbStatus === "비대상" && crawlerResult === "NON_SUPPORT") {
            isMatch = true;
            detail = "비대상 상태 일치";
          } else if (dbStatus === "비대상" && crawlerResult === "NO_RESULT") {
            // 공단에 내역이 없다는 것은 비대상과 유사하게 매칭될 수 있으나 엄격하게는 "내역 없음"
            isMatch = true;
            detail = "DB 비대상 / 공단 내역 없음 (유사 일치)";
          } else if (!dbStatus && crawlerResult === "NO_RESULT") {
            isMatch = true;
            detail = "DB 미설정 / 공단 내역 없음 (일치)";
          } else {
            isMatch = false;
            detail = `불일치 (DB: ${dbStatus || "미설정"} vs 공단: ${crawlerResultKo})`;
          }

          results.push({
            code: target.code,
            businessName: target.business_name || "",
            representativeName: target.representative_name || "",
            sanjae: target.industrial_accident_number || "",
            commencement: target.commencement_number || "",
            dbStatus,
            crawlerResult,
            crawlerResultKo,
            isMatch,
            detail
          });

          console.log(`[완료] [${index + 1}/${total}] ${target.business_name} -> DB: ${dbStatus || "미설정"}, 공단: ${crawlerResultKo} [${isMatch ? "일치" : "★불일치"}]`);

        } catch (e: any) {
          console.error(`  [예외] ${target.business_name} 처리 중 예외 발생:`, e.message);
          results.push({
            code: target.code,
            businessName: target.business_name || "",
            representativeName: target.representative_name || "",
            sanjae: target.industrial_accident_number || "",
            commencement: target.commencement_number || "",
            dbStatus: target.national_support_status,
            crawlerResult: "ERROR",
            crawlerResultKo: "예외발생",
            isMatch: false,
            detail: `처리 중 예외 발생: ${e.message}`
          });
        } finally {
          activeCount--;
          next();
        }
      };

      // 초기 동시 실행 스레드 기동
      for (let i = 0; i < Math.min(CONCURRENCY, total); i++) {
        next();
      }
    });
  };

  await startReconcile();

  // 2. 결과 레포트 작성
  console.log("\n=== 대사 검증 결과 분석 시작 ===");
  
  const discrepancies = results.filter(r => !r.isMatch);
  const matchCount = results.length - discrepancies.length;
  const matchRate = ((matchCount / results.length) * 100).toFixed(1);

  console.log(`전체 처리 건수: ${results.length}건`);
  console.log(`일치 건수: ${matchCount}건`);
  console.log(`불일치 건수: ${discrepancies.length}건 (일치율 ${matchRate}%)`);

  // Markdown 파일 작성
  const reportPath = path.join(process.cwd(), "scratch/reconciliation_report.md");
  let mdContent = `# 2026년 상반기 측정대상 사업장 국고지원여부 대사 검증 레포트\n\n`;
  mdContent += `- **검증 일시:** ${new Date().toLocaleString("ko-KR")}\n`;
  mdContent += `- **검증 범위:** 2026년 상반기 측정대상 사업장\n`;
  mdContent += `- **총 조사 건수:** ${results.length}건 / 전체 ${targets.length}건 중\n`;
  mdContent += `- **일치 건수:** ${matchCount}건 (일치율: ${matchRate}%)\n`;
  mdContent += `- **불일치 건수:** ${discrepancies.length}건 (공단과 상이)\n\n`;
  
  mdContent += `> [!NOTE]\n`;
  mdContent += `> 본 레포트는 공단(안전보건공단 건강디딤돌 조회) 실시간 결과와 로컬 DB 데이터를 휘발성으로 비교 분석한 자료이며, **로컬 DB에 대한 자동 업데이트는 일절 수행하지 않았습니다.**\n\n`;

  mdContent += `## 1. 세부 불일치 내역 목록 (총 ${discrepancies.length}건)\n\n`;
  
  if (discrepancies.length > 0) {
    mdContent += `| 번호 | 사업장코드 | 사업장명 | 대표자명 | 산재번호 | 개시번호 | DB 상태 | 공단 상태 | 상세 분석 및 조치 사항 |\n`;
    mdContent += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
    
    discrepancies.forEach((item, idx) => {
      mdContent += `| ${idx + 1} | ${item.code} | ${item.businessName} | ${item.representativeName} | ${item.sanjae || "-"} | ${item.commencement || "-"} | ${item.dbStatus || "미설정"} | **${item.crawlerResultKo}** | ${item.detail} |\n`;
    });
  } else {
    mdContent += `* 모든 검증 항목이 로컬 DB와 공단 조회 결과가 일치합니다.\n`;
  }
  
  mdContent += `\n## 2. 전체 비교 내역 요약\n\n`;
  mdContent += `| 상태 비교 유형 | 건수 | 비율 |\n`;
  mdContent += `| :--- | :--- | :--- |\n`;
  
  // 상태 분류 요약 카운트
  const typeCounts = {
    matchSupport: results.filter(r => r.dbStatus === "대상" && r.crawlerResult === "SUPPORT").length,
    matchNonSupport: results.filter(r => r.dbStatus === "비대상" && r.crawlerResult === "NON_SUPPORT").length,
    matchNoResult: results.filter(r => (r.dbStatus === "비대상" || !r.dbStatus) && r.crawlerResult === "NO_RESULT").length,
    dbSupportKoshaNon: results.filter(r => r.dbStatus === "대상" && r.crawlerResult === "NON_SUPPORT").length,
    dbSupportKoshaNoResult: results.filter(r => r.dbStatus === "대상" && r.crawlerResult === "NO_RESULT").length,
    dbNonKoshaSupport: results.filter(r => r.dbStatus === "비대상" && r.crawlerResult === "SUPPORT").length,
    others: 0
  };
  
  typeCounts.others = results.length - (Object.values(typeCounts).reduce((a, b) => a + b, 0));

  const pct = (val: number) => ((val / results.length) * 100).toFixed(1) + "%";

  mdContent += `| DB 대상 & 공단 대상 (일치) | ${typeCounts.matchSupport}건 | ${pct(typeCounts.matchSupport)} |\n`;
  mdContent += `| DB 비대상 & 공단 비대상 (일치) | ${typeCounts.matchNonSupport}건 | ${pct(typeCounts.matchNonSupport)} |\n`;
  mdContent += `| DB 비대상/미설정 & 공단 내역없음 (유사 일치) | ${typeCounts.matchNoResult}건 | ${pct(typeCounts.matchNoResult)} |\n`;
  mdContent += `| **DB 대상인데 공단 비대상 (불일치)** | **${typeCounts.dbSupportKoshaNon}건** | **${pct(typeCounts.dbSupportKoshaNon)}** |\n`;
  mdContent += `| **DB 대상인데 공단 내역없음 (불일치)** | **${typeCounts.dbSupportKoshaNoResult}건** | **${pct(typeCounts.dbSupportKoshaNoResult)}** |\n`;
  mdContent += `| **DB 비대상인데 공단 대상 (불일치)** | **${typeCounts.dbNonKoshaSupport}건** | **${pct(typeCounts.dbNonKoshaSupport)}** |\n`;
  mdContent += `| 기타 미확인/실패 | ${typeCounts.others}건 | ${pct(typeCounts.others)} |\n`;

  fs.writeFileSync(reportPath, mdContent, "utf8");
  console.log(`\n대사 검증 레포트 생성이 완료되었습니다: ${reportPath}`);
}

main().catch((err) => {
  console.error("실행 도중 치명적 에러 발생:", err);
});
