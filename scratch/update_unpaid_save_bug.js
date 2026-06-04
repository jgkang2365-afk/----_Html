const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'app', 'api', 'journal', '[id]', 'route.ts');
let content = fs.readFileSync(filePath, 'utf8');

// 시작 검색어와 끝 검색어 설정
const startMarker = `      // 측정 정보
      measurement_start_date: bodyClean.measurement_start_date ?? existingJournal.measurement_start_date,`;

const endMarker = `      deposit_total: bodyClean.deposit_total ?? existingJournal.deposit_total,`;

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1) {
  console.error('Cannot find start marker');
  process.exit(1);
}
if (endIndex === -1) {
  console.error('Cannot find end marker');
  process.exit(1);
}

// 교체 대상 구간의 끝 인덱스 계산 (endMarker 길이 포함)
const replaceEndIndex = endIndex + endMarker.length;

// 새 코드 블록 작성 (?? 연산자 제거 및 undefined 체크 로직 적용)
const replacement = `      // 측정 정보
      measurement_start_date: bodyClean.measurement_start_date !== undefined ? bodyClean.measurement_start_date : existingJournal.measurement_start_date,
      measurement_end_date: bodyClean.measurement_end_date !== undefined ? bodyClean.measurement_end_date : existingJournal.measurement_end_date,
      measurement_days: bodyClean.measurement_days !== undefined ? (parseInt(String(bodyClean.measurement_days)) || null) : existingJournal.measurement_days,
      measurer: bodyClean.measurer !== undefined ? bodyClean.measurer : existingJournal.measurer,
      completion_status: bodyClean.completion_status !== undefined ? bodyClean.completion_status : existingJournal.completion_status,

      // K2B/계산서 정보
      k2b_send_date: bodyClean.k2b_send_date !== undefined ? bodyClean.k2b_send_date : existingJournal.k2b_send_date,
      k2b_sender: bodyClean.k2b_sender !== undefined ? bodyClean.k2b_sender : existingJournal.k2b_sender,
      invoice_email: bodyClean.invoice_email !== undefined ? bodyClean.invoice_email : existingJournal.invoice_email,
      invoice_email_2: bodyClean.invoice_email_2 !== undefined ? bodyClean.invoice_email_2 : existingJournal.invoice_email_2,
      electronic_invoice_date: bodyClean.electronic_invoice_date !== undefined ? bodyClean.electronic_invoice_date : existingJournal.electronic_invoice_date,
      electronic_invoice_date_2: bodyClean.electronic_invoice_date_2 !== undefined ? bodyClean.electronic_invoice_date_2 : existingJournal.electronic_invoice_date_2,
      invoice_business_name: truncateField(bodyClean.invoice_business_name !== undefined ? bodyClean.invoice_business_name : existingJournal.invoice_business_name, 255, 'invoice_business_name'),
      invoice_business_number: cleanToDigits(bodyClean.invoice_business_number !== undefined ? bodyClean.invoice_business_number : existingJournal.invoice_business_number),

      // 측정비 정보
      measurement_fee_total: bodyClean.measurement_fee_total !== undefined ? bodyClean.measurement_fee_total : existingJournal.measurement_fee_total,
      measurement_fee_business: bodyClean.measurement_fee_business !== undefined ? bodyClean.measurement_fee_business : existingJournal.measurement_fee_business,
      measurement_fee_national: bodyClean.measurement_fee_national !== undefined ? bodyClean.measurement_fee_national : existingJournal.measurement_fee_national,

      // 입금 정보
      deposit_date_business: bodyClean.deposit_date_business !== undefined ? bodyClean.deposit_date_business : existingJournal.deposit_date_business,
      deposit_amount_business: bodyClean.deposit_amount_business !== undefined ? bodyClean.deposit_amount_business : existingJournal.deposit_amount_business,
      deposit_date_business_2: bodyClean.deposit_date_business_2 !== undefined ? bodyClean.deposit_date_business_2 : existingJournal.deposit_date_business_2,
      deposit_amount_business_2: bodyClean.deposit_amount_business_2 !== undefined ? bodyClean.deposit_amount_business_2 : existingJournal.deposit_amount_business_2,
      deposit_date_national: bodyClean.deposit_date_national !== undefined ? bodyClean.deposit_date_national : existingJournal.deposit_date_national,
      deposit_amount_national: bodyClean.deposit_amount_national !== undefined ? bodyClean.deposit_amount_national : existingJournal.deposit_amount_national,
      deposit_total: bodyClean.deposit_total !== undefined ? bodyClean.deposit_total : existingJournal.deposit_total,`;

// 파일 내용 치환
const newContent = content.slice(0, startIndex) + replacement + content.slice(replaceEndIndex);

// CRLF 줄바꿈 준수 및 저장
fs.writeFileSync(filePath, newContent.replace(/\r?\n/g, '\r\n'), 'utf8');
console.log('API update script ran successfully.');
