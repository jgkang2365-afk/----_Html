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
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";
import { Checkbox } from "@/components/ui/Checkbox";
import { formatDateYYYYMMDD } from "@/lib/utils/date-utils";
import { normalizeDateForInput } from "@/lib/utils/date-normalize";
import { DESIGNATED_OFFICE_OPTIONS, DESIGNATED_OFFICES_FOR_SALES } from "@/lib/constants/designated-offices";
import { JournalEditForm } from "./JournalEditForm";

import * as XLSX from "xlsx";

interface MeasurementRevenue {
  id: number;
  code: string;
  measurement_year: number;
  measurement_period: string;
  business_name: string;
  designated_office: string;
  measurement_fee_total: number | null;
  measurement_fee_business: number | null;
  measurement_fee_national: number | null;
  deposit_total: number | null;
  deposit_date_business: string | null;
  deposit_amount_business: number | null;
  deposit_date_national: string | null;
  deposit_amount_national: number | null;
  invoice_email: string | null;
  electronic_invoice_date: string | null;
  representative_name: string | null;
}

interface OtherRevenue {
  id: number;
  item_name: string;
  invoice_date: string | null;
  supply_amount: number | null;
  vat_amount: number | null;
  total_amount: number;
  deposit_date: string | null;
  deposit_amount: number | null;
  notes: string | null;
  designated_office: string | null;
  revenue_year: number | null;
  revenue_period: string | null;
}

interface OfficeSummary {
  measurementRevenue: number;
  measurementVat: number;
  measurementTotal: number;
  measurementDeposit: number;
  measurementUnpaid: number;
  otherRevenue: number;
  otherVat: number;
  otherTotal: number;
  otherDeposit: number;
  otherUnpaid: number;
  totalRevenue: number;
  totalVat: number;
  totalAmount: number;
  totalDeposit: number;
  totalUnpaid: number;
}

interface YearlySummary {
  firstHalf: OfficeSummary;
  secondHalf: OfficeSummary;
  total: OfficeSummary;
}

