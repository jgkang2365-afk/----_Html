"use client";

import React, { useState } from "react";
import { Dashboard } from "@/components/features/Dashboard";
import { ExcelUpload } from "@/components/features/ExcelUpload";
import { SyncStatus } from "@/components/features/SyncStatus";
import { InconsistencyAlert } from "@/components/features/InconsistencyAlert";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

interface DashboardClientProps {
    user?: {
        role: "관리자" | "사용자";
        is_journal_manager: boolean;
    } | null;
}

export const DashboardClient = ({ user }: DashboardClientProps) => {
    // 서울 시간대(Asia/Seoul) 기준으로 현재 년도 가져오기
    const getCurrentYear = () => {
        const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        return seoulTime.getFullYear();
    };

    const [activeTab, setActiveTab] = useState("general");
    const [syncRefreshKey, setSyncRefreshKey] = useState(0);
    const [isSyncing, setIsSyncing] = useState(false);

    // 필터 상태 (Dashboard로 전달)
    const [startYear, setStartYear] = useState<string>(getCurrentYear().toString());
    const [endYear, setEndYear] = useState<string>(getCurrentYear().toString());
    const [selectedPeriod, setSelectedPeriod] = useState<string>("전체");

    const handleMesSync = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        
        try {
            console.log("[DashboardClient] MES 수동 동기화 요청 API 전송 시도...");
            const res = await fetch("/api/cron/mes-trigger", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                }
            });
            
            const data = await res.json();
            if (res.ok && data.success) {
                alert(data.message || "MES 수동 동기화가 백그라운드에서 실행되었습니다.");
            } else {
                alert(`동기화 요청 실패: ${data.error || "알 수 없는 에러"}`);
            }
        } catch (err: any) {
            alert(`동기화 요청 중 오류가 발생했습니다: ${err.message || String(err)}`);
        } finally {
            setIsSyncing(false);
        }
    };

    // 년도 옵션 생성
    const currentYear = getCurrentYear();
    const yearOptions = Array.from({ length: 6 }, (_, i) => {
        const year = currentYear - i; // 올해부터 과거 5년
        return { value: year.toString(), label: `${year}년` };
    });

    const periodOptions = [
        { value: "전체", label: "전체 주기" },
        { value: "상반기", label: "상반기" },
        { value: "하반기", label: "하반기" },
    ];

    return (
        <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-gray-100 pb-2.5">
                <div>
                    <h1 className="text-2xl font-bold text-text-900 mb-1">대시보드</h1>
                    <p className="text-text-700 text-sm">측정일지 관리 시스템 대시보드입니다.</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 self-end md:self-auto shrink-0">
                    {/* MES 수동 동기화 버튼 (관리자 전용) */}
                    {user?.role === "관리자" && (
                        <button
                            onClick={handleMesSync}
                            disabled={isSyncing}
                            className={cn(
                                "px-3 py-1.5 text-xs font-semibold rounded-md text-white transition-all duration-200 flex items-center gap-1.5 shadow-sm",
                                isSyncing
                                    ? "bg-slate-400 cursor-not-allowed"
                                    : "bg-primary-600 hover:bg-primary-700 active:bg-primary-800"
                            )}
                        >
                            {isSyncing ? (
                                <>
                                    <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    동기화 요청 중...
                                </>
                            ) : (
                                <>
                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6H16" />
                                    </svg>
                                    MES 수동 동기화
                                </>
                            )}
                        </button>
                    )}
                    {/* 탭 버튼 그룹 */}
                    <div className="inline-flex p-0.5 bg-gray-200/80 rounded-lg shadow-inner shrink-0">
                        <button
                            onClick={() => setActiveTab('general')}
                            className={cn(
                                "px-3 py-1 text-xs font-semibold rounded-md transition-all duration-200",
                                activeTab === 'general'
                                    ? "bg-white text-primary-600 shadow-sm"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/30"
                            )}
                        >
                            일반
                        </button>
                        <button
                            onClick={() => setActiveTab('data-upload')}
                            className={cn(
                                "px-3 py-1 text-xs font-semibold rounded-md transition-all duration-200",
                                activeTab === 'data-upload'
                                    ? "bg-white text-primary-600 shadow-sm"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/30"
                            )}
                        >
                            데이터 업로드
                        </button>
                    </div>

                    {/* 데이터 불일치 알림 */}
                    <InconsistencyAlert onNavigate={() => setActiveTab('data-upload')} />
                </div>
            </div>

            {/* 복합 필터 영역 (일반 탭 전용) */}
            {activeTab === 'general' && (
                <div className="flex justify-end items-center gap-2 mt-1">
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">조회 기간:</span>
                        <Select
                            value={startYear}
                            onChange={(e) => {
                                const val = e.target.value;
                                setStartYear(val);
                                if (parseInt(val) > parseInt(endYear)) {
                                    setEndYear(val);
                                }
                            }}
                            options={yearOptions}
                            className="w-28 bg-white text-sm"
                        />
                        <span className="text-slate-400 text-xs px-0.5 whitespace-nowrap">~</span>
                        <Select
                            value={endYear}
                            onChange={(e) => setEndYear(e.target.value)}
                            options={yearOptions.filter(opt => parseInt(opt.value) >= parseInt(startYear))}
                            className="w-28 bg-white text-sm"
                        />
                    </div>
                    <div className="h-4 w-[1px] bg-slate-200 mx-1 hidden sm:block" />
                    <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">주기:</span>
                        <Select
                            value={selectedPeriod}
                            onChange={(e) => setSelectedPeriod(e.target.value)}
                            options={periodOptions}
                            className="w-28 bg-white text-sm"
                        />
                    </div>
                </div>
            )}

            <div className="mt-4">
                {activeTab === 'general' && (
                    <div className="animate-in fade-in zoom-in-95 duration-300">
                        <Dashboard startYear={startYear} endYear={endYear} period={selectedPeriod} />
                    </div>
                )}
                {activeTab === 'data-upload' && (
                    <div className="animate-in fade-in zoom-in-95 duration-300 space-y-6">
                        <ExcelUpload onSuccess={() => setSyncRefreshKey(prev => prev + 1)} />
                        <SyncStatus key={syncRefreshKey} />
                    </div>
                )}
            </div>
        </div>
    );
};
