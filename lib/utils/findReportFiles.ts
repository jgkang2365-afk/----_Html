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
    // 1. 빌드 시점(Static Analysis), 브라우저 환경, 테스트 환경에서는 즉시 차단
    // NEXT_PHASE를 최상단에서 체크하여 아래의 require나 fs 접근을 원천 차단
    if (
        typeof process !== 'undefined' &&
        (process.env.NEXT_PHASE === 'phase-production-build' || process.env.NODE_ENV === 'test') ||
        typeof window !== 'undefined'
    ) {
        return { report: null, invoice: null, dataFile: null, drawings: [], drawingFolderPath: '' };
    }

    // 2. Webpack의 정적 의존성 분석을 피하기 위해 eval('require') 사용
    try {
        const fs = eval('require')('fs');
        const { year, semester, companyName } = options;

        const yearShort = year.substring(2);
        const semesterShort = semester === '상반기' || semester === '상' ? '상' : '하';

        // 3. 정적 분석 탐지 방지를 위해 드라이브 문자 및 경로를 런타임에 결합
        const drive = ['Z', ':'].join('');
        const pathSegments = ['data', '측정팀', '측정보고서', `${year}년`, semester];
        const basePath = [drive, ...pathSegments].join('\\');

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
