"use client";

import React, { useState, useEffect } from "react";
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
import { JournalEditForm } from "./JournalEditForm";
import { useRouter } from "next/navigation";

interface JournalEntry {
  id: number | null; // measurement_business에서 온 데이터는 null
  code: string;
  measurement_year: number;
  measurement_period: string;
  business_name: string;
  designated_office: string;
  address: string;
  completion_status: string;
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  measurer: string | null;
  created_at: string;
  updated_at: string;
  _isFromBusiness?: boolean; // measurement_business에서 온 데이터인지 표시
}

export const JournalSearch: React.FC = () => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"search" | "list">("search");
  
  // 검색 관련 상태
  const [searchParams, setSearchParams] = useState({
    measurementYear: "",
    measurementPeriod: "",
    businessName: "",
    designatedOffice: "",
    address: "",
  });
  const [results, setResults] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  
  // 등록 현황 관련 상태
  const [allJournals, setAllJournals] = useState<JournalEntry[]>([]); // 전체 등록 현황
  const [filteredJournals, setFilteredJournals] = useState<JournalEntry[]>([]); // 필터링된 결과
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    measurementYear: "",
    measurementPeriod: "",
    designatedOffice: "",
    completionStatus: "",
  });
  
  // 공통 상태
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 페이지 로드 시 초기 검색 실행 (최신 자료 표시)
  useEffect(() => {
    if (activeTab === "search") {
      handleSearch();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 측정년도 옵션 생성 (현재 년도 기준 -5년 ~ +1년, 내림차순)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse(); // 내림차순으로 정렬

  // 측정주기 옵션
  const periodOptions = [
    { value: "", label: "전체" },
    { value: "상반기", label: "상반기" },
    { value: "하반기", label: "하반기" },
  ];

  // 지정한계_관할지청 옵션
  const designatedOfficeOptions = [
    { value: "", label: "전체" },
    { value: "대전지방고용노동청 천안지청", label: "대전지방고용노동청 천안지청" },
    { value: "대전지방고용노동청", label: "대전지방고용노동청" },
    { value: "중부지방고용노동청 평택지청", label: "중부지방고용노동청 평택지청" },
    { value: "중부지방고용노동청 경기지청", label: "중부지방고용노동청 경기지청" },
  ];

  const handleSearch = async () => {
    console.log("측정일지 검색 버튼 클릭됨", searchParams);
    setLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams();
      if (searchParams.measurementYear) {
        params.append("measurementYear", searchParams.measurementYear);
      }
      if (searchParams.measurementPeriod) {
        params.append("measurementPeriod", searchParams.measurementPeriod);
      }
      if (searchParams.businessName) {
        params.append("businessName", searchParams.businessName);
      }
      if (searchParams.designatedOffice) {
        params.append("designatedOffice", searchParams.designatedOffice);
      }
      if (searchParams.address) {
        params.append("address", searchParams.address);
      }

      const response = await fetch(`/api/journal/search?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setResults(data.results || []);
      } else {
        setError(data.error || "검색 중 오류가 발생했습니다.");
        setResults([]);
      }
    } catch (err: any) {
      console.error("검색 오류:", err);
      setError(err.message || "검색 중 오류가 발생했습니다.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSearchParams({
      measurementYear: "",
      measurementPeriod: "",
      businessName: "",
      designatedOffice: "",
      address: "",
    });
    setResults([]);
    setError(null);
    setHasSearched(false);
  };

  const handleSelectJournal = (entry: JournalEntry) => {
    // 선택된 항목을 모달에 표시
    setSelectedEntry(entry);
    setIsModalOpen(true);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedEntry(null);
  };

  const handleSaveSuccess = () => {
    // 저장 성공 시 검색 결과 새로고침
    if (activeTab === "search") {
      handleSearch();
    } else {
      loadJournalList();
    }
  };

  // 등록 현황 목록 로드 (전체 데이터)
  const loadJournalList = async () => {
    setListLoading(true);
    setListError(null);

    try {
      // 검색 조건 없이 전체 데이터 로드
      const response = await fetch(`/api/journal/search`);
      const data = await response.json();

      if (response.ok) {
        // measurement_journal에 실제 등록된 항목만 필터링 (id가 null이 아닌 것)
        const registeredJournals = (data.results || []).filter(
          (entry: JournalEntry) => entry.id !== null && !entry._isFromBusiness
        );
        setAllJournals(registeredJournals);
        // 초기 필터링 적용
        applyFilters(registeredJournals, filters);
      } else {
        setListError(data.error || "등록 현황을 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("등록 현황 로드 오류:", err);
      setListError(err.message || "등록 현황을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setListLoading(false);
    }
  };

  // 필터 적용 함수
  const applyFilters = (journals: JournalEntry[], currentFilters: typeof filters) => {
    let filtered = [...journals];

    if (currentFilters.measurementYear) {
      filtered = filtered.filter(
        (entry) => entry.measurement_year.toString() === currentFilters.measurementYear
      );
    }

    if (currentFilters.measurementPeriod) {
      filtered = filtered.filter(
        (entry) => entry.measurement_period === currentFilters.measurementPeriod
      );
    }

    if (currentFilters.designatedOffice) {
      filtered = filtered.filter(
        (entry) => entry.designated_office === currentFilters.designatedOffice
      );
    }

    if (currentFilters.completionStatus) {
      filtered = filtered.filter(
        (entry) => entry.completion_status === currentFilters.completionStatus
      );
    }

    setFilteredJournals(filtered);
  };

  // 필터 변경 핸들러
  const handleFilterChange = (key: keyof typeof filters, value: string) => {
    const newFilters = { ...filters, [key]: value };
    setFilters(newFilters);
    applyFilters(allJournals, newFilters);
  };

  // 필터 초기화
  const handleFilterReset = () => {
    const resetFilters = {
      measurementYear: "",
      measurementPeriod: "",
      designatedOffice: "",
      completionStatus: "",
    };
    setFilters(resetFilters);
    applyFilters(allJournals, resetFilters);
  };

  // 탭 변경 시 목록 자동 로드
  useEffect(() => {
    if (activeTab === "list") {
      loadJournalList();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

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
      {/* 탭 네비게이션 */}
      <div className="border-b border-surface-200">
        <nav className="flex space-x-8" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "search"}
            onClick={() => setActiveTab("search")}
            className={`px-4 py-4 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
              activeTab === "search"
                ? "text-primary-600 border-primary-600 font-semibold"
                : "text-text-600 border-transparent hover:text-text-900 hover:border-surface-300"
            }`}
          >
            검색
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "list"}
            onClick={() => setActiveTab("list")}
            className={`px-4 py-4 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
              activeTab === "list"
                ? "text-primary-600 border-primary-600 font-semibold"
                : "text-text-600 border-transparent hover:text-text-900 hover:border-surface-300"
            }`}
          >
            등록 현황
          </button>
        </nav>
      </div>

      {/* 검색 탭 */}
      {activeTab === "search" && (
        <>
          {/* 검색 폼 */}
          <Card className="p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-text-900">검색 조건</h2>
              <Button
                variant="primary"
                onClick={() => router.push("/journal/new")}
                className="shadow-sm"
              >
                등록
              </Button>
            </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Select
            label="측정년도"
            value={searchParams.measurementYear}
            onChange={(e) =>
              setSearchParams({ ...searchParams, measurementYear: e.target.value })
            }
            options={[{ value: "", label: "전체" }, ...yearOptions]}
          />
          <Select
            label="측정주기"
            value={searchParams.measurementPeriod}
            onChange={(e) =>
              setSearchParams({ ...searchParams, measurementPeriod: e.target.value })
            }
            options={periodOptions}
          />
          <Input
            label="사업장명"
            value={searchParams.businessName}
            onChange={(e) =>
              setSearchParams({ ...searchParams, businessName: e.target.value })
            }
            placeholder="사업장명 입력"
          />
          <Select
            label="지정한계_관할지청"
            value={searchParams.designatedOffice}
            onChange={(e) =>
              setSearchParams({ ...searchParams, designatedOffice: e.target.value })
            }
            options={designatedOfficeOptions}
          />
          <Input
            label="주소"
            value={searchParams.address}
            onChange={(e) =>
              setSearchParams({ ...searchParams, address: e.target.value })
            }
            placeholder="주소 입력"
          />
        </div>
            <div className="flex gap-3 mt-6">
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSearch();
                }}
                disabled={loading}
                className="shadow-sm"
              >
                {loading ? "검색 중..." : "검색"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleReset();
                }}
                disabled={loading}
              >
                초기화
              </Button>
            </div>
          </Card>

          {/* 검색 결과 */}
          {error && <Alert variant="error">{error}</Alert>}

          {hasSearched && !loading && (
            <Card className="p-6 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-text-900">
                  검색 결과 ({results.length}건)
                </h2>
              </div>

              {results.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-text-500 text-lg">검색 결과가 없습니다.</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-surface-200">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="bg-surface-50">측정년도</TableHead>
                        <TableHead className="bg-surface-50">측정주기</TableHead>
                        <TableHead className="bg-surface-50">사업장명</TableHead>
                        <TableHead className="bg-surface-50">지정한계_관할지청</TableHead>
                        <TableHead className="bg-surface-50">주소</TableHead>
                        <TableHead className="bg-surface-50">측정 시작일</TableHead>
                        <TableHead className="bg-surface-50">측정 종료일</TableHead>
                        <TableHead className="bg-surface-50">측정자</TableHead>
                        <TableHead className="bg-surface-50">완료여부</TableHead>
                        <TableHead className="bg-surface-50 text-center">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((entry) => (
                        <TableRow key={entry.id || `${entry.code}-${entry.measurement_year}-${entry.measurement_period}`} className="hover:bg-surface-50">
                          <TableCell className="font-medium">{entry.measurement_year}</TableCell>
                          <TableCell>{entry.measurement_period}</TableCell>
                          <TableCell className="font-medium">{entry.business_name}</TableCell>
                          <TableCell>{entry.designated_office}</TableCell>
                          <TableCell className="text-text-600 max-w-xs truncate">
                            {entry.address || "-"}
                          </TableCell>
                          <TableCell>{formatDate(entry.measurement_start_date)}</TableCell>
                          <TableCell>{formatDate(entry.measurement_end_date)}</TableCell>
                          <TableCell className="text-text-600">{entry.measurer || "-"}</TableCell>
                          <TableCell>
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                entry.completion_status === "완료"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-yellow-100 text-yellow-800"
                              }`}
                            >
                              {entry.completion_status}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleSelectJournal(entry)}
                              className="shadow-sm"
                            >
                              선택
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          )}

          {loading && (
            <div className="flex justify-center py-12">
              <LoadingSpinner />
            </div>
          )}
        </>
      )}

      {/* 등록 현황 탭 */}
      {activeTab === "list" && (
        <>
          {/* 필터 */}
          <Card className="p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-text-900">필터</h2>
              <Button
                type="button"
                variant="secondary"
                onClick={handleFilterReset}
                disabled={listLoading}
                size="sm"
              >
                필터 초기화
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Select
                label="측정년도"
                value={filters.measurementYear}
                onChange={(e) => handleFilterChange("measurementYear", e.target.value)}
                options={[{ value: "", label: "전체" }, ...yearOptions]}
              />
              <Select
                label="측정주기"
                value={filters.measurementPeriod}
                onChange={(e) => handleFilterChange("measurementPeriod", e.target.value)}
                options={periodOptions}
              />
              <Select
                label="지정한계_관할지청"
                value={filters.designatedOffice}
                onChange={(e) => handleFilterChange("designatedOffice", e.target.value)}
                options={designatedOfficeOptions}
              />
              <Select
                label="완료여부"
                value={filters.completionStatus}
                onChange={(e) => handleFilterChange("completionStatus", e.target.value)}
                options={[
                  { value: "", label: "전체" },
                  { value: "완료", label: "완료" },
                  { value: "미완료", label: "미완료" },
                ]}
              />
            </div>
          </Card>

          {/* 등록 현황 목록 */}
          {listError && <Alert variant="error">{listError}</Alert>}

          <Card className="p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-text-900">
                측정일지 등록 현황 ({filteredJournals.length}건 / 전체 {allJournals.length}건)
              </h2>
            </div>

            {listLoading ? (
              <div className="flex justify-center py-12">
                <LoadingSpinner />
              </div>
            ) : filteredJournals.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-text-500 text-lg">
                  {allJournals.length === 0
                    ? "등록된 측정일지가 없습니다."
                    : "필터 조건에 맞는 측정일지가 없습니다."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-surface-200">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="bg-surface-50">측정년도</TableHead>
                      <TableHead className="bg-surface-50">측정주기</TableHead>
                      <TableHead className="bg-surface-50">사업장명</TableHead>
                      <TableHead className="bg-surface-50">지정한계_관할지청</TableHead>
                      <TableHead className="bg-surface-50">주소</TableHead>
                      <TableHead className="bg-surface-50">측정 시작일</TableHead>
                      <TableHead className="bg-surface-50">측정 종료일</TableHead>
                      <TableHead className="bg-surface-50">측정자</TableHead>
                      <TableHead className="bg-surface-50">완료여부</TableHead>
                      <TableHead className="bg-surface-50">작업</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJournals.map((entry) => (
                      <TableRow key={entry.id} className="hover:bg-surface-50">
                        <TableCell className="font-medium">{entry.measurement_year}</TableCell>
                        <TableCell>{entry.measurement_period}</TableCell>
                        <TableCell className="font-medium">{entry.business_name}</TableCell>
                        <TableCell>{entry.designated_office}</TableCell>
                        <TableCell className="text-text-600 max-w-xs truncate">
                          {entry.address || "-"}
                        </TableCell>
                        <TableCell>{formatDate(entry.measurement_start_date)}</TableCell>
                        <TableCell>{formatDate(entry.measurement_end_date)}</TableCell>
                        <TableCell className="text-text-600">{entry.measurer || "-"}</TableCell>
                        <TableCell>
                          <span
                            className={`px-2 py-1 rounded text-xs font-medium ${
                              entry.completion_status === "완료"
                                ? "bg-green-100 text-green-800"
                                : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {entry.completion_status}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleSelectJournal(entry)}
                            className="shadow-sm"
                          >
                            선택
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>
        </>
      )}

      {/* 측정일지 수정 모달 */}
      {selectedEntry && (
        <Modal
          isOpen={isModalOpen}
          onClose={handleModalClose}
          title={selectedEntry.id ? "측정일지 수정" : "측정일지 등록"}
          size="full"
        >
          <JournalEditForm
            entry={selectedEntry}
            onClose={handleModalClose}
            onSuccess={handleSaveSuccess}
          />
        </Modal>
      )}
    </div>
  );
};

