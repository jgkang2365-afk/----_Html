const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'components', 'features', 'SalesManagement.tsx');
let content = fs.readFileSync(filePath, 'utf8');

// 시작 검색어와 끝 검색어 설정
const startMarker = `// 발행일 목록이 있을 경우에만 참고 블록 추가`;
const endMarker = `감사합니다.\`;`;

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

// 새 코드 블록 작성 (줄바꿈 스타일을 파일에 맞춰 CRLF로 명시)
const replacement = `// 발행일 목록이 있을 경우에만 참고 블록 추가
    let invoiceInfoSection = "";
    if (invoiceDateLines.length > 0) {
      invoiceInfoSection = "\\r\\n\\r\\n[참고] 전자계산서 발행일\\r\\n" + invoiceDateLines.join("\\r\\n");
    }

    // 4. 요청하신 템플릿 형태로 본문 구성
    const formatAmt = formatCurrency(totalUnpaidAmount);
    const smsBody = \`안녕하십니까!
한결작업환경컨설팅입니다.

\${periodsText} 작업환경측정 수수료 미수금 \${formatAmt}원 이오니 확인해 보시고, 입금 부탁드립니다.

은 행 명 : 우리은행
계좌번호 : 1005-604-374610
예 금 주 : 주식회사 한결작업환경컨설팅

감사합니다.\${invoiceInfoSection}\`;`;

// 파일 내용 치환
const newContent = content.slice(0, startIndex) + replacement + content.slice(replaceEndIndex);

// 최종 작성
fs.writeFileSync(filePath, newContent, 'utf8');
console.log('Template successfully updated.');
