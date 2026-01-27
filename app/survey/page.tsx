"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { SurveyForm } from "@/components/features/SurveyForm";
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
import { formatDateYYYYMMDD } from "@/lib/utils/date-utils";

interface Survey {
  id: number;
  code: string;
  measurement_date: string;
  end_date: string | null;
  measurement_weekdays: string | null;
  business_name: string;
  measurer: string | null;
  survey_code: string | null;
  address: string | null;
  preliminary_surveyor: string | null;
  actual_measurer: string | null;
  report_writer: string | null;
  sequence_number: number | null;
  business_number: string | null; // Added field
  year: number | null;
  period: string | null;
  created_at: string;
  updated_at: string;
}

interface BusinessInfo {
  code: string;
  business_name: string;
  business_number: string;
  address?: string;
  address1?: string;
  address2?: string;
  office_jurisdiction: string;
  unpaid_count?: number;
}

export default function SurveyPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSurvey, setEditingSurvey] = useState<Survey | null>(null);
  const [selectedBusinessForForm, setSelectedBusinessForForm] = useState<BusinessInfo | null>(null); // 선택된 사업장 정보
  const [activeTab, setActiveTab] = useState<"search" | "list">("search"); // 탭 상태 추가
  const [isUnpaidWarningModalOpen, setIsUnpaidWarningModalOpen] = useState(false);
  const [pendingBusinessForForm, setPendingBusinessForForm] = useState<BusinessInfo | null>(null); // 경고 모달에서 대기 중인 사업장 정보
  // 순번 정렬 관련 상태
  const [sequenceSortOrder, setSequenceSortOrder] = useState<"asc" | "desc">("asc"); // 기본값: 오름차순 (등록 순서)
  // 년도 필터 관련 상태
  const [selectedYear, setSelectedYear] = useState<string>(""); // 선택된 년도 (빈 문자열이면 전체)
  // 사업장명 검색 상태 (예비조사 목록용)
  const [businessNameFilter, setBusinessNameFilter] = useState<string>(""); // 사업장명 검색 필터

  // 검색 관련 상태
  const [searchParams, setSearchParams] = useState({
    code: "",
    businessNumber: "",
    businessName: "",
    officeJurisdiction: "",
    address: "",
  });
  const [hasSearched, setHasSearched] = useState(false);
  const [officeOptions, setOfficeOptions] = useState<{ value: string; label: string }[]>([
    { value: "", label: "전체" },
  ]);

  useEffect(() => {
    if (activeTab === "list") {
      loadSurveys();
    }
    loadOfficeOptions();
  }, [activeTab]);

  const loadOfficeOptions = async () => {
    try {
      const response = await fetch("/api/survey/offices");
      const data = await response.json();
      if (response.ok && data.offices) {
        const options = [
          { value: "", label: "전체" },
          ...data.offices.map((office: string) => ({
            value: office,
            label: office,
          })),
        ];
        setOfficeOptions(options);
      }
    } catch (err) {
      console.error("소재지 관할청 목록 로드 오류:", err);
    }
  };

  // 사업장정보 검색
  const searchBusinesses = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (searchParams.code) {
        params.append("code", searchParams.code);
      }
      if (searchParams.businessNumber) {
        params.append("businessNumber", searchParams.businessNumber);
      }
      if (searchParams.businessName) {
        params.append("businessName", searchParams.businessName);
      }
      if (searchParams.officeJurisdiction) {
        params.append("officeJurisdiction", searchParams.officeJurisdiction);
      }
      if (searchParams.address) {
        params.append("address", searchParams.address);
      }

      const url = params.toString() ? `/api/survey?${params.toString()}` : "/api/survey";
      const response = await fetch(url);
      const data = await response.json();

      if (response.ok) {
        setBusinesses(data.businesses || []);
        setHasSearched(true);
      } else {
        setError(data.error || "사업장정보 검색 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("사업장정보 검색 오류:", err);
      setError(err.message || "사업장정보 검색 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 예비조사 목록 조회
  const loadSurveys = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/survey");
      const data = await response.json();

      if (response.ok) {
        setSurveys(data.surveys || []);
      } else {
        setError(data.error || "예비조사 목록을 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("예비조사 목록 로드 오류:", err);
      setError(err.message || "예비조사 목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (activeTab === "search") {
      searchBusinesses();
    } else {
      loadSurveys();
    }
  };

  const handleReset = () => {
    setSearchParams({
      code: "",
      businessNumber: "",
      businessName: "",
      officeJurisdiction: "",
      address: "",
    });
    setHasSearched(false);
    setBusinesses([]);
  };

  const handleEditSurvey = (survey: Survey) => {
    setEditingSurvey(survey);
    setIsFormOpen(true);
  };

  const handleDeleteSurvey = async (id: number) => {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    try {
      const response = await fetch(`/api/survey/${id}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (response.ok) {
        loadSurveys();
      } else {
        alert(data.error || "삭제 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("삭제 오류:", err);
      alert(err.message || "삭제 중 오류가 발생했습니다.");
    }
  };

  const handleFormSuccess = () => {
    setIsFormOpen(false);
    setEditingSurvey(null);
    loadSurveys();
  };

  const handleFormCancel = () => {
    setIsFormOpen(false);
    setEditingSurvey(null);
    setSelectedBusinessForForm(null);
  };

  // 엑셀 다운로드
  const handleExportExcel = async () => {
    try {
      const response = await fetch("/api/export/survey");

      if (!response.ok) {
        throw new Error("엑셀 다운로드 실패");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `예비조사목록_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error("엑셀 다운로드 오류:", err);
      alert("엑셀 다운로드 중 오류가 발생했습니다: " + (err.message || "알 수 없는 오류"));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-text-900">예비조사</h1>
      </div>

      {/* 탭 */}
      <div className="border-b border-surface-200">
        <div className="flex gap-4">
          <button
            onClick={() => {
              setActiveTab("search");
              setHasSearched(false);
              setBusinesses([]);
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === "search"
              ? "text-primary-500 border-b-2 border-primary-500"
              : "text-text-700 hover:text-text-900"
              }`}
          >
            사업장 검색
          </button>
          <button
            onClick={() => {
              setActiveTab("list");
              loadSurveys();
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === "list"
              ? "text-primary-500 border-b-2 border-primary-500"
              : "text-text-700 hover:text-text-900"
              }`}
          >
            예비조사 목록
          </button>
        </div>
      </div>

      {/* 검색 폼 (사업장 검색 탭에서만 표시) */}
      {activeTab === "search" && (
        <Card className="p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-text-900 mb-6">검색 조건</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <Input
              label="코드"
              value={searchParams.code}
              onChange={(e) =>
                setSearchParams({ ...searchParams, code: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="코드 입력"
            />
            <Input
              label="사업자번호"
              value={searchParams.businessNumber}
              onChange={(e) =>
                setSearchParams({ ...searchParams, businessNumber: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="사업자번호 입력"
            />
            <Input
              label="사업장명"
              value={searchParams.businessName}
              onChange={(e) =>
                setSearchParams({ ...searchParams, businessName: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="사업장명 입력"
            />
            <div>
              <label className="block text-sm font-medium text-text-700 mb-1">
                소재지 관할청
              </label>
              <div className="relative">
                <Input
                  list="office-jurisdiction-list"
                  value={searchParams.officeJurisdiction}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, officeJurisdiction: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSearch();
                    }
                  }}
                  placeholder="소재지 관할청 입력 또는 선택"
                />
                <datalist id="office-jurisdiction-list">
                  {officeOptions
                    .filter((opt) => opt.value !== "")
                    .map((opt) => (
                      <option key={opt.value} value={opt.value} />
                    ))}
                </datalist>
              </div>
            </div>
            <Input
              label="주소"
              value={searchParams.address}
              onChange={(e) =>
                setSearchParams({ ...searchParams, address: e.target.value })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder="주소 입력"
            />
          </div>
          <div className="flex gap-3 mt-6 justify-end">
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
      )}

      {error && <Alert variant="error">{error}</Alert>}

      {/* 검색 결과 (사업장정보) - 사업장 검색 탭 */}
      {activeTab === "search" && hasSearched && !loading && (
        <Card className="p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-text-900 mb-6">
            사업장정보 검색 결과 ({businesses.length}건)
          </h2>

          {businesses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-500 text-lg">검색 결과가 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-surface-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-surface-50">코드</TableHead>
                    <TableHead className="bg-surface-50">사업자번호</TableHead>
                    <TableHead className="bg-surface-50">사업장명</TableHead>
                    <TableHead className="bg-surface-50">소재지 관할청</TableHead>
                    <TableHead className="bg-surface-50">주소</TableHead>
                    <TableHead className="bg-surface-50 text-center">미수횟수</TableHead>
                    <TableHead className="bg-surface-50 text-center">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {businesses.map((business) => (
                    <TableRow key={business.code} className="hover:bg-surface-50">
                      <TableCell className="font-medium">{business.code}</TableCell>
                      <TableCell>{business.business_number || "-"}</TableCell>
                      <TableCell className="font-medium">{business.business_name}</TableCell>
                      <TableCell>{business.office_jurisdiction || "-"}</TableCell>
                      <TableCell>
                        {business.address ||
                          [business.address1, business.address2].filter(Boolean).join(" ") ||
                          "-"}
                      </TableCell>
                      <TableCell className={`text-center font-semibold ${(business.unpaid_count || 0) >= 1 ? 'text-red-600' : 'text-black'}`}>
                        {(business.unpaid_count || 0)}회
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-center">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditingSurvey(null);
                              // 미수금이 1회 이상인 경우 경고 모달 표시
                              if ((business.unpaid_count || 0) >= 1) {
                                setPendingBusinessForForm(business);
                                setIsUnpaidWarningModalOpen(true);
                              } else {
                                setSelectedBusinessForForm(business);
                                setIsFormOpen(true);
                              }
                            }}
                            className="shadow-sm"
                          >
                            선택
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {/* 미수금 경고 모달 */}
      <Modal
        isOpen={isUnpaidWarningModalOpen}
        onClose={() => {
          setIsUnpaidWarningModalOpen(false);
          setPendingBusinessForForm(null);
        }}
        title="미수금 경고"
        size="md"
      >
        <div className="py-4">
          {pendingBusinessForForm && (
            <>
              <Alert variant="warning">
                &ldquo;{pendingBusinessForForm.business_name}&rdquo; 업체는 측정비(사업장) 기준으로 미수금이 {pendingBusinessForForm.unpaid_count || 0}회 있습니다. 예비조사를 등록하시겠습니까?
              </Alert>
              <div className="mt-6 flex justify-end gap-3">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setIsUnpaidWarningModalOpen(false);
                    setPendingBusinessForForm(null);
                  }}
                >
                  취소
                </Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    if (pendingBusinessForForm) {
                      setSelectedBusinessForForm(pendingBusinessForForm);
                      setIsFormOpen(true);
                    }
                    setIsUnpaidWarningModalOpen(false);
                    setPendingBusinessForForm(null);
                  }}
                >
                  계속 진행
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* 예비조사 목록 (예비조사 목록 탭) */}
      {activeTab === "list" && !loading && (
        <Card className="p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-text-900">
              예비조사 목록 ({(() => {
                // 년도 및 사업장명 필터링된 결과 개수 계산
                let filtered = surveys;
                if (selectedYear) {
                  filtered = filtered.filter((survey) => {
                    if (!survey.measurement_date) return false;
                    const surveyYear = new Date(survey.measurement_date).getFullYear();
                    return surveyYear.toString() === selectedYear;
                  });
                }
                if (businessNameFilter) {
                  filtered = filtered.filter((survey) => {
                    return survey.business_name.toLowerCase().includes(businessNameFilter.toLowerCase());
                  });
                }
                return filtered.length;
              })()}건)
            </h2>
            <div className="flex items-center gap-3">
              {/* 사업장명 검색 입력 필드 */}
              <div className="relative w-[768px]">
                <Input
                  value={businessNameFilter}
                  onChange={(e) => setBusinessNameFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      // 필터링은 이미 실시간으로 작동하므로 추가 작업 불필요
                    }
                  }}
                  placeholder="사업장명 검색"
                  className="w-full pr-10"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => {
                    // 필터링은 이미 실시간으로 작동하므로 포커스만 유지
                    // 필요시 추가 로직 구현 가능
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:opacity-70 transition-opacity cursor-pointer"
                  aria-label="검색"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <circle
                      cx="11"
                      cy="11"
                      r="7"
                      stroke="#22c55e"
                      strokeWidth="2"
                      fill="none"
                    />
                    <path
                      d="m20 20-4-4"
                      stroke="#22c55e"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
              {/* 년도 선택 드롭다운 */}
              <Select
                value={selectedYear}
                onChange={(e) => {
                  const year = e.target.value;
                  setSelectedYear(year);
                }}
                options={[
                  { value: "", label: "전체" },
                  ...Array.from({ length: 10 }, (_, i) => {
                    const year = new Date().getFullYear() - 5 + i;
                    return { value: year.toString(), label: year.toString() };
                  }),
                ]}
                className="w-32 bg-orange-100 text-black font-bold [&>select]:bg-orange-100 [&>select]:text-black [&>select]:font-bold"
              />
              <Button variant="secondary" onClick={handleExportExcel} className="whitespace-nowrap">
                엑셀 다운로드
              </Button>
            </div>
          </div>

          {(() => {
            // 년도 및 사업장명 필터링
            let filteredSurveys = surveys;
            if (selectedYear) {
              filteredSurveys = filteredSurveys.filter((survey) => {
                if (!survey.measurement_date) return false;
                const surveyYear = new Date(survey.measurement_date).getFullYear();
                return surveyYear.toString() === selectedYear;
              });
            }
            if (businessNameFilter) {
              filteredSurveys = filteredSurveys.filter((survey) => {
                return survey.business_name.toLowerCase().includes(businessNameFilter.toLowerCase());
              });
            }

            // 순번 기준 정렬
            const sortedSurveys = [...filteredSurveys].sort((a, b) => {
              const seqA = a.sequence_number || 999999; // 순번이 없으면 뒤로
              const seqB = b.sequence_number || 999999;
              return sequenceSortOrder === "asc" ? seqA - seqB : seqB - seqA;
            });

            return sortedSurveys.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-text-500 text-lg">검색 결과가 없습니다.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-surface-200 overflow-hidden">
                <div className="max-h-[calc(100vh-300px)] overflow-y-auto overflow-x-auto">
                  <table className="w-full caption-bottom text-base">
                    <thead className="bg-slate-50/90 backdrop-blur supports-[backdrop-filter]:bg-slate-50/60 sticky top-0 z-10">
                      <tr className="border-b border-slate-100">
                        <th className="h-12 px-4 text-center align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">
                          <div className="flex items-center justify-center gap-2">
                            <span>순번</span>
                            <button
                              onClick={() => setSequenceSortOrder(sequenceSortOrder === "asc" ? "desc" : "asc")}
                              className="p-1.5 hover:bg-surface-100 rounded transition-colors flex items-center justify-center"
                              title={sequenceSortOrder === "asc" ? "내림차순으로 변경" : "오름차순으로 변경"}
                            >
                              {sequenceSortOrder === "asc" ? (
                                // 빨간색 위 삼각형 (오름차순)
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M12 8L8 12H16L12 8Z" fill="#EF4444" />
                                </svg>
                              ) : (
                                // 파란색 아래 삼각형 (내림차순)
                                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M12 16L16 12H8L12 16Z" fill="#3B82F6" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </th>
                        <th className="h-12 px-4 text-center align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">측정년도</th>
                        <th className="h-12 px-4 text-center align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">주기</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">측정일</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">종료일</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">측정요일</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">사업장명</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">사업자번호</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">측정자</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">공시료 코드</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">예비조사자</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">실측정자</th>
                        <th className="h-12 px-4 text-left align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">보고서 담당</th>
                        <th className="h-12 px-4 text-center align-middle font-bold text-slate-800 bg-surface-50 whitespace-nowrap">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSurveys.map((survey) => (
                        <tr key={survey.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/50">
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap text-center">
                            {survey.sequence_number || "-"}
                          </td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap text-center">
                            {survey.year || "-"}
                          </td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap text-center">
                            {survey.period || "-"}
                          </td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">
                            {survey.measurement_date
                              ? formatDateYYYYMMDD(new Date(survey.measurement_date))
                              : "-"}
                          </td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">
                            {survey.end_date ? formatDateYYYYMMDD(new Date(survey.end_date)) : "-"}
                          </td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">{survey.measurement_weekdays || "-"}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap font-medium">{survey.business_name}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">{survey.business_number || "-"}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">{survey.measurer || "-"}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">{survey.survey_code || "-"}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">{survey.preliminary_surveyor || "-"}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">{survey.actual_measurer || "-"}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">{survey.report_writer || "-"}</td>
                          <td className="p-4 align-middle text-slate-600 whitespace-nowrap">
                            <div className="flex gap-2 justify-center">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleEditSurvey(survey)}
                                className="shadow-sm"
                              >
                                수정
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleDeleteSurvey(survey.id)}
                                className="shadow-sm"
                              >
                                삭제
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}
        </Card>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {/* 예비조사 입력/수정 모달 */}
      {isFormOpen && (
        <Modal
          isOpen={isFormOpen}
          onClose={handleFormCancel}
          title={editingSurvey ? "예비조사 수정" : "예비조사 등록"}
          size="full"
        >
          <SurveyForm
            initialData={
              editingSurvey
                ? {
                  id: editingSurvey.id,
                  code: editingSurvey.code,
                  business_name: editingSurvey.business_name,
                  business_number: editingSurvey.business_number ?? undefined,
                  measurement_date: editingSurvey.measurement_date,
                  end_date: editingSurvey.end_date ?? undefined,
                  measurement_weekdays: editingSurvey.measurement_weekdays ?? undefined,
                  measurer: editingSurvey.measurer ?? undefined,
                  survey_code: editingSurvey.survey_code ?? undefined,
                  address: editingSurvey.address ?? undefined,
                  preliminary_surveyor: editingSurvey.preliminary_surveyor ?? undefined,
                  actual_measurer: editingSurvey.actual_measurer ?? undefined,
                  report_writer: editingSurvey.report_writer ?? undefined,
                  sequence_number: editingSurvey.sequence_number ?? undefined,
                  year: editingSurvey.year ?? undefined,
                  period: editingSurvey.period ?? undefined,
                } as any
                : selectedBusinessForForm
                  ? {
                    code: selectedBusinessForForm.code,
                    business_name: selectedBusinessForForm.business_name,
                    business_number: selectedBusinessForForm.business_number || "",
                    address: selectedBusinessForForm.address ||
                      [selectedBusinessForForm.address1, selectedBusinessForForm.address2]
                        .filter(Boolean).join(" ") || "",
                  }
                  : undefined
            }
            onSuccess={handleFormSuccess}
            onCancel={handleFormCancel}
          />
        </Modal>
      )}
    </div>
  );
}
