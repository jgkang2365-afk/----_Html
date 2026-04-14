"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import { ExcelUpload } from "@/components/features/ExcelUpload";
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
} from "@/components/ui/Table";
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
    measurement_end_date: string | null; // 다중일자 종료일
    daily_staff: any | null; // 일자별 배정 정보 (JSONB)
    notes: string | null;
    updated_at?: string;
    measurement_month?: string | null;
    measurer_id?: number | null; // 측정자 ID
    collaborators?: string | null; // 협력자 목록 (쉼표 구분)
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
    { value: "실시", label: "실시" },
    { value: "미실시", label: "미실시" },
    { value: "거래종료", label: "거래종료" }
];

const MANAGER_OPTIONS = [
    { value: "", label: "전체" },
    { value: "한기문", label: "한기문" },
    { value: "이주형", label: "이주형" },
    { value: "강종구", label: "강종구" },
    { value: "고유빈", label: "고유빈" }
];

const PLAN_MANAGER_EDIT_OPTIONS = [
    { value: "", label: "선택" },
    { value: "한기문", label: "한기문" },
    { value: "이주형", label: "이주형" },
    { value: "강종구", label: "강종구" },
    { value: "고유빈", label: "고유빈" }
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
    const [businessCategories, setBusinessCategories] = useState<{ value: string; label: string }[]>([]);

    // Initial Filter Setup
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const initialPeriod = currentMonth <= 6 ? "상반기" : "하반기";

    const [filters, setFilters] = useState({
        yearPeriod: `${currentYear}-${initialPeriod}`, // Combined
        designatedOffice: "",
        businessCategory: "",
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

    // Fetch Business Categories
    useEffect(() => {
        const fetchBusinessCategories = async () => {
            try {
                const response = await fetch("/api/business-categories");
                if (response.ok) {
                    const data = await response.json();
                    const categories = (data.categories || []).map((cat: { id: number; name: string }) => ({
                        value: cat.name,
                        label: cat.name,
                    }));
                    setBusinessCategories([{ value: "", label: "전체" }, ...categories]);
                }
            } catch (err) {
                console.error("업종분류 목록 조회 오류:", err);
            }
        };
        fetchBusinessCategories();
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

        if (filters.businessCategory) {
            result = result.filter(item => item.business_category === filters.businessCategory);
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
                if (filters.isRegistered === '실시') {
                    return status === '실시' || status === '확정';
                }
                if (filters.isRegistered === '미실시') {
                    return status === '미실시' || status === '미확정' || !status;
                }
                if (filters.isRegistered === '거래종료') {
                    return status === '거래종료' || status === '종료' || status === '거래 종료';
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
                if (status === '미실시' || status === '미확정' || !status) return 1;
                if (status === '실시' || status === '확정') return 2;
                if (status === '거래종료' || status === '종료' || status === '거래 종료') return 3;
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
        
        // 1일 측정인 경우 보고서 담당자를 측정자에 강제 포함 (데이터 정합성 유지)
        let initialForm = { ...item };
        const totalDays = item.daily_staff?.length || 1;
        
        if (totalDays === 1 && item.measurer_id) {
            const measurerName = measurers.find(m => m.id === item.measurer_id)?.name;
            if (measurerName) {
                if (!item.daily_staff || item.daily_staff.length === 0) {
                    // 단일 일자 모드
                    const collabs = item.collaborators ? item.collaborators.split(",").map(s => s.trim()).filter(Boolean) : [];
                    if (!collabs.includes(measurerName)) {
                        collabs.push(measurerName);
                        initialForm.collaborators = collabs.join(",");
                    }
                } else {
                    // 다중 일자 UI지만 1일인 경우
                    const entry = item.daily_staff[0];
                    let collabs = entry.collaborators || [];
                    if (!collabs.includes(measurerName)) {
                        const newDailyStaff = [...item.daily_staff];
                        newDailyStaff[0] = { ...entry, collaborators: [...collabs, measurerName] };
                        initialForm.daily_staff = newDailyStaff;
                    }
                }
            }
        }
        
        setEditForm(initialForm);
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
        const [year, period] = filters.yearPeriod.split("-");
        const previousData = [...data]; // For rollback

        try {
            // DB 컬럼 매핑 및 클렌징
            const sanitizeUpdates = (raw: Partial<BusinessEntry>) => {
                const validColumns = [
                    'business_name', 'business_category', 'address',
                    'office_jurisdiction', 'is_registered', 'national_support_status', 'plan_manager',
                    'manager_name', 'manager_mobile', 'phone',
                    'management_status', 'notes', 'measurement_date', 'measurement_end_date', 'future_measurement_period',
                    'future_measurement_date', 'measurer_id', 'period', 'collaborators', 'daily_staff'
                ];

                const sanitized: any = {};

                // UI '실시' -> DB '실시'
                if (raw.is_registered_text !== undefined) {
                    sanitized.is_registered = (raw.is_registered_text === '확정' || raw.is_registered_text === '실시') ? '실시' : 
                                             (raw.is_registered_text === '미확정' || raw.is_registered_text === '미실시') ? '미실시' :
                                             (raw.is_registered_text === '종료' || raw.is_registered_text === '거래종료' || raw.is_registered_text === '거래 종료') ? '거래종료' :
                                             raw.is_registered_text;
                }

                if (raw.designated_office !== undefined) sanitized.office_jurisdiction = raw.designated_office;
                if (raw.manager_phone !== undefined) sanitized.phone = raw.manager_phone;

                if (raw.measurement_date === "") sanitized.measurement_date = null;
                if (raw.future_measurement_date === "") sanitized.future_measurement_date = null;

                Object.keys(raw).forEach(key => {
                    if (validColumns.includes(key) && sanitized[key] === undefined) {
                        sanitized[key] = (raw as any)[key];
                    }
                });

                return sanitized;
            };

            const cleanUpdates = sanitizeUpdates(updates);

            // 1. Optimistic Update (UI 먼저 반영)
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

            // 2. API Call
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

        } catch (error) {
            console.error("Update error:", error);
            alert(`수정 중 오류가 발생했습니다.\n${error instanceof Error ? error.message : String(error)}`);
            setData(previousData); // Rollback to previous data
        }
    };

    const handleMeasurerChange = (item: BusinessEntry, newMeasurerId: string) => {
        const measurerId = newMeasurerId ? parseInt(newMeasurerId) : null;
        saveChanges(item.code, { measurer_id: measurerId });
    };

    const handleConfirmedDateChange = (item: BusinessEntry, newDate: string) => {
        const updates: Partial<BusinessEntry> = { measurement_date: newDate || null };
        if (newDate) {
            updates.is_registered = "실시";
            updates.is_registered_text = "실시";
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
            "지정지청": item.designated_office || toShortName(item.office_jurisdiction || ""),
            "사업장명": item.business_name,
            "소재지": item.address,
            "실시여부": item.is_registered_text === '확정' || item.is_registered_text === '실시' ? '실시' : item.is_registered_text === '미확정' || item.is_registered_text === '미실시' ? '미실시' : item.is_registered_text === '종료' || item.is_registered_text === '거래종료' ? '거래종료' : item.is_registered_text || '미실시',
            "국고결과": item.national_support_status,
            "계획담당": item.plan_manager,
            "업종분류": item.business_category,
            "담당자명": item.manager_name || "",
            "휴대폰": item.manager_mobile || "",
            "전화번호": item.phone || item.manager_phone || "",
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
    // 18 Columns: No(50), 주기(60), 실시여부(80), 국고(60), 계획담당(70), 업종분류(90), 사업장명(minmax(140,1.5fr)), 소재지(minmax(160,2fr)), 관할(60), 미수(50), 전회측정(80), 향후측정주기(80), 예정월(50), 예정일(80), 보고서담당(90), 실시일(110), 비고(80), 관리(40)
    const gridTemplateCols = "45px 60px 80px 60px 70px 90px minmax(140px, 1.5fr) minmax(160px, 2fr) 60px 50px 80px 80px 50px 80px 90px 110px 80px 40px";

    return (
        <div className="p-4 w-full min-w-[1400px]">
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
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">실시일</span>
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
                        <div className="flex items-center gap-4 mr-3">
                            <div className="flex items-center gap-2">
                                <span className="text-base font-semibold whitespace-nowrap">업종분류 :</span>
                                <Select
                                    options={businessCategories.length > 0 ? businessCategories : [{ value: "", label: "전체" }]}
                                    value={filters.businessCategory}
                                    onChange={(e) => setFilters(prev => ({ ...prev, businessCategory: e.target.value }))}
                                    className="w-[120px] h-10 py-2 text-base text-center"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-base font-semibold whitespace-nowrap">계획담당자 :</span>
                                <Select
                                    options={MANAGER_OPTIONS}
                                    value={filters.planManager}
                                    onChange={(e) => setFilters(prev => ({ ...prev, planManager: e.target.value }))}
                                    className="w-[120px] h-10 py-2 text-base text-center"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Grid Header Row */}
                    <div className="bg-sky-100 font-bold text-sm text-black grid items-center text-center border-x border-t border-slate-200 border-b-2 border-sky-200 pointer-events-none" style={{ gridTemplateColumns: gridTemplateCols }}>
                        <div className="py-3 text-center">No</div>
                        <div className="py-3">주기</div>
                        <div className="py-3">실시여부</div>
                        <div className="py-3">국고</div>
                        <div className="py-3">계획담당</div>
                        <div className="py-3 px-2">업종분류</div>
                        <div className="py-3 px-2 text-left pl-4">사업장명</div>
                        <div className="py-3 px-2 text-left pl-4">소재지</div>
                        <div className="py-3">관할</div>
                        <div className="py-3">미수</div>
                        <div className="py-3">전회측정</div>
                        <div className="py-3">향후측정주기</div>
                        <div className="py-3">예정월</div>
                        <div className="py-3">예정일</div>
                        <div className="py-3">보고서 담당</div>
                        <div className="py-3">실시일</div>
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
                        filteredData.map((item, index) => {
                            const isTerminated = item.is_registered_text === '거래종료' || item.is_registered_text === '종료';
                            return (
                                <div key={`${item.code}-${index}`} className={`group relative hover:bg-blue-50/40 grid items-center text-sm text-slate-700 py-1.5 transition-all duration-150 border-b border-slate-100 last:border-0 growable-row ${isTerminated ? 'opacity-50 grayscale-[0.3]' : ''}`} style={{ gridTemplateColumns: gridTemplateCols }}>
                                    {/* 표준 호버 인디케이터 바 */}
                                    <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />

                                <div className="text-center font-medium">{index + 1}</div>
                                <div className={`text-left text-xs ${item.period.includes("(수시)") ? "text-red-600 font-bold" : ""}`}>
                                    {item.period}
                                </div>
                                    <div className="px-1 text-left">
                                        <select
                                            className={`w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100 px-1 cursor-pointer ${(item.is_registered_text === '실시' || item.is_registered_text === '확정') ? 'bg-green-100 text-green-700 font-medium' :
                                                (item.is_registered_text === '미실시' || item.is_registered_text === '미확정' || !item.is_registered_text) ? 'bg-yellow-100 text-yellow-800 font-medium' :
                                                    (item.is_registered_text === '거래종료' || item.is_registered_text === '종료' || item.is_registered_text === '거래 종료') ? 'bg-red-50 text-red-500 font-medium border-red-100' :
                                                        'bg-gray-100'
                                                }`}
                                            value={
                                                (item.is_registered_text === '확정' || item.is_registered_text === '실시') ? '실시' :
                                                    (item.is_registered_text === '미확정' || item.is_registered_text === '미실시' || !item.is_registered_text) ? '미실시' :
                                                        (item.is_registered_text === '종료' || item.is_registered_text === '거래종료' || item.is_registered_text === '거래 종료') ? '거래종료' :
                                                            '미실시'
                                            }
                                            onChange={(e) => {
                                                const newVal = e.target.value;
                                                saveChanges(item.code, {
                                                    is_registered_text: newVal
                                                });
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{ textAlignLast: "left" }}
                                        >
                                            <option value="미실시" className="bg-white text-black">미실시</option>
                                            <option value="실시" className="bg-white text-black">실시</option>
                                            <option value="거래종료" className="bg-white text-black">거래종료</option>
                                        </select>
                                    </div>
                                <div className="text-left text-xs px-1">{item.national_support_status || "-"}</div>
                                <div className="text-left text-xs px-1">{item.plan_manager || "-"}</div>
                                <div className="px-1 text-left text-xs break-words break-keep" title={item.business_category || ""}>{item.business_category || "-"}</div>
                                <div className="px-1 text-left font-medium break-words break-keep" title={item.business_name}>{item.business_name}</div>
                                <div className="px-1 text-left text-xs leading-tight break-words break-keep">{item.address}</div>
                                <div className="text-left text-xs px-1">{toShortName(item.office_jurisdiction || "")}</div>
                                <div className="text-left px-1">
                                    {(() => {
                                        const businessCount = item.unpaid_count || 0;
                                        const nationalCount = item.national_unpaid_count || 0;

                                        if (businessCount === 0 && nationalCount === 0) return "-";

                                        let textColor = "text-black text-xs";
                                        if (businessCount > 0) textColor = "text-red-600 font-bold underline text-xs";
                                        else if (nationalCount > 0) textColor = "text-blue-600 font-bold underline text-xs";

                                        return (
                                            <span
                                                className={`cursor-pointer ${textColor}`}
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
                                <div className="text-left text-xs px-1">{item.previous_measurement_date || "-"}</div>
                                <div className="text-left text-xs font-medium text-blue-600 px-1">
                                    {formatCycle(item.future_measurement_period)}
                                </div>
                                <div className="text-left text-xs px-1">{item.measurement_month ? `${item.measurement_month}월` : '-'}</div>
                                <div className="text-left text-xs text-slate-500 px-1">
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
                                <div className="px-1 text-center">
                                    <div className="flex flex-col gap-0.5">
                                        <input
                                            type="date"
                                            className="w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100 bg-transparent text-center"
                                            defaultValue={item.measurement_date || ""}
                                            onBlur={(e) => {
                                                const newVal = e.target.value;
                                                if (newVal !== (item.measurement_date || "")) {
                                                    const newStatus = newVal ? '실시' : '미실시';
                                                    saveChanges(item.code, {
                                                        measurement_date: newVal || null,
                                                        measurement_end_date: newVal || null,
                                                        is_registered_text: newStatus
                                                    });
                                                }
                                            }}
                                        />
                                        {/* [The Joo Rule] Guard Logic: 시작일이 없으면 종료일 섹션 자체를 렌더링하지 않음 (찌꺼기 방지) */}
                                        {(item.measurement_date && item.measurement_end_date && item.measurement_end_date !== item.measurement_date) && (
                                            <div className="text-[10px] text-slate-400 font-medium">
                                                ~ {item.measurement_end_date}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="px-1">
                                    <input
                                        type="text"
                                        className="w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100 px-2"
                                        defaultValue={item.notes || ""}
                                        onBlur={(e) => {
                                            const newVal = e.target.value;
                                            if (newVal !== (item.notes || "")) {
                                                saveChanges(item.code, { notes: newVal });
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
                                    <button onClick={() => handleEditClick(item)} className="p-1 hover:bg-surface-200 rounded text-slate-500">✎</button>
                                </div>
                            </div>
                        );
                    })
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
                                <label className="block text-sm font-medium mb-1 text-slate-700">업종분류</label>
                                <Select
                                    options={businessCategories.map(c => c.value === "" ? { ...c, label: "선택" } : c)}
                                    value={editForm.business_category || ""}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, business_category: e.target.value }))}
                                />
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
                                            ${(editForm.is_registered_text === '확정' || editForm.is_registered_text === '실시') ? 'bg-green-100 text-green-700' :
                                                (editForm.is_registered_text === '미확정' || editForm.is_registered_text === '미실시') ? 'bg-yellow-100 text-yellow-800' :
                                                    (editForm.is_registered_text === '종료' || editForm.is_registered_text === '거래종료') ? 'bg-red-50 text-red-500' : 'bg-white'}`}
                                        value={
                                            (editForm.is_registered_text === '확정' || editForm.is_registered_text === '실시') ? '실시' :
                                                (editForm.is_registered_text === '미확정' || editForm.is_registered_text === '미실시' || !editForm.is_registered_text) ? '미실시' :
                                                    (editForm.is_registered_text === '종료' || editForm.is_registered_text === '거래종료' || editForm.is_registered_text === '거래 종료') ? '거래종료' :
                                                        '미실시'
                                        }
                                        onChange={(e) => setEditForm(prev => ({ ...prev, is_registered_text: e.target.value }))}
                                    >
                                        <option value="미실시" className="bg-white text-black">미실시</option>
                                        <option value="실시" className="bg-white text-black">실시</option>
                                        <option value="거래종료" className="bg-white text-black">거래종료</option>
                                    </select>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">* &apos;거래종료&apos; 선택 시 자동 계산보다 우선 적용됩니다.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">국고지원여부</label>
                                <Select
                                    options={[
                                        { value: "", label: "선택" },
                                        { value: "대상", label: "대상" },
                                        { value: "비대상", label: "비대상" }
                                    ]}
                                    value={editForm.national_support_status || ""}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, national_support_status: e.target.value }))}
                                    className="w-full text-center"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">향후 측정주기 (개월)</label>
                                <Select
                                    options={[
                                        { value: "", label: "선택" },
                                        { value: "6", label: "6" },
                                        { value: "12", label: "12" }
                                    ]}
                                    value={editForm.future_measurement_period?.toString() || ""}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, future_measurement_period: e.target.value ? parseInt(e.target.value) : null }))}
                                    className="w-full text-center"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">금회예정일</label>
                                <Input type="date" value={editForm.future_measurement_date || ""} onChange={(e) => setEditForm(prev => ({ ...prev, future_measurement_date: e.target.value }))} />
                            </div>
                            {/* 다중 일자 배정 섹션 */}
                            <div className="col-span-2 space-y-4">
                                <div className="flex items-center justify-between border-b border-slate-200 pb-1 mb-2">
                                    <label className="text-sm font-bold text-slate-800">측정 일정 및 인력 배정</label>
                                    <Button 
                                        type="button" 
                                        variant="secondary" 
                                        className="h-7 text-xs px-2"
                                        onClick={() => {
                                            const currentStaff = editForm.daily_staff || [];
                                            const newDate = ""; 
                                            setEditForm(prev => ({
                                                ...prev,
                                                daily_staff: [...currentStaff, { date: newDate, measurer_id: prev.measurer_id || null, collaborators: prev.collaborators ? prev.collaborators.split(",") : [] }]
                                            }));
                                        }}
                                    >
                                        + 일자 추가
                                    </Button>
                                </div>

                                {(!(editForm.daily_staff) || (editForm.daily_staff.length === 0)) ? (
                                    /* 기존 단일 일자 UI 유지 (이질감 최소화) */
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium mb-1 text-slate-700">실시일</label>
                                            <Input type="date" value={editForm.measurement_date || ""} onChange={(e) => {
                                                const val = e.target.value;
                                                setEditForm(prev => ({
                                                    ...prev,
                                                    measurement_date: val,
                                                    measurement_end_date: val,
                                                    is_registered_text: val ? '실시' : '미실시'
                                                }));
                                            }} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 text-slate-700">보고서 담당자</label>
                                            <Select
                                                options={[
                                                    { value: "", label: "선택" },
                                                    ...measurers.map(m => ({ value: m.id.toString(), label: m.name }))
                                                ]}
                                                value={editForm.measurer_id?.toString() || ""}
                                                onChange={(e) => {
                                                    const newId = e.target.value ? parseInt(e.target.value) : null;
                                                    const newName = measurers.find(m => m.id === newId)?.name;
                                                    setEditForm(prev => {
                                                        const collaborators = prev.collaborators ? prev.collaborators.split(",").map(s => s.trim()).filter(Boolean) : [];
                                                        let newCollabs = [...collaborators];
                                                        if (newName && !newCollabs.includes(newName)) {
                                                            newCollabs.push(newName);
                                                        }
                                                        return { ...prev, measurer_id: newId, collaborators: newCollabs.join(",") };
                                                    });
                                                }}
                                            />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-sm font-medium mb-2 text-slate-700">측정자 (복수 선택)</label>
                                            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 p-3 bg-white border border-slate-200 rounded-md">
                                                {measurers.map(m => {
                                                    const collaborators = editForm.collaborators ? editForm.collaborators.split(",").map(s => s.trim()) : [];
                                                    const isChecked = collaborators.includes(m.name);
                                                    return (
                                                        <label key={m.id} className={`flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-50 ${m.id === editForm.measurer_id ? "bg-blue-50/50" : ""}`}>
                                                            <input
                                                                type="checkbox"
                                                                checked={isChecked || m.id === editForm.measurer_id}
                                                                disabled={m.id === editForm.measurer_id}
                                                                onChange={(e) => {
                                                                    if (m.id === editForm.measurer_id) return;
                                                                    const checked = e.target.checked;
                                                                    let newCollabs = [...collaborators];
                                                                    if (checked) {
                                                                        if (!newCollabs.includes(m.name)) newCollabs.push(m.name);
                                                                    } else {
                                                                        newCollabs = newCollabs.filter(c => c !== m.name);
                                                                    }
                                                                    setEditForm(prev => ({ ...prev, collaborators: newCollabs.join(",") }));
                                                                }}
                                                                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 disabled:opacity-70 disabled:cursor-not-allowed"
                                                            />
                                                            <span className={`text-sm ${m.id === editForm.measurer_id ? "text-blue-700 font-semibold" : "text-slate-700"}`}>
                                                                {m.name}
                                                                {m.id === editForm.measurer_id && <span className="ml-1 text-[10px] bg-blue-100 px-1 rounded">담당</span>}
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* 다중 일자 UI (동적 생성) */
                                    <div className="space-y-4">
                                        {(editForm.daily_staff as any[]).map((entry, idx) => (
                                            <Card key={idx} className="p-3 bg-white border-slate-200 relative group">
                                                <button 
                                                    type="button"
                                                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-100 text-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-sm"
                                                    onClick={() => {
                                                        const newList = [...(editForm.daily_staff as any[])];
                                                        newList.splice(idx, 1);
                                                        setEditForm(prev => ({ ...prev, daily_staff: newList.length > 0 ? newList : null }));
                                                    }}
                                                >
                                                    ×
                                                </button>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-500 mb-1">측정일 {idx + 1}</label>
                                                        <Input type="date" value={entry.date || ""} onChange={(e) => {
                                                            const newList = [...(editForm.daily_staff as any[])];
                                                            newList[idx].date = e.target.value;
                                                            // Update measurement_date (start) and measurement_end_date (end)
                                                            const sortedDates = newList.map(d => d.date).filter(Boolean).sort();
                                                            setEditForm(prev => ({ 
                                                                ...prev, 
                                                                daily_staff: newList,
                                                                measurement_date: sortedDates[0] || null,
                                                                measurement_end_date: sortedDates[sortedDates.length - 1] || null
                                                            }));
                                                        }} />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-500 mb-1">보고서 담당(코드)</label>
                                                        <Select
                                                            options={[
                                                                { value: "", label: "선택" },
                                                                ...measurers.map(m => ({ value: m.id.toString(), label: m.name }))
                                                            ]}
                                                            value={entry.measurer_id?.toString() || (idx === 0 ? editForm.measurer_id?.toString() : "")}
                                                            onChange={(e) => {
                                                                const newId = e.target.value ? parseInt(e.target.value) : null;
                                                                const newName = measurers.find(m => m.id === newId)?.name;
                                                                const newList = [...(editForm.daily_staff as any[])];
                                                                newList[idx].measurer_id = newId;

                                                                // 2일 이상 측정인 경우 보고서 담당자 선택 시 기본으로 측정자에도 체크 (수정 가능)
                                                                if (newName) {
                                                                    let collabs = newList[idx].collaborators || [];
                                                                    if (!collabs.includes(newName)) {
                                                                        collabs.push(newName);
                                                                        newList[idx].collaborators = [...collabs];
                                                                    }
                                                                }

                                                                setEditForm(prev => ({ ...prev, daily_staff: newList }));
                                                            }}
                                                        />
                                                    </div>
                                                    <div className="col-span-2">
                                                        <label className="block text-xs font-semibold text-slate-500 mb-1">측정자</label>
                                                        <div className="flex flex-wrap gap-2 p-2 bg-slate-50 border border-slate-200 rounded">
                                                                    {measurers.map(m => {
                                                                        const isChecked = entry.collaborators?.includes(m.name);
                                                                        const isReportWriter = m.id === (entry.measurer_id || (idx === 0 ? editForm.measurer_id : null));
                                                                        const isLocked = isReportWriter && (editForm.daily_staff as any[]).length === 1;

                                                                        return (
                                                                            <label key={m.id} className={`flex items-center gap-1.5 cursor-pointer p-0.5 rounded ${isLocked ? "bg-blue-50/50" : ""}`}>
                                                                                <input 
                                                                                    type="checkbox"
                                                                                    checked={isChecked || isLocked || false}
                                                                                    disabled={isLocked}
                                                                                    onChange={(e) => {
                                                                                        if (isLocked) return;
                                                                                        const newList = [...(editForm.daily_staff as any[])];
                                                                                        let collabs = newList[idx].collaborators || [];
                                                                                        if (e.target.checked) collabs.push(m.name);
                                                                                        else collabs = collabs.filter((c: string) => c !== m.name);
                                                                                        newList[idx].collaborators = Array.from(new Set(collabs));
                                                                                        setEditForm(prev => ({ ...prev, daily_staff: newList }));
                                                                                    }}
                                                                                    className="w-3.5 h-3.5 rounded disabled:opacity-70 disabled:cursor-not-allowed"
                                                                                />
                                                                                <span className={`text-xs ${isLocked ? "text-blue-700 font-semibold" : "text-slate-600"}`}>
                                                                                    {m.name}
                                                                                    {isLocked && <span className="ml-1 text-[9px] bg-blue-100 px-1 rounded">담당</span>}
                                                                                </span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                )}
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

            <Modal
                isOpen={isUnpaidModalOpen}
                onClose={() => setIsUnpaidModalOpen(false)}
                title={`미수 내역 (${selectedUnpaidBusinessName})`}
            >
                <div className="bg-white p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
                    <div className="rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                        <Table>
                            <TableHeader className="bg-slate-50">
                                <TableRow>
                                    <TableHead className="w-16 text-center text-xs font-bold text-slate-800">년도</TableHead>
                                    <TableHead className="w-20 text-center text-xs font-bold text-slate-800">주기</TableHead>
                                    <TableHead className="text-center text-xs font-bold text-slate-800">계산서 발행일</TableHead>
                                    <TableHead className="w-32 text-right text-xs font-bold text-slate-800">미수금액(사업장)</TableHead>
                                    <TableHead className="w-32 text-right text-xs font-bold text-slate-800">미수금액(국고)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {selectedUnpaidDetails.length > 0 ? (
                                    selectedUnpaidDetails.map((detail: any, idx: number) => (
                                        <TableRow key={idx} className="hover:bg-slate-50 border-b border-slate-100 last:border-0 growable-row">
                                            <TableCell className="text-center text-xs py-2.5">{detail.year}</TableCell>
                                            <TableCell className="text-center text-xs py-2.5">{detail.period}</TableCell>
                                            <TableCell className="text-center text-xs py-2.5 text-slate-500">{detail.invoiceDate || "-"}</TableCell>
                                            <TableCell className="text-right text-xs font-bold text-red-600 py-2.5">
                                                {detail.unpaidBusiness ? detail.unpaidBusiness.toLocaleString() + "원" : "-"}
                                            </TableCell>
                                            <TableCell className="text-right text-xs font-bold text-blue-600 py-2.5">
                                                {detail.unpaidNational ? detail.unpaidNational.toLocaleString() + "원" : "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={5} className="p-8 text-center text-slate-400 text-sm">
                                            미수 내역이 없습니다.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
                <div className="bg-white p-4 rounded-b-lg border-t flex justify-end">
                    <Button onClick={() => setIsUnpaidModalOpen(false)} variant="secondary">닫기</Button>
                </div>
            </Modal>
        </div >
    );
};
