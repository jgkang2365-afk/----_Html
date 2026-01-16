"use client";

import React, { useState, useEffect } from "react";
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
  measurer: string | null;
  future_measurement_date: string | null; // 향후측정예상일
  isRegistered: boolean; // 측정일지 등록 여부
  journal_id: number | null; // 등록된 측정일지 ID
  national_support_status: string | null; // '지원', '비대상' 또는 null
  manager_name: string | null;
  manager_mobile: string | null;
  manager_phone: string | null;
  notes: string | null;
}

export const BusinessManagement: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<BusinessEntry[]>([]);
  const [filteredBusinesses, setFilteredBusinesses] = useState<BusinessEntry[]>([]);
  const [editingNotes, setEditingNotes] = useState<Map<string, string>>(new Map());
  const [editingNationalSupport, setEditingNationalSupport] = useState<Map<string, string>>(new Map());
  const [savingNationalSupport, setSavingNationalSupport] = useState<Set<string>>(new Set());
  const [addressSortOrder, setAddressSortOrder] = useState<"asc" | "desc" | null>(null);
  const [addressFilter, setAddressFilter] = useState("");

  // 필터 상태
  const [filters, setFilters] = useState({
    year: "",
    period: "",
    designatedOffice: "",
    address: "",
    businessName: "",
    isRegistered: "", // 전체, 등록됨, 미등록
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
  const [isNationalSupportUploadModalOpen, setIsNationalSupportUploadModalOpen] = useState(false);
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessEntry | null>(null);
  
  // 건강디딤돌 신청결과 업로드 상태
  const [nationalSupportUploadFile, setNationalSupportUploadFile] = useState<File | null>(null);
  const [nationalSupportUploadLoading, setNationalSupportUploadLoading] = useState(false);
  const [nationalSupportUploadError, setNationalSupportUploadError] = useState<string | null>(null);
  const [nationalSupportUploadResult, setNationalSupportUploadResult] = useState<any>(null);

  // 계획 생성 상태
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [planGenerateError, setPlanGenerateError] = useState<string | null>(null);
  const [planGenerateSuccess, setPlanGenerateSuccess] = useState<string | null>(null);

  // 년도 옵션 (현재 년도 기준 -5년 ~ +1년)
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse();

  // 측정 대상 사업장 목록 로드
  const loadBusinesses = async () => {
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

      const url = `/api/businesses?${params.toString()}`;
      console.log("[측정 대상 사업장] API 호출:", url);
      const response = await fetch(url);
      console.log("[측정 대상 사업장] API 응답 상태:", response.status);
      const data = await response.json();
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
  };

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

  // 필터 적용
  const applyFilters = (data: BusinessEntry[], currentFilters: typeof filters) => {
    let filtered = [...data];

    if (currentFilters.designatedOffice) {
      const normalizedOffice = toShortName(currentFilters.designatedOffice);
      filtered = filtered.filter((entry) => {
        const entryOffice = entry.designated_office ? toShortName(entry.designated_office) : "";
        return entryOffice === normalizedOffice;
      });
    }

    if (currentFilters.address) {
      filtered = filtered.filter((entry) =>
        entry.address?.toLowerCase().includes(currentFilters.address.toLowerCase())
      );
    }

    if (currentFilters.businessName) {
      filtered = filtered.filter((entry) =>
        entry.business_name?.toLowerCase().includes(currentFilters.businessName.toLowerCase())
      );
    }

    if (currentFilters.isRegistered === "등록됨") {
      filtered = filtered.filter((entry) => entry.isRegistered);
    } else if (currentFilters.isRegistered === "미등록") {
      filtered = filtered.filter((entry) => !entry.isRegistered);
    }

    setFilteredBusinesses(filtered);
  };

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
  }, [selectedYear, selectedPeriod]);

  // 필터 변경 시 필터링만 적용 (데이터 재로드 없음)
  useEffect(() => {
    applyFilters(businesses, filters);
  }, [filters]);

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
      {/* 년도/반기 선택 및 필터 */}
      <Card className="p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-4 mb-6">
          <div className="flex-1 min-w-[120px]">
            <Select
              label="측정년도"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              options={yearOptions}
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <Select
              label="측정주기"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              options={[
                { value: "상반기", label: "상반기" },
                { value: "하반기", label: "하반기" },
              ]}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Select
              label="지정지청"
              value={filters.designatedOffice}
              onChange={(e) => setFilters({ ...filters, designatedOffice: e.target.value })}
              options={[{ value: "", label: "전체" }, ...DESIGNATED_OFFICE_OPTIONS]}
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Input
              label="주소 검색"
              value={filters.address}
              onChange={(e) => setFilters({ ...filters, address: e.target.value })}
              placeholder="주소 입력"
            />
          </div>
          <div className="flex-1 min-w-[150px]">
            <Input
              label="사업장명 검색"
              value={filters.businessName}
              onChange={(e) => setFilters({ ...filters, businessName: e.target.value })}
              placeholder="사업장명 입력"
            />
          </div>
          <div className="flex-1 min-w-[120px]">
            <Select
              label="실시여부"
              value={filters.isRegistered}
              onChange={(e) => setFilters({ ...filters, isRegistered: e.target.value })}
              options={[
                { value: "", label: "전체" },
                { value: "등록됨", label: "등록됨" },
                { value: "미등록", label: "미등록" },
              ]}
            />
          </div>
          <Button
            variant="primary"
            onClick={generatePlan}
            disabled={generatingPlan}
            className="shadow-sm"
          >
            {generatingPlan ? "계획 생성 중..." : "계획 생성"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsAddModalOpen(true)}
            className="shadow-sm"
          >
            업체 추가
          </Button>
          <Button
            variant="secondary"
            onClick={() => setIsNationalSupportUploadModalOpen(true)}
            className="shadow-sm"
          >
            건강디딤돌 신청결과 업로드
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
          <Button variant="secondary" onClick={handleExportExcel}>
            엑셀 다운로드
          </Button>
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
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50">실시여부</TableHead>
                  <TableHead className="bg-surface-50">코드</TableHead>
                  <TableHead className="bg-surface-50">지정지청</TableHead>
                  <TableHead className="bg-surface-50">건강디딤돌</TableHead>
                  <TableHead className="bg-surface-50 w-[180px]">사업장명</TableHead>
                  <TableHead className="bg-surface-50 min-w-[200px]">
                    <div className="flex flex-col gap-2">
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
                              applyFilters(businesses, filters);
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
                      <Input
                        value={addressFilter}
                        onChange={(e) => {
                          setAddressFilter(e.target.value);
                          // 주소 필터 적용
                          const filtered = businesses.filter((b) =>
                            !e.target.value || b.address?.toLowerCase().includes(e.target.value.toLowerCase())
                          );
                          applyFilters(filtered, filters);
                        }}
                        placeholder="주소 검색"
                        className="text-xs h-7"
                      />
                    </div>
                  </TableHead>
                  <TableHead className="bg-surface-50">담당자명</TableHead>
                  <TableHead className="bg-surface-50">담당자 전화번호</TableHead>
                  <TableHead className="bg-surface-50">담당자 휴대폰</TableHead>
                  <TableHead className="bg-surface-50">측정예정일</TableHead>
                  <TableHead className="bg-surface-50">비고</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBusinesses.map((entry, index) => {
                  const entryKey = `${entry.code}-${entry.year}-${entry.period}`;
                  return (
                    <TableRow key={entryKey} className="hover:bg-surface-50">
                      <TableCell>
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            entry.isRegistered
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {entry.isRegistered ? "등록됨" : "미등록"}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{entry.code}</TableCell>
                      <TableCell>{entry.designated_office || "-"}</TableCell>
                      <TableCell>
                        {entry.journal_id ? (
                          <Select
                            value={editingNationalSupport.get(entryKey) ?? entry.national_support_status ?? ""}
                            onChange={async (e) => {
                              const newValue = e.target.value;
                              const newMap = new Map(editingNationalSupport);
                              newMap.set(entryKey, newValue);
                              setEditingNationalSupport(newMap);
                              
                              // 자동 저장
                              setSavingNationalSupport(prev => new Set(prev).add(entryKey));
                              try {
                                const response = await fetch(`/api/journal/${entry.journal_id}`, {
                                  method: "PUT",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    national_support_status: newValue || null,
                                  }),
                                });

                                if (response.ok) {
                                  // 로컬 상태 업데이트
                                  const updatedBusinesses = businesses.map(b => {
                                    if (b.code === entry.code && b.year === entry.year && b.period === entry.period) {
                                      return { ...b, national_support_status: newValue || null };
                                    }
                                    return b;
                                  });
                                  setBusinesses(updatedBusinesses);
                                  // 필터링된 목록도 업데이트
                                  applyFilters(updatedBusinesses, filters);
                                } else {
                                  const errorData = await response.json();
                                  console.error("건강디딤돌 상태 저장 실패:", errorData);
                                  alert("건강디딤돌 상태 저장에 실패했습니다: " + (errorData.error || "알 수 없는 오류"));
                                  // 이전 값으로 복원
                                  newMap.set(entryKey, entry.national_support_status || "");
                                  setEditingNationalSupport(newMap);
                                }
                              } catch (error: any) {
                                console.error("건강디딤돌 상태 저장 오류:", error);
                                alert("건강디딤돌 상태 저장 중 오류가 발생했습니다: " + error.message);
                                // 이전 값으로 복원
                                newMap.set(entryKey, entry.national_support_status || "");
                                setEditingNationalSupport(newMap);
                              } finally {
                                setSavingNationalSupport(prev => {
                                  const newSet = new Set(prev);
                                  newSet.delete(entryKey);
                                  return newSet;
                                });
                              }
                            }}
                            options={[
                              { value: "", label: "-" },
                              { value: "지원", label: "지원" },
                              { value: "비대상", label: "비대상" },
                            ]}
                            disabled={savingNationalSupport.has(entryKey)}
                            className="min-w-[90px]"
                          />
                        ) : entry.national_support_status ? (
                          <span className="text-text-700 text-sm">{entry.national_support_status}</span>
                        ) : (
                          <span className="text-text-400 text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell className="font-medium w-[180px]">{entry.business_name}</TableCell>
                      <TableCell className="text-text-600 min-w-[200px]">
                        {entry.address || "-"}
                      </TableCell>
                      <TableCell>{entry.manager_name || "-"}</TableCell>
                      <TableCell>{entry.manager_phone || "-"}</TableCell>
                      <TableCell>{entry.manager_mobile || "-"}</TableCell>
                      <TableCell>{formatDate(entry.future_measurement_date)}</TableCell>
                      <TableCell>
                        <Input
                          value={editingNotes.get(entryKey) ?? entry.notes ?? ""}
                          onChange={(e) => {
                            const newMap = new Map(editingNotes);
                            newMap.set(entryKey, e.target.value);
                            setEditingNotes(newMap);
                            // TODO: API 호출하여 비고 저장
                          }}
                          placeholder="비고 입력"
                          className="min-w-[120px]"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* 업체 추가 모달 */}
      <Modal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        title="업체 추가"
      >
        <div className="space-y-4">
          <p>업체 추가 기능은 API 구현 후 추가됩니다.</p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
              닫기
            </Button>
          </div>
        </div>
      </Modal>

      {/* 업체 수정 모달 */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedBusiness(null);
        }}
        title="업체 수정"
      >
        <div className="space-y-4">
          {selectedBusiness && (
            <div>
              <p>코드: {selectedBusiness.code}</p>
              <p>사업장명: {selectedBusiness.business_name}</p>
            </div>
          )}
          <p>업체 수정 기능은 API 구현 후 추가됩니다.</p>
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setIsEditModalOpen(false);
                setSelectedBusiness(null);
              }}
            >
              닫기
            </Button>
          </div>
        </div>
      </Modal>

      {/* 건강디딤돌 신청결과 업로드 모달 */}
      <Modal
        isOpen={isNationalSupportUploadModalOpen}
        onClose={() => {
          setIsNationalSupportUploadModalOpen(false);
          setNationalSupportUploadFile(null);
          setNationalSupportUploadError(null);
          setNationalSupportUploadResult(null);
        }}
        title="건강디딤돌 신청결과 업로드"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-700 mb-2">
              Excel 파일 선택
            </label>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setNationalSupportUploadFile(file);
                  setNationalSupportUploadError(null);
                  setNationalSupportUploadResult(null);
                }
              }}
              className="block w-full text-sm text-text-600
                file:mr-4 file:py-2 file:px-4
                file:rounded-md file:border-0
                file:text-sm file:font-semibold
                file:bg-primary-600 file:text-white
                hover:file:bg-primary-700"
            />
          </div>

          {nationalSupportUploadError && (
            <Alert variant="error">{nationalSupportUploadError}</Alert>
          )}

          {nationalSupportUploadResult && (
            <Alert variant={nationalSupportUploadResult.success ? "success" : "error"}>
              <div>
                <p className="font-semibold mb-1">{nationalSupportUploadResult.message || "처리 완료"}</p>
                {nationalSupportUploadResult.processed !== undefined && (
                  <p className="text-sm">처리된 사업장: {nationalSupportUploadResult.processed}개</p>
                )}
                {nationalSupportUploadResult.updated !== undefined && (
                  <p className="text-sm">업데이트된 측정일지: {nationalSupportUploadResult.updated}개</p>
                )}
                {nationalSupportUploadResult.errors && nationalSupportUploadResult.errors.length > 0 && (
                  <div className="mt-2 text-sm">
                    <p className="font-semibold">오류 상세 ({nationalSupportUploadResult.errors.length}건):</p>
                    <ul className="list-disc list-inside mt-1 max-h-40 overflow-y-auto">
                      {nationalSupportUploadResult.errors.slice(0, 10).map((error: string, idx: number) => (
                        <li key={idx}>{error}</li>
                      ))}
                      {nationalSupportUploadResult.errors.length > 10 && (
                        <li>...외 {nationalSupportUploadResult.errors.length - 10}건</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            </Alert>
          )}

          <div className="flex justify-end gap-3">
            <Button
              variant={nationalSupportUploadResult ? "primary" : "secondary"}
              onClick={() => {
                setIsNationalSupportUploadModalOpen(false);
                setNationalSupportUploadFile(null);
                setNationalSupportUploadError(null);
                setNationalSupportUploadResult(null);
              }}
              disabled={nationalSupportUploadLoading}
            >
              {nationalSupportUploadResult ? "닫기" : "취소"}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!nationalSupportUploadFile) {
                  setNationalSupportUploadError("파일을 선택해주세요.");
                  return;
                }

                setNationalSupportUploadLoading(true);
                setNationalSupportUploadError(null);
                setNationalSupportUploadResult(null);

                try {
                  const formData = new FormData();
                  formData.append("file", nationalSupportUploadFile);
                  formData.append("year", selectedYear);
                  formData.append("period", selectedPeriod);

                  const response = await fetch("/api/businesses/national-support/upload", {
                    method: "POST",
                    body: formData,
                  });

                  const data = await response.json();
                  console.log("업로드 응답:", data, "response.ok:", response.ok); // 디버깅용

                  // 응답이 성공이거나 데이터가 있으면 결과 표시
                  if (response.ok) {
                    if (data.success) {
                      setNationalSupportUploadResult(data);
                      // 업로드 성공 시 목록 새로고침 (약간의 지연 후)
                      setTimeout(async () => {
                        await loadBusinesses();
                      }, 500);
                    } else {
                      // API에서 success: false를 반환한 경우
                      setNationalSupportUploadResult(data);
                      setNationalSupportUploadError(data.error || data.message || "업로드 처리 중 오류가 발생했습니다.");
                    }
                  } else {
                    // HTTP 오류 응답
                    setNationalSupportUploadResult(data);
                    setNationalSupportUploadError(data.error || data.message || `업로드 실패 (${response.status})`);
                  }
                } catch (error: any) {
                  console.error("건강디딤돌 신청결과 업로드 오류:", error);
                  setNationalSupportUploadError(error.message || "업로드 중 오류가 발생했습니다.");
                } finally {
                  setNationalSupportUploadLoading(false);
                }
              }}
              disabled={!nationalSupportUploadFile || nationalSupportUploadLoading || !!nationalSupportUploadResult}
            >
              {nationalSupportUploadLoading ? "업로드 중..." : "업로드"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
