const fs = require('fs');
const path = require('path');

const log = fs.readFileSync('recovery_log.txt', 'utf8');
const lines = log.split('\n');
let result = '# 5인 이상 연번 복구 결과 상세 확인표\n\n' +
    '> 사용자님께서 **직접 확인이나 수정을 진행하고 계셨던 부분**이 있을 수 있어, 복원을 진행한 **85건 전체의 내역(비포 & 애프터)**을 표로 정리해 드립니다.\n' +
    '> 본인이 수기로 애써 고치셨던 내역을 스크립트가 다른 번호로 덮어썼는지 (정합성이 맞는지) 한눈에 확인해 보세요.\n\n' +
    '| 소속 | 사업장명 | ❌ 수정 전 꼬인 번호 (버그) | ✅ 복구된 원래 앞번호 (자동) |\n' +
    '|:---:|:---|:---:|:---:|\n';

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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

// Artifact Metadata requires JSON output, but writeFileSync is simpler
const outputPath = 'C:/Users/USER/.gemini/antigravity/brain/79f0fbc1-47d3-4da9-891f-2e79853531bd/recovery_mapping.md';
fs.writeFileSync(outputPath, result);
console.log('Artifact created at ' + outputPath);
