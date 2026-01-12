"use client";

import React, { useState, useEffect } from "react";
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

interface MeasurementRevenue {
  id: number;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [measurementRevenue, setMeasurementRevenue] = useState<MeasurementRevenue[]>([]);
  const [otherRevenue, setOtherRevenue] = useState<OtherRevenue[]>([]);
  const [summary, setSummary] = useState<{
    byOffice: Record<string, OfficeSummary>;
    byYear: Record<number, YearlySummary>;
  } | null>(null);

  // 필터 상태
  const [filters, setFilters] = useState({
    year: "",
    businessName: "",
    measurementPeriod: "",
    designatedOffice: "",
  });

  // 년도별 집계 년도 선택 상태 (기본값: 빈 문자열 - 전체 데이터 표시)
  const [yearlySummaryYear, setYearlySummaryYear] = useState<string>("");
  
  // 미수금 집계 년도 선택 상태
  const [unpaidSummaryYear, setUnpaidSummaryYear] = useState<string>("");
  
  // 미수금 사업장 목록 모달 상태
  const [isUnpaidBusinessModalOpen, setIsUnpaidBusinessModalOpen] = useState(false);
  const [unpaidBusinessList, setUnpaidBusinessList] = useState<Array<{
    business_name: string;
    unpaid_amount: number;
    measurement_year: number;
    measurement_period: string;
    unpaid_count: number;
    designated_office: string | null;
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

  // 미수관리 필터 및 정렬 상태
  const [unpaidFilters, setUnpaidFilters] = useState({
    type: "", // 구분: "measurement" | "other" | ""
    name: "", // 사업장명/품명
    year: "", // 매출년도
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
    year: "", // 매출년도
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
    year: "", // 측정년도
    period: "", // 측정주기
    designatedOffice: "", // 지정한계_관할지청
    hasInvoiceDate: "", // 계산서 발행일 여부: "yes" | "no" | ""
  });
  const [measurementSort, setMeasurementSort] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "measurement_fee_total", direction: "desc" });

  // 측정년도 옵션
  const currentYear = new Date().getFullYear();
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

      const params = new URLSearchParams();
      if (filters.year) params.append("year", filters.year);
      if (filters.businessName) params.append("businessName", filters.businessName);
      if (filters.measurementPeriod) params.append("measurementPeriod", filters.measurementPeriod);
      if (filters.designatedOffice) params.append("designatedOffice", filters.designatedOffice);

      const response = await fetch(`/api/sales?${params.toString()}`);
      
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

  const handleFilterChange = () => {
    loadSalesData();
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
      {/* 필터 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold text-text-900 mb-4">검색 조건</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">년도</label>
            <Select
              value={filters.year}
              onChange={(e) => {
                setFilters({ ...filters, year: e.target.value });
                setTimeout(handleFilterChange, 0);
              }}
              options={[{ value: "", label: "전체" }, ...yearOptions]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">측정주기</label>
            <Select
              value={filters.measurementPeriod}
              onChange={(e) => {
                setFilters({ ...filters, measurementPeriod: e.target.value });
                setTimeout(handleFilterChange, 0);
              }}
              options={periodOptions}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">지정지청</label>
            <Select
              value={filters.designatedOffice}
              onChange={(e) => {
                setFilters({ ...filters, designatedOffice: e.target.value });
                setTimeout(handleFilterChange, 0);
              }}
              options={officeOptions}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">사업장명</label>
            <Input
              value={filters.businessName}
              onChange={(e) => setFilters({ ...filters, businessName: e.target.value })}
              onKeyPress={(e) => {
                if (e.key === "Enter") handleFilterChange();
              }}
              placeholder="사업장명 입력"
            />
          </div>
          <div className="flex items-end">
            <Button variant="primary" onClick={handleFilterChange}>
              검색
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {/* 년도별 집계 */}
      {summary && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-text-900">년도별 집계 현황</h2>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-text-700 whitespace-nowrap">년도 선택:</label>
              <Select
                value={yearlySummaryYear}
                onChange={(e) => setYearlySummaryYear(e.target.value)}
                options={[{ value: "", label: "전체" }, ...yearOptions]}
                className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300"
              />
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
                    const officeSummary = summary.byOffice[office] || {
                      measurementRevenue: 0,
                      measurementVat: 0,
                      measurementTotal: 0,
                      measurementDeposit: 0,
                      measurementUnpaid: 0,
                      otherRevenue: 0,
                      otherVat: 0,
                      otherTotal: 0,
                      otherDeposit: 0,
                      otherUnpaid: 0,
                      totalRevenue: 0,
                      totalVat: 0,
                      totalAmount: 0,
                      totalDeposit: 0,
                      totalUnpaid: 0,
                    };

                    // 선택된 년도 데이터가 있으면 해당 년도 데이터 사용, 없으면 전체 데이터 사용
                    const yearData = selectedYearData
                      ? {
                          firstHalf: office === "기타"
                            ? selectedYearData.firstHalf.otherTotal
                            : selectedYearData.firstHalf.measurementTotal,
                          secondHalf: office === "기타"
                            ? selectedYearData.secondHalf.otherTotal
                            : selectedYearData.secondHalf.measurementTotal,
                          total: office === "기타"
                            ? selectedYearData.total.otherTotal
                            : selectedYearData.total.measurementTotal,
                        }
                      : null;

                    const measurementFee = office === "기타"
                      ? officeSummary.otherRevenue
                      : officeSummary.measurementRevenue;
                    const vat = office === "기타"
                      ? officeSummary.otherVat
                      : 0;
                    const total = office === "기타"
                      ? officeSummary.otherTotal
                      : officeSummary.measurementTotal;
                    const deposit = office === "기타"
                      ? officeSummary.otherDeposit
                      : officeSummary.measurementDeposit;
                    const unpaid = office === "기타"
                      ? officeSummary.otherUnpaid
                      : officeSummary.measurementUnpaid;

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

      {/* 년도별 미수금 집계 현황 */}
      {summary && (
        <Card className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-text-900">년도별 미수금 집계 현황</h2>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-text-700 whitespace-nowrap">년도 선택 :</label>
              <Select
                value={unpaidSummaryYear}
                onChange={(e) => setUnpaidSummaryYear(e.target.value)}
                options={[{ value: "", label: "전체" }, ...yearOptions]}
                className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-sky-100">
                  <TableHead rowSpan={2} className="text-center font-semibold py-3 px-3 text-black align-middle">구분</TableHead>
                  <TableHead colSpan={2} className="text-center font-semibold py-3 px-4 text-black">합계</TableHead>
                  <TableHead colSpan={2} className="text-center font-semibold py-3 px-4 text-black">측정비(사업장)</TableHead>
                  <TableHead colSpan={2} className="text-center font-semibold py-3 px-4 text-black">측정비(국고)</TableHead>
                </TableRow>
                <TableRow className="bg-sky-100">
                  <TableHead className="text-center font-semibold py-2 px-4 text-black">사업장 수</TableHead>
                  <TableHead className="text-center font-semibold py-2 px-4 text-black">미수금액</TableHead>
                  <TableHead className="text-center font-semibold py-2 px-4 text-black">사업장 수</TableHead>
                  <TableHead className="text-center font-semibold py-2 px-4 text-black">미수금액</TableHead>
                  <TableHead className="text-center font-semibold py-2 px-4 text-black">사업장 수</TableHead>
                  <TableHead className="text-center font-semibold py-2 px-4 text-black">미수금액</TableHead>
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
                    // 해당 관할지역의 측정비 데이터 필터링
                    const officeMeasurementData = measurementRevenue.filter((item) => {
                      if (office === "기타") {
                        // 기타는 other_revenue에서 처리하지 않고, 측정비에서 designated_office가 없는 경우만 처리
                        return !item.designated_office || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(item.designated_office);
                      }
                      return item.designated_office === office;
                    });

                    // 년도 필터링
                    const filteredData = unpaidSummaryYear && unpaidSummaryYear !== ""
                      ? officeMeasurementData.filter((item) => item.measurement_year === parseInt(unpaidSummaryYear))
                      : officeMeasurementData;

                    // 합계 계산
                    let totalBusinessCount = 0;
                    let totalUnpaidAmount = 0;
                    let businessSiteCount = 0;
                    let businessSiteUnpaid = 0;
                    let nationalCount = 0;
                    let nationalUnpaid = 0;

                    filteredData.forEach((item) => {
                      const businessFee = item.measurement_fee_business || 0;
                      const businessDeposit = item.deposit_amount_business || 0;
                      const nationalFee = item.measurement_fee_national || 0;
                      const nationalDeposit = item.deposit_amount_national || 0;

                      const businessUnpaid = businessFee - businessDeposit;
                      const nationalUnpaidAmount = nationalFee - nationalDeposit;
                      const itemTotalUnpaid = businessUnpaid + nationalUnpaidAmount;

                      // 합계
                      if (itemTotalUnpaid > 0) {
                        totalBusinessCount++;
                        totalUnpaidAmount += itemTotalUnpaid;
                      }

                      // 측정비(사업장)
                      if (businessUnpaid > 0) {
                        businessSiteCount++;
                        businessSiteUnpaid += businessUnpaid;
                      }

                      // 측정비(국고)
                      if (nationalUnpaidAmount > 0) {
                        nationalCount++;
                        nationalUnpaid += nationalUnpaidAmount;
                      }
                    });

                    return {
                      office,
                      label: officeLabels[office as keyof typeof officeLabels] || office,
                      total: {
                        count: totalBusinessCount,
                        unpaid: totalUnpaidAmount,
                      },
                      business: {
                        count: businessSiteCount,
                        unpaid: businessSiteUnpaid,
                      },
                      national: {
                        count: nationalCount,
                        unpaid: nationalUnpaid,
                      },
                    };
                  });

                  // 전체 합계 계산
                  const totalRow = unpaidData.reduce(
                    (acc, data) => ({
                      totalCount: acc.totalCount + data.total.count,
                      totalUnpaid: acc.totalUnpaid + data.total.unpaid,
                      businessCount: acc.businessCount + data.business.count,
                      businessUnpaid: acc.businessUnpaid + data.business.unpaid,
                      nationalCount: acc.nationalCount + data.national.count,
                      nationalUnpaid: acc.nationalUnpaid + data.national.unpaid,
                    }),
                    {
                      totalCount: 0,
                      totalUnpaid: 0,
                      businessCount: 0,
                      businessUnpaid: 0,
                      nationalCount: 0,
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
                    }> = [];

                    // 해당 관할지역의 측정비 데이터 필터링
                    const officeMeasurementData = measurementRevenue.filter((item) => {
                      if (!office) {
                        // 전체인 경우 모든 데이터
                        return true;
                      } else if (office === "기타") {
                        return !item.designated_office || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(item.designated_office);
                      } else {
                        return item.designated_office === office;
                      }
                    });

                    // 년도 필터링
                    const filteredData = unpaidSummaryYear && unpaidSummaryYear !== ""
                      ? officeMeasurementData.filter((item) => item.measurement_year === parseInt(unpaidSummaryYear))
                      : officeMeasurementData;

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
                      const nationalDeposit = item.deposit_amount_national || 0;

                      const businessUnpaid = businessFee - businessDeposit;
                      const nationalUnpaidAmount = nationalFee - nationalDeposit;
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
                      <TableRow className="border-t-2 border-b-2 border-gray-300">
                        <TableCell className="text-center font-bold text-black py-3 px-3">합계</TableCell>
                        <TableCell 
                          className="text-center font-bold text-black py-3 px-4 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleUnpaidBusinessClick(null, "total")}
                          title="클릭하여 사업장 목록 보기"
                        >
                          {totalRow.totalCount}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.totalUnpaid)}
                        </TableCell>
                        <TableCell 
                          className="text-center font-bold text-black py-3 px-4 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleUnpaidBusinessClick(null, "business")}
                          title="클릭하여 사업장 목록 보기"
                        >
                          {totalRow.businessCount}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.businessUnpaid)}
                        </TableCell>
                        <TableCell 
                          className="text-center font-bold text-black py-3 px-4 cursor-pointer hover:bg-gray-100"
                          onClick={() => handleUnpaidBusinessClick(null, "national")}
                          title="클릭하여 사업장 목록 보기"
                        >
                          {totalRow.nationalCount}
                        </TableCell>
                        <TableCell className="text-right font-bold text-black py-3 px-4">
                          {formatCurrency(totalRow.nationalUnpaid)}
                        </TableCell>
                      </TableRow>
                      {/* 각 관할지역 행 */}
                      {unpaidData.map((data, index) => (
                        <TableRow
                          key={data.office}
                          className={`border-b border-gray-200 ${data.office === "천안" ? "bg-green-50" : ""}`}
                        >
                          <TableCell className="text-center text-black py-2 px-3">{data.label}</TableCell>
                          <TableCell 
                            className="text-center text-black py-2 px-4 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleUnpaidBusinessClick(data.office, "total")}
                            title="클릭하여 사업장 목록 보기"
                          >
                            {data.total.count}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {formatCurrency(data.total.unpaid)}
                          </TableCell>
                          <TableCell 
                            className="text-center text-black py-2 px-4 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleUnpaidBusinessClick(data.office, "business")}
                            title="클릭하여 사업장 목록 보기"
                          >
                            {data.business.count}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {formatCurrency(data.business.unpaid)}
                          </TableCell>
                          <TableCell 
                            className="text-center text-black py-2 px-4 cursor-pointer hover:bg-gray-100"
                            onClick={() => handleUnpaidBusinessClick(data.office, "national")}
                            title="클릭하여 사업장 목록 보기"
                          >
                            {data.national.count}
                          </TableCell>
                          <TableCell className="text-right text-black py-2 px-4">
                            {formatCurrency(data.national.unpaid)}
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

      {/* 미수금 사업장 목록 모달 */}
      <Modal
        isOpen={isUnpaidBusinessModalOpen}
        onClose={() => setIsUnpaidBusinessModalOpen(false)}
        title={unpaidBusinessModalTitle}
        size="2xl"
      >
        <div className="overflow-y-auto">
          {unpaidBusinessList.length === 0 ? (
            <div className="py-8 text-center text-text-600 text-sm">
              사업장이 없습니다.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="bg-sky-100">
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">연번</TableHead>
                  <TableHead className="font-semibold py-1 px-2 text-black text-sm">사업장명</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">미수 횟수</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정년도</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정주기</TableHead>
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

      {/* 매출 집계 */}
      {summary && (
        <Card className="p-4">
          <h2 className="text-lg font-semibold text-text-900 mb-4">매출 집계</h2>
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
                {/* 측정비 집계 */}
                <TableRow>
                  <TableCell className="font-medium">측정비</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.measurementRevenue, 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right">0원</TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.measurementTotal, 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.measurementDeposit, 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right text-warning-600 font-semibold">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.measurementUnpaid, 0)
                    )}원
                  </TableCell>
                </TableRow>
                {/* 기타 집계 */}
                <TableRow>
                  <TableCell className="font-medium">기타</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.otherRevenue, 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.otherVat, 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.otherTotal, 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.otherDeposit, 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right text-warning-600 font-semibold">
                    {formatCurrency(
                      Object.values(summary.byOffice).reduce((sum, office) => sum + office.otherUnpaid, 0)
                    )}원
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* 매출 관리 탭 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold text-text-900 mb-4">매출 상세 현황</h2>
        <Tab
          items={[
            {
              id: "other",
              label: "기타",
              content: (() => {
                // 필터링 적용
                let filteredOther = otherRevenue.filter((item) => {
                  if (otherFilters.itemName && !item.item_name.toLowerCase().includes(otherFilters.itemName.toLowerCase())) return false;
                  if (otherFilters.year && item.revenue_year?.toString() !== otherFilters.year) return false;
                  if (otherFilters.period && item.revenue_period !== otherFilters.period) return false;
                  if (otherFilters.hasInvoiceDate === "yes" && !item.invoice_date) return false;
                  if (otherFilters.hasInvoiceDate === "no" && item.invoice_date) return false;
                  if (otherFilters.hasDepositDate === "yes" && !item.deposit_date) return false;
                  if (otherFilters.hasDepositDate === "no" && item.deposit_date) return false;
                  if (otherFilters.notes && (!item.notes || !item.notes.toLowerCase().includes(otherFilters.notes.toLowerCase()))) return false;
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
                    return <span className="text-text-400 text-xs ml-1">↕</span>;
                  }
                  return (
                    <span className="text-primary-600 text-xs ml-1">
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
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex gap-2 items-center">
                        <div className="text-sm text-text-600">
                          총 {filteredOther.length}건 (전체 {otherRevenue.length}건)
                        </div>
                        {selectedOtherIds.length > 0 && (
                          <Button
                            variant="secondary"
                            onClick={handleBulkDeleteOther}
                            disabled={isDeleting}
                          >
                            {isDeleting ? "삭제 중..." : `선택 삭제 (${selectedOtherIds.length})`}
                          </Button>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setOtherFilters({
                              itemName: "",
                              year: "",
                              period: "",
                              hasInvoiceDate: "",
                              hasDepositDate: "",
                              notes: "",
                            });
                            setOtherSort({ column: "total_amount", direction: "desc" });
                          }}
                        >
                          필터 초기화
                        </Button>
                        <Button variant="secondary" onClick={() => setIsUploadModalOpen(true)}>
                          Excel 업로드
                        </Button>
                        <Button variant="primary" onClick={() => handleOtherEdit(null)}>
                          기타 매출 등록
                        </Button>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
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
              id: "measurement",
              label: "측정비",
              content: (() => {
                // 필터링 적용
                let filteredMeasurement = measurementRevenue.filter((item) => {
                  if (measurementFilters.businessName && !item.business_name.toLowerCase().includes(measurementFilters.businessName.toLowerCase())) return false;
                  if (measurementFilters.year && item.measurement_year.toString() !== measurementFilters.year) return false;
                  if (measurementFilters.period && item.measurement_period !== measurementFilters.period) return false;
                  if (measurementFilters.designatedOffice && item.designated_office !== measurementFilters.designatedOffice) return false;
                  if (measurementFilters.hasInvoiceDate === "yes" && !item.electronic_invoice_date) return false;
                  if (measurementFilters.hasInvoiceDate === "no" && item.electronic_invoice_date) return false;
                  return true;
                });

                // 정렬 적용
                filteredMeasurement.sort((a, b) => {
                  let aValue: any = a[measurementSort.column as keyof MeasurementRevenue];
                  let bValue: any = b[measurementSort.column as keyof MeasurementRevenue];

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
                    return <span className="text-text-400 text-xs ml-1">↕</span>;
                  }
                  return (
                    <span className="text-primary-600 text-xs ml-1">
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
                    <div className="flex justify-between items-center mb-4">
                      <div className="text-sm text-text-600">
                        총 {filteredMeasurement.length}건 (전체 {measurementRevenue.length}건)
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setMeasurementFilters({
                            businessName: "",
                            year: "",
                            period: "",
                            designatedOffice: "",
                            hasInvoiceDate: "",
                          });
                          setMeasurementSort({ column: "measurement_fee_total", direction: "desc" });
                        }}
                      >
                        필터 초기화
                      </Button>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
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
                                <div className="text-sm font-medium">미수금액</div>
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
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredMeasurement.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={10} className="text-center text-text-500 py-8">
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
                                  <TableCell>{item.designated_office}</TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.measurement_fee_business)}원
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.measurement_fee_national)}원
                                  </TableCell>
                                  <TableCell className="text-right font-semibold">
                                    {formatCurrency(item.measurement_fee_total)}원
                                  </TableCell>
                                  <TableCell className="text-right">
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
                  if (unpaidFilters.name && !item.name.toLowerCase().includes(unpaidFilters.name.toLowerCase())) return false;
                  if (unpaidFilters.year && item.year.toString() !== unpaidFilters.year) return false;
                  if (unpaidFilters.period && item.period !== unpaidFilters.period) return false;
                  if (unpaidFilters.designatedOffice && item.designatedOffice !== unpaidFilters.designatedOffice) return false;
                  if (unpaidFilters.hasDepositDate === "yes" && !item.depositDate) return false;
                  if (unpaidFilters.hasDepositDate === "no" && item.depositDate) return false;
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
                    <div className="flex justify-between items-center mb-4">
                      <div className="text-sm text-text-600">
                        총 {filteredItems.length}건 (전체 {unpaidItems.length}건)
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setUnpaidFilters({
                            type: "",
                            name: "",
                            year: "",
                            period: "",
                            designatedOffice: "",
                            hasDepositDate: "",
                          });
                          setUnpaidSort({ column: "unpaid", direction: "desc" });
                        }}
                      >
                        필터 초기화
                      </Button>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
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
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredItems.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={9} className="text-center text-text-500 py-8">
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
                                        className={`px-2 py-1 rounded text-xs ${
                                          item.type === "measurement"
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
                                  </TableRow>
                                );
                              })}
                              <TableRow className="bg-surface-50">
                                <TableCell colSpan={6} className="text-right font-semibold">
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
          ]}
        />
      </Card>

      {/* 기타 매출 등록/수정 모달 */}
      <Modal
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
      </Modal>

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
    </div>
  );
};
