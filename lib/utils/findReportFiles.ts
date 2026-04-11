import { join } from 'path';

export interface ReportFiles {
    report: { filename: string; path: string } | null;
    invoice: { filename: string; path: string } | null;
    dataFile: { filename: string; path: string } | null;
    drawings: { filename: string; path: string }[];
    drawingFolderPath: string;
}

export function findReportFiles(options: {
    year: string;
    semester: string;
    companyName: string;
}): ReportFiles {
    // 1. 빌드 시점(Static Analysis) 및 브라우저 환경에서는 파일 시스템 접근 차단
    if (
        typeof window !== 'undefined' ||
        (typeof process !== 'undefined' && process.env.NEXT_PHASE === 'phase-production-build')
    ) {
        return { report: null, invoice: null, dataFile: null, drawings: [], drawingFolderPath: '' };
    }

    // 2. Webpack의 정적 의존성 분석을 피하기 위해 eval('require') 사용
    try {
        const fs = eval('require')('fs');
        const { year, semester, companyName } = options;

        const yearShort = year.substring(2);
        const semesterShort = semester === '상반기' || semester === '상' ? '상' : '하';

        // 3. 보고서 저장소 루트 경로 설정 (환경 변수 우선, 없으면 기본 Z: 드라이브 사용)
        const storageRoot = process.env.REPORT_STORAGE_ROOT || ['Z', ':', '\\data\\측정팀\\측정보고서'].join('');
        
        // OS별 경로 구분을 위해 path.join 사용 (환경 변수가 Windows 경로일 경우를 대비해 backslash 처리 고려)
        const basePath = join(storageRoot, `${year}년`, semester);

        if (!fs.existsSync(basePath)) {
            return { report: null, invoice: null, dataFile: null, drawings: [], drawingFolderPath: '' };
        }

        const normalize = (name: string) => name.replace(/[\(\)\s]/g, '').trim();
        const normalizedTarget = normalize(companyName);

        const items = fs.readdirSync(basePath);
        let targetFolderPath = '';

        for (const item of items) {
            if (normalize(item).includes(normalizedTarget) || normalizedTarget.includes(normalize(item))) {
                targetFolderPath = join(basePath, item);
                break;
            }
        }

        if (!targetFolderPath || !fs.existsSync(targetFolderPath)) {
            return { report: null, invoice: null, dataFile: null, drawings: [], drawingFolderPath: '' };
        }

        const files = fs.readdirSync(targetFolderPath);
        let reportFile = null;
        let invoiceFile = null;
        let dataFile = null;
        const drawings: { filename: string; path: string }[] = [];

        const reportPattern = `${yearShort}${semesterShort}`;

        for (const file of files) {
            const normalizedFile = normalize(file);

            if (normalizedFile.includes(normalizedTarget) &&
                normalizedFile.includes(`보고서-${reportPattern}`) &&
                file.toLowerCase().endsWith('.pdf')) {
                reportFile = { filename: file, path: join(targetFolderPath, file) };
            }

            if (normalizedFile.includes('수수료내역서') &&
                normalizedFile.includes(reportPattern) &&
                file.toLowerCase().endsWith('.pdf')) {
                invoiceFile = { filename: file, path: join(targetFolderPath, file) };
            }

            if (file.toLowerCase().endsWith('.txt')) {
                dataFile = { filename: file, path: join(targetFolderPath, file) };
            }
        }

        const dFolderPath = join(targetFolderPath, '도면');
        if (fs.existsSync(dFolderPath)) {
            const drawingFiles = fs.readdirSync(dFolderPath);
            const validExtensions = ['.jpg', '.jpeg', '.png'];
            for (const file of drawingFiles) {
                if (validExtensions.some(ext => file.toLowerCase().endsWith(ext))) {
                    drawings.push({ filename: file, path: join(dFolderPath, file) });
                }
            }
        }

        return {
            report: reportFile,
            invoice: invoiceFile,
            dataFile,
            drawings,
            drawingFolderPath: dFolderPath
        };

    } catch (error) {
        return { report: null, invoice: null, dataFile: null, drawings: [], drawingFolderPath: '' };
    }
}
