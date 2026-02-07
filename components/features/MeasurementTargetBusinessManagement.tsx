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
    business_number: string | null; // 사업자등록번호
    business_category: string | null; // 업종
    address: string | null;
    total_employees: number | null; // 근로자수
    office_jurisdiction: string | null; // 관할청
    designated_office: string | null; // 지정지청
    isRegistered: boolean;
    is_registered: string | null; // DB 원본
    is_registered_text: string | null; // '실시', '미실시', '거래종료'
    national_support_status: string | null; // 국고
    plan_manager: string | null; // 계획담당
    manager_name: string | null; // 업체담당
    manager_mobile: string | null;
    manager_phone: string | null; // 담당자 직통전화/전화번호
    management_status: string | null; // 관리상태
    phone: string | null; // 대표전화? (기존 코드에 있음)
    unpaid_count: number;
    national_unpaid_count?: number; // 국고 미수
    unpaid_details: any[];
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

// Status Options Update
const STATUS_OPTIONS = [
    { value: "전체", label: "전체" },
    { value: "확정", label: "확정" }, // 실시 -> 확정
    { value: "미확정", label: "미확정" }, // 미실시 -> 미확정
    { value: "종료", label: "종료" } // 거래종료 -> 종료
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
        options.push({ value: `${y}-상반기(수시)`, label: `${y}년 상반기(수시)` });
        options.push({ value: `${y}-하반기`, label: `${y}년 하반기` });
        options.push({ value: `${y}-하반기(수시)`, label: `${y}년 하반기(수시)` });
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
        confirmedDate: "",
    });

    // Load Filters
    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                // 모든 필터 상태 복원 (사용자 요청: 최종 선택 값 유지)
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

    // Unpaid Details Modal State
    const [isUnpaidModalOpen, setIsUnpaidModalOpen] = useState(false);
    const [selectedUnpaidDetails, setSelectedUnpaidDetails] = useState<any[]>([]);
    const [selectedUnpaidBusinessName, setSelectedUnpaidBusinessName] = useState("");

    const [editingItem, setEditingItem] = useState<BusinessEntry | null>(null);
    const [editForm, setEditForm] = useState<Partial<BusinessEntry>>({});
    const [addForm, setAddForm] = useState<Partial<BusinessEntry>>({
        year: new Date().getFullYear(),
        period: (new Date().getMonth() + 1) <= 6 ? "상반기" : "하반기"
    });

    const handleAddSubmit = async () => {
        try {
            const response = await fetch("/api/businesses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(addForm)
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "등록에 실패했습니다.");
            }

            alert("성공적으로 등록되었습니다.");
            setIsAddModalOpen(false);
            setAddForm({
                year: new Date().getFullYear(),
                period: (new Date().getMonth() + 1) <= 6 ? "상반기" : "하반기",
                code: "",
                business_name: "",
                address: "",
                plan_manager: ""
            });
            fetchData();
        } catch (error) {
            console.error("Registration error:", error);
            alert(`등록 중 오류가 발생했습니다.\n${error instanceof Error ? error.message : String(error)}`);
        }
    };

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
                    terms.some(term => {
                        // 공백 제거 후 비교 (유연한 검색)
                        const normalizedTerm = term.replace(/\s+/g, "").toLowerCase();
                        const normalizedName = (item.business_name || "").replace(/\s+/g, "").toLowerCase();
                        return normalizedName.includes(normalizedTerm);
                    })
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
            result = result.filter(item => {
                const status = item.is_registered_text;
                if (filters.isRegistered === '확정') {
                    return status === '확정' || status === '실시';
                }
                if (filters.isRegistered === '미확정') {
                    return status === '미확정' || status === '미실시' || !status;
                }
                if (filters.isRegistered === '종료') {
                    return status === '종료' || status === '거래종료';
                }
                return status === filters.isRegistered;
            });
        }

        if (filters.planManager) {
            result = result.filter(item => item.plan_manager === filters.planManager);
        }

        if (filters.confirmedDate) {
            result = result.filter(item => item.measurement_date === filters.confirmedDate);
        }

        // Custom Sort: 1. Status (Unconfirmed > Confirmed > Terminated), 2. Month (Asc)
        result.sort((a, b) => {
            const getStatusPriority = (status: string | null) => {
                if (status === '미확정' || status === '미실시' || !status) return 1;
                if (status === '확정' || status === '실시') return 2;
                if (status === '종료' || status === '거래종료') return 3;
                return 4;
            };

            const priorityA = getStatusPriority(a.is_registered_text);
            const priorityB = getStatusPriority(b.is_registered_text);

            if (priorityA !== priorityB) return priorityA - priorityB;

            // Secondary: Month Ascending
            const monthA = a.measurement_month ? parseInt(String(a.measurement_month)) : 99;
            const monthB = b.measurement_month ? parseInt(String(b.measurement_month)) : 99;
            return monthA - monthB;
        });

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
        // editForm에서 변경된 내용만 추출하거나 전체를 보내서 sanitize 처리
        // 여기서는 editForm 전체를 넘겨서 saveChanges 내부에서 filtering 함
        saveChanges(editingItem.code, editForm);
        setIsEditModalOpen(false);
    };

    const saveChanges = async (code: string, updates: Partial<BusinessEntry>) => {
        try {
            const [year, period] = filters.yearPeriod.split("-");

            // DB 컬럼 매핑 및 클렌징
            const sanitizeUpdates = (raw: Partial<BusinessEntry>) => {
                // DB에 실제로 존재하는 컬럼만 허용
                const validColumns = [
                    'business_name', 'business_category', 'address',
                    'office_jurisdiction', 'is_registered', 'national_support_status', 'plan_manager',
                    'manager_name', 'manager_mobile', 'phone', // manager_phone -> phone
                    'management_status', 'notes', 'measurement_date', 'future_measurement_period',
                    'future_measurement_date', 'measurer_id', 'period' // Added period
                ];

                const sanitized: any = {};

                // 매핑 처리
                if (raw.is_registered_text !== undefined) sanitized.is_registered = raw.is_registered_text;
                if (raw.designated_office !== undefined) sanitized.office_jurisdiction = raw.designated_office;
                if (raw.manager_phone !== undefined) sanitized.phone = raw.manager_phone; // UI manager_phone -> DB phone

                // 빈 문자열인 날짜 필드는 null로변환
                if (raw.measurement_date === "") sanitized.measurement_date = null;
                if (raw.future_measurement_date === "") sanitized.future_measurement_date = null;

                // 직접 매핑된 필드 및 기타 허용 필드 복사
                Object.keys(raw).forEach(key => {
                    if (validColumns.includes(key) && sanitized[key] === undefined) {
                        // 날짜 필드가 아니고 빈 문자열이 아니거나, 이미 처리된 필드가 아닐 경우값 복사
                        // 위에서 처리한 날짜 필드는 건너뜀 (이미 sanitized에 들어갔으므로 undefined check로 걸러짐)
                        sanitized[key] = (raw as any)[key];
                    }
                });

                // 날짜 필드들이 빈 문자열로 넘어왔을 경우 null로 처리되었는지 확인 및 원래 로직 보강
                // 위 로직에서 이미 sanitized[key]가 설정되면 아래 loop에서 덮어쓰지 않으므로 안전함.
                // 다만, raw[key]가 ""일 때 loop에서 sanitized[key]에 ""가 들어가는 것을 방지해야 함.
                if (sanitized.measurement_date === "") sanitized.measurement_date = null;
                if (sanitized.future_measurement_date === "") sanitized.future_measurement_date = null;

                return sanitized;
            };

            const cleanUpdates = sanitizeUpdates(updates);

            const response = await fetch("/api/businesses", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    code: code,
                    year: parseInt(year),
                    period: period,
                    updates: cleanUpdates
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.details || errData.error || "Failed to update");
            }

            // Optimistic Update
            // UI 반영을 위해 매핑된 필드도 로컬 상태에는 반영해야 함
            const optimisticUpdates = { ...updates };
            if (cleanUpdates.is_registered) {
                optimisticUpdates.is_registered = cleanUpdates.is_registered;
                optimisticUpdates.is_registered_text = cleanUpdates.is_registered;
            }
            if (cleanUpdates.office_jurisdiction) {
                optimisticUpdates.office_jurisdiction = cleanUpdates.office_jurisdiction;
                optimisticUpdates.designated_office = cleanUpdates.office_jurisdiction;
            }

            setData(prev => prev.map(item => item.code === code ? { ...item, ...optimisticUpdates } : item));
        } catch (error) {
            console.error("Update error:", error);
            alert(`수정 중 오류가 발생했습니다.\n${error instanceof Error ? error.message : String(error)}`);
            fetchData(); // Revert on error
        }
    };

    const handleMeasurerChange = (item: BusinessEntry, newMeasurerId: string) => {
        const measurerId = newMeasurerId ? parseInt(newMeasurerId) : null;
        saveChanges(item.code, { measurer_id: measurerId });
    };

    const handleConfirmedDateChange = (item: BusinessEntry, newDate: string) => {
        const updates: Partial<BusinessEntry> = { measurement_date: newDate || null };
        if (newDate) {
            updates.is_registered = "확정";
            updates.is_registered_text = "확정";
        }
        saveChanges(item.code, updates);
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
            "계획진행": item.is_registered_text === '실시' ? '확정' : item.is_registered_text === '미실시' ? '미확정' : item.is_registered_text,
            "국고결과": item.national_support_status,
            "계획담당": item.plan_manager,
            "보고서 담당": item.measurer_id ? measurerMap.get(item.measurer_id) || "" : "",
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

    const handleDelete = async () => {
        const targetId = (editForm as any).id;
        if (!targetId) return;

        if (!window.confirm("정말로 삭제하시겠습니까?\n삭제된 데이터는 복구할 수 없습니다.")) {
            return;
        }

        try {
            const res = await fetch(`/api/businesses?id=${targetId}`, {
                method: "DELETE"
            });

            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || "삭제에 실패했습니다.");
            }

            alert("삭제되었습니다.");
            setIsEditModalOpen(false);
            fetchData(); // Refresh list
        } catch (e: any) {
            console.error("Delete Error:", e);
            alert(`오류 발생: ${e.message}`);
        }
    };

    // Grid Column Template
    // 17 Columns: No(50), 주기(80), 실시여부(80), 국고(60), 계획담당(70), 사업장명(minmax(180,1fr)), 소재지(minmax(250,2fr)), 관할(70), 미수(50), 전회측정(90), 향후측정주기(100), 예정월(60), 예정일(90), 보고서 담당(100), 확정일(90), 비고(100), 관리(50)
    const gridTemplateCols = "50px 80px 80px 60px 70px minmax(180px, 1fr) minmax(250px, 2fr) 70px 50px 90px 100px 60px 90px 100px 90px 100px 50px";

    return (
        <div className="p-4 min-w-[1600px]">
            {/* Sticky Container for Filter & Table Header */}
            <div className="sticky top-16 lg:top-[113px] z-40 space-y-4 bg-gray-50/95 backdrop-blur">
                <Card className="p-4 bg-white shadow-sm border-surface-200">
                    <div className="flex items-center justify-between gap-4 flex-nowrap overflow-x-auto scrollbar-hide p-1">
                        {/* Filters Group */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">측정년도/주기</span>
                                <Select
                                    options={YEAR_PERIOD_OPTIONS}
                                    value={filters.yearPeriod}
                                    onChange={(e) => setFilters(prev => ({ ...prev, yearPeriod: e.target.value }))}
                                    className="w-[160px] h-9 py-1 text-sm text-center"
                                />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">지정지청</span>
                                <Select
                                    options={OFFICE_OPTIONS}
                                    value={filters.designatedOffice}
                                    onChange={(e) => setFilters(prev => ({ ...prev, designatedOffice: e.target.value }))}
                                    className="w-[100px] h-9 py-1 text-sm text-center"
                                />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">사업장명</span>
                                <Input
                                    value={filters.businessName}
                                    onChange={(e) => setFilters(prev => ({ ...prev, businessName: e.target.value }))}
                                    onKeyDown={handleKeyDown}
                                    className="w-[150px] h-9 py-1 text-sm placeholder:text-xs"
                                    placeholder="명칭 (쉼표)"
                                />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">주소</span>
                                <Input
                                    value={filters.address}
                                    onChange={(e) => setFilters(prev => ({ ...prev, address: e.target.value }))}
                                    onKeyDown={handleKeyDown}
                                    className="w-[150px] h-9 py-1 text-sm placeholder:text-xs"
                                    placeholder="주소 (쉼표)"
                                />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">계획진행</span>
                                <Select
                                    options={STATUS_OPTIONS}
                                    value={filters.isRegistered}
                                    onChange={(e) => setFilters(prev => ({ ...prev, isRegistered: e.target.value }))}
                                    className="w-[110px] h-9 py-1 text-sm text-center"
                                />
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">확정일</span>
                                <Input
                                    type="date"
                                    value={filters.confirmedDate || ""}
                                    onChange={(e) => setFilters(prev => ({ ...prev, confirmedDate: e.target.value }))}
                                    className="w-[130px] h-9 py-1 text-sm text-center"
                                />
                                {filters.confirmedDate && (
                                    <button
                                        onClick={() => setFilters(prev => ({ ...prev, confirmedDate: "" }))}
                                        className="text-blue-400 hover:text-blue-600 focus:outline-none -ml-1"
                                        title="날짜 초기화"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Buttons Group */}
                        <div className="flex items-center gap-2 shrink-0">
                            <Button onClick={handleSearch} variant="primary" className="h-9 px-4 text-sm font-medium whitespace-nowrap">
                                조회
                            </Button>
                            <Button onClick={handleExcelDownload} variant="secondary" className="h-9 px-3 text-sm font-medium whitespace-nowrap bg-white border-slate-300 text-slate-700 hover:bg-slate-50">
                                엑셀 다운로드
                            </Button>
                            <Button onClick={() => setIsExcelModalOpen(true)} variant="success" className="h-9 px-3 text-sm font-medium whitespace-nowrap">
                                엑셀 업로드
                            </Button>
                            <Button onClick={() => setIsAddModalOpen(true)} variant="secondary" className="h-9 px-3 text-sm font-medium whitespace-nowrap">
                                신규등록
                            </Button>
                            <a href="/templates/measure_target_template.xlsx" download="측정대상사업장_등록양식.xlsx" target="_blank" rel="noopener noreferrer"
                                className="h-9 px-3 inline-flex items-center justify-center rounded-lg font-medium hover:bg-slate-100 border border-slate-200 text-slate-700 text-sm whitespace-nowrap ml-2" title="양식 다운로드">
                                <span className="text-lg leading-none">⬇</span>
                            </a>
                        </div>
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
                        <div className="py-3">주기</div>
                        <div className="py-3">계획진행</div>
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
                        <div className="py-3">보고서 담당</div>
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
                                <div className={`text-center text-xs ${item.period.includes("(수시)") ? "text-red-600 font-bold" : ""}`}>
                                    {item.period}
                                </div>
                                <div className="text-center">
                                    <select
                                        className={`w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100 text-center cursor-pointer ${(item.is_registered_text === '확정' || item.is_registered_text === '실시') ? 'bg-green-100 text-green-700' :
                                            (item.is_registered_text === '미확정' || item.is_registered_text === '미실시') ? 'bg-yellow-100 text-yellow-800' :
                                                item.is_registered_text === '종료' ? 'bg-red-100 text-red-700' :
                                                    'bg-gray-100'
                                            }`}
                                        value={
                                            item.is_registered_text === '실시' ? '확정' :
                                                item.is_registered_text === '미실시' ? '미확정' :
                                                    item.is_registered_text === '거래종료' ? '종료' :
                                                        item.is_registered_text || '미확정'
                                        }
                                        onChange={(e) => {
                                            const newVal = e.target.value;
                                            const updates: Partial<BusinessEntry> = {
                                                is_registered: newVal,
                                                is_registered_text: newVal
                                            };
                                            saveChanges(item.code, updates);
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <option value="미확정" className="bg-white text-black">미확정</option>
                                        <option value="확정" className="bg-white text-black">확정</option>
                                        <option value="종료" className="bg-white text-black">종료</option>
                                    </select>
                                </div>
                                <div className="text-center text-xs">{item.national_support_status}</div>
                                <div className="text-center text-xs">{item.plan_manager}</div>
                                <div className="px-2 truncate font-medium" title={item.business_name}>{item.business_name}</div>
                                <div className="px-2 break-words text-xs leading-tight">{item.address}</div>
                                <div className="text-center text-xs">{toShortName(item.office_jurisdiction || "")}</div>
                                <div className="text-center">
                                    {(() => {
                                        const businessCount = item.unpaid_count || 0;
                                        const nationalCount = item.national_unpaid_count || 0;

                                        if (businessCount === 0 && nationalCount === 0) return null;

                                        let textColor = "text-black";
                                        if (businessCount > 0) textColor = "text-red-600 font-bold underline";
                                        else if (nationalCount > 0) textColor = "text-blue-600 font-bold underline";

                                        return (
                                            <span
                                                className={`text-xs cursor-pointer ${textColor}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedUnpaidBusinessName(item.business_name);
                                                    setSelectedUnpaidDetails(item.unpaid_details);
                                                    setIsUnpaidModalOpen(true);
                                                }}
                                                title={`사업장 미수: ${businessCount}건 / 국고 미수: ${nationalCount}건`}
                                            >
                                                {businessCount > 0 ? `${businessCount}` : `(국)${nationalCount}`}
                                            </span>
                                        );
                                    })()}
                                </div>
                                <div className="text-center text-xs">{item.previous_measurement_date}</div>
                                <div className="text-center text-xs font-medium text-blue-600">
                                    {formatCycle(item.future_measurement_period)}
                                </div>
                                <div className="text-center text-xs">{item.measurement_month ? `${item.measurement_month}` : '-'}</div>
                                <div className="text-center text-xs text-slate-500">
                                    {item.future_measurement_date || calculateScheduledDate(item.previous_measurement_date, item.future_measurement_period || 6)}
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
                                                const newVal = e.target.value;
                                                const newStatus = newVal ? '확정' : '미확정';

                                                // Optimistic Update
                                                const updatedItem = {
                                                    ...item,
                                                    measurement_date: newVal,
                                                    is_registered: newStatus,
                                                    is_registered_text: newStatus
                                                };
                                                setFilteredData(prev => prev.map(p => p.code === item.code ? updatedItem : p));

                                                saveChanges(item.code, {
                                                    measurement_date: newVal,
                                                    is_registered: newStatus,
                                                    is_registered_text: newStatus
                                                });
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

            <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title="사업장 상세 정보 수정" size="lg">
                <div className="p-6">
                    {/* 섹션 1: 기본 정보 */}
                    <div className="mb-6">
                        <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">기본 정보</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">측정년도</label>
                                <Input value={editForm.year || ""} disabled className="bg-slate-100 text-slate-500" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">측정주기</label>
                                <Select
                                    options={[
                                        { value: "상반기", label: "상반기" },
                                        { value: "상반기(수시)", label: "상반기(수시)" },
                                        { value: "하반기", label: "하반기" },
                                        { value: "하반기(수시)", label: "하반기(수시)" }
                                    ]}
                                    value={editForm.period || ""}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, period: e.target.value }))}
                                    className={`w-full ${editForm.period?.includes("(수시)") ? "text-red-500 font-bold" : ""}`}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">사업장명</label>
                                <Input value={editForm.business_name || ""} onChange={(e) => setEditForm(prev => ({ ...prev, business_name: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">사업자등록번호</label>
                                <Input value={editForm.business_number || ""} onChange={(e) => setEditForm(prev => ({ ...prev, business_number: e.target.value }))} />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-sm font-medium mb-1 text-slate-700">소재지</label>
                                <Input value={editForm.address || ""} onChange={(e) => setEditForm(prev => ({ ...prev, address: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">업종</label>
                                <Input value={editForm.business_category || ""} onChange={(e) => setEditForm(prev => ({ ...prev, business_category: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">근로자수</label>
                                <Input type="number" value={editForm.total_employees || ""} onChange={(e) => setEditForm(prev => ({ ...prev, total_employees: e.target.value ? parseInt(e.target.value) : null }))} />
                            </div>
                        </div>
                    </div>

                    {/* 섹션 2: 담당자 정보 */}
                    <div className="mb-6">
                        <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">담당자 정보</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">담당자명</label>
                                <Input value={editForm.manager_name || ""} onChange={(e) => setEditForm(prev => ({ ...prev, manager_name: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">휴대전화</label>
                                <Input value={editForm.manager_mobile || ""} onChange={(e) => setEditForm(prev => ({ ...prev, manager_mobile: e.target.value }))} placeholder="010-0000-0000" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">유선전화</label>
                                <Input value={editForm.manager_phone || ""} onChange={(e) => setEditForm(prev => ({ ...prev, manager_phone: e.target.value }))} />
                            </div>
                        </div>
                    </div>

                    {/* 섹션 3: 관리 정보 */}
                    <div className="mb-6">
                        <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">관리 정보</h4>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">계획담당</label>
                                <Select options={PLAN_MANAGER_EDIT_OPTIONS} value={editForm.plan_manager || ""} onChange={(e) => setEditForm(prev => ({ ...prev, plan_manager: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">지정지청</label>
                                <Select options={OFFICE_OPTIONS} value={editForm.designated_office || ""} onChange={(e) => setEditForm(prev => ({ ...prev, designated_office: e.target.value }))} />
                            </div>
                        </div>
                    </div>

                    {/* 섹션 4: 측정 정보 */}
                    <div className="mb-6 bg-slate-50 p-4 rounded-lg">
                        <h4 className="text-md font-bold text-slate-800 pb-2 mb-3">측정 정보</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="col-span-2">
                                <label className="block text-sm font-medium mb-1 text-slate-700">계획진행</label>
                                <div className="flex items-center gap-2">
                                    <select
                                        className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm h-10 px-3
                                            ${editForm.is_registered_text === '확정' ? 'bg-green-100 text-green-700' :
                                                editForm.is_registered_text === '미확정' ? 'bg-yellow-100 text-yellow-800' :
                                                    editForm.is_registered_text === '종료' ? 'bg-red-100 text-red-700' : 'bg-white'}`}
                                        value={editForm.is_registered_text || "미확정"}
                                        onChange={(e) => setEditForm(prev => ({ ...prev, is_registered_text: e.target.value }))}
                                    >
                                        <option value="확정" className="bg-white text-black">확정</option>
                                        <option value="미확정" className="bg-white text-black">미확정</option>
                                        <option value="종료" className="bg-white text-black">종료</option>
                                    </select>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">* &apos;종료&apos; 선택 시 자동 계산보다 우선 적용됩니다.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">국고지원여부</label>
                                <Input value={editForm.national_support_status || ""} onChange={(e) => setEditForm(prev => ({ ...prev, national_support_status: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">향후 측정주기 (개월)</label>
                                <Input type="number" value={editForm.future_measurement_period || ""} onChange={(e) => setEditForm(prev => ({ ...prev, future_measurement_period: e.target.value ? parseInt(e.target.value) : null }))} placeholder="예: 6, 12" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">금회예정일</label>
                                <Input type="date" value={editForm.future_measurement_date || ""} onChange={(e) => setEditForm(prev => ({ ...prev, future_measurement_date: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">확정일</label>
                                <Input type="date" value={editForm.measurement_date || ""} onChange={(e) => {
                                    const val = e.target.value;
                                    setEditForm(prev => ({
                                        ...prev,
                                        measurement_date: val,
                                        is_registered_text: val ? '확정' : '미확정'
                                    }));
                                }} />
                            </div>
                        </div>
                    </div>

                    {/* 섹션 5: 비고 */}
                    <div>
                        <label className="block text-sm font-medium mb-1 text-slate-700">비고</label>
                        <textarea
                            className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                            rows={3}
                            value={editForm.notes || ""}
                            onChange={(e) => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                        />
                    </div>

                    <div className="flex justify-between items-center mt-8 pt-4 border-t border-slate-200">
                        <Button
                            className="bg-red-600 hover:bg-red-700 text-white"
                            onClick={handleDelete}
                        >
                            삭제
                        </Button>
                        <div className="flex gap-2">
                            <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>취소</Button>
                            <Button variant="primary" onClick={handleSaveEdit}>저장</Button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* New Registration Modal */}
            <Modal isOpen={isAddModalOpen} onClose={() => setIsAddModalOpen(false)} title="신규 사업장 등록" size="lg">
                <form onSubmit={(e) => {
                    e.preventDefault();
                    // Basic validation
                    if (!addForm.code || !addForm.business_name) {
                        alert("사업장 코드와 사업장명은 필수입니다.");
                        return;
                    }
                    handleAddSubmit();
                }} className="p-6">
                    <div className="space-y-6">
                        {/* 1. Essential Info */}
                        <div>
                            <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">필수 정보</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">
                                        측정 년도 <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        type="number"
                                        value={addForm.year || currentYear}
                                        onChange={(e) => setAddForm(prev => ({ ...prev, year: parseInt(e.target.value) }))}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">
                                        측정 주기 <span className="text-red-500">*</span>
                                    </label>
                                    <Select
                                        options={[
                                            { value: "상반기", label: "상반기" },
                                            { value: "상반기(수시)", label: "상반기(수시)" },
                                            { value: "하반기", label: "하반기" },
                                            { value: "하반기(수시)", label: "하반기(수시)" }
                                        ]}
                                        value={addForm.period || initialPeriod}
                                        onChange={(e) => setAddForm(prev => ({ ...prev, period: e.target.value }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">
                                        사업장 코드 <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        value={addForm.code || ""}
                                        onChange={(e) => setAddForm(prev => ({ ...prev, code: e.target.value.toUpperCase() }))}
                                        placeholder="예: H0001 (중복 불가)"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">
                                        사업장명 <span className="text-red-500">*</span>
                                    </label>
                                    <Input
                                        value={addForm.business_name || ""}
                                        onChange={(e) => setAddForm(prev => ({ ...prev, business_name: e.target.value }))}
                                        placeholder="사업장명 입력"
                                        required
                                    />
                                </div>
                            </div>
                        </div>

                        {/* 2. Optional Info */}
                        <div>
                            <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">추가 정보 (선택)</h4>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-2">
                                    <label className="block text-sm font-medium mb-1 text-slate-700">소재지</label>
                                    <Input
                                        value={addForm.address || ""}
                                        onChange={(e) => setAddForm(prev => ({ ...prev, address: e.target.value }))}
                                        placeholder="주소 입력"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">계획담당</label>
                                    <Select
                                        options={PLAN_MANAGER_EDIT_OPTIONS}
                                        value={addForm.plan_manager || ""}
                                        onChange={(e) => setAddForm(prev => ({ ...prev, plan_manager: e.target.value }))}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                            <Button variant="secondary" onClick={() => setIsAddModalOpen(false)} type="button">취소</Button>
                            <Button variant="primary" type="submit">등록</Button>
                        </div>
                    </div>
                </form>
            </Modal>

            {/* Unpaid Details Modal */}
            <Modal
                isOpen={isUnpaidModalOpen}
                onClose={() => setIsUnpaidModalOpen(false)}
                title={`미수 내역 (${selectedUnpaidBusinessName})`}
            >
                <div className="bg-white p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                    <table className="w-full text-sm text-left border-collapse">
                        <thead className="bg-gray-100 text-gray-700">
                            <tr>
                                <th className="p-2 border">년도</th>
                                <th className="p-2 border">주기</th>
                                <th className="p-2 border">계산서 발행일</th>
                                <th className="p-2 border text-right">미수금액(사업장)</th>
                                <th className="p-2 border text-right">미수금액(국고)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {selectedUnpaidDetails.length > 0 ? (
                                selectedUnpaidDetails.map((detail: any, idx: number) => (
                                    <tr key={idx} className="border-b hover:bg-gray-50">
                                        <td className="p-2 border text-center">{detail.year}</td>
                                        <td className="p-2 border text-center">{detail.period}</td>
                                        <td className="p-2 border text-center">{detail.invoiceDate || "-"}</td>
                                        <td className="p-2 border text-right font-medium text-red-600">
                                            {detail.unpaidBusiness ? detail.unpaidBusiness.toLocaleString() + "원" : "-"}
                                        </td>
                                        <td className="p-2 border text-right font-medium text-blue-600">
                                            {detail.unpaidNational ? detail.unpaidNational.toLocaleString() + "원" : "-"}
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} className="p-4 text-center text-gray-500">미수 내역이 없습니다.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="bg-white p-4 rounded-b-lg border-t flex justify-end">
                    <Button onClick={() => setIsUnpaidModalOpen(false)} variant="secondary">닫기</Button>
                </div>
            </Modal>
        </div >
    );
};
