"use client";

import React, { useState } from "react";
import { Dashboard } from "@/components/features/Dashboard";
import { ExcelUpload } from "@/components/features/ExcelUpload";
import { SyncStatus } from "@/components/features/SyncStatus";
import { InconsistencyAlert } from "@/components/features/InconsistencyAlert";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

export const DashboardClient = () => {
    // 서울 시간대(Asia/Seoul) 기준으로 현재 년도 가져오기
    const getCurrentYear = () => {
        const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        return seoulTime.getFullYear();
    };

    const [activeTab, setActiveTab] = useState("general");
    const [syncRefreshKey, setSyncRefreshKey] = useState(0);

    // 필터 상태 (Dashboard로 전달)
    const [startYear, setStartYear] = useState<string>(getCurrentYear().toString());
    const [endYear, setEndYear] = useState<string>(getCurrentYear().toString());
    const [selectedPeriod, setSelectedPeriod] = useState<string>("전체");

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