export const SalesManagement: React.FC = () => {
  // 서울 시간대(Asia/Seoul) 기준으로 현재 년도 가져오기
  const getCurrentYear = () => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    return seoulTime.getFullYear();
  };
  const getCurrentYearString = () => getCurrentYear().toString();

  // 주기가 선택된 주기와 일치하는지 확인하는 헬퍼 함수
  const isMatchSelection = (itemPeriod: string | null, selectedPeriod: string) => {
    if (!selectedPeriod) return true;
    if (!itemPeriod) return false;
    if (selectedPeriod === "상반기") {
      return itemPeriod === "상반기" || itemPeriod === "상반기(수시)" || itemPeriod === "수시(상)";
    }
    if (selectedPeriod === "하반기") {
      return itemPeriod === "하반기" || itemPeriod === "하반기(수시)" || itemPeriod === "수시(하)";
    }
    return false;
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [measurementRevenue, setMeasurementRevenue] = useState<MeasurementRevenue[]>([]);
  const [otherRevenue, setOtherRevenue] = useState<OtherRevenue[]>([]);
  const [summary, setSummary] = useState<{
    byOffice: Record<string, OfficeSummary>;
    byYear: Record<number, YearlySummary>;
  } | null>(null);



  // 년도별 집계 년도 선택 상태 (기본값: 현재 년도)
  const [yearlySummaryYear, setYearlySummaryYear] = useState<string>(getCurrentYearString());
  const [yearlySummaryPeriod, setYearlySummaryPeriod] = useState<string>("");

  // 미수금 집계 년도 선택 상태
  const [unpaidSummaryYear, setUnpaidSummaryYear] = useState<string>(getCurrentYearString());
  const [unpaidSummaryPeriod, setUnpaidSummaryPeriod] = useState<string>("");

  // 매출 집계 년도 선택 상태
  const [salesSummaryYear, setSalesSummaryYear] = useState<string>(getCurrentYearString());

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
    year: getCurrentYearString(), // 매출년도
    period: "", // 측정주기
    designatedOffice: "", // 지정한계_관할지청
    hasDepositDate: "", // 입금일 여부: "yes" | "no" | ""
  });
  const [unpaidSort, setUnpaidSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "unpaid", direction: "desc" });

  // 기타 매출 필터 및 정렬 상태
  const [otherFilters, setOtherFilters] = useState({
    itemName: "", // 품명
    year: getCurrentYearString(), // 매출년도
    period: "", // 매출주기
    hasInvoiceDate: "", // 계산서 발행일 여부: "yes" | "no" | ""
    hasDepositDate: "", // 입금일 여부: "yes" | "no" | ""
    notes: "", // 비고
  });
  const [otherSort, setOtherSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "total_amount", direction: "desc" });

  // 측정비 필터 및 정렬 상태
  const [measurementFilters, setMeasurementFilters] = useState({
    businessName: "", // 사업장명
    representativeName: "", // 대표자명
    year: getCurrentYearString(), // 측정년도
    period: "", // 측정주기
    designatedOffice: "", // 지정한계_관할지청
    hasInvoiceDate: "", // 계산서 발행일 여부: "yes" | "no" | ""
  });
  const [measurementSort, setMeasurementSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "measurement_fee_total", direction: "desc" });

  // 디바운싱된 필터 상태 추가
  const [debouncedUnpaidFilters, setDebouncedUnpaidFilters] = useState(unpaidFilters);
  const [debouncedOtherFilters, setDebouncedOtherFilters] = useState(otherFilters);
  const [debouncedMeasurementFilters, setDebouncedMeasurementFilters] = useState(measurementFilters);

  // 기간별 입금 현황 필터 상태
  const [depositStartDate, setDepositStartDate] = useState<string>(() => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const oneMonthAgo = new Date(seoulTime);
    oneMonthAgo.setMonth(seoulTime.getMonth() - 1);
    return oneMonthAgo.toISOString().split('T')[0];
  });
  const [depositEndDate, setDepositEndDate] = useState<string>(() => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    return seoulTime.toISOString().split('T')[0];
  });
  const [depositOffice, setDepositOffice] = useState("");
  const [depositYear, setDepositYear] = useState("");
  const [depositPeriod, setDepositPeriod] = useState("");
  const [depositCategory, setDepositCategory] = useState("");
  const [depositBusinessName, setDepositBusinessName] = useState("");
  const [debouncedDepositBusinessName, setDebouncedDepositBusinessName] = useState("");
  const [activeQuickDate, setActiveQuickDate] = useState<string | null>("month");

  // 입금 현황 디바운싱 효과
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDepositBusinessName(depositBusinessName);
    }, 400);
    return () => clearTimeout(timer);
  }, [depositBusinessName]);

  // 필터 업데이트 감지 여부 (로딩 표시용)
  const [isMeasurementFiltering, setIsMeasurementFiltering] = useState(false);
  const [isOtherFiltering, setIsOtherFiltering] = useState(false);
  const [isUnpaidFiltering, setIsUnpaidFiltering] = useState(false);

  // 미수관리 디바운싱 효과
  useEffect(() => {
    setIsUnpaidFiltering(true);
    const timer = setTimeout(() => {
      setDebouncedUnpaidFilters(unpaidFilters);
      setIsUnpaidFiltering(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [unpaidFilters]);

  // 기타 매출 디바운싱 효과
  useEffect(() => {
    setIsOtherFiltering(true);
    const timer = setTimeout(() => {
      setDebouncedOtherFilters(otherFilters);
      setIsOtherFiltering(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [otherFilters]);

  // 측정비 디바운싱 효과
  useEffect(() => {
    setIsMeasurementFiltering(true);
    const timer = setTimeout(() => {
      setDebouncedMeasurementFilters(measurementFilters);
      setIsMeasurementFiltering(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [measurementFilters]);

  // 기간별 입금 현황 날짜 선택 헬퍼
  const handleQuickDateSelect = (type: "today" | "week" | "month") => {
    const seoulTime = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const end = seoulTime.toISOString().split('T')[0];
    let start = "";

    const startDate = new Date(seoulTime);
    if (type === "today") {
      start = end;
    } else if (type === "week") {
      startDate.setDate(seoulTime.getDate() - 7);
      start = startDate.toISOString().split('T')[0];
    } else if (type === "month") {
      startDate.setMonth(seoulTime.getMonth() - 1);
      start = startDate.toISOString().split('T')[0];
    }

    setDepositStartDate(start);
    setDepositEndDate(end);
    setActiveQuickDate(type);
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

  useEffect(() => {
    loadSalesData();
  }, []);

  const loadSalesData = async () => {
    try {
      setLoading(true);
      setError(null);

      // const params = new URLSearchParams();
      // if (filters.year) params.append("year", filters.year);
      // if (filters.businessName) params.append("businessName", filters.businessName);
      // if (filters.measurementPeriod) params.append("measurementPeriod", filters.measurementPeriod);
      // if (filters.designatedOffice) params.append("designatedOffice", filters.designatedOffice);

      const response = await fetch(`/api/sales`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("API 응답 오류:", response.status, errorText);
        throw new Error(`서버 오류: ${response.status}`);
      }

      const result = await response.json();
      console.log("매출 데이터 로드 성공:", result);

      if (result.success !== false) {
        setMeasurementRevenue(result.measurementRevenue || []);
        // 삭제된 항목 제외
        const filteredOtherRevenue = (result.otherRevenue || []).filter(
          (item: OtherRevenue) => !deletedOtherIds.has(item.id)
        );
        setOtherRevenue(filteredOtherRevenue);
        setSummary(result.summary || null);
        // 데이터 로드 시 선택 초기화
        setSelectedOtherIds([]);
      } else {
        setError(result.error || "매출 데이터를 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("매출 데이터 로드 오류:", err);
      setError(err.message || "매출 데이터를 불러오는 중 오류가 발생했습니다.");
      // 에러가 발생해도 기본값 설정
      setMeasurementRevenue([]);
      setOtherRevenue([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

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
        "계산서 이메일": "tax@example.com"
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
        "계산서 이메일": ""
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
    ];
    ws["!cols"] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "입금정보일괄업로드양식");
    XLSX.writeFile(wb, "측정비_입금정보_업로드_양식.xlsx");
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error && !summary) {
    return <Alert variant="error">{error}</Alert>;
  }

  const offices = [...DESIGNATED_OFFICES_FOR_SALES];

  return (
    <div className="space-y-4">
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

      {/* 매출 집계 */}
      {summary && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-text-900">매출 집계</h2>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-text-700 whitespace-nowrap">년도 선택:</label>
              <Select
                value={salesSummaryYear}
                onChange={(e) => setSalesSummaryYear(e.target.value)}
                options={[{ value: "", label: "전체" }, ...yearOptions]}
                className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>구분</TableHead>
                  <TableHead className="text-right">공급가액</TableHead>
                  <TableHead className="text-right">부가세</TableHead>
                  <TableHead className="text-right">합계</TableHead>
                  <TableHead className="text-right">입금액</TableHead>
                  <TableHead className="text-right">미수금(부가세 포함)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  // 선택된 년도에 따라 데이터 필터링
                  const filteredMeasurementRevenue = salesSummaryYear && salesSummaryYear !== ""
                    ? measurementRevenue.filter((item) => item.measurement_year === parseInt(salesSummaryYear))
                    : measurementRevenue;

                  const filteredOtherRevenue = salesSummaryYear && salesSummaryYear !== ""
                    ? otherRevenue.filter((item) => item.revenue_year === parseInt(salesSummaryYear))
                    : otherRevenue;

                  // 측정비 집계 계산
                  let measurementRevenueSum = 0;
                  let measurementTotalSum = 0;
                  let measurementDepositSum = 0;
                  let measurementUnpaidSum = 0;

                  filteredMeasurementRevenue.forEach((item) => {
                    const revenue = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
                    const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
                    const unpaid = revenue - deposit;

                    measurementRevenueSum += revenue;
                    measurementTotalSum += revenue;
                    measurementDepositSum += deposit;
                    measurementUnpaidSum += unpaid;
                  });

                  // 기타 매출 집계 계산
                  let otherRevenueSum = 0;
                  let otherVatSum = 0;
                  let otherTotalSum = 0;
                  let otherDepositSum = 0;
                  let otherUnpaidSum = 0;

                  filteredOtherRevenue.forEach((item) => {
                    const supply = parseFloat(item.supply_amount?.toString() || "0") || 0;
                    const vat = parseFloat(item.vat_amount?.toString() || "0") || 0;
                    const total = parseFloat(item.total_amount?.toString() || "0") || 0;
                    const deposit = parseFloat(item.deposit_amount?.toString() || "0") || 0;
                    const unpaid = total - deposit;

                    otherRevenueSum += supply;
                    otherVatSum += vat;
                    otherTotalSum += total;
                    otherDepositSum += deposit;
                    otherUnpaidSum += unpaid;
                  });

                  // 측정비 합계 클릭 핸들러
                  const handleMeasurementTotalClick = () => {
                    setSalesDetailType("measurementTotal");
                    setSalesDetailList(filteredMeasurementRevenue);
                    setSalesDetailTitle(`측정비 합계 내역${salesSummaryYear ? ` (${salesSummaryYear}년)` : ""}`);
                    setIsSalesDetailModalOpen(true);
                  };

                  // 측정비 입금액 클릭 핸들러
                  const handleMeasurementDepositClick = () => {
                    setSalesDetailType("measurementDeposit");
                    // 입금액이 있는 항목만 필터링
                    const itemsWithDeposit = filteredMeasurementRevenue.filter(
                      (item) => (item.deposit_total || 0) > 0
                    );
                    setSalesDetailList(itemsWithDeposit);
                    setSalesDetailTitle(`측정비 입금액 내역${salesSummaryYear ? ` (${salesSummaryYear}년)` : ""}`);
                    setIsSalesDetailModalOpen(true);
                  };

                  return (
                    <>
                      {/* 측정비 집계 */}
                      <TableRow>
                        <TableCell className="font-medium">측정비</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(measurementRevenueSum)}원
                        </TableCell>
                        <TableCell className="text-right">0원</TableCell>
                        <TableCell
                          className="text-right font-semibold cursor-pointer hover:bg-gray-100 hover:text-primary-600 transition-colors"
                          onClick={handleMeasurementTotalClick}
                          title="클릭하여 상세 내역 보기"
                        >
                          {formatCurrency(measurementTotalSum)}원
                        </TableCell>
                        <TableCell
                          className="text-right cursor-pointer hover:bg-gray-100 hover:text-primary-600 transition-colors"
                          onClick={handleMeasurementDepositClick}
                          title="클릭하여 상세 내역 보기"
                        >
                          {formatCurrency(measurementDepositSum)}원
                        </TableCell>
                        <TableCell className="text-right text-warning-600 font-semibold">
                          {formatCurrency(measurementUnpaidSum)}원
                        </TableCell>
                      </TableRow>
                      {/* 기타 집계 */}
                      <TableRow>
                        <TableCell className="font-medium">기타</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(otherRevenueSum)}원
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(otherVatSum)}원
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(otherTotalSum)}원
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(otherDepositSum)}원
                        </TableCell>
                        <TableCell className="text-right text-warning-600 font-semibold">
                          {formatCurrency(otherUnpaidSum)}원
                        </TableCell>
                      </TableRow>
                    </>
                  );
                })()}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* 매출 집계 상세 내역 모달 */}
      <Modal
        isOpen={isSalesDetailModalOpen}
        onClose={() => setIsSalesDetailModalOpen(false)}
        title={salesDetailTitle}
        size="2xl"
      >
        <div>
          {salesDetailList.length === 0 ? (
            <div className="py-8 text-center text-text-600 text-sm">
              내역이 없습니다.
            </div>
          ) : (
            <Table maxHeight="max-h-[60vh]">
              <TableHeader>
                <TableRow className="bg-sky-100">
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">연번</TableHead>
                  <TableHead className="font-semibold py-1 px-2 text-black text-sm">사업장명</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정년도</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정주기</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">관할지청</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">측정비(합계)</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">입금액</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">미수금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesDetailList.map((item, index) => {
                  const total = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
                  const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
                  const unpaid = total - deposit;

                  return (
                    <TableRow key={item.id || index} className="border-b border-gray-200">
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{index + 1}</TableCell>
                      <TableCell className="text-black py-1 px-2 text-sm">{item.business_name}</TableCell>
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{item.measurement_year}</TableCell>
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{item.measurement_period}</TableCell>
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{item.designated_office || "-"}</TableCell>
                      <TableCell className="text-right text-black py-1 px-2 text-sm">
                        {formatCurrency(total)}원
                      </TableCell>
                      <TableCell className="text-right text-black py-1 px-2 text-sm">
                        {formatCurrency(deposit)}원
                      </TableCell>
                      <TableCell className={`text-right py-1 px-2 text-sm font-semibold ${unpaid > 0 ? 'text-warning-600' : 'text-black'}`}>
                        {formatCurrency(unpaid)}원
                      </TableCell>
                    </TableRow>
                  );
                })}
                {/* 합계 행 */}
                <TableRow className="border-t-2 border-gray-300 bg-gray-50">
                  <TableCell colSpan={5} className="text-center font-bold text-black py-2 px-2">합계</TableCell>
                  <TableCell className="text-right font-bold text-black py-2 px-2">
                    {formatCurrency(
                      salesDetailList.reduce((sum, item) => sum + (parseFloat(item.measurement_fee_total?.toString() || "0") || 0), 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right font-bold text-black py-2 px-2">
                    {formatCurrency(
                      salesDetailList.reduce((sum, item) => sum + (parseFloat(item.deposit_total?.toString() || "0") || 0), 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right font-bold text-black py-2 px-2">
                    {formatCurrency(
                      salesDetailList.reduce((sum, item) => {
                        const total = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
                        const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
                        return sum + (total - deposit);
                      }, 0)
                    )}원
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </Modal>

      {/* 년도별 집계 */}
      {summary && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-text-900">년도별 집계 현황</h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-text-700 whitespace-nowrap">년도 선택:</label>
                <Select
                  value={yearlySummaryYear}
                  onChange={(e) => setYearlySummaryYear(e.target.value)}
                  options={[{ value: "", label: "전체" }, ...yearOptions]}
                  className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-text-700 whitespace-nowrap">주기 선택:</label>
                <Select
                  value={yearlySummaryPeriod}
                  onChange={(e) => setYearlySummaryPeriod(e.target.value)}
                  options={periodOptions}
                  className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-sky-100">
                  <TableHead className="text-center font-semibold py-3 px-3 text-black">연번</TableHead>
                  <TableHead className="font-semibold py-3 px-4 text-black">매출 구분</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 text-black">측정비</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 text-black">부가세</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 text-black">측정비(총액)</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 text-black">입금액</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 text-black">미수금(부가세포함)</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 whitespace-nowrap text-black">{yearlySummaryYear || "전체"}년 상반기</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 whitespace-nowrap text-black">{yearlySummaryYear || "전체"}년 하반기</TableHead>
                  <TableHead className="text-right font-semibold py-3 px-4 whitespace-nowrap text-black">{yearlySummaryYear || "전체"}년도 측정비</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  // 선택된 년도 데이터 가져오기
                  const selectedYearData = yearlySummaryYear && yearlySummaryYear !== ""
                    ? (summary.byYear[parseInt(yearlySummaryYear)] || null)
                    : null;

                  // 관할지역 목록
                  const offices = [...DESIGNATED_OFFICES_FOR_SALES];
                  const officeLabels: Record<string, string> = {
                    천안: "천안",
                    대전: "대전",
                    평택: "평택",
                    경기: "경기",
                    기타: "기타",
                  };

                  // 전체 합계 행
                  let totalRow = {
                    measurementFee: 0,
                    vat: 0,
                    total: 0,
                    deposit: 0,
                    unpaid: 0,
                    firstHalf: 0,
                    secondHalf: 0,
                    yearlyTotal: 0,
                  };

                  // 각 관할지역별 데이터 계산
                  const officeData = offices.map((office, index) => {
                    // 필터링된 데이터 계산
                    let measurementFee = 0;
                    let vat = 0;
                    let total = 0;
                    let deposit = 0;
                    let unpaid = 0;

                    const targetYear = yearlySummaryYear ? parseInt(yearlySummaryYear) : null;
                    const targetPeriod = yearlySummaryPeriod;

                    if (office === "기타") {
                      // 기타 매출 필터링 및 집계
                      const filteredItems = otherRevenue.filter(item => {
                        const yearMatch = !targetYear || item.revenue_year === targetYear;
                        const periodMatch = isMatchSelection(item.revenue_period, targetPeriod);
                        return yearMatch && periodMatch;
                      });

                      filteredItems.forEach(item => {
                        measurementFee += item.supply_amount || 0;
                        vat += item.vat_amount || 0;
                        total += item.total_amount || 0;
                        deposit += item.deposit_amount || 0;
                        unpaid += (item.total_amount || 0) - (item.deposit_amount || 0);
                      });
                    } else {
                      // 측정비 필터링 및 집계
                      const filteredItems = measurementRevenue.filter(item => {
                        const officeMatch = item.designated_office === office;
                        const yearMatch = !targetYear || item.measurement_year === targetYear;
                        const periodMatch = isMatchSelection(item.measurement_period, targetPeriod);
                        return officeMatch && yearMatch && periodMatch;
                      });

                      filteredItems.forEach(item => {
                        const fee = item.measurement_fee_total || 0;
                        const dep = item.deposit_total || 0;
                        measurementFee += fee;
                        total += fee;
                        deposit += dep;
                        unpaid += fee - dep;
                      });
                    }

                    // 선택된 년도의 상/하반기 데이터 (이 컬럼들은 년도가 선택된 경우에만 의미가 있음)
                    let yearData = null;
                    if (targetYear) {
                      let firstHalfTotal = 0;
                      let secondHalfTotal = 0;

                      if (office === "기타") {
                        otherRevenue.filter(item => item.revenue_year === targetYear).forEach(item => {
                          const amount = item.total_amount || 0;
                          if (isMatchSelection(item.revenue_period, "상반기")) firstHalfTotal += amount;
                          if (isMatchSelection(item.revenue_period, "하반기")) secondHalfTotal += amount;
                        });
                      } else {
                        measurementRevenue.filter(item =>
                          item.designated_office === office && item.measurement_year === targetYear
                        ).forEach(item => {
                          const amount = item.measurement_fee_total || 0;
                          if (isMatchSelection(item.measurement_period, "상반기")) firstHalfTotal += amount;
                          if (isMatchSelection(item.measurement_period, "하반기")) secondHalfTotal += amount;
                        });
                      }

                      yearData = {
                        firstHalf: firstHalfTotal,
                        secondHalf: secondHalfTotal,
                        total: firstHalfTotal + secondHalfTotal,
                      };
                    }

                    // 합계 계산
                    totalRow.measurementFee += measurementFee;
                    totalRow.vat += vat;
                    totalRow.total += total;
                    totalRow.deposit += deposit;
                    totalRow.unpaid += unpaid;
                    if (yearData) {
                      totalRow.firstHalf += yearData.firstHalf;
                      totalRow.secondHalf += yearData.secondHalf;
                      totalRow.yearlyTotal += yearData.total;
                    }

                    return {
                      office,
                      label: officeLabels[office] || office,
                      measurementFee,
                      vat,
                      total,
                      deposit,
                      unpaid,
                      yearData,
                    };
                  });

                  return (
                    <>
                      {/* 합계 행 */}
                      <TableRow className="border-t-2 border-b-2 border-gray-300">
                        <TableCell className="text-center font-bold text-black py-3 px-3">합계</TableCell>
                        <TableCell className="font-bold text-black py-3 px-4">합계</TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.measurementFee)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.vat)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.total)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.deposit)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.unpaid)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {selectedYearData ? formatCurrency(totalRow.firstHalf) : formatCurrency(totalRow.total)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {selectedYearData ? formatCurrency(totalRow.secondHalf) : formatCurrency(totalRow.total)}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {selectedYearData ? formatCurrency(totalRow.yearlyTotal) : formatCurrency(totalRow.total)}
                        </TableCell>
                      </TableRow>
                      {/* 각 관할지역 행 */}
                      {officeData.map((data, index) => (
                        <TableRow key={data.office} className="border-b border-gray-200">
                          <TableCell className="text-center text-black py-2 px-3">{index + 1}</TableCell>
                          <TableCell className="font-medium text-black py-2 px-4">{data.label}</TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {formatCurrency(data.measurementFee)}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {data.vat > 0 ? formatCurrency(data.vat) : "-"}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {formatCurrency(data.total)}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {formatCurrency(data.deposit)}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {formatCurrency(data.unpaid)}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {data.yearData
                              ? formatCurrency(data.yearData.firstHalf)
                              : formatCurrency(data.total)}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {data.yearData
                              ? formatCurrency(data.yearData.secondHalf)
                              : formatCurrency(data.total)}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {data.yearData
                              ? formatCurrency(data.yearData.total)
                              : formatCurrency(data.total)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </>
                  );
                })()}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* 년도별 측정비 입금 및 미수금 집계 현황 */}
      {summary && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-text-900">년도별 측정비 입금 및 미수금 집계 현황</h2>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-text-700 whitespace-nowrap">년도 선택 :</label>
                <Select
                  value={unpaidSummaryYear}
                  onChange={(e) => setUnpaidSummaryYear(e.target.value)}
                  options={[{ value: "", label: "전체" }, ...yearOptions]}
                  className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-text-700 whitespace-nowrap">주기 선택 :</label>
                <Select
                  value={unpaidSummaryPeriod}
                  onChange={(e) => setUnpaidSummaryPeriod(e.target.value)}
                  options={periodOptions}
                  className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300"
                />
              </div>
            </div>
          </div>
          <Table maxHeight="max-h-[400px]">
            <TableHeader>
              <TableRow className="bg-sky-100 border-b border-surface-200">
                <TableHead rowSpan={2} className="text-center font-bold py-3 px-3 text-black align-middle border-r border-surface-200">구분</TableHead>
                <TableHead colSpan={4} className="text-center font-black py-3 px-4 text-slate-800 bg-slate-100/80 border-r-2 border-slate-300">합계</TableHead>
                <TableHead colSpan={3} className="text-center font-black py-3 px-4 text-blue-800 bg-blue-50 border-r-2 border-blue-200">측정비(사업장)</TableHead>
                <TableHead colSpan={3} className="text-center font-black py-3 px-4 text-emerald-800 bg-emerald-50">측정비(국고)</TableHead>
              </TableRow>
              <TableRow className="bg-sky-50">
                <TableHead className="text-center font-bold py-2 px-4 text-slate-700 bg-slate-50/50">사업장 수</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-slate-700 bg-slate-50/50">소계(입금+미수)</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-slate-700 bg-slate-50/50">입금액</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-slate-700 bg-slate-50/50 border-r-2 border-slate-300">미수금액</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-blue-700 bg-blue-50/30">사업장 수</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-blue-700 bg-blue-50/30">입금액</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-blue-700 bg-blue-50/30 border-r-2 border-blue-200">미수금액</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-emerald-700 bg-emerald-50/30">사업장 수</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-emerald-700 bg-emerald-50/30">입금액</TableHead>
                <TableHead className="text-center font-bold py-2 px-4 text-emerald-700 bg-emerald-50/30">미수금액</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                // 관할지역 목록
                const offices = [...DESIGNATED_OFFICES_FOR_SALES];
                const officeLabels: Record<string, string> = {
                  천안: "천안",
                  대전: "대전",
                  평택: "평택",
                  경기: "경기",
                  기타: "기타",
                };

                // 미수금 집계 데이터 계산
                const unpaidData = offices.map((office) => {
                  // 년도 및 주기 필터링
                  const filteredData = measurementRevenue.filter((item) => {
                    const officeMatch = office === "기타"
                      ? (!item.designated_office || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(item.designated_office))
                      : item.designated_office === office;
                    const yearMatch = !unpaidSummaryYear || item.measurement_year === parseInt(unpaidSummaryYear);
                    const periodMatch = isMatchSelection(item.measurement_period, unpaidSummaryPeriod);
                    return officeMatch && yearMatch && periodMatch;
                  });

                  // 기타 매출 데이터 필터링
                  const filteredOtherData = office === "기타"
                    ? otherRevenue.filter((item) => {
                      const yearMatch = !unpaidSummaryYear || item.revenue_year === parseInt(unpaidSummaryYear);
                      const periodMatch = isMatchSelection(item.revenue_period, unpaidSummaryPeriod);
                      return yearMatch && periodMatch;
                    })
                    : [];

                  // 합계 계산
                  let totalBusinessCount = 0;
                  let totalDepositAmount = 0;
                  let totalUnpaidAmount = 0;
                  let businessSiteCount = 0;
                  let businessSiteDeposit = 0;
                  let businessSiteUnpaid = 0;
                  let nationalCount = 0;
                  let nationalDeposit = 0;
                  let nationalUnpaid = 0;

                  filteredData.forEach((item) => {
                    const businessFee = item.measurement_fee_business || 0;
                    const businessDeposit = item.deposit_amount_business || 0;
                    const nationalFee = item.measurement_fee_national || 0;
                    const nationalDepositAmount = item.deposit_amount_national || 0;

                    const businessUnpaid = businessFee - businessDeposit;
                    const nationalUnpaidAmount = nationalFee - nationalDepositAmount;
                    const itemTotalUnpaid = businessUnpaid + nationalUnpaidAmount;
                    const itemTotalDeposit = businessDeposit + nationalDepositAmount;

                    // 합계
                    if (itemTotalUnpaid > 0 || itemTotalDeposit > 0) {
                      totalBusinessCount++;
                      totalDepositAmount += itemTotalDeposit;
                      totalUnpaidAmount += itemTotalUnpaid;
                    }

                    // 측정비(사업장)
                    if (businessUnpaid > 0 || businessDeposit > 0) {
                      businessSiteCount++;
                      businessSiteDeposit += businessDeposit;
                      businessSiteUnpaid += businessUnpaid;
                    }

                    // 측정비(국고)
                    if (nationalUnpaidAmount > 0 || nationalDepositAmount > 0) {
                      nationalCount++;
                      nationalDeposit += nationalDepositAmount;
                      nationalUnpaid += nationalUnpaidAmount;
                    }
                  });

                  // 기타 매출 합산
                  if (office === "기타") {
                    filteredOtherData.forEach((item) => {
                      const totalAmount = item.total_amount || 0;
                      const depositAmount = item.deposit_amount || 0;
                      const unpaidAmount = totalAmount - depositAmount;

                      // 합계 (기타 매출은 사업장 수 계산에 포함? 측정비가 아니므로 건수로 취급)
                      // 기타 매출 하나를 사업장 하나로 칠 것인가? -> 예, businessSiteCount 증가
                      if (totalAmount > 0) {
                        totalBusinessCount++;
                        totalDepositAmount += depositAmount;
                        totalUnpaidAmount += unpaidAmount;

                        // 측정비(사업장)에 포함 (국고 없음)
                        businessSiteCount++;
                        businessSiteDeposit += depositAmount;
                        businessSiteUnpaid += unpaidAmount;
                      }
                    });
                  }

                  return {
                    office,
                    label: officeLabels[office as keyof typeof officeLabels] || office,
                    total: {
                      count: totalBusinessCount,
                      deposit: totalDepositAmount,
                      unpaid: totalUnpaidAmount,
                    },
                    business: {
                      count: businessSiteCount,
                      deposit: businessSiteDeposit,
                      unpaid: businessSiteUnpaid,
                    },
                    national: {
                      count: nationalCount,
                      deposit: nationalDeposit,
                      unpaid: nationalUnpaid,
                    },
                  };
                });

                // 전체 합계 계산
                const totalRow = unpaidData.reduce(
                  (acc, data) => ({
                    totalCount: acc.totalCount + data.total.count,
                    totalDeposit: acc.totalDeposit + data.total.deposit,
                    totalUnpaid: acc.totalUnpaid + data.total.unpaid,
                    businessCount: acc.businessCount + data.business.count,
                    businessDeposit: acc.businessDeposit + data.business.deposit,
                    businessUnpaid: acc.businessUnpaid + data.business.unpaid,
                    nationalCount: acc.nationalCount + data.national.count,
                    nationalDeposit: acc.nationalDeposit + data.national.deposit,
                    nationalUnpaid: acc.nationalUnpaid + data.national.unpaid,
                  }),
                  {
                    totalCount: 0,
                    totalDeposit: 0,
                    totalUnpaid: 0,
                    businessCount: 0,
                    businessDeposit: 0,
                    businessUnpaid: 0,
                    nationalCount: 0,
                    nationalDeposit: 0,
                    nationalUnpaid: 0,
                  }
                );

                // 사업장 목록 모달 열기 핸들러
                const handleUnpaidBusinessClick = (
                  office: string | null,
                  category: "total" | "business" | "national"
                ) => {
                  const officeLabel = office ? (officeLabels[office as keyof typeof officeLabels] || office) : "전체";
                  let categoryLabel = "";
                  let businessList: Array<{
                    business_name: string;
                    unpaid_amount: number;
                    measurement_year: number;
                    measurement_period: string;
                    unpaid_count: number;
                    designated_office: string | null;
                    measurement_fee_total: number | null;
                    deposit_amount_business: number | null;
                  }> = [];

                  // 년도 및 주기 필터링
                  const filteredData = measurementRevenue.filter((item) => {
                    const officeMatch = !office
                      ? true
                      : office === "기타"
                        ? (!item.designated_office || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(item.designated_office))
                        : item.designated_office === office;
                    const yearMatch = !unpaidSummaryYear || item.measurement_year === parseInt(unpaidSummaryYear);
                    const periodMatch = isMatchSelection(item.measurement_period, unpaidSummaryPeriod);
                    return officeMatch && yearMatch && periodMatch;
                  });

                  // 측정비(사업장) 기준 미수 횟수 계산을 위한 맵 생성
                  const businessUnpaidCountMap = new Map<string, number>();
                  filteredData.forEach((item) => {
                    const businessFee = item.measurement_fee_business || 0;
                    const businessDeposit = item.deposit_amount_business || 0;
                    const businessUnpaid = businessFee - businessDeposit;

                    if (businessUnpaid > 0) {
                      const count = businessUnpaidCountMap.get(item.business_name) || 0;
                      businessUnpaidCountMap.set(item.business_name, count + 1);
                    }
                  });

                  // 카테고리별 사업장 필터링
                  filteredData.forEach((item) => {
                    const businessFee = item.measurement_fee_business || 0;
                    const businessDeposit = item.deposit_amount_business || 0;
                    const nationalFee = item.measurement_fee_national || 0;
                    const itemNationalDeposit = item.deposit_amount_national || 0;

                    const businessUnpaid = businessFee - businessDeposit;
                    const nationalUnpaidAmount = nationalFee - itemNationalDeposit;
                    const itemTotalUnpaid = businessUnpaid + nationalUnpaidAmount;

                    let unpaidAmount = 0;
                    let shouldInclude = false;

                    if (category === "total" && itemTotalUnpaid > 0) {
                      unpaidAmount = itemTotalUnpaid;
                      shouldInclude = true;
                      categoryLabel = "합계";
                    } else if (category === "business" && businessUnpaid > 0) {
                      unpaidAmount = businessUnpaid;
                      shouldInclude = true;
                      categoryLabel = "측정비(사업장)";
                    } else if (category === "national" && nationalUnpaidAmount > 0) {
                      unpaidAmount = nationalUnpaidAmount;
                      shouldInclude = true;
                      categoryLabel = "측정비(국고)";
                    }

                    if (shouldInclude) {
                      const unpaidCount = businessUnpaidCountMap.get(item.business_name) || 0;
                      businessList.push({
                        business_name: item.business_name,
                        unpaid_amount: unpaidAmount,
                        measurement_year: item.measurement_year,
                        measurement_period: item.measurement_period,
                        unpaid_count: unpaidCount,
                        designated_office: item.designated_office || null,
                        measurement_fee_total: item.measurement_fee_total,
                        deposit_amount_business: item.deposit_amount_business,
                      });
                    }
                  });

                  // 정렬: 미수 횟수(내림차순) → 지청(천안, 대전, 평택, 경기, 기타) → 사업장명(오름차순)
                  const officeOrder = ["천안", "대전", "평택", "경기", "기타"];
                  const getOfficeOrder = (office: string | null): number => {
                    if (!office) return officeOrder.indexOf("기타");
                    const index = officeOrder.indexOf(office);
                    return index === -1 ? officeOrder.length : index;
                  };

                  businessList.sort((a, b) => {
                    // 1. 미수 횟수 내림차순
                    if (b.unpaid_count !== a.unpaid_count) {
                      return b.unpaid_count - a.unpaid_count;
                    }
                    // 2. 지청 순서
                    const officeOrderA = getOfficeOrder(a.designated_office);
                    const officeOrderB = getOfficeOrder(b.designated_office);
                    if (officeOrderA !== officeOrderB) {
                      return officeOrderA - officeOrderB;
                    }
                    // 3. 사업장명 오름차순
                    return a.business_name.localeCompare(b.business_name, "ko");
                  });

                  setUnpaidBusinessList(businessList);
                  setUnpaidBusinessModalTitle(`${officeLabel} - ${categoryLabel} 미수금 사업장 목록`);
                  setIsUnpaidBusinessModalOpen(true);
                };

                return (
                  <>
                    {/* 합계 행 */}
                    <TableRow className="bg-slate-50 border-t-2 border-b-2 border-slate-300">
                      <TableCell className="text-center font-black text-slate-900 py-3 px-3 bg-slate-100">합계</TableCell>
                      <TableCell
                        className="text-center font-black text-blue-600 py-3 px-4 cursor-pointer hover:bg-blue-100 underline decoration-2 underline-offset-4"
                        onClick={() => handleUnpaidBusinessClick(null, "total")}
                        title="클릭하여 사업장 목록 보기"
                      >
                        {totalRow.totalCount}
                      </TableCell>
                      <TableCell className="text-right font-black text-slate-900 py-3 px-4">
                        {formatCurrency(totalRow.totalDeposit + totalRow.totalUnpaid)}
                      </TableCell>
                      <TableCell className="text-right font-black text-slate-900 py-3 px-4">
                        {formatCurrency(totalRow.totalDeposit)}
                      </TableCell>
                      <TableCell className="text-right font-black text-red-600 py-3 px-4 border-r-2 border-slate-300">
                        {formatCurrency(totalRow.totalUnpaid)}
                      </TableCell>
                      <TableCell
                        className="text-center font-black text-blue-600 py-3 px-4 cursor-pointer hover:bg-blue-100 underline decoration-2 underline-offset-4"
                        onClick={() => handleUnpaidBusinessClick(null, "business")}
                        title="클릭하여 사업장 목록 보기"
                      >
                        {totalRow.businessCount}
                      </TableCell>
                      <TableCell className="text-right font-black text-slate-900 py-3 px-4">
                        {formatCurrency(totalRow.businessDeposit)}
                      </TableCell>
                      <TableCell className="text-right font-black text-red-600 py-3 px-4 border-r-2 border-blue-200">
                        {formatCurrency(totalRow.businessUnpaid)}
                      </TableCell>
                      <TableCell
                        className="text-center font-black text-blue-600 py-3 px-4 cursor-pointer hover:bg-blue-100 underline decoration-2 underline-offset-4"
                        onClick={() => handleUnpaidBusinessClick(null, "national")}
                        title="클릭하여 사업장 목록 보기"
                      >
                        {totalRow.nationalCount}
                      </TableCell>
                      <TableCell className="text-right font-black text-slate-900 py-3 px-4">
                        {formatCurrency(totalRow.nationalDeposit)}
                      </TableCell>
                      <TableCell className="text-right font-black text-red-600 py-3 px-4">
                        {formatCurrency(totalRow.nationalUnpaid)}
                      </TableCell>
                    </TableRow>
                    {/* 각 관할지역 행 */}
                    {unpaidData.map((data, index) => (
                      <TableRow
                        key={data.office}
                        className={`border-b border-gray-200 hover:bg-surface-50 transition-colors ${data.office === "천안" ? "bg-green-50/30" : ""}`}
                      >
                        <TableCell className="text-center text-slate-700 py-2.5 px-3 font-medium border-r border-surface-100">{data.label}</TableCell>
                        <TableCell
                          className="text-center text-blue-600 py-2.5 px-4 cursor-pointer hover:bg-blue-50 underline underline-offset-2"
                          onClick={() => handleUnpaidBusinessClick(data.office, "total")}
                          title="클릭하여 사업장 목록 보기"
                        >
                          {data.total.count}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 py-2.5 px-4">
                          {formatCurrency(data.total.deposit + data.total.unpaid)}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 py-2.5 px-4">
                          {formatCurrency(data.total.deposit)}
                        </TableCell>
                        <TableCell className="text-right text-red-600 font-semibold py-2.5 px-4 border-r-2 border-slate-300">
                          {formatCurrency(data.total.unpaid)}
                        </TableCell>
                        <TableCell
                          className="text-center text-blue-600 py-2.5 px-4 cursor-pointer hover:bg-blue-50 underline underline-offset-2"
                          onClick={() => handleUnpaidBusinessClick(data.office, "business")}
                          title="클릭하여 사업장 목록 보기"
                        >
                          {data.business.count}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 py-2.5 px-4">
                          {formatCurrency(data.business.deposit)}
                        </TableCell>
                        <TableCell className="text-right text-red-600 font-semibold py-2.5 px-4 border-r-2 border-blue-200">
                          {formatCurrency(data.business.unpaid)}
                        </TableCell>
                        <TableCell
                          className="text-center text-blue-600 py-2.5 px-4 cursor-pointer hover:bg-blue-50 underline underline-offset-2"
                          onClick={() => handleUnpaidBusinessClick(data.office, "national")}
                          title="클릭하여 사업장 목록 보기"
                        >
                          {data.national.count}
                        </TableCell>
                        <TableCell className="text-right text-slate-600 py-2.5 px-4">
                          {formatCurrency(data.national.deposit)}
                        </TableCell>
                        <TableCell className="text-right text-red-600 font-semibold py-2.5 px-4">
                          {formatCurrency(data.national.unpaid)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </>
                );
              })()}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* 미수금 사업장 목록 모달 */}
      <Modal
        isOpen={isUnpaidBusinessModalOpen}
        onClose={() => setIsUnpaidBusinessModalOpen(false)}
        title={unpaidBusinessModalTitle}
        size="2xl"
      >
        <div>
          {unpaidBusinessList.length === 0 ? (
            <div className="py-8 text-center text-text-600 text-sm">
              사업장이 없습니다.
            </div>
          ) : (
            <Table maxHeight="max-h-[60vh]">
              <TableHeader>
                <TableRow className="bg-sky-100">
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">연번</TableHead>
                  <TableHead className="font-semibold py-1 px-2 text-black text-sm">사업장명</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">미수 횟수</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정년도</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정주기</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">측정비(합계)</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">입금액[측정비 (사업장)]</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">미수금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unpaidBusinessList.map((business, index) => (
                  <TableRow key={index} className="border-b border-gray-200">
                    <TableCell className="text-center text-black py-1 px-2 text-sm">{index + 1}</TableCell>
                    <TableCell className="text-black py-1 px-2 text-sm">{business.business_name}</TableCell>
                    <TableCell className={`text-center py-1 px-2 text-sm font-semibold ${business.unpaid_count >= 2 ? 'text-red-600' : 'text-black'}`}>
                      {business.unpaid_count}회
                    </TableCell>
                    <TableCell className="text-center text-black py-1 px-2 text-sm">{business.measurement_year}</TableCell>
                    <TableCell className="text-center text-black py-1 px-2 text-sm">{business.measurement_period}</TableCell>
                    <TableCell className="text-right text-black py-1 px-2 text-sm">
                      {formatCurrency(business.measurement_fee_total || 0)}원
                    </TableCell>
                    <TableCell className="text-right text-black py-1 px-2 text-sm">
                      {formatCurrency(business.deposit_amount_business || 0)}원
                    </TableCell>
                    <TableCell className="text-right text-black py-1 px-2 text-sm font-semibold">
                      {formatCurrency(business.unpaid_amount)}원
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Modal>


      {/* 매출 관리 탭 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold text-text-900 mb-4">매출 상세 현황</h2>
        <Tab
          items={[
            {
              id: "measurement",
              label: "측정비",
              content: (() => {
                // 검색어 매칭 헬퍼 함수 (콤마로 구분된 다중 키워드 OR 검색)
                const checkSearchMatch = (targetValue: string | null, searchValue: string) => {
                  if (!searchValue) return true;
                  if (!targetValue) return false;

                  const target = targetValue.toLowerCase();
                  const terms = searchValue.split(",").map(term => term.trim().toLowerCase()).filter(term => term.length > 0);

                  if (terms.length === 0) return true;

                  // 하나라도 포함되면 true (OR 조건)
                  return terms.some(term => target.includes(term));
                };

                // 필터링 적용
                let filteredMeasurement = measurementRevenue.filter((item) => {
                  if (debouncedMeasurementFilters.businessName && !checkSearchMatch(item.business_name, debouncedMeasurementFilters.businessName)) return false;
                  if (debouncedMeasurementFilters.representativeName && !checkSearchMatch(item.representative_name, debouncedMeasurementFilters.representativeName)) return false;
                  if (debouncedMeasurementFilters.year && item.measurement_year.toString() !== debouncedMeasurementFilters.year) return false;
                  if (debouncedMeasurementFilters.period && item.measurement_period !== debouncedMeasurementFilters.period) return false;
                  if (debouncedMeasurementFilters.designatedOffice && item.designated_office !== debouncedMeasurementFilters.designatedOffice) return false;
                  if (debouncedMeasurementFilters.hasInvoiceDate === "yes" && !item.electronic_invoice_date) return false;
                  if (debouncedMeasurementFilters.hasInvoiceDate === "no" && item.electronic_invoice_date) return false;
                  return true;
                });

                // 정렬 적용
                filteredMeasurement.sort((a, b) => {
                  let aValue: any;
                  let bValue: any;

                  // 미수금액 컬럼 처리 (계산된 값)
                  if (measurementSort.column === "unpaid") {
                    const aTotal = parseFloat(a.measurement_fee_total?.toString() || "0") || 0;
                    const aDeposit = parseFloat(a.deposit_total?.toString() || "0") || 0;
                    aValue = aTotal - aDeposit;

                    const bTotal = parseFloat(b.measurement_fee_total?.toString() || "0") || 0;
                    const bDeposit = parseFloat(b.deposit_total?.toString() || "0") || 0;
                    bValue = bTotal - bDeposit;
                  } else {
                    aValue = a[measurementSort.column as keyof MeasurementRevenue];
                    bValue = b[measurementSort.column as keyof MeasurementRevenue];
                  }

                  // 문자열 비교
                  if (typeof aValue === "string" && typeof bValue === "string") {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                  }

                  // null 처리
                  if (aValue === null || aValue === undefined) aValue = "";
                  if (bValue === null || bValue === undefined) bValue = "";

                  if (measurementSort.direction === "asc") {
                    return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
                  } else {
                    return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
                  }
                });

                // 정렬 아이콘 컴포넌트
                const MeasurementSortIcon = ({ column }: { column: string }) => {
                  if (measurementSort.column !== column) {
                    return <span className="text-gray-400 text-xs ml-1">↕</span>;
                  }
                  return (
                    <span className={`text-xs ml-1 font-bold ${measurementSort.direction === "asc" ? "text-red-600" : "text-blue-600"}`}>
                      {measurementSort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  );
                };

                // 정렬 핸들러
                const handleMeasurementSort = (column: string) => {
                  if (measurementSort.column === column) {
                    setMeasurementSort({
                      column,
                      direction: measurementSort.direction === "asc" ? "desc" : "asc",
                    });
                  } else {
                    setMeasurementSort({ column, direction: "desc" });
                  }
                };

                return (
                  <div className="mt-4">
                    <div className="sticky top-[-1px] z-40 bg-white py-3 flex justify-between items-center border-b border-surface-100 mb-2">
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-medium text-text-700">
                          검색 결과: <span className="text-primary-600 font-bold">{filteredMeasurement.length}</span>건 <span className="text-text-400 font-normal ml-1">(전체 {measurementRevenue.length}건)</span>
                        </div>
                        {isMeasurementFiltering && (
                          <div className="flex items-center gap-2 text-xs text-primary-500 animate-pulse">
                            <LoadingSpinner className="w-3 h-3" />
                            <span>검색 중...</span>
                          </div>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          const initial = {
                            businessName: "",
                            representativeName: "",
                            year: "",
                            period: "",
                            designatedOffice: "",
                            hasInvoiceDate: "",
                          };
                          setMeasurementFilters(initial);
                          setDebouncedMeasurementFilters(initial);
                          setMeasurementSort({ column: "measurement_fee_total", direction: "desc" });
                        }}
                      >
                        필터 초기화
                      </Button>
                    </div>
                    <div className="rounded-lg border border-surface-200 min-h-[500px] bg-white">
                      <Table maxHeight="max-h-[calc(100vh-350px)]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_year")}
                                >
                                  측정년도
                                  <MeasurementSortIcon column="measurement_year" />
                                </div>
                                <Select
                                  value={measurementFilters.year}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, year: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    ...yearOptions,
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_period")}
                                >
                                  측정주기
                                  <MeasurementSortIcon column="measurement_period" />
                                </div>
                                <Select
                                  value={measurementFilters.period}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, period: e.target.value })
                                  }
                                  options={periodOptions}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("business_name")}
                                >
                                  사업장명
                                  <MeasurementSortIcon column="business_name" />
                                </div>
                                <Input
                                  value={measurementFilters.businessName}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, businessName: e.target.value })
                                  }
                                  placeholder="검색..."
                                  className="text-xs h-7"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("representative_name")}
                                >
                                  대표자명
                                  <MeasurementSortIcon column="representative_name" />
                                </div>
                                <Input
                                  value={measurementFilters.representativeName}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, representativeName: e.target.value })
                                  }
                                  placeholder="검색..."
                                  className="text-xs h-7"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("designated_office")}
                                >
                                  지정지청
                                  <MeasurementSortIcon column="designated_office" />
                                </div>
                                <Select
                                  value={measurementFilters.designatedOffice}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, designatedOffice: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    ...DESIGNATED_OFFICE_OPTIONS.slice(1), // "전체" 제외
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_fee_business")}
                                >
                                  측정비(사업장)
                                  <MeasurementSortIcon column="measurement_fee_business" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-center">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("deposit_date_business")}
                                >
                                  측정비(입금일)
                                  <MeasurementSortIcon column="deposit_date_business" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_fee_national")}
                                >
                                  측정비(국고)
                                  <MeasurementSortIcon column="measurement_fee_national" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_fee_total")}
                                >
                                  측정비(합계)
                                  <MeasurementSortIcon column="measurement_fee_total" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("deposit_total")}
                                >
                                  입금액
                                  <MeasurementSortIcon column="deposit_total" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("unpaid")}
                                >
                                  미수금액
                                  <MeasurementSortIcon column="unpaid" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("electronic_invoice_date")}
                                >
                                  계산서 발행일
                                  <MeasurementSortIcon column="electronic_invoice_date" />
                                </div>
                                <Select
                                  value={measurementFilters.hasInvoiceDate}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, hasInvoiceDate: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    { value: "yes", label: "발행일 있음" },
                                    { value: "no", label: "발행일 없음" },
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>작업</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredMeasurement.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={13} className="text-center text-text-500 py-8">
                                {measurementRevenue.length === 0
                                  ? "데이터가 없습니다."
                                  : "필터 조건에 맞는 항목이 없습니다."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredMeasurement.map((item) => {
                              const total = parseFloat(item.measurement_fee_total?.toString() || "0");
                              const deposit = parseFloat(item.deposit_total?.toString() || "0");
                              const unpaid = total - deposit;
                              return (
                                <TableRow key={item.id}>
                                  <TableCell>{item.measurement_year}</TableCell>
                                  <TableCell>{item.measurement_period}</TableCell>
                                  <TableCell className="font-medium">{item.business_name}</TableCell>
                                  <TableCell>{item.representative_name}</TableCell>
                                  <TableCell>{item.designated_office}</TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.measurement_fee_business)}원
                                  </TableCell>
                                  <TableCell className="text-center text-sm">
                                    {item.deposit_date_business || "-"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.measurement_fee_national)}원
                                  </TableCell>
                                  <TableCell className="text-right font-semibold">
                                    {formatCurrency(item.measurement_fee_total)}원
                                  </TableCell>
                                  <TableCell
                                    className="text-right cursor-pointer hover:bg-gray-100 hover:text-primary-600 transition-colors"
                                    onClick={() => {
                                      if (item.deposit_total && parseFloat(item.deposit_total.toString()) > 0) {
                                        setMeasurementDepositDetailItem(item);
                                        setIsMeasurementDepositDetailModalOpen(true);
                                      }
                                    }}
                                    title={item.deposit_total && parseFloat(item.deposit_total.toString()) > 0 ? "입금액 상세 보기" : ""}
                                  >
                                    {formatCurrency(item.deposit_total)}원
                                  </TableCell>
                                  <TableCell className="text-right text-warning-600 font-semibold">
                                    {formatCurrency(unpaid)}원
                                  </TableCell>
                                  <TableCell>
                                    {item.electronic_invoice_date
                                      ? formatDateYYYYMMDD(item.electronic_invoice_date)
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      onClick={async () => {
                                        try {
                                          // 측정일지 데이터 가져오기
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
                                      }}
                                    >
                                      수정
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
              id: "other",
              label: "기타",
              content: (() => {
                // 필터링 적용
                let filteredOther = otherRevenue.filter((item) => {
                  if (debouncedOtherFilters.itemName && !item.item_name.toLowerCase().includes(debouncedOtherFilters.itemName.toLowerCase())) return false;
                  if (debouncedOtherFilters.year && item.revenue_year?.toString() !== debouncedOtherFilters.year) return false;
                  if (debouncedOtherFilters.period && item.revenue_period !== debouncedOtherFilters.period) return false;
                  if (debouncedOtherFilters.hasInvoiceDate === "yes" && !item.invoice_date) return false;
                  if (debouncedOtherFilters.hasInvoiceDate === "no" && item.invoice_date) return false;
                  if (debouncedOtherFilters.hasDepositDate === "yes" && !item.deposit_date) return false;
                  if (debouncedOtherFilters.hasDepositDate === "no" && item.deposit_date) return false;
                  if (debouncedOtherFilters.notes && (!item.notes || !item.notes.toLowerCase().includes(debouncedOtherFilters.notes.toLowerCase()))) return false;
                  return true;
                });

                // 정렬 적용
                filteredOther.sort((a, b) => {
                  let aValue: any = a[otherSort.column as keyof OtherRevenue];
                  let bValue: any = b[otherSort.column as keyof OtherRevenue];

                  // 문자열 비교
                  if (typeof aValue === "string" && typeof bValue === "string") {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                  }

                  // null 처리
                  if (aValue === null || aValue === undefined) aValue = "";
                  if (bValue === null || bValue === undefined) bValue = "";

                  if (otherSort.direction === "asc") {
                    return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
                  } else {
                    return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
                  }
                });

                // 정렬 아이콘 컴포넌트
                const OtherSortIcon = ({ column }: { column: string }) => {
                  if (otherSort.column !== column) {
                    return <span className="text-gray-400 text-xs ml-1">↕</span>;
                  }
                  return (
                    <span className={`text-xs ml-1 font-bold ${otherSort.direction === "asc" ? "text-red-600" : "text-blue-600"}`}>
                      {otherSort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  );
                };

                // 정렬 핸들러
                const handleOtherSort = (column: string) => {
                  if (otherSort.column === column) {
                    setOtherSort({
                      column,
                      direction: otherSort.direction === "asc" ? "desc" : "asc",
                    });
                  } else {
                    setOtherSort({ column, direction: "desc" });
                  }
                };

                return (
                  <div className="mt-4">
                    <div className="sticky top-[-1px] z-40 bg-white py-3 flex justify-between items-center border-b border-surface-100 mb-2">
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-medium text-text-700">
                          검색 결과: <span className="text-primary-600 font-bold">{filteredOther.length}</span>건 <span className="text-text-400 font-normal ml-1">(전체 {otherRevenue.length}건)</span>
                        </div>
                        {isOtherFiltering && (
                          <div className="flex items-center gap-2 text-xs text-primary-500 animate-pulse">
                            <LoadingSpinner className="w-3 h-3" />
                            <span>검색 중...</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {selectedOtherIds.length > 0 && (
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleBulkDeleteOther}
                            disabled={isDeleting}
                          >
                            {isDeleting ? "삭제 중..." : `선택 삭제 (${selectedOtherIds.length})`}
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 text-xs font-semibold"
                          onClick={() => {
                            const initial = {
                              itemName: "",
                              year: "",
                              period: "",
                              hasInvoiceDate: "",
                              hasDepositDate: "",
                              notes: "",
                            };
                            setOtherFilters(initial);
                            setDebouncedOtherFilters(initial);
                            setOtherSort({ column: "total_amount", direction: "desc" });
                          }}
                        >
                          필터 초기화
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setIsUploadModalOpen(true)}
                        >
                          Excel 업로드
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleOtherEdit(null)}
                        >
                          기타 매출 등록
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-surface-200 min-h-[500px] bg-white overflow-hidden">
                      <Table maxHeight="max-h-[calc(100vh-350px)]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-12">
                              <Checkbox
                                checked={
                                  filteredOther.length > 0 &&
                                  selectedOtherIds.length === filteredOther.length
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedOtherIds(filteredOther.map((item) => item.id));
                                  } else {
                                    setSelectedOtherIds([]);
                                  }
                                }}
                                disabled={filteredOther.length === 0}
                              />
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("item_name")}
                                >
                                  품명
                                  <OtherSortIcon column="item_name" />
                                </div>
                                <Input
                                  value={otherFilters.itemName}
                                  onChange={(e) =>
                                    setOtherFilters({ ...otherFilters, itemName: e.target.value })
                                  }
                                  placeholder="검색..."
                                  className="text-xs h-7"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("invoice_date")}
                                >
                                  계산서 발행일
                                  <OtherSortIcon column="invoice_date" />
                                </div>
                                <Select
                                  value={otherFilters.hasInvoiceDate}
                                  onChange={(e) =>
                                    setOtherFilters({ ...otherFilters, hasInvoiceDate: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    { value: "yes", label: "발행일 있음" },
                                    { value: "no", label: "발행일 없음" },
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("supply_amount")}
                                >
                                  공급가액
                                  <OtherSortIcon column="supply_amount" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("vat_amount")}
                                >
                                  부가세
                                  <OtherSortIcon column="vat_amount" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("total_amount")}
                                >
                                  합계금액
                                  <OtherSortIcon column="total_amount" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("deposit_date")}
                                >
                                  입금일
                                  <OtherSortIcon column="deposit_date" />
                                </div>
                                <Select
                                  value={otherFilters.hasDepositDate}
                                  onChange={(e) =>
                                    setOtherFilters({ ...otherFilters, hasDepositDate: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    { value: "yes", label: "입금일 있음" },
                                    { value: "no", label: "입금일 없음" },
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("deposit_amount")}
                                >
                                  입금액
                                  <OtherSortIcon column="deposit_amount" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleOtherSort("notes")}
                                >
                                  비고
                                  <OtherSortIcon column="notes" />
                                </div>
                                <Input
                                  value={otherFilters.notes}
                                  onChange={(e) =>
                                    setOtherFilters({ ...otherFilters, notes: e.target.value })
                                  }
                                  placeholder="검색..."
                                  className="text-xs h-7"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div className="text-sm font-medium">매출년도</div>
                                <Select
                                  value={otherFilters.year}
                                  onChange={(e) =>
                                    setOtherFilters({ ...otherFilters, year: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    ...yearOptions,
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div className="text-sm font-medium">매출주기</div>
                                <Select
                                  value={otherFilters.period}
                                  onChange={(e) =>
                                    setOtherFilters({ ...otherFilters, period: e.target.value })
                                  }
                                  options={periodOptions}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>작업</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredOther.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={12} className="text-center text-text-500 py-8">
                                {otherRevenue.length === 0
                                  ? "데이터가 없습니다."
                                  : "필터 조건에 맞는 항목이 없습니다."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredOther.map((item) => {
                              const unpaid = (item.total_amount || 0) - (item.deposit_amount || 0);
                              const isSelected = selectedOtherIds.includes(item.id);
                              return (
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <Checkbox
                                      checked={isSelected}
                                      onChange={(e) => handleSelectOther(item.id, e.target.checked)}
                                    />
                                  </TableCell>
                                  <TableCell className="font-medium">{item.item_name}</TableCell>
                                  <TableCell>
                                    {item.invoice_date ? formatDateYYYYMMDD(item.invoice_date) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.supply_amount)}원
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.vat_amount)}원
                                  </TableCell>
                                  <TableCell className="text-right font-semibold">
                                    {formatCurrency(item.total_amount)}원
                                  </TableCell>
                                  <TableCell>
                                    {item.deposit_date ? formatDateYYYYMMDD(item.deposit_date) : "-"}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.deposit_amount)}원
                                  </TableCell>
                                  <TableCell>{item.notes || "-"}</TableCell>
                                  <TableCell>{item.revenue_year || "-"}</TableCell>
                                  <TableCell>{item.revenue_period || "-"}</TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleOtherEdit(item)}
                                      >
                                        수정
                                      </Button>
                                      <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => handleOtherDelete(item.id)}
                                      >
                                        삭제
                                      </Button>
                                    </div>
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
                  if (debouncedUnpaidFilters.type && item.type !== debouncedUnpaidFilters.type) return false;
                  if (debouncedUnpaidFilters.name && !item.name.toLowerCase().includes(debouncedUnpaidFilters.name.toLowerCase())) return false;
                  if (debouncedUnpaidFilters.year && item.year.toString() !== debouncedUnpaidFilters.year) return false;
                  if (debouncedUnpaidFilters.period && item.period !== debouncedUnpaidFilters.period) return false;
                  if (debouncedUnpaidFilters.designatedOffice && item.designatedOffice !== debouncedUnpaidFilters.designatedOffice) return false;
                  if (debouncedUnpaidFilters.hasDepositDate === "yes" && !item.depositDate) return false;
                  if (debouncedUnpaidFilters.hasDepositDate === "no" && item.depositDate) return false;
                  return true;
                });

                // 정렬 적용
                filteredItems.sort((a, b) => {
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

                  if (unpaidSort.direction === "asc") {
                    return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
                  } else {
                    return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
                  }
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
                          setDebouncedUnpaidFilters(initial);
                          setUnpaidSort({ column: "unpaid", direction: "desc" });
                        }}
                      >
                        필터 초기화
                      </Button>
                    </div>
                    <div className="rounded-lg border border-surface-200 min-h-[500px] bg-white overflow-hidden">
                      <Table maxHeight="max-h-[calc(100vh-350px)]">
                        <TableHeader>
                          <TableRow>
                            <TableHead>
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
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("name")}
                                >
                                  사업장명/품명
                                  <SortIcon column="name" />
                                </div>
                                <Input
                                  value={unpaidFilters.name}
                                  onChange={(e) =>
                                    setUnpaidFilters({ ...unpaidFilters, name: e.target.value })
                                  }
                                  placeholder="검색..."
                                  className="text-xs h-7"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
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
                                  options={[
                                    { value: "", label: "전체" },
                                    ...yearOptions,
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
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
                                  options={[
                                    { value: "", label: "전체" },
                                    { value: "상반기", label: "상반기" },
                                    { value: "하반기", label: "하반기" },
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("revenue")}
                                >
                                  매출금액
                                  <SortIcon column="revenue" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("deposit")}
                                >
                                  입금액
                                  <SortIcon column="deposit" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-end cursor-pointer hover:text-primary-600"
                                  onClick={() => handleSort("unpaid")}
                                >
                                  미수금
                                  <SortIcon column="unpaid" />
                                </div>
                                <div className="text-xs text-text-500">-</div>
                              </div>
                            </TableHead>
                            <TableHead>
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
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>
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
                                  options={[
                                    { value: "", label: "전체" },
                                    ...DESIGNATED_OFFICE_OPTIONS.slice(1), // "전체" 제외
                                  ]}
                                  className="text-xs"
                                />
                              </div>
                            </TableHead>
                            <TableHead>작업</TableHead>
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
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell>{item.year}</TableCell>
                                    <TableCell>{item.period}</TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(item.revenue)}원
                                    </TableCell>
                                    <TableCell className="text-right">
                                      {formatCurrency(item.deposit)}원
                                    </TableCell>
                                    <TableCell className="text-right text-warning-600 font-semibold">
                                      {formatCurrency(item.unpaid)}원
                                    </TableCell>
                                    <TableCell
                                      className={hasNoDepositDate ? "text-warning-600 font-semibold" : ""}
                                    >
                                      {item.depositDate ? formatDateYYYYMMDD(item.depositDate) : "미입금"}
                                    </TableCell>
                                    <TableCell>{item.designatedOffice || "-"}</TableCell>
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
                                <TableCell colSpan={7} className="text-right font-semibold">
                                  미수금 합계
                                </TableCell>
                                <TableCell className="text-right font-bold text-warning-600 text-lg">
                                  {formatCurrency(totalUnpaid)}원
                                </TableCell>
                                <TableCell colSpan={2}>{""}</TableCell>
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

                // 1. 측정비 사업장 입금
                measurementRevenue.forEach(item => {
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
                });

                // 2. 측정비 국고 입금
                measurementRevenue.forEach(item => {
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
                otherRevenue.forEach(item => {
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
                  const dateMatch = item.date >= depositStartDate && item.date <= depositEndDate;
                  const officeMatch = !depositOffice || item.designatedOffice === depositOffice;
                  const yearMatch = !depositYear || item.year?.toString() === depositYear;
                  const periodMatch = !depositPeriod || item.period === depositPeriod;
                  const categoryMatch = !depositCategory || item.category === depositCategory;
                  const businessNameMatch = !debouncedDepositBusinessName ||
                    item.name.toLowerCase().includes(debouncedDepositBusinessName.toLowerCase());

                  return dateMatch && officeMatch && yearMatch && periodMatch && categoryMatch && businessNameMatch;
                });

                // 날짜순 정렬 (최신순)
                filteredDeposits.sort((a, b) => b.date.localeCompare(a.date));

                const totalDepositAmount = filteredDeposits.reduce((sum, item) => sum + item.amount, 0);

                return (
                  <div className="mt-4">
                    <div className="bg-white p-6 border border-surface-200 rounded-xl mb-6 shadow-md">
                      <div className="flex flex-wrap items-end gap-x-8 gap-y-5">
                        {/* 1. 매출년도 */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-bold text-text-800 ml-1">매출년도</label>
                          <Select
                            value={depositYear}
                            onChange={(e) => setDepositYear(e.target.value)}
                            options={[
                              { value: "", label: "전체" },
                              ...yearOptions,
                            ]}
                            className="w-32 h-11 text-sm font-medium"
                          />
                        </div>

                        {/* 2. 주기 */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-bold text-text-800 ml-1">주기</label>
                          <Select
                            value={depositPeriod}
                            onChange={(e) => setDepositPeriod(e.target.value)}
                            options={[
                              { value: "", label: "전체 주기" },
                              ...periodOptions.filter(opt => opt.value !== ""),
                            ]}
                            className="w-32 h-11 text-sm font-medium"
                          />
                        </div>

                        {/* 3. 지정지청 */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-bold text-text-800 ml-1">지정지청</label>
                          <Select
                            value={depositOffice}
                            onChange={(e) => setDepositOffice(e.target.value)}
                            options={[
                              { value: "", label: "전체 지청" },
                              ...DESIGNATED_OFFICE_OPTIONS.slice(1),
                            ]}
                            className="w-44 h-11 text-sm font-medium"
                          />
                        </div>

                        {/* 4. 매출 구분 */}
                        <div className="flex flex-col gap-2">
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
                            className="w-44 h-11 text-sm font-medium"
                          />
                        </div>

                        {/* 5. 입금 기간 */}
                        <div className="flex flex-col gap-2">
                          <label className="text-sm font-bold text-text-800 ml-1">입금 기간</label>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Input
                                type="date"
                                value={depositStartDate}
                                onChange={(e) => {
                                  setDepositStartDate(e.target.value);
                                  setActiveQuickDate(null);
                                }}
                                className="w-[180px] h-12 text-lg font-bold large-date-input"
                              />
                              <span className="text-text-400 font-bold text-2xl mb-1">~</span>
                              <Input
                                type="date"
                                value={depositEndDate}
                                onChange={(e) => {
                                  setDepositEndDate(e.target.value);
                                  setActiveQuickDate(null);
                                }}
                                className="w-[180px] h-12 text-lg font-bold large-date-input"
                              />
                            </div>
                            <div className="flex items-center gap-1.5 ml-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleQuickDateSelect("today")}
                                className={cn(
                                  "h-10 px-4 font-bold transition-all rounded-lg text-sm border shadow-none",
                                  activeQuickDate === "today"
                                    ? "bg-amber-500 text-white border-amber-600 hover:bg-amber-600 shadow-sm"
                                    : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:text-amber-800"
                                )}
                              >
                                금일
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleQuickDateSelect("week")}
                                className={cn(
                                  "h-10 px-4 font-bold transition-all rounded-lg text-sm border shadow-none",
                                  activeQuickDate === "week"
                                    ? "bg-emerald-500 text-white border-emerald-600 hover:bg-emerald-600 shadow-sm"
                                    : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800"
                                )}
                              >
                                1주일
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleQuickDateSelect("month")}
                                className={cn(
                                  "h-10 px-4 font-bold transition-all rounded-lg text-sm border shadow-none",
                                  activeQuickDate === "month"
                                    ? "bg-rose-500 text-white border-rose-600 hover:bg-rose-600 shadow-sm"
                                    : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100 hover:text-rose-800"
                                )}
                              >
                                1개월
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* 6. 사업장명 / 품명 */}
                        <div className="flex flex-col gap-2 w-[260px]">
                          <label className="text-sm font-bold text-text-800 ml-1">사업장명 / 품명 검색</label>
                          <Input
                            placeholder="찾으시는 사업장명 또는 품명을 입력하세요..."
                            value={depositBusinessName}
                            onChange={(e) => setDepositBusinessName(e.target.value)}
                            className="h-11 text-sm font-medium px-4"
                          />
                        </div>

                        {/* 입금 건수 */}
                        <div className="bg-blue-600 px-5 py-2.5 rounded-xl shadow-lg shadow-blue-100 flex flex-col items-center justify-center min-w-[120px] ml-auto">
                          <div className="text-[10px] text-white/80 font-black uppercase tracking-[0.1em] mb-0.5">입금 건수</div>
                          <div className="text-2xl font-black text-white">
                            {filteredDeposits.length}<span className="text-sm font-normal ml-1 text-white/80">건</span>
                          </div>
                        </div>

                        {/* 합계 금액 - 더 강조된 박스 */}
                        <div className="bg-primary-600 px-6 py-2.5 rounded-xl shadow-lg shadow-primary-100 flex flex-col items-center justify-center min-w-[200px] ml-4">
                          <div className="text-[10px] text-white/80 font-black uppercase tracking-[0.1em] mb-0.5">총 입금 합계</div>
                          <div className="text-2xl font-black text-white">
                            {formatCurrency(totalDepositAmount)}<span className="text-lg font-normal ml-1">원</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-surface-200 min-h-[500px] bg-white overflow-hidden shadow-lg">
                      <Table maxHeight="max-h-[calc(100vh-420px)]">
                        <TableHeader>
                          <TableRow className="bg-surface-50">
                            <TableHead className="font-bold py-4 text-text-900 text-sm pl-6">지정지청</TableHead>
                            <TableHead className="font-bold py-4 text-text-900 border-l border-surface-100 text-sm">사업장명 / 품명</TableHead>
                            <TableHead className="font-bold py-4 text-text-900 border-l border-surface-100 text-sm text-center">대표자</TableHead>
                            <TableHead className="font-bold py-4 text-text-900 border-l border-surface-100 text-sm">매출 구분</TableHead>
                            <TableHead className="text-center font-bold py-4 text-text-900 border-l border-surface-100 text-sm">입금일</TableHead>
                            <TableHead className="text-right font-bold py-4 text-text-900 border-l border-surface-100 px-8 text-sm">입금액</TableHead>
                            <TableHead className="font-bold py-4 text-text-900 border-l border-surface-100 text-sm">비고</TableHead>
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
                                className="group hover:bg-primary-50/60 transition-all border-b last:border-0 h-14 cursor-default relative"
                              >
                                <TableCell className="text-text-700 font-medium pl-6 relative">
                                  <div className="absolute left-0 top-0 bottom-0 w-0 group-hover:w-1.5 bg-primary-500 transition-all rounded-r-md" />
                                  {item.designatedOffice || "-"}
                                </TableCell>
                                <TableCell className="font-bold text-text-900 text-base">{item.name}</TableCell>
                                <TableCell className="text-text-700 font-medium text-center">{item.representative || "-"}</TableCell>
                                <TableCell>
                                  <span className={`px-3 py-1 rounded-lg text-xs font-black
                                    ${item.category.includes("사업장") ? "bg-blue-100 text-blue-700" :
                                      item.category.includes("국고") ? "bg-emerald-100 text-emerald-700" :
                                        "bg-amber-100 text-amber-700"}`}>
                                    {item.category}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center font-semibold text-text-600">{formatDateYYYYMMDD(item.date)}</TableCell>
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
            <Button variant="primary" onClick={handleOtherSave} disabled={saving}>
              {saving ? "저장 중..." : "저장"}
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
                >
                  {isJournalFormSubmitting ? <LoadingSpinner /> : "수정"}
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
    </div >
  );
};
