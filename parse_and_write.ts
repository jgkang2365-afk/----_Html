import * as fs from 'fs';

const buffer = fs.readFileSync('recovery_log.txt');
const text = new TextDecoder('euc-kr').decode(buffer);
const lines = text.split('\n');

let result = '# 5인 이상 연번 복구 결과 (총 85건)\n\n' +
    '> 대표님께서 직접 수기로 수정하셨던 내역과, 이번 스크립트가 자동 복구한 내역의 정합성을 확인하실 수 있도록 전체 변경 기록 85건을 정리해 드렸습니다.\n\n' +
    '| 소속 | 사업장명 | ❌ 수정 전 꼬인 번호 (버그) | ✅ 복구된 원래 앞번호 (자동) |\n' +
    '|:---:|:---|:---:|:---:|\n';

for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('[')) {
        const match = line.match(/^\[(.*?)\] (.*?) \(ID/);
        if (!match) continue;
        const loc = match[1];
        const name = match[2];

        let badNum = '';
        let goodNum = '';

        for (let j = 1; j <= 4; j++) {
            if (lines[i + j]) {
                if (lines[i + j].includes('현재 꼬인 번호:')) {
                    badNum = lines[i + j].split('현재 꼬인 번호:')[1].trim();
                } else if (lines[i + j].includes('원래 번호:')) {
                    goodNum = lines[i + j].split('원래 번호:')[1].trim();
                }
            }
        }
        if (loc && name && badNum !== '' && goodNum !== '') {
            result += `| ${loc} | ${name} | ${badNum} | **${goodNum}** |\n`;
        }
    }
}

const outputPath = 'C:/Users/USER/Desktop/cursor/측정일지_html/mapping_final.txt';
fs.writeFileSync(outputPath, result, 'utf8');
console.log('Artifact created');
