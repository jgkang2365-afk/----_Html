"use client";

import React, { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { DESIGNATED_OFFICE_OPTIONS, toShortName } from "@/lib/constants/designated-offices";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Alert } from "@/components/ui/Alert";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/Table";

// 금액 포맷팅 헬퍼
const formatCurrency = (value: any): string => {
  if (value === null || value === undefined || value === "") return "0";
  const num = Number(value);
  return isNaN(num) ? "0" : num.toLocaleString("ko-KR");
};

// 가용 컬럼 정보 구조
interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
}

// 동적 필터 조건 구조
interface FilterRule {
  id: string;
  field: string;
  operator: string;
  value: string;
}

// 로컬스토리지 저장 템플릿 구조
interface ReportTemplate {
  name: string;
  filters: FilterRule[];
  columns: ColumnConfig[];
}

export const CustomQueryExport: React.FC = () => {
  // 1차 조회용 대분류 필터 (년도/주기)
  const currentYear = new Date().getFullYear();
  const [loadYear, setLoadYear] = useState<string>("");
  const [loadPeriod, setLoadPeriod] = useState<string>("");

  // 상태 관리
  const [rawData, setRawData] = useState<any[]>([]);
  const [filteredResults, setFilteredResults] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // 동적 필터 조건 상태
  const [filters, setFilters] = useState<FilterRule[]>([]);
  const [draggedFilterIndex, setDraggedFilterIndex] = useState<number | null>(null);
  const [draggedColumnIndex, setDraggedColumnIndex] = useState<number | null>(null);

  // 템플릿 상태
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [newTemplateName, setNewTemplateName] = useState<string>("");
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>("");

  // 컬럼 구성 상태 (순서 및 여부)
  const [columns, setColumns] = useState<ColumnConfig[]>([
    { key: "code", label: "사업장코드", visible: true },
    { key: "business_name", label: "사업장명", visible: true },
    { key: "measurement_year", label: "측정년도", visible: true },
    { key: "measurement_period", label: "측정주기", visible: true },
    { key: "designated_office", label: "지정지청", visible: true },
    { key: "office_jurisdiction", label: "관할지청", visible: true },
    { key: "national_support_status", label: "국고지원여부", visible: true },
    { key: "measurement_fee_business", label: "사업장부담금(자부담)", visible: true },
    { key: "measurement_fee_national", label: "국고지원금", visible: true },
    { key: "measurement_fee_total", label: "총 측정비", visible: true },
    { key: "representative_name", label: "대표자명", visible: false },
    { key: "manager_name", label: "담당자명", visible: false },
    { key: "manager_mobile", label: "담당자휴대폰", visible: false },
    { key: "manager_email", label: "담당자이메일", visible: false },
    { key: "electronic_invoice_date", label: "계산서발행일", visible: false },
    { key: "measurement_start_date", label: "측정시작일", visible: false },
    { key: "measurement_end_date", label: "측정종료일", visible: false },
    { key: "preliminary_surveyor", label: "예비조사원", visible: false },
    { key: "plan_manager", label: "계획담당자", visible: false },
    { key: "actual_measurer", label: "실제측정자", visible: false },
    { key: "report_writer", label: "보고서작성자", visible: false },
    { key: "measurer", label: "측정자", visible: false },
    { key: "k2b_send_date", label: "K2B전송일", visible: false },
    { key: "note", label: "측정일지 비고", visible: false },
    { key: "special_notes", label: "특이사항", visible: false },
  ]);

  // 필터 대상 필드 스펙
  const FILTER_FIELDS = [
    { key: "code", label: "사업장코드", type: "string" },
    { key: "business_name", label: "사업장명", type: "string" },
    { key: "measurement_year", label: "측정년도", type: "number" },
    { key: "measurement_period", label: "측정주기", type: "string" },
    { key: "designated_office", label: "지정지청", type: "string" },
    { key: "office_jurisdiction", label: "관할지청", type: "string" },
    { key: "national_support_status", label: "국고지원여부", type: "string" },
    { key: "representative_name", label: "대표자명", type: "string" },
    { key: "manager_name", label: "담당자명", type: "string" },
    { key: "preliminary_surveyor", label: "예비조사원", type: "string" },
    { key: "plan_manager", label: "계획담당자", type: "string" },
    { key: "actual_measurer", label: "실제측정자", type: "string" },
    { key: "report_writer", label: "보고서작성자", type: "string" },
    { key: "measurer", label: "측정자", type: "string" },
    { key: "note", label: "측정일지 비고", type: "string" },
    { key: "special_notes", label: "특이사항", type: "string" },
    { key: "electronic_invoice_date", label: "계산서발행일", type: "date" },
    { key: "measurement_start_date", label: "측정시작일", type: "date" },
    { key: "k2b_send_date", label: "K2B전송일", type: "date" },
    { key: "measurement_fee_business", label: "사업장부담금", type: "number" },
    { key: "measurement_fee_national", label: "국고지원금", type: "number" },
    { key: "measurement_fee_total", label: "총 측정비", type: "number" },
  ];

  // 필터 비교 연산자
  const FILTER_OPERATORS = [
    { value: "contains", label: "포함" },
    { value: "not_contains", label: "불포함" },
    { value: "equals", label: "일치" },
    { value: "not_equals", label: "불일치" },
    { value: "greater_than", label: "보다 큼 / 이후" },
    { value: "greater_than_or_equal", label: "이상 / 이후 포함" },
    { value: "less_than", label: "보다 작음 / 이전" },
    { value: "less_than_or_equal", label: "이하 / 이전 포함" },
    { value: "is_empty", label: "비어 있음" },
    { value: "is_not_empty", label: "비어 있지 않음" },
  ];

  // 년도 셀렉트박스 옵션 (-5년 ~ +1년)
  const yearOptions = [
    { value: "", label: "전체 년도 불러오기" },
    ...Array.from({ length: 7 }, (_, i) => {
      const year = currentYear - 5 + i;
      return { value: year.toString(), label: `${year}년 데이터` };
    }).reverse(),
  ];

  // 주기 옵션
  const periodOptions = [
    { value: "", label: "전체 주기 불러오기" },
    { value: "상반기", label: "상반기 (+수시)" },
    { value: "하반기", label: "하반기 (+수시)" },
  ];

  // 1. 서버 API로부터 데이터베이스 전체 또는 필터링 로드
  const fetchRawData = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams();
      if (loadYear) params.append("measurementYear", loadYear);
      if (loadPeriod) params.append("measurementPeriod", loadPeriod);

      const response = await fetch(`/api/summary?${params.toString()}`);
      if (!response.ok) {
        throw new Error("서버로부터 데이터를 로드하지 못했습니다.");
      }

      const resJson = await response.json();
      const list = resJson.data || [];
      setRawData(list);
    } catch (err: any) {
      console.error("데이터 로딩 실패:", err);
      setError(err.message || "데이터 조회 중 오류 발생");
    } finally {
      setLoading(false);
    }
  };

  // 대분류 필터(년도/주기) 변경 시 자동 리로드
  useEffect(() => {
    fetchRawData();
  }, [loadYear, loadPeriod]);

  // 2. 로컬 스토리지에 저장된 템플릿 정보 로드
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("custom_report_templates");
      if (saved) {
        try {
          setTemplates(JSON.parse(saved));
        } catch (e) {
          console.error("템플릿 파싱 실패:", e);
        }
      }
    }
  }, []);

  // 3. 필터 조건 매칭 연산 엔진
  const matchFilter = (item: any, filter: FilterRule) => {
    const itemValue = item[filter.field];

    if (filter.operator === "is_empty") {
      return itemValue === null || itemValue === undefined || String(itemValue).trim() === "";
    }
    if (filter.operator === "is_not_empty") {
      return itemValue !== null && itemValue !== undefined && String(itemValue).trim() !== "";
    }

    if (itemValue === null || itemValue === undefined) return false;

    const targetValue = filter.value.trim();
    if (!targetValue) return true;

    const compareValues = targetValue
      .split(/[,|]/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const strItemVal = String(itemValue).toLowerCase();
    const strTargetVal = targetValue.toLowerCase();

    const fieldSpec = FILTER_FIELDS.find((f) => f.key === filter.field);

    if (fieldSpec?.type === "number") {
      const numItem = Number(itemValue);
      const numTarget = Number(targetValue);
      if (!isNaN(numItem) && !isNaN(numTarget)) {
        if (filter.operator === "equals") return numItem === numTarget;
        if (filter.operator === "not_equals") return numItem !== numTarget;
        if (filter.operator === "greater_than") return numItem > numTarget;
        if (filter.operator === "greater_than_or_equal") return numItem >= numTarget;
        if (filter.operator === "less_than") return numItem < numTarget;
        if (filter.operator === "less_than_or_equal") return numItem <= numTarget;
      }
    }

    switch (filter.operator) {
      case "contains":
        return compareValues.some((value) => strItemVal.includes(value));
      case "not_contains":
        return compareValues.every((value) => !strItemVal.includes(value));
      case "equals":
        return compareValues.some((value) => strItemVal === value);
      case "not_equals":
        return compareValues.every((value) => strItemVal !== value);
      case "greater_than":
        return strItemVal > strTargetVal;
      case "greater_than_or_equal":
        return strItemVal >= strTargetVal;
      case "less_than":
        return strItemVal < strTargetVal;
      case "less_than_or_equal":
        return strItemVal <= strTargetVal;
      default:
        return true;
    }
  };

  // 4. 로우 데이터에 대해 필터 적용
  useEffect(() => {
    if (filters.length === 0) {
      setFilteredResults(rawData);
      return;
    }

    const filtered = rawData.filter((item) => {
      // 모든 필터 규칙을 만족해야 함 (AND 결합)
      return filters.every((rule) => {
        if (!rule.field) return true;
        return matchFilter(item, rule);
      });
    });

    setFilteredResults(filtered);
  }, [rawData, filters]);

  // 5. 필터 규칙 편집 핸들러
  const handleAddFilter = () => {
    const defaultField = FILTER_FIELDS[0].key;
    const newRule: FilterRule = {
      id: Math.random().toString(36).substr(2, 9),
      field: defaultField,
      operator: "contains",
      value: "",
    };
    setFilters([...filters, newRule]);
  };

  const handleUpdateFilter = (id: string, updates: Partial<FilterRule>) => {
    setFilters(
      filters.map((f) => (f.id === id ? { ...f, ...updates } : f))
    );
  };

  const handleRemoveFilter = (id: string) => {
    setFilters(filters.filter((f) => f.id !== id));
  };

  const reorderFilters = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= filters.length || toIndex >= filters.length) return;

    const newFilters = [...filters];
    const [moved] = newFilters.splice(fromIndex, 1);
    newFilters.splice(toIndex, 0, moved);
    setFilters(newFilters);
  };

  const handleMoveFilter = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    reorderFilters(index, targetIndex);
  };

  const handleFilterDrop = (targetIndex: number) => {
    if (draggedFilterIndex === null) return;
    reorderFilters(draggedFilterIndex, targetIndex);
    setDraggedFilterIndex(null);
  };

  const handleClearAllFilters = () => {
    setFilters([]);
  };

  // 6. 컬럼 순서 변경 핸들러 (위로 / 아래로 이동)
  const reorderColumns = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= columns.length || toIndex >= columns.length) return;

    const newCols = [...columns];
    const [moved] = newCols.splice(fromIndex, 1);
    newCols.splice(toIndex, 0, moved);
    setColumns(newCols);
  };

  const handleMoveColumn = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    reorderColumns(index, targetIndex);
  };

  const handleColumnDrop = (targetIndex: number) => {
    if (draggedColumnIndex === null) return;
    reorderColumns(draggedColumnIndex, targetIndex);
    setDraggedColumnIndex(null);
  };

  const handleToggleColumnVisibility = (key: string) => {
    setColumns(
      columns.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c))
    );
  };

  // 7. 템플릿 저장 및 불러오기 핸들러
  const handleSaveTemplate = () => {
    const typedName = newTemplateName.trim();
    const targetName = typedName || selectedTemplateName;

    if (!targetName) {
      alert("신규 템플릿 이름을 입력하거나 저장된 템플릿을 선택해 주세요.");
      return;
    }

    const newTemplate: ReportTemplate = {
      name: targetName,
      filters,
      columns,
    };

    const existingTemplate = templates.find((t) => t.name === targetName);
    const isUpdatingSelected = selectedTemplateName === targetName;

    let updated: ReportTemplate[] = [];
    if (existingTemplate) {
      if (!isUpdatingSelected && !confirm("동일한 이름의 템플릿이 존재합니다. 덮어쓰시겠습니까?")) {
        return;
      }
      updated = templates.map((t) => (t.name === targetName ? newTemplate : t));
    } else {
      updated = [...templates, newTemplate];
    }

    setTemplates(updated);
    localStorage.setItem("custom_report_templates", JSON.stringify(updated));
    setSelectedTemplateName(targetName);
    setNewTemplateName("");
    alert(existingTemplate ? "선택한 템플릿에 현재 설정을 저장했습니다." : "신규 템플릿이 로컬 저장소에 저장되었습니다.");
  };

  const handleLoadTemplate = (name: string) => {
    if (!name) return;
    const target = templates.find((t) => t.name === name);
    if (target) {
      setFilters(target.filters || []);
      // 기존 저장된 컬럼 구성의 유효성 매핑
      if (target.columns && target.columns.length > 0) {
        // 기존 컬럼 리스트에 없는 신규 필드가 있을 수 있으므로 병합
        const mergedCols = [...target.columns];
        columns.forEach((col) => {
          if (!mergedCols.some((mc) => mc.key === col.key)) {
            mergedCols.push(col);
          }
        });
        setColumns(mergedCols);
      }
      setSelectedTemplateName(name);
      setNewTemplateName("");
    }
  };

  const handleDeleteTemplate = (name: string) => {
    if (!name) return;
    if (!confirm(`'${name}' 템플릿을 삭제하시겠습니까?`)) return;

    const updated = templates.filter((t) => t.name !== name);
    setTemplates(updated);
    localStorage.setItem("custom_report_templates", JSON.stringify(updated));
    if (selectedTemplateName === name) {
      setSelectedTemplateName("");
    }
    alert("템플릿이 삭제되었습니다.");
  };

  // 8. 가공된 데이터 엑셀 파일 내보내기 (.xlsx)
  const handleExportExcel = () => {
    if (filteredResults.length === 0) {
      alert("출력할 데이터가 존재하지 않습니다.");
      return;
    }

    const visibleCols = columns.filter((c) => c.visible);
    if (visibleCols.length === 0) {
      alert("하나 이상의 컬럼을 선택해 주세요.");
      return;
    }

    // 선택된 컬럼 레이아웃에 맞게 데이터 배열 가공
    const excelData = filteredResults.map((item) => {
      const row: any = {};
      visibleCols.forEach((col) => {
        let val = item[col.key];

        // 금액 데이터는 숫자 타입으로 형변환하여 엑셀에서 연산 가능하도록 지원
        if (
          [
            "measurement_fee_business",
            "measurement_fee_national",
            "measurement_fee_total",
          ].includes(col.key)
        ) {
          row[col.label] = val !== null && val !== undefined ? Number(val) : 0;
        } else {
          row[col.label] = val !== null && val !== undefined ? val : "";
        }
      });
      return row;
    });

    try {
      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "맞춤보고서");

      // 다운로드 파일명 조합
      const today = new Date().toISOString().split("T")[0];
      const fileName = `맞춤형보고서_${today}.xlsx`;

      XLSX.writeFile(workbook, fileName);
    } catch (e: any) {
      console.error("엑셀 파일 내보내기 실패:", e);
      alert("엑셀 파일 내보내기 도중 오류가 발생했습니다: " + e.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* 기본 데이터 로드 컨트롤 영역 */}
      <Card className="p-3 bg-surface-50 border border-surface-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col md:flex-row md:items-baseline gap-1 md:gap-3">
            <h2 className="text-base font-semibold text-text-900">1. 대분류 데이터 로드</h2>
            <p className="text-xs text-text-500">
              원활한 필터링 속도를 위해 1차적으로 불러올 년도와 주기를 지정합니다.
            </p>
          </div>
          <div className="flex flex-row flex-nowrap items-center gap-2.5 flex-shrink-0">
            <Select
              value={loadYear}
              onChange={(e) => setLoadYear(e.target.value)}
              options={yearOptions}
              className="w-36 sm:w-40 text-sm"
            />
            <Select
              value={loadPeriod}
              onChange={(e) => setLoadPeriod(e.target.value)}
              options={periodOptions}
              className="w-36 sm:w-40 text-sm"
            />
            <Button variant="secondary" onClick={fetchRawData} disabled={loading} className="gap-1.5 whitespace-nowrap py-2 text-sm">
              🔄 리로드
            </Button>
          </div>
        </div>
      </Card>

      {/* 설정 템플릿 관리 영역 */}
      <Card className="p-4 border border-surface-200">
        <h2 className="text-base font-semibold text-text-900 mb-3">2. 템플릿 설정 (브라우저 로컬 저장)</h2>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="w-64">
              <Select
                value={selectedTemplateName}
                onChange={(e) => handleLoadTemplate(e.target.value)}
                options={[
                  { value: "", label: "-- 저장된 템플릿 선택 --" },
                  ...templates.map((t) => ({ value: t.name, label: t.name })),
                ]}
                className="w-full"
              />
            </div>
            {selectedTemplateName && (
              <Button
                variant="danger"
                onClick={() => handleDeleteTemplate(selectedTemplateName)}
                className="py-2 text-xs"
              >
                🗑️ 삭제
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="새 이름 입력 (비우면 선택 템플릿 저장)"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              className="w-56"
            />
            <Button variant="primary" onClick={handleSaveTemplate} className="whitespace-nowrap">
              💾 {selectedTemplateName && !newTemplateName.trim() ? "선택 템플릿 저장" : "현재 설정 저장"}
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 상세 쿼리 조건 편집기 (2/3 영역) */}
        <Card className="p-4 border border-surface-200 lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-text-900">3. 상세 쿼리(필터) 조건 설정</h2>
              <p className="text-xs text-text-500 mt-0.5">
                지정한 조건들을 모두 만족하는(AND) 데이터만 실시간 필터링합니다. 여러 검색어는 쉼표로 구분해 입력할 수 있습니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={handleClearAllFilters} className="text-xs">
                초기화
              </Button>
              <Button variant="primary" size="sm" onClick={handleAddFilter} className="text-xs">
                ➕ 조건 추가
              </Button>
            </div>
          </div>

          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {filters.length === 0 ? (
              <div className="text-center py-8 text-sm text-text-400 border border-dashed border-surface-200 rounded-lg">
                설정된 상세 필터가 없습니다. 조건 추가 버튼을 눌러 필터를 지정하세요.
              </div>
            ) : (
              filters.map((filter, idx) => {
                const currentFieldSpec = FILTER_FIELDS.find((f) => f.key === filter.field);
                const isNoValOperator = ["is_empty", "is_not_empty"].includes(filter.operator);

                return (
                  <div
                    key={filter.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleFilterDrop(idx)}
                    className={`flex flex-wrap items-center gap-2 p-2.5 bg-surface-50 border border-surface-200 rounded-lg relative transition-colors ${draggedFilterIndex === idx ? "opacity-50 border-primary-300" : ""}`}
                  >
                    <button
                      type="button"
                      draggable
                      onDragStart={() => setDraggedFilterIndex(idx)}
                      onDragEnd={() => setDraggedFilterIndex(null)}
                      className="h-9 w-7 cursor-grab active:cursor-grabbing rounded border border-surface-200 bg-white text-text-400 hover:text-text-700 hover:border-primary-300"
                      title="끌어서 조건 순서 변경"
                    >
                      ↕
                    </button>

                    {/* 대상 필드 선택 */}
                    <div className="w-40">
                      <Select
                        value={filter.field}
                        onChange={(e) =>
                          handleUpdateFilter(filter.id, {
                            field: e.target.value,
                            value: "", // 필드 바뀔 시 초기화
                          })
                        }
                        options={FILTER_FIELDS.map((ff) => ({
                          value: ff.key,
                          label: ff.label,
                        }))}
                        className="w-full text-sm"
                      />
                    </div>

                    {/* 연산자 선택 */}
                    <div className="w-40">
                      <Select
                        value={filter.operator}
                        onChange={(e) =>
                          handleUpdateFilter(filter.id, { operator: e.target.value })
                        }
                        options={FILTER_OPERATORS}
                        className="w-full text-sm"
                      />
                    </div>

                    {/* 입력 값 영역 (연산자가 값 불필요 시 비활성화) */}
                    <div className="flex-1 min-w-[150px]">
                      {!isNoValOperator && (
                        <Input
                          type={currentFieldSpec?.type === "date" ? "date" : "text"}
                          placeholder={
                            currentFieldSpec?.type === "number"
                              ? "예: 100000 또는 100000, 200000"
                              : currentFieldSpec?.type === "date"
                              ? ""
                              : currentFieldSpec?.key === "note"
                              ? "예: 신규, 고시"
                              : "예: 신규, 고시"
                          }
                          value={filter.value}
                          onChange={(e) =>
                            handleUpdateFilter(filter.id, { value: e.target.value })
                          }
                          className="w-full text-sm py-1.5 h-9"
                        />
                      )}
                    </div>

                    {/* 필터 순서 이동 및 개별 필터 제거 */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleMoveFilter(idx, "up")}
                        disabled={idx === 0}
                        className="px-2 py-1 text-xs border border-surface-200 rounded bg-white hover:bg-surface-100 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                        title="위로 이동"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => handleMoveFilter(idx, "down")}
                        disabled={idx === filters.length - 1}
                        className="px-2 py-1 text-xs border border-surface-200 rounded bg-white hover:bg-surface-100 disabled:opacity-40 disabled:hover:bg-white transition-colors"
                        title="아래로 이동"
                      >
                        ▼
                      </button>
                      <button
                        onClick={() => handleRemoveFilter(filter.id)}
                        className="text-text-400 hover:text-danger-500 font-bold p-1 px-2.5 transition-colors"
                        title="조건 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* 컬럼 순서 및 여부 커스터마이저 (1/3 영역) */}
        <Card className="p-4 border border-surface-200 flex flex-col h-full max-h-[460px]">
          <div>
            <h2 className="text-base font-semibold text-text-900">4. 출력 컬럼 설정 및 정렬</h2>
            <p className="text-xs text-text-500 mt-0.5">
              화면 조회 및 엑셀 출력에 반영할 열의 선택 상태와 순서를 바꿉니다.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto mt-4 space-y-1 pr-1 border border-surface-100 rounded-lg p-2 bg-surface-50">
            {columns.map((col, idx) => (
              <div
                key={col.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleColumnDrop(idx)}
                className={`flex items-center justify-between p-2 bg-white border border-surface-200 rounded shadow-xs hover:border-primary-300 transition-colors ${draggedColumnIndex === idx ? "opacity-50 border-primary-300" : ""}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDraggedColumnIndex(idx)}
                    onDragEnd={() => setDraggedColumnIndex(null)}
                    className="h-7 w-6 cursor-grab active:cursor-grabbing rounded border border-surface-200 bg-surface-50 text-text-400 hover:text-text-700 hover:border-primary-300"
                    title="끌어서 컬럼 순서 변경"
                  >
                    ↕
                  </button>
                  <label className="flex items-center gap-2 text-xs font-medium text-text-700 cursor-pointer select-none min-w-0">
                    <input
                      type="checkbox"
                      checked={col.visible}
                      onChange={() => handleToggleColumnVisibility(col.key)}
                      className="rounded border-surface-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="truncate">{col.label}</span>
                  </label>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleMoveColumn(idx, "up")}
                    disabled={idx === 0}
                    className="px-1.5 py-0.5 text-xs border border-surface-200 rounded bg-surface-50 hover:bg-surface-100 disabled:opacity-40 disabled:hover:bg-surface-50"
                    title="위로 이동"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => handleMoveColumn(idx, "down")}
                    disabled={idx === columns.length - 1}
                    className="px-1.5 py-0.5 text-xs border border-surface-200 rounded bg-surface-50 hover:bg-surface-100 disabled:opacity-40 disabled:hover:bg-surface-50"
                    title="아래로 이동"
                  >
                    ▼
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 데이터 테이블 및 엑셀 다운로드 실행 영역 */}
      <Card className="p-4 border border-surface-200 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-text-900">5. 필터링 결과 및 다운로드</h2>
            <span className="bg-primary-50 text-primary-700 text-xs px-2.5 py-0.5 rounded-full font-medium border border-primary-100">
              총 {filteredResults.length}건
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={handleExportExcel}
              disabled={filteredResults.length === 0}
              className="bg-success-600 hover:bg-success-700 border-success-600 focus:ring-success-500 font-semibold gap-1.5 shadow-sm"
            >
              📥 맞춤형 엑셀 다운로드 (XLSX)
            </Button>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner size="lg" />
          </div>
        ) : (
          <div className="overflow-x-auto border border-surface-200 rounded-lg max-h-96">
            <Table>
              <TableHeader className="bg-surface-50 sticky top-0 z-10 shadow-xs">
                <TableRow>
                  <TableHead className="w-12 text-center">번호</TableHead>
                  {columns
                    .filter((c) => c.visible)
                    .map((col) => (
                      <TableHead key={col.key} className="whitespace-nowrap font-semibold">
                        {col.label}
                      </TableHead>
                    ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResults.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.filter((c) => c.visible).length + 1}
                      className="text-center py-12 text-text-400"
                    >
                      조건에 만족하는 데이터가 존재하지 않습니다.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredResults.map((item, idx) => (
                    <TableRow key={item.id || idx} className="hover:bg-surface-50/50">
                      <TableCell className="text-center text-xs text-text-400">{idx + 1}</TableCell>
                      {columns
                        .filter((c) => c.visible)
                        .map((col) => {
                          const val = item[col.key];
                          const isCurrency = [
                            "measurement_fee_business",
                            "measurement_fee_national",
                            "measurement_fee_total",
                          ].includes(col.key);

                          return (
                            <TableCell key={col.key} className="whitespace-nowrap text-sm text-text-700">
                              {isCurrency ? (
                                <span className="font-mono text-text-900 font-medium">
                                  {formatCurrency(val)}원
                                </span>
                              ) : (
                                String(val !== null && val !== undefined ? val : "")
                              )}
                            </TableCell>
                          );
                        })}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
};
