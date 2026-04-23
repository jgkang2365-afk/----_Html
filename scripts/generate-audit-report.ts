
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";
import * as fs from "fs";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function generateReport() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select(`
      id, code, business_name, measurement_period,
      measurement_fee_total, measurement_fee_business, measurement_fee_national,
      deposit_amount_business, deposit_amount_business_2, deposit_amount_national, deposit_total
    `)
    .eq("measurement_year", 2026)
    .order("code", { ascending: true });

  if (error) {
    console.error("Error fetching data:", error);
    return;
  }

  const discrepantItems = journals.filter(j => {
    const biz1 = Number(j.deposit_amount_business || 0);
    const biz2 = Number(j.deposit_amount_business_2 || 0);
    const nat = Number(j.deposit_amount_national || 0);
    const total = Number(j.deposit_total || 0);
    return Math.abs((biz1 + biz2 + nat) - total) >= 1;
  });

  let markdown = "# 2026년도 매출 데이터 전수조사 결과 보고서\n\n";
  markdown += `* **총 조사 대상**: ${journals.length}건\n`;
  markdown += `* **불일치 발견**: ${discrepantItems.length}건\n`;
  markdown += `* **불일치 총액**: ${discrepantItems.reduce((sum, j) => sum + (Number(j.deposit_amount_business || 0) + Number(j.deposit_amount_business_2 || 0) + Number(j.deposit_amount_national || 0) - Number(j.deposit_total || 0)), 0).toLocaleString()}원\n\n`;

  markdown += "## 상세 불일치 리스트 (49건)\n\n";
  markdown += "| 코드 | 업체명 | 주기 | 측정비(합계) | 사업장입금 | 국고입금 | DB합계(오류) | 실제합계(정상) | 차액 |\n";
  markdown += "| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |\n";

  discrepantItems.forEach(r => {
    const bizTotal = Number(r.deposit_amount_business || 0) + Number(r.deposit_amount_business_2 || 0);
    const nat = Number(r.deposit_amount_national || 0);
    const dbTotal = Number(r.deposit_total || 0);
    const expected = bizTotal + nat;
    const diff = expected - dbTotal;

    markdown += `| ${r.code} | ${r.business_name} | ${r.measurement_period} | ${Number(r.measurement_fee_total || 0).toLocaleString()} | ${bizTotal.toLocaleString()} | ${nat.toLocaleString()} | ${dbTotal.toLocaleString()} | ${expected.toLocaleString()} | **${diff.toLocaleString()}** |\n`;
  });

  markdown += "\n\n---\n*본 보고서는 시스템 데이터를 직접 분석하여 작성되었습니다.*";

  // 파일로 저장
  const reportPath = resolve(process.cwd(), "full_audit_report_2026_fixed.md");
  fs.writeFileSync(reportPath, markdown, "utf8");
  console.log(`Report generated at: ${reportPath}`);
}

generateReport().catch(console.error);
