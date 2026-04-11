"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { SurveyForm } from "@/components/features/SurveyForm";
import { BulkRegisterModal } from "@/components/features/BulkRegisterModal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
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
import { formatDateYYYYMMDD, calculateMeasurementWeekdays } from "@/lib/utils/date-utils";

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
  notes: string | null;
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
  national_unpaid_count?: number; // 국고 미수 횟수 추가
}

export default function SurveyPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [businesses, setBusinesses] = useState<BusinessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSurvey, setEditingSurvey] = useState<Survey | null>(null);
  const [selectedBusinessForForm, setSelectedBusinessForForm] = useState<BusinessInfo | null>(null); // 선택된 사업장 정보
  // 탭 상태
  const [activeTab, setActiveTab] = useState<"search" | "list">("list");

  // 초기 로드 시 localStorage에서 탭 상태 복원 (Client-side only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTab = localStorage.getItem("surveyActiveTab");
      if (savedTab === "search" || savedTab === "list") {
        setActiveTab(savedTab);
      }
    }
  }, []);

  // 탭 변경 시 localStorage에 저장
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("surveyActiveTab", activeTab);
    }
  }, [activeTab]);
  const [isUnpaidWarningModalOpen, setIsUnpaidWarningModalOpen] = useState(false);
  const [pendingBusinessForForm, setPendingBusinessForForm] = useState<BusinessInfo | null>(null); // 경고 모달에서 대기 중인 사업장 정보
  // 정렬 상태
  const [sortConfig, setSortConfig] = useState<{ key: "sequence_number" | "measurement_date" | "report_writer"; direction: "asc" | "desc" }>({
    key: "measurement_date",
    direction: "desc",
  });
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

  // 예비조사 목록 검색 상태
  const [listSearchParams, setListSearchParams] = useState({
    measurementDate: "",
    businessName: "",
  });

  const [hasSearched, setHasSearched] = useState(false);
  const [officeOptions, setOfficeOptions] = useState<{ value: string; label: string }[]>([
    { value: "", label: "전체" },
  ]);

  // 일괄 등록 관련 상태
  const [selectedBusinessCodes, setSelectedBusinessCodes] = useState<Set<string>>(new Set());
  const [isBulkRegisterModalOpen, setIsBulkRegisterModalOpen] = useState(false);

  // 예비조사 목록 조회
  const loadSurveys = React.useCallback(async (options?: any) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();

      let mDate = listSearchParams.measurementDate;
      let bName = listSearchParams.businessName;

      // 오버라이드 파라미터 확인 (이벤트 객체가 아닌 경우)
      if (options && typeof options === 'object' && !options.type) {
        if (options.measurementDate !== undefined) mDate = options.measurementDate;
        if (options.businessName !== undefined) bName = options.businessName;
      }

      if (mDate) {
        params.append("measurementDate", mDate);
      }
      if (bName) {
        params.append("businessName", bName);
      }

      const url = params.toString() ? `/api/survey?${params.toString()}` : "/api/survey";
      const response = await fetch(url);
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
  }, [listSearchParams]);

  useEffect(() => {
    if (activeTab === "list") {
      loadSurveys();
    }
    loadOfficeOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]); // loadSurveys를 의존성 배열에서 제외하여 렌더링마다 자동 호출 방지

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
    setSelectedBusinessCodes(new Set()); // 검색 시 선택 상태 초기화

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
    setSelectedBusinessCodes(new Set());
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
    setPendingBusinessForForm(null); // 경고 모달 상태 초기화

    // 예비조사 목록 탭으로 전환하고 목록 새로고침
    setActiveTab("list");
    loadSurveys();
  };

  const handleFormCancel = () => {
    setIsFormOpen(false);
    setEditingSurvey(null);
    setSelectedBusinessForForm(null);
    setPendingBusinessForForm(null); // 경고 모달 상태 초기화
  };

  // 일괄 등록 성공
  const handleBulkSuccess = () => {
    setIsBulkRegisterModalOpen(false);
    setSelectedBusinessCodes(new Set());
    setActiveTab("list");
    loadSurveys();
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

  // 체크박스 처리
  const toggleBusinessSelection = (code: string) => {
    const newSet = new Set(selectedBusinessCodes);
    if (newSet.has(code)) {
      newSet.delete(code);
    } else {
      newSet.add(code);
    }
    setSelectedBusinessCodes(newSet);
  };

  const toggleAllSelection = () => {
    if (selectedBusinessCodes.size === businesses.length) {
      setSelectedBusinessCodes(new Set());
    } else {
      const allCodes = businesses.map(b => b.code);
      setSelectedBusinessCodes(new Set(allCodes));
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
              setActiveTab("list");
              // 목록이 비어있을 때만 로드 (이미 로드된 데이터 유지)
              if (surveys.length === 0) {
                loadSurveys();
              }
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === "list"
              ? "text-primary-500 border-b-2 border-primary-500"
              : "text-text-700 hover:text-text-900"
              }`}
          >
            예비조사 목록
          </button>
          <button
            onClick={() => {
              setActiveTab("search");
              // 상태 유지 (검색 결과 초기화 안함)
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${activeTab === "search"
              ? "text-primary-500 border-b-2 border-primary-500"
              : "text-text-700 hover:text-text-900"
              }`}
          >
            사업장 검색
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
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-text-900">
              사업장정보 검색 결과 ({businesses.length}건)
            </h2>
            {businesses.length > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={selectedBusinessCodes.size === 0}
                  onClick={() => setIsBulkRegisterModalOpen(true)}
                >
                  선택된 {selectedBusinessCodes.size}건 일괄 등록
                </Button>
              </div>
            )}
          </div>

          {businesses.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-500 text-lg">검색 결과가 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-surface-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[45px] bg-surface-50 pl-2.5">
                      <div className="flex items-center">
                        <Checkbox
                          checked={selectedBusinessCodes.size === businesses.length && businesses.length > 0}
                          onChange={toggleAllSelection}
                        />
                      </div>
                    </TableHead>
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
                    <TableRow key={business.code} className={`hover:bg-surface-50 group relative growable-row ${selectedBusinessCodes.has(business.code) ? 'bg-indigo-50/50' : ''}`}>
                      <TableCell className="w-[45px] text-left pl-2.5 relative">
                        {/* 표준 블루 인디케이터 바 */}
                        <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                        <div className="flex items-center">
                          <Checkbox
                            checked={selectedBusinessCodes.has(business.code)}
                            onChange={() => toggleBusinessSelection(business.code)}
                          />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{business.code}</TableCell>
                      <TableCell>{business.business_number || "-"}</TableCell>
                      <TableCell className="font-medium">{business.business_name}</TableCell>
                      <TableCell>{business.office_jurisdiction || "-"}</TableCell>
                      <TableCell>
                        {business.address ||
                          [business.address1, business.address2].filter(Boolean).join(" ") ||
                          "-"}
                      </TableCell>
                      <TableCell className="text-center">
                        {(() => {
                          const businessCount = business.unpaid_count || 0;
                          const nationalCount = business.national_unpaid_count || 0;

                          let textColor = "text-black";
                          if (businessCount > 0) textColor = "text-red-600 font-bold";
                          else if (nationalCount > 0) textColor = "text-blue-600 font-bold";

                          return (
                            <div className={textColor} title={`사업장 미수: ${businessCount}회 / 국고 미수: ${nationalCount}회`}>
                              {businessCount > 0 ? `${businessCount}회` : (nationalCount > 0 ? `(국)${nationalCount}회` : "-")}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2 justify-center">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditingSurvey(null);
                              // 미수금이 1회 이상인 경우 경고 모달 표시 (사업장 또는 국고)
                              if ((business.unpaid_count || 0) >= 1 || (business.national_unpaid_count || 0) >= 1) {
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

      {/* 목록 탭일 때 표시할 검색 필터 */}


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

                return filtered.length;
              })()}건)
            </h2>
            <div className="flex items-center gap-2">
              {/* 초기화 버튼 */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setListSearchParams({ measurementDate: "", businessName: "" });
                }}
                className="whitespace-nowrap h-10 px-3 mr-2"
              >
                초기화
              </Button>

              {/* 검색 그룹 */}
              <div className="flex items-center gap-2 mr-2 bg-slate-50 p-1 rounded-lg border border-slate-200">
                {/* 사업장명 검색 입력 필드 */}
                <div className="relative w-[300px]">
                  <Input
                    value={listSearchParams.businessName}
                    onChange={(e) => setListSearchParams({ ...listSearchParams, businessName: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        loadSurveys();
                      }
                    }}
                    placeholder="사업장명"
                    className="w-full h-9 border-none focus:ring-0 bg-transparent"
                    autoComplete="off"
                  />
                  {listSearchParams.businessName && (
                    <button
                      type="button"
                      onClick={() => setListSearchParams({ ...listSearchParams, businessName: "" })}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <span className="sr-only">지우기</span>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </div>

                <div className="h-5 w-px bg-slate-300 mx-1"></div>

                {/* 측정일자 검색 */}
                <Input
                  type="date"
                  value={listSearchParams.measurementDate}
                  onChange={(e) => setListSearchParams({ ...listSearchParams, measurementDate: e.target.value })}
                  className="w-[140px] h-9 border-none focus:ring-0 bg-transparent text-sm"
                  title="측정일자 검색"
                />

                {/* 검색 버튼 */}
                <Button onClick={loadSurveys} size="sm" className="h-8 px-4 ml-1 whitespace-nowrap">
                  검색
                </Button>
                {/* 일자 초기화 버튼 */}
                <Button
                  onClick={() => {
                    setListSearchParams((prev) => ({ ...prev, measurementDate: "" }));
                    // 즉시 검색 실행 (빈 날짜로)
                    loadSurveys({ measurementDate: "" });
                  }}
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2 ml-1 whitespace-nowrap"
                  title="측정일자 초기화"
                >
                  일자 초기화
                </Button>
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
                className="w-28 bg-orange-100 text-black font-bold [&>select]:bg-orange-100 [&>select]:text-black [&>select]:font-bold h-10 py-2 text-sm"
              />
              <Button variant="secondary" onClick={handleExportExcel} className="whitespace-nowrap h-10 px-3">
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


            // 정렬 로직
            const sortedSurveys = [...filteredSurveys].sort((a, b) => {
              if (sortConfig.key === "sequence_number") {
                const seqA = a.sequence_number || 999999;
                const seqB = b.sequence_number || 999999;
                return sortConfig.direction === "asc" ? seqA - seqB : seqB - seqA;
              } else if (sortConfig.key === "report_writer") {
                const writerA = a.report_writer || "";
                const writerB = b.report_writer || "";
                return sortConfig.direction === "asc"
                  ? writerA.localeCompare(writerB, 'ko')
                  : writerB.localeCompare(writerA, 'ko');
              } else {
                // measurement_date
                const dateA = new Date(a.measurement_date || "1900-01-01").getTime();
                const dateB = new Date(b.measurement_date || "1900-01-01").getTime();
                return sortConfig.direction === "asc" ? dateA - dateB : dateB - dateA;
              }
            });

            return sortedSurveys.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-text-500 text-lg">검색 결과가 없습니다.</p>
              </div>
            ) : (
              <div className="rounded-lg border border-surface-200 overflow-hidden">
                <div className="h-[calc(100vh-280px)] overflow-y-auto border-t border-slate-200">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 sticky top-0 z-10 text-xs uppercase font-semibold text-slate-500">
                      <tr>
                        <th className="px-2 py-3 text-left w-[55px] pl-2.5">
                          <div className="flex items-center gap-1">
                            <span>순번</span>
                            <button
                              onClick={() => setSortConfig(prev => ({
                                key: "sequence_number",
                                direction: prev.key === "sequence_number" && prev.direction === "asc" ? "desc" : "asc"
                              }))}
                              className={`hover:bg-slate-200 rounded p-0.5 ${sortConfig.key === "sequence_number" ? "text-primary-600" : "text-slate-400"}`}
                            >
                              {sortConfig.key === "sequence_number" && sortConfig.direction === "asc" ? "▲" : "▼"}
                            </button>
                          </div>
                        </th>
                        <th className="px-2 py-3 text-center w-[60px]">년도</th>
                        <th className="px-2 py-3 text-center w-[60px]">주기</th>
                        <th className="px-2 py-3 text-center w-[90px]">
                          <div className="flex items-center justify-center gap-1">
                            <span>측정일</span>
                            <button
                              onClick={() => setSortConfig(prev => ({
                                key: "measurement_date",
                                direction: prev.key === "measurement_date" && prev.direction === "desc" ? "asc" : "desc"
                              }))}
                              className={`hover:bg-slate-200 rounded p-0.5 ${sortConfig.key === "measurement_date" ? "text-primary-600" : "text-slate-400"}`}
                            >
                              {sortConfig.key === "measurement_date" && sortConfig.direction === "asc" ? "▲" : "▼"}
                            </button>
                          </div>
                        </th>
                        <th className="px-2 py-3 text-center w-[90px]">종료일</th>
                        <th className="px-2 py-3 text-center w-[120px]">측정요일</th>
                        <th className="px-2 py-3 text-left">사업장명</th>
                        <th className="px-2 py-3 text-center w-[120px]">사업자번호</th>
                        <th className="px-2 py-3 text-center w-[100px]">측정자</th>
                        <th className="px-2 py-3 text-center w-[100px]">공시료코드</th>
                        <th className="px-2 py-3 text-center w-[130px]">예비조사자</th>
                        <th className="px-2 py-3 text-center w-[100px]">실측정자</th>
                        <th className="px-2 py-3 text-center w-[130px]">
                          <div className="flex items-center justify-center gap-1">
                            <span>보고서</span>
                            <button
                              onClick={() => setSortConfig(prev => ({
                                key: "report_writer",
                                direction: prev.key === "report_writer" && prev.direction === "desc" ? "asc" : "desc"
                              }))}
                              className={`hover:bg-slate-200 rounded p-0.5 ${sortConfig.key === "report_writer" ? "text-primary-600" : "text-slate-400"}`}
                            >
                              {sortConfig.key === "report_writer" && sortConfig.direction === "asc" ? "▲" : "▼"}
                            </button>
                          </div>
                        </th>
                        <th className="px-2 py-3 text-center w-[140px]">작업</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {sortedSurveys.map((survey) => (
                        <tr key={survey.id} className="hover:bg-slate-50/50 group relative growable-row">
                          <td className="px-2 py-2 text-left w-[55px] pl-2.5">
                            {/* 표준 호버 인디케이터 바 */}
                            <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                            {survey.sequence_number || "-"}
                          </td>
                          <td className="px-2 py-2 text-center">{survey.year || "-"}</td>
                          <td className="px-2 py-2 text-center">{survey.period || "-"}</td>
                          <td className="px-2 py-2 text-center">
                            {survey.measurement_date
                              ? formatDateYYYYMMDD(new Date(survey.measurement_date))
                              : "-"}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {survey.end_date ? formatDateYYYYMMDD(new Date(survey.end_date)) : "-"}
                          </td>
                          <td className="px-2 py-2 text-center text-xs">
                            {survey.measurement_weekdays || calculateMeasurementWeekdays(survey.measurement_date, survey.end_date) || "-"}
                          </td>
                          <td className="px-2 py-2 font-medium truncate max-w-[200px]" title={survey.business_name}>{survey.business_name}</td>
                          <td className="px-2 py-2 text-center">{survey.business_number || "-"}</td>
                          <td className="px-2 py-2 text-center text-xs truncate max-w-[100px]" title={survey.measurer || ""}>{survey.measurer || "-"}</td>
                          <td className="px-2 py-2 text-center text-xs">{survey.survey_code || "-"}</td>
                          <td className="px-2 py-2 text-center text-xs truncate max-w-[130px]" title={survey.preliminary_surveyor || ""}>{survey.preliminary_surveyor || "-"}</td>
                          <td className="px-2 py-2 text-center text-xs truncate max-w-[100px]" title={survey.actual_measurer || ""}>{survey.actual_measurer || "-"}</td>
                          <td className="px-2 py-2 text-center text-xs truncate max-w-[100px]" title={survey.report_writer || ""}>{survey.report_writer || "-"}</td>
                          <td className="px-2 py-2 text-center">
                            <div className="flex gap-1 justify-center whitespace-nowrap">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleEditSurvey(survey)}
                                className="h-7 px-2 text-xs"
                              >
                                수정
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleDeleteSurvey(survey.id)}
                                className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
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
      )
      }

      {
        loading && (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        )
      }

      {/* 예비조사 입력/수정 모달 */}
      {
        isFormOpen && (
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
                    notes: editingSurvey.notes ?? undefined,
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
        )
      }

      {/* 일괄 등록 모달 */}
      {
        isBulkRegisterModalOpen && (
          <Modal
            isOpen={isBulkRegisterModalOpen}
            onClose={() => setIsBulkRegisterModalOpen(false)}
            title="예비조사 일괄 등록"
            size="lg"
          >
            <BulkRegisterModal
              selectedBusinesses={businesses
                .filter(b => selectedBusinessCodes.has(b.code))
                .map(b => ({
                  ...b,
                  address: b.address || [b.address1, b.address2].filter(Boolean).join(" ") || ""
                }))
              }
              onClose={() => setIsBulkRegisterModalOpen(false)}
              onSuccess={handleBulkSuccess}
            />
          </Modal>
        )
      }
    </div >
  );
}
