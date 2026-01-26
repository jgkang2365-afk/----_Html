"use client";

import React, { useState } from "react";
import { Dashboard } from "@/components/features/Dashboard";
import { ExcelUpload } from "@/components/features/ExcelUpload";
import { SyncStatus } from "@/components/features/SyncStatus";
import { cn } from "@/lib/utils";

export const DashboardClient = () => {
    const [activeTab, setActiveTab] = useState("general");

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 border-b border-gray-100 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-text-900 mb-1">대시보드</h1>
                    <p className="text-text-700 text-sm">측정일지 관리 시스템 대시보드입니다.</p>
                </div>

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

            <div className="mt-4">
                {activeTab === 'general' && (
                    <div className="animate-in fade-in zoom-in-95 duration-300">
                        <Dashboard />
                    </div>
                )}
                {activeTab === 'data-upload' && (
                    <div className="animate-in fade-in zoom-in-95 duration-300 space-y-6">
                        <ExcelUpload />
                        <SyncStatus />
                    </div>
                )}
            </div>
        </div>
    );
};
