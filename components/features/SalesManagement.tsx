"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Tab } from "@/components/ui/Tab";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/Table";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
import { formatDateYYYYMMDD } from "@/lib/utils/date-utils";
import { normalizeDateForInput } from "@/lib/utils/date-normalize";
import { formatBusinessNumber, parseBusinessNumber } from "@/lib/utils/business-number";
import { DESIGNATED_OFFICE_OPTIONS, DESIGNATED_OFFICES_FOR_SALES } from "@/lib/constants/designated-offices";
import { JournalEditForm } from "./JournalEditForm";

import * as XLSX from "xlsx";

import { SalesSummary } from "./sales/SalesSummary";
import { MeasurementTable } from "./sales/MeasurementTable";
import { OtherRevenueTable } from "./sales/OtherRevenueTable";
import { ThirdPartyTable } from "./sales/ThirdPartyTable";
import { StatTables } from "./sales/StatTables";
import { MeasurementRevenue, OtherRevenue, OfficeSummary, YearlySummary, SalesSummaryData } from "./sales/types";

export const SalesManagement: React.FC = () => {
  // KST 날짜를 YYYY-MM-DD 형식으로 포맷 (toISOString은 UTC로 변환되므로 사용 금지)
  const formatKSTDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // 서울 시간대(Asia/Seoul) 기준으로 현재 년도 가져오기
  const getCurrentYear = () => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    return seoulTime.getFullYear();
  };
  const getCurrentYearString = () => getCurrentYear().toString();

  // 현재 KST 기준으로 상반기/하반기 가져오기
  const getCurrentPeriod = () => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const month = seoulTime.getMonth() + 1;
    return month <= 6 ? "상반기" : "하반기";
  };

  // URL 쿼리 파라미터 훅
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // 현재 활성 탭 상태 (URL 파라미터에서 가져오기, 기본값: measurement)
  const activeTab = searchParams.get("tab") || "measurement";

  // 탭 변경 핸들러 (URL 업데이트)
  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tabId);

    // scroll: false 옵션을 사용하여 스크롤 위치 유지
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  // 주기가 선택된 주기와 일치하는지 확인하는 헬퍼 함수
  const isMatchSelection = (itemPeriod: string | null, selectedPeriod: string) => {
    if (!selectedPeriod) return true;
    if (!itemPeriod) return false;

    // 콤마로 구분된 검색 지원
    const searchTerms = selectedPeriod.split(',').map(s => s.trim()).filter(Boolean);
    if (searchTerms.length === 0) return true;

    return searchTerms.some(term => {
      if (term === "상반기") {
        return itemPeriod === "상반기" || itemPeriod === "상반기(수시)" || itemPeriod === "수시(상)";
      }
      if (term === "하반기") {
        return itemPeriod === "하반기" || itemPeriod === "하반기(수시)" || itemPeriod === "수시(하)";
      }
    });
  };

  // 주기에 따른 정렬 가중치 반환 (하반기 > 상반기)
  const getPeriodWeight = (period: string | null) => {
    if (!period) return 0;
    if (period.includes("하반기") || period.includes("수시(하)")) return 2;
    if (period.includes("상반기") || period.includes("수시(상)")) return 1;
    return 0;
  };

  // 검색어 매칭 헬퍼 함수 (콤마로 구분된 다중 키워드 OR 검색, 부분 일치)
  const checkSearchMatch = (targetValue: string | null | number, searchValue: string) => {
    if (!searchValue) return true;
    if (targetValue === null || targetValue === undefined) return false;

    const target = targetValue.toString().toLowerCase();
    const terms = searchValue.split(",").map(term => term.trim().toLowerCase()).filter(term => term.length > 0);

    if (terms.length === 0) return true;

    // 하나라도 포함되면 true (OR 조건)
    return terms.some(term => target.includes(term));
  };

  // 정확한 매칭 헬퍼 함수 (콤마로 구분된 다중 키워드 OR 검색, 정확히 일치)
  const checkExactMatch = (targetValue: string | null | number, searchValue: string) => {
    if (!searchValue) return true;
    if (targetValue === null || targetValue === undefined) return false;

    const target = targetValue.toString().trim();
    const terms = searchValue.split(",").map(term => term.trim()).filter(term => term.length > 0);

    if (terms.length === 0) return true;

    // 하나라도 정확히 일치하면 true (OR 조건)
    return terms.some(term => target === term);
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [measurementRevenue, setMeasurementRevenue] = useState<MeasurementRevenue[]>([]);
  const [allMeasurementData, setAllMeasurementData] = useState<MeasurementRevenue[]>([]);
  const [otherRevenue, setOtherRevenue] = useState<OtherRevenue[]>([]);
  const [allOtherData, setAllOtherData] = useState<OtherRevenue[]>([]);
  const [summary, setSummary] = useState<SalesSummaryData | null>(null);

  // 페이지네이션 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [pageSize] = useState(50);



  // 로컬 스토리지 키 정의
  const STORAGE_KEY_YEAR = "sales_management_last_year";
  const STORAGE_KEY_PERIOD = "sales_management_last_period";

  // 로컬 스토리지에서 초기값 가져오기 (년도 기본값: KST 현재년도, 주기 기본값: 전체(""))
  const getInitialYear = () => {
    if (typeof window !== "undefined") {
      // 년도 기본값을 "전체"("")로 설정 (사용자 요청 반영)
      return localStorage.getItem(STORAGE_KEY_YEAR) || "";
    }
    return "";
  };
  const getInitialPeriod = () => {
    if (typeof window !== "undefined") {
      // 주기는 기본값을 "전체"("")로 설정 (사용자 요청)
      return localStorage.getItem(STORAGE_KEY_PERIOD) || "";
    }
    return "";
  };

  const initialYear = getInitialYear();
  const initialPeriod = getInitialPeriod();

  // 년도별 집계 년도 선택 상태
  const [yearlySummaryYear, setYearlySummaryYear] = useState<string>(initialYear);
  const [yearlySummaryPeriod, setYearlySummaryPeriod] = useState<string>(initialPeriod);

  // 미수금 집계 년도 선택 상태
  const [unpaidSummaryYear, setUnpaidSummaryYear] = useState<string>(initialYear);
  const [unpaidSummaryPeriod, setUnpaidSummaryPeriod] = useState<string>(initialPeriod);

  // 매출 집계 년도 선택 상태
  const [salesSummaryYear, setSalesSummaryYear] = useState<string>(initialYear);

  // 매출 집계 상세 내역 모달 상태
  const [isSalesDetailModalOpen, setIsSalesDetailModalOpen] = useState(false);
  const [salesDetailType, setSalesDetailType] = useState<"measurementTotal" | "measurementDeposit" | null>(null);
  const [salesDetailList, setSalesDetailList] = useState<MeasurementRevenue[]>([]);
  const [salesDetailTitle, setSalesDetailTitle] = useState<string>("");

  // 측정비 입금액 상세 모달 상태
  const [isMeasurementDepositDetailModalOpen, setIsMeasurementDepositDetailModalOpen] = useState(false);
  const [measurementDepositDetailItem, setMeasurementDepositDetailItem] = useState<MeasurementRevenue | null>(null);

  // 미수금 사업장 목록 모달 상태
  const [isUnpaidBusinessModalOpen, setIsUnpaidBusinessModalOpen] = useState(false);
  const [unpaidBusinessList, setUnpaidBusinessList] = useState<Array<{
    business_name: string;
    unpaid_amount: number;
    measurement_year: number;
    measurement_period: string;
    unpaid_count: number;
    designated_office: string | null;
    measurement_fee_total: number | null;
    deposit_amount_business: number | null;
  }>>([]);
  const [unpaidBusinessModalTitle, setUnpaidBusinessModalTitle] = useState<string>("");

  // 기타 매출 모달 상태
  const [isOtherModalOpen, setIsOtherModalOpen] = useState(false);
  const [selectedOther, setSelectedOther] = useState<OtherRevenue | null>(null);
  const [otherFormData, setOtherFormData] = useState<Partial<OtherRevenue>>({});
  const [saving, setSaving] = useState(false);

  // 업로드 관련 상태
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    message: string;
    successCount: number;
    errorCount: number;
    errors?: string[];
  } | null>(null);

  // 일괄 삭제 관련 상태
  const [selectedOtherIds, setSelectedOtherIds] = useState<number[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletedOtherIds, setDeletedOtherIds] = useState<Set<number>>(new Set()); // 삭제된 항목 추적

  // 측정일지 수정 모달 상태
  const [isJournalModalOpen, setIsJournalModalOpen] = useState(false);
  const [isJournalFormSubmitting, setIsJournalFormSubmitting] = useState(false);
  const [selectedJournalEntry, setSelectedJournalEntry] = useState<any>(null);

  // 측정비 일괄 업로드 관련 상태
  const [isMeasurementUploadModalOpen, setIsMeasurementUploadModalOpen] = useState(false);
  const [measurementUploadFile, setMeasurementUploadFile] = useState<File | null>(null);
  const [measurementUploadLoading, setMeasurementUploadLoading] = useState(false);
  const [measurementUploadError, setMeasurementUploadError] = useState<string | null>(null);
  const [measurementUploadResult, setMeasurementUploadResult] = useState<{
    success: boolean;
    message: string;
    successCount: number;
    failCount: number;
    details?: string[];
  } | null>(null);

  // 미수관리 필터 및 정렬 상태
  const [unpaidFilters, setUnpaidFilters] = useState({
    type: "", // 구분: "measurement" | "other" | ""
    name: "", // 사업장명/품명
    year: initialYear, // 매출년도
    period: initialPeriod, // 측정주기
    designatedOffice: "", // 지정한계_관할지청
    hasDepositDate: "", // 입금일 여부: "yes" | "no" | ""
  });
  const [unpaidSort, setUnpaidSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "year", direction: "desc" });

  // 기타 매출 필터 및 정렬 상태
  const [otherFilters, setOtherFilters] = useState({
    itemName: "", // 품명
    year: "", // 매출년도
    period: "", // 매출주기
    hasInvoiceDate: "", // 계산서 발행일 여부: "yes" | "no" | ""
    hasDepositDate: "", // 입금일 여부: "yes" | "no" | ""
    notes: "", // 비고
  });
  const [otherSort, setOtherSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "revenue_year", direction: "desc" });

  // 측정비 필터 및 정렬 상태
  const [measurementFilters, setMeasurementFilters] = useState({
    businessName: "", // 사업장명
    representativeName: "", // 대표자명
    year: initialYear, // 측정년도 (기본값 로컬 스토리지 또는 KST 현재년도)
    period: initialPeriod, // 측정주기 (기본값 로컬 스토리지 또는 전체)
    designatedOffice: "", // 지정한계_관할지청
    hasInvoiceDate: "", // 계산서 발행일 여부: "yes" | "no" | ""
  });
  const [measurementSort, setMeasurementSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "measurement_year", direction: "desc" });

  // 디바운싱된 필터 상태 - 기타 매출만 유지 (나머지는 Enter/Blur 시 즉시 반영)
  const [debouncedOtherFilters, setDebouncedOtherFilters] = useState(otherFilters);

  // 기간별 입금 현황 필터 상태
  const [depositStartDate, setDepositStartDate] = useState<string>(() => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const oneMonthAgo = new Date(seoulTime);
    oneMonthAgo.setMonth(seoulTime.getMonth() - 1);
    return formatKSTDate(oneMonthAgo);
  });
  const [depositEndDate, setDepositEndDate] = useState<string>(() => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    return formatKSTDate(seoulTime);
  });
  const [depositOffice, setDepositOffice] = useState("");
  const [depositYear, setDepositYear] = useState("");
  const [depositPeriod, setDepositPeriod] = useState("");
  const [depositCategory, setDepositCategory] = useState("");
  const [depositBusinessName, setDepositBusinessName] = useState("");
  // const [debouncedDepositBusinessName, setDebouncedDepositBusinessName] = useState("");
  const [activeQuickDate, setActiveQuickDate] = useState<string | null>("month");

  // 로컬 검색어 상태 (입력 시 흔들림 방지용, Enter키로 검색)
  const [localBusinessName, setLocalBusinessName] = useState("");
  const [localRepresentativeName, setLocalRepresentativeName] = useState("");
  const [localUnpaidName, setLocalUnpaidName] = useState("");
  const [localDepositBusinessName, setLocalDepositBusinessName] = useState("");

  // 입금 현황 필터 동기화 (Blur/Enter 시 업데이트되므로 디바운싱 제거)
  useEffect(() => {
    if (depositBusinessName === "") setLocalDepositBusinessName("");
  }, [depositBusinessName]);

  // 필터 업데이트 감지 여부 (로딩 표시용)
  const [isMeasurementFiltering, setIsMeasurementFiltering] = useState(false);
  const [isOtherFiltering, setIsOtherFiltering] = useState(false);
  const [isUnpaidFiltering, setIsUnpaidFiltering] = useState(false);

  // 미수관리 필터 동기화
  useEffect(() => {
    if (unpaidFilters.name === "") setLocalUnpaidName("");
  }, [unpaidFilters.name]);

  // 기타 매출 디바운싱 효과 (유지)
  useEffect(() => {
    setIsOtherFiltering(true);
    const timer = setTimeout(() => {
      setDebouncedOtherFilters(otherFilters);
      setIsOtherFiltering(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [otherFilters]);

  // 필터 초기화 시 로컬 상태 동기화
  useEffect(() => {
    if (measurementFilters.businessName === "") setLocalBusinessName("");
    if (measurementFilters.representativeName === "") setLocalRepresentativeName("");
  }, [measurementFilters.businessName, measurementFilters.representativeName]);

  // 필터 상태 변경 시 로컬 스토리지에 각각 저장
  useEffect(() => {
    if (typeof window !== "undefined") {
      // 각 필터의 최신 상태를 로컬 스토리지에 개별적으로 저장 (새로고침 시 유지용)
      if (measurementFilters.year) localStorage.setItem("sales_last_measurement_year", measurementFilters.year);
      if (measurementFilters.period) localStorage.setItem("sales_last_measurement_period", measurementFilters.period);
      if (otherFilters.year) localStorage.setItem("sales_last_other_year", otherFilters.year);
      if (otherFilters.period) localStorage.setItem("sales_last_other_period", otherFilters.period);
      if (unpaidFilters.year) localStorage.setItem("sales_last_unpaid_year", unpaidFilters.year);
      if (unpaidFilters.period) localStorage.setItem("sales_last_unpaid_period", unpaidFilters.period);
    }
  }, [measurementFilters, otherFilters, unpaidFilters, activeTab]);

  // 기간별 입금 현황 날짜 선택 헬퍼
  const handleQuickDateSelect = (type: "yesterday" | "today" | "week" | "month") => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const today = formatKSTDate(seoulTime);
    let start = "";
    let end = today;

    const startDate = new Date(seoulTime);

    if (type === "yesterday") {
      startDate.setDate(seoulTime.getDate() - 1);
      start = formatKSTDate(startDate);
      end = start;
    } else if (type === "today") {
      start = today;
    } else if (type === "week") {
      startDate.setDate(seoulTime.getDate() - 7);
      start = formatKSTDate(startDate);
    } else if (type === "month") {
      startDate.setMonth(seoulTime.getMonth() - 1);
      start = formatKSTDate(startDate);
    }

    setDepositStartDate(start);
    setDepositEndDate(end);
    setActiveQuickDate(type);
    
    // 퀵 버튼 클릭 시 특정 년도/주기 필터를 해제하여 전체 검색이 가능하도록 함
    setDepositYear("");
    setDepositPeriod("");
  };

  // 측정년도 옵션
  const currentYear = getCurrentYear();
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse();

  // 측정주기 옵션
  const periodOptions = [
    { value: "", label: "전체" },
    { value: "상반기", label: "상반기" },
    { value: "하반기", label: "하반기" },
  ];

  // 지정한계_관할지청 옵션
  const officeOptions = DESIGNATED_OFFICE_OPTIONS;

  const loadSalesData = React.useCallback(async (page: number = 1) => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      params.append("page", page.toString());
      params.append("limit", pageSize.toString());
      
      // 검색 필터 적용 (측정비 탭 기준)
      if (activeTab === "measurement") {
        if (measurementFilters.year) params.append("year", measurementFilters.year);
        if (measurementFilters.businessName) params.append("businessName", measurementFilters.businessName);
        if (measurementFilters.representativeName) params.append("representativeName", measurementFilters.representativeName);
        if (measurementFilters.period) params.append("measurementPeriod", measurementFilters.period);
        if (measurementFilters.designatedOffice) params.append("designatedOffice", measurementFilters.designatedOffice);
        
        // 정렬 적용
        params.append("sortColumn", measurementSort.column);
        params.append("sortDirection", measurementSort.direction);
      } else if (activeTab === "unpaid") {
        if (unpaidFilters.year) params.append("year", unpaidFilters.year);
        if (unpaidFilters.period) params.append("measurementPeriod", unpaidFilters.period);
      } else if (activeTab === "other") {
        // 기타 매출 필터 적용
        if (otherFilters.year) params.append("year", otherFilters.year);
        if (otherFilters.period) params.append("measurementPeriod", otherFilters.period);
        
        // 정렬 적용
        params.append("sortColumn", otherSort.column);
        params.append("sortDirection", otherSort.direction);
      } else if (activeTab === "third_party") {
        // 타업체 발행 현황은 측정비 탭의 년도/주기 필터를 공유
        if (measurementFilters.year) params.append("year", measurementFilters.year);
        if (measurementFilters.period) params.append("measurementPeriod", measurementFilters.period);
      } else if (activeTab === "period-deposit") {
        // 기간별 입금 현황 조회 시 사용자가 선택한 년도/주기 필터가 있으면 서버에 전달
        if (depositYear) params.append("year", depositYear);
        if (depositPeriod) params.append("measurementPeriod", depositPeriod);
      }

      const response = await fetch(`/api/sales?${params.toString()}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API 응답 오류:", response.status, errorText);
        throw new Error(`서버 오류: ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success !== false) {
        setMeasurementRevenue(result.measurementRevenue || []);
        setAllMeasurementData(result.allMeasurementData || []);
        
        const filteredOtherRevenue = (result.otherRevenue || []).filter(
          (item: OtherRevenue) => !deletedOtherIds.has(item.id)
        );
        const filteredAllOtherData = (result.allOtherData || []).filter(
          (item: OtherRevenue) => !deletedOtherIds.has(item.id)
        );
        
        setOtherRevenue(filteredOtherRevenue);
        setAllOtherData(filteredAllOtherData);
        setSummary(result.summary || null);
        
        // 페이지네이션 정보 업데이트
        if (result.pagination) {
          setTotalCount(result.pagination.totalCount);
          setTotalPages(result.pagination.totalPages);
          setCurrentPage(result.pagination.currentPage);
        }
        
        setSelectedOtherIds([]);
      } else {
        setError(result.error || "매출 데이터를 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("매출 데이터 로드 오류:", err);
      setError(err.message || "매출 데이터를 불러오는 중 오류가 발생했습니다.");
      setMeasurementRevenue([]);
      setAllMeasurementData([]);
      setOtherRevenue([]);
      setAllOtherData([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [
    deletedOtherIds, pageSize, activeTab, 
    measurementFilters, unpaidFilters, otherFilters,
    depositYear, depositPeriod,
    yearlySummaryYear, yearlySummaryPeriod, 
    unpaidSummaryYear, unpaidSummaryPeriod
  ]);

  // 데이터 로드 효과
  useEffect(() => {
    loadSalesData(currentPage);
  }, [currentPage]); // 페이지 변경 시 로드

  // 필터 변경 시 1페이지로 리셋하며 데이터 로드
  useEffect(() => {
    setCurrentPage(1);
    loadSalesData(1);
  }, [
    activeTab,
    measurementFilters.year,
    measurementFilters.businessName,
    measurementFilters.period,
    measurementFilters.designatedOffice,
    unpaidFilters.year,
    unpaidFilters.period,
    otherFilters.year,
    otherFilters.period,
    yearlySummaryYear,
    yearlySummaryPeriod,
    unpaidSummaryYear,
    unpaidSummaryPeriod,
    depositYear,
    depositPeriod
  ]);



  const formatCurrency = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined) return "0";
    return new Intl.NumberFormat("ko-KR").format(amount);
  };

  // 천단위 콤마 포맷팅 (입력용)
  const formatNumberInput = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return "";
    return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  };

  // 콤마 제거하여 숫자로 변환
  const parseNumberInput = (value: string): number | null => {
    const numStr = value.replace(/,/g, "");
    if (!numStr || numStr === "") return null;
    const num = parseFloat(numStr);
    return isNaN(num) ? null : num;
  };



  const handleOtherEdit = (item: OtherRevenue | null) => {
    if (item) {
      setSelectedOther(item);
      setOtherFormData({
        item_name: item.item_name,
        invoice_date: item.invoice_date || "",
        supply_amount: item.supply_amount || null,
        vat_amount: item.vat_amount || null,
        total_amount: item.total_amount,
        deposit_date: item.deposit_date || "",
        deposit_amount: item.deposit_amount || null,
        notes: item.notes || "",
        revenue_year: item.revenue_year || null,
        revenue_period: item.revenue_period || "",
      });
    } else {
      setSelectedOther(null);
      setOtherFormData({
        item_name: "",
        invoice_date: "",
        supply_amount: null,
        vat_amount: null,
        total_amount: 0,
        deposit_date: "",
        deposit_amount: null,
        notes: "",
        revenue_year: null,
        revenue_period: "",
      });
    }
    setIsOtherModalOpen(true);
  };

  const handleOtherSave = async () => {
    try {
      setSaving(true);
      setError(null);

      // 데이터 정리: 금액 필드는 숫자로 변환하고, 빈 문자열은 null로 변환
      const cleanedData = {
        item_name: otherFormData.item_name || "",
        invoice_date: otherFormData.invoice_date || null,
        supply_amount: otherFormData.supply_amount !== null && otherFormData.supply_amount !== undefined
          ? Number(otherFormData.supply_amount)
          : null,
        vat_amount: otherFormData.vat_amount !== null && otherFormData.vat_amount !== undefined
          ? Number(otherFormData.vat_amount)
          : null,
        total_amount: otherFormData.total_amount !== null && otherFormData.total_amount !== undefined
          ? Number(otherFormData.total_amount)
          : 0,
        deposit_date: otherFormData.deposit_date || null,
        deposit_amount: otherFormData.deposit_amount !== null && otherFormData.deposit_amount !== undefined
          ? Number(otherFormData.deposit_amount)
          : null,
        notes: otherFormData.notes || null,
        revenue_year: otherFormData.revenue_year !== null && otherFormData.revenue_year !== undefined
          ? Number(otherFormData.revenue_year)
          : null,
        revenue_period: otherFormData.revenue_period || null,
      };

      // 필수 필드 검증
      if (!cleanedData.item_name || !cleanedData.item_name.trim()) {
        setError("품명을 입력해주세요.");
        setSaving(false);
        return;
      }

      // 합계금액 검증: 공급가액과 부가세가 모두 입력되지 않으면 합계금액이 0일 수 있음
      const calculatedTotal = (cleanedData.supply_amount || 0) + (cleanedData.vat_amount || 0);
      const finalTotal = cleanedData.total_amount || calculatedTotal;

      if (!finalTotal || finalTotal <= 0) {
        setError("공급가액과 부가세를 입력하거나 합계금액을 입력해주세요.");
        setSaving(false);
        return;
      }

      // 최종 합계금액 업데이트
      cleanedData.total_amount = finalTotal;

      const url = selectedOther
        ? `/api/sales/other/${selectedOther.id}`
        : "/api/sales/other";
      const method = selectedOther ? "PATCH" : "POST";

      console.log("저장 요청 데이터:", cleanedData);

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleanedData),
      });

      const result = await response.json();
      console.log("저장 응답:", response.status, result);

      if (response.ok && result.success) {
        setIsOtherModalOpen(false);
        setSelectedOther(null);
        setOtherFormData({});
        await loadSalesData();
      } else {
        const errorMessage = result.error || result.details || "저장 중 오류가 발생했습니다.";
        console.error("저장 실패:", errorMessage);
        setError(errorMessage);
      }
    } catch (err: any) {
      console.error("저장 오류:", err);
      setError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleOtherDelete = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    try {
      const response = await fetch(`/api/sales/other/${id}`, { method: "DELETE" });
      const result = await response.json();

      if (response.ok) {
        // 삭제된 항목 ID를 추적 세트에 추가
        setDeletedOtherIds(prev => {
          const newSet = new Set(prev);
          newSet.add(id);
          return newSet;
        });

        // 로컬 상태에서 삭제된 항목 즉시 제거
        setOtherRevenue(prev => prev.filter(item => item.id !== id));
        // 선택된 항목에서도 제거
        setSelectedOtherIds(selectedOtherIds.filter((selectedId) => selectedId !== id));

        // 서버와 동기화는 하지 않고 로컬 상태만 업데이트
        // (사용자가 수동으로 새로고침하거나 다른 작업을 할 때 자동으로 동기화됨)
      } else {
        setError(result.error || "삭제 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("삭제 오류:", err);
      setError(err.message || "삭제 중 오류가 발생했습니다.");
    }
  };

  // 일괄 삭제 관련 함수
  const handleSelectAllOther = (checked: boolean) => {
    if (checked) {
      setSelectedOtherIds(otherRevenue.map((item) => item.id));
    } else {
      setSelectedOtherIds([]);
    }
  };

  const handleSelectOther = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedOtherIds([...selectedOtherIds, id]);
    } else {
      setSelectedOtherIds(selectedOtherIds.filter((selectedId) => selectedId !== id));
    }
  };

  const handleBulkDeleteOther = async () => {
    if (selectedOtherIds.length === 0) {
      alert("삭제할 항목을 선택해주세요.");
      return;
    }

    if (!confirm(`선택한 ${selectedOtherIds.length}개의 항목을 정말 삭제하시겠습니까?`)) {
      return;
    }

    try {
      setIsDeleting(true);
      setError(null);

      // 배치로 삭제 요청 (한 번에 10개씩 처리하여 서버 부하 방지)
      const batchSize = 10;
      const results: PromiseSettledResult<Response>[] = [];

      for (let i = 0; i < selectedOtherIds.length; i += batchSize) {
        const batch = selectedOtherIds.slice(i, i + batchSize);
        const batchPromises = batch.map((id) =>
          fetch(`/api/sales/other/${id}`, { method: "DELETE" })
        );
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults);

        // 배치 간 약간의 지연 (서버 부하 방지)
        if (i + batchSize < selectedOtherIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      let successCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      const successfullyDeletedIds: number[] = [];

      // 각 삭제 요청의 응답을 확인
      for (let index = 0; index < selectedOtherIds.length; index++) {
        const id = selectedOtherIds[index];
        const result = results[index];

        if (result.status === "fulfilled") {
          const response = result.value;
          try {
            if (response.ok) {
              let responseData;
              try {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                  responseData = await response.json();
                } else {
                  // JSON이 아닌 경우 텍스트로 읽기
                  const text = await response.text();
                  responseData = { success: true, message: text };
                }
              } catch (parseError) {
                // 파싱 실패 시 성공으로 간주 (상태 코드가 200-299이면)
                responseData = { success: true };
              }

              if (responseData.success !== false) {
                successCount++;
                successfullyDeletedIds.push(id);
              } else {
                errorCount++;
                errors.push(`항목 ${id} 삭제 실패: ${responseData.error || "알 수 없는 오류"}`);
              }
            } else {
              let errorData;
              try {
                const contentType = response.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                  errorData = await response.json();
                } else {
                  const text = await response.text();
                  errorData = { error: text || response.statusText };
                }
              } catch (parseError) {
                errorData = { error: response.statusText || "응답 파싱 실패" };
              }
              errorCount++;
              const errorMsg = errorData.error || errorData.details || response.statusText || "알 수 없는 오류";
              errors.push(`항목 ${id} 삭제 실패: ${errorMsg}`);
            }
          } catch (error: any) {
            errorCount++;
            errors.push(`항목 ${id} 삭제 중 오류 발생: ${error.message || "알 수 없는 오류"}`);
          }
        } else {
          errorCount++;
          errors.push(`항목 ${id} 삭제 중 오류 발생: ${result.reason || "알 수 없는 오류"}`);
        }
      }

      if (errorCount > 0) {
        setError(`${successCount}개 삭제 성공, ${errorCount}개 삭제 실패: ${errors.join(", ")}`);
      }

      // 성공적으로 삭제된 항목만 로컬 상태에서 즉시 제거
      if (successfullyDeletedIds.length > 0) {
        const deletedIdsSet = new Set(successfullyDeletedIds);
        // 삭제된 항목 ID를 추적 세트에 추가
        setDeletedOtherIds(prev => {
          const newSet = new Set(prev);
          successfullyDeletedIds.forEach(id => newSet.add(id));
          return newSet;
        });

        setOtherRevenue(prev => prev.filter(item => !deletedIdsSet.has(item.id)));
      }

      // 선택 초기화
      setSelectedOtherIds([]);

      // 서버와 동기화는 하지 않고 로컬 상태만 업데이트
      // (사용자가 수동으로 새로고침하거나 다른 작업을 할 때 자동으로 동기화됨)

      if (errorCount === 0) {
        alert(`${successCount}개의 항목이 삭제되었습니다.`);
      }
    } catch (err: any) {
      console.error("일괄 삭제 오류:", err);
      setError(err.message || "일괄 삭제 중 오류가 발생했습니다.");
    } finally {
      setIsDeleting(false);
    }
  };

  // 파일 업로드 핸들러
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Excel 파일만 허용
      const validExtensions = [".xlsx", ".xls"];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
      if (!validExtensions.includes(fileExtension)) {
        setUploadError("Excel 파일(.xlsx, .xls)만 업로드할 수 있습니다.");
        return;
      }
      setUploadFile(file);
      setUploadError(null);
      setUploadResult(null);
    }
  };

  // 업로드 실행
  const handleUpload = async () => {
    if (!uploadFile) {
      setUploadError("파일을 선택해주세요.");
      return;
    }

    setUploadLoading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);

      const response = await fetch("/api/sales/other/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setUploadResult(data);
        // 업로드 성공 시 데이터 새로고침
        await loadSalesData();
      } else {
        setUploadError(data.error || "업로드 중 오류가 발생했습니다.");
      }
    } catch (error: any) {
      console.error("업로드 오류:", error);
      setUploadError(error.message || "업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadLoading(false);
    }
  };

  // 업로드 모달 닫기
  const handleUploadModalClose = () => {
    setIsUploadModalOpen(false);
    setUploadFile(null);
    setUploadError(null);
    setUploadResult(null);
  };

  // 측정비 일괄 업로드 핸들러
  const handleMeasurementUploadFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validExtensions = [".xlsx", ".xls"];
      const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
      if (!validExtensions.includes(fileExtension)) {
        setMeasurementUploadError("Excel 파일(.xlsx, .xls)만 업로드할 수 있습니다.");
        return;
      }
      setMeasurementUploadFile(file);
      setMeasurementUploadError(null);
      setMeasurementUploadResult(null);
    }
  };

  const handleMeasurementUpload = async () => {
    if (!measurementUploadFile) {
      setMeasurementUploadError("파일을 선택해주세요.");
      return;
    }

    setMeasurementUploadLoading(true);
    setMeasurementUploadError(null);
    setMeasurementUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", measurementUploadFile);

      const response = await fetch("/api/sales/measurement/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setMeasurementUploadResult(data);
        await loadSalesData();
      } else {
        setMeasurementUploadError(data.error || "업로드 중 오류가 발생했습니다.");
      }
    } catch (error: any) {
      console.error("업로드 오류:", error);
      setMeasurementUploadError(error.message || "업로드 중 오류가 발생했습니다.");
    } finally {
      setMeasurementUploadLoading(false);
    }
  };

  const handleMeasurementUploadModalClose = () => {
    setIsMeasurementUploadModalOpen(false);
    setMeasurementUploadFile(null);
    setMeasurementUploadError(null);
    setMeasurementUploadResult(null);
  };

  // 양식 다운로드 핸들러
  const handleDownloadTemplate = () => {
    // 템플릿 데이터 생성
    const templateData = [
      {
        "코드(필수)": "H0433",
        "측정년도(필수)": "2025",
        "측정주기(필수)": "상반기",
        "사업장명(참고용)": "(주)예시사업장",
        "측정비(사업장)": "150000",
        "입금일(사업장)": "2025-05-15",
        "입금액(사업장)": "150000",
        "측정비(국고)": "300000",
        "입금일(국고)": "2025-06-20",
        "입금액(국고)": "300000",
        "전자계산서 발행일": "2025-05-10",
        "계산서 이메일": "tax@example.com",
        "발행처 상호(변경)": "타업체상호(주)",
        "발행처 사업자(변경)": "000-00-00000"
      },
      {
        "코드(필수)": "입력필수",
        "측정년도(필수)": "입력필수",
        "측정주기(필수)": "입력필수",
        "사업장명(참고용)": "",
        "측정비(사업장)": "",
        "입금일(사업장)": "",
        "입금액(사업장)": "",
        "측정비(국고)": "",
        "입금일(국고)": "",
        "입금액(국고)": "",
        "전자계산서 발행일": "",
        "계산서 이메일": "",
        "발행처 상호(변경)": "",
        "발행처 사업자(변경)": ""
      }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);

    // 컬럼 너비 설정
    const wscols = [
      { wch: 10 }, // 코드
      { wch: 15 }, // 측정년도
      { wch: 15 }, // 측정주기
      { wch: 20 }, // 사업장명
      { wch: 15 }, // 측정비(사업장)
      { wch: 15 }, // 입금일(사업장)
      { wch: 15 }, // 입금액(사업장)
      { wch: 15 }, // 측정비(국고)
      { wch: 15 }, // 입금일(국고)
      { wch: 15 }, // 입금액(국고)
      { wch: 15 }, // 전자계산서 발행일
      { wch: 20 }, // 계산서 이메일
      { wch: 20 }, // 발행처 상호(변경)
      { wch: 20 }, // 발행처 사업자(변경)
    ];
    ws["!cols"] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "입금정보일괄업로드양식");
    XLSX.writeFile(wb, "측정비_입금정보_업로드_양식.xlsx");
  };

  const handleMeasurementEdit = async (item: MeasurementRevenue) => {
    try {
      const response = await fetch(
        `/api/journal/search?code=${encodeURIComponent(item.code || '')}&measurementYear=${item.measurement_year}&measurementPeriod=${encodeURIComponent(item.measurement_period)}&_t=${new Date().getTime()}`,
        { cache: 'no-store' }
      );
      if (response.ok) {
        const data = await response.json();
        const journal = data.results?.find((j: any) => j.id === item.id);
        if (journal) {
          setSelectedJournalEntry(journal);
          setIsJournalModalOpen(true);
        } else {
          setError("측정일지를 찾을 수 없습니다.");
        }
      } else {
        setError("측정일지 데이터를 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err) {
      console.error("측정일지 조회 오류:", err);
      setError("측정일지 데이터를 불러오는 중 오류가 발생했습니다.");
    }
  };

  // 데이터 로컬 로딩 중에도 레이아웃 프레임을 유지하여 스크롤 점프 방지
  // if (loading) {
  //   return (
  //     <div className="flex justify-center py-12">
  //       <LoadingSpinner />
  //     </div>
  //   );
  // }


  if (error && !summary) {
    return <Alert variant="error">{error}</Alert>;
  }

  const offices = [...DESIGNATED_OFFICES_FOR_SALES];

  return (
    <div className="relative">
      {/* 로딩 오버레이: 스크롤 위치를 유지하면서 사용자에게 로딩 상태 알림 */}
      {loading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/30 backdrop-blur-[1px]">
          <div className="bg-white p-6 rounded-xl shadow-2xl border border-primary-100 flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-200">
            <LoadingSpinner className="w-12 h-12 text-primary-600" />
            <p className="text-primary-900 font-bold text-lg">데이터를 불러오는 중입니다...</p>
          </div>
        </div>
      )}

      <div className={cn("space-y-4 transition-all duration-300", loading ? "opacity-50 grayscale-[20%] pointer-events-none blur-[1px]" : "opacity-100")}>

      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-900 mb-2">매출관리</h1>
          <p className="text-text-700">측정비와 기타 매출을 관리하고 집계할 수 있습니다.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
            onClick={handleDownloadTemplate}
          >
            <span className="mr-2">📥</span>
            양식 다운로드
          </Button>
          <Button
            variant="secondary"
            className="bg-white border-primary-200 text-primary-700 hover:bg-primary-50"
            onClick={() => setIsMeasurementUploadModalOpen(true)}
          >
            <span className="mr-2">📊</span>
            측정비 일괄 업로드
          </Button>
        </div>
      </div>


      {error && <Alert variant="error">{error}</Alert>}

      {/* 매출 집계 및 상세 모달 (추출된 컴포넌트) */}
      <SalesSummary
        summary={summary}
        salesSummaryYear={salesSummaryYear}
        setSalesSummaryYear={setSalesSummaryYear}
        yearOptions={yearOptions}
        measurementRevenue={measurementRevenue}
        formatCurrency={formatCurrency}
      />

      {/* 년도별 집계 및 미수금 현황 */}
      {summary && (
        <StatTables
          summary={summary}
          measurementRevenue={allMeasurementData}
          otherRevenue={otherRevenue}
          allOtherData={allOtherData}
          formatCurrency={formatCurrency}
          yearOptions={yearOptions}
          yearlySummaryYear={yearlySummaryYear}
          setYearlySummaryYear={setYearlySummaryYear}
          yearlySummaryPeriod={yearlySummaryPeriod}
          setYearlySummaryPeriod={setYearlySummaryPeriod}
          unpaidSummaryYear={unpaidSummaryYear}
          setUnpaidSummaryYear={setUnpaidSummaryYear}
          unpaidSummaryPeriod={unpaidSummaryPeriod}
          setUnpaidSummaryPeriod={setUnpaidSummaryPeriod}
        />
      )}

      {/* 매출 관리 탭 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold text-text-900 mb-4">매출 상세 현황</h2>
        <Tab
          activeTab={activeTab}
          onTabChange={handleTabChange}
          items={[
            {
              id: "measurement",
              label: "측정비",
              content: (
                <MeasurementTable
                  measurementRevenue={measurementRevenue}
                  measurementFilters={measurementFilters}
                  setMeasurementFilters={setMeasurementFilters}
                  measurementSort={measurementSort}
                  setMeasurementSort={setMeasurementSort}
                  localBusinessName={localBusinessName}
                  setLocalBusinessName={setLocalBusinessName}
                  localRepresentativeName={localRepresentativeName}
                  setLocalRepresentativeName={setLocalRepresentativeName}
                  yearOptions={yearOptions}
                  periodOptions={periodOptions}
                  officeOptions={officeOptions}
                  totalCount={totalCount}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  setCurrentPage={setCurrentPage}
                  loading={loading}
                  isMeasurementFiltering={isMeasurementFiltering}
                  formatCurrency={formatCurrency}
                  formatDateYYYYMMDD={formatDateYYYYMMDD}
                  setMeasurementDepositDetailItem={setMeasurementDepositDetailItem}
                  setIsMeasurementDepositDetailModalOpen={setIsMeasurementDepositDetailModalOpen}
                  handleMeasurementEdit={handleMeasurementEdit}
                  checkSearchMatch={checkSearchMatch}
                  checkExactMatch={checkExactMatch}
                  isMatchSelection={isMatchSelection}
                  getPeriodWeight={getPeriodWeight}
                />
              ),
            },
            {
              id: "other",
              label: "기타",
              content: (
                <OtherRevenueTable
                  data={otherRevenue}
                  onEdit={handleOtherEdit}
                  formatCurrency={formatCurrency}
                  otherFilters={otherFilters}
                  setOtherFilters={setOtherFilters}
                  yearOptions={yearOptions}
                  periodOptions={periodOptions}
                  loading={loading}
                />
              ),
            },
            {
              id: "third_party",
              label: "타업체 발행 현황",
              content: (() => {
                // 타업체 발행 건만 필터링 (발행처 정보가 입력되었고, 원래 정보와 다른 건)
                // 현재 페이지 데이터가 아닌 전체 데이터(allMeasurementData)를 기준으로 필터링하여 모든 내역을 표시
                const thirdPartyItems = allMeasurementData.filter(item => 
                  (item.invoice_business_number && item.invoice_business_number !== item.business_number) ||
                  (item.invoice_business_name && item.invoice_business_name !== item.business_name)
                );

                return (
                  <div className="mt-4">
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4 flex items-start gap-3">
                      <div className="bg-blue-500 text-white rounded-full p-1 mt-0.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm text-blue-800 font-medium">타업체 발행 현황 안내</p>
                        <p className="text-xs text-blue-600 mt-1">측정일지에 등록된 사업장과 다른 사업자번호 또는 상호로 계산서를 발행한 내역입니다. 입금 확인 시 발행처 정보를 활용하세요.</p>
                      </div>
                    </div>

                    <div className="rounded-lg border border-surface-200 min-h-[500px] bg-white overflow-hidden shadow-sm">
                      <Table className="table-fixed">
                        <TableHeader>
                          <TableRow className="bg-surface-50">
                            <TableHead className="w-[100px]">발행일</TableHead>
                            <TableHead className="w-[200px]">사업장명 (원래)</TableHead>
                            <TableHead className="w-[130px]">사업자번호 (원래)</TableHead>
                            <TableHead className="w-[200px] border-l border-primary-100 bg-primary-50/50">발행처 상호 (변경)</TableHead>
                            <TableHead className="w-[130px] bg-primary-50/50">발행처 사업자 (변경)</TableHead>
                            <TableHead className="w-[120px] text-right">측정비(사업장)</TableHead>
                            <TableHead className="w-[90px] text-center">입금상태</TableHead>
                            <TableHead className="w-[80px] text-center">작업</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {thirdPartyItems.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center text-text-500 py-16">
                                <div className="flex flex-col items-center gap-2">
                                  <span className="text-3xl">📄</span>
                                  <p>타업체로 발행된 내역이 발견되지 않았습니다.</p>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : (
                            thirdPartyItems.map((item) => {
                              const total = parseFloat(item.measurement_fee_business?.toString() || "0");
                              const deposit = parseFloat(((item.deposit_amount_business || 0) + (item.deposit_amount_business_2 || 0)).toString());
                              const isFullyPaid = total > 0 && deposit >= total;
                              
                              return (
                                <TableRow key={item.id} className="hover:bg-surface-50 transition-colors">
                                  <TableCell className="text-sm text-text-600">
                                    {item.electronic_invoice_date ? formatDateYYYYMMDD(item.electronic_invoice_date) : "-"}
                                  </TableCell>
                                  <TableCell className="font-medium truncate text-text-700" title={item.business_name}>
                                    {item.business_name}
                                  </TableCell>
                                  <TableCell className="text-xs text-text-400">
                                    {formatBusinessNumber(item.business_number)}
                                  </TableCell>
                                  <TableCell className="font-bold text-primary-700 border-l border-primary-50 truncate" title={item.invoice_business_name || item.business_name}>
                                    {item.invoice_business_name || item.business_name}
                                  </TableCell>
                                  <TableCell className="font-bold text-primary-700">
                                    {formatBusinessNumber(item.invoice_business_number) || "-"}
                                  </TableCell>
                                  <TableCell className="text-right font-semibold text-text-800">
                                    {formatCurrency(total)}원
                                  </TableCell>
                                  <TableCell className="text-center">
                                    {isFullyPaid ? (
                                      <span className="px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-bold">완납</span>
                                    ) : (
                                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">미납</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      className="h-7 text-[10px] px-2"
                                      onClick={async () => {
                                        try {
                                          const response = await fetch(
                                            `/api/journal/search?code=${encodeURIComponent(item.code || '')}&measurementYear=${item.measurement_year}&measurementPeriod=${encodeURIComponent(item.measurement_period)}&_t=${new Date().getTime()}`,
                                            { cache: 'no-store' }
                                          );
                                          if (response.ok) {
                                            const data = await response.json();
                                            const journal = data.results?.find((j: any) => j.id === item.id);
                                            if (journal) {
                                              setSelectedJournalEntry(journal);
                                              setIsJournalModalOpen(true);
                                            }
                                          }
                                        } catch (err) {
                                          console.error("조회 오류:", err);
                                        }
                                      }}
                                    >
                                      보기
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })(),
            },
            {
              id: "unpaid",
              label: "미수관리",
              content: (() => {
                // 미수금이 있는 항목들을 통합하여 계산
                const unpaidItems: Array<{
                  id: string;
                  measurementId?: number; // 측정일지 ID (측정비인 경우)
                  code?: string; // 측정일지 code (측정비인 경우)
                  type: "measurement" | "other";
                  name: string;
                  year: number;
                  period: string;
                  revenue: number;
                  deposit: number;
                  unpaid: number;
                  depositDate: string | null;
                  designatedOffice: string | null;
                }> = [];

                // 측정비 미수금 항목 추가
                measurementRevenue.forEach((item) => {
                  const total = parseFloat(item.measurement_fee_total?.toString() || "0");
                  const deposit = parseFloat(item.deposit_total?.toString() || "0");
                  const unpaid = total - deposit;
                  if (unpaid > 0) {
                    unpaidItems.push({
                      id: `measurement-${item.id}`,
                      measurementId: item.id,
                      code: item.code,
                      type: "measurement",
                      name: item.business_name,
                      year: item.measurement_year,
                      period: item.measurement_period,
                      revenue: total,
                      deposit: deposit,
                      unpaid: unpaid,
                      depositDate: item.deposit_date_business || item.deposit_date_national || null,
                      designatedOffice: item.designated_office || null,
                    });
                  }
                });

                // 기타 매출 미수금 항목 추가
                otherRevenue.forEach((item) => {
                  const total = parseFloat(item.total_amount?.toString() || "0");
                  const deposit = parseFloat(item.deposit_amount?.toString() || "0");
                  const unpaid = total - deposit;
                  if (unpaid > 0) {
                    unpaidItems.push({
                      id: `other-${item.id}`,
                      type: "other",
                      name: item.item_name,
                      year: item.revenue_year || 0,
                      period: item.revenue_period || "",
                      revenue: total,
                      deposit: deposit,
                      unpaid: unpaid,
                      depositDate: item.deposit_date || null,
                      designatedOffice: item.designated_office || null,
                    });
                  }
                });

                // 필터링 적용
                let filteredItems = unpaidItems.filter((item) => {
                  if (unpaidFilters.type && item.type !== unpaidFilters.type) return false;
                  if (unpaidFilters.name && !checkSearchMatch(item.name, unpaidFilters.name)) return false;
                  if (unpaidFilters.year && !checkExactMatch(item.year, unpaidFilters.year)) return false;
                  if (unpaidFilters.period && !isMatchSelection(item.period, unpaidFilters.period)) return false;
                  if (unpaidFilters.designatedOffice && !checkExactMatch(item.designatedOffice, unpaidFilters.designatedOffice)) return false;
                  if (unpaidFilters.hasDepositDate === "yes" && !item.depositDate) return false;
                  if (unpaidFilters.hasDepositDate === "no" && item.depositDate) return false;
                  return true;
                });

                // 정렬 적용
                filteredItems.sort((a, b) => {
                  let result = 0;
                  let aValue: any = a[unpaidSort.column as keyof typeof a];
                  let bValue: any = b[unpaidSort.column as keyof typeof b];

                  // 문자열 비교
                  if (typeof aValue === "string" && typeof bValue === "string") {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                  }

                  // null 처리
                  if (aValue === null || aValue === undefined) aValue = "";
                  if (bValue === null || bValue === undefined) bValue = "";

                  if (aValue > bValue) result = unpaidSort.direction === "asc" ? 1 : -1;
                  else if (aValue < bValue) result = unpaidSort.direction === "asc" ? -1 : 1;

                  if (result !== 0) return result;

                  // 2차 정렬: 년도 내림차순 (DESC)
                  if (a.year !== b.year) {
                    return b.year - a.year;
                  }

                  // 3차 정렬: 주기 내림차순 (하반기 > 상반기)
                  const aWeight = getPeriodWeight(a.period);
                  const bWeight = getPeriodWeight(b.period);
                  return bWeight - aWeight;
                });

                // 미수금 합계 계산
                const totalUnpaid = filteredItems.reduce((sum, item) => sum + item.unpaid, 0);

                // 정렬 아이콘 컴포넌트
                const SortIcon = ({ column }: { column: string }) => {
                  if (unpaidSort.column !== column) {
                    return <span className="text-text-400 text-xs ml-1">↕</span>;
                  }
                  return (
                    <span className="text-primary-600 text-xs ml-1">
                      {unpaidSort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  );
                };

                // 정렬 핸들러
                const handleSort = (column: string) => {
                  if (unpaidSort.column === column) {
                    setUnpaidSort({
                      column,
                      direction: unpaidSort.direction === "asc" ? "desc" : "asc",
                    });
                  } else {
                    setUnpaidSort({ column, direction: "desc" });
                  }
                };

                return (
                  <div className="mt-4">
                    <div className="sticky top-[-1px] z-40 bg-white py-3 flex justify-between items-center border-b border-surface-100 mb-2">
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-medium text-text-700">
                          검색 결과: <span className="text-primary-600 font-bold">{filteredItems.length}</span>건 <span className="text-text-400 font-normal ml-1">(전체 {unpaidItems.length}건)</span>
                        </div>
                        {isUnpaidFiltering && (
                          <div className="flex items-center gap-2 text-xs text-primary-500 animate-pulse">
                            <LoadingSpinner className="w-3 h-3" />
                            <span>검색 중...</span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs font-semibold"
                        onClick={() => {
                          const initial = {
                            type: "",
                            name: "",
                            year: "",
                            period: "",
                            designatedOffice: "",
                            hasDepositDate: "",
                          };
                          setUnpaidFilters(initial);
                          // setDebouncedUnpaidFilters(initial); // Removed as debounce logic was removed
                          setUnpaidSort({ column: "unpaid", direction: "desc" });
                        }}
                      >
                        필터 초기화
                      </Button>
                    </div>
                    <div className="rounded-lg border border-surface-200 min-h-[500px] bg-white overflow-hidden">
                      <Table className="table-fixed" maxHeight="max-h-[calc(100vh-350px)]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[80px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("type")}
                                >
                                  구분
                                  <SortIcon column="type" />
                                </div>
                                <Select
                                  value={unpaidFilters.type}
                                  onChange={(e) =>
                                    setUnpaidFilters({ ...unpaidFilters, type: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    { value: "measurement", label: "측정비" },
                                    { value: "other", label: "기타" },
                                  ]}
                                  className="text-sm h-8 py-1 px-2 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[100px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("designatedOffice")}
                                >
                                  지정지청
                                  <SortIcon column="designatedOffice" />
                                </div>
                                <Select
                                  value={unpaidFilters.designatedOffice}
                                  onChange={(e) =>
                                    setUnpaidFilters({ ...unpaidFilters, designatedOffice: e.target.value })
                                  }
                                  options={[{ value: "", label: "전체" }, ...officeOptions]}
                                  className="text-sm h-8 py-1 px-2 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[300px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("name")}
                                >
                                  사업장명/품명
                                  <SortIcon column="name" />
                                </div>
                                <Input
                                  value={localUnpaidName}
                                  onChange={(e) => setLocalUnpaidName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      setUnpaidFilters({ ...unpaidFilters, name: localUnpaidName });
                                    }
                                  }}
                                  onBlur={() => {
                                    setUnpaidFilters({ ...unpaidFilters, name: localUnpaidName });
                                  }}
                                  placeholder="검색..."
                                  className="text-xs h-8 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[80px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("year")}
                                >
                                  매출년도
                                  <SortIcon column="year" />
                                </div>
                                <Select
                                  value={unpaidFilters.year}
                                  onChange={(e) =>
                                    setUnpaidFilters({ ...unpaidFilters, year: e.target.value })
                                  }
                                  options={[{ value: "", label: "전체" }, ...yearOptions]}
                                  className="text-sm h-8 py-1 px-2 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[80px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("period")}
                                >
                                  측정주기
                                  <SortIcon column="period" />
                                </div>
                                <Select
                                  value={unpaidFilters.period}
                                  onChange={(e) =>
                                    setUnpaidFilters({ ...unpaidFilters, period: e.target.value })
                                  }
                                  options={periodOptions}
                                  className="text-sm h-8 py-1 px-2 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[120px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("revenue")}
                                >
                                  매출금액
                                  <SortIcon column="revenue" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[120px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("deposit")}
                                >
                                  입금액
                                  <SortIcon column="deposit" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="w-[120px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("depositDate")}
                                >
                                  입금일
                                  <SortIcon column="depositDate" />
                                </div>
                                <Select
                                  value={unpaidFilters.hasDepositDate}
                                  onChange={(e) =>
                                    setUnpaidFilters({ ...unpaidFilters, hasDepositDate: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    { value: "yes", label: "입금일 있음" },
                                    { value: "no", label: "입금일 없음" },
                                  ]}
                                  className="text-sm h-8 py-1 px-2 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[120px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("unpaid")}
                                >
                                  미수금
                                  <SortIcon column="unpaid" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="w-[80px]">작업</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredItems.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={10} className="text-center text-text-500 py-8">
                                {unpaidItems.length === 0
                                  ? "미수금이 있는 항목이 없습니다."
                                  : "필터 조건에 맞는 항목이 없습니다."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            <>
                              {filteredItems.map((item) => {
                                const hasNoDepositDate = !item.depositDate;
                                return (
                                  <TableRow
                                    key={item.id}
                                    className={hasNoDepositDate ? "bg-warning-50" : ""}
                                  >
                                    <TableCell>
                                      <span
                                        className={`px-2 py-1 rounded text-xs ${item.type === "measurement"
                                          ? "bg-primary-100 text-primary-700"
                                          : "bg-secondary-100 text-secondary-700"
                                          }`}
                                      >
                                        {item.type === "measurement" ? "측정비" : "기타"}
                                      </span>
                                    </TableCell>
                                    <TableCell>{item.designatedOffice || "-"}</TableCell>
                                    <TableCell className="font-medium truncate max-w-[280px]" title={item.name}>{item.name}</TableCell>
                                    <TableCell>{item.year}</TableCell>
                                    <TableCell>{item.period}</TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(item.revenue)}원
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(item.deposit)}원
                                    </TableCell>
                                    <TableCell
                                      className={hasNoDepositDate ? "text-warning-600 font-semibold" : ""}
                                    >
                                      {item.depositDate ? formatDateYYYYMMDD(item.depositDate) : "미입금"}
                                    </TableCell>
                                    <TableCell className="text-right text-warning-600 font-semibold">
                                      {formatCurrency(item.unpaid)}원
                                    </TableCell>
                                    <TableCell>
                                      {item.type === "measurement" && item.measurementId && item.code ? (
                                        <Button
                                          variant="secondary"
                                          size="sm"
                                          onClick={async () => {
                                            try {
                                              // 측정일지 데이터 가져오기
                                              const response = await fetch(
                                                `/api/journal/search?code=${encodeURIComponent(item.code || '')}&measurementYear=${item.year}&measurementPeriod=${encodeURIComponent(item.period || '')}&_t=${new Date().getTime()}`,
                                                { cache: 'no-store' }
                                              );
                                              if (response.ok) {
                                                const data = await response.json();
                                                const journal = data.results?.find((j: any) => j.id === item.measurementId);
                                                if (journal) {
                                                  setSelectedJournalEntry(journal);
                                                  setIsJournalModalOpen(true);
                                                } else {
                                                  setError("측정일지를 찾을 수 없습니다.");
                                                }
                                              } else {
                                                setError("측정일지 데이터를 불러오는 중 오류가 발생했습니다.");
                                              }
                                            } catch (err) {
                                              console.error("측정일지 조회 오류:", err);
                                              setError("측정일지 데이터를 불러오는 중 오류가 발생했습니다.");
                                            }
                                          }}
                                        >
                                          수정
                                        </Button>
                                      ) : (
                                        <span className="text-text-400 text-sm">-</span>
                                      )}
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                              <TableRow className="bg-surface-50">
                                <TableCell colSpan={8} className="text-right font-semibold">
                                  미수금 합계
                                </TableCell>
                                <TableCell className="text-right font-bold text-warning-600 text-lg">
                                  {formatCurrency(totalUnpaid)}원
                                </TableCell>
                                <TableCell>{""}</TableCell>
                              </TableRow>
                            </>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })(),
            },
            {
              id: "period-deposit",
              label: "기간별 입금 현황",
              content: (() => {
                // 입금 내역 통합
                interface UnifiedDeposit {
                  id: string;
                  date: string;
                  category: string;
                  name: string;
                  representative: string | null;
                  amount: number;
                  notes: string;
                  designatedOffice: string | null;
                  year: number | null;
                  period: string | null;
                }

                const unifiedDeposits: UnifiedDeposit[] = [];

                // 1. 측정비 사업장 입금 (1차, 2차)
                allMeasurementData.forEach(item => {
                  // 1차 입금
                  if (item.deposit_date_business && item.deposit_amount_business) {
                    unifiedDeposits.push({
                      id: `meas-biz-${item.id}`,
                      date: item.deposit_date_business,
                      category: "측정비(사업장)",
                      name: item.business_name,
                      representative: item.representative_name,
                      amount: item.deposit_amount_business,
                      notes: `${item.measurement_year}년 ${item.measurement_period}`,
                      designatedOffice: item.designated_office,
                      year: item.measurement_year,
                      period: item.measurement_period,
                    });
                  }

                  // 2차 입금
                  if (item.deposit_date_business_2 && item.deposit_amount_business_2) {
                    unifiedDeposits.push({
                      id: `meas-biz2-${item.id}`,
                      date: item.deposit_date_business_2,
                      category: "측정비(사업장)",
                      name: item.business_name,
                      representative: item.representative_name,
                      amount: item.deposit_amount_business_2,
                      notes: `${item.measurement_year}년 ${item.measurement_period} (2차)`,
                      designatedOffice: item.designated_office,
                      year: item.measurement_year,
                      period: item.measurement_period,
                    });
                  }
                });

                // 2. 측정비 국고 입금
                allMeasurementData.forEach(item => {
                  if (item.deposit_date_national && item.deposit_amount_national) {
                    unifiedDeposits.push({
                      id: `meas-nat-${item.id}`,
                      date: item.deposit_date_national,
                      category: "측정비(국고)",
                      name: item.business_name,
                      representative: item.representative_name,
                      amount: item.deposit_amount_national,
                      notes: `${item.measurement_year}년 ${item.measurement_period}`,
                      designatedOffice: item.designated_office,
                      year: item.measurement_year,
                      period: item.measurement_period,
                    });
                  }
                });

                // 3. 기타 매출 입금
                allOtherData.forEach(item => {
                  if (item.deposit_date && item.deposit_amount) {
                    unifiedDeposits.push({
                      id: `other-${item.id}`,
                      date: item.deposit_date,
                      category: "기타 매출",
                      name: item.item_name,
                      representative: null,
                      amount: item.deposit_amount,
                      notes: item.notes || "",
                      designatedOffice: item.designated_office,
                      year: item.revenue_year,
                      period: item.revenue_period,
                    });
                  }
                });

                // 필터링 적용
                const filteredDeposits = unifiedDeposits.filter(item => {
                  const itemDateOnly = item.date.substring(0, 10);
                  const startDateMatch = !depositStartDate || itemDateOnly >= depositStartDate;
                  const endDateMatch = !depositEndDate || itemDateOnly <= depositEndDate;
                  const dateMatch = startDateMatch && endDateMatch;
                  const officeMatch = checkExactMatch(item.designatedOffice, depositOffice);
                  const yearMatch = checkExactMatch(item.year, depositYear);
                  const periodMatch = isMatchSelection(item.period || null, depositPeriod);
                  const categoryMatch = !depositCategory || item.category === depositCategory;
                  const businessNameMatch = checkSearchMatch(item.name, depositBusinessName);

                  return dateMatch && officeMatch && yearMatch && periodMatch && categoryMatch && businessNameMatch;
                });

                // 날짜순 정렬 (최신순)
                filteredDeposits.sort((a, b) => b.date.localeCompare(a.date));

                const totalDepositAmount = filteredDeposits.reduce((sum, item) => sum + item.amount, 0);

                return (
                  <div className="mt-4">
                    <div className="bg-white p-6 border border-surface-200 rounded-xl mb-6 shadow-md">
                      <div className="flex flex-nowrap items-end gap-x-2 overflow-x-auto pb-2 scrollbar-hide">
                        {/* 1. 매출년도 */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <label className="text-sm font-bold text-text-800 ml-1">매출년도</label>
                          <Select
                            value={depositYear}
                            onChange={(e) => setDepositYear(e.target.value)}
                            options={[{ value: "", label: "전체" }, ...yearOptions]}
                            className="w-28 h-10 text-sm font-medium text-center py-2"
                          />
                        </div>

                        {/* 2. 주기 */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <label className="text-sm font-bold text-text-800 ml-1">주기</label>
                          <Select
                            value={depositPeriod}
                            onChange={(e) => setDepositPeriod(e.target.value)}
                            options={periodOptions}
                            className="w-24 h-10 text-sm font-medium text-center py-2"
                          />
                        </div>

                        {/* 3. 지정지청 */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <label className="text-sm font-bold text-text-800 ml-1">지정지청</label>
                          <Select
                            value={depositOffice}
                            onChange={(e) => setDepositOffice(e.target.value)}
                            options={[{ value: "", label: "전체" }, ...officeOptions]}
                            className="w-28 h-10 text-sm font-medium text-center py-2"
                          />
                        </div>

                        {/* 4. 매출 구분 */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <label className="text-sm font-bold text-text-800 ml-1">매출 구분</label>
                          <Select
                            value={depositCategory}
                            onChange={(e) => setDepositCategory(e.target.value)}
                            options={[
                              { value: "", label: "전체 매출" },
                              { value: "측정비(사업장)", label: "측정비(사업장)" },
                              { value: "측정비(국고)", label: "측정비(국고)" },
                              { value: "기타 매출", label: "기타 매출" },
                            ]}
                            className="w-32 h-10 text-sm font-medium text-center py-2"
                          />
                        </div>

                        {/* 5. 입금 기간 */}
                        <div className="flex flex-col gap-1 shrink-0">
                          <label className="text-sm font-bold text-text-800 ml-1">입금 기간</label>
                          <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-lg border border-gray-200">
                            <div className="flex items-center gap-1">
                              <Input
                                type="date"
                                value={depositStartDate}
                                onChange={(e) => {
                                  setDepositStartDate(e.target.value);
                                  setActiveQuickDate(null);
                                }}
                                className="w-[135px] h-9 text-sm font-bold"
                              />
                              <span className="text-text-400 font-bold text-lg">~</span>
                              <Input
                                type="date"
                                value={depositEndDate}
                                onChange={(e) => {
                                  setDepositEndDate(e.target.value);
                                  setActiveQuickDate(null);
                                }}
                                className="w-[135px] h-9 text-sm font-bold"
                              />
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => {
                                  setDepositStartDate("");
                                  setDepositEndDate("");
                                  setActiveQuickDate(null);
                                }}
                                className="h-9 px-2 text-gray-400 hover:text-red-500 bg-transparent border-none shadow-none"
                                title="기간 초기화"
                              >
                                ✕
                              </Button>
                            </div>
                            <div className="flex items-center gap-1 border-l pl-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleQuickDateSelect("yesterday")}
                                className={cn(
                                  "h-8 px-2 font-bold transition-all rounded text-xs border shadow-none",
                                  activeQuickDate === "yesterday"
                                    ? "bg-slate-600 text-white border-slate-700 hover:bg-slate-700"
                                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                )}
                              >
                                전일
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleQuickDateSelect("today")}
                                className={cn(
                                  "h-8 px-2 font-bold transition-all rounded text-xs border shadow-none",
                                  activeQuickDate === "today"
                                    ? "bg-amber-500 text-white border-amber-600 hover:bg-amber-600"
                                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                )}
                              >
                                금일
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleQuickDateSelect("week")}
                                className={cn(
                                  "h-8 px-2 font-bold transition-all rounded text-xs border shadow-none",
                                  activeQuickDate === "week"
                                    ? "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600"
                                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                )}
                              >
                                1주
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleQuickDateSelect("month")}
                                className={cn(
                                  "h-8 px-2 font-bold transition-all rounded text-xs border shadow-none",
                                  activeQuickDate === "month"
                                    ? "bg-rose-500 text-white border-rose-600 hover:bg-rose-600"
                                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                                )}
                              >
                                1개월
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* 6. 사업장명 / 품명 */}
                        <div className="flex flex-col gap-1 w-[200px] shrink-0">
                          <label className="text-sm font-bold text-text-800 ml-1">검색</label>
                          <Input
                            placeholder="사업장명/품명..."
                            value={localDepositBusinessName}
                            onChange={(e) => setLocalDepositBusinessName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                setDepositBusinessName(localDepositBusinessName);
                              }
                            }}
                            onBlur={() => {
                              setDepositBusinessName(localDepositBusinessName);
                            }}
                            className="h-10 text-sm font-medium px-3"
                          />
                        </div>

                        <div className="flex items-center gap-3 ml-auto shrink-0">
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-10 text-xs font-semibold px-3"
                            onClick={() => {
                              setDepositYear("");
                              setDepositPeriod("");
                              setDepositOffice("");
                              setDepositCategory("");
                              setDepositStartDate("");
                              setDepositEndDate("");
                              setDepositBusinessName("");
                              setLocalDepositBusinessName("");
                              setActiveQuickDate(null);
                            }}
                          >
                            필터 초기화
                          </Button>

                          {/* 입금 건수 */}
                          <div className="bg-blue-600 px-4 py-2 rounded-xl shadow-lg shadow-blue-100 flex flex-col items-center justify-center min-w-[100px]">
                            <div className="text-[10px] text-white/80 font-black uppercase tracking-[0.1em] mb-0.5">입금 건수</div>
                            <div className="text-xl font-black text-white">
                              {filteredDeposits.length}<span className="text-xs font-normal ml-1 text-white/80">건</span>
                            </div>
                          </div>

                          {/* 합계 금액 */}
                          <div className="bg-primary-600 px-5 py-2 rounded-xl shadow-lg shadow-primary-100 flex flex-col items-center justify-center min-w-[160px]">
                            <div className="text-[10px] text-white/80 font-black uppercase tracking-[0.1em] mb-0.5">총 입금 합계</div>
                            <div className="text-xl font-black text-white">
                              {formatCurrency(totalDepositAmount)}<span className="text-sm font-normal ml-1">원</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-surface-200 min-h-[500px] bg-white overflow-hidden shadow-lg">
                      <Table className="table-fixed" maxHeight="max-h-[calc(100vh-420px)]">
                        <TableHeader>
                          <TableRow className="bg-surface-50">
                            <TableHead className="!font-bold py-4 !text-slate-900 !text-sm !text-left !pl-2.5 w-[120px]">지정지청</TableHead>
                            <TableHead className="!font-bold py-4 !text-slate-900 border-l border-surface-100 !text-sm w-[250px]">사업장명 / 품명</TableHead>
                            <TableHead className="!font-bold py-4 !text-slate-900 border-l border-surface-100 !text-sm !text-left !pl-4 w-[120px]">대표자</TableHead>
                            <TableHead className="!font-bold py-4 !text-slate-900 border-l border-surface-100 !text-sm w-[120px]">매출 구분</TableHead>
                            <TableHead className="!text-left !pl-4 !font-bold py-4 !text-slate-900 border-l border-surface-100 !text-sm w-[120px]">입금일</TableHead>
                            <TableHead className="!text-right !font-bold py-4 !text-slate-900 border-l border-surface-100 !px-8 !text-sm w-[150px]">입금액</TableHead>
                            <TableHead className="!font-bold py-4 !text-slate-900 border-l border-surface-100 !text-sm w-[200px]">비고</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredDeposits.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center text-text-400 py-32 text-lg italic">
                                조건에 맞는 입금 내역이 없습니다.
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredDeposits.map((item) => (
                              <TableRow
                                key={item.id}
                                className="group hover:bg-blue-50/40 transition-colors border-b last:border-0 h-14 cursor-default relative"
                              >
                                <TableCell className="!text-slate-800 !font-medium !text-left !pl-2.5 relative !py-3">
                                  {/* 표준 블루 인디케이터 바 - 텍스트와 찰떡같이 밀착 */}
                                  <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                  {item.designatedOffice || "-"}
                                </TableCell>
                                <TableCell className="!font-bold !text-slate-900 !text-base truncate max-w-[230px] !py-3" title={item.name}>{item.name}</TableCell>
                                <TableCell className="!text-slate-700 !font-medium !text-left !pl-4 !py-3">{item.representative || "-"}</TableCell>
                                <TableCell>
                                  <span className={`px-3 py-1 rounded-lg text-xs font-black
                                    ${item.category.includes("사업장") ? "bg-blue-100 text-blue-700" :
                                      item.category.includes("국고") ? "bg-emerald-100 text-emerald-700" :
                                        "bg-amber-100 text-amber-700"}`}>
                                    {item.category}
                                  </span>
                                </TableCell>
                                <TableCell className="!text-left !pl-4 !font-semibold !text-slate-600 !py-3">{formatDateYYYYMMDD(item.date)}</TableCell>
                                <TableCell className="text-right font-black text-primary-700 px-8 text-lg">
                                  {formatCurrency(item.amount)}
                                </TableCell>
                                <TableCell className="text-text-900 font-medium truncate max-w-[250px]" title={item.notes}>{item.notes}</TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                );
              })(),
            },
          ]}
        />
      </Card >

      {/* 기타 매출 등록/수정 모달 */}
      < Modal
        isOpen={isOtherModalOpen}
        onClose={() => {
          setIsOtherModalOpen(false);
          setSelectedOther(null);
          setOtherFormData({});
        }}
        title={selectedOther ? "기타 매출 수정" : "기타 매출 등록"}
      >
        <div className="space-y-4">
          {/* 1. 매출년도, 매출주기 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                매출년도
              </label>
              <Select
                value={otherFormData.revenue_year?.toString() || ""}
                onChange={(e) =>
                  setOtherFormData({
                    ...otherFormData,
                    revenue_year: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextInput = document.getElementById("item-name-input");
                    nextInput?.focus();
                  }
                }}
                options={[{ value: "", label: "선택" }, ...yearOptions]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                매출주기
              </label>
              <Select
                value={otherFormData.revenue_period || ""}
                onChange={(e) =>
                  setOtherFormData({ ...otherFormData, revenue_period: e.target.value })
                }
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextInput = document.getElementById("item-name-input");
                    nextInput?.focus();
                  }
                }}
                options={[{ value: "", label: "선택" }, ...periodOptions.filter((opt) => opt.value !== "")]}
              />
            </div>
          </div>

          {/* 2. 품명 */}
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">
              품명 <span className="text-error-500">*</span>
            </label>
            <Input
              id="item-name-input"
              value={otherFormData.item_name || ""}
              onChange={(e) =>
                setOtherFormData({ ...otherFormData, item_name: e.target.value })
              }
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = document.getElementById("supply-amount-input");
                  nextInput?.focus();
                }
              }}
              required
            />
          </div>

          {/* 3. 공급가액, 부가세, 합계금액(합계는 공급가액+부가세 자동집계) */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                공급가액
              </label>
              <Input
                id="supply-amount-input"
                type="text"
                value={formatNumberInput(otherFormData.supply_amount)}
                onChange={(e) => {
                  const supply = parseNumberInput(e.target.value);
                  const vat = otherFormData.vat_amount || 0;
                  setOtherFormData({
                    ...otherFormData,
                    supply_amount: supply,
                    total_amount: supply !== null ? supply + vat : 0,
                  });
                }}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextInput = document.getElementById("vat-amount-input");
                    nextInput?.focus();
                  }
                }}
                className="text-right"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                부가세
              </label>
              <Input
                id="vat-amount-input"
                type="text"
                value={formatNumberInput(otherFormData.vat_amount)}
                onChange={(e) => {
                  const vat = parseNumberInput(e.target.value);
                  const supply = otherFormData.supply_amount || 0;
                  setOtherFormData({
                    ...otherFormData,
                    vat_amount: vat,
                    total_amount: vat !== null ? supply + vat : 0,
                  });
                }}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextInput = document.getElementById("invoice-date-input");
                    nextInput?.focus();
                  }
                }}
                className="text-right"
                placeholder="0"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                합계금액 <span className="text-error-500">*</span>
              </label>
              <Input
                type="text"
                value={formatNumberInput(otherFormData.total_amount)}
                readOnly
                className="bg-surface-50 text-right"
                required
              />
            </div>
          </div>

          {/* 4. 계산서 발행일 */}
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">
              계산서 발행일
            </label>
            <Input
              id="invoice-date-input"
              type="date"
              value={normalizeDateForInput(otherFormData.invoice_date)}
              onChange={(e) =>
                setOtherFormData({ ...otherFormData, invoice_date: e.target.value })
              }
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextInput = document.getElementById("deposit-date-input");
                  nextInput?.focus();
                }
              }}
            />
          </div>

          {/* 6. 입금일, 입금액 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                입금일
              </label>
              <Input
                id="deposit-date-input"
                type="date"
                value={normalizeDateForInput(otherFormData.deposit_date)}
                onChange={(e) =>
                  setOtherFormData({ ...otherFormData, deposit_date: e.target.value })
                }
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextInput = document.getElementById("deposit-amount-input");
                    nextInput?.focus();
                  }
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                입금액
              </label>
              <Input
                id="deposit-amount-input"
                type="text"
                value={formatNumberInput(otherFormData.deposit_amount)}
                onChange={(e) => {
                  const value = parseNumberInput(e.target.value);
                  setOtherFormData({ ...otherFormData, deposit_amount: value });
                }}
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const nextInput = document.getElementById("notes-input");
                    nextInput?.focus();
                  }
                }}
                className="text-right"
                placeholder="0"
              />
            </div>
          </div>

          {/* 7. 비고 */}
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">비고</label>
            <Input
              id="notes-input"
              value={otherFormData.notes || ""}
              onChange={(e) =>
                setOtherFormData({ ...otherFormData, notes: e.target.value })
              }
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleOtherSave();
                }
              }}
            />
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="secondary"
              onClick={() => {
                setIsOtherModalOpen(false);
                setSelectedOther(null);
                setOtherFormData({});
              }}
            >
              취소
            </Button>
            <Button variant="primary" onClick={handleOtherSave} disabled={saving} className="min-w-[80px]">
              {saving ? <LoadingSpinner size="sm" /> : "저장"}
            </Button>
          </div>
        </div>
      </Modal >

      {/* 측정일지 수정 모달 */}
      {
        selectedJournalEntry && (
          <Modal
            isOpen={isJournalModalOpen}
            onClose={() => {
              setIsJournalModalOpen(false);
              setSelectedJournalEntry(null);
            }}
            title="매출관리 수정"
            size="3xl"
            headerActions={
              <div className="flex gap-2">
                <Button
                  type="submit"
                  form="journal-edit-form"
                  disabled={isJournalFormSubmitting}
                  className="min-w-[80px]"
                >
                  {isJournalFormSubmitting ? <LoadingSpinner size="sm" /> : "수정"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsJournalModalOpen(false);
                    setSelectedJournalEntry(null);
                  }}
                  disabled={isJournalFormSubmitting}
                >
                  취소
                </Button>
              </div>
            }
          >
            <JournalEditForm
              entry={selectedJournalEntry}
              mode="sales"
              onClose={() => {
                setIsJournalModalOpen(false);
                setSelectedJournalEntry(null);
              }}
              setIsSubmitting={setIsJournalFormSubmitting}
              onSuccess={async (savedJournalId) => {
                setIsJournalModalOpen(false);
                setSelectedJournalEntry(null);
                // 데이터 다시 불러오기
                await loadSalesData();
              }}
            />
          </Modal>
        )
      }

      {/* Excel 업로드 모달 */}
      <Modal
        isOpen={isUploadModalOpen}
        onClose={handleUploadModalClose}
        title="기타매출 Excel 업로드"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-700 mb-2">
              Excel 파일 선택
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="block w-full text-sm text-text-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
              disabled={uploadLoading}
            />
            {uploadFile && (
              <p className="mt-2 text-sm text-text-600">선택된 파일: {uploadFile.name}</p>
            )}
          </div>

          {uploadError && (
            <Alert variant="error">{uploadError}</Alert>
          )}

          {uploadResult && (
            <Alert variant={uploadResult.success ? "success" : "warning"}>
              <div className="space-y-2">
                <p className="font-semibold">{uploadResult.message}</p>
                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      오류 상세 ({uploadResult.errorCount}건)
                    </summary>
                    <ul className="mt-2 ml-4 list-disc space-y-1 text-sm max-h-60 overflow-y-auto">
                      {uploadResult.errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              variant={uploadResult && !uploadLoading ? "primary" : "secondary"}
              onClick={handleUploadModalClose}
            >
              닫기
            </Button>
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={!uploadFile || uploadLoading || !!(uploadResult && !uploadLoading)}
            >
              {uploadLoading ? "업로드 중..." : "업로드"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 측정비 입금액 상세 모달 */}
      <Modal
        isOpen={isMeasurementDepositDetailModalOpen}
        onClose={() => setIsMeasurementDepositDetailModalOpen(false)}
        title="입금액 상세"
        size="lg"
      >
        {measurementDepositDetailItem && (
          <div className="space-y-4">
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">사업장명</label>
                  <p className="text-base font-semibold">{measurementDepositDetailItem.business_name}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">측정년도</label>
                  <p className="text-base">{measurementDepositDetailItem.measurement_year}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">측정주기</label>
                  <p className="text-base">{measurementDepositDetailItem.measurement_period}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">입금액 합계</label>
                  <p className="text-base font-semibold text-primary-600">
                    {formatCurrency(measurementDepositDetailItem.deposit_total || 0)}원
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-3">측정비(사업장)</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">입금일자</label>
                  <p className="text-base">
                    {measurementDepositDetailItem.deposit_date_business
                      ? formatDateYYYYMMDD(measurementDepositDetailItem.deposit_date_business)
                      : "-"}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">입금액</label>
                  <p className="text-base font-semibold">
                    {formatCurrency(measurementDepositDetailItem.deposit_amount_business || 0)}원
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-3">측정비(국고)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-gray-700">입금일자</label>
                  <p className="text-base">
                    {measurementDepositDetailItem.deposit_date_national
                      ? formatDateYYYYMMDD(measurementDepositDetailItem.deposit_date_national)
                      : "-"}
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-gray-700">입금액</label>
                  <p className="text-base font-semibold">
                    {formatCurrency(measurementDepositDetailItem.deposit_amount_national || 0)}원
                  </p>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <Button onClick={() => setIsMeasurementDepositDetailModalOpen(false)}>
                닫기
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* 측정비 일괄 업로드 모달 (부분 업데이트) */}
      <Modal
        isOpen={isMeasurementUploadModalOpen}
        onClose={handleMeasurementUploadModalClose}
        title="측정비 일괄 업로드 (부분 업데이트)"
        size="lg"
        resizable={true}
      >
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-800 mb-4">
            <h4 className="font-bold mb-2">📌 업로드 안내</h4>
            <ul className="list-disc ml-4 space-y-1">
              <li><strong>식별자(필수):</strong> 코드, 측정년도, 측정주기가 반드시 일치해야 업데이트됩니다.</li>
              <li><strong>부분 업데이트:</strong> 엑셀 파일에 값이 <strong>입력된 셀만 업데이트</strong>되며, 비어있는 셀은 기존 값을 유지합니다.</li>
              <li><strong>업데이트 가능 항목:</strong> 측정비(사업장/국고), 입금일/입금액(사업장/국고), 전자계산서 발행일, 계산서 이메일 등</li>
            </ul>
          </div>

          <div className="flex justify-end mb-4">
            <Button
              variant="secondary"
              className="text-sm py-1 px-3"
              onClick={handleDownloadTemplate}
            >
              📥 양식 다운로드
            </Button>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-text-700">Excel 파일 선택</label>
            <Input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleMeasurementUploadFileChange}
              className="block w-full text-sm text-text-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 cursor-pointer"
              disabled={measurementUploadLoading}
            />
            {measurementUploadFile && (
              <p className="mt-2 text-sm text-text-600">선택된 파일: {measurementUploadFile.name}</p>
            )}
          </div>

          {measurementUploadError && (
            <Alert variant="error">{measurementUploadError}</Alert>
          )}

          {measurementUploadResult && (
            <Alert variant={measurementUploadResult.success ? "success" : "warning"}>
              <div className="space-y-2">
                <p className="font-semibold">{measurementUploadResult.message}</p>
                {measurementUploadResult.details && measurementUploadResult.details.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-sm font-medium">
                      상세 결과 ({measurementUploadResult.failCount}건 오류)
                    </summary>
                    <ul className="mt-2 ml-4 list-disc space-y-1 text-sm max-h-60 overflow-y-auto">
                      {measurementUploadResult.details.map((msg, index) => (
                        <li key={index}>{msg}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </Alert>
          )}

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              variant="secondary"
              onClick={handleMeasurementUploadModalClose}
            >
              닫기
            </Button>
            <Button
              variant="primary"
              onClick={handleMeasurementUpload}
              disabled={!measurementUploadFile || measurementUploadLoading}
            >
              {measurementUploadLoading ? "업로드 중..." : "업로드"}
            </Button>
          </div>
        </div>
      </Modal>
      </div>
    </div>
  );
};
