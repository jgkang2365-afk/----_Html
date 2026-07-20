import * as fs from "fs";
import * as path from "path";

const filepath = path.resolve(__dirname, "targets.json");
const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));

console.log("=== targets.json 내의 모든 사업장명과 대표자명 ===");
data.forEach((row: any) => {
  console.log(`Code: ${row.code} | Name: ${row.business_name} | Rep: ${row.representative_name} | Sanjae: ${row.industrial_accident_number} | Gaesi: ${row.commencement_number}`);
});
