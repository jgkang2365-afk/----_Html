"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DESIGNATED_OFFICE_OPTIONS } from "@/lib/constants/designated-offices";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
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
import { toShortName } from "@/lib/constants/designated-offices";
import { ExcelUpload } from "@/components/features/ExcelUpload";

interface BusinessEntry {
  code: string;
  year: number;
  period: string;
  business_name: string;
  business_number: string | null;
  total_employees: number | null;
  address: string | null;
  office_jurisdiction: string | null;
  designated_office: string | null;
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  completion_status: string | null;
  plan_manager: string | null;
  future_measurement_date: string | null; // 향후측정예상일
  measurement_date: string | null; // 측정일 (예비조사의 측정일)
  previous_measurement_date: string | null; // 전회 측정일
  isRegistered: boolean; // 측정일지 등록 여부
  journal_id: number | null; // 등록된 측정일지 ID
  national_support_status: string | null; // '지원', '비대상' 또는 null
  manager_name: string | null;
  manager_mobile: string | null;
  manager_phone: string | null;
  notes: string | null;
  business_category: string | null; // 분류업종
  future_measurement_period: number | null; // 전회 향후측정주기 (개월)
  measurement_month: string | null; // 측정월
  management_status: string | null; // 관리 상태 ('transaction_ended' 등)
  unpaid_count: number;
  unpaid_details: any[];
}



