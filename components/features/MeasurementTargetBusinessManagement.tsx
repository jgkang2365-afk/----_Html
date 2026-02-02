"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import { ExcelUpload } from "@/components/features/ExcelUpload";
import { toShortName } from "@/lib/constants/designated-offices";
import * as XLSX from "xlsx";

interface BusinessEntry {
    code: string;
    year: number;
    period: string;
    business_name: string;
    address: string | null;
    office_jurisdiction: string | null; // 관할청
    designated_office: string | null; // 지정지청
    isRegistered: boolean;
    is_registered_text: string | null; // '실시', '미실시', '거래종료'
    national_support_status: string | null; // 국고
    plan_manager: string | null; // 계획담당
    manager_name: string | null; // 업체담당
    manager_mobile: string | null;
    phone: string | null;
    unpaid_count: number;
    previous_measurement_date: string | null;
    future_measurement_period: number | null; // 향후 측정주기
    future_measurement_date: string | null;
    measurement_date: string | null;
    notes: string | null;
    updated_at?: string;
    measurement_month?: string | null;
    measurer_id?: number | null; // 측정자 ID
}

interface User {
    id: number;
    name: string;
    job?: string;
}

// State for Persistence
const STORAGE_KEY = "measurement_target_filters_v1";

// Dropdown Options
const OFFICE_OPTIONS = [
    { value: "", label: "전체" },
    { value: "천안", label: "천안" },
    { value: "대전", label: "대전" },
    { value: "평택", label: "평택" },
    { value: "경기", label: "경기" }
];

const STATUS_OPTIONS = [
    { value: "전체", label: "전체" },
    { value: "실시", label: "실시" },
    { value: "미실시", label: "미실시" },
    { value: "거래종료", label: "거래종료" }
];

const MANAGER_OPTIONS = [
    { value: "", label: "전체" },
    { value: "한기문", label: "한기문" },
    { value: "이주형", label: "이주형" },
    { value: "강종구", label: "강종구" }
];

const PLAN_MANAGER_EDIT_OPTIONS = [
    { value: "", label: "선택" },
    { value: "한기문", label: "한기문" },
    { value: "이주형", label: "이주형" },
    { value: "강종구", label: "강종구" }
];

// Generate Year-Period Options
const generateYearPeriodOptions = () => {
    const options = [];
    const startYear = 2024;
    const endYear = 2030;
    for (let y = startYear; y <= endYear; y++) {
        options.push({ value: `${y}-상반기`, label: `${y}년 상반기` });
        options.push({ value: `${y}-하반기`, label: `${y}년 하반기` });
    }
    return options;
};
const YEAR_PERIOD_OPTIONS = generateYearPeriodOptions();

