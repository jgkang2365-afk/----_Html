"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { CustomDropdown } from "@/components/ui/CustomDropdown";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import { ExcelUpload } from "@/components/features/ExcelUpload";
import { NewBusinessDocumentGeneration } from "@/components/features/NewBusinessDocumentGeneration";
import { BusinessMapModal } from "@/components/features/BusinessMapModal";
import {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
} from "@/components/ui/Table";
import { toShortName } from "@/lib/constants/designated-offices";
import { formatBusinessNumber } from "@/lib/utils/business-number";
import { isValidOptionalManagerEmail } from "@/lib/business/manager-email";
import { suggestLinkMeasurerCandidates, collectMeasurementStaffNames, splitNames, repairLinkCandidates } from "@/lib/business/link-measurer";
import {
    MEASUREMENT_MAP_CHANNEL,
    MEASUREMENT_MAP_VIEWER_NAME,
    MEASUREMENT_MAP_VIEWER_PATH,
    MeasurementMapMessage,
    retainAvailableBusinessIds,
    sanitizeBusinessForMap,
} from "@/lib/measurement-map/types";
import * as XLSX from "xlsx";
import { useUser } from "@/hooks/use-user";
import {
    canRequestNationalSupportLookup,
    getNationalSupportDisplayStatus,
    hasNationalSupportApplicationInformation,
    hasNationalSupportLookupInformation,
} from "@/lib/national-support/eligibility";
import {
    buildRegistrationAutoFillValues,
    ExactMeasurementBusiness,
    RegistrationAutoFillValues,
} from "@/lib/business-info/registration-context";

interface BusinessEntry {
    id: string | number;
    code: string;
    year: number;
    period: string;
    document_generation_enabled?: boolean;
    has_actual_measurement_journal?: boolean;
    business_name: string;
    business_number: string | null; // 사업자등록번호
    business_category: string | null; // 업종
    business_type?: "existing" | "first_measurement" | "external_new" | null;
    process_changed?: boolean | null;
    address: string | null;
    total_employees: number | null; // 근로자수
    office_jurisdiction: string | null; // 관할청
    designated_office: string | null; // 지정지청
    isRegistered: boolean;
    is_registered: string | null; // DB 원본
    is_registered_text: string | null; // '실시', '미실시', '거래종료'
    national_support_status: string | null; // 국고
    sync_status?: string | null;
    sync_error_message?: string | null;
    sanjae?: string;
    commencement?: string;
    plan_manager: string | null; // 계획담당
    manager_name: string | null; // 업체담당
    manager_mobile: string | null;
    manager_email?: string | null;
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
    measurer_id?: number | null; // 보고서 담당자 ID (보고서 작성/관리 책임, 실제 측정·예비조사와 별개)
    link_measurer_id?: number | null; // 예·측 ID (예비조사자이면서 전체 측정기간 중 최소 하루 실제 측정에 참여)
    collaborators?: string | null; // 협력자 목록 (쉼표 구분)
    representative_name?: string | null; // 대표자명
    industrial_accident_number?: string | null; // 산재관리번호
    commencement_number?: string | null; // 사업개시번호
    invoice_email?: string | null;
    fax?: string | null;
    latitude?: number | null; // 위도
    longitude?: number | null; // 경도
    geocoded_address?: string | null; // Geocoding 결과 정규화 주소
    geocoded_source_address?: string | null; // Geocoding 원본 주소
    geocoding_status?: string | null; // Geocoding 상태 (SUCCESS, FAILED, ADDRESS_MISSING, STALE 등)
    geocoding_error?: string | null; // Geocoding 에러 메시지
    geocoded_at?: string | null; // Geocoding 완료 시각
    geocode_provider?: string | null; // Geocoding 공급자 (kakao, juso 등)
    coordinate_locked?: boolean; // 수동 고정 여부
    preliminary_survey_v2_plan?: {
        id: string;
        recommended_date: string | null;
        responsible_user_id: number;
        experienced_reviewer_id: number | null;
        participant_user_ids: number[];
        participant_names: string[];
        status: "recommended" | "manual_required";
        plan_origin: "automatic" | "manual";
        survey_method: "field" | "phone";
        recommendation_reason: { reason?: string } | null;
    } | null;
}

const BUSINESS_TYPE_OPTIONS = [
    { value: "existing", label: "기존업체" },
    { value: "first_measurement", label: "최초실시" },
    { value: "external_new", label: "타기관 신규" },
] as const;

const getBusinessTypeLabel = (businessType: BusinessEntry["business_type"]) => {
    return BUSINESS_TYPE_OPTIONS.find((option) => option.value === businessType)?.label || "-";
};

const isProcessChangedDefaultCategory = (businessCategory: string | null | undefined) => {
    const normalized = businessCategory?.trim();
    return normalized === "공업사" || normalized === "건설";
};

interface BusinessInfoSearchResult {
    code: string;
    business_name: string;
    business_number: string;
    representative_name: string;
    address: string;
    business_category: string;
    phone: string;
    fax: string;
    invoice_email: string;
    industrial_accident_number: string;
    commencement_number: string;
    office_jurisdiction: string;
    invoice_contact_candidate: {
        name: string;
        position: string;
        contact: string;
    } | null;
}

interface User {
    id: number;
    name: string;
    job?: string;
    is_preliminary_survey_experienced?: boolean;
}

// 관리자 예비조사 예외 정비 화면 비교 정보
interface AdminRepairContext {
    target: {
        id: number;
        code: string;
        year: number;
        period: string;
        business_name: string;
        measurement_date: string | null;
        measurement_end_date: string | null;
        measurer_id: number | null;
        link_measurer_id: number | null;
    };
    plan: {
        id: string;
        recommended_date: string | null;
        survey_method: "field" | "phone";
        participant_user_ids: number[];
        participant_names: string[];
        status: string;
        plan_origin: string;
    } | null;
    staffNames: string[];
    legacy: {
        preliminary_surveyor: string | null;
        actual_measurer: string | null;
        report_writer: string | null;
        measurer: string | null;
        survey_code: string | null;
        measurement_date: string | null;
        end_date: string | null;
    } | null;
    sequenceNumber: string | null;
    users: Array<{ id: number; name: string; job: string | null; is_active: boolean | null }>;
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
    { value: "이태환", label: "이태환" },
    { value: "한기문", label: "한기문" },
    { value: "강종구", label: "강종구" },
    { value: "이주형", label: "이주형" },
    { value: "김민영", label: "김민영" },
    { value: "고유빈", label: "고유빈" }
];

