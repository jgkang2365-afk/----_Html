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
import { Textarea } from "@/components/ui/Textarea";
import { formatDateYYYYMMDD } from "@/lib/utils/date-utils";
import { normalizeDateForInput } from "@/lib/utils/date-normalize";
import { formatBusinessNumber, parseBusinessNumber } from "@/lib/utils/business-number";

// 금액 포맷팅 함수 (천단위 콤마)
const formatCurrency = (value: string | number | null | undefined): string => {
  if (!value && value !== 0) return "";
  const numValue = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : value;
  if (isNaN(numValue)) return "";
  return numValue.toLocaleString("ko-KR");
};

// 금액 파싱 함수 (콤마 제거)
const parseCurrency = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toString();
  if (typeof value !== "string") return String(value);
  return value.replace(/,/g, "");
};

interface SummaryEntry {
  id: number;
  journal_id: number;
  survey_id: number | null;
  code: string;
  measurement_year: number;
  measurement_period: string;
  note: string | null;
  document_number: string | null; // 수정 불가
  sequence_number: string | null; // 수정 불가
  five_plus_sequence: string | null; // 수정 불가
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  measurer: string | null;
  preliminary_surveyor: string | null;
  actual_measurer: string | null;
  report_writer: string | null;
  survey_code: string | null;
  survey_measurement_date: string | null;
  survey_end_date: string | null;
  survey_measurement_weekdays: string | null;
  office_jurisdiction: string | null;
  business_name: string;
  total_employees: number | null;
  business_number: string | null;
  industrial_accident_number: string | null;
  national_support_status: string | null;
  manager_name: string | null;
  manager_position: string | null;
  manager_mobile: string | null;
  manager_email: string | null;
  invoice_email: string | null;
  address: string | null;
  phone: string | null;
  fax: string | null;
  commencement_number: string | null;
  k2b_send_date: string | null;
  k2b_sender: string | null;
  measurement_fee_business: number | null;
  special_notes: string | null;
  completion_status: string;
  created_at: string;
  updated_at: string;
}

