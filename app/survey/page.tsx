"use client";

import React, { useState, useEffect } from "react";
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

  const handleNewSurvey = () => {
    setEditingSurvey(null);
    setSelectedBusinessForForm(null); // 신규 등록 시 사업장 정보 초기화
    setIsFormOpen(true);
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
        <Button variant="primary" onClick={handleNewSurvey}>
          신규 등록
        </Button>
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
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "search"
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
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "list"
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
            placeholder="코드 입력"
          />
          <Input
            label="사업자번호"
            value={searchParams.businessNumber}
            onChange={(e) =>
              setSearchParams({ ...searchParams, businessNumber: e.target.value })
            }
            placeholder="사업자번호 입력"
          />
          <Input
            label="사업장명"
            value={searchParams.businessName}
            onChange={(e) =>
              setSearchParams({ ...searchParams, businessName: e.target.value })
            }
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
                      <TableCell>
                        <div className="flex gap-2 justify-center">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setEditingSurvey(null);
                              setSelectedBusinessForForm(business); // 선택된 사업장 정보 저장
                              setIsFormOpen(true);
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

      {/* 예비조사 목록 (예비조사 목록 탭) */}
      {activeTab === "list" && !loading && (
        <Card className="p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-text-900">
              예비조사 목록 ({surveys.length}건)
            </h2>
            <Button variant="secondary" onClick={handleExportExcel}>
              엑셀 다운로드
            </Button>
          </div>

          {surveys.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-text-500 text-lg">검색 결과가 없습니다.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-surface-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="bg-surface-50">측정일</TableHead>
                    <TableHead className="bg-surface-50">종료일</TableHead>
                    <TableHead className="bg-surface-50">측정요일</TableHead>
                    <TableHead className="bg-surface-50">사업장명</TableHead>
                    <TableHead className="bg-surface-50">측정자</TableHead>
                    <TableHead className="bg-surface-50">공시료 코드</TableHead>
                    <TableHead className="bg-surface-50">예비조사자</TableHead>
                    <TableHead className="bg-surface-50">실측정자</TableHead>
                    <TableHead className="bg-surface-50">보고서 담당</TableHead>
                    <TableHead className="bg-surface-50 text-center">작업</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {surveys.map((survey) => (
                    <TableRow key={survey.id} className="hover:bg-surface-50">
                      <TableCell>
                        {survey.measurement_date
                          ? formatDateYYYYMMDD(new Date(survey.measurement_date))
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {survey.end_date ? formatDateYYYYMMDD(new Date(survey.end_date)) : "-"}
                      </TableCell>
                      <TableCell>{survey.measurement_weekdays || "-"}</TableCell>
                      <TableCell className="font-medium">{survey.business_name}</TableCell>
                      <TableCell className="text-text-600">{survey.measurer || "-"}</TableCell>
                      <TableCell>{survey.survey_code || "-"}</TableCell>
                      <TableCell className="text-text-600">{survey.preliminary_surveyor || "-"}</TableCell>
                      <TableCell className="text-text-600">{survey.actual_measurer || "-"}</TableCell>
                      <TableCell className="text-text-600">{survey.report_writer || "-"}</TableCell>
                      <TableCell>
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
                    code: editingSurvey.code,
                    business_name: editingSurvey.business_name,
                    measurement_date: editingSurvey.measurement_date,
                    end_date: editingSurvey.end_date ?? undefined,
                    measurement_weekdays: editingSurvey.measurement_weekdays ?? undefined,
                    measurer: editingSurvey.measurer ?? undefined,
                    survey_code: editingSurvey.survey_code ?? undefined,
                    address: editingSurvey.address ?? undefined,
                    preliminary_surveyor: editingSurvey.preliminary_surveyor ?? undefined,
                    actual_measurer: editingSurvey.actual_measurer ?? undefined,
                    report_writer: editingSurvey.report_writer ?? undefined,
                  }
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
