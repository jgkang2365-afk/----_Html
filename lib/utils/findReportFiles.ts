import { join } from 'path';
import { existsSync, readdirSync } from 'fs';

/**
 * Z 드라이브 내 보고서 및 수수료 내역서 파일 탐색 유틸리티
 */
export interface ReportFiles {
    report: { filename: string; path: string } | null;
    invoice: { filename: string; path: string } | null;
}

export function findReportFiles(options: {
    year: string;
    semester: string;
    companyName: string;
}): ReportFiles {
    const { year, semester, companyName } = options;
    const yearShort = year.substring(2); // e.g., "25"
    const semesterShort = semester === '상반기' || semester === '상' ? '상' : '하';

    // Z 드라이브 베이스 경로 (TRS 기준)
    const basePath = `Z:\\data\\측정팀\\측정보고서\\${year}년\\${semester}`;

    if (!existsSync(basePath)) {
        console.warn(`[File Search] 경로가 존재하지 않습니다: ${basePath}`);
        return { report: null, invoice: null };
    }

    // 업체명 정규화 (괄호, 공백 제거 등 파이썬 로직 모사)
    const normalize = (name: string) => name.replace(/[\(\)\s]/g, '').trim();
    const normalizedTarget = normalize(companyName);

    // 해당 반기 폴더 내의 모든 항목 스캔
    const items = readdirSync(basePath);
    let targetFolderPath = '';

    // 1. 업체명과 일치하는 폴더 찾기
    for (const item of items) {
        if (normalize(item).includes(normalizedTarget) || normalizedTarget.includes(normalize(item))) {
            targetFolderPath = join(basePath, item);
            break;
        }
    }

    if (!targetFolderPath || !existsSync(targetFolderPath)) {
        console.warn(`[File Search] 업체를 위한 폴더를 찾을 수 없습니다: ${companyName}`);
        return { report: null, invoice: null };
    }

    // 2. 폴더 내 파일 규칙 기반 탐색
    const files = readdirSync(targetFolderPath);
    let reportFile = null;
    let invoiceFile = null;

    const reportPattern = `${yearShort}${semesterShort}`; // e.g., "25상"

    for (const file of files) {
        const normalizedFile = normalize(file);

        // 보고서 매칭 (엄격): {사업장명}(보고서-YY상/하).pdf
        if (normalizedFile.includes(normalizedTarget) &&
            normalizedFile.includes(`보고서-${reportPattern}`) &&
            file.toLowerCase().endsWith('.pdf')) {
            reportFile = { filename: file, path: join(targetFolderPath, file) };
        }

        // 수수료 내역서 매칭 (유연): *수수료내역서(YY상/하).pdf
        if (normalizedFile.includes('수수료내역서') &&
            normalizedFile.includes(reportPattern) &&
            file.toLowerCase().endsWith('.pdf')) {
            invoiceFile = { filename: file, path: join(targetFolderPath, file) };
        }
    }

    return { report: reportFile, invoice: invoiceFile };
}
