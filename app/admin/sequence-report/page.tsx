import fs from "fs";
import path from "path";

export default function SequenceReportPage() {
    const filePath = path.join(process.cwd(), "public", "sequence_changes_report.md");
    let content = "";

    try {
        content = fs.readFileSync(filePath, "utf8");
    } catch (error) {
        content = "보고서 파일을 찾을 수 없습니다.";
    }

    // 간단한 마크다운 파싱 (테이블 및 헤더 위주)
    const lines = content.split('\n');

    return (
        <div className="container mx-auto py-10 px-4">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">5인 이상 연번 복구 결과 상세표</h1>
                <p className="text-gray-600">
                    시스템 버그로 인해 뒤섞였던 연번들을 최초 생성 순서에 맞춰 전수 복구한 내역입니다.
                </p>
            </div>

            <div className="bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
                <div className="p-6 md:p-8">
                    {lines.map((line, idx) => {
                        // 헤더 처리
                        if (line.startsWith('# ')) {
                            return null; // 이미 상단에 표시함
                        }
                        if (line.startsWith('## ')) {
                            return (
                                <h2 key={idx} className="text-xl font-semibold mt-10 mb-4 pb-2 border-b-2 border-blue-500 inline-block text-blue-700">
                                    {line.replace('## ', '')}
                                </h2>
                            );
                        }

                        // 테이블 처리 (가장 단순한 형태)
                        if (line.trim().startsWith('|') && !line.includes('---')) {
                            const cells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim());
                            const isHeader = idx > 0 && lines[idx + 1]?.includes('---');

                            if (isHeader) {
                                return (
                                    <div key={idx} className="grid grid-cols-5 bg-gray-50 border-y border-gray-200 font-bold text-sm overflow-hidden">
                                        {cells.map((cell, cIdx) => (
                                            <div key={cIdx} className="p-3 text-center border-r border-gray-100 last:border-r-0">
                                                {cell}
                                            </div>
                                        ))}
                                    </div>
                                );
                            }

                            return (
                                <div key={idx} className="grid grid-cols-5 border-b border-gray-100 last:border-b-0 hover:bg-blue-50/30 transition-colors text-sm">
                                    {cells.map((cell, cIdx) => {
                                        const isBold = cell.includes('**');
                                        const cleanCell = cell.replace(/\*\*/g, '');
                                        return (
                                            <div key={cIdx} className={`p-3 text-center border-r border-gray-100 last:border-r-0 ${isBold ? 'font-bold text-blue-600' : ''}`}>
                                                {cleanCell}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        }

                        // 일반 텍스트
                        if (line.trim() && !line.includes('---')) {
                            return <p key={idx} className="text-gray-700 my-2">{line}</p>;
                        }

                        return null;
                    })}
                </div>
            </div>

            <div className="mt-8 text-center text-sm text-gray-500">
                © 2026 측정일지 관리 시스템 - 자동 복구 리포트
            </div>
        </div>
    );
}
