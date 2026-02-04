"use client";

import React, { useState } from "react";
import { Dashboard } from "@/components/features/Dashboard";
import { ExcelUpload } from "@/components/features/ExcelUpload";

import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

export const DashboardClient = () => {
    // 서울 시간대(Asia/Seoul) 기준으로 현재 년도 가져오기
    const getCurrentYear = () => {
        const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
        return seoulTime.getFullYear();
    };

    const [activeTab, setActiveTab] = useState("general");

    // 필터 상태 (Dashboard로 전달)
    const [selectedYear, setSelectedYear] = useState<string>(getCurrentYear().toString());
    const [selectedPeriod, setSelectedPeriod] = useState<string>("전체");

    // 년도 옵션 생성
    const currentYear = getCurrentYear();
    const yearOptions = [
        { value: "전체", label: "전체 년도" },
        ...Array.from({ length: 6 }, (_, i) => {
            const year = currentYear - i; // 올해부터 과거 5년
            return { value: year.toString(), label: `${year}년` };
        })
    ];

    const periodOptions = [
        { value: "전체", label: "전체 주기" },
        { value: "상반기", label: "상반기" },
        { value: "하반기", label: "하반기" },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-gray-100 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-900 mb-1">대시보드</h1>
                    <p className="text-text-700 text-sm">측정일지 관리 시스템 대시보드입니다.</p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-center">
                    {activeTab === 'general' && (
                        <div className="flex gap-2">
                            <div className="flex items-center gap-2">
                                <Select
                                    value={selectedYear}
                                    onChange={(e) => setSelectedYear(e.target.value)}
                                    options={yearOptions}
                                    className="w-32 bg-white"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <Select
                                    value={selectedPeriod}
                                    onChange={(e) => setSelectedPeriod(e.target.value)}
                                    options={periodOptions}
                                    className="w-32 bg-white"
                                />
                            </div>
                        </div>
                    )}

                    {/* 탭 버튼 그룹 */}
                    <div className="inline-flex p-1 bg-gray-100 rounded-lg shadow-inner">
                        <button
                            onClick={() => setActiveTab('general')}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200",
                                activeTab === 'general'
                                    ? "bg-white text-primary-600 shadow-sm"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
                            )}
                        >
                            일반
                        </button>
                        <button
                            onClick={() => setActiveTab('data-upload')}
                            className={cn(
                                "px-4 py-2 text-sm font-medium rounded-md transition-all duration-200",
                                activeTab === 'data-upload'
                                    ? "bg-white text-primary-600 shadow-sm"
                                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-200/50"
                            )}
                        >
                            데이터 업로드
                        </button>
                    </div>
                </div>
            </div>

            <div className="mt-4">
                {activeTab === 'general' && (
                    <div className="animate-in fade-in zoom-in-95 duration-300">
                        <Dashboard year={selectedYear} period={selectedPeriod} />
                    </div>
                )}
                {activeTab === 'data-upload' && (
                    <div className="animate-in fade-in zoom-in-95 duration-300 space-y-6">
                        <ExcelUpload />
                    </div>
                )}
            </div>
        </div>
    );
};
