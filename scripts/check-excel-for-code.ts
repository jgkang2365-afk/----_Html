
import * as XLSX from "xlsx";
import path from "path";
import fs from "fs";

const TARGET_CODE = "H0437";

function getAllExcelFiles(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);

    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== '.next') {
                getAllExcelFiles(filePath, fileList);
            }
        } else {
            if (path.extname(file).toLowerCase() === '.xlsx' && !file.startsWith('~$')) {
                fileList.push(filePath);
            }
        }
    });

    return fileList;
}

function checkFile(filePath: string) {
    console.log(`\nChecking file: ${path.relative(process.cwd(), filePath)}`);
    try {
        const workbook = XLSX.readFile(filePath);

        workbook.SheetNames.forEach(sheetName => {
            const worksheet = workbook.Sheets[sheetName];
            // Use header: 1 to get array of arrays, which is safer for loose searching
            const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" }) as any[][];

            // Search in 2D array
            let matches = 0;
            data.forEach((row, rowIndex) => {
                row.forEach((cell, colIndex) => {
                    const cellStr = String(cell).trim();
                    if (cellStr.toUpperCase() === TARGET_CODE.toUpperCase()) {
                        matches++;
                        console.log(`    Match found at Row ${rowIndex + 1}, Col ${colIndex + 1} (${sheetName}): ${cell}`);
                        console.log(`    Row data: ${JSON.stringify(row)}`);
                    } else if (cellStr.toUpperCase().includes(TARGET_CODE.toUpperCase())) {
                        matches++;
                        console.log(`    Partial match at Row ${rowIndex + 1}, Col ${colIndex + 1} (${sheetName}): ${cell}`);
                        console.log(`    Row data: ${JSON.stringify(row)}`);
                    }
                });
            });

            if (matches === 0) {
                // console.log(`    No matches in sheet '${sheetName}'`);
            }
        });

    } catch (err) {
        console.error(`  Error reading file: ${err}`);
    }
}

console.log(`Searching for code '${TARGET_CODE}' in ALL local Excel files...`);
const allExcelFiles = getAllExcelFiles(process.cwd());
console.log(`Found ${allExcelFiles.length} Excel files to scan.`);
allExcelFiles.forEach(checkFile);
