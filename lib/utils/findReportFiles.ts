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
            console.warn(`[findReportFiles] 경로를 찾을 수 없습니다: ${basePath}`);
            console.log(`[findReportFiles] 현재 STORAGE_ROOT: ${storageRoot}`);
            return { report: null, invoice: null, dataFile: null, drawings: [], drawingFolderPath: '' };
        }

        const normalize = (name: string) => name.normalize('NFC').replace(/[\(\)\s]/g, '').trim();
        const normalizedTarget = normalize(companyName);

        const items = fs.readdirSync(basePath);
        let targetFolderPath = '';

        console.log(`[findReportFiles Debug] 검색 시작 - 대상 회사명: "${companyName}" (정규화: "${normalizedTarget}")`);
        console.log(`[findReportFiles Debug] 탐색 기준 경로(basePath): "${basePath}"`);

        for (const item of items) {
            const normalizedItem = normalize(item);
            if (normalizedItem.includes(normalizedTarget) || normalizedTarget.includes(normalizedItem)) {
                const parentPath = join(basePath, item);
                targetFolderPath = parentPath;
                console.log(`[findReportFiles Debug] 1단계 매칭 성공: "${item}" (경로: ${parentPath})`);

                try {
                    if (fs.existsSync(parentPath) && fs.statSync(parentPath).isDirectory()) {
                        const subItems = fs.readdirSync(parentPath);
                        console.log(`[findReportFiles Debug] 2단계 하위 폴더 목록:`, subItems);
                        for (const subItem of subItems) {
                            const subPath = join(parentPath, subItem);
                            if (fs.statSync(subPath).isDirectory()) {
                                const normalizedSub = normalize(subItem);
                                if (normalizedSub.length > 1 && normalizedTarget.includes(normalizedSub)) {
                                    targetFolderPath = subPath;
                                    console.log(`[findReportFiles Debug] 2단계 지점 폴더 매칭 성공: "${subItem}" -> 최종 경로: "${subPath}"`);
                                    break;
                                }
                            }
                        }
                    }
                } catch (subErr) {
                    console.warn(`[findReportFiles] 지점 하위 폴더 탐색 중 예외 발생 (기존 폴더로 진행):`, subErr);
                }
                break;
            }
        }

        if (!targetFolderPath) {
            console.warn(`[findReportFiles Debug] 매칭되는 폴더를 전혀 찾지 못했습니다.`);
        } else {
            console.log(`[findReportFiles Debug] 최종 결정된 폴더 경로: "${targetFolderPath}"`);
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
