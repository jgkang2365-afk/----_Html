"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
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
  designated_office: string | null; // 지정지청 추가 (약칭)
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
  invoice_email_2: string | null;
  electronic_invoice_date: string | null;
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
    measurementDate: "",
    reportWriter: "",
  });
  const [measurementUsers, setMeasurementUsers] = useState<{ label: string; value: string }[]>([]);
  const [results, setResults] = useState<SummaryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 수정 모달 관련 상태
  const [selectedEntry, setSelectedEntry] = useState<SummaryEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<SummaryEntry>>({});
  const [saving, setSaving] = useState(false);

  // 일괄 인쇄 선택 상태
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isBulkPrintMode, setIsBulkPrintMode] = useState(false);

  // 전체 선택/해제
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(results.map(r => r.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  // 개별 선택/해제
  const handleSelect = (id: number, checked: boolean) => {
    const newSelected = new Set(selectedIds);
    if (checked) {
      newSelected.add(id);
    } else {
      newSelected.delete(id);
    }
    setSelectedIds(newSelected);
  };


  // 측정년도 옵션 생성 (현재 년도 기준 -5년 ~ +1년, 내림차순)
  const yearOptions = [
    { value: "", label: "전체" },
    ...Array.from({ length: 7 }, (_, i) => {
      const year = currentYear - 5 + i;
      return { value: year.toString(), label: year.toString() };
    }).reverse()
  ];

  // 측정주기 옵션
  const periodOptions = [
    { value: "", label: "전체" },
    { value: "상반기", label: "상반기 + 수시" },
    { value: "하반기", label: "하반기 + 수시" },
  ];

  // 지정한계_관할지청 옵션
  const designatedOfficeOptions = DESIGNATED_OFFICE_OPTIONS;

  // 사용자 목록 로드 (측정 작무)
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch("/api/users");
        if (res.ok) {
          const data = await res.json();
          const users = data.users || [];
          const filtered = users
            .filter((u: any) => u.job === "측정")
            .map((u: any) => ({ label: u.name, value: u.name }));
          setMeasurementUsers([{ value: "", label: "전체" }, ...filtered]);
        }
      } catch (e) {
        console.error("사용자 목록 로드 실패:", e);
      }
    };
    fetchUsers();
  }, []);



  const [quotas, setQuotas] = useState<any[]>([]);

  // 검색 실행
  const handleSearch = async () => {
    try {
      setLoading(true);
      setError(null);
      setHasSearched(true);

      // 1. 쿼터 데이터 로드
      try {
        const quotasResponse = await fetch(`/api/admin/quotas`);
        if (quotasResponse.ok) {
          const quotasData = await quotasResponse.json();
          setQuotas(quotasData.data || []);
        }
      } catch (e) {
        console.error("쿼터 로드 실패:", e);
      }

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
      if (searchParams.measurementDate) {
        params.append("measurementDate", searchParams.measurementDate);
      }
      if (searchParams.reportWriter) {
        params.append("reportWriter", searchParams.reportWriter);
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
      invoice_email_2: entry.invoice_email_2 || "",
      electronic_invoice_date: normalizeDateForInput(entry.electronic_invoice_date),
      commencement_number: entry.commencement_number || "",
      k2b_send_date: normalizeDateForInput(entry.k2b_send_date),
      k2b_sender: (entry.report_writer ? entry.report_writer.split(',')[0].trim() : "") || entry.k2b_sender || "",
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

  // 인쇄 미리보기 포탈 (모달과 유사하게 동작하여 인쇄 CSS 호환성 확보)
  const PrintPreviewPortal = () => {
    if (typeof window === "undefined") return null;

    const selectedEntries = results.filter(r => selectedIds.has(r.id));

    return createPortal(
      <div className="fixed inset-0 z-[100] bg-white overflow-auto" role="dialog" aria-modal="true">
        {/* 인쇄 미리보기 헤더 (인쇄 시 숨김) */}
        <div className="sticky top-0 z-50 flex items-center justify-between p-4 bg-white border-b shadow-sm print:hidden">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-text-900">
              인쇄 미리보기 <span className="text-base font-normal text-text-500">({selectedEntries.length}건)</span>
            </h2>
            <p className="text-sm text-text-500">
              * 아래 내용대로 출력됩니다. 확인 후 인쇄 버튼을 눌러주세요.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="success"
              onClick={() => window.print()}
              className="flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              인쇄
            </Button>
            <Button
              variant="secondary"
              onClick={() => setIsBulkPrintMode(false)}
            >
              닫기
            </Button>
          </div>
        </div>

        {/* 인쇄 내용 (화면 및 출력 모두 보임) */}
        <div className="p-8 print:p-0 space-y-8 print:space-y-0 bg-slate-100 print:bg-white min-h-screen">
          {selectedEntries.map((entry, index) => (
            <div
              key={entry.id}
              className="break-after-page page-break-always bg-white p-8 rounded-lg shadow-sm print:shadow-none print:rounded-none print:p-0 max-w-[210mm] mx-auto print:max-w-none"
              style={{ pageBreakAfter: 'always' }}
            >
              <div className="mb-8 print:mb-8">
                <h2 className="text-2xl font-bold text-center mb-2">측정정보 요약</h2>
                <div className="flex justify-between items-end border-b-2 border-black pb-2 mt-4">
                  <div className="text-sm">
                    <span className="font-bold">측정년도/주기:</span> {entry.measurement_year}년 {entry.measurement_period}
                  </div>
                  <div className="text-sm">
                    출력일: {new Date().toLocaleDateString()}
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                {/* 수정 불가 필드 (읽기 전용) */}
                <div className="bg-surface-50 p-4 rounded-lg space-y-2 border">
                  <h3 className="font-semibold text-text-900 mb-3 px-1">기본 정보</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-3 md:gap-4">
                    <div className="p-1">
                      <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">공문연번</label>
                      <div className="font-bold bg-white p-2.5 rounded-lg border text-base text-text-900 shadow-sm">
                        {entry.document_number || "-"}
                      </div>
                    </div>
                    <div className="p-1">
                      <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">연번</label>
                      <div className="font-bold bg-white p-2.5 rounded-lg border text-base text-text-900 shadow-sm">
                        {entry.sequence_number || "-"}
                      </div>
                    </div>
                    <div className="p-1">
                      <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">5인 이상 연번</label>
                      <div className="font-bold bg-white p-2.5 rounded-lg border text-base text-text-900 shadow-sm">
                        {entry.five_plus_sequence || "-"}
                        {(() => {
                          // 1. 정확히 일치하는 주기 검색
                          let quota = quotas.find(
                            (q) =>
                              q.year === entry.measurement_year &&
                              q.period === entry.measurement_period &&
                              q.office_name === entry.designated_office
                          );

                          // 2. '(수시)'가 포함된 경우, '(수시)'를 제거한 주기로 검색
                          if (!quota && entry.measurement_period.includes('(수시)')) {
                            const basePeriod = entry.measurement_period.replace('(수시)', '');
                            quota = quotas.find(
                              (q) =>
                                q.year === entry.measurement_year &&
                                q.period === basePeriod &&
                                q.office_name === entry.designated_office
                            );
                          }

                          return quota ? <span className="text-gray-500 font-normal ml-1">/ {quota.quota}</span> : null;
                        })()}
                      </div>
                    </div>
                    <div className="p-1">
                      <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">예비조사자명(공시료 코드)</label>
                      <div className="bg-white p-2.5 rounded-lg border text-base text-text-800 shadow-sm">
                        {entry.preliminary_surveyor || "-"}
                        {entry.survey_code && (
                          <span className="text-text-500 ml-1.5 font-normal">({entry.survey_code})</span>
                        )}
                      </div>
                    </div>
                    <div className="p-1">
                      <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">측정자</label>
                      <div className="bg-white p-2.5 rounded-lg border text-base text-text-800 shadow-sm">
                        {entry.measurer || "-"}
                      </div>
                    </div>
                    <div className="p-1">
                      <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">보고서 담당</label>
                      <div className="bg-white p-2.5 rounded-lg border text-base text-text-800 shadow-sm">
                        {entry.report_writer || "-"}
                      </div>
                    </div>
                  </div>
                </div>

                <hr className="border-gray-200" />

                {/* 측정 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">측정 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        측정시작일
                      </label>
                      <Input
                        type="date"
                        className="h-11 md:h-10 text-base md:text-sm bg-white font-bold text-black"
                        value={normalizeDateForInput(entry.measurement_start_date)}
                        disabled
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        측정종료일
                      </label>
                      <Input
                        type="date"
                        className="h-11 md:h-10 text-base md:text-sm bg-white font-bold text-black"
                        value={normalizeDateForInput(entry.measurement_end_date)}
                        disabled
                      />
                    </div>
                  </div>
                </div>

                {/* 사업장 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">사업장 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-12 print:grid-cols-12 gap-3 md:gap-4">
                    <div className="md:col-span-10 print:col-span-10 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        사업장명
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.business_name || ""}
                        disabled
                      />
                    </div>
                    <div className="md:col-span-2 print:col-span-2 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        총인원
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm text-right shadow-sm bg-white font-bold text-black"
                        type="number"
                        value={entry.total_employees || ""}
                        disabled
                      />
                    </div>
                    <div className="md:col-span-4 print:col-span-4 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        사업자번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={formatBusinessNumber(entry.business_number)}
                        disabled
                      />
                    </div>
                    <div className="md:col-span-4 print:col-span-4 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        산재관리번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.industrial_accident_number || ""}
                        disabled
                      />
                    </div>
                    <div className="md:col-span-4 print:col-span-4 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        개시번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.commencement_number || ""}
                        disabled
                      />
                    </div>
                    <div className="md:col-span-12 print:col-span-12 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        주소
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.address || ""}
                        disabled
                      />
                    </div>
                    <div className="md:col-span-6 print:col-span-6 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        전화번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.phone || ""}
                        disabled
                      />
                    </div>
                    <div className="md:col-span-6 print:col-span-6 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        팩스
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.fax || ""}
                        disabled
                      />
                    </div>
                  </div>
                </div>

                {/* 담당자 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">담당자 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-3 md:gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        담당자명
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.manager_name || ""}
                        disabled
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        직책
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.manager_position || ""}
                        disabled
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        휴대폰
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.manager_mobile || ""}
                        disabled
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        이메일
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.manager_email || ""}
                        disabled
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        계산서 이메일
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.invoice_email || ""}
                        disabled
                      />
                    </div>
                  </div>
                </div>

                {/* K2B 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">K2B 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-3 md:gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        K2B 발송일
                      </label>
                      <Input
                        type="date"
                        className="h-11 md:h-10 text-base md:text-sm bg-white font-bold text-black"
                        value={normalizeDateForInput(entry.k2b_send_date)}
                        disabled
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        발송자
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.k2b_sender || ""}
                        disabled
                      />
                    </div>
                  </div>
                </div>

                {/* 측정비 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">측정비 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-3 md:gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        측정비(사업장)
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black text-right"
                        value={formatCurrency(entry.measurement_fee_business)}
                        disabled
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        국고지원 여부
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm bg-white font-bold text-black"
                        value={entry.national_support_status || ""}
                        disabled
                      />
                    </div>
                  </div>
                </div>

                {/* 특이사항 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">특이사항</h4>
                  <div className="p-1">
                    <textarea
                      className="w-full h-32 p-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none bg-white text-base md:text-sm shadow-sm font-bold text-black"
                      value={entry.special_notes || ""}
                      disabled
                    />
                  </div>
                </div>

              </div>
            </div>
          ))}
        </div>
      </div>,
      document.body
    );
  };

  return (
    <>
      <div className="space-y-4 print:hidden">

        {/* 검색 폼 */}
        <Card className="p-4">

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-[120px]">
              <label className="block text-sm font-medium text-text-700 mb-1">
                측정년도
              </label>
              <Select
                options={yearOptions}
                value={searchParams.measurementYear}
                onChange={(e) =>
                  setSearchParams({ ...searchParams, measurementYear: e.target.value })
                }
                className="h-10 py-2 text-center shadow-sm"
              />
            </div>
            <div className="w-[150px]">
              <label className="block text-sm font-medium text-text-700 mb-1">
                측정주기
              </label>
              <Select
                options={periodOptions}
                value={searchParams.measurementPeriod}
                onChange={(e) =>
                  setSearchParams({ ...searchParams, measurementPeriod: e.target.value })
                }
                className="h-10 py-2 text-center shadow-sm"
              />
            </div>
            <div className="w-[120px]">
              <label className="block text-sm font-medium text-text-700 mb-1">
                지정지청
              </label>
              <Select
                options={designatedOfficeOptions}
                value={searchParams.designatedOffice}
                onChange={(e) => {
                  setSearchParams({ ...searchParams, designatedOffice: e.target.value });
                }}
                className="h-10 py-2 text-center shadow-sm"
              />
            </div>
            <div className="w-[260px]">
              <label className="block text-sm font-medium text-text-700 mb-1">
                사업장명
              </label>
              <Input
                value={searchParams.businessName}
                onChange={(e) =>
                  setSearchParams({ ...searchParams, businessName: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSearch();
                  }
                }}
                placeholder="예: 사업장A, 사업장B"
                autoComplete="off"
                className="h-10"
              />
            </div>
            <div className="flex items-end gap-1">
              <div className="w-[210px]">
                <label className="block text-sm font-medium text-text-700 mb-1">
                  측정일
                </label>
                <Input
                  type="date"
                  value={searchParams.measurementDate}
                  onChange={(e) =>
                    setSearchParams({ ...searchParams, measurementDate: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleSearch();
                    }
                  }}
                  className="text-center px-1 h-10"
                />
              </div>
              {searchParams.measurementDate && (
                <button
                  onClick={() => setSearchParams({ ...searchParams, measurementDate: "" })}
                  className="text-blue-400 hover:text-blue-600 focus:outline-none mb-2.5"
                  title="날짜 초기화"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
            <div className="w-[150px]">
              <label className="block text-sm font-medium text-text-700 mb-1">
                보고서 담당자
              </label>
              <Select
                options={measurementUsers}
                value={searchParams.reportWriter}
                onChange={(e) =>
                  setSearchParams({ ...searchParams, reportWriter: e.target.value })
                }
                className="h-10 py-2 text-center shadow-sm"
              />
            </div>
            <div className="flex items-end ml-auto">
              <Button variant="primary" onClick={handleSearch} disabled={loading} className="whitespace-nowrap">
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
            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-lg font-semibold text-text-900">
                검색 결과 ({results.length}건)
              </h2>
              {selectedIds.size > 0 && (
                <Button
                  variant="success"
                  onClick={() => setIsBulkPrintMode(true)}
                  className="h-9 text-sm flex items-center gap-1"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                  </svg>
                  선택 인쇄 ({selectedIds.size}건)
                </Button>
              )}
            </div>
            {loading ? (
              <div className="flex justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : results.length === 0 ? (
              <p className="text-text-500 text-center py-8 font-medium">검색 결과가 없습니다.</p>
            ) : (
              <>
                {/* 데스크톱 테이블 뷰 (768px 이상) */}
                <div className="hidden md:block">
                  <Table maxHeight="max-h-[calc(100vh-300px)]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8 text-center bg-surface-50 p-0">
                          <div className="flex justify-center">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                              checked={results.length > 0 && selectedIds.size === results.length}
                              onChange={(e) => handleSelectAll(e.target.checked)}
                            />
                          </div>
                        </TableHead>
                        <TableHead className="w-14 text-center text-xs bg-surface-50">측정년도</TableHead>
                        <TableHead className="w-14 text-center text-xs bg-surface-50">측정주기</TableHead>
                        <TableHead className="w-[200px] text-xs bg-surface-50">사업장명</TableHead>
                        <TableHead className="w-14 text-center text-xs bg-surface-50">공문연번</TableHead>
                        <TableHead className="w-12 text-center text-xs bg-surface-50">연번</TableHead>
                        <TableHead className="w-14 text-center text-xs bg-surface-50 px-1">5인이상</TableHead>
                        <TableHead className="w-20 text-center text-xs bg-surface-50">측정시작일</TableHead>
                        <TableHead className="w-20 text-center text-xs bg-surface-50">측정종료일</TableHead>
                        <TableHead className="w-14 text-center text-xs bg-surface-50">측정자</TableHead>
                        <TableHead className="w-16 text-center text-xs bg-surface-50">예비조사자</TableHead>
                        <TableHead className="w-16 text-center text-xs bg-surface-50">실측정자</TableHead>
                        <TableHead className="w-16 text-center text-xs bg-surface-50">보고서 담당</TableHead>
                        <TableHead className="w-14 text-center text-xs bg-surface-50">완료여부</TableHead>
                        <TableHead className="w-12 text-center text-xs bg-surface-50">작업</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results.map((entry) => (
                        <TableRow key={entry.id} className="hover:bg-slate-50/50">
                          <TableCell className="p-1 text-center">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 h-4 w-4"
                              checked={selectedIds.has(entry.id)}
                              onChange={(e) => handleSelect(entry.id, e.target.checked)}
                            />
                          </TableCell>
                          <TableCell className="p-1 text-center text-xs font-medium">{entry.measurement_year}</TableCell>
                          <TableCell className="p-1 text-center text-xs">{entry.measurement_period}</TableCell>
                          <TableCell className="p-1 font-medium text-xs truncate max-w-[200px]" title={entry.business_name}>{entry.business_name}</TableCell>
                          <TableCell className="p-1 bg-surface-50 font-mono text-center text-xs">
                            {entry.document_number || "-"}
                          </TableCell>
                          <TableCell className="p-1 bg-surface-50 font-mono text-center text-xs">
                            {entry.sequence_number || "-"}
                          </TableCell>
                          <TableCell className="p-1 bg-surface-50 font-mono text-center text-xs">
                            {entry.five_plus_sequence || "-"}
                            {(() => {
                              // 1. 정확히 일치하는 주기 검색
                              let quota = quotas.find(
                                (q) =>
                                  q.year === entry.measurement_year &&
                                  q.period === entry.measurement_period &&
                                  q.office_name === entry.designated_office
                              );

                              // 2. '(수시)'가 포함된 경우, '(수시)'를 제거한 주기로 검색
                              if (!quota && entry.measurement_period && entry.measurement_period.includes('(수시)')) {
                                const basePeriod = entry.measurement_period.replace('(수시)', '');
                                quota = quotas.find(
                                  (q) =>
                                    q.year === entry.measurement_year &&
                                    q.period === basePeriod &&
                                    q.office_name === entry.designated_office
                                );
                              }

                              return quota ? <span className="text-gray-400 text-[10px] ml-1">/ {quota.quota}</span> : null;
                            })()}
                          </TableCell>
                          <TableCell className="p-1 text-center text-xs">
                            {entry.measurement_start_date
                              ? formatDateYYYYMMDD(entry.measurement_start_date)
                              : "-"}
                          </TableCell>
                          <TableCell className="p-1 text-center text-xs">
                            {entry.measurement_end_date
                              ? formatDateYYYYMMDD(entry.measurement_end_date)
                              : "-"}
                          </TableCell>
                          <TableCell className="p-1 text-center text-xs text-text-600">{entry.measurer || "-"}</TableCell>
                          <TableCell className="p-1 text-center text-xs text-text-600">{entry.preliminary_surveyor || "-"}</TableCell>
                          <TableCell className="p-1 text-center text-xs text-text-600">{entry.actual_measurer || "-"}</TableCell>
                          <TableCell className="p-1 text-center text-xs text-text-600">{entry.report_writer || "-"}</TableCell>
                          <TableCell className="p-1 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap ${entry.completion_status === "완료"
                                ? "bg-success-100 text-success-700"
                                : "bg-warning-100 text-warning-700"
                                }`}
                            >
                              {entry.completion_status}
                            </span>
                          </TableCell>
                          <TableCell className="p-1 text-center">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleEdit(entry)}
                              className={`h-7 px-1.5 text-xs ${entry.completion_status === "완료"
                                ? ""
                                : "bg-yellow-100 hover:bg-yellow-200 text-yellow-900 border-yellow-200"
                                }`}
                            >
                              {entry.completion_status === "완료" ? "조회" : "수정"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* 모바일 카드 뷰 (768px 미만) */}
                <div className="md:hidden space-y-4">
                  {results.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-4 border rounded-xl shadow-sm bg-white active:bg-surface-50 transition-colors"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-surface-100 text-text-600">
                              {entry.measurement_year} {entry.measurement_period}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-black tracking-tight ${entry.completion_status === "완료"
                                ? "bg-success-100 text-success-800"
                                : "bg-warning-100 text-warning-800"
                                }`}
                            >
                              {entry.completion_status}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-text-900 leading-tight">
                            {entry.business_name}
                          </h3>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleEdit(entry)}
                          className={`h-9 px-4 font-bold text-sm rounded-lg ${entry.completion_status === "완료"
                            ? "bg-surface-100 text-text-800"
                            : "bg-primary-600 text-white hover:bg-primary-700 border-none shadow-md"
                            }`}
                        >
                          {entry.completion_status === "완료" ? "조회" : "수정"}
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-sm mt-4 p-3 bg-surface-50 rounded-lg">
                        <div className="space-y-0.5">
                          <span className="text-[11px] font-bold text-text-400 uppercase tracking-widest">공문연번</span>
                          <p className="font-mono text-xs font-bold text-text-800">{entry.document_number || "-"}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[11px] font-bold text-text-400 uppercase tracking-widest">연번</span>
                          <p className="font-mono text-xs font-bold text-text-800">{entry.sequence_number || "-"}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[11px] font-bold text-text-400 uppercase tracking-widest">측정자</span>
                          <p className="font-medium text-text-700">{entry.measurer || "-"}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="text-[11px] font-bold text-text-400 uppercase tracking-widest">보고서 담당</span>
                          <p className="font-medium text-text-700">{entry.report_writer || "-"}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between text-xs font-medium text-text-500 px-1 border-t pt-3">
                        <div>
                          시작: <span className="text-text-700">{entry.measurement_start_date ? formatDateYYYYMMDD(entry.measurement_start_date) : "-"}</span>
                        </div>
                        <div className="w-4 h-[1px] bg-surface-200" />
                        <div>
                          종료: <span className="text-text-700">{entry.measurement_end_date ? formatDateYYYYMMDD(entry.measurement_end_date) : "-"}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
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
            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="primary" onClick={handleSave} disabled={saving} className="md:flex-none text-sm px-3 h-9">
                {saving ? "저장 중..." : "저장"}
              </Button>
              <Button
                type="button"
                variant="success"
                onClick={() => window.print()}
                className="md:flex-none text-sm px-3 h-9"
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
                className="md:flex-none text-sm px-3 h-9"
              >
                취소
              </Button>
            </div>
          }
        >
          {selectedEntry && (
            <div className="space-y-4">
              {/* 수정 불가 필드 (읽기 전용) */}
              <div className="bg-surface-50 p-4 rounded-lg space-y-2">
                <h3 className="font-semibold text-text-900 mb-3 px-1">수정 불가 필드</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-3 md:gap-4">
                  <div className="p-1">
                    <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">공문연번</label>
                    <div className="font-bold bg-white p-2.5 rounded-lg border text-base text-text-900 shadow-sm">
                      {selectedEntry.document_number || "-"}
                    </div>
                  </div>
                  <div className="p-1">
                    <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">연번</label>
                    <div className="font-bold bg-white p-2.5 rounded-lg border text-base text-text-900 shadow-sm">
                      {selectedEntry.sequence_number || "-"}
                    </div>
                  </div>
                  <div className="p-1">
                    <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">5인 이상 연번</label>
                    <div className="font-bold bg-white p-2.5 rounded-lg border text-base text-text-900 shadow-sm">
                      {selectedEntry.five_plus_sequence || "-"}
                      {(() => {
                        // 1. 정확히 일치하는 주기 검색
                        let quota = quotas.find(
                          (q) =>
                            q.year === selectedEntry.measurement_year &&
                            q.period === selectedEntry.measurement_period &&
                            q.office_name === selectedEntry.designated_office
                        );

                        // 2. '(수시)'가 포함된 경우, '(수시)'를 제거한 주기로 검색
                        if (!quota && selectedEntry.measurement_period && selectedEntry.measurement_period.includes('(수시)')) {
                          const basePeriod = selectedEntry.measurement_period.replace('(수시)', '');
                          quota = quotas.find(
                            (q) =>
                              q.year === selectedEntry.measurement_year &&
                              q.period === basePeriod &&
                              q.office_name === selectedEntry.designated_office
                          );
                        }

                        return quota ? <span className="text-gray-500 font-normal ml-1">/ {quota.quota}</span> : null;
                      })()}
                    </div>
                  </div>
                  <div className="p-1">
                    <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">예비조사자명(공시료 코드)</label>
                    <div className="bg-white p-2.5 rounded-lg border text-base text-text-800 shadow-sm">
                      {selectedEntry.preliminary_surveyor || "-"}
                      {selectedEntry.survey_code && (
                        <span className="text-text-500 ml-1.5 font-normal">({selectedEntry.survey_code})</span>
                      )}
                    </div>
                  </div>
                  <div className="p-1">
                    <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">측정자</label>
                    <div className="bg-white p-2.5 rounded-lg border text-base text-text-800 shadow-sm">
                      {selectedEntry.measurer || "-"}
                    </div>
                  </div>
                  <div className="p-1">
                    <label className="block text-text-500 mb-1 text-xs font-bold uppercase tracking-wider">보고서 담당</label>
                    <div className="bg-white p-2.5 rounded-lg border text-base text-text-800 shadow-sm">
                      {selectedEntry.report_writer || "-"}
                    </div>
                  </div>
                </div>
              </div>

              {/* 수정 가능 필드 */}
              <div className="space-y-6">
                <h3 className="font-semibold text-text-900 mb-3">
                  수정 가능 필드
                </h3>

                {/* 측정 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">측정 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        측정시작일
                      </label>
                      <Input
                        type="date"
                        className="h-11 md:h-10 text-base md:text-sm"
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
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        측정종료일
                      </label>
                      <Input
                        type="date"
                        className="h-11 md:h-10 text-base md:text-sm"
                        value={normalizeDateForInput(editFormData.measurement_end_date)}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            measurement_end_date: e.target.value,
                          })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* 사업장 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">사업장 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-12 print:grid-cols-12 gap-3 md:gap-4">
                    <div className="md:col-span-10 print:col-span-10 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        사업장명
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.business_name || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, business_name: e.target.value })
                        }
                      />
                    </div>
                    <div className="md:col-span-2 print:col-span-2 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        총인원
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm text-right shadow-sm"
                        type="number"
                        value={editFormData.total_employees || ""}
                        onChange={(e) =>
                          setEditFormData({
                            ...editFormData,
                            total_employees: e.target.value ? parseInt(e.target.value) : null,
                          })
                        }
                      />
                    </div>
                    <div className="md:col-span-4 print:col-span-4 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        사업자번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={formatBusinessNumber(editFormData.business_number)}
                        onChange={(e) => {
                          const numbers = parseBusinessNumber(e.target.value);
                          setEditFormData({ ...editFormData, business_number: numbers });
                        }}
                      />
                    </div>
                    <div className="md:col-span-4 print:col-span-4 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        산재관리번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.industrial_accident_number || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, industrial_accident_number: e.target.value })
                        }
                      />
                    </div>
                    <div className="md:col-span-4 print:col-span-4 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        개시번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.commencement_number || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, commencement_number: e.target.value })
                        }
                      />
                    </div>
                    <div className="md:col-span-12 print:col-span-12 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        주소
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.address || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, address: e.target.value })
                        }
                      />
                    </div>
                    <div className="md:col-span-6 print:col-span-6 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        전화번호
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.phone || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, phone: e.target.value })
                        }
                      />
                    </div>
                    <div className="md:col-span-6 print:col-span-6 p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        팩스
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.fax || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, fax: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* 담당자 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">담당자 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 print:grid-cols-3 gap-3 md:gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        담당자명
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.manager_name || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, manager_name: e.target.value })
                        }
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        담당자 직책
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.manager_position || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, manager_position: e.target.value })
                        }
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        담당자 휴대폰
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        value={editFormData.manager_mobile || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, manager_mobile: e.target.value })
                        }
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        담당자 이메일
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        type="email"
                        value={editFormData.manager_email || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, manager_email: e.target.value })
                        }
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        계산서 메일(1)
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        type="email"
                        value={editFormData.invoice_email || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, invoice_email: e.target.value })
                        }
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        계산서 메일(2)
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        type="email"
                        value={editFormData.invoice_email_2 || ""}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, invoice_email_2: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* K2B 정보 */}
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">K2B 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-3 md:gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        K2B 발송일
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        type="date"
                        value={normalizeDateForInput(editFormData.k2b_send_date)}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, k2b_send_date: e.target.value })
                        }
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        K2B 발송자
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
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
                <div className="space-y-4">
                  <h4 className="text-sm font-bold text-text-700 border-b pb-2 px-1">측정비 정보</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        전자계산서 발행일
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
                        type="date"
                        value={normalizeDateForInput(editFormData.electronic_invoice_date)}
                        onChange={(e) =>
                          setEditFormData({ ...editFormData, electronic_invoice_date: e.target.value })
                        }
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        측정비(사업장)
                      </label>
                      <Input
                        className="h-11 md:h-10 text-base md:text-sm shadow-sm"
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
                      />
                    </div>
                    <div className="p-1">
                      <label className="block text-sm font-semibold text-text-700 mb-1.5 ml-0.5">
                        국고지원 여부
                      </label>
                      <Select
                        className="h-11 md:h-10 py-2 text-base md:text-sm shadow-sm text-center"
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
                    />
                  </div>
                </div>
              </div>

            </div >
          )}
        </Modal >
      </div >
      {/* 인쇄 미리보기 포탈 (조건부 렌더링) */}
      {isBulkPrintMode && <PrintPreviewPortal />}
    </>
  );
};
