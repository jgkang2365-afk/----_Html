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
import { MeasurementTargetBusinessFormSections } from "@/components/features/MeasurementTargetBusinessFormSections";
import { MeasurementTargetIntegrityPanel } from "@/components/features/MeasurementTargetIntegrityPanel";
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
import { compareCanonicalTargetBusinesses } from "@/lib/business/target-business-sort";
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
import {
    MeasurementDayForm,
    MeasurementDayFormWithUiKey,
    createEmptyMeasurementDayForm,
    defaultEmptyParticipantsToReportWriter,
    measurementDayFormsFrom,
    withMeasurementDayUiKeys,
    validateMeasurementDayForms,
} from "@/lib/business/measurement-day-form";
import {
    buildInlineMeasurementDateUpdates,
    buildTargetBusinessEditPatch,
    buildTargetBusinessSaveValues,
    getTargetBusinessTypeLabel,
    isProcessChangedDefaultCategory,
    serializeTargetBusinessEditValues,
    statusForMeasurementDays,
    TargetBusinessFormValues,
} from "@/lib/business/target-business-form";
import {
    buildMeasurementScheduleBlockKeys,
    isMeasurementStaffUnavailable,
    validateMeasurementDayAvailability,
} from "@/lib/business/measurement-day-availability";

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
    designated_office?: string;
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
    const [activeView, setActiveView] = useState<"list" | "integrity">("list");
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
    const [measurementScheduleBlockedKeys, setMeasurementScheduleBlockedKeys] = useState<Set<string>>(new Set());
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
    const [editMeasurementDays, setEditMeasurementDays] = useState<MeasurementDayFormWithUiKey[]>(
        () => [createEmptyMeasurementDayForm()],
    );
    const editInitialStateRef = useRef<{
        form: TargetBusinessFormValues;
        days: MeasurementDayForm[];
    } | null>(null);
    const [addForm, setAddForm] = useState<Partial<BusinessEntry>>({
        year: new Date().getFullYear(),
        period: (new Date().getMonth() + 1) <= 6 ? "상반기" : "하반기",
        manager_email: "",
        is_registered_text: "미실시",
    });
    const [addMeasurementDays, setAddMeasurementDays] = useState<MeasurementDayFormWithUiKey[]>(
        () => [createEmptyMeasurementDayForm()],
    );
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
                    designated_office: target.designated_office || "",
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
            designated_office: "",
            office_jurisdiction: "",
            is_registered_text: "미실시",
            notes: "",
        });
        setAddMeasurementDays([createEmptyMeasurementDayForm()]);
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
            designated_office: business.designated_office || prev.designated_office,
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

        const measurementDayValidation = validateMeasurementDayForms(addMeasurementDays);
        if (!measurementDayValidation.valid) {
            alert(measurementDayValidation.message);
            return;
        }
        const availabilityValidation = validateMeasurementDayAvailability({
            days: addMeasurementDays,
            users: measurers,
            blockedKeys: measurementScheduleBlockedKeys,
        });
        if (!availabilityValidation.valid) {
            alert(availabilityValidation.message);
            return;
        }

        const createPayload = {
            code: addForm.code,
            year: addForm.year,
            ...buildTargetBusinessSaveValues(addForm, addMeasurementDays),
        };

        try {
            const response = await fetch("/api/businesses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(createPayload)
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
                    designated_office: created.designated_office || "",
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
            result = result.filter(item =>
                (item.designated_office || "").includes(filters.designatedOffice)
            );
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
            result.sort((a, b) => compareCanonicalTargetBusinesses({
                code: a.code,
                isRegisteredText: a.is_registered_text,
                measurementMonth: a.measurement_month,
            }, {
                code: b.code,
                isRegisteredText: b.is_registered_text,
                measurementMonth: b.measurement_month,
            }));
        }

        setFilteredData(result);
    }, [data, filters, sortConfig, measurers]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        fetch("/api/user-schedule-blocks", { cache: "no-store" })
            .then(async (response) => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "직원 불가 일정 조회 실패");
                setMeasurementScheduleBlockedKeys(buildMeasurementScheduleBlockKeys(result.blocks || []));
            })
            .catch((error) => console.error("직원 불가 일정 조회 실패:", error));
    }, []);

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

    const handleEditClick = async (item: BusinessEntry) => {
        setEditingItem(item);

        let blockedKeys = measurementScheduleBlockedKeys;
        try {
            const response = await fetch("/api/user-schedule-blocks", { cache: "no-store" });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || "직원 불가 일정 조회 실패");
            blockedKeys = buildMeasurementScheduleBlockKeys(result.blocks || []);
            setMeasurementScheduleBlockedKeys(blockedKeys);
        } catch (error) {
            console.error("직원 불가 일정 조회 실패:", error);
        }

        // 보고서 담당자(measurer_id)는 측정 참여자와 별개 역할이다.
        // 모달에서는 편의를 위해 기본 체크하되 사용자가 자유롭게 해제할 수 있다.
        const sourceDays = measurementDayFormsFrom({
            dailyStaff: item.daily_staff,
            measurementDate: item.measurement_date,
            measurerId: item.measurer_id,
            collaborators: item.collaborators,
        });
        const initialDays = defaultEmptyParticipantsToReportWriter(sourceDays, measurers, (userId, date) => !isMeasurementStaffUnavailable(userId, date, blockedKeys));
        const initialForm = {
            ...item,
            sanjae: item.industrial_accident_number || item.sanjae || "",
            commencement: item.commencement_number || item.commencement || "",
        };

        setEditForm(initialForm);
        editInitialStateRef.current = { form: initialForm, days: sourceDays };
        setEditMeasurementDays(withMeasurementDayUiKeys(initialDays));
        setIsEditModalOpen(true);
    };

    const updateMeasurementDays = (
        days: MeasurementDayFormWithUiKey[],
        linkMeasurerId?: number | null,
    ) => {
        setEditMeasurementDays(days);
        setEditForm((previous) => ({
            ...previous,
            ...(linkMeasurerId === undefined ? {} : { link_measurer_id: linkMeasurerId }),
            is_registered_text: statusForMeasurementDays(previous.is_registered_text, days),
        }));
    };

    const updateAddMeasurementDays = (
        days: MeasurementDayFormWithUiKey[],
        linkMeasurerId?: number | null,
    ) => {
        setAddMeasurementDays(days);
        setAddForm((previous) => ({
            ...previous,
            ...(linkMeasurerId === undefined ? {} : { link_measurer_id: linkMeasurerId }),
            is_registered_text: statusForMeasurementDays(previous.is_registered_text, days),
        }));
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

        // 저장 경계에서도 보고서 담당자 기본 참여자 값을 보장한다.
        // 모달 초기화가 생략되거나 사용자가 다른 필드를 먼저 저장해도
        // DB의 collaborators 원천이 보고서 담당자와 어긋나지 않도록 한다.
        const measurementDays = editMeasurementDays;
        const measurementDayValidation = validateMeasurementDayForms(measurementDays);
        if (!measurementDayValidation.valid) {
            alert(measurementDayValidation.message);
            return;
        }
        const availabilityValidation = validateMeasurementDayAvailability({
            days: measurementDays,
            users: measurers,
            blockedKeys: measurementScheduleBlockedKeys,
        });
        if (!availabilityValidation.valid) {
            alert(availabilityValidation.message);
            return;
        }

        try {
            const initialState = editInitialStateRef.current;
            const updatesToSave = buildTargetBusinessEditPatch(
                initialState?.form || editingItem,
                editForm,
                initialState?.days || measurementDayFormsFrom({
                    dailyStaff: editingItem.daily_staff,
                    measurementDate: editingItem.measurement_date,
                    measurerId: editingItem.measurer_id,
                    collaborators: editingItem.collaborators,
                }),
                measurementDays,
            );
            if (Object.keys(updatesToSave).length === 0) {
                setIsEditModalOpen(false);
                return;
            }

            // 저장이 성공(Resolve)한 후에만 모달을 닫음
            await saveChanges(
                editingItem.code,
                updatesToSave as Partial<BusinessEntry>,
                editingItem,
            );
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
            const cleanUpdates = serializeTargetBusinessEditValues(updates);

            // 1. Optimistic Update (UI 먼저 반영)
            const optimisticUpdates = { ...updates };
            if (cleanUpdates.is_registered) {
                optimisticUpdates.is_registered = cleanUpdates.is_registered;
                optimisticUpdates.is_registered_text = cleanUpdates.is_registered;
            }
            if (cleanUpdates.industrial_accident_number !== undefined) {
                optimisticUpdates.sanjae = cleanUpdates.industrial_accident_number || "";
                optimisticUpdates.industrial_accident_number = cleanUpdates.industrial_accident_number;
            }
            if (cleanUpdates.commencement_number !== undefined) {
                optimisticUpdates.commencement = cleanUpdates.commencement_number || "";
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

            const result = await response.json();
            if (result.data) {
                setData(prev => prev.map(item =>
                    item.code === code && item.year === targetYear && item.period === targetPeriod
                        ? { ...item, ...result.data }
                        : item
                ));
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

    const handleConfirmedDateChange = (item: BusinessEntry, newDate: string) => {
        const updates = buildInlineMeasurementDateUpdates(item.is_registered_text, newDate);
        saveChanges(item.code, updates as Partial<BusinessEntry>, item);
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
            "지정지청": item.designated_office || "",
            "소재지지청": toShortName(item.office_jurisdiction || ""),
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

    // Grid Column Template
    // V2 예비조사 추천 결과는 목록에서 더 이상 노출하지 않는다 (예비조사 전용 영역으로 분리).
    const gridTemplateCols = "40px 45px 60px 80px 100px 70px 90px 90px minmax(140px, 1.5fr) minmax(160px, 2fr) 60px 50px 80px 80px 50px 80px 90px 110px 80px 40px";

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

    if (activeView === "integrity") {
        const [yearText, period] = filters.yearPeriod.split("-");
        return <MeasurementTargetIntegrityPanel
            year={Number(yearText)}
            period={period}
            onBack={() => setActiveView("list")}
        />;
    }

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
                            <Button onClick={() => setActiveView("integrity")} variant="secondary" className="h-9 px-3 text-sm font-medium whitespace-nowrap" title="현재 연도·주기 대상의 읽기 전용 정합성 점검">
                                정합성 점검
                            </Button>
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
                            소재지지청 {renderSortIcon("office_jurisdiction")}
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
                                                {getTargetBusinessTypeLabel(item.business_type)}
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
                                            value={item.measurement_date || ""}
                                            onChange={(e) => handleConfirmedDateChange(item, e.target.value)}
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
                    <MeasurementTargetBusinessFormSections
                        mode="edit"
                        value={editForm}
                        onChange={(patch) => setEditForm(previous => ({ ...previous, ...patch }) as Partial<BusinessEntry>)}
                        businessCategories={businessCategories}
                        planManagerOptions={PLAN_MANAGER_EDIT_OPTIONS}
                        measurers={measurers}
                        measurementDays={editMeasurementDays}
                        blockedKeys={measurementScheduleBlockedKeys}
                        onMeasurementDaysChange={updateMeasurementDays}
                        onBusinessCategoryChange={(businessCategory) => setEditForm(previous => ({
                            ...previous,
                            business_category: businessCategory,
                        }))}
                    />
                    <div className="flex justify-between items-center mt-8 pt-4 border-t border-slate-200">
                        <Button className="bg-red-600 hover:bg-red-700 text-white" onClick={handleDelete}>
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
                        <MeasurementTargetBusinessFormSections
                            mode="create"
                            value={addForm}
                            onChange={(patch) => setAddForm(previous => ({ ...previous, ...patch }) as Partial<BusinessEntry>)}
                            businessCategories={businessCategories}
                            planManagerOptions={PLAN_MANAGER_EDIT_OPTIONS}
                            measurers={measurers}
                            measurementDays={addMeasurementDays}
                            blockedKeys={measurementScheduleBlockedKeys}
                            onMeasurementDaysChange={updateAddMeasurementDays}
                            onYearChange={(year) => {
                                setAddForm(previous => ({ ...previous, year }));
                                if (selectedBusinessInfo && Number.isInteger(year)) {
                                    void loadExactMeasurementBusiness(
                                        selectedBusinessInfo,
                                        year,
                                        String(addForm.period || initialPeriod),
                                    );
                                }
                            }}
                            onPeriodChange={(period) => {
                                setAddForm(previous => ({ ...previous, period }));
                                if (selectedBusinessInfo) {
                                    void loadExactMeasurementBusiness(
                                        selectedBusinessInfo,
                                        Number(addForm.year || currentYear),
                                        period,
                                    );
                                }
                            }}
                            onCodeChange={(code) => {
                                setAddForm(previous => ({ ...previous, code }));
                                if (selectedBusinessInfo && code !== selectedBusinessInfo.code) {
                                    setSelectedBusinessInfo(null);
                                    setRegistrationContextStatus("idle");
                                    registrationAutoValuesRef.current = {};
                                    registrationContextRequestRef.current += 1;
                                }
                            }}
                            onBusinessCategoryChange={(businessCategory) => {
                                setAddForm(previous => ({
                                    ...previous,
                                    business_category: businessCategory,
                                    ...(addProcessChangedTouched ? {} : {
                                        process_changed: isProcessChangedDefaultCategory(businessCategory) ? true : null,
                                    }),
                                }));
                            }}
                            onProcessChangedTouched={() => setAddProcessChangedTouched(true)}
                        />
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