export const MeasurementTargetBusinessManagement: React.FC = () => {
    const [loading, setLoading] = useState(false);

    // Data State
    const [data, setData] = useState<BusinessEntry[]>([]);
    const [filteredData, setFilteredData] = useState<BusinessEntry[]>([]);
    const [measurers, setMeasurers] = useState<User[]>([]); // 측정자 목록

    // Initial Filter Setup
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const initialPeriod = currentMonth <= 6 ? "상반기" : "하반기";

    const [filters, setFilters] = useState({
        yearPeriod: `${currentYear}-${initialPeriod}`, // Combined
        designatedOffice: "",
        address: "",
        businessName: "",
        isRegistered: "전체",
        planManager: "",
    });

    // Load Filters
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setFilters(prev => ({ ...prev, ...parsed }));
            } catch (e) {
                console.error("Failed to load filters", e);
            }
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    }, [filters]);

    // Fetch Measurers (Users with job='측정')
    useEffect(() => {
        const fetchMeasurers = async () => {
            try {
                const response = await fetch('/api/users');
                if (response.ok) {
                    const result = await response.json();
                    if (result.users) {
                        // Job이 '측정'인 사용자만 필터링 (기본값이 '측정'이므로 없어도 포함될 수 있으나 명시적 확인)
                        const filtered = result.users.filter((u: User) => u.job === '측정' || !u.job); // job이 null인 경우도 포함할지? API default is '측정'.
                        // DB migration adds default '측정'.
                        setMeasurers(filtered);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch measurers", e);
            }
        };
        fetchMeasurers();
    }, []);

    // Modals & Edit State
    const [isExcelModalOpen, setIsExcelModalOpen] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<BusinessEntry | null>(null);
    const [editForm, setEditForm] = useState<Partial<BusinessEntry>>({});

    // Fetch Raw Data
    const fetchData = useCallback(async () => {
        const [year, period] = filters.yearPeriod.split("-");
        if (!year || !period) return;

        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.append("year", year);
            params.append("period", period);

            const response = await fetch(`/api/businesses?${params.toString()}`);
            if (!response.ok) throw new Error("Failed to fetch data");

            const result = await response.json();
            const fetchedData = result.businesses || [];

            setData(fetchedData);
        } catch (error) {
            console.error("Error fetching businesses:", error);
        } finally {
            setLoading(false);
        }
    }, [filters.yearPeriod]);

    // Client-side Filtering
    useEffect(() => {
        let result = data;

        if (filters.designatedOffice) {
            result = result.filter(item => {
                const office = toShortName(item.office_jurisdiction || "") || item.designated_office || "";
                return office.includes(filters.designatedOffice);
            });
        }

        if (filters.businessName) {
            const terms = filters.businessName.split(",").map(s => s.trim()).filter(Boolean);
            if (terms.length > 0) {
                result = result.filter(item =>
                    terms.some(term => (item.business_name || "").toLowerCase().includes(term.toLowerCase()))
                );
            }
        }

        if (filters.address) {
            const terms = filters.address.split(",").map(s => s.trim()).filter(Boolean);
            if (terms.length > 0) {
                result = result.filter(item =>
                    terms.some(term => (item.address || "").toLowerCase().includes(term.toLowerCase()))
                );
            }
        }

        if (filters.isRegistered !== "전체") {
            result = result.filter(item => item.is_registered_text === filters.isRegistered);
        }

        if (filters.planManager) {
            result = result.filter(item => item.plan_manager === filters.planManager);
        }

        setFilteredData(result);
    }, [data, filters]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSearch = () => {
        fetchData();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    };

    const handleEditClick = (item: BusinessEntry) => {
        setEditingItem(item);
        setEditForm({ ...item });
        setIsEditModalOpen(true);
    };

    const handleSaveEdit = async () => {
        if (!editingItem) return;
        saveChanges(editingItem.code, editForm);
        setIsEditModalOpen(false);
    };

    const saveChanges = async (code: string, updates: Partial<BusinessEntry>) => {
        try {
            const [year, period] = filters.yearPeriod.split("-");
            const response = await fetch("/api/businesses", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: code,
                    year: parseInt(year),
                    period: period,
                    updates: updates
                })
            });

            if (!response.ok) throw new Error("Failed to update");

            // Optimistic Update
            setData(prev => prev.map(item => item.code === code ? { ...item, ...updates } : item));
        } catch (error) {
            console.error("Update error:", error);
            alert("수정 중 오류가 발생했습니다.");
            fetchData(); // Revert on error
        }
    };

    const handleMeasurerChange = (item: BusinessEntry, newMeasurerId: string) => {
        const measurerId = newMeasurerId ? parseInt(newMeasurerId) : null;
        saveChanges(item.code, { measurer_id: measurerId });
    };

    const handleConfirmedDateChange = (item: BusinessEntry, newDate: string) => {
        saveChanges(item.code, { measurement_date: newDate });
    };

    const handleNotesChange = (item: BusinessEntry, newNotes: string) => {
        saveChanges(item.code, { notes: newNotes });
    };

    const handleExcelDownload = () => {
        const [year, period] = filters.yearPeriod.split("-");
        const measurerMap = new Map(measurers.map(m => [m.id, m.name]));

        const ws = XLSX.utils.json_to_sheet(filteredData.map((item, idx) => ({
            "No": idx + 1,
            "년도": item.year,
            "주기": item.period,
            "지정지청": item.designated_office,
            "사업장명": item.business_name,
            "소재지": item.address,
            "실시여부": item.is_registered_text,
            "국고결과": item.national_support_status,
            "계획담당": item.plan_manager,
            "측정자": item.measurer_id ? measurerMap.get(item.measurer_id) || "" : "",
            "향후측정주기": item.future_measurement_period ? (item.future_measurement_period === 6 ? "6개월" : item.future_measurement_period === 12 ? "1년" : item.future_measurement_period + "개월") : "-",
            "비고": item.notes
        })));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "측정대상사업장");
        XLSX.writeFile(wb, `측정대상사업장_${year}_${period}.xlsx`);
    };

    const calculateScheduledDate = (prevDateStr: string | null, cycleMonths: number | null) => {
        if (!prevDateStr || !cycleMonths) return "-";
        try {
            const date = new Date(prevDateStr);
            date.setMonth(date.getMonth() + cycleMonths);
            return date.toISOString().split('T')[0];
        } catch (e) {
            return "-";
        }
    };

    const formatCycle = (months: number | null) => {
        if (!months) return "-";
        if (months === 6) return "6개월";
        if (months === 12 || months === 1) return "1년"; // Note: User said "1은 12개월로". Code might store 1 for year? Or 12 for months. Let's assume user meant input '1' means 1 year. But usually stored as months.
        return `${months}개월`;
    };

    // Grid Column Template
    // 16 Columns: No(50), 실시여부(80), 국고(60), 계획담당(70), 사업장명(minmax(180,1fr)), 소재지(minmax(250,2fr)), 관할(70), 미수(50), 전회측정(90), 향후측정주기(100), 예정월(60), 예정일(90), 측정자(100), 확정일(90), 비고(100), 관리(50)
    const gridTemplateCols = "50px 80px 60px 70px minmax(180px, 1fr) minmax(250px, 2fr) 70px 50px 90px 100px 60px 90px 100px 90px 100px 50px";

    return (
        <div className="p-4 min-w-[1600px]">
            {/* Sticky Container for Filter & Table Header */}
            <div className="sticky top-16 lg:top-[113px] z-40 space-y-4 bg-gray-50/95 backdrop-blur">
                <Card className="p-4 bg-white shadow-sm border-surface-200">
                    <div className="flex items-center gap-2 flex-nowrap overflow-x-auto scrollbar-hide p-1">
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-base font-semibold whitespace-nowrap">측정년도/주기</span>
                            <Select
                                options={YEAR_PERIOD_OPTIONS}
                                value={filters.yearPeriod}
                                onChange={(e) => setFilters(prev => ({ ...prev, yearPeriod: e.target.value }))}
                                className="w-[180px] h-10 py-2 text-base text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-base font-semibold whitespace-nowrap">지정지청</span>
                            <Select
                                options={OFFICE_OPTIONS}
                                value={filters.designatedOffice}
                                onChange={(e) => setFilters(prev => ({ ...prev, designatedOffice: e.target.value }))}
                                className="w-[120px] h-10 py-2 text-base text-center"
                            />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-base font-semibold whitespace-nowrap">사업장명</span>
                            <Input
                                value={filters.businessName}
                                onChange={(e) => setFilters(prev => ({ ...prev, businessName: e.target.value }))}
                                onKeyDown={handleKeyDown}
                                className="w-[200px] h-10 py-2 text-base"
                                placeholder="명칭 (쉼표로 구분)"
                            />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-base font-semibold whitespace-nowrap">주소</span>
                            <Input
                                value={filters.address}
                                onChange={(e) => setFilters(prev => ({ ...prev, address: e.target.value }))}
                                onKeyDown={handleKeyDown}
                                className="w-[200px] h-10 py-2 text-base"
                                placeholder="주소 (쉼표로 구분)"
                            />
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="text-base font-semibold whitespace-nowrap">실시여부</span>
                            <Select
                                options={STATUS_OPTIONS}
                                value={filters.isRegistered}
                                onChange={(e) => setFilters(prev => ({ ...prev, isRegistered: e.target.value }))}
                                className="w-[140px] h-10 py-2 text-base text-center"
                            />
                        </div>
                        <Button onClick={handleSearch} variant="primary" className="h-10 px-6 ml-2 text-base shrink-0 whitespace-nowrap">
                            검색
                        </Button>
                        <div className="flex-1" />
                        <Button onClick={() => setIsAddModalOpen(true)} variant="secondary" className="h-10 px-4 mr-2 bg-white text-base shrink-0 whitespace-nowrap">
                            + 업체추가
                        </Button>
                        <Button onClick={() => setIsExcelModalOpen(true)} variant="success" className="h-10 px-4 mr-2 text-base shrink-0 whitespace-nowrap">
                            엑셀업로드
                        </Button>
                        <Button onClick={handleExcelDownload} variant="secondary" className="h-10 px-4 mr-2 text-base shrink-0 whitespace-nowrap">
                            엑셀다운로드
                        </Button>
                        <a href="/templates/measure_target_template.xlsx" download="측정대상사업장_등록양식.xlsx" target="_blank" rel="noopener noreferrer"
                            className="h-10 px-4 inline-flex items-center justify-center rounded-lg font-medium hover:bg-slate-100 border border-slate-200 text-slate-700 text-base shrink-0 whitespace-nowrap">
                            양식다운로드
                        </a>
                    </div>
                </Card>

                {/* Table Header Group (Title + Column Headers) */}
                <div className="bg-white border-b-0">
                    {/* Table Title & Count */}
                    <div className="flex items-center justify-between px-1 py-4 border border-slate-200 border-b-0 rounded-t-xl bg-white">
                        <h3 className="text-lg font-bold text-slate-800 ml-3">
                            측정 대상 사업장 목록
                            <span className="ml-2 text-sm font-medium text-slate-500">
                                ({filteredData.length}/{data.length})
                            </span>
                        </h3>
                        <div className="flex items-center gap-2 mr-3">
                            <span className="text-base font-semibold whitespace-nowrap">계획담당자 :</span>
                            <Select
                                options={MANAGER_OPTIONS}
                                value={filters.planManager}
                                onChange={(e) => setFilters(prev => ({ ...prev, planManager: e.target.value }))}
                                className="w-[120px] h-10 py-2 text-base text-center"
                            />
                        </div>
                    </div>

                    {/* Grid Header Row */}
                    <div className="bg-surface-50 font-medium text-sm text-slate-600 grid items-center text-center border border-slate-200" style={{ gridTemplateColumns: gridTemplateCols }}>
                        <div className="py-3">No</div>
                        <div className="py-3">실시여부</div>
                        <div className="py-3">국고</div>
                        <div className="py-3">계획담당</div>
                        <div className="py-3 px-2 text-left">사업장명</div>
                        <div className="py-3 px-2 text-left">소재지</div>
                        <div className="py-3">관할</div>
                        <div className="py-3">미수</div>
                        <div className="py-3">전회측정</div>
                        <div className="py-3">향후측정주기</div>
                        <div className="py-3">예정월</div>
                        <div className="py-3">예정일</div>
                        <div className="py-3">측정자</div>
                        <div className="py-3">확정일</div>
                        <div className="py-3">비고</div>
                        <div className="py-3">관리</div>
                    </div>
                </div>
            </div>

            {/* Main List (DIV Grid) - Rows Only */}
            <div className="w-full overflow-hidden rounded-b-xl border border-t-0 border-slate-200 shadow-sm bg-white">
                {/* Data Rows */}
                <div className="divide-y divide-slate-100">
                    {loading ? (
                        <div className="h-40 flex items-center justify-center"><LoadingSpinner /></div>
                    ) : filteredData.length === 0 ? (
                        <div className="h-40 flex items-center justify-center text-text-500">데이터가 없습니다.</div>
                    ) : (
                        filteredData.map((item, index) => (
                            <div key={`${item.code}-${index}`} className="group hover:bg-surface-50 grid items-center text-sm text-slate-700 py-1" style={{ gridTemplateColumns: gridTemplateCols }}>
                                <div className="text-center">{index + 1}</div>
                                <div className="text-center">
                                    <span className={`px-2 py-0.5 rounded text-xs ${item.is_registered_text === '실시' ? 'bg-green-100 text-green-700' :
                                        item.is_registered_text === '미실시' ? 'bg-yellow-100 text-yellow-700' :
                                            item.is_registered_text === '거래종료' ? 'bg-red-100 text-red-700' :
                                                'bg-gray-100'}`}>
                                        {item.is_registered_text}
                                    </span>
                                </div>
                                <div className="text-center text-xs">{item.national_support_status}</div>
                                <div className="text-center text-xs">{item.plan_manager}</div>
                                <div className="px-2 truncate font-medium" title={item.business_name}>{item.business_name}</div>
                                <div className="px-2 break-words text-xs leading-tight">{item.address}</div>
                                <div className="text-center text-xs">{toShortName(item.office_jurisdiction || "")}</div>
                                <div className="text-center">
                                    {item.unpaid_count > 0 && (<span className="text-red-600 font-bold text-xs">{item.unpaid_count}</span>)}
                                </div>
                                <div className="text-center text-xs">{item.previous_measurement_date}</div>
                                <div className="text-center text-xs font-medium text-blue-600">
                                    {formatCycle(item.future_measurement_period)}
                                </div>
                                <div className="text-center text-xs">{item.measurement_month ? `${item.measurement_month}` : '-'}</div>
                                <div className="text-center text-xs text-slate-500">
                                    {calculateScheduledDate(item.previous_measurement_date, item.future_measurement_period || 6)}
                                </div>
                                <div className="px-1">
                                    <select
                                        className="w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100"
                                        value={item.measurer_id || ""}
                                        onChange={(e) => handleMeasurerChange(item, e.target.value)}
                                    >
                                        <option value="">선택</option>
                                        {measurers.map(u => (
                                            <option key={u.id} value={u.id}>{u.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="px-1">
                                    <input
                                        type="date"
                                        className="w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100 bg-transparent text-center"
                                        defaultValue={item.measurement_date || ""}
                                        onBlur={(e) => {
                                            if (e.target.value !== item.measurement_date) {
                                                handleConfirmedDateChange(item, e.target.value);
                                            }
                                        }}
                                    />
                                </div>
                                <div className="px-1">
                                    <input
                                        type="text"
                                        className="w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100 px-2"
                                        defaultValue={item.notes || ""}
                                        onBlur={(e) => {
                                            if (e.target.value !== (item.notes || "")) {
                                                handleNotesChange(item, e.target.value);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.currentTarget.blur();
                                            }
                                        }}
                                    />
                                </div>
                                <div className="text-center">
                                    <button onClick={() => handleEditClick(item)} className="p-1 hover:bg-surface-200 rounded text-text-500">✎</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Modals ... */}
            <Modal isOpen={isExcelModalOpen} onClose={() => setIsExcelModalOpen(false)} title="측정 대상 사업장 엑셀 업로드">
                <ExcelUpload
                    apiEndpoint="/api/businesses/upload"
                    onSuccess={() => { fetchData(); setTimeout(() => setIsExcelModalOpen(false), 1500); }}
                    fixedFileType="measurement-business"
                    hideAutoSync={true} defaultAutoSync={true}
                />
            </Modal>

            <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="사업장 정보 수정">
                <div className="space-y-4 p-4 min-w-[400px]">
                    <div>
                        <label className="block text-sm font-medium mb-1">비고</label>
                        <Input value={editForm.notes || ""} onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">계획담당자</label>
                        <Select options={PLAN_MANAGER_EDIT_OPTIONS} value={editForm.plan_manager || ""} onChange={(e) => setEditForm(prev => ({ ...prev, plan_manager: e.target.value }))} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">금회예정일</label>
                        <Input type="date" value={editForm.future_measurement_date || ""} onChange={(e) => setEditForm(prev => ({ ...prev, future_measurement_date: e.target.value }))} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">실시여부</label>
                        <Select
                            options={STATUS_OPTIONS}
                            value={editForm.is_registered_text || "미실시"}
                            onChange={(e) => setEditForm(prev => ({ ...prev, is_registered_text: e.target.value }))}
                        />
                        <p className="text-xs text-text-500 mt-1">* '거래종료' 선택 시 자동 계산(예비조사 연동)보다 우선 적용됩니다.</p>
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                        <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>취소</Button>
                        <Button variant="primary" onClick={handleSaveEdit}>저장</Button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="업체 추가">
                <div className="p-4">
                    <p className="text-text-500 mb-4">새로운 측정 대상 사업장을 추가하시겠습니까?</p>
                    <p className="text-sm text-yellow-600 mb-4">* 현재는 엑셀 업로드를 권장합니다.</p>
                    <Button onClick={() => setIsAddModalOpen(false)} variant="secondary">닫기</Button>
                </div>
            </Modal>
        </div >
    );
};
