import fs from "fs";

async function run() {
  const res = await fetch("http://localhost:3000/api/sales");
  const data = await res.json();
  
  if (!data || !data.data || !data.data.allMeasurementData) return;
  
  const DESIGNATED_OFFICE_FULL_NAME_TO_SHORT: Record<string, string> = {
    "대전지방고용노동청 천안지청": "천안",
    "대전지방고용노동청": "대전",
    "중부지방고용노동청 평택지청": "평택",
    "중부지방고용노동청 경기지청": "경기",
    "중부지방고용노동청 영월지청": "영월",
  };

  function toShortName(fullName: string): string {
    if (!fullName) return "";
    const trimmedName = fullName.trim();
    if (DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName]) return DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[trimmedName];
    const jicheongMatch = fullName.match(/(?:.*\s+)?(.+)지청$/);
    if (jicheongMatch && jicheongMatch[1]) return jicheongMatch[1];
    const cheongMatch = fullName.match(/^(.+)지방고용노동청$/);
    if (cheongMatch && cheongMatch[1]) return cheongMatch[1];
    return fullName;
  }
  
  const allData = data.data.allMeasurementData;
  console.log(`총 데이터 수: ${allData.length}`);
  
  let table1Sum = 0;
  let table2Sum = 0;
  
  const diffs = [];
  
  for (const item of allData) {
    if (item.measurement_year !== 2026) continue;
    
    // API Route already maps toShortName into item.designated_office
    if (item.designated_office === "천안") {
      const fee = item.measurement_fee_total || 0;
      table1Sum += fee;
      
      const bFee = item.measurement_fee_business || 0;
      const bDep = (item.deposit_amount_business || 0) + (item.deposit_amount_business_2 || 0);
      const nFee = item.measurement_fee_national || 0;
      const nDep = item.deposit_amount_national || 0;
      
      if (bFee + nFee > 0 || bDep + nDep > 0) {
        table2Sum += (bFee + nFee);
      }
      
      if (fee !== (bFee + nFee)) {
         diffs.push({ name: item.business_name, feeTotal: fee, bnSum: (bFee+nFee), diff: fee - (bFee+nFee) });
      }
    }
  }
  
  console.log(`Table1 sum: ${table1Sum}`);
  console.log(`Table2 sum: ${table2Sum}`);
  console.log(`Diff log:`, diffs);
}
run();