const PLAN_MANAGER_EDIT_OPTIONS = [
    { value: "", label: "선택" },
    { value: "이태환", label: "이태환" },
    { value: "한기문", label: "한기문" },
    { value: "강종구", label: "강종구" },
    { value: "이주형", label: "이주형" },
    { value: "김민영", label: "김민영" },
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
    const { user } = useUser();
    const isAdmin = user?.role === "관리자";
    const [loading, setLoading] = useState(false);

    // 다중 선택 상태 (최대 10개)
    const [selectedBusinessIds, setSelectedBusinessIds] = useState<Set<string | number>>(new Set());
    
    // 네이버 지도 모달 열림 상태
    const [isMapModalOpen, setIsMapModalOpen] = useState(false);
    const mapViewerRef = useRef<Window | null>(null);
    const mapChannelRef = useRef<BroadcastChannel | null>(null);
    const mapSelectionSignatureRef = useRef("");

    // 개별 체크박스 토글
    const handleToggleSelect = (id: string | number) => {
        setSelectedBusinessIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                if (next.size >= 10) {
                    alert("사업장은 한 번에 최대 10개까지만 선택할 수 있습니다.");
                    return prev;
                }
                next.add(id);
            }
            return next;
        });
    };

    // 전체 선택/해제 토글 (현재 화면의 filteredData 기준)
    const handleToggleAllSelect = () => {
        const visibleIds = filteredData.map(item => item.id);
        const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedBusinessIds.has(id));

        if (allVisibleSelected) {
            // 모두 선택되어 있으면, 보이는 것들만 선택 해제
            setSelectedBusinessIds(prev => {
                const next = new Set(prev);
                visibleIds.forEach(id => next.delete(id));
                return next;
            });
        } else {
            // 안 보이는/기존 선택 유지한 채로, 보이는 것들 중 미선택된 것을 추가하되 10개 제한 적용
            setSelectedBusinessIds(prev => {
                const next = new Set(prev);
                const toAdd = visibleIds.filter(id => !next.has(id));
                
                for (const id of toAdd) {
                    if (next.size >= 10) {
                        alert("사업장은 한 번에 최대 10개까지만 선택할 수 있습니다. 10개까지만 선택되었습니다.");
                        break;
                    }
                    next.add(id);
                }
                return next;
            });
        }
    };

    // Data State
    const [data, setData] = useState<BusinessEntry[]>([]);
    const [filteredData, setFilteredData] = useState<BusinessEntry[]>([]);
    const dataFetchInFlightRef = useRef(false);
    const [recommendingTargetIds, setRecommendingTargetIds] = useState<Set<number>>(new Set());


    // 국고 일괄 조회를 위한 상태 정의
    const [isBulkProcessing, setIsBulkProcessing] = useState(false);
    const [bulkTotal, setBulkTotal] = useState(0);
    const [bulkProcessed, setBulkProcessed] = useState(0);
    const [bulkSuccessCount, setBulkSuccessCount] = useState(0);
    const [bulkCrawlerCount, setBulkCrawlerCount] = useState(0);
    const [bulkFailedCount, setBulkFailedCount] = useState(0);
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkLogs, setBulkLogs] = useState<string[]>([]);

    // 좌표 일괄 재조회를 위한 상태 정의
    const [isGeocodeProcessing, setIsGeocodeProcessing] = useState(false);
    const [geocodeTotal, setGeocodeTotal] = useState(0);
    const [geocodeProcessed, setGeocodeProcessed] = useState(0);
    const [geocodeSuccessCount, setGeocodeSuccessCount] = useState(0);
    const [geocodeFailedCount, setGeocodeFailedCount] = useState(0);
    const [geocodeSkippedCount, setGeocodeSkippedCount] = useState(0);
    const [showGeocodeModal, setShowGeocodeModal] = useState(false);
    const [geocodeLogs, setGeocodeLogs] = useState<string[]>([]);
    const [coordinateSummary, setCoordinateSummary] = useState({ total: 0, valid: 0, missing: 0, invalid: 0, pending: 0 });

    const refreshCoordinateSummary = useCallback(async () => {
        try {
            const response = await fetch("/api/businesses/geocode", { cache: "no-store" });
            if (response.ok) setCoordinateSummary(await response.json());
        } catch {
            // 현황 집계 실패가 사업장 목록 사용을 막지 않도록 조용히 유지한다.
        }
    }, []);

    useEffect(() => {
        void refreshCoordinateSummary();
    }, [refreshCoordinateSummary]);

    // 좌표 재조회 실행 공통 핸들러 함수 (3개씩 동시 요청 제한 배칭 적용)
    const handleGeocodeBatch = async (
        type: 'selected' | 'missing' | 'suspicious' | 'single',
        singleTargetId?: string | number
    ) => {
        if (isGeocodeProcessing) return;

        let targets: BusinessEntry[] = [];

        if (type === 'single' && singleTargetId) {
            targets = data.filter((item) => String(item.id) === String(singleTargetId));
        } else if (type === 'selected') {
            targets = data.filter((item) => selectedBusinessIds.has(item.id));
            if (targets.length === 0) {
                alert("선택된 사업장이 없습니다. 사업장을 선택한 후 다시 시도하세요.");
                return;
            }
        } else if (type === 'missing') {
            targets = filteredData.filter(
                (item) => !item.latitude || !item.longitude || item.geocoding_status !== "SUCCESS"
            );
            if (targets.length === 0) {
                alert("좌표가 없는 사업장이 없습니다.");
                return;
            }
        } else if (type === 'suspicious') {
            // 동일 위도/경도를 2개 이상 공유하는 사업장 그룹 추출
            const coordMap = new Map<string, BusinessEntry[]>();
            filteredData.forEach((item) => {
                if (item.latitude && item.longitude) {
                    const key = `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`;
                    const group = coordMap.get(key) || [];
                    group.push(item);
                    coordMap.set(key, group);
                }
            });

            const suspiciousList: BusinessEntry[] = [];
            coordMap.forEach((group) => {
                if (group.length >= 2) {
                    suspiciousList.push(...group);
                }
            });

            targets = suspiciousList;
            if (targets.length === 0) {
                alert("동일 좌표로 의심되는 중복 사업장이 없습니다.");
                return;
            }
        }

        const typeNameMap = {
            single: "단건",
            selected: `선택 (${targets.length}건)`,
            missing: `좌표 미등록 (${targets.length}건)`,
            suspicious: `동일 좌표 의심 (${targets.length}건)`
        };

        if (!confirm(`${typeNameMap[type]} 사업장에 대해 좌표 재조회를 진행하시겠습니까?`)) {
            return;
        }

        setIsGeocodeProcessing(true);
        setGeocodeTotal(targets.length);
        setGeocodeProcessed(0);
        setGeocodeSuccessCount(0);
        setGeocodeFailedCount(0);
        setGeocodeSkippedCount(0);
        setGeocodeLogs([`[시작] 총 ${targets.length}건에 대한 좌표 재조회를 시작합니다.`]);
        setShowGeocodeModal(true);

        // 동시 요청 3개 제한 배칭 (Chunking: 청크당 3개씩 분할 및 순차 처리)
        const chunkSize = 3;
        let successCnt = 0;
        let failedCnt = 0;
        let skippedCnt = 0;
        let processedCnt = 0;

        for (let i = 0; i < targets.length; i += chunkSize) {
            const chunk = targets.slice(i, i + chunkSize);
            const chunkIds = chunk.map((t) => t.id);

            try {
                const response = await fetch("/api/businesses/geocode", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        businessIds: chunkIds,
                        forceRefetch: type !== 'missing'
                    }),
                });

                if (!response.ok) {
                    const errJson = await response.json();
                    const errMsg = errJson.error || "API 호출 실패";
                    chunk.forEach((t) => {
                        failedCnt++;
                        processedCnt++;
                        setGeocodeLogs((prev) => [...prev, `[실패] ${t.business_name}: ${errMsg}`]);
                    });
                } else {
                    const resData = await response.json();
                    const results: any[] = resData.results || [];

                    results.forEach((res) => {
                        processedCnt++;
                        if (res.coordinate_locked) {
                            skippedCnt++;
                            setGeocodeLogs((prev) => [...prev, `[건너뀀] ${res.business_name}: 수동 고정 좌표`]);
                        } else if (res.geocoding_status === "SUCCESS" && res.latitude && res.longitude) {
                            successCnt++;
                            setGeocodeLogs((prev) => [
                                ...prev,
                                `[성공] ${res.business_name}: (${res.latitude.toFixed(5)}, ${res.longitude.toFixed(5)})`
                            ]);
                        } else {
                            failedCnt++;
                            setGeocodeLogs((prev) => [
                                ...prev,
                                `[실패] ${res.business_name}: ${res.geocoding_error || "좌표 변환 실패"}`
                            ]);
                        }
                    });
                }
            } catch (err: any) {
                chunk.forEach((t) => {
                    failedCnt++;
                    processedCnt++;
                    setGeocodeLogs((prev) => [...prev, `[오류] ${t.business_name}: ${err.message || "네트워크 오류"}`]);
                });
            }

            setGeocodeProcessed(processedCnt);
            setGeocodeSuccessCount(successCnt);
            setGeocodeFailedCount(failedCnt);
            setGeocodeSkippedCount(skippedCnt);
        }

        setGeocodeLogs((prev) => [
            ...prev,
            `[완료] 총 ${targets.length}건 처리 완료 (성공: ${successCnt}, 실패: ${failedCnt}, 건너뀀: ${skippedCnt})`
        ]);
        setIsGeocodeProcessing(false);
        fetchData();
        void refreshCoordinateSummary();
    };


    // 국고 일괄 조회 실행 핸들러
    const handleBulkCheckResult = async () => {
        if (isBulkProcessing) return;

        // 현재 화면 목록 중 조회 가능한 대상 필터링
        const targets = filteredData.filter((item) => canRequestNationalSupportLookup({
            ...item,
            industrial_accident_number: item.industrial_accident_number || item.sanjae,
            commencement_number: item.commencement_number || item.commencement,
        }));

        if (targets.length === 0) {
            alert("일괄 조회할 수 있는 미완료 대상 사업장이 없습니다. (필수 정보 입력 상태 및 조회 완료 여부를 확인해주세요)");
            return;
        }

        const confirmMsg = `현재 목록의 미완료 대상 ${targets.length}건에 대해 국고 일괄 조회를 시작하시겠습니까?\n\n(건강디딤돌 신청결과가 디비에 있는 항목은 즉시 반영되고, 매칭 결과가 없으면 백그라운드 크롤러가 구동됩니다)`;
        if (!confirm(confirmMsg)) {
            return;
        }

        setIsBulkProcessing(true);
        setBulkTotal(targets.length);
        setBulkProcessed(0);
        setBulkSuccessCount(0);
        setBulkCrawlerCount(0);
        setBulkFailedCount(0);
        setBulkLogs([`[시작] 총 ${targets.length}건에 대한 국고 일괄 처리를 시작합니다.`]);
        setShowBulkModal(true);

        // Worker/Chrome 단일 실행 정책에 맞춰 큐 등록도 한 건씩 순차 처리합니다.
        const limit = 1;
        let currentIndex = 0;

        const runNext = async () => {
            if (currentIndex >= targets.length) return;
            const item = targets[currentIndex++];

            try {
                // 낙관적 업데이트
                setData((prev) => prev.map((d) => d.id === item.id ? { ...d, sync_status: "조회중", sync_error_message: null } : d));

                const res = await fetch("/api/businesses/national-support/apply", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        target_id: item.id,
                        sanjae: item.industrial_accident_number || item.sanjae,
                        commencement: item.commencement_number || item.commencement,
                        representative: item.representative_name,
                        contact_name: item.manager_name || "담당자",
                        contact_phone: item.manager_mobile || "010-0000-0000",
                        period: item.period,
                        code: item.code,
                        year: item.year
                    })
                });

                const resJson = await res.json();
                if (res.ok) {
                    if (resJson.instantSync) {
                        setBulkSuccessCount((prev) => prev + 1);
                        setBulkLogs((prev) => [`[즉시반영] ${item.business_name}: 기존 결과 매핑 완료`, ...prev]);
                        setData((prev) => prev.map((d) => d.id === item.id ? { ...d, sync_status: "성공", national_support_status: resJson.status } : d));
                    } else {
                        setBulkCrawlerCount((prev) => prev + 1);
                        setBulkLogs((prev) => [`[백그라운드 기동] ${item.business_name}: 공단 조회 기동`, ...prev]);
                    }
                } else {
                    setBulkFailedCount((prev) => prev + 1);
                    setBulkLogs((prev) => [`[조회 실패] ${item.business_name}: ${resJson.error || "알 수 없는 오류"}`, ...prev]);
                    setData((prev) => prev.map((d) => d.id === item.id ? { ...d, sync_status: "실패", sync_error_message: resJson.error } : d));
                }
            } catch (err: any) {
                setBulkFailedCount((prev) => prev + 1);
                setBulkLogs((prev) => [`[네트워크 오류] ${item.business_name}: ${err.message || "연결 오류"}`, ...prev]);
                setData((prev) => prev.map((d) => d.id === item.id ? { ...d, sync_status: "실패", sync_error_message: "연결 오류" } : d));
            } finally {
                setBulkProcessed((prev) => prev + 1);
                // 공단 부하 방지를 위해 각 호출 사이 500ms의 대기 시간 부여
                await new Promise((resolve) => setTimeout(resolve, 500));
                await runNext();
            }
        };

        const workers = [];
        for (let i = 0; i < Math.min(limit, targets.length); i++) {
            workers.push(runNext());
        }
        await Promise.all(workers);

        setBulkLogs((prev) => [`[요청 완료] 국고 일괄 조회가 모두 대기열에 등록되었습니다. 처리 결과는 목록에 자동 반영됩니다.`, ...prev]);
        alert("국고 일괄 조회 요청 등록이 완료되었습니다. 깡통컴 처리 결과는 목록에 자동 반영됩니다.");
        setIsBulkProcessing(false);
        fetchData();
        void refreshCoordinateSummary();
    };
    const [measurers, setMeasurers] = useState<User[]>([]); // 측정자 목록
    const [businessCategories, setBusinessCategories] = useState<{ value: string; label: string }[]>([]);

    // Initial Filter Setup
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const initialPeriod = currentMonth <= 6 ? "상반기" : "하반기";

    // 정렬 상태 관리
    const [sortConfig, setSortConfig] = useState<{
        key: string;
        direction: "asc" | "desc" | null;
    } | null>(null);

    const handleSort = (key: string) => {
        setSortConfig((prev) => {
            if (!prev || prev.key !== key) {
                return { key, direction: "asc" };
            }
            if (prev.direction === "asc") {
                return { key, direction: "desc" };
            }
            return null;
        });
    };

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

    const buildMapInitializeMessage = useCallback((): MeasurementMapMessage | null => {
        const [yearText, period] = filters.yearPeriod.split("-");
        const year = Number(yearText);
        if (!Number.isInteger(year) || !period) return null;

        const selectedBusinesses = data
            .filter((business) =>
                Array.from(selectedBusinessIds).some((id) => String(id) === String(business.id))
            )
            .map(sanitizeBusinessForMap);

        if (selectedBusinesses.length === 0) return null;
        return {
            type: "MAP_INITIALIZE",
            payload: {
                context: { year, period },
                businesses: selectedBusinesses,
                baseBusinessId: selectedBusinesses[0].id,
            },
        };
    }, [data, filters.yearPeriod, selectedBusinessIds]);

    const postMapMessage = useCallback((message: MeasurementMapMessage) => {
        mapChannelRef.current?.postMessage(message);
        const viewer = mapViewerRef.current;
        if (viewer && !viewer.closed) {
            viewer.postMessage(message, window.location.origin);
        }
    }, []);

    const handleOpenMapViewer = useCallback(() => {
        const message = buildMapInitializeMessage();
        if (!message) {
            alert("지도에 표시할 사업장을 먼저 선택해주세요.");
            return;
        }
        if (message.type !== "MAP_INITIALIZE") return;

        let viewer = mapViewerRef.current;
        if (!viewer || viewer.closed) {
            viewer = window.open(
                MEASUREMENT_MAP_VIEWER_PATH,
                MEASUREMENT_MAP_VIEWER_NAME,
                "width=1500,height=900,resizable=yes,scrollbars=yes"
            );
            mapViewerRef.current = viewer;
        }
        if (!viewer) {
            alert("지도 창을 열지 못했습니다. 브라우저의 팝업 차단 설정을 확인해주세요.");
            return;
        }

        viewer.focus();
        mapSelectionSignatureRef.current = `${message.payload.context.year}-${message.payload.context.period}|${message.payload.businesses
            .map((business) => String(business.id))
            .sort()
            .join(",")}`;
        postMapMessage(message);
        window.setTimeout(() => postMapMessage(message), 350);
    }, [buildMapInitializeMessage, postMapMessage]);

    useEffect(() => {
        if (!("BroadcastChannel" in window)) return;
        const channel = new BroadcastChannel(MEASUREMENT_MAP_CHANNEL);
        mapChannelRef.current = channel;
        channel.onmessage = (event) => {
            if (event.data?.type === "VIEWER_READY") {
                const message = buildMapInitializeMessage();
                if (message) postMapMessage(message);
            }
        };
        return () => {
            channel.close();
            mapChannelRef.current = null;
        };
    }, [buildMapInitializeMessage, postMapMessage]);

    useEffect(() => {
        const onViewerMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.data?.type !== "VIEWER_READY") return;
            const message = buildMapInitializeMessage();
            if (message) postMapMessage(message);
        };
        window.addEventListener("message", onViewerMessage);
        return () => window.removeEventListener("message", onViewerMessage);
    }, [buildMapInitializeMessage, postMapMessage]);

    useEffect(() => {
        const viewer = mapViewerRef.current;
        if (!viewer || viewer.closed) return;
        const signature = `${filters.yearPeriod}|${Array.from(selectedBusinessIds)
            .map(String)
            .sort()
            .join(",")}`;
        if (signature === mapSelectionSignatureRef.current) return;
        mapSelectionSignatureRef.current = signature;
        const message = buildMapInitializeMessage();
        postMapMessage(message || { type: "RESET_MAP" });
    }, [buildMapInitializeMessage, filters.yearPeriod, postMapMessage, selectedBusinessIds]);

    useEffect(() => {
        const [yearText, period] = filters.yearPeriod.split("-");
        const year = Number(yearText);
        if (!Number.isInteger(year) || !period) return;
        postMapMessage({ type: "SET_CONTEXT", payload: { year, period } });
        postMapMessage({ type: "RESET_MAP" });
    }, [filters.yearPeriod, postMapMessage]);

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
                        
                        // 사용자의 시인성을 위해 공식 순서로 정렬 (이태환, 한기문, 강종구, 이주형, 배윤민, 김민영, 고유빈 순)
                        const officialOrder = ["이태환", "한기문", "강종구", "이주형", "배윤민", "김민영", "고유빈"];
                        filtered.sort((a: User, b: User) => {
                            const indexA = officialOrder.indexOf(a.name);
                            const indexB = officialOrder.indexOf(b.name);
                            const valA = indexA === -1 ? 999 : indexA;
                            const valB = indexB === -1 ? 999 : indexB;
                            return valA - valB;
                        });

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
        period: (new Date().getMonth() + 1) <= 6 ? "상반기" : "하반기",
        manager_email: "",
    });
    const [addProcessChangedTouched, setAddProcessChangedTouched] = useState(false);
    const [businessInfoQuery, setBusinessInfoQuery] = useState("");
    const [businessInfoResults, setBusinessInfoResults] = useState<BusinessInfoSearchResult[]>([]);
    const [selectedBusinessInfo, setSelectedBusinessInfo] = useState<BusinessInfoSearchResult | null>(null);
    const [isBusinessInfoSearching, setIsBusinessInfoSearching] = useState(false);
    const [registrationContextStatus, setRegistrationContextStatus] = useState<"idle" | "loading" | "exact" | "none" | "error">("idle");
    const registrationContextRequestRef = useRef(0);
    const registrationAutoValuesRef = useRef<Partial<RegistrationAutoFillValues>>({});

    const applyRegistrationAutoValues = (values: RegistrationAutoFillValues) => {
        const previousAutoValues = registrationAutoValuesRef.current;
        setAddForm(prev => {
            const next: any = { ...prev };
            (Object.keys(values) as Array<keyof RegistrationAutoFillValues>).forEach(key => {
                const currentValue = next[key];
                const previousAutoValue = previousAutoValues[key];
                const isEmpty = currentValue === null || currentValue === undefined || String(currentValue).trim() === "";
                const isUnchangedAutoValue = previousAutoValue !== undefined && String(currentValue ?? "") === String(previousAutoValue ?? "");

                // Replace only empty or previously auto-filled values. Manual edits always win.
                if (isEmpty || isUnchangedAutoValue) {
                    next[key] = values[key];
                }
            });
            return next;
        });
        registrationAutoValuesRef.current = values;
    };

    const loadExactMeasurementBusiness = async (
        business: BusinessInfoSearchResult,
        year: number,
        period: string,
    ) => {
        if (!business.code || !Number.isInteger(year) || !period) return;

        const requestId = ++registrationContextRequestRef.current;
        setRegistrationContextStatus("loading");
        try {
            const params = new URLSearchParams({
                code: business.code,
                year: String(year),
                period,
            });
            const response = await fetch(`/api/business-info/registration-context?${params.toString()}`, {
                cache: "no-store",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "측정사업장 보완자료 조회에 실패했습니다.");
            if (requestId !== registrationContextRequestRef.current) return;

            if (result.existingTarget) {
                const target = result.existingTarget;
                const existingItem = {
                    ...target,
                    isRegistered: target.is_registered === "실시",
                    is_registered_text: target.is_registered || "미실시",
                    designated_office: target.office_jurisdiction || "",
                    sanjae: target.industrial_accident_number || "",
                    commencement: target.commencement_number || "",
                    unpaid_count: 0,
                    unpaid_details: [],
                } as BusinessEntry;

                setIsAddModalOpen(false);
                resetAddForm();
                window.setTimeout(() => {
                    alert(
                        `${business.business_name}은(는) ${year}년 ${period} 측정대상 사업장으로 이미 등록되어 있습니다.\n` +
                        "중복 등록을 방지하기 위해 기존 사업장 수정 화면으로 이동합니다.",
                    );
                    handleEditClick(existingItem);
                }, 0);
                return;
            }

            const exactMeasurementBusiness = (result.measurementBusiness || null) as ExactMeasurementBusiness | null;
            applyRegistrationAutoValues(
                buildRegistrationAutoFillValues(business, exactMeasurementBusiness),
            );
            setRegistrationContextStatus(exactMeasurementBusiness ? "exact" : "none");
        } catch (error) {
            if (requestId !== registrationContextRequestRef.current) return;
            console.error("신규 등록 보완자료 조회 오류:", error);
            setRegistrationContextStatus("error");
        }
    };

    const resetAddForm = () => {
        setAddForm({
            year: new Date().getFullYear(),
            period: (new Date().getMonth() + 1) <= 6 ? "상반기" : "하반기",
            code: "",
            business_name: "",
            address: "",
            plan_manager: "",
            sanjae: "",
            commencement: "",
            representative_name: "",
            manager_name: "",
            manager_mobile: "",
            manager_email: "",
        });
        setBusinessInfoQuery("");
        setBusinessInfoResults([]);
        setSelectedBusinessInfo(null);
        setRegistrationContextStatus("idle");
        setAddProcessChangedTouched(false);
        registrationAutoValuesRef.current = {};
        registrationContextRequestRef.current += 1;
    };

    const openAddModal = () => {
        resetAddForm();
        setIsAddModalOpen(true);
    };

    const closeAddModal = () => {
        setIsAddModalOpen(false);
        resetAddForm();
    };

    const handleBusinessInfoSearch = async () => {
        const query = businessInfoQuery.trim();
        if (!query) {
            setBusinessInfoResults([]);
            return;
        }

        setIsBusinessInfoSearching(true);
        try {
            const response = await fetch(`/api/business-info/search?q=${encodeURIComponent(query)}`, {
                cache: "no-store",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "사업장정보 검색에 실패했습니다.");
            setBusinessInfoResults(result.businesses || []);
        } catch (error) {
            alert(error instanceof Error ? error.message : "사업장정보 검색 중 오류가 발생했습니다.");
        } finally {
            setIsBusinessInfoSearching(false);
        }
    };

    const selectBusinessInfo = (business: BusinessInfoSearchResult) => {
        setSelectedBusinessInfo(business);
        setBusinessInfoResults([]);
        setBusinessInfoQuery(`${business.code} ${business.business_name}`);
        setAddForm(prev => ({
            ...prev,
            manager_email: prev.code && prev.code !== business.code ? "" : prev.manager_email,
            code: business.code,
            business_name: business.business_name,
            business_number: business.business_number || prev.business_number,
            invoice_email: business.invoice_email || prev.invoice_email,
            office_jurisdiction: business.office_jurisdiction || prev.office_jurisdiction,
        }));
        applyRegistrationAutoValues(buildRegistrationAutoFillValues(business, null));
        void loadExactMeasurementBusiness(
            business,
            Number(addForm.year || currentYear),
            String(addForm.period || initialPeriod),
        );
    };

    const handleAddSubmit = async () => {
        if (!isValidOptionalManagerEmail(addForm.manager_email)) {
            alert("담당자 메일 형식을 확인해 주세요.");
            return;
        }

        try {
            const response = await fetch("/api/businesses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(addForm)
            });

            const createResult = await response.json();
            if (!response.ok) throw new Error(createResult.error || "등록에 실패했습니다.");

            let completionMessage = "사업장 등록이 완료되었습니다.";
            if (createResult.nationalSupportFollowUp?.eligible && createResult.data?.id) {
                try {
                    const followUpResponse = await fetch("/api/businesses/national-support/apply", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            target_id: createResult.data.id,
                            sanjae: addForm.sanjae,
                            commencement: addForm.commencement,
                            representative: addForm.representative_name,
                            contact_name: addForm.manager_name || "",
                            contact_phone: addForm.manager_mobile || "",
                            period: addForm.period,
                            code: addForm.code,
                            year: addForm.year,
                            mode: createResult.nationalSupportFollowUp.mode || "lookup_only",
                        }),
                    });
                    const followUpResult = await followUpResponse.json();
                    if (!followUpResponse.ok) {
                        throw new Error(followUpResult.error || "건강디딤돌 처리 요청 실패");
                    }
                    completionMessage += `\n${followUpResult.message || "건강디딤돌 결과조회가 시작되었습니다."}`;
                } catch (followUpError) {
                    completionMessage += `\n건강디딤돌 처리 요청은 실패했습니다. 목록의 조회 버튼으로 재시도할 수 있습니다.\n사유: ${followUpError instanceof Error ? followUpError.message : String(followUpError)}`;
                }
            } else if (!addForm.period?.includes("(수시)")) {
                completionMessage += "\n건강디딤돌 정보가 부족하여 사업장만 등록했습니다.";
            }

            alert(completionMessage);
            setIsAddModalOpen(false);
            resetAddForm();
            fetchData();

            if (createResult.newBusinessCodeCreated && createResult.data) {
                const created = createResult.data;
                const newItem = {
                    ...created,
                    isRegistered: created.is_registered === "실시",
                    is_registered_text: created.is_registered || "미실시",
                    designated_office: created.office_jurisdiction || "",
                    sanjae: created.industrial_accident_number || "",
                    commencement: created.commencement_number || "",
                    unpaid_count: 0,
                    national_unpaid_count: 0,
                    unpaid_details: [],
                } as BusinessEntry;
                window.setTimeout(() => handleEditClick(newItem), 0);
            }
        } catch (error) {
            console.error("Registration error:", error);
            alert(`등록 중 오류가 발생했습니다.\n${error instanceof Error ? error.message : String(error)}`);
        }
    };

    // Fetch Raw Data
    const fetchData = useCallback(async (options?: { silent?: boolean }) => {
        if (dataFetchInFlightRef.current) return;
        dataFetchInFlightRef.current = true;

        const [year, period] = filters.yearPeriod.split("-");
        if (!year || !period) {
            dataFetchInFlightRef.current = false;
            return;
        }

        if (!options?.silent) {
            setLoading(true);
        }
        try {
            const params = new URLSearchParams();
            params.append("year", year);
            params.append("period", period);

            const response = await fetch(`/api/businesses?${params.toString()}`, {
                cache: "no-store",
            });
            if (!response.ok) throw new Error("Failed to fetch data");

            const result = await response.json();
            const fetchedData: BusinessEntry[] = result.businesses || [];

            setData(fetchedData);
            if (options?.silent) {
                setSelectedBusinessIds((previous) =>
                    retainAvailableBusinessIds(previous, fetchedData)
                );
            } else {
                setSelectedBusinessIds(new Set());
            }
        } catch (error) {
            console.error("Error fetching businesses:", error);
        } finally {
            if (!options?.silent) {
                setLoading(false);
            }
        }
        dataFetchInFlightRef.current = false;
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

        // Custom / Dynamic Sort
        if (sortConfig && sortConfig.direction) {
            const { key, direction } = sortConfig;
            result.sort((a, b) => {
                let valA: any = "";
                let valB: any = "";

                if (key === "period") {
                    valA = a.period || "";
                    valB = b.period || "";
                } else if (key === "is_registered_text") {
                    valA = a.is_registered_text || "미실시";
                    valB = b.is_registered_text || "미실시";
                } else if (key === "national_support_status") {
                    valA = getNationalSupportDisplayStatus({
                        ...a,
                        industrial_accident_number: a.industrial_accident_number || a.sanjae,
                        commencement_number: a.commencement_number || a.commencement,
                    }) || "";
                    valB = getNationalSupportDisplayStatus({
                        ...b,
                        industrial_accident_number: b.industrial_accident_number || b.sanjae,
                        commencement_number: b.commencement_number || b.commencement,
                    }) || "";
                } else if (key === "plan_manager") {
                    valA = a.plan_manager || "";
                    valB = b.plan_manager || "";
                } else if (key === "business_category") {
                    valA = a.business_category || "";
                    valB = b.business_category || "";
                } else if (key === "business_name") {
                    valA = a.business_name || "";
                    valB = b.business_name || "";
                } else if (key === "address") {
                    valA = a.address || "";
                    valB = b.address || "";
                } else if (key === "office_jurisdiction") {
                    valA = toShortName(a.office_jurisdiction || "") || "";
                    valB = toShortName(b.office_jurisdiction || "") || "";
                } else if (key === "unpaid_count") {
                    valA = (a.unpaid_count || 0) + (a.national_unpaid_count || 0);
                    valB = (b.unpaid_count || 0) + (b.national_unpaid_count || 0);
                } else if (key === "previous_measurement_date") {
                    valA = a.previous_measurement_date || "";
                    valB = b.previous_measurement_date || "";
                } else if (key === "future_measurement_period") {
                    valA = a.future_measurement_period || 0;
                    valB = b.future_measurement_period || 0;
                } else if (key === "measurement_month") {
                    const mA = a.measurement_month ? parseInt(String(a.measurement_month), 10) : null;
                    const mB = b.measurement_month ? parseInt(String(b.measurement_month), 10) : null;
                    if (mA !== null) {
                        valA = mA;
                    } else {
                        const schedA = calculateScheduledMonth(a.previous_measurement_date, a.future_measurement_period || 6);
                        valA = schedA !== "-" ? parseInt(schedA, 10) : 99;
                    }
                    if (mB !== null) {
                        valB = mB;
                    } else {
                        const schedB = calculateScheduledMonth(b.previous_measurement_date, b.future_measurement_period || 6);
                        valB = schedB !== "-" ? parseInt(schedB, 10) : 99;
                    }
                } else if (key === "future_measurement_date") {
                    valA = a.future_measurement_date || calculateScheduledDate(a.previous_measurement_date, a.future_measurement_period || 6);
                    valB = b.future_measurement_date || calculateScheduledDate(b.previous_measurement_date, b.future_measurement_period || 6);
                    if (valA === "-") valA = "9999-99-99";
                    if (valB === "-") valB = "9999-99-99";
                } else if (key === "measurer_id") {
                    valA = measurers.find((m) => m.id === a.measurer_id)?.name || "";
                    valB = measurers.find((m) => m.id === b.measurer_id)?.name || "";
                } else if (key === "measurement_date") {
                    valA = a.measurement_date || "";
                    valB = b.measurement_date || "";
                } else if (key === "notes") {
                    valA = a.notes || "";
                    valB = b.notes || "";
                }

                if (valA < valB) return direction === "asc" ? -1 : 1;
                if (valA > valB) return direction === "asc" ? 1 : -1;
                return 0;
            });
        } else {
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
        }

        setFilteredData(result);
    }, [data, filters, sortConfig, measurers]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const hasPendingNationalSupport = data.some(item =>
        ["신청중", "조회중", "신청완료대기"].includes(item.sync_status || "")
    );

    // 깡통컴의 DB 변경을 화면에 반영합니다. 진행 중에는 빠르게, 평상시에는 낮은 빈도로 확인합니다.
    useEffect(() => {
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") {
                fetchData({ silent: true });
            }
        };

        const timer = window.setInterval(
            refreshWhenVisible,
            hasPendingNationalSupport ? 3000 : 15000,
        );
        window.addEventListener("focus", refreshWhenVisible);
        document.addEventListener("visibilitychange", refreshWhenVisible);

        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", refreshWhenVisible);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
        };
    }, [fetchData, hasPendingNationalSupport]);

    const handleSearch = () => {
        fetchData();
        void refreshCoordinateSummary();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSearch();
    };

    const handleEditClick = (item: BusinessEntry) => {
        setEditingItem(item);

        // 보고서 담당자(measurer_id)는 측정자와 별개 역할이므로 측정자(collaborators)에 강제 포함하지 않는다.
        const initialForm = {
            ...item,
            sanjae: item.industrial_accident_number || item.sanjae || "",
            commencement: item.commencement_number || item.commencement || ""
        };

        setEditForm(initialForm);
        setIsEditModalOpen(true);
    };

    const handleSaveEdit = async () => {
        if (!editingItem) return;

        // 필수값 검증 (사업장명, 코드 누락 방지)
        if (!editForm.business_name || !editForm.business_name.trim()) {
            alert("사업장명은 필수 입력 항목입니다.");
            return;
        }

        if (!editForm.code || !editForm.code.trim()) {
            alert("사업장 코드는 필수 입력 항목입니다.");
            return;
        }

        if (!isValidOptionalManagerEmail(editForm.manager_email)) {
            alert("담당자 메일 형식을 확인해 주세요.");
            return;
        }

        try {
            // 저장이 성공(Resolve)한 후에만 모달을 닫음
            const updatesToSave = { ...editForm };
            (["manager_name", "manager_mobile", "manager_email"] as const).forEach(field => {
                if (String(editForm[field] ?? "") === String(editingItem[field] ?? "")) {
                    delete updatesToSave[field];
                }
            });
            await saveChanges(editingItem.code, updatesToSave, editingItem);
            setIsEditModalOpen(false);

            // 저장 단계에서는 조회하지 않습니다. 목록의 파란 새로고침 버튼을 눌렀을 때만
            // 건강디딤돌 신청결과 DB 확인 → 공단 조회 순서로 진행합니다.
            setTimeout(() => fetchData(), 500);
        } catch (err) {
            // saveChanges 내부 catch 블록에서 이미 에러 얼럿창을 띄우므로, 모달을 닫지 않고 입력을 보존하며 리턴함
            console.error("수정 저장 실패:", err);
        }
    };

    const handleCheckResult = async (item: BusinessEntry) => {
        if (item.period && item.period.includes("(수시)")) {
            alert("수시 주기는 건강디딤돌 지원 대상이 아닙니다.");
            return;
        }

        const sanjaeVal = item.industrial_accident_number || item.sanjae;
        const commencementVal = item.commencement_number || item.commencement;
        const representativeVal = item.representative_name;

        if (!canRequestNationalSupportLookup({
            ...item,
            industrial_accident_number: sanjaeVal,
            commencement_number: commencementVal,
            representative_name: representativeVal,
        })) {
            alert("조회 조건을 확인해주세요. 정기 측정이며 산재·개시번호 11자리와 대표자명이 필요합니다.");
            return;
        }

        // Optimistic update
        setData(prev => prev.map(d => d.id === item.id ? { ...d, sync_status: "조회중", sync_error_message: null } : d));

        try {
            const response = await fetch("/api/businesses/national-support/apply", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    target_id: item.id,
                    sanjae: sanjaeVal,
                    commencement: commencementVal,
                    representative: representativeVal,
                    contact_name: item.manager_name || "담당자",
                    contact_phone: item.manager_mobile || "010-0000-0000",
                    period: item.period,
                    code: item.code,
                    year: item.year,
                    mode: hasNationalSupportApplicationInformation({
                        industrial_accident_number: sanjaeVal,
                        commencement_number: commencementVal,
                        representative_name: representativeVal,
                        manager_name: item.manager_name,
                        manager_mobile: item.manager_mobile,
                    }) ? "apply_if_missing" : "lookup_only",
                })
            });

            const resData = await response.json();

            if (!response.ok) {
                throw new Error(resData.error || "결과 확인 요청 실패");
            }

            if (resData.instantSync) {
                alert(resData.message || "건강디딤돌 신청결과가 즉시 반영되었습니다.");
                fetchData();
            } else {
                alert(resData.message || "조회 요청이 백그라운드 작업자에 전달되었습니다. 완료될 때까지 결과를 자동 갱신합니다.");
            }

        } catch (error) {
            console.error("Check result error:", error);
            alert(`조회 요청 중 오류가 발생했습니다.\n${error instanceof Error ? error.message : String(error)}`);
            fetchData();
        }
    };

    const saveChanges = async (
        code: string,
        updates: Partial<BusinessEntry>,
        identity?: Pick<BusinessEntry, "id" | "year" | "period">,
    ) => {
        const [filterYear, filterPeriod] = filters.yearPeriod.split("-");
        const targetYear = identity?.year ?? parseInt(filterYear, 10);
        const targetPeriod = identity?.period || filterPeriod;
        const previousData = [...data]; // For rollback

        try {
            // DB 컬럼 매핑 및 클렌징
            const sanitizeUpdates = (raw: Partial<BusinessEntry>) => {
                const validColumns = [
                    'business_name', 'business_number', 'business_category', 'address',
                    'office_jurisdiction', 'is_registered', 'plan_manager',
                    'manager_name', 'manager_mobile', 'manager_email',
                    'management_status', 'notes', 'measurement_date', 'measurement_end_date', 'future_measurement_period',
                    'future_measurement_date', 'measurer_id', 'link_measurer_id', 'period', 'collaborators', 'daily_staff',
                    'representative_name', 'industrial_accident_number', 'commencement_number',
                    'business_type', 'process_changed'
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

                if (raw.sanjae !== undefined) sanitized.industrial_accident_number = raw.sanjae;
                if (raw.commencement !== undefined) sanitized.commencement_number = raw.commencement;
                if (raw.representative_name !== undefined) sanitized.representative_name = raw.representative_name;

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
            if (cleanUpdates.industrial_accident_number !== undefined) {
                optimisticUpdates.sanjae = cleanUpdates.industrial_accident_number;
                optimisticUpdates.industrial_accident_number = cleanUpdates.industrial_accident_number;
            }
            if (cleanUpdates.commencement_number !== undefined) {
                optimisticUpdates.commencement = cleanUpdates.commencement_number;
                optimisticUpdates.commencement_number = cleanUpdates.commencement_number;
            }
            if (cleanUpdates.representative_name !== undefined) {
                optimisticUpdates.representative_name = cleanUpdates.representative_name;
            }

            setData(prev => prev.map(item => item.code === code ? { ...item, ...optimisticUpdates } : item));

            // 2. API Call
            const response = await fetch("/api/businesses", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: identity?.id,
                    code: code,
                    year: targetYear,
                    period: targetPeriod,
                    updates: cleanUpdates
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.details || errData.error || "Failed to update");
            }

            // steady-state: 저장 응답에 V2 plan이 포함되면 수정 모달 상태를 즉시 갱신한다.
            // (페이지 새로고침 없이 예비조사 정보 영역이 최신 plan을 보여주기 위함)
            try {
                const result = await response.json();
                if (result.preliminarySurveyV2Plan && editingItem && String(editingItem.id) === String(identity?.id)) {
                    setEditForm(previous => ({
                        ...previous,
                        preliminary_survey_v2_plan: {
                            ...(previous.preliminary_survey_v2_plan as any),
                            ...result.preliminarySurveyV2Plan,
                        } as BusinessEntry["preliminary_survey_v2_plan"],
                    }));
                }
            } catch (parseError) {
                console.warn("저장 응답 V2 plan 파싱 실패(무시):", parseError);
            }

        } catch (error) {
            console.error("Update error:", error);
            alert(`수정 중 오류가 발생했습니다.\n${error instanceof Error ? error.message : String(error)}`);
            setData(previousData); // Rollback to previous data
            throw error;
        }
    };

    const handleMeasurerChange = (item: BusinessEntry, newMeasurerId: string) => {
        const measurerId = newMeasurerId ? parseInt(newMeasurerId) : null;
        saveChanges(item.code, { measurer_id: measurerId });
    };

    const handlePreliminarySurveyRecommendation = async (targetIds: number[]) => {
        if (!targetIds.length) return;
        setRecommendingTargetIds(prev => new Set([...prev, ...targetIds]));
        try {
            const response = await fetch("/api/preliminary-survey-v2/recommend", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ targetIds }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "예비조사 추천에 실패했습니다.");
            const planByTargetId = new Map((result.plans || []).map((plan: any) => [
                Number(plan.measurement_target_business_id), plan,
            ]));
            setData(previous => previous.map(item => {
                const plan = planByTargetId.get(Number(item.id));
                return plan ? { ...item, preliminary_survey_v2_plan: plan as BusinessEntry["preliminary_survey_v2_plan"] } : item;
            }));
            const manualRequired = (result.results || []).filter((item: any) => item.status === "manual_required").length;
            alert(manualRequired
                ? `${targetIds.length}건 계산 완료, ${manualRequired}건은 수동 조정이 필요합니다.`
                : `${targetIds.length}건의 예비조사 추천을 즉시 반영했습니다.`);
        } catch (error) {
            alert(error instanceof Error ? error.message : "예비조사 추천에 실패했습니다.");
        } finally {
            setRecommendingTargetIds(previous => {
                const next = new Set(previous); targetIds.forEach(id => next.delete(id)); return next;
            });
        }
    };

    const handleManualV2PlanChange = async (recommendedDate: string, participantUserIds: number[], confirmed = false) => {
        if (!editingItem) return;
        const response = await fetch(`/api/preliminary-survey-v2/${editingItem.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ recommendedDate, participantUserIds, confirm: confirmed }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "예비조사 계획 수정에 실패했습니다.");

        // 경력자 2명 이상 조합: 사용자 확인 전에는 저장되지 않으므로, 확인 후 재요청한다.
        if (result.requiresUserConfirmation) {
            const ok = window.confirm(
                result.message || "경력자 2명이 예비조사자로 지정되었습니다. 이 조합으로 확정하시겠습니까?",
            );
            if (!ok) return { cancelled: true };
            return handleManualV2PlanChange(recommendedDate, participantUserIds, true);
        }

        setEditForm(previous => ({ ...previous, preliminary_survey_v2_plan: result.plan }));
        setData(previous => previous.map(item => String(item.id) === String(editingItem.id)
            ? { ...item, preliminary_survey_v2_plan: result.plan } : item));
        return { cancelled: false };
    };

    // === 예비조사 예외 정비 (관리자 전용, C 상태 "연결 정비") ===
    // 확정(sequence_number 부여) 이후의 예외 수정 경로. 일반 사용자에게는 노출하지 않는다.
    const [repairOpen, setRepairOpen] = useState(false);
    const [repairContext, setRepairContext] = useState<AdminRepairContext | null>(null);
    const [repairParticipantIds, setRepairParticipantIds] = useState<number[]>([]);
    const [repairLinkMeasurerId, setRepairLinkMeasurerId] = useState<number | null>(null);
    const [repairReason, setRepairReason] = useState("");
    const [repairLoading, setRepairLoading] = useState(false);
    const [repairSaving, setRepairSaving] = useState(false);
    const [repairError, setRepairError] = useState<string | null>(null);

    const openRepairModal = async (form: Partial<BusinessEntry>) => {
        const targetId = Number(form.id);
        if (!targetId) return;
        setRepairTargetId(targetId);
        setRepairOpen(true);
        setRepairError(null);
        setRepairLoading(true);
        try {
            const response = await fetch(`/api/preliminary-survey-v2/admin-repair?targetId=${targetId}`, {
                cache: "no-store",
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "정비 정보를 불러오지 못했습니다.");
            setRepairContext(result);
            // 기본 선택은 현재 V2 예비조사자 유지. legacy 값을 자동 선택·저장하지 않는다.
            setRepairParticipantIds((result.plan?.participant_user_ids || []).map(Number));
            setRepairLinkMeasurerId(result.target?.link_measurer_id ?? null);
            setRepairReason("");
        } catch (error) {
            setRepairError(error instanceof Error ? error.message : String(error));
            setRepairOpen(false);
            alert(error instanceof Error ? error.message : "정비 화면을 열지 못했습니다.");
        } finally {
            setRepairLoading(false);
        }
    };
    const [repairTargetId, setRepairTargetId] = useState<number | null>(null);

    // 정정된 예비조사자 ∩ 실제 측정자 = 예·측 후보
    const repairLinkCandidatesForContext = (): string[] => {
        if (!repairContext) return [];
        return repairLinkCandidates(
            repairParticipantIds,
            repairContext.users.map((user) => ({ id: user.id, name: user.name })),
            repairContext.staffNames,
        ).map((user) => user.name);
    };

    const toggleRepairParticipant = (userId: number) => {
        setRepairParticipantIds((previous) => {
            if (previous.includes(userId)) {
                const next = previous.filter((id) => id !== userId);
                // 예·측이 정정 예비조사자에서 빠지면 예·측 선택을 해제한다.
                if (repairLinkMeasurerId === userId) setRepairLinkMeasurerId(null);
                return next;
            }
            return [...previous, userId];
        });
    };

    const handleRepairSave = async () => {
        if (!repairContext || repairTargetId == null) return;
        const reason = repairReason.trim();
        if (!reason) {
            setRepairError("변경 사유를 입력해 주세요.");
            return;
        }
        const participants = repairContext.users.filter((user) => repairParticipantIds.includes(user.id));
        if (participants.length === 0) {
            setRepairError("정정 후 예비조사자를 선택해 주세요.");
            return;
        }
        if (repairLinkMeasurerId == null) {
            setRepairError("예·측을 선택해 주세요.");
            return;
        }
        const candidates = repairLinkCandidatesForContext();
        const linkName = repairContext.users.find((user) => user.id === repairLinkMeasurerId)?.name;
        if (!linkName || !candidates.includes(linkName)) {
            setRepairError("예·측은 정정 후 예비조사자이면서 실제 측정 인원에 포함된 인원을 선택해 주세요.");
            return;
        }

        setRepairSaving(true);
        setRepairError(null);
        try {
            const response = await fetch("/api/preliminary-survey-v2/admin-repair", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    targetId: repairTargetId,
                    participantUserIds: participants.map((user) => user.id),
                    participantNames: participants.map((user) => user.name),
                    linkMeasurerId: repairLinkMeasurerId,
                    reason,
                }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "예비조사 예외 정비에 실패했습니다.");

            alert(result.message || "예비조사 예외 정비가 완료되었습니다.");
            setRepairOpen(false);

            // 수정 모달과 목록 데이터 즉시 갱신
            const updatedPlan = result.plan;
            if (updatedPlan && editForm && String(editForm.id) === String(repairTargetId)) {
                setEditForm(previous => ({
                    ...previous,
                    link_measurer_id: repairLinkMeasurerId,
                    preliminary_survey_v2_plan: previous.preliminary_survey_v2_plan
                        ? {
                            ...previous.preliminary_survey_v2_plan,
                            participant_user_ids: updatedPlan.participant_user_ids || [],
                            participant_names: updatedPlan.participant_names || [],
                            plan_origin: updatedPlan.plan_origin || "manual",
                        }
                        : previous.preliminary_survey_v2_plan,
                }));
            }
            fetchData();
        } catch (error) {
            setRepairError(error instanceof Error ? error.message : String(error));
        } finally {
            setRepairSaving(false);
        }
    };

    // === 예비조사 일정 묶음 추천 (주소 기반, READ-ONLY) ===
    interface GroupRecItem {
        id: number;
        code: string;
        name: string;
        kind: "new" | "existing";
        measurementDate: string;
        address: string | null;
        linkCandidates: string[];
    }
    interface GroupRecGroup {
        date: string;
        surveyorUserId: number | null;
        surveyorName: string | null;
        items: GroupRecItem[];
    }
    interface GroupRecBlocked {
        id: number;
        code: string;
        name: string;
        reason: string;
    }
    interface GroupRecOutput {
        targetCount: number;
        groups: GroupRecGroup[];
        blocked: GroupRecBlocked[];
    }
    const [groupModalOpen, setGroupModalOpen] = useState(false);
    const [groupLoading, setGroupLoading] = useState(false);
    const [groupError, setGroupError] = useState<string | null>(null);
    const [groupResult, setGroupResult] = useState<GroupRecOutput | null>(null);
    const [groupSelectedIds, setGroupSelectedIds] = useState<Set<number>>(new Set());

    const openGroupRecommendation = async () => {
        const [filterYearText, filterPeriod] = filters.yearPeriod.split("-");
        const year = Number(filterYearText);
        if (!Number.isInteger(year) || !filterPeriod) {
            alert("측정년도/주기를 먼저 선택해 주세요.");
            return;
        }
        setGroupModalOpen(true);
        setGroupLoading(true);
        setGroupError(null);
        setGroupResult(null);
        setGroupSelectedIds(new Set());
        try {
            const response = await fetch(
                `/api/preliminary-survey-v2/group-recommend?year=${year}&period=${encodeURIComponent(filterPeriod)}`,
                { cache: "no-store" },
            );
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "묶음 추천을 불러오지 못했습니다.");
            setGroupResult(result);
            setGroupSelectedIds(new Set((result.groups || []).flatMap((g: GroupRecGroup) => g.items.map((i) => i.id))));
        } catch (error) {
            setGroupError(error instanceof Error ? error.message : String(error));
        } finally {
            setGroupLoading(false);
        }
    };

    const toggleGroupTarget = (id: number) => {
        setGroupSelectedIds((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const [groupConfirming, setGroupConfirming] = useState(false);
    const [groupConfirmError, setGroupConfirmError] = useState<string | null>(null);

    // 선택된 사업장만 확정한다 (제외 사업장은 무변경). 서버가 최신 데이터로 재검증 후 날짜 그룹별로 원자적으로 저장한다.
    const handleGroupConfirm = async () => {
        if (!groupResult || groupSelectedIds.size === 0) return;
        const selectedByGroup = groupResult.groups
            .map((g) => ({
                date: g.date,
                surveyorName: g.surveyorName,
                ids: g.items.map((i) => i.id).filter((id) => groupSelectedIds.has(id)),
            }))
            .filter((g) => g.ids.length > 0);
        const totalSelected = selectedByGroup.reduce((sum, g) => sum + g.ids.length, 0);
        const ok = window.confirm(
            `선택 ${totalSelected}건의 예비조사일을 확정할까요?\n` +
            "확정된 사업장은 다음 추천 대상에서 제외되며, 제외한 사업장은 변경되지 않습니다.",
        );
        if (!ok) return;

        setGroupConfirming(true);
        setGroupConfirmError(null);
        const results: Array<{ date: string; ok: boolean; failed: any[] }> = [];
        try {
            for (const group of selectedByGroup) {
                const response = await fetch("/api/preliminary-survey-v2/group-confirm", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ date: group.date, targetIds: group.ids }),
                });
                const result = await response.json();
                results.push({ date: group.date, ok: response.ok, failed: result.failed || [] });
            }
            const allOk = results.every((r) => r.ok);
            if (allOk) {
                alert(`${totalSelected}건 예비조사일을 확정했습니다.`);
            } else {
                const lines = results.flatMap((r) => r.failed.map((f: any) => `${f.code}: ${f.reason}`));
                setGroupConfirmError(lines.length ? lines.join("\n") : "확정에 실패했습니다.");
                return;
            }
            // 확정 후 추천 목록 재조회: 확정(manual plan) 대상은 추천 대상에서 제외된다.
            await openGroupRecommendation();
            fetchData();
        } catch (error) {
            setGroupConfirmError(error instanceof Error ? error.message : String(error));
        } finally {
            setGroupConfirming(false);
        }
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
            "코드": item.code,
            "사업자등록번호": item.business_number || "",
            "산재관리번호": item.industrial_accident_number || item.sanjae || "",
            "사업장명": item.business_name,
            "소재지": item.address,
            "실시여부": item.is_registered_text === '확정' || item.is_registered_text === '실시' ? '실시' : item.is_registered_text === '미확정' || item.is_registered_text === '미실시' ? '미실시' : item.is_registered_text === '종료' || item.is_registered_text === '거래종료' ? '거래종료' : item.is_registered_text || '미실시',
            "국고결과": item.national_support_status,
            "계획담당": item.plan_manager,
            "업종분류": item.business_category,
            "담당자명": item.manager_name || "",
            "휴대폰": item.manager_mobile || "",
            "유선전화": item.manager_phone || item.phone || "",
            "담당자 메일": item.manager_email || "",
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
            const effectiveCycleMonths = cycleMonths === 1 ? 12 : cycleMonths;
            const match = prevDateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (!match) return "-";

            const year = parseInt(match[1], 10);
            const month = parseInt(match[2], 10);
            const day = parseInt(match[3], 10);
            const targetMonthIndex = month - 1 + effectiveCycleMonths;
            const targetYear = year + Math.floor(targetMonthIndex / 12);
            const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
            const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
            const targetDay = Math.min(day, lastDayOfTargetMonth);

            const yyyy = targetYear;
            const mm = String(targetMonth + 1).padStart(2, "0");
            const dd = String(targetDay).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
        } catch (e) {
            return "-";
        }
    };

    const calculateScheduledMonth = (prevDateStr: string | null, cycleMonths: number | null) => {
        const scheduledDate = calculateScheduledDate(prevDateStr, cycleMonths);
        if (scheduledDate === "-") return "-";
        return `${parseInt(scheduledDate.slice(5, 7), 10)}월`;
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

    const swapBaeAndKim = (prevDate: string | null | undefined, newDate: string | null | undefined, form: Partial<BusinessEntry>) => {
        const isPrevAfter = !prevDate || prevDate >= "2026-06-09";
        const isNewAfter = !newDate || newDate >= "2026-06-09";

        if (isPrevAfter !== isNewAfter) {
            let nextMeasurerId = form.measurer_id;
            let nextLinkMeasurerId = form.link_measurer_id;
            let nextCollaborators = form.collaborators ? form.collaborators.split(",").map(c => c.trim()).filter(Boolean) : [];

            if (isNewAfter) {
                // 배윤민(id: 14) -> 김민영(id: 20)
                if (nextMeasurerId === 14) {
                    nextMeasurerId = 20;
                }
                if (nextLinkMeasurerId === 14) {
                    nextLinkMeasurerId = 20;
                }
                if (nextCollaborators.includes("배윤민")) {
                    nextCollaborators = nextCollaborators.filter(c => c !== "배윤민");
                    if (!nextCollaborators.includes("김민영")) nextCollaborators.push("김민영");
                }
            } else {
                // 김민영(id: 20) -> 배윤민(id: 14)
                if (nextMeasurerId === 20) {
                    nextMeasurerId = 14;
                }
                if (nextLinkMeasurerId === 20) {
                    nextLinkMeasurerId = 14;
                }
                if (nextCollaborators.includes("김민영")) {
                    nextCollaborators = nextCollaborators.filter(c => c !== "김민영");
                    if (!nextCollaborators.includes("배윤민")) nextCollaborators.push("배윤민");
                }
            }

            form.measurer_id = nextMeasurerId;
            form.link_measurer_id = nextLinkMeasurerId;
            form.collaborators = nextCollaborators.length > 0 ? nextCollaborators.join(",") : null;
        }
    };

    // Grid Column Template
    // V2 예비조사 추천 결과를 항상 노출한다.
    const gridTemplateCols = "40px 45px 60px 80px 100px 70px 90px 90px minmax(140px, 1.5fr) minmax(160px, 2fr) 60px 50px 80px 80px 50px 80px 90px 110px 170px 80px 40px";

    const renderSortIcon = (key: string) => {
        const isSorted = sortConfig?.key === key;
        const direction = isSorted ? sortConfig?.direction : null;
        
        return (
            <span className="inline-flex flex-col ml-1 justify-center items-center h-4 w-3 select-none shrink-0">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 320 512"
                    className={`h-2.5 w-2.5 transition-colors duration-150 ${direction === "asc" ? "text-blue-600 font-bold" : "text-slate-400/40"}`}
                    fill="currentColor"
                >
                    <path d="M182.6 137.4c-12.5-12.5-32.8-12.5-45.3 0l-128 128c-9.2 9.2-11.9 22.9-6.9 34.9s16.6 19.8 29.6 19.8H288c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-128-128z" />
                </svg>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 320 512"
                    className={`h-2.5 w-2.5 mt-[2px] transition-colors duration-150 ${direction === "desc" ? "text-blue-600 font-bold" : "text-slate-400/40"}`}
                    fill="currentColor"
                >
                    <path d="M182.6 374.6c-12.5 12.5-32.8 12.5-45.3 0l-128-128c-9.2-9.2-11.9-22.9-6.9-34.9s16.6-19.8 29.6-19.8H288c12.9 0 24.6 7.8 29.6 19.8s2.2 25.7-6.9 34.9l-128 128z" />
                </svg>
            </span>
        );
    };

    // === 예비조사 정보 표시/예·측 도우미 ===
    // "예·측" = 예비조사자 ∩ 실제 측정자 (내부 필드 link_measurer_id)
    const actualMeasurerNames = (form: Partial<BusinessEntry>): string[] =>
        collectMeasurementStaffNames({ collaborators: form.collaborators, dailyStaff: form.daily_staff });

    const v2SurveyorNames = (form: Partial<BusinessEntry>): string[] =>
        (form.preliminary_survey_v2_plan?.participant_names || []).map((n) => String(n).trim()).filter(Boolean);

    const linkMeasurerCandidatesForForm = (form: Partial<BusinessEntry>): User[] => {
        const actual = new Set(actualMeasurerNames(form));
        const v2 = new Set(v2SurveyorNames(form));
        const valid = new Set([...actual].filter((name) => v2.has(name)));
        return measurers.filter((m) => valid.has(m.name));
    };

    const linkStatusForForm = (form: Partial<BusinessEntry>): { kind: "A" | "B" | "C" | "PLAN_NONE" | "NO_STAFF" } => {
        if (!form.preliminary_survey_v2_plan) return { kind: "PLAN_NONE" };
        const actual = actualMeasurerNames(form);
        if (actual.length === 0) return { kind: "NO_STAFF" };
        const v2 = new Set(v2SurveyorNames(form));
        const count = actual.filter((name) => v2.has(name)).length;
        if (count === 0) return { kind: "C" };
        if (count === 1) return { kind: "A" };
        return { kind: "B" };
    };

    const surveyMethodLabel = (method: string | undefined | null): string =>
        method === "field" ? "현장" : method === "phone" ? "유선" : "-";

    return (
        <div className="p-4 w-full min-w-[1400px]">
            {/* Sticky Container for Filter & Table Header */}
            <div className="sticky top-16 lg:top-[113px] z-40 space-y-4 bg-gray-50/95 backdrop-blur">
                <Card className="p-4 bg-white shadow-sm border-surface-200">
                    <div className="flex items-center justify-between gap-4 flex-wrap overflow-visible p-1">
                        {/* Filters Group */}
                        <div className="flex items-center gap-3 shrink-0">
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">측정년도/주기</span>
                                <CustomDropdown
                                    options={YEAR_PERIOD_OPTIONS}
                                    value={filters.yearPeriod}
                                    onChange={(e) => setFilters(prev => ({ ...prev, yearPeriod: e.target.value }))}
                                    className="w-[195px] h-9"
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
                            <Button onClick={openAddModal} variant="secondary" className="h-9 px-3 text-sm font-medium whitespace-nowrap">
                                신규등록
                            </Button>
                            <a href="/api/templates/measurement-target" download="측정대상사업장_등록양식.xlsx"
                                className="h-9 px-3 inline-flex items-center justify-center rounded-lg font-medium hover:bg-slate-100 border border-slate-200 text-slate-700 text-sm whitespace-nowrap ml-1" title="양식 다운로드">
                                <span className="text-lg leading-none">⬇</span>
                            </a>
                        </div>
                    </div>
                </Card>

                {/* Table Header Group (Title + Column Headers) */}
                <div className="bg-white border-b-0">
                    {/* Table Title & Count & Center Action Buttons & Filters */}
                    <div className="flex items-center justify-between px-3 py-2 border border-slate-200 border-b-0 rounded-t-xl bg-white gap-4 flex-wrap">
                        {/* Title & Count */}
                        <h3 className="text-lg font-bold text-slate-800 shrink-0 ml-1">
                            측정 대상 사업장 목록
                            <span className="ml-2 text-sm font-medium text-slate-500">
                                ({filteredData.length}/{data.length})
                            </span>
                        </h3>

                        {/* Center Action Buttons (Map & Geocoding) */}
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600" title="사업장 코드 기준 좌표 현황">
                                <span>전체 {coordinateSummary.total}</span>
                                <span className="text-emerald-700">정상 {coordinateSummary.valid}</span>
                                <span className="text-amber-700">미등록 {coordinateSummary.missing}</span>
                                <span className="text-rose-700">오류 {coordinateSummary.invalid}</span>
                            </div>
                            <Button
                                onClick={handleOpenMapViewer}
                                variant="secondary"
                                className="h-8 px-3 text-xs font-medium whitespace-nowrap bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100"
                                title="지도에서 위치 보기 - 별도 창으로 엽니다."
                            >
                                지도 열기 {selectedBusinessIds.size > 0 ? `(${selectedBusinessIds.size})` : ""}
                            </Button>
                            <Button
                                onClick={() => handleGeocodeBatch('selected')}
                                variant="secondary"
                                className="h-8 px-2.5 text-xs font-medium whitespace-nowrap bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100"
                                title="선택한 사업장의 좌표를 다시 조회합니다."
                            >
                                🗺️ 선택 좌표 재조회
                            </Button>
                            <Button
                                onClick={() => handleGeocodeBatch('missing')}
                                variant="secondary"
                                className="h-8 px-2.5 text-xs font-medium whitespace-nowrap bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200"
                                title="좌표가 없는 사업장만 일괄 재조회합니다."
                            >
                                미등록·오류 좌표 일괄 등록
                            </Button>
                            <Button
                                onClick={() => handleGeocodeBatch('suspicious')}
                                variant="secondary"
                                className="h-8 px-2.5 text-xs font-medium whitespace-nowrap bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                                title="동일한 위경도를 공유하는 의심 사업장을 재조회합니다."
                            >
                                ⚠️ 동일좌표 의심 재조회
                            </Button>
                        </div>

                        <Button
                            variant="secondary"
                            className="h-8 px-3 text-xs whitespace-nowrap"
                            disabled={selectedBusinessIds.size === 0}
                            onClick={() => handlePreliminarySurveyRecommendation([...selectedBusinessIds].map(Number))}
                        >
                            선택 사업장 예비조사 추천
                        </Button>

                        <Button
                            variant="secondary"
                            className="h-8 px-3 text-xs whitespace-nowrap"
                            onClick={openGroupRecommendation}
                        >
                            예비조사 일정 추천 (묶음)
                        </Button>

                        {/* Right Filters */}
                        <div className="flex items-center gap-4 shrink-0 mr-1">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">업종분류 :</span>
                                <Select
                                    options={businessCategories.length > 0 ? businessCategories : [{ value: "", label: "전체" }]}
                                    value={filters.businessCategory}
                                    onChange={(e) => setFilters(prev => ({ ...prev, businessCategory: e.target.value }))}
                                    className="w-[120px] h-9 py-1 text-sm text-center"
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold whitespace-nowrap text-slate-700">계획담당자 :</span>
                                <Select
                                    options={MANAGER_OPTIONS}
                                    value={filters.planManager}
                                    onChange={(e) => setFilters(prev => ({ ...prev, planManager: e.target.value }))}
                                    className="w-[120px] h-9 py-1 text-sm text-center"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Grid Header Row */}
                    <div className="bg-sky-100 font-bold text-sm text-black grid items-center text-center border-x border-t border-slate-200 border-b-2 border-sky-200" style={{ gridTemplateColumns: gridTemplateCols }}>
                        <div className="py-3 flex items-center justify-center">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                checked={filteredData.length > 0 && filteredData.every(item => selectedBusinessIds.has(item.id))}
                                onChange={handleToggleAllSelect}
                                aria-label="전체 사업장 선택"
                            />
                        </div>
                        <div className="py-3 text-center">No</div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("period")}>
                            주기 {renderSortIcon("period")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("is_registered_text")}>
                            실시여부 {renderSortIcon("is_registered_text")}
                        </div>
                        <div className="py-3 flex items-center justify-center gap-1 cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("national_support_status")}>
                            <span>국고</span>
                            {renderSortIcon("national_support_status")}
                            {user?.is_national_support_manager && (
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleBulkCheckResult();
                                    }}
                                    className="p-0.5 hover:bg-sky-200 rounded text-blue-600 font-bold pointer-events-auto cursor-pointer ml-1"
                                    title="현재 목록 국고 일괄 조회 실행"
                                >
                                    ⚙️
                                </button>
                            )}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("plan_manager")}>
                            계획담당 {renderSortIcon("plan_manager")}
                        </div>
                        <div className="py-3 px-2 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("business_category")}>
                            업종분류 {renderSortIcon("business_category")}
                        </div>
                        <div className="py-3 px-2 flex items-center justify-center">기본유형</div>
                        <div className="py-3 px-2 flex items-center justify-start pl-4 cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("business_name")}>
                            사업장명 {renderSortIcon("business_name")}
                        </div>
                        <div className="py-3 px-2 flex items-center justify-start pl-4 cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("address")}>
                            소재지 {renderSortIcon("address")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("office_jurisdiction")}>
                            관할 {renderSortIcon("office_jurisdiction")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("unpaid_count")}>
                            미수 {renderSortIcon("unpaid_count")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("previous_measurement_date")}>
                            전회측정 {renderSortIcon("previous_measurement_date")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("future_measurement_period")}>
                            향후측정주기 {renderSortIcon("future_measurement_period")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("measurement_month")}>
                            예정월 {renderSortIcon("measurement_month")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("future_measurement_date")}>
                            예정일 {renderSortIcon("future_measurement_date")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("measurer_id")}>
                            보고서 담당 {renderSortIcon("measurer_id")}
                        </div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("measurement_date")}>
                            실시일 {renderSortIcon("measurement_date")}
                        </div>
                        <div className="py-3 text-center">예비조사 추천</div>
                        <div className="py-3 flex items-center justify-center cursor-pointer hover:bg-sky-200/70 select-none transition-colors duration-150" onClick={() => handleSort("notes")}>
                            비고 {renderSortIcon("notes")}
                        </div>
                        <div className="py-3 text-center">관리</div>
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

                                    <div className="py-2 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                                        <input
                                            type="checkbox"
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                            checked={selectedBusinessIds.has(item.id)}
                                            onChange={() => handleToggleSelect(item.id)}
                                            aria-label={`${item.business_name} 선택`}
                                        />
                                    </div>
                                    <div className="text-center font-medium">{index + 1}</div>
                                <div className={`text-center text-xs ${item.period.includes("(수시)") ? "text-red-600 font-bold" : ""}`}>
                                    {item.period}
                                </div>
                                    <div className="px-1 text-center">
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
                                            style={{ textAlignLast: "center" }}
                                        >
                                            <option value="미실시" className="bg-white text-black">미실시</option>
                                            <option value="실시" className="bg-white text-black">실시</option>
                                            <option value="거래종료" className="bg-white text-black">거래종료</option>
                                        </select>
                                    </div>
                                <div className="text-center text-xs px-1 flex items-center justify-center gap-1.5">
                                    <span className={
                                        item.sync_status === "성공" && item.national_support_status === "대상"
                                            ? "text-green-600 font-semibold"
                                            : item.sync_status === "비대상대기"
                                                ? "text-red-600 font-semibold"
                                                : ""
                                    }>
                                        {getNationalSupportDisplayStatus({
                                            ...item,
                                            industrial_accident_number: item.industrial_accident_number || item.sanjae,
                                            commencement_number: item.commencement_number || item.commencement,
                                        })}
                                        {item.sync_status === "성공" && item.national_support_status === "대상" && " ✅"}
                                    </span>
                                    {(item.sync_status === "신청중" || item.sync_status === "조회중") && (
                                        <span className="inline-flex items-center text-[10px] bg-blue-100 text-blue-800 px-1 rounded animate-pulse" title="결과 조회 진행 중...">
                                            🔄
                                        </span>
                                    )}
                                    {item.sync_status === "실패" && (
                                        <span className="inline-flex items-center text-[10px] bg-red-100 text-red-800 px-1 rounded cursor-help" title={`조회 실패: ${item.sync_error_message || "시스템 연동 오류"}`}>
                                            ❌
                                        </span>
                                    )}
                                    {canRequestNationalSupportLookup({
                                        ...item,
                                        industrial_accident_number: item.industrial_accident_number || item.sanjae,
                                        commencement_number: item.commencement_number || item.commencement,
                                    }) && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleCheckResult(item);
                                            }}
                                            className="p-0.5 hover:bg-slate-200 rounded text-blue-500 font-bold"
                                            title="공단 결과 확인 및 DB 반영 조회 실행"
                                            disabled={item.sync_status === "신청중" || item.sync_status === "조회중"}
                                        >
                                            ⟳
                                        </button>
                                    )}
                                </div>
                                <div className="text-center text-xs px-1">{item.plan_manager || "-"}</div>
                                <div className="px-1 text-center text-xs break-words break-keep" title={item.business_category || ""}>{item.business_category || "-"}</div>
                                <div className="px-1 text-center text-xs leading-tight">
                                    {item.business_type ? (
                                        <div className="space-y-1">
                                            <span className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-700">
                                                {getBusinessTypeLabel(item.business_type)}
                                            </span>
                                            {item.process_changed === true && (
                                                <span className="block text-[10px] font-semibold text-amber-700">공정변경</span>
                                            )}
                                        </div>
                                    ) : item.process_changed === true ? (
                                        <span className="text-[10px] font-semibold text-amber-700">공정변경</span>
                                    ) : "-"}
                                </div>
                                <div className="px-1 text-left font-medium break-words break-keep" title={item.business_name}>{item.business_name}</div>
                                <div className="px-1 text-left text-xs leading-tight break-words break-keep">{item.address}</div>
                                <div className="text-center text-xs px-1">{toShortName(item.office_jurisdiction || "")}</div>
                                <div className="text-center px-1">
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
                                <div className="text-center text-xs px-1">{item.previous_measurement_date || "-"}</div>
                                <div className="text-center text-xs font-medium text-blue-600 px-1">
                                    {formatCycle(item.future_measurement_period)}
                                </div>
                                <div className="text-center text-xs px-1">{item.measurement_month ? `${item.measurement_month}월` : calculateScheduledMonth(item.previous_measurement_date, item.future_measurement_period || 6)}</div>
                                <div className="text-center text-xs text-slate-500 px-1">
                                    {item.future_measurement_date || calculateScheduledDate(item.previous_measurement_date, item.future_measurement_period || 6)}
                                </div>
                                <div className="px-1 text-center">
                                    {(() => {
                                        const calculatedDate = calculateScheduledDate(item.previous_measurement_date, item.future_measurement_period || 6);
                                        const targetDate = item.measurement_date || item.future_measurement_date || (calculatedDate !== "-" ? calculatedDate : null);
                                        const isAfter = !targetDate || targetDate >= "2026-06-09";
                                        const filteredMeasurers = measurers.filter(u => 
                                            isAfter ? u.name !== "배윤민" : u.name !== "김민영"
                                        );
                                        return (
                                            <select
                                                className="w-full text-xs h-7 border-slate-200 rounded focus:border-indigo-500 focus:ring focus:ring-indigo-100"
                                                value={item.measurer_id || ""}
                                                onChange={(e) => handleMeasurerChange(item, e.target.value)}
                                            >
                                                <option value="">선택</option>
                                                {filteredMeasurers.map(u => (
                                                    <option key={u.id} value={u.id}>{u.name}</option>
                                                ))}
                                            </select>
                                        );
                                    })()}
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
                                <div className="px-1 text-center text-[11px] leading-tight">
                                    {item.preliminary_survey_v2_plan?.status === "recommended" ? (
                                        <div>
                                            <div className="font-semibold text-blue-700">{item.preliminary_survey_v2_plan.recommended_date}</div>
                                            <div className="truncate" title={item.preliminary_survey_v2_plan.participant_names.join(", ")}>
                                                {item.preliminary_survey_v2_plan.participant_names.join(" + ")}
                                            </div>
                                        </div>
                                    ) : item.preliminary_survey_v2_plan?.status === "manual_required" ? (
                                        <div className="text-amber-700 font-semibold">수동 조정 필요</div>
                                    ) : <div className="text-slate-400">미추천</div>}
                                    <button
                                        type="button"
                                        className="mt-1 rounded bg-blue-50 px-2 py-0.5 text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                        disabled={recommendingTargetIds.has(Number(item.id)) || !item.measurement_date || !item.link_measurer_id}
                                        onClick={() => handlePreliminarySurveyRecommendation([Number(item.id)])}
                                    >
                                        {recommendingTargetIds.has(Number(item.id)) ? "계산 중" : "예비조사 추천"}
                                    </button>
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

            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title="사업장 상세 정보 수정"
                size="lg"
                headerActions={
                    editingItem &&
                    editingItem.year === 2026 &&
                    editingItem.period === "하반기" &&
                    editingItem.document_generation_enabled === true &&
                    editingItem.has_actual_measurement_journal === false ? (
                    <NewBusinessDocumentGeneration
                        businessId={Number(editingItem.id)}
                        business={editForm as unknown as Record<string, any>}
                        documentGenerationEnabled={editingItem.document_generation_enabled}
                        hasActualMeasurementJournal={editingItem.has_actual_measurement_journal}
                    />
                ) : undefined
                }
            >
                <div className="p-6">
                    {/* 섹션 1: 기본 정보 */}
                    <div className="mb-6">
                        <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">기본 정보</h4>
                        <div className="grid grid-cols-6 gap-4">
                            <div className="col-span-2">
                                <label className="block text-sm font-medium mb-1 text-slate-700">코드</label>
                                <Input value={editForm.code || ""} disabled className="bg-slate-100 text-slate-500" />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-sm font-medium mb-1 text-slate-700">측정년도</label>
                                <Input value={editForm.year || ""} disabled className="bg-slate-100 text-slate-500" />
                            </div>
                            <div className="col-span-2">
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
                            <div className="col-span-3">
                                <label className="block text-sm font-medium mb-1 text-slate-700">사업장명</label>
                                <Input value={editForm.business_name || ""} onChange={(e) => setEditForm(prev => ({ ...prev, business_name: e.target.value }))} />
                            </div>
                            <div className="col-span-3">
                                <label className="block text-sm font-medium mb-1 text-slate-700">사업자등록번호</label>
                                <Input
                                    value={formatBusinessNumber(editForm.business_number)}
                                    disabled
                                    className="bg-slate-100 text-slate-500 cursor-not-allowed"
                                    title="사업자등록번호는 사업장정보/측정사업장 엑셀 동기화 기준으로 반영됩니다."
                                />
                                <p className="mt-1 text-[11px] text-slate-400">
                                    사업장정보/측정사업장 엑셀 동기화 기준으로 자동 반영됩니다.
                                </p>
                            </div>
                            <div className="col-span-6">
                                <label className="block text-sm font-medium mb-1 text-slate-700">소재지</label>
                                <Input value={editForm.address || ""} onChange={(e) => setEditForm(prev => ({ ...prev, address: e.target.value }))} />
                            </div>
                            <div className="col-span-6">
                                <label className="block text-sm font-medium mb-1 text-slate-700">업종분류</label>
                                <Select
                                    options={businessCategories.map(c => c.value === "" ? { ...c, label: "선택" } : c)}
                                    value={editForm.business_category || ""}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, business_category: e.target.value }))}
                                />
                            </div>
                            <div className="col-span-6 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                <p className="mb-2 text-sm font-medium text-slate-700">기본유형</p>
                                <div className="flex flex-wrap gap-x-5 gap-y-2">
                                    {BUSINESS_TYPE_OPTIONS.map((option) => (
                                        <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={editForm.business_type === option.value}
                                                onChange={(e) => setEditForm(prev => ({ ...prev, business_type: e.target.checked ? option.value : null }))}
                                                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            {option.label}
                                        </label>
                                    ))}
                                    <label key="process_changed" className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                        <input
                                            type="checkbox"
                                            checked={editForm.process_changed === true}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, process_changed: e.target.checked }))}
                                            className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                                        />
                                        공정변경
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 섹션 2: 연락 및 정산 정보 */}
                    <div className="mb-6">
                        <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">연락 및 정산 정보</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">전화번호</label>
                                <Input value={editForm.phone || ""} readOnly className="bg-slate-50 text-slate-700" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">팩스</label>
                                <Input value={editForm.fax || ""} readOnly className="bg-slate-50 text-slate-700" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">근로자 수</label>
                                <Input value={editForm.total_employees ?? ""} readOnly className="bg-slate-50 text-slate-700" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">계산서 메일</label>
                                <Input value={editForm.invoice_email || ""} readOnly className="bg-slate-50 text-slate-700" />
                            </div>
                        </div>
                    </div>

                    {/* 섹션 3: 관리 정보 */}
                    <div className="mb-6">
                        <h4 className="text-md font-bold text-slate-800 border-b border-slate-200 pb-2 mb-3">관리 정보</h4>
                        <div className="grid grid-cols-3 gap-4 mb-4">
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">계획담당</label>
                                <Select options={PLAN_MANAGER_EDIT_OPTIONS} value={editForm.plan_manager || ""} onChange={(e) => setEditForm(prev => ({ ...prev, plan_manager: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">지정지청</label>
                                <Select options={OFFICE_OPTIONS} value={editForm.designated_office || ""} onChange={(e) => setEditForm(prev => ({ ...prev, designated_office: e.target.value }))} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1 text-slate-700">국고지원여부</label>
                                <div className="h-10 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center text-sm font-medium text-slate-700">
                                    {getNationalSupportDisplayStatus({
                                        ...editForm,
                                        industrial_accident_number: editForm.sanjae || editForm.industrial_accident_number,
                                        commencement_number: editForm.commencement || editForm.commencement_number,
                                    })}
                                </div>
                                {editForm.period?.includes("(수시)") && (
                                    <p className="text-[11px] text-red-600 font-semibold mt-1">
                                        수시 주기는 건강디딤돌 비대상으로 처리됩니다.
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="bg-blue-50/40 border border-blue-100 p-4 rounded-lg space-y-3 mt-3">
                                <div className="border-b border-blue-200 pb-2 mb-2">
                                    <h4 className="text-sm font-bold text-blue-800">건강디딤돌 정보 보완 (선택)</h4>
                                    <p className="text-[11px] text-slate-500 mt-1">일부 정보만 입력해도 저장할 수 있으며, 조회에는 산재·개시번호 11자리와 대표자명이 필요합니다.</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                                            산재관리번호
                                        </label>
                                        <Input
                                            value={editForm.sanjae || ""}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 11);
                                                setEditForm(prev => ({ ...prev, sanjae: val }));
                                            }}
                                            placeholder="예: 12345678901"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                                            사업개시번호
                                        </label>
                                        <Input
                                            value={editForm.commencement || ""}
                                            onChange={(e) => {
                                                const val = e.target.value.replace(/[^0-9]/g, "").slice(0, 11);
                                                setEditForm(prev => ({ ...prev, commencement: val }));
                                            }}
                                            placeholder="예: 00000000000"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">
                                            대표자명
                                        </label>
                                        <Input
                                            value={editForm.representative_name || ""}
                                            onChange={(e) => {
                                                setEditForm(prev => ({ ...prev, representative_name: e.target.value }));
                                            }}
                                            placeholder="예: 홍길동"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">측정업무 담당자명 (신청용)</label>
                                        <Input
                                            value={editForm.manager_name || ""}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, manager_name: e.target.value }))}
                                            placeholder="예: 홍길동"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">담당자 휴대전화</label>
                                        <Input
                                            value={editForm.manager_mobile || ""}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, manager_mobile: e.target.value }))}
                                            placeholder="010-0000-0000"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 mb-1">담당자 메일</label>
                                        <Input
                                            type="email"
                                            value={editForm.manager_email || ""}
                                            onChange={(e) => setEditForm(prev => ({ ...prev, manager_email: e.target.value }))}
                                            placeholder="name@example.com"
                                        />
                                    </div>
                                </div>
                                {editForm.sync_status && (
                                    <div className="text-xs mt-2 text-slate-600">
                                        현재 조회 상태: <span className="font-bold">{getNationalSupportDisplayStatus({
                                            ...editForm,
                                            industrial_accident_number: editForm.sanjae || editForm.industrial_accident_number,
                                            commencement_number: editForm.commencement || editForm.commencement_number,
                                        })}</span>
                                        {editForm.sync_status === "실패" && editForm.sync_error_message && (
                                            <p className="text-red-600 font-semibold mt-1">사유: {editForm.sync_error_message}</p>
                                        )}
                                    </div>
                                )}
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
                                       {/* 예비조사 정보 섹션 */}
                            <div className="col-span-2 rounded-lg border border-blue-200 bg-blue-50/30 p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-bold text-slate-800">예비조사 정보</label>
                                    {(() => {
                                        const plan = editForm.preliminary_survey_v2_plan;
                                        if (!plan) return null;
                                        if (linkStatusForForm(editForm).kind !== "C") return null;
                                        if (!isAdmin) return null;
                                        return (
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                className="h-6 text-[11px] px-2"
                                                onClick={() => openRepairModal(editForm)}
                                            >
                                                연결 정비
                                            </Button>
                                        );
                                    })()}
                                </div>
                                {(() => {
                                    const plan = editForm.preliminary_survey_v2_plan;
                                    if (!plan) {
                                        const noStaff = actualMeasurerNames(editForm).length === 0;
                                        const noDate = !editForm.measurement_date;
                                        return (
                                            <div className="space-y-1">
                                                <p className="text-sm text-slate-600">예비조사 계획 생성 대기</p>
                                                <p className="text-xs text-amber-700">
                                                    {noStaff
                                                        ? "사유: 실제 측정자를 먼저 선택하세요. 측정일과 실제 측정자가 정해지면 저장 시 자동으로 예비조사 계획이 생성됩니다."
                                                        : noDate
                                                            ? "사유: 측정일을 먼저 입력하세요."
                                                            : "측정일과 실제 측정자를 입력한 뒤 저장하면 예비조사 계획이 자동 생성됩니다."}
                                                </p>
                                            </div>
                                        );
                                    }
                                    if (plan.status === "manual_required") {
                                        return (
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-semibold text-slate-500">상태</span>
                                                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                                                        예비조사일 수동 지정 필요
                                                    </span>
                                                </div>
                                                <p className="text-xs text-amber-700">
                                                    측정일 기준 -3일까지 가능한 추천일이 없습니다. 예비조사일을 수동으로 지정해 주세요.
                                                </p>
                                            </div>
                                        );
                                    }
                                    const status = linkStatusForForm(editForm);
                                    const linkName = editForm.link_measurer_id
                                        ? measurers.find((m) => m.id === editForm.link_measurer_id)?.name || null
                                        : null;
                                    return (
                                        <div className="space-y-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-semibold text-slate-500">상태</span>
                                                {status.kind === "C" ? (
                                                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                                                        예비조사 연결 확인 필요
                                                    </span>
                                                ) : status.kind === "A" || status.kind === "B" ? (
                                                    <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                                                        정상
                                                    </span>
                                                ) : (
                                                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                                                        측정 인원 확인 필요
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500">예비조사일</label>
                                                    <p className="text-sm font-medium text-slate-800">{plan.recommended_date || "-"}</p>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-slate-500">조사방법</label>
                                                    <p className="text-sm font-medium text-slate-800">{surveyMethodLabel(plan.survey_method)}</p>
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500">생성</label>
                                                <p className="text-sm font-medium text-slate-800">
                                                    {plan.plan_origin === "manual" ? "수동 지정" : "자동 생성/추천"}
                                                </p>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500">예비조사자</label>
                                                <p className="text-sm font-medium text-slate-800">
                                                    {(plan.participant_names || []).length > 0
                                                        ? (plan.participant_names as string[]).map((n) =>
                                                            String(n) === linkName ? `${n} [예·측]` : String(n)
                                                        ).join(" · ")
                                                        : "-"}
                                                </p>
                                            </div>
                                            <div>
                                                <label className="block text-sm font-medium mb-1 text-slate-700">예·측</label>
                                                {(() => {
                                                    const actual = actualMeasurerNames(editForm);
                                                    if (actual.length === 0) {
                                                        return (
                                                            <p className="text-xs text-slate-500">먼저 실제 측정자를 선택하세요.</p>
                                                        );
                                                    }
                                                    const candidates = linkMeasurerCandidatesForForm(editForm);
                                                    if (candidates.length === 0) {
                                                        return (
                                                            <div className="space-y-1">
                                                                <p className="text-xs text-amber-700">
                                                                    현재 예비조사자와 실제 측정자 중 공통 참여자가 없습니다. 실제 측정 인원을 확인하거나 예비조사자를 재확정하세요.
                                                                </p>
                                                                <Select
                                                                    options={[{ value: "", label: "선택 불가" }]}
                                                                    value=""
                                                                    disabled
                                                                />
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <Select
                                                            options={[
                                                                { value: "", label: "선택" },
                                                                ...candidates.map(m => ({ value: m.id.toString(), label: m.name })),
                                                            ]}
                                                            value={editForm.link_measurer_id?.toString() || ""}
                                                            onChange={(e) => {
                                                                const newId = e.target.value ? parseInt(e.target.value) : null;
                                                                // 예·측 선택은 실제 측정 인원·예비조사자를 자동 변경하지 않는다.
                                                                setEditForm(prev => ({ ...prev, link_measurer_id: newId }));
                                                            }}
                                                        />
                                                    );
                                                })()}
                                            </div>
                                            {(() => {
                                                if (editForm.link_measurer_id != null) return null;
                                                const res = suggestLinkMeasurerCandidates({
                                                    measurerName: measurers.find((m) => m.id === editForm.measurer_id)?.name || null,
                                                    collaborators: editForm.collaborators,
                                                    dailyStaff: editForm.daily_staff,
                                                    v2ParticipantNames: v2SurveyorNames(editForm),
                                                });
                                                const validNames = new Set(linkMeasurerCandidatesForForm(editForm).map((m) => m.name));
                                                const valid = res.candidates.filter((name) => validNames.has(name));
                                                if (valid.length === 0) return null;
                                                const suggested = measurers.find((m) => m.name === valid[0]);
                                                if (!suggested) return null;
                                                return (
                                                    <button
                                                        type="button"
                                                        onClick={() => setEditForm(prev => ({ ...prev, link_measurer_id: suggested.id }))}
                                                        className="text-xs text-amber-700 underline"
                                                    >
                                                        후보: {valid.join(", ")} — 선택
                                                    </button>
                                                );
                                            })()}
                                        </div>
                                    );
                                })()}
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
                                                setEditForm(prev => {
                                                    const updated = {
                                                        ...prev,
                                                        measurement_date: val,
                                                        measurement_end_date: val,
                                                        is_registered_text: val ? '실시' : '미실시'
                                                    };
                                                    const prevTargetDate = prev.measurement_date || prev.future_measurement_date;
                                                    const newTargetDate = val || prev.future_measurement_date;
                                                    swapBaeAndKim(prevTargetDate, newTargetDate, updated);
                                                    return updated;
                                                });
                                            }} />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium mb-1 text-slate-700">보고서 담당자</label>
                                            {(() => {
                                                const targetDate = editForm.measurement_date || editForm.future_measurement_date;
                                                const isAfter = !targetDate || targetDate >= "2026-06-09";
                                                const currentMeasurers = measurers.filter(u => 
                                                    isAfter ? u.name !== "배윤민" : u.name !== "김민영"
                                                );
                                                return (
                                                    <Select
                                                        options={[
                                                            { value: "", label: "선택" },
                                                            ...currentMeasurers.map(m => ({ value: m.id.toString(), label: m.name }))
                                                        ]}
                                                        value={editForm.measurer_id?.toString() || ""}
                                                        onChange={(e) => {
                                                            const newId = e.target.value ? parseInt(e.target.value) : null;
                                                            setEditForm(prev => ({ ...prev, measurer_id: newId }));
                                                        }}
                                                        />
                                                    );
                                                })()}
                                            </div>
                                        <div className="col-span-2">
                                            <label className="block text-sm font-medium mb-2 text-slate-700">조력자 (복수 선택) — 예·측은 실제 측정 인원에 항상 포함됩니다</label>
                                            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 p-3 bg-white border border-slate-200 rounded-md">
                                                {(() => {
                                                    const targetDate = editForm.measurement_date || editForm.future_measurement_date;
                                                    const isAfter = !targetDate || targetDate >= "2026-06-09";
                                                    const currentMeasurers = measurers.filter(u => 
                                                        isAfter ? u.name !== "배윤민" : u.name !== "김민영"
                                                    );
                                                    return currentMeasurers.map(m => {
                                                        const collaborators = editForm.collaborators ? editForm.collaborators.split(",").map(s => s.trim()) : [];
                                                        const isChecked = collaborators.includes(m.name);
                                                        const isLink = m.id === editForm.link_measurer_id;
                                                        return (
                                                            <label key={m.id} className={`flex items-center gap-2 cursor-pointer p-1 rounded hover:bg-slate-50 ${isLink ? "bg-blue-50/50" : ""}`}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isChecked || isLink}
                                                                    disabled={isLink}
                                                                    onChange={(e) => {
                                                                        if (isLink) return;
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
                                                                <span className={`text-sm ${isLink ? "text-blue-700 font-semibold" : "text-slate-700"}`}>
                                                                    {m.name}
                                                                    {isLink && <span className="ml-1 text-[10px] bg-blue-100 px-1 rounded">예·측</span>}
                                                                </span>
                                                            </label>
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* 다중 일자 UI (동적 생성) */
                                    <div className="space-y-4">
                                        {(editForm.daily_staff as any[]).map((entry, idx) => {
                                            const dayMeasurers = (() => {
                                                const targetDate = entry.date || editForm.future_measurement_date;
                                                const isAfter = !targetDate || targetDate >= "2026-06-09";
                                                return measurers.filter(u => isAfter ? u.name !== "배윤민" : u.name !== "김민영");
                                            })();

                                            return (
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
                                                                    measurement_end_date: sortedDates[sortedDates.length - 1] || null,
                                                                    is_registered_text: sortedDates.length > 0 ? '실시' : '미실시'
                                                                }));
                                                            }} />
                                                        </div>
                                                        <div>
                                                            <label className="block text-xs font-semibold text-slate-500 mb-1">보고서 담당(코드)</label>
                                                            <Select
                                                                options={[
                                                                    { value: "", label: "선택" },
                                                                    ...dayMeasurers.map(m => ({ value: m.id.toString(), label: m.name }))
                                                                ]}
                                                                value={entry.measurer_id?.toString() || (idx === 0 ? editForm.measurer_id?.toString() : "")}
                                                                onChange={(e) => {
                                                                    const newId = e.target.value ? parseInt(e.target.value) : null;
                                                                    const newList = [...(editForm.daily_staff as any[])];
                                                                    newList[idx].measurer_id = newId;
                                                                    setEditForm(prev => ({ ...prev, daily_staff: newList }));
                                                                }}
                                                            />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <label className="block text-xs font-semibold text-slate-500 mb-1">측정자</label>
                                                            <div className="flex flex-wrap gap-2 p-2 bg-slate-50 border border-slate-200 rounded">
                                                                {dayMeasurers.map(m => {
                                                                    const isChecked = entry.collaborators?.includes(m.name);
                                                                    // 예·측을 특정 날짜에 강제 배치하지 않는다. 각 날짜 인원은 사용자가 직접 선택한다.
                                                                    return (
                                                                        <label key={m.id} className={`flex items-center gap-1.5 cursor-pointer p-0.5 rounded hover:bg-slate-50`}>
                                                                            <input 
                                                                                type="checkbox"
                                                                                checked={isChecked || false}
                                                                                onChange={(e) => {
                                                                                    const newList = [...(editForm.daily_staff as any[])];
                                                                                    let collabs = newList[idx].collaborators || [];
                                                                                    if (e.target.checked) collabs.push(m.name);
                                                                                    else collabs = collabs.filter((c: string) => c !== m.name);
                                                                                    newList[idx].collaborators = Array.from(new Set(collabs));
                                                                                    setEditForm(prev => ({ ...prev, daily_staff: newList }));
                                                                                }}
                                                                                className="w-3.5 h-3.5 rounded"
                                                                            />
                                                                            <span className="text-xs text-slate-600">
                                                                                {m.name}
                                                                            </span>
                                                                        </label>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* V2 예비조사 결과: 자동추천 기본값 + 관리자 수동 수정 */}
                    {editForm.preliminary_survey_v2_plan && (
                        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h4 className="font-bold text-slate-800">예비조사 자동추천 V2</h4>
                                <span className="text-xs text-slate-500">
                                    {editForm.preliminary_survey_v2_plan.plan_origin === "manual" ? "관리자 수정" : "자동추천"}
                                    {` · ${editForm.preliminary_survey_v2_plan.survey_method === "field" ? "현장" : "전화"} 예비조사`}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-slate-700">추천일</label>
                                    <Input
                                        type="date"
                                        value={editForm.preliminary_survey_v2_plan.recommended_date || ""}
                                        onChange={(event) => setEditForm(previous => ({
                                            ...previous,
                                            preliminary_survey_v2_plan: previous.preliminary_survey_v2_plan
                                                ? { ...previous.preliminary_survey_v2_plan, recommended_date: event.target.value }
                                                : null,
                                        }))}
                                    />
                                </div>
                                <div>
                                    <label className="mb-1 block text-sm font-medium text-slate-700">예비조사자(복수선택 가능)</label>
                                    <div className="flex flex-wrap gap-2 rounded border border-slate-200 bg-white p-2">
                                        {measurers.map(measurer => {
                                            const plan = editForm.preliminary_survey_v2_plan!;
                                            const checked = plan.participant_user_ids.includes(measurer.id);
                                            const responsible = measurer.id === editForm.link_measurer_id;
                                            return (
                                                <label key={measurer.id} className="flex items-center gap-1 text-xs">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked || responsible}
                                                        disabled={responsible}
                                                        onChange={(event) => {
                                                            const ids = event.target.checked
                                                                ? [...plan.participant_user_ids, measurer.id]
                                                                : plan.participant_user_ids.filter(id => id !== measurer.id);
                                                            setEditForm(previous => ({
                                                                ...previous,
                                                                preliminary_survey_v2_plan: previous.preliminary_survey_v2_plan
                                                                    ? { ...previous.preliminary_survey_v2_plan, participant_user_ids: [...new Set(ids)] }
                                                                    : null,
                                                            }));
                                                        }}
                                                    />
                                                    {measurer.name}{responsible ? " (연계)" : ""}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 flex justify-end">
                                <Button type="button" variant="secondary" onClick={async () => {
                                    const plan = editForm.preliminary_survey_v2_plan!;
                                    try {
                                        const result = await handleManualV2PlanChange(plan.recommended_date || "", plan.participant_user_ids);
                                        if (result?.cancelled) return;
                                        alert("예비조사 추천일과 조사자를 수정했습니다.");
                                    } catch (error) {
                                        alert(error instanceof Error ? error.message : "수동 수정에 실패했습니다.");
                                    }
                                }}>예비조사 계획 수정 저장</Button>
                            </div>
                        </div>
                    )}

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

            {/* 예비조사 예외 정비 (관리자 전용, C 상태 "연결 정비") */}
            <Modal
                isOpen={repairOpen}
                onClose={() => { if (!repairSaving) setRepairOpen(false); }}
                title="예비조사 연결 정비"
                size="lg"
            >
                {(() => {
                    if (repairLoading) {
                        return <p className="text-sm text-slate-500">정비 정보를 불러오는 중입니다...</p>;
                    }
                    if (!repairContext) return null;
                    const legacyNames = splitNames(repairContext.legacy?.preliminary_surveyor);
                    const linkCandidates = repairLinkCandidatesForContext();
                    const currentLinkName = repairContext.target.link_measurer_id != null
                        ? repairContext.users.find((u) => u.id === repairContext.target.link_measurer_id)?.name ?? null
                        : null;
                    const row = (label: string, value: string) => (
                        <div className="flex items-start gap-3">
                            <span className="w-32 shrink-0 text-xs font-semibold text-slate-500">{label}</span>
                            <span className="text-xs text-slate-800 break-all">{value}</span>
                        </div>
                    );
                    return (
                        <div className="space-y-5">
                            {repairError && (
                                <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs font-semibold text-red-600">
                                    {repairError}
                                </p>
                            )}

                            {/* 기본 정보 */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500">사업장</label>
                                    <p className="text-sm font-medium text-slate-800">
                                        {repairContext.target.code} · {repairContext.target.business_name}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500">측정기간</label>
                                    <p className="text-sm font-medium text-slate-800">
                                        {repairContext.target.measurement_date || "-"}
                                        {repairContext.target.measurement_end_date && repairContext.target.measurement_end_date !== repairContext.target.measurement_date
                                            ? ` ~ ${repairContext.target.measurement_end_date}`
                                            : ""}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500">예비조사일 · 조사방법</label>
                                    <p className="text-sm font-medium text-slate-800">
                                        {repairContext.plan?.recommended_date || "-"} · {surveyMethodLabel(repairContext.plan?.survey_method)}
                                    </p>
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500">확정 여부</label>
                                    <p className="text-sm font-medium text-slate-800">
                                        {repairContext.sequenceNumber ? `확정 (연번 ${repairContext.sequenceNumber})` : "미확정"}
                                    </p>
                                </div>
                            </div>

                            {/* TYPE 1 안내 */}
                            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1">
                                <p className="text-xs font-bold text-amber-800">예비조사자 정정 검토 필요 (TYPE 1)</p>
                                <p className="text-xs text-amber-700">기존 예비조사 기록과 실제 측정자는 일치하지만 현재 V2 예비조사자가 다릅니다.</p>
                                <p className="text-xs text-amber-700">현재 V2 예비조사자와 실제 측정자 중 공통 참여자가 없습니다.</p>
                            </div>

                            {/* 비교 정보 */}
                            <div className="rounded-md border border-slate-200 p-3 space-y-2">
                                <p className="text-xs font-bold text-slate-700 mb-2">정비 전 비교</p>
                                {row("현재 V2 예비조사자", (repairContext.plan?.participant_names || []).join(" · ") || "-")}
                                {row("실제 측정자", repairContext.staffNames.join(" · ") || "-")}
                                {row("legacy 예비조사자", legacyNames.join(" · ") || "-")}
                                {row("현재 예·측", currentLinkName || "-")}
                            </div>

                            {/* 예비조사자 정정 */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">예비조사자 정정 (복수 선택 가능)</label>
                                <p className="text-xs text-slate-500 mb-2">
                                    legacy 예비조사자를 우선 참고하되, 관리자가 직접 확인하여 선택합니다. legacy 값은 자동 선택되지 않습니다.
                                </p>
                                <div className="flex flex-wrap gap-2 rounded border border-slate-200 bg-white p-2 max-h-52 overflow-y-auto">
                                    {repairContext.users.map((user) => {
                                        const checked = repairParticipantIds.includes(user.id);
                                        const isStaff = repairContext.staffNames.includes(user.name);
                                        const isLegacy = legacyNames.includes(user.name);
                                        return (
                                            <label key={user.id} className="flex items-center gap-1 text-xs">
                                                <input
                                                    type="checkbox"
                                                    checked={checked}
                                                    onChange={() => toggleRepairParticipant(user.id)}
                                                    className="w-3.5 h-3.5 rounded"
                                                />
                                                <span>{user.name}</span>
                                                {isLegacy && <span className="text-[10px] bg-slate-100 text-slate-600 px-1 rounded">legacy</span>}
                                                {isStaff && <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded">측정</span>}
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 예·측 후보 재계산 */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">예·측 후보 (정정된 예비조사자 ∩ 실제 측정자)</label>
                                {linkCandidates.length === 0 ? (
                                    <p className="text-xs text-amber-700">정정된 예비조사자와 실제 측정자 중 공통 참여자가 없습니다. 저장할 수 없습니다.</p>
                                ) : linkCandidates.length === 1 ? (
                                    <div className="flex items-center gap-2">
                                        <p className="text-xs font-semibold text-blue-700">예·측 후보: {linkCandidates[0]}</p>
                                        <button
                                            type="button"
                                            className="text-xs text-amber-700 underline"
                                            onClick={() => {
                                                const user = repairContext.users.find((u) => u.name === linkCandidates[0]);
                                                if (user) setRepairLinkMeasurerId(user.id);
                                            }}
                                        >
                                            선택
                                        </button>
                                    </div>
                                ) : (
                                    <p className="text-xs text-slate-600">후보: {linkCandidates.join(", ")}</p>
                                )}
                                <Select
                                    className="mt-2 h-9 text-sm"
                                    options={[
                                        { value: "", label: "선택" },
                                        ...linkCandidates.map((name) => {
                                            const user = repairContext.users.find((u) => u.name === name);
                                            return { value: user ? String(user.id) : "", label: name };
                                        }),
                                    ]}
                                    value={repairLinkMeasurerId?.toString() || ""}
                                    onChange={(e) => setRepairLinkMeasurerId(e.target.value ? Number(e.target.value) : null)}
                                />
                            </div>

                            {/* 변경 사유 */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    변경 사유 <span className="text-red-500">*</span>
                                </label>
                                <textarea
                                    className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                    rows={3}
                                    placeholder="예: 초기 V2 backfill 예비조사자 오류 정정"
                                    value={repairReason}
                                    onChange={(e) => setRepairReason(e.target.value)}
                                />
                                <p className="text-[11px] text-slate-500 mt-1">
                                    실제 측정자·보고서 담당자·legacy 값은 이 기능으로 변경되지 않습니다. 변경 사항은 감사기록에 남습니다.
                                </p>
                            </div>

                            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-200">
                                <Button variant="secondary" onClick={() => setRepairOpen(false)} disabled={repairSaving}>취소</Button>
                                <Button variant="primary" onClick={handleRepairSave} disabled={repairSaving || repairLoading}>
                                    {repairSaving ? "저장 중..." : "정비 저장"}
                                </Button>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            {/* 예비조사 일정 묶음 추천 (주소 기반, READ-ONLY) */}
            <Modal
                isOpen={groupModalOpen}
                onClose={() => setGroupModalOpen(false)}
                title="예비조사 일정 추천 (묶음)"
                size="xl"
            >
                <div className="space-y-4">
                    {groupError && (
                        <p className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs font-semibold text-red-600">
                            {groupError}
                        </p>
                    )}
                    {groupLoading && (
                        <p className="text-sm text-slate-500">추천을 계산하는 중입니다...</p>
                    )}
                    {!groupLoading && groupResult && (
                        <>
                            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                <p>
                                    대상 {groupResult.targetCount}건 · 추천은 <b>미확정</b> 상태입니다. 실제 예비조사일 확정/저장은
                                    관리자 확인 후 별도 단계에서 진행합니다.
                                </p>
                                <p className="mt-1">
                                    같은 위치의 사업장도 각각 독립 항목으로 선택/제외할 수 있습니다. 신규 사업장은 하나의 활성 추천만 유지됩니다.
                                </p>
                            </div>

                            {groupResult.groups.length === 0 && (
                                <p className="text-sm text-slate-500">추천할 사업장이 없습니다.</p>
                            )}

                            {groupResult.groups.map((group) => (
                                <div key={`${group.date}-${group.surveyorUserId}`} className="rounded-lg border border-blue-200 bg-blue-50/30 p-3">
                                    <div className="flex items-center justify-between mb-2">
                                        <p className="text-sm font-bold text-slate-800">
                                            {group.date} · 조사자: {group.surveyorName || "-"}
                                        </p>
                                        <span className="text-[11px] text-slate-500">
                                            {group.items.filter((i) => groupSelectedIds.has(i.id)).length}/{group.items.length}건 선택
                                        </span>
                                    </div>
                                    <div className="space-y-1">
                                        {group.items.map((item) => {
                                            const checked = groupSelectedIds.has(item.id);
                                            return (
                                                <label key={item.id} className="flex items-start gap-2 rounded border border-slate-200 bg-white p-2 text-xs cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => toggleGroupTarget(item.id)}
                                                        className="w-3.5 h-3.5 rounded mt-0.5"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="font-semibold text-slate-800">
                                                            {item.code} · {item.name}
                                                            <span className="ml-1 text-[10px] px-1 rounded bg-slate-100 text-slate-600">
                                                                {item.kind === "new" ? "신규/현장" : "기존"}
                                                            </span>
                                                        </p>
                                                        <p className="text-slate-500 truncate">{item.address || "-"}</p>
                                                        <p className="text-slate-500">
                                                            측정예정일 {item.measurementDate || "-"}
                                                            {item.linkCandidates.length > 0 ? ` · 예·측 후보: ${item.linkCandidates.join(", ")}` : ""}
                                                        </p>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {groupResult.blocked.length > 0 && (
                                <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                                    <p className="text-xs font-bold text-amber-800 mb-1">추천 제외</p>
                                    <div className="space-y-0.5">
                                        {groupResult.blocked.map((item) => (
                                            <p key={item.id} className="text-xs text-amber-700">
                                                {item.code} · {item.name} —{" "}
                                                {item.reason === "NO_AVAILABLE_DATE_THROUGH_MINUS_3"
                                                    ? "측정일 기준 -3일까지 가능한 추천일이 없습니다."
                                                    : "예비조사자를 확인할 수 없습니다."}
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {groupConfirmError && (
                                <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 whitespace-pre-line">
                                    {groupConfirmError}
                                </div>
                            )}

                            <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200">
                                <div className="text-xs text-slate-600">
                                    <p>
                                        선택 {groupSelectedIds.size}건 ·{" "}
                                        {(() => {
                                            const dates = [...new Set(
                                                groupResult.groups
                                                    .filter((g) => g.items.some((i) => groupSelectedIds.has(i.id)))
                                                    .map((g) => g.date),
                                            )];
                                            return dates.length ? dates.join(", ") : "-";
                                        })()}
                                    </p>
                                    <p className="text-[11px] text-slate-500">
                                        확정은 관리자만 가능하며, 선택한 사업장만 저장됩니다. 제외한 사업장은 변경되지 않습니다.
                                    </p>
                                </div>
                                <div className="flex gap-2">
                                    <Button variant="secondary" onClick={() => setGroupModalOpen(false)} disabled={groupConfirming}>닫기</Button>
                                    {isAdmin ? (
                                        <Button
                                            variant="primary"
                                            onClick={handleGroupConfirm}
                                            disabled={groupConfirming || groupSelectedIds.size === 0}
                                        >
                                            {groupConfirming ? "확정 중..." : `선택 ${groupSelectedIds.size}건 확정`}
                                        </Button>
                                    ) : (
                                        <span className="self-center text-[11px] text-slate-500">확정은 관리자만 가능합니다.</span>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </Modal>

            {/* New Registration Modal */}
            <Modal isOpen={isAddModalOpen} onClose={closeAddModal} title="신규 사업장 등록" size="lg">
                <form noValidate onSubmit={(e) => {
                    e.preventDefault();
                    // Basic validation
                    if (!addForm.code || !addForm.business_name) {
                        alert("사업장 코드와 사업장명은 필수입니다.");
                        return;
                    }
                    handleAddSubmit();
                }} className="p-6">
                    <div className="space-y-6">
                        <div className="border-b border-slate-200 pb-5">
                            <h4 className="text-md font-bold text-slate-800 mb-2">동기화된 사업장정보 검색</h4>
                            <p className="text-xs text-slate-500 mb-3">코드, 사업장명, 사업자등록번호, 대표자명 또는 주소 일부로 검색할 수 있습니다.</p>
                            <div className="flex items-center gap-2">
                                <Input
                                    value={businessInfoQuery}
                                    onChange={(e) => setBusinessInfoQuery(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleBusinessInfoSearch();
                                        }
                                    }}
                                    placeholder="사업장정보 검색어"
                                    className="min-w-0 flex-1"
                                />
                                <Button
                                    type="button"
                                    variant="primary"
                                    onClick={handleBusinessInfoSearch}
                                    disabled={isBusinessInfoSearching}
                                    className="h-10 min-w-[72px] shrink-0 whitespace-nowrap px-4"
                                >
                                    {isBusinessInfoSearching ? "조회 중" : "조회"}
                                </Button>
                            </div>
                            {businessInfoResults.length > 0 && (
                                <div className="mt-2 max-h-52 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100 bg-white">
                                    {businessInfoResults.map((business) => (
                                        <button
                                            key={business.code}
                                            type="button"
                                            onClick={() => selectBusinessInfo(business)}
                                            className="w-full px-3 py-2.5 text-left hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                        >
                                            <span className="block text-sm font-semibold text-slate-800">{business.code} · {business.business_name}</span>
                                            <span className="block text-xs text-slate-500 mt-0.5">{formatBusinessNumber(business.business_number) || "사업자번호 없음"} · {business.representative_name || "대표자 미등록"}</span>
                                            <span className="block text-xs text-slate-400 truncate">{business.address || "주소 미등록"}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {selectedBusinessInfo && (
                                <div className="mt-3 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-md">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-emerald-800"><strong>{selectedBusinessInfo.business_name}</strong> 기본정보를 입력했습니다.</span>
                                        {selectedBusinessInfo.invoice_contact_candidate && (
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={() => setAddForm(prev => ({
                                                    ...prev,
                                                    manager_name: selectedBusinessInfo.invoice_contact_candidate?.name || "",
                                                    manager_mobile: selectedBusinessInfo.invoice_contact_candidate?.contact || "",
                                                }))}
                                            >
                                                계산서 담당자 후보 복사
                                            </Button>
                                        )}
                                    </div>
                                    <p className="mt-1 text-[11px] text-emerald-700">
                                        {registrationContextStatus === "loading" && "선택한 연도·주기의 측정사업장 보완자료를 확인하는 중입니다."}
                                        {registrationContextStatus === "exact" && "선택한 연도·주기와 정확히 일치하는 보완자료를 반영했습니다."}
                                        {registrationContextStatus === "none" && "해당 연도·주기의 보완자료가 없어 사업장 기본정보와 수동 입력값을 사용합니다."}
                                        {registrationContextStatus === "error" && "보완자료를 확인하지 못했습니다. 사업장 등록은 계속할 수 있습니다."}
                                    </p>
                                </div>
                            )}
                        </div>
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
                                        onChange={(e) => {
                                            const year = parseInt(e.target.value);
                                            setAddForm(prev => ({ ...prev, year }));
                                            if (selectedBusinessInfo && Number.isInteger(year)) {
                                                void loadExactMeasurementBusiness(
                                                    selectedBusinessInfo,
                                                    year,
                                                    String(addForm.period || initialPeriod),
                                                );
                                            }
                                        }}
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
                                        onChange={(e) => {
                                            const period = e.target.value;
                                            setAddForm(prev => ({ ...prev, period }));
                                            if (selectedBusinessInfo) {
                                                void loadExactMeasurementBusiness(
                                                    selectedBusinessInfo,
                                                    Number(addForm.year || currentYear),
                                                    period,
                                                );
                                            }
                                        }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">
                                        사업장 코드 <span className="text-red-500">*</span>
                                    </label>
                                    <div className="flex items-center">
                                        <span className="inline-flex items-center px-3 py-2 rounded-l-md border border-r-0 border-slate-300 bg-slate-100 text-slate-700 font-bold text-sm select-none">
                                            H
                                        </span>
                                        <Input
                                            value={(addForm.code || "").replace(/^H/, "")}
                                            onChange={(e) => {
                                                const nums = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                                                const code = nums ? `H${nums}` : "";
                                                setAddForm(prev => ({ ...prev, code }));
                                                if (selectedBusinessInfo && code !== selectedBusinessInfo.code) {
                                                    setSelectedBusinessInfo(null);
                                                    setRegistrationContextStatus("idle");
                                                    registrationAutoValuesRef.current = {};
                                                    registrationContextRequestRef.current += 1;
                                                }
                                            }}
                                            className="rounded-l-none"
                                            placeholder="0001 (숫자 4자리)"
                                            maxLength={4}
                                            required
                                        />
                                    </div>
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
                                    <label className="block text-sm font-medium mb-1 text-slate-700">사업자등록번호</label>
                                    <Input value={addForm.business_number || ""} onChange={(e) => setAddForm(prev => ({ ...prev, business_number: e.target.value.replace(/\D/g, "").slice(0, 10) }))} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">업종</label>
                                    <Select
                                        options={businessCategories.map(c => c.value === "" ? { ...c, label: "선택" } : c)}
                                        value={addForm.business_category || ""}
                                        onChange={(e) => {
                                            const businessCategory = e.target.value;
                                            setAddForm(prev => ({
                                                ...prev,
                                                business_category: businessCategory,
                                                ...(addProcessChangedTouched
                                                    ? {}
                                                    : { process_changed: isProcessChangedDefaultCategory(businessCategory) ? true : null }),
                                            }));
                                        }}
                                    />
                                </div>
                                <div className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <p className="mb-2 text-sm font-medium text-slate-700">기본유형</p>
                                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                                        {BUSINESS_TYPE_OPTIONS.map((option) => (
                                            <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                                <input
                                                    type="checkbox"
                                                    checked={addForm.business_type === option.value}
                                                    onChange={(e) => setAddForm(prev => ({ ...prev, business_type: e.target.checked ? option.value : null }))}
                                                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                                />
                                                {option.label}
                                            </label>
                                        ))}
                                        <label key="process_changed" className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                                            <input
                                                type="checkbox"
                                                checked={addForm.process_changed === true}
                                                onChange={(e) => {
                                                    setAddProcessChangedTouched(true);
                                                    setAddForm(prev => ({ ...prev, process_changed: e.target.checked }));
                                                }}
                                                className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                                            />
                                            공정변경
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">전화번호</label>
                                    <Input value={addForm.phone || ""} onChange={(e) => setAddForm(prev => ({ ...prev, phone: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">팩스번호</label>
                                    <Input value={addForm.fax || ""} onChange={(e) => setAddForm(prev => ({ ...prev, fax: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">근로자수</label>
                                    <Input
                                        type="number"
                                        min="0"
                                        value={addForm.total_employees ?? ""}
                                        onChange={(e) => setAddForm(prev => ({
                                            ...prev,
                                            total_employees: e.target.value === "" ? null : Number(e.target.value),
                                        }))}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1 text-slate-700">계산서 이메일</label>
                                    <Input type="text" value={addForm.invoice_email || ""} onChange={(e) => setAddForm(prev => ({ ...prev, invoice_email: e.target.value }))} />
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

                        <div className="bg-blue-50/40 border border-blue-100 p-4 rounded-lg space-y-3">
                            <div className="flex items-start justify-between gap-4 border-b border-blue-200 pb-2">
                                <div>
                                    <h4 className="text-sm font-bold text-blue-800">건강디딤돌 정보 보완 (선택)</h4>
                                    <p className="text-[11px] text-slate-500 mt-1">정보가 없어도 사업장은 등록됩니다. 정기 측정이며 조회 정보가 완성된 경우에만 결과조회를 시작합니다.</p>
                                </div>
                                <span className="shrink-0 rounded-md border border-blue-200 bg-white px-2.5 py-1 text-xs font-semibold text-blue-800">
                                    {addForm.period?.includes("(수시)")
                                        ? "비대상"
                                        : hasNationalSupportApplicationInformation({
                                            industrial_accident_number: addForm.sanjae,
                                            commencement_number: addForm.commencement,
                                            representative_name: addForm.representative_name,
                                            manager_name: addForm.manager_name,
                                            manager_mobile: addForm.manager_mobile,
                                        }) ? "자동 신청"
                                        : hasNationalSupportLookupInformation({
                                            industrial_accident_number: addForm.sanjae,
                                            commencement_number: addForm.commencement,
                                            representative_name: addForm.representative_name,
                                        }) ? "조회 대기" : "정보 부족"}
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">산재관리번호</label>
                                    <Input value={addForm.sanjae || ""} onChange={(e) => setAddForm(prev => ({ ...prev, sanjae: e.target.value.replace(/\D/g, "").slice(0, 11) }))} placeholder="11자리 숫자" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">사업개시번호</label>
                                    <Input value={addForm.commencement || ""} onChange={(e) => setAddForm(prev => ({ ...prev, commencement: e.target.value.replace(/\D/g, "").slice(0, 11) }))} placeholder="11자리 숫자" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">대표자명</label>
                                    <Input value={addForm.representative_name || ""} onChange={(e) => setAddForm(prev => ({ ...prev, representative_name: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">측정업무 담당자명</label>
                                    <Input value={addForm.manager_name || ""} onChange={(e) => setAddForm(prev => ({ ...prev, manager_name: e.target.value }))} />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">담당자 휴대전화</label>
                                    <Input value={addForm.manager_mobile || ""} onChange={(e) => setAddForm(prev => ({ ...prev, manager_mobile: e.target.value }))} placeholder="010-0000-0000" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1">담당자 메일</label>
                                    <Input
                                        type="email"
                                        value={addForm.manager_email || ""}
                                        onChange={(e) => setAddForm(prev => ({ ...prev, manager_email: e.target.value }))}
                                        placeholder="name@example.com"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                            <Button variant="secondary" onClick={closeAddModal} type="button">취소</Button>
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

            {/* 국고 일괄 진행 현황 모달 */}
            <Modal
                isOpen={showBulkModal}
                onClose={() => {
                    if (isBulkProcessing) {
                        if (!confirm("현재 일괄 조회가 진행 중입니다. 정말 닫으시겠습니까?\n(창을 닫아도 백엔드 요청은 계속 진행될 수 있습니다)")) {
                            return;
                        }
                    }
                    setShowBulkModal(false);
                }}
                title="국고 일괄 처리 진행 현황"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div className="bg-slate-50 p-2 rounded border border-slate-100">
                            <div className="text-slate-500 font-medium">전체 대상</div>
                            <div className="text-lg font-bold text-text-900 mt-1">{bulkTotal}건</div>
                        </div>
                        <div className="bg-green-50 p-2 rounded border border-green-100">
                            <div className="text-green-600 font-medium">즉시 반영</div>
                            <div className="text-lg font-bold text-green-700 mt-1">{bulkSuccessCount}건</div>
                        </div>
                        <div className="bg-blue-50 p-2 rounded border border-blue-100">
                            <div className="text-blue-600 font-medium">조회 기동</div>
                            <div className="text-lg font-bold text-blue-700 mt-1">{bulkCrawlerCount}건</div>
                        </div>
                        <div className="bg-red-50 p-2 rounded border border-red-100">
                            <div className="text-red-600 font-medium">실패 건</div>
                            <div className="text-lg font-bold text-red-700 mt-1">{bulkFailedCount}건</div>
                        </div>
                    </div>

                    {/* 프로그레스 바 */}
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs text-slate-500 font-medium">
                            <span>진행률</span>
                            <span>{bulkProcessed} / {bulkTotal} 건 ({bulkTotal > 0 ? Math.round((bulkProcessed / bulkTotal) * 100) : 0}%)</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-3.5 overflow-hidden">
                            <div
                                className="bg-primary-600 h-3.5 rounded-full transition-all duration-300"
                                style={{ width: `${bulkTotal > 0 ? (bulkProcessed / bulkTotal) * 100 : 0}%` }}
                            />
                        </div>
                    </div>

                    {/* 진행 로그 창 */}
                    <div className="space-y-1">
                        <label className="block text-xs font-bold text-slate-500">실시간 처리 로그</label>
                        <div className="h-48 overflow-y-auto border border-slate-200 rounded p-2.5 bg-slate-900 text-slate-200 text-xs font-mono space-y-1 custom-scrollbar">
                            {bulkLogs.map((log, idx) => (
                                <div key={idx} className={
                                    log.includes("[즉시반영]") ? "text-green-400" :
                                    log.includes("[백그라운드 기동]") ? "text-blue-400" :
                                    log.includes("[조회 실패]") || log.includes("[네트워크 오류]") ? "text-red-400" : "text-slate-300"
                                }>
                                    {log}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button
                            variant="secondary"
                            onClick={() => setShowBulkModal(false)}
                            disabled={isBulkProcessing}
                        >
                            닫기
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* 좌표 일괄 재조회 진행 현황 모달 */}
            <Modal
                isOpen={showGeocodeModal}
                onClose={() => {
                    if (isGeocodeProcessing) {
                        if (!confirm("현재 좌표 재조회가 진행 중입니다. 정말 닫으시겠습니까?")) {
                            return;
                        }
                    }
                    setShowGeocodeModal(false);
                }}
                title="좌표 재조회 진행 현황"
            >
                <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div className="bg-slate-50 p-2 rounded border border-slate-100">
                            <div className="text-slate-500 font-medium">전체 대상</div>
                            <div className="text-lg font-bold text-slate-900 mt-1">{geocodeTotal}건</div>
                        </div>
                        <div className="bg-green-50 p-2 rounded border border-green-100">
                            <div className="text-green-600 font-medium">성공</div>
                            <div className="text-lg font-bold text-green-700 mt-1">{geocodeSuccessCount}건</div>
                        </div>
                        <div className="bg-amber-50 p-2 rounded border border-amber-100">
                            <div className="text-amber-600 font-medium">건너뀀</div>
                            <div className="text-lg font-bold text-amber-700 mt-1">{geocodeSkippedCount}건</div>
                        </div>
                        <div className="bg-red-50 p-2 rounded border border-red-100">
                            <div className="text-red-600 font-medium">실패</div>
                            <div className="text-lg font-bold text-red-700 mt-1">{geocodeFailedCount}건</div>
                        </div>
                    </div>

                    {/* 프로그레스 바 */}
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs text-slate-500 font-medium">
                            <span>진행률</span>
                            <span>{geocodeProcessed} / {geocodeTotal} 건 ({geocodeTotal > 0 ? Math.round((geocodeProcessed / geocodeTotal) * 100) : 0}%)</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-3.5 overflow-hidden">
                            <div
                                className="bg-amber-500 h-3.5 rounded-full transition-all duration-300"
                                style={{ width: `${geocodeTotal > 0 ? (geocodeProcessed / geocodeTotal) * 100 : 0}%` }}
                            />
                        </div>
                    </div>

                    {/* 진행 로그 창 */}
                    <div className="space-y-1">
                        <label className="block text-xs font-bold text-slate-500">실시간 좌표 조회 로그</label>
                        <div className="h-48 overflow-y-auto border border-slate-200 rounded p-2.5 bg-slate-900 text-slate-200 text-xs font-mono space-y-1 custom-scrollbar">
                            {geocodeLogs.map((log, idx) => (
                                <div key={idx} className={
                                    log.includes("[성공]") ? "text-green-400" :
                                    log.includes("[건너뀀]") ? "text-amber-400" :
                                    log.includes("[실패]") || log.includes("[오류]") ? "text-red-400" : "text-slate-300"
                                }>
                                    {log}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button
                            variant="secondary"
                            onClick={() => setShowGeocodeModal(false)}
                            disabled={isGeocodeProcessing}
                        >
                            닫기
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* 네이버 지도 모달 */}
            {isMapModalOpen && (
                <BusinessMapModal
                    isOpen={isMapModalOpen}
                    onClose={() => setIsMapModalOpen(false)}
                    initialSelectedIds={Array.from(selectedBusinessIds)}
                    allBusinesses={data}
                />
            )}
        </div >
    );
};