export const SummaryTable: React.FC = () => {
  // 초기값 설정
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const currentPeriod = currentMonth <= 6 ? "상반기" : "하반기";

  // 검색 관련 상태
  const [searchParams, setSearchParams] = useState({
    measurementYear: currentYear.toString(),
    measurementPeriod: currentPeriod,
    businessName: "",
    designatedOffice: "",
  });
  const [results, setResults] = useState<SummaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 수정 모달 관련 상태
  const [selectedEntry, setSelectedEntry] = useState<SummaryEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<SummaryEntry>>({});
  const [saving, setSaving] = useState(false);

  // 측정년도 옵션 생성 (현재 년도 기준 -5년 ~ +1년, 내림차순)
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
  const designatedOfficeOptions = DESIGNATED_OFFICE_OPTIONS;

  // 검색 실행
  const handleSearch = async () => {
    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);

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

      const response = await fetch(`/api/summary?${params.toString()}`);
      const result = await response.json();

      if (response.ok) {
        setResults(result.data || []);
      } else {
        setError(result.error || "검색 중 오류가 발생했습니다.");
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

  // 페이지 로드 시 자동 검색
  useEffect(() => {
    handleSearch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 수정 모달 열기
  const handleEdit = (entry: SummaryEntry) => {
    setSelectedEntry(entry);
    setEditFormData({
      measurement_start_date: normalizeDateForInput(entry.measurement_start_date),
      measurement_end_date: normalizeDateForInput(entry.measurement_end_date),
      measurer: entry.measurer || "",
      business_name: entry.business_name || "",
      total_employees: entry.total_employees || null,
      business_number: entry.business_number || "",
      industrial_accident_number: entry.industrial_accident_number || "",
      address: entry.address || "",
      phone: entry.phone || "",
      fax: entry.fax || "",
      manager_name: entry.manager_name || "",
      manager_position: entry.manager_position || "",
      manager_mobile: entry.manager_mobile || "",
      manager_email: entry.manager_email || "",
      invoice_email: entry.invoice_email || "",
      commencement_number: entry.commencement_number || "",
      k2b_send_date: normalizeDateForInput(entry.k2b_send_date),
      k2b_sender: entry.k2b_sender || "",
      measurement_fee_business: entry.measurement_fee_business || null,
      national_support_status: entry.national_support_status || "",
      special_notes: entry.special_notes || "",
    });
    setIsModalOpen(true);
  };

  // 수정 저장
  const handleSave = async () => {
    if (!selectedEntry) return;

    try {
      setSaving(true);
      setError(null);

      // 저장할 데이터 준비 (빈 문자열을 null로 변환)
      const saveData = { ...editFormData };

      // national_support_status 빈 문자열을 null로 변환
      if (saveData.national_support_status === "") {
        saveData.national_support_status = null;
      }

      // measurement_fee_business가 문자열인 경우 숫자로 변환
      if (typeof saveData.measurement_fee_business === "string") {
        const parsed = parseCurrency(saveData.measurement_fee_business);
        saveData.measurement_fee_business = parsed ? parseFloat(parsed) : null;
      }

      const response = await fetch(`/api/summary/${selectedEntry.journal_id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(saveData),
      });

      if (!response.ok) {
        let errorMessage = "저장 중 오류가 발생했습니다.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
        } catch {
          errorMessage = `서버 오류 (${response.status})`;
        }
        setError(errorMessage);
        return;
      }

      const result = await response.json();

      if (result.success) {
        setIsModalOpen(false);
        setSelectedEntry(null);
        // 검색 결과 새로고침
        handleSearch();
      } else {
        setError(result.error || "저장 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("저장 오류:", err);
      setError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 검색 폼 */}
      <Card className="p-4">
        <h2 className="text-lg font-semibold text-text-900 mb-4">검색 조건</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">
              측정년도
            </label>
            <Select
              value={searchParams.measurementYear}
              onChange={(e) =>
                setSearchParams({ ...searchParams, measurementYear: e.target.value })
              }
              options={[
                { value: "", label: "전체" },
                ...yearOptions,
              ]}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">
              측정주기
            </label>
            <Select
              value={searchParams.measurementPeriod}
              onChange={(e) =>
                setSearchParams({ ...searchParams, measurementPeriod: e.target.value })
              }
              options={periodOptions}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">
              지정지청
            </label>
            <Select
              value={searchParams.designatedOffice}
              onChange={(e) =>
                setSearchParams({ ...searchParams, designatedOffice: e.target.value })
              }
              options={designatedOfficeOptions}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-700 mb-1">
              사업장명
            </label>
            <Input
              value={searchParams.businessName}
              onChange={(e) =>
                setSearchParams({ ...searchParams, businessName: e.target.value })
              }
              placeholder="사업장명 입력"
              autoComplete="off"
            />
          </div>
          <div className="flex items-end">
            <Button variant="primary" onClick={handleSearch} disabled={loading}>
              {loading ? "검색 중..." : "검색"}
            </Button>
          </div>
        </div>
      </Card>

      {/* 오류 메시지 */}
      {error && <Alert variant="error">{error}</Alert>}

      {/* 검색 결과 */}
      {hasSearched && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-900">
              검색 결과 ({results.length}건)
            </h2>
          </div>
          {loading ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : results.length === 0 ? (
            <p className="text-text-500 text-center py-8">검색 결과가 없습니다.</p>
          ) : (
            <Table maxHeight="max-h-[calc(100vh-300px)]">
              <TableHeader>
                <TableRow>
                  <TableHead>측정년도</TableHead>
                  <TableHead>측정주기</TableHead>
                  <TableHead>사업장명</TableHead>
                  <TableHead>공문연번</TableHead>
                  <TableHead>연번</TableHead>
                  <TableHead>5인 이상 연번</TableHead>
                  <TableHead>측정시작일</TableHead>
                  <TableHead>측정종료일</TableHead>
                  <TableHead>측정자</TableHead>
                  <TableHead>예비조사자</TableHead>
                  <TableHead>실측정자</TableHead>
                  <TableHead>보고서 담당</TableHead>
                  <TableHead>완료여부</TableHead>
                  <TableHead>작업</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.measurement_year}</TableCell>
                    <TableCell>{entry.measurement_period}</TableCell>
                    <TableCell className="font-medium">{entry.business_name}</TableCell>
                    <TableCell className="bg-surface-50 font-mono">
                      {entry.document_number || "-"}
                    </TableCell>
                    <TableCell className="bg-surface-50 font-mono">
                      {entry.sequence_number || "-"}
                    </TableCell>
                    <TableCell className="bg-surface-50 font-mono">
                      {entry.five_plus_sequence || "-"}
                    </TableCell>
                    <TableCell>
                      {entry.measurement_start_date
                        ? formatDateYYYYMMDD(entry.measurement_start_date)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {entry.measurement_end_date
                        ? formatDateYYYYMMDD(entry.measurement_end_date)
                        : "-"}
                    </TableCell>
                    <TableCell>{entry.measurer || "-"}</TableCell>
                    <TableCell>{entry.preliminary_surveyor || "-"}</TableCell>
                    <TableCell>{entry.actual_measurer || "-"}</TableCell>
                    <TableCell>{entry.report_writer || "-"}</TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-xs ${entry.completion_status === "완료"
                          ? "bg-success-100 text-success-700"
                          : "bg-warning-100 text-warning-700"
                          }`}
                      >
                        {entry.completion_status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleEdit(entry)}
                        className={entry.completion_status === "완료"
                          ? ""
                          : "bg-yellow-100 hover:bg-yellow-200 text-yellow-900 border-yellow-200"
                        }
                      >
                        {entry.completion_status === "완료" ? "조회" : "수정"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* 수정 모달 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedEntry(null);
          setEditFormData({});
        }}
        title="측정정보 요약"
        size="xl"
        headerActions={
          <div className="flex gap-2">
            {selectedEntry?.completion_status !== "완료" && (
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "저장 중..." : "저장"}
              </Button>
            )}
            <Button
              type="button"
              variant="success"
              onClick={() => window.print()}
            >
              출력
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                setSelectedEntry(null);
                setEditFormData({});
              }}
            >
              {selectedEntry?.completion_status === "완료" ? "닫기" : "취소"}
            </Button>
          </div>
        }
      >
        {selectedEntry && (
          <div className="space-y-4">
            {/* 수정 불가 필드 (읽기 전용) */}
            <div className="bg-surface-50 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-text-900 mb-3">수정 불가 필드</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-text-600 mb-1 text-sm">공문연번</label>
                  <div className="font-bold bg-white p-2 rounded border text-base">
                    {selectedEntry.document_number || "-"}
                  </div>
                </div>
                <div>
                  <label className="block text-text-600 mb-1 text-sm">연번</label>
                  <div className="font-bold bg-white p-2 rounded border text-base">
                    {selectedEntry.sequence_number || "-"}
                  </div>
                </div>
                <div>
                  <label className="block text-text-600 mb-1 text-sm">5인 이상 연번</label>
                  <div className="font-bold bg-white p-2 rounded border text-base">
                    {selectedEntry.five_plus_sequence || "-"}
                  </div>
                </div>
                <div>
                  <label className="block text-text-600 mb-1 text-sm">예비조사자명(공시료 코드)</label>
                  <div className="bg-white p-2 rounded border text-base">
                    {selectedEntry.preliminary_surveyor || "-"}
                    {selectedEntry.survey_code && (
                      <span className="text-text-500"> ({selectedEntry.survey_code})</span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-text-600 mb-1 text-sm">측정자</label>
                  <div className="bg-white p-2 rounded border text-base">
                    {selectedEntry.measurer || "-"}
                  </div>
                </div>
                <div>
                  <label className="block text-text-600 mb-1 text-sm">보고서 담당</label>
                  <div className="bg-white p-2 rounded border text-base">
                    {selectedEntry.report_writer || "-"}
                  </div>
                </div>
              </div>
            </div>

            {/* 수정 가능 필드 */}
            <div className="space-y-6">
              <h3 className="font-semibold text-text-900 mb-3">
                {selectedEntry.completion_status === "완료" ? "조회 가능 필드" : "수정 가능 필드"}
              </h3>

              {/* 측정 정보 */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-700 border-b pb-1">측정 정보</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      측정시작일
                    </label>
                    <Input
                      type="date"
                      value={normalizeDateForInput(editFormData.measurement_start_date)}
                      onChange={(e) => {
                        const startDate = e.target.value;
                        setEditFormData((prev) => {
                          const updated = { ...prev, measurement_start_date: startDate };
                          // 종료일이 비어있거나 측정 시작일과 동일한 경우 종료일을 측정 시작일과 동일하게 설정
                          if (!prev.measurement_end_date || prev.measurement_end_date === prev.measurement_start_date) {
                            updated.measurement_end_date = startDate;
                          }
                          return updated;
                        });
                      }}
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      측정종료일
                    </label>
                    <Input
                      type="date"
                      value={normalizeDateForInput(editFormData.measurement_end_date)}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          measurement_end_date: e.target.value,
                        })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-700 border-b pb-1">사업장 정보</h4>
                <div className="grid grid-cols-12 gap-4">
                  <div className="col-span-10">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      사업장명
                    </label>
                    <Input
                      value={editFormData.business_name || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, business_name: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      총인원
                    </label>
                    <Input
                      type="number"
                      value={editFormData.total_employees || ""}
                      onChange={(e) =>
                        setEditFormData({
                          ...editFormData,
                          total_employees: e.target.value ? parseInt(e.target.value) : null,
                        })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                      className="text-right"
                    />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      사업자번호
                    </label>
                    <Input
                      value={formatBusinessNumber(editFormData.business_number)}
                      onChange={(e) => {
                        const numbers = parseBusinessNumber(e.target.value);
                        setEditFormData({ ...editFormData, business_number: numbers });
                      }}
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      산재관리번호
                    </label>
                    <Input
                      value={editFormData.industrial_accident_number || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, industrial_accident_number: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div className="col-span-4">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      개시번호
                    </label>
                    <Input
                      value={editFormData.commencement_number || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, commencement_number: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div className="col-span-12">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      주소
                    </label>
                    <Input
                      value={editFormData.address || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, address: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div className="col-span-6">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      전화번호
                    </label>
                    <Input
                      value={editFormData.phone || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, phone: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div className="col-span-6">
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      팩스
                    </label>
                    <Input
                      value={editFormData.fax || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, fax: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                </div>
              </div>

              {/* 담당자 정보 */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-700 border-b pb-1">담당자 정보</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      담당자명
                    </label>
                    <Input
                      value={editFormData.manager_name || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, manager_name: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      담당자 직책
                    </label>
                    <Input
                      value={editFormData.manager_position || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, manager_position: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      담당자 휴대폰
                    </label>
                    <Input
                      value={editFormData.manager_mobile || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, manager_mobile: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      담당자 이메일
                    </label>
                    <Input
                      type="email"
                      value={editFormData.manager_email || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, manager_email: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      계산서 메일(주가)
                    </label>
                    <Input
                      type="email"
                      value={editFormData.invoice_email || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, invoice_email: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                </div>
              </div>

              {/* K2B 정보 */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-700 border-b pb-1">K2B 정보</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      K2B 발송일
                    </label>
                    <Input
                      type="date"
                      value={normalizeDateForInput(editFormData.k2b_send_date)}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, k2b_send_date: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      K2B 발송자
                    </label>
                    <Input
                      value={editFormData.k2b_sender || ""}
                      onChange={(e) =>
                        setEditFormData({ ...editFormData, k2b_sender: e.target.value })
                      }
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                </div>
              </div>

              {/* 측정비 정보 */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-700 border-b pb-1">측정비 정보</h4>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      측정비(사업장)
                    </label>
                    <Input
                      type="text"
                      value={formatCurrency(editFormData.measurement_fee_business)}
                      onChange={(e) => {
                        const parsed = parseCurrency(e.target.value);
                        setEditFormData({
                          ...editFormData,
                          measurement_fee_business: parsed ? parseFloat(parsed) : null,
                        });
                      }}
                      placeholder="숫자만 입력"
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-text-700 mb-1">
                      국고지원 여부
                    </label>
                    <Select
                      value={editFormData.national_support_status || ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        // "대상"을 "지원"으로 변환
                        const convertedValue = value === "대상" ? "지원" : value;
                        setEditFormData({ ...editFormData, national_support_status: convertedValue || "" });
                      }}
                      options={[
                        { value: "", label: "선택" },
                        { value: "지원", label: "지원" },
                        { value: "비대상", label: "비대상" },
                      ]}
                      disabled={selectedEntry.completion_status === "완료"}
                    />
                  </div>
                </div>
              </div>

              {/* 특이사항 */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-text-700 border-b pb-1">특이사항</h4>
                <div>
                  <Textarea
                    value={editFormData.special_notes || ""}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, special_notes: e.target.value })
                    }
                    placeholder="특이사항을 입력하세요"
                    rows={4}
                    disabled={selectedEntry.completion_status === "완료"}
                  />
                </div>
              </div>
            </div>

          </div>
        )}
      </Modal>
    </div>
  );
};
