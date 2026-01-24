const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const filePath = 'c:\\Users\\USER\\Desktop\\cursor\\측정일지_Html\\측정대상사업장목록_업로드 양식_2026-01-23.xlsx';
console.log('Reading file:', filePath);

if (!fs.existsSync(filePath)) {
    console.error('File not found!');
    process.exit(1);
}

try {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    console.log('Sheet Name:', sheetName);
    const worksheet = workbook.Sheets[sheetName];

    // Get range to find dimensions
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log(`Dimensions: R:${range.s.r}->${range.e.r}, C:${range.s.c}->${range.e.c}`);

    // Read raw values
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });

    if (jsonData.length > 0) {
        console.log('--- Row 0 (Headers?) ---');
        console.log(JSON.stringify(jsonData[0], null, 2));

        if (jsonData.length > 1) {
            console.log('--- Row 1 ---');
            console.log(JSON.stringify(jsonData[1], null, 2));
        }

        if (jsonData.length > 2) {
            console.log('--- Row 2 (Data Sample) ---');
            console.log(JSON.stringify(jsonData[2], null, 2));
        }

        // Check specifically for problematic columns
        // Find index of columns
        const headers = jsonData[0];
        const findIndex = (name) => headers.findIndex(h => h && String(h).includes(name));

        console.log('--- Column Indices ---');
        console.log('코드:', findIndex('코드'));
        console.log('금회예정일:', findIndex('금회예정일'));
        console.log('예정일:', findIndex('예정일'));
        console.log('금회측정확정일:', findIndex('금회측정확정일'));
        console.log('업종:', findIndex('업종'));
        console.log('업종분류:', findIndex('업종분류'));
        console.log('년도:', findIndex('년도'));
    }

} catch (e) {
    console.error('Error:', e);
}