export const BusinessManagement: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<BusinessEntry[]>([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState<BusinessEntry[]>([]);
  const [editingBusiness, setEditingBusiness] = useState<BusinessEntry | null>(null);
  const [editingValues, setEditingValues] = useState<Map<string, string>>(new Map());
  const [addressSortOrder, setAddressSortOrder] = useState<"asc" | "desc" | null>(null);
  const [isRegisteredSortOrder, setIsRegisteredSortOrder] = useState<"asc" | "desc" | null>(null);
  const [businessCategories, setBusinessCategories] = useState<{ value: string; label: string }[]>([]);

  // 필터 상태
  const [filters, setFilters] = useState({
    year: "",
    period: "",
    designatedOffice: "",
    address: "",
    businessName: "",
    isRegistered: "", // 전체, 등록됨, 미등록
    planManager: "전체",
    businessCategory: "",
    confirmedDate: "",
  });

  // 현재 선택된 년도/반기 (기본값: 현재 년도 상반기)
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const currentPeriod = currentMonth <= 6 ? "상반기" : "하반기";

  const [selectedYear, setSelectedYear] = useState<string>(currentYear.toString());
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentPeriod);

  // 모달 상태
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const [isExcelUploadModalOpen, setIsExcelUploadModalOpen] = useState(false);
  const [isUnpaidDetailModalOpen, setIsUnpaidDetailModalOpen] = useState(false);
  const [selectedUnpaidDetails, setSelectedUnpaidDetails] = useState<any[]>([]);
  const [selectedUnpaidBusinessName, setSelectedUnpaidBusinessName] = useState("");
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessEntry | null>(null);


  // 계획 생성 상태
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planGenerateError, setPlanGenerateError] = useState<string | null>(null);
  const [planGenerateSuccess, setPlanGenerateSuccess] = useState<string | null>(null);

  // 업체 추가 상태
  const [newBusiness, setNewBusiness] = useState({
    year: currentYear.toString(),
    period: currentPeriod,
    code: "",
    business_name: "",
    address: "",
    manager_name: "",
    manager_mobile: "",
    plan_manager: "",
    business_category: "",
    future_measurement_date: "",
    measurement_date: "",
    notes: ""
  });

  // 년도 옵션 (현재 년도 기준 -5년 ~ +1년)
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse();



  // 필터 적용
  const applyFilters = useCallback((data: BusinessEntry[], currentFilters: typeof filters, sortOrder?: "asc" | "desc" | null) => {
    let filtered = [...data];

    if (currentFilters.designatedOffice) {
      const normalizedOffice = toShortName(currentFilters.designatedOffice);
      filtered = filtered.filter((entry) => {
        const entryOffice = entry.designated_office ? toShortName(entry.designated_office) : "";
        return entryOffice === normalizedOffice;
      });
    }

    if (currentFilters.address) {
      filtered = filtered.filter((entry) => {
        if (!entry.address) return false;

        const address = entry.address.toLowerCase();
        const terms = currentFilters.address.split(",").map(term => term.trim().toLowerCase()).filter(term => term.length > 0);

        if (terms.length === 0) return true;

        // 하나라도 포함되면 true (OR 조건)
        return terms.some(term => address.includes(term));
      });
    }

    if (currentFilters.businessName) {
      filtered = filtered.filter((entry) =>
        entry.business_name?.toLowerCase().includes(currentFilters.businessName.toLowerCase())
      );
    }

    if (currentFilters.isRegistered === "실시") {
      filtered = filtered.filter((entry) => entry.isRegistered);
    } else if (currentFilters.isRegistered === "미실시") {
      filtered = filtered.filter((entry) => !entry.isRegistered && entry.management_status !== "transaction_ended");
    } else if (currentFilters.isRegistered === "거래종료") {
      filtered = filtered.filter((entry) => entry.management_status === "transaction_ended");
    }

    if (currentFilters.planManager && currentFilters.planManager !== "전체") {
      filtered = filtered.filter((entry) => entry.plan_manager === currentFilters.planManager);
    }

    // 기본 정렬: 측정예정월(오름차순) -> 소재지 관할청(오름차순)
    // 단, 주소 정렬이나 실시여부 정렬이 지정된 경우 해당 정렬 우선
    if (sortOrder !== undefined && sortOrder !== null) {
      filtered = filtered.sort((a, b) => {
        // 등록됨(true)이 미등록(false)보다 앞에 오도록 정렬
        if (sortOrder === "asc") {
          // 오름차순: 등록됨(true) -> 미등록(false)
          return a.isRegistered === b.isRegistered ? 0 : a.isRegistered ? -1 : 1;
        } else {
          // 내림차순: 미등록(false) -> 등록됨(true)
          return a.isRegistered === b.isRegistered ? 0 : a.isRegistered ? 1 : -1;
        }
      });
    } else if (addressSortOrder) {
      // 주소 정렬은 table rendering 부분에서 처리됨, 여기서는 기본 정렬 적용 안함 (UI에서 이미 처리중인 경우)
      // 하지만 addressSortOrder는 UI 상태값이고 여기서 실제 정렬을 수행하지 않으면 원본 순서가 됨.
      // Table 헤더에서 클릭 시 setFilteredBusinesses를 직접 호출하여 정렬하므로 여기서는 addressSortOrder 체크 불필요할 수도 있으나,
      // 필터가 변경될 때마다 재정렬이 필요하므로 여기서 처리하는게 좋음.
      // 현재 코드 구조상 Address 정렬은 Table 헤더 클릭 이벤트핸들러 안에서 즉시 setFilteredBusinesses를 호출함.
      // 따라서 필터 적용 시(useEffect)에는 주소 정렬 상태가 유지되지 않을 수 있음. 
      // 일단 사용자 요구사항인 "측정예정월(오름차순) 순, 소재지 관할청으로 필터(정렬)"을 기본으로 적용.

      filtered.sort((a, b) => {
        // 1. 측정예정월 (future_measurement_date) 오름차순
        const dateA = a.future_measurement_date ? new Date(a.future_measurement_date).getTime() : Infinity;
        const dateB = b.future_measurement_date ? new Date(b.future_measurement_date).getTime() : Infinity;

        if (dateA !== dateB) {
          return dateA - dateB;
        }

        // 2. 소재지 관할청 (office_jurisdiction) 오름차순
        const officeA = a.office_jurisdiction || "";
        const officeB = b.office_jurisdiction || "";
        return officeA.localeCompare(officeB);
      });
    } else {
      // 기본 정렬 적용
      filtered.sort((a, b) => {
        // 1. 측정예정월 (future_measurement_date) 오름차순
        // 날짜가 없는 경우 뒤로 보냄
        const dateA = a.future_measurement_date ? new Date(a.future_measurement_date).getTime() : 9999999999999;
        const dateB = b.future_measurement_date ? new Date(b.future_measurement_date).getTime() : 9999999999999;

        if (dateA !== dateB) {
          return dateA - dateB;
        }

        // 2. 소재지 관할청 (office_jurisdiction) 오름차순
        const officeA = a.office_jurisdiction || "";
        const officeB = b.office_jurisdiction || "";
        return officeA.localeCompare(officeB);
      });
    }

    setFilteredBusinesses(filtered);
  }, [addressSortOrder]);

  // 측정 대상 사업장 목록 로드
  const loadBusinesses = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.append("year", selectedYear);
      params.append("period", selectedPeriod);
      if (filters.designatedOffice) {
        params.append("designatedOffice", filters.designatedOffice);
      }
      if (filters.address) {
        params.append("address", filters.address);
      }
      if (filters.businessName) {
        params.append("businessName", filters.businessName);
      }
      if (filters.isRegistered) {
        params.append("isRegistered", filters.isRegistered);
      }
      if (filters.businessCategory) {
        params.append("businessCategory", filters.businessCategory);
      }
      if (filters.confirmedDate) {
        params.append("confirmedDate", filters.confirmedDate);
      }

      const url = `/api/businesses?${params.toString()}`;
      console.log("[측정 대상 사업장] API 호출:", url);
      const response = await fetch(url);
      console.log("[측정 대상 사업장] API 응답 상태:", response.status);

      const contentType = response.headers.get("content-type");
      let data;
      if (contentType && contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        console.error("[측정 대상 사업장] API 응답이 JSON이 아닙니다:", text.substring(0, 200));
        throw new Error(`서버 응답 오류 (${response.status}): ${text.substring(0, 100)}...`);
      }

      console.log("[측정 대상 사업장] API 응답 데이터:", data);

      if (response.ok) {
        setBusinesses(data.businesses || []);
        applyFilters(data.businesses || [], filters);
      } else {
        setError(data.error || "측정 대상 사업장 목록을 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("측정 대상 사업장 로드 오류:", err);
      setError(err.message || "측정 대상 사업장 목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedPeriod, filters, applyFilters]);

  // 계획 생성
  const generatePlan = async () => {
    if (!selectedYear || !selectedPeriod) {
      setPlanGenerateError("측정년도와 측정주기를 선택해주세요.");
      return;
    }

    setGeneratingPlan(true);
    setPlanGenerateError(null);
    setPlanGenerateSuccess(null);

    try {
      const response = await fetch("/api/businesses/generate-plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          year: parseInt(selectedYear),
          period: selectedPeriod,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setPlanGenerateSuccess(`${data.count || 0}개의 측정 대상 사업장 계획이 생성되었습니다.`);
        // 계획 생성 후 목록 새로고침
        setTimeout(async () => {
          await loadBusinesses();
        }, 500);
      } else {
        setPlanGenerateError(data.error || "계획 생성 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("계획 생성 오류:", err);
      setPlanGenerateError(err.message || "계획 생성 중 오류가 발생했습니다.");
    } finally {
      setGeneratingPlan(false);
    }
  };

  // 업체 직접 추가
  const handleAddBusiness = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/businesses/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...newBusiness,
          year: parseInt(newBusiness.year),
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("업체가 성공적으로 추가되었습니다.");
        setIsAddModalOpen(false);
        setNewBusiness({
          year: selectedYear,
          period: selectedPeriod,
          code: "",
          business_name: "",
          address: "",
          manager_name: "",
          manager_mobile: "",
          plan_manager: "",
          business_category: "",
          future_measurement_date: "",
          measurement_date: "",
          notes: ""
        });
        loadBusinesses();
      } else {
        alert(data.error || "업체 추가 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error(err);
      alert("업체 추가 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };



  // 필드 업데이트 (금회예정일, 확정일, 업종분류, 비고 등)
  const updateBusinessField = async (code: string, year: number, period: string, field: string, value: string | null) => {
    try {
      const response = await fetch("/api/businesses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          year,
          period,
          updates: { [field]: value || null }
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Update failed");
      }

      // 로컬 데이터 업데이트
      setBusinesses((prev) =>
        prev.map((b) => {
          if (b.code === code && b.year === year && b.period === period) {
            return { ...b, [field]: value };
          }
          return b;
        })
      );

      return true;
    } catch (err: any) {
      console.error(err);
      alert(`저장 중 오류가 발생했습니다: ${err.message}`);
      return false;
    }
  };

  const handleFieldChange = (entryKey: string, field: string, value: string) => {
    const key = `${entryKey}-${field}`;
    const newMap = new Map(editingValues);
    newMap.set(key, value);
    setEditingValues(newMap);
  };

  const handleFieldBlur = async (entry: BusinessEntry, field: string) => {
    const entryKey = `${entry.code}-${entry.year}-${entry.period}`;
    const key = `${entryKey}-${field}`;
    const value = editingValues.get(key);

    // 변경된 값이 있을 때만 API 호출
    if (value !== undefined) {
      const success = await updateBusinessField(entry.code, entry.year, entry.period, field, value);
      if (success) {
        // 성공 시 편집 상태 제거하여 원본 데이터 표시 (원본 데이터가 위에서 이미 업데이트됨)
        const newMap = new Map(editingValues);
        newMap.delete(key);
        setEditingValues(newMap);
      }
    }
  };

  const handleUpdateBusiness = async () => {
    if (!editingBusiness) return;
    setLoading(true);
    try {
      const { code, year, period, ...updates } = editingBusiness;
      // API에서 허용하는 필드만 추출
      const allowedUpdateData = {
        business_name: editingBusiness.business_name,
        address: editingBusiness.address,
        manager_name: editingBusiness.manager_name,
        manager_mobile: editingBusiness.manager_mobile,
        plan_manager: editingBusiness.plan_manager,
        business_category: editingBusiness.business_category,
        future_measurement_date: editingBusiness.future_measurement_date,
        measurement_date: editingBusiness.measurement_date,
        notes: editingBusiness.notes
      };

      const response = await fetch("/api/businesses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          year,
          period,
          updates: allowedUpdateData
        }),
      });

      if (!response.ok) throw new Error("Update failed");

      // 로컬 데이터 업데이트
      setBusinesses((prev) =>
        prev.map((b) => {
          if (b.code === code && b.year === year && b.period === period) {
            return { ...b, ...allowedUpdateData };
          }
          return b;
        })
      );

      setIsEditModalOpen(false);
      setEditingBusiness(null);
      alert("성공적으로 수정되었습니다.");
    } catch (err) {
      console.error(err);
      alert("수정 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 상태 변경
  const handleStatusChange = async (code: string, year: number, period: string, newStatus: string) => {
    const statusValue = newStatus === "auto" ? null : newStatus;

    try {
      const response = await fetch("/api/businesses/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, year, period, status: statusValue }),
      });

      if (!response.ok) throw new Error("Status update failed");

      // 상태 업데이트
      setBusinesses((prev) =>
        prev.map((b) => {
          if (b.code === code && b.year === year && b.period === period) {
            return { ...b, management_status: statusValue };
          }
          return b;
        })
      );
    } catch (err) {
      console.error(err);
      alert("상태 변경 중 오류가 발생했습니다.");
      loadBusinesses(); // 실패 시 새로고침
    }
  };

  // 업종분류 목록 조회
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
          setBusinessCategories(categories);
        }
      } catch (err) {
        console.error("업종분류 목록 조회 오류:", err);
      }
    };
    fetchBusinessCategories();
  }, []);

  // 엑셀 다운로드
  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedYear) params.append("year", selectedYear);
      if (selectedPeriod) params.append("period", selectedPeriod);

      const response = await fetch(`/api/export/businesses?${params.toString()}`);

      if (!response.ok) {
        throw new Error("엑셀 다운로드 실패");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const fileName = `측정대상사업장목록_${selectedYear}_${selectedPeriod}_${new Date().toISOString().split("T")[0]}.xlsx`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error("엑셀 다운로드 오류:", err);
      alert("엑셀 다운로드 중 오류가 발생했습니다: " + (err.message || "알 수 없는 오류"));
    }
  };

  // 년도/반기 변경 시 데이터 재로드
  useEffect(() => {
    if (selectedYear && selectedPeriod) {
      loadBusinesses();
    }
  }, [selectedYear, selectedPeriod, loadBusinesses]);

  // 필터 변경 시 필터링만 적용 (데이터 재로드 없음)
  useEffect(() => {
    if (businesses.length > 0) {
      applyFilters(businesses, filters, isRegisteredSortOrder);
    }
  }, [businesses, filters, isRegisteredSortOrder, applyFilters]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("ko-KR");
    } catch {
      return dateString;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-text-900">측정 대상 사업장 관리</h1>
        <Button
          onClick={generatePlan}
          disabled={generatingPlan}
          className="bg-green-500 hover:bg-green-600 text-white shadow-sm"
        >
          {generatingPlan ? "계획 생성 중..." : "계획 생성"}
        </Button>
      </div>

      {/* 년도/반기 선택 및 필터 */}
      <Card className="p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div className="flex-1 min-w-[120px]">
            <Input
              label="측정년도"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadBusinesses();
                }
              }}
              placeholder="예: 2024, 2025"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <Input
              label="측정주기"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadBusinesses();
                }
              }}
              placeholder="예: 상반기, 하반기"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Input
              label="지정지청"
              value={filters.designatedOffice}
              onChange={(e) => setFilters({ ...filters, designatedOffice: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadBusinesses();
                }
              }}
              placeholder="예: 대전, 천안"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Select
              label="업종분류"
              value={filters.businessCategory}
              onChange={(e) => setFilters({ ...filters, businessCategory: e.target.value })}
              options={[{ value: "", label: "전체" }, ...businessCategories]}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Input
              label="사업장명 검색"
              value={filters.businessName}
              onChange={(e) => setFilters({ ...filters, businessName: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadBusinesses();
                }
              }}
              placeholder="예: 사업장A, 사업장B"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Input
              label="주소 검색"
              value={filters.address}
              onChange={(e) => setFilters({ ...filters, address: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadBusinesses();
                }
              }}
              placeholder="예: 서울, 경기"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <Select
              label="실시여부"
              value={filters.isRegistered}
              onChange={(e) => setFilters({ ...filters, isRegistered: e.target.value })}
              options={[
                { value: "", label: "전체" },
                { value: "실시", label: "실시" },
                { value: "미실시", label: "미실시" },
                { value: "거래종료", label: "거래종료" },
              ]}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Input
              label="확정일"
              type="date"
              value={filters.confirmedDate}
              onChange={(e) => setFilters({ ...filters, confirmedDate: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  loadBusinesses();
                }
              }}
            />
          </div>
          <Button
            variant="primary"
            onClick={loadBusinesses}
            className="shadow-sm"
          >
            검색
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setNewBusiness(prev => ({
                ...prev,
                plan_manager: filters.planManager !== "전체" ? filters.planManager : ""
              }));
              setIsAddModalOpen(true);
            }}
            className="shadow-sm"
          >
            업체 추가
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsExcelUploadModalOpen(true)}
            className="shadow-sm"
          >
            측정 대상 사업장 엑셀 업로드
          </Button>
        </div>
      </Card>

      {/* 오류 메시지 */}
      {error && <Alert variant="error">{error}</Alert>}

      {/* 계획 생성 성공/오류 메시지 */}
      {planGenerateSuccess && (
        <Alert variant="success">
          {planGenerateSuccess}
        </Alert>
      )}
      {planGenerateError && (
        <Alert variant="error">
          {planGenerateError}
        </Alert>
      )}

      {/* 목록 */}
      <Card className="p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-text-900">
            측정 대상 사업장 목록 ({filteredBusinesses.length}건)
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 mr-2 bg-surface-50 px-3 py-1 rounded-md border border-surface-200">
              <span className="text-base font-bold text-blue-600 whitespace-nowrap">계획담당자</span>
              <div className="w-[100px]">
                <select
                  value={filters.planManager}
                  onChange={(e) => setFilters({ ...filters, planManager: e.target.value })}
                  className="w-full h-8 text-base border-gray-300 rounded-md shadow-sm focus:border-primary-500 focus:ring-primary-500 bg-white"
                >
                  <option value="전체">전체</option>
                  <option value="한기문">한기문</option>
                  <option value="이주형">이주형</option>
                  <option value="강종구">강종구</option>
                  <option value="고유빈">고유빈</option>
                </select>
              </div>
            </div>
            <Button variant="secondary" onClick={handleExportExcel}>
              엑셀 다운로드
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : filteredBusinesses.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-500 text-lg">측정 대상 사업장이 없습니다.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-surface-200 overflow-hidden">
            <div className="relative max-h-[calc(100vh-400px)] overflow-auto">
              <table className="w-full caption-bottom text-base border-collapse">
                <thead className="bg-surface-50 sticky top-0 z-20 shadow-sm">
                  <tr className="border-b border-slate-100">
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[80px]">No</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[70px]">주기</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[80px]">계획진행</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[80px]">국고</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[90px]">계획담당</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[120px]">업종분류</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 text-sm max-w-[150px]">사업장명</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[90px]">전회측정일</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[90px]">전회 측정 주기</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[90px]">금회예정일</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[80px]">측정예정월</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[100px]">금회측정확정일</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm min-w-[200px] max-w-[300px]">
                      <div className="flex items-center justify-between">
                        <span>주소</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (addressSortOrder === "asc") {
                              setAddressSortOrder("desc");
                              const sorted = [...filteredBusinesses].sort((a, b) => {
                                const addrA = a.address || "";
                                const addrB = b.address || "";
                                return addrB.localeCompare(addrA);
                              });
                              setFilteredBusinesses(sorted);
                            } else if (addressSortOrder === "desc") {
                              setAddressSortOrder(null);
                            } else {
                              setAddressSortOrder("asc");
                              const sorted = [...filteredBusinesses].sort((a, b) => {
                                const addrA = a.address || "";
                                const addrB = b.address || "";
                                return addrA.localeCompare(addrB);
                              });
                              setFilteredBusinesses(sorted);
                            }
                          }}
                          className="text-xs text-text-500 hover:text-text-700 px-1.5 py-0.5 rounded hover:bg-surface-100 transition-colors"
                          title={addressSortOrder === "asc" ? "오름차순" : addressSortOrder === "desc" ? "내림차순" : "정렬"}
                        >
                          {addressSortOrder === "asc" ? "↑" : addressSortOrder === "desc" ? "↓" : "⇅"}
                        </button>
                      </div>
                    </th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[100px]">소재지 관할청</th>
                    <th className="bg-surface-50 h-12 px-2 text-center align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[60px]">미수횟수</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[80px]">담당자명</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[110px]">담당자 휴대폰</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[110px]">회사전화번호</th>
                    <th className="bg-surface-50 h-12 px-2 text-left align-middle font-bold text-slate-800 text-sm max-w-[150px]">비고</th>
                    <th className="bg-surface-50 h-12 px-2 text-center align-middle font-bold text-slate-800 whitespace-nowrap text-sm w-[60px]">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBusinesses.map((entry, index) => {
                    const entryKey = `${entry.code}-${entry.year}-${entry.period}`;

                    // 상태에 따른 스타일 및 값 계산
                    const currentStatus = entry.management_status === "transaction_ended"
                      ? "transaction_ended"
                      : "auto";

                    let statusColorClass = "";
                    if (currentStatus === "transaction_ended") {
                      statusColorClass = "bg-red-100 text-red-800 border-red-200";
                    } else if (entry.isRegistered) {
                      statusColorClass = "bg-green-100 text-green-800 border-green-200";
                    } else {
                      statusColorClass = "bg-yellow-100 text-yellow-800 border-yellow-200";
                    }

                    return (
                      <tr key={entryKey} className="border-b border-slate-100 transition-colors hover:bg-surface-50 text-sm">
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap font-medium">
                          {entry.code}
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">
                          {entry.period}
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">
                          <div className="w-[80px]">
                            <select
                              value={currentStatus}
                              onChange={(e) => handleStatusChange(entry.code, entry.year, entry.period, e.target.value)}
                              className={`w-full px-1 py-1 text-xs font-semibold rounded border appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 ${statusColorClass}`}
                              style={{ textAlignLast: "center" }}
                            >
                              <option value="auto">
                                {entry.isRegistered ? "실시" : "미실시"}
                              </option>
                              <option value="transaction_ended" className="bg-white text-red-600">
                                거래종료
                              </option>
                            </select>
                          </div>
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">
                          {entry.national_support_status ? (
                            <span className="text-text-700 text-sm">{entry.national_support_status}</span>
                          ) : (
                            <span className="text-text-400 text-sm">-</span>
                          )}
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{entry.plan_manager || "-"}</td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">
                          <select
                            value={editingValues.get(`${entryKey}-business_category`) ?? entry.business_category ?? ""}
                            onChange={(e) => handleFieldChange(entryKey, "business_category", e.target.value)}
                            onBlur={() => handleFieldBlur(entry, "business_category")}
                            className="w-[110px] px-1 py-0.5 text-xs border border-transparent hover:border-slate-200 rounded focus:border-primary-500 focus:outline-none bg-transparent focus:bg-white transition-all appearance-none cursor-pointer text-ellipsis overflow-hidden"
                          >
                            <option value="">-</option>
                            {businessCategories.map((cat) => (
                              <option key={cat.value} value={cat.value}>
                                {cat.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 align-middle text-slate-600 font-medium max-w-[150px] whitespace-normal break-words leading-tight">{entry.business_name}</td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{formatDate(entry.previous_measurement_date)}</td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">
                          {entry.future_measurement_period ? `${entry.future_measurement_period}개월` : "-"}
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{formatDate(entry.future_measurement_date)}</td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">
                          {entry.future_measurement_date
                            ? `${new Date(entry.future_measurement_date).getMonth() + 1}월`
                            : "-"}
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{formatDate(entry.measurement_date)}</td>
                        <td className="p-2 align-middle text-slate-600 min-w-[200px] max-w-[300px] whitespace-normal break-words leading-tight">
                          {entry.address || "-"}
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{entry.office_jurisdiction || "-"}</td>
                        <td className="p-2 align-middle text-center font-medium">
                          {entry.unpaid_count && entry.unpaid_count > 0 ? (
                            <span
                              className="text-red-600 font-bold cursor-pointer hover:underline"
                              onClick={() => {
                                setSelectedUnpaidBusinessName(entry.business_name);
                                setSelectedUnpaidDetails(entry.unpaid_details || []);
                                setIsUnpaidDetailModalOpen(true);
                              }}
                            >
                              {entry.unpaid_count}회
                            </span>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{entry.manager_name || "-"}</td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{entry.manager_mobile || "-"}</td>
                        <td className="p-2 align-middle text-slate-600 whitespace-nowrap">{entry.manager_phone || "-"}</td>
                        <td className="p-2 align-middle text-slate-600 max-w-[150px] whitespace-normal break-words leading-tight">
                          <input
                            value={editingValues.get(`${entryKey}-notes`) ?? entry.notes ?? ""}
                            onChange={(e) => handleFieldChange(entryKey, "notes", e.target.value)}
                            onBlur={() => handleFieldBlur(entry, "notes")}
                            placeholder="..."
                            className="w-full px-1 py-0.5 text-xs border border-transparent hover:border-slate-200 rounded focus:border-primary-500 focus:outline-none bg-transparent focus:bg-white transition-all"
                          />
                        </td>
                        <td className="p-2 align-middle text-center whitespace-nowrap">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditingBusiness({ ...entry });
                              setIsEditModalOpen(true);
                            }}
                            className="h-7 px-2 text-xs"
                          >
                            수정
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* 업체 추가 모달 */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setNewBusiness({
            year: selectedYear,
            period: selectedPeriod,
            code: "",
            business_name: "",
            address: "",
            manager_name: "",
            manager_mobile: "",
            plan_manager: filters.planManager !== "전체" ? filters.planManager : "",
            business_category: "",
            future_measurement_date: "",
            measurement_date: "",
            notes: ""
          });
        }}
        title="업체 추가"
        size="xl"
      >
        <div className="space-y-6">
          <div className="grid grid-cols-4 gap-4">
            <Select
              label="측정년도"
              value={newBusiness.year}
              onChange={(e) => setNewBusiness({ ...newBusiness, year: e.target.value })}
              options={yearOptions}
            />
            <Select
              label="측정주기"
              value={newBusiness.period}
              onChange={(e) => setNewBusiness({ ...newBusiness, period: e.target.value })}
              options={[
                { value: "상반기", label: "상반기" },
                { value: "하반기", label: "하반기" },
              ]}
            />
            <Input
              label="코드"
              value={newBusiness.code}
              onFocus={(e) => {
                if (!newBusiness.code) {
                  setNewBusiness({ ...newBusiness, code: "H" });
                }
              }}
              onChange={(e) => {
                let val = e.target.value;
                if (val && !val.startsWith("H")) {
                  val = "H" + val;
                }
                setNewBusiness({ ...newBusiness, code: val });
              }}
              placeholder="예: H1234"
            />
            <Input
              label="계획담당자"
              value={newBusiness.plan_manager}
              onChange={(e) => setNewBusiness({ ...newBusiness, plan_manager: e.target.value })}
              placeholder="계획담당자"
            />
          </div>

          <div className="grid grid-cols-4 gap-4">
            <Input
              label="금회예정일"
              type="date"
              value={newBusiness.future_measurement_date}
              onChange={(e) => setNewBusiness({ ...newBusiness, future_measurement_date: e.target.value })}
            />
            <Input
              label="금회측정확정일"
              type="date"
              value={newBusiness.measurement_date}
              onChange={(e) => setNewBusiness({ ...newBusiness, measurement_date: e.target.value })}
            />
            <Select
              label="업종분류"
              value={newBusiness.business_category}
              onChange={(e) => setNewBusiness({ ...newBusiness, business_category: e.target.value })}
              options={[{ value: "", label: "선택" }, ...businessCategories]}
            />
            <Input
              label="사업장명"
              value={newBusiness.business_name}
              onChange={(e) => setNewBusiness({ ...newBusiness, business_name: e.target.value })}
              placeholder="사업장명"
            />
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-2">
              <Input
                label="주소"
                value={newBusiness.address}
                onChange={(e) => setNewBusiness({ ...newBusiness, address: e.target.value })}
                placeholder="주소 입력"
              />
            </div>
            <Input
              label="담당자명"
              value={newBusiness.manager_name}
              onChange={(e) => setNewBusiness({ ...newBusiness, manager_name: e.target.value })}
              placeholder="담당자명"
            />
            <Input
              label="담당자 연락처"
              value={newBusiness.manager_mobile}
              onChange={(e) => setNewBusiness({ ...newBusiness, manager_mobile: e.target.value })}
              placeholder="010-0000-0000"
            />
          </div>

          <div className="grid grid-cols-4 gap-4">
            <div className="col-span-4">
              <Input
                label="비고"
                value={newBusiness.notes}
                onChange={(e) => setNewBusiness({ ...newBusiness, notes: e.target.value })}
                placeholder="비고 입력"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
              취소
            </Button>
            <Button variant="primary" onClick={handleAddBusiness} disabled={loading}>
              {loading ? "추가 중..." : "업체 추가"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 업체 수정 모달 */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingBusiness(null);
        }}
        title="업체 정보 수정"
        size="xl"
      >
        <div className="space-y-6">
          {editingBusiness && (
            <>
              <div className="grid grid-cols-4 gap-4">
                <Input
                  label="측정년도"
                  value={editingBusiness.year.toString()}
                  disabled
                  className="bg-slate-50"
                />
                <Input
                  label="측정주기"
                  value={editingBusiness.period}
                  disabled
                  className="bg-slate-50"
                />
                <Input
                  label="코드"
                  value={editingBusiness.code}
                  disabled
                  className="bg-slate-50"
                />
                <Input
                  label="계획담당자"
                  value={editingBusiness.plan_manager || ""}
                  onChange={(e) => setEditingBusiness({ ...editingBusiness, plan_manager: e.target.value })}
                  placeholder="계획담당자"
                />
              </div>

              <div className="grid grid-cols-4 gap-4">
                <Input
                  label="금회예정일"
                  type="date"
                  value={editingBusiness.future_measurement_date || ""}
                  onChange={(e) => setEditingBusiness({ ...editingBusiness, future_measurement_date: e.target.value })}
                />
                <Input
                  label="금회측정확정일"
                  type="date"
                  value={editingBusiness.measurement_date || ""}
                  onChange={(e) => setEditingBusiness({ ...editingBusiness, measurement_date: e.target.value })}
                />
                <Select
                  label="업종분류"
                  value={editingBusiness.business_category || ""}
                  onChange={(e) => setEditingBusiness({ ...editingBusiness, business_category: e.target.value })}
                  options={[{ value: "", label: "선택" }, ...businessCategories]}
                />
                <Input
                  label="사업장명"
                  value={editingBusiness.business_name || ""}
                  onChange={(e) => setEditingBusiness({ ...editingBusiness, business_name: e.target.value })}
                  placeholder="사업장명"
                />
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-2">
                  <Input
                    label="주소"
                    value={editingBusiness.address || ""}
                    onChange={(e) => setEditingBusiness({ ...editingBusiness, address: e.target.value })}
                    placeholder="주소 입력"
                  />
                </div>
                <Input
                  label="담당자명"
                  value={editingBusiness.manager_name || ""}
                  onChange={(e) => setEditingBusiness({ ...editingBusiness, manager_name: e.target.value })}
                  placeholder="담당자명"
                />
                <Input
                  label="담당자 연락처"
                  value={editingBusiness.manager_mobile || ""}
                  onChange={(e) => setEditingBusiness({ ...editingBusiness, manager_mobile: e.target.value })}
                  placeholder="010-0000-0000"
                />
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-4">
                  <Input
                    label="비고"
                    value={editingBusiness.notes || ""}
                    onChange={(e) => setEditingBusiness({ ...editingBusiness, notes: e.target.value })}
                    placeholder="비고 입력"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <Button variant="secondary" onClick={() => setIsEditModalOpen(false)}>
                  취소
                </Button>
                <Button variant="primary" onClick={handleUpdateBusiness} disabled={loading}>
                  {loading ? "저장 중..." : "변경 내용 저장"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* 건강디딤돌 신청결과 업로드 모달 */}


      <Modal
        isOpen={isExcelUploadModalOpen}
        onClose={() => setIsExcelUploadModalOpen(false)}
        title="측정 대상 사업장 엑셀 업로드"
        size="lg"
      >
        <div className="space-y-4">
          <ExcelUpload
            fixedFileType="measurement-business"
            hideAutoSync={true}
            defaultAutoSync={true}
            onSuccess={() => {
              // 업로드 성공 시 약간의 지연 후 목록 새로고침
              setTimeout(() => {
                loadBusinesses();
              }, 1000);
            }}
          />
          <div className="flex justify-end pt-4">
            <Button variant="secondary" onClick={() => setIsExcelUploadModalOpen(false)}>
              닫기
            </Button>
          </div>
        </div>
      </Modal>

      {/* 미수 상세 내역 모달 */}
      <Modal
        isOpen={isUnpaidDetailModalOpen}
        onClose={() => setIsUnpaidDetailModalOpen(false)}
        title={`${selectedUnpaidBusinessName} 미수 내역`}
        size="lg"
      >
        <div className="space-y-4">
          <div className="bg-red-50 p-4 rounded-lg flex justify-between items-center text-red-700 mb-4 border border-red-100">
            <span className="font-medium">총 미수금액</span>
            <span className="text-lg font-bold">
              {new Intl.NumberFormat("ko-KR").format(
                selectedUnpaidDetails.reduce((sum, item) => sum + item.amount, 0)
              )}원
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">측정년도</th>
                  <th className="px-4 py-3">측정주기</th>
                  <th className="px-4 py-3 text-right">매출금액</th>
                  <th className="px-4 py-3 text-right">입금액</th>
                  <th className="px-4 py-3 text-right">미수금액</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {selectedUnpaidDetails.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      미수 내역이 없습니다.
                    </td>
                  </tr>
                ) : (
                  selectedUnpaidDetails.map((detail: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-4 py-3">{detail.year}년</td>
                      <td className="px-4 py-3">{detail.period}</td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {new Intl.NumberFormat("ko-KR").format(detail.total || 0)}원
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">
                        {new Intl.NumberFormat("ko-KR").format(detail.deposit || 0)}원
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-red-600">
                        {new Intl.NumberFormat("ko-KR").format(detail.amount || 0)}원
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pt-4">
            <Button variant="secondary" onClick={() => setIsUnpaidDetailModalOpen(false)}>
              닫기
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
