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
    const [mesSyncStatus, setMesSyncStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
    const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);

    const isSyncing = mesSyncStatus === 'running';

    // 필터 상태 (Dashboard로 전달)
    const [startYear, setStartYear] = useState<string>(getCurrentYear().toString());
    const [endYear, setEndYear] = useState<string>(getCurrentYear().toString());
    const [selectedPeriod, setSelectedPeriod] = useState<string>("전체");

    const handleMesSync = async () => {
        if (mesSyncStatus === 'running') return;
        setMesSyncStatus('running');
        setSyncErrorMessage(null);
        
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
                // 수동 동기화 시작 후 3초 간격 폴링 시작
                const pollInterval = setInterval(async () => {
                    try {
                        const statusRes = await fetch("/api/cron/mes-trigger");
                        const statusData = await statusRes.json();
                        if (statusRes.ok && statusData.success) {
                            if (statusData.status === 'success') {
                                setMesSyncStatus('success');
                                clearInterval(pollInterval);
                                setSyncRefreshKey(prev => prev + 1); // 데이터 리프레시 트리거
                                setTimeout(() => {
                                    setMesSyncStatus('idle');
                                }, 2500);
                            } else if (statusData.status === 'error') {
                                setMesSyncStatus('error');
                                setSyncErrorMessage(statusData.error || "동기화 처리 중 서버 오류가 발생했습니다.");
                                clearInterval(pollInterval);
                            }
                        }
                    } catch (pollErr) {
                        console.error("[DashboardClient] 동기화 상태 폴링 중 실패:", pollErr);
                    }
                }, 3000);
            } else {
                setMesSyncStatus('error');
                setSyncErrorMessage(data.error || "동기화 요청이 거부되었습니다.");
            }
        } catch (err: any) {
            setMesSyncStatus('error');
            setSyncErrorMessage(err.message || String(err));
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

            {/* MES 동기화 진행률 모달 (폴링 기반 완료 자동 닫기) */}
            {mesSyncStatus !== 'idle' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm transition-all duration-300">
                    <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 w-full max-w-sm mx-4 transform scale-100 transition-all duration-300 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex flex-col items-center text-center">
                            {mesSyncStatus === 'running' && (
                                <>
                                    <div className="relative flex items-center justify-center w-16 h-16 mb-4">
                                        <div className="absolute inset-0 rounded-full border-4 border-primary-100 animate-pulse"></div>
                                        <div className="absolute inset-0 rounded-full border-4 border-t-primary-600 border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
                                        <svg className="w-6 h-6 text-primary-600 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6H16" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-1">MES 동기화 진행 중</h3>
                                    <p className="text-xs text-slate-500 mb-2 leading-relaxed">
                                        파이썬 봇이 MES 프로그램에서 엑셀을 내려받아 백업 및 DB 업로드를 진행하고 있습니다.
                                    </p>
                                    <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mb-1.5">
                                        <div className="bg-primary-600 h-full rounded-full animate-pulse" style={{ width: '60%' }}></div>
                                    </div>
                                    <span className="text-[10px] text-slate-400">약 1~2분이 소요됩니다. 완료 시 이 창이 자동으로 닫힙니다.</span>
                                </>
                            )}

                            {mesSyncStatus === 'success' && (
                                <>
                                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-50 text-green-600 mb-4 animate-bounce">
                                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-1">동기화 완료!</h3>
                                    <p className="text-sm text-green-600 font-semibold mb-2">성공적으로 연동되었습니다.</p>
                                    <span className="text-xs text-slate-500 leading-relaxed">
                                        새로운 측정일지 및 일정 데이터의 DB 정합성 검증이 완료되었습니다.
                                    </span>
                                </>
                            )}

                            {mesSyncStatus === 'error' && (
                                <>
                                    <div className="flex items-center justify-center w-16 h-16 rounded-full bg-red-50 text-red-600 mb-4 animate-pulse">
                                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-1">동기화 실패</h3>
                                    <p className="text-xs text-red-500 font-mono bg-red-50 border border-red-100 rounded-lg p-2.5 w-full text-left overflow-auto max-h-32 mb-4 leading-relaxed whitespace-pre-wrap">
                                        {syncErrorMessage || "알 수 없는 에러가 발생했습니다."}
                                    </p>
                                    <button
                                        onClick={() => setMesSyncStatus('idle')}
                                        className="w-full py-2 bg-slate-800 hover:bg-slate-900 active:bg-black text-white text-xs font-semibold rounded-md shadow transition-colors"
                                    >
                                        닫기
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
