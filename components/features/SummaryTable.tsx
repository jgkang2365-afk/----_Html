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
import { formatDateYYYYMMDD } from "@/lib/utils/date-utils";
import { normalizeDateForInput } from "@/lib/utils/date-normalize";
import { formatBusinessNumber, parseBusinessNumber } from "@/lib/utils/business-number";

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
  address: string | null;
  phone: string | null;
  fax: string | null;
  k2b_send_date: string | null;
  k2b_sender: string | null;
  measurement_fee_business: number | null;
  completion_status: string;
  created_at: string;
  updated_at: string;
}

export const SummaryTable: React.FC = () => {
  // 검색 관련 상태
  const [searchParams, setSearchParams] = useState({
    measurementYear: "",
    measurementPeriod: "",
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
      address: entry.address || "",
      phone: entry.phone || "",
      fax: entry.fax || "",
      manager_name: entry.manager_name || "",
      manager_position: entry.manager_position || "",
      manager_mobile: entry.manager_mobile || "",
      manager_email: entry.manager_email || "",
      k2b_send_date: normalizeDateForInput(entry.k2b_send_date),
      k2b_sender: entry.k2b_sender || "",
      measurement_fee_business: entry.measurement_fee_business || null,
    });
    setIsModalOpen(true);
  };

  // 수정 저장
  const handleSave = async () => {
    if (!selectedEntry) return;

    try {
      setSaving(true);
      setError(null);

      const response = await fetch(`/api/summary/${selectedEntry.journal_id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(editFormData),
      });

      const result = await response.json();

      if (response.ok) {
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
              지정한계_관할지청
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
            <div className="overflow-x-auto">
              <Table>
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
                      <TableCell className="bg-surface-50 font-mono text-xs">
                        {entry.document_number || "-"}
                      </TableCell>
                      <TableCell className="bg-surface-50 font-mono text-xs">
                        {entry.sequence_number || "-"}
                      </TableCell>
                      <TableCell className="bg-surface-50 font-mono text-xs">
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
                          className={`px-2 py-1 rounded text-xs ${
                            entry.completion_status === "완료"
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
                          disabled={entry.completion_status === "완료"}
                        >
                          수정
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

      {/* 수정 모달 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedEntry(null);
          setEditFormData({});
        }}
        title="측정정보 수정"
      >
        {selectedEntry && (
          <div className="space-y-4">
            {/* 수정 불가 필드 (읽기 전용) */}
            <div className="bg-surface-50 p-4 rounded-lg space-y-2">
              <h3 className="font-semibold text-text-900 mb-2">수정 불가 필드</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <label className="block text-text-600 mb-1">공문연번</label>
                  <div className="font-mono bg-white p-2 rounded border">
                    {selectedEntry.document_number || "-"}
                  </div>
                </div>
                <div>
                  <label className="block text-text-600 mb-1">연번</label>
                  <div className="font-mono bg-white p-2 rounded border">
                    {selectedEntry.sequence_number || "-"}
                  </div>
                </div>
                <div>
                  <label className="block text-text-600 mb-1">5인 이상 연번</label>
                  <div className="font-mono bg-white p-2 rounded border">
                    {selectedEntry.five_plus_sequence || "-"}
                  </div>
                </div>
              </div>
            </div>

            {/* 수정 가능 필드 */}
            <div className="space-y-4">
              <h3 className="font-semibold text-text-900">수정 가능 필드</h3>
              <div className="grid grid-cols-2 gap-4">
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
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    측정자
                  </label>
                  <Input
                    value={editFormData.measurer || ""}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, measurer: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    사업장명
                  </label>
                  <Input
                    value={editFormData.business_name || ""}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, business_name: e.target.value })
                    }
                  />
                </div>
                <div>
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
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    사업자번호
                  </label>
                  <Input
                    value={formatBusinessNumber(editFormData.business_number)}
                    onChange={(e) => {
                      // 숫자만 추출하여 저장 (하이픈 제거)
                      const numbers = parseBusinessNumber(e.target.value);
                      setEditFormData({ ...editFormData, business_number: numbers });
                    }}
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    주소
                  </label>
                  <Input
                    value={editFormData.address || ""}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, address: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    전화번호
                  </label>
                  <Input
                    value={editFormData.phone || ""}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, phone: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    팩스
                  </label>
                  <Input
                    value={editFormData.fax || ""}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, fax: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    담당자명
                  </label>
                  <Input
                    value={editFormData.manager_name || ""}
                    onChange={(e) =>
                      setEditFormData({ ...editFormData, manager_name: e.target.value })
                    }
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
                  />
                </div>
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
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-700 mb-1">
                    측정비(사업장)
                  </label>
                  <Input
                    type="number"
                    value={editFormData.measurement_fee_business || ""}
                    onChange={(e) =>
                      setEditFormData({
                        ...editFormData,
                        measurement_fee_business: e.target.value
                          ? parseFloat(e.target.value)
                          : null,
                      })
                    }
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                variant="secondary"
                onClick={() => {
                  setIsModalOpen(false);
                  setSelectedEntry(null);
                  setEditFormData({});
                }}
              >
                취소
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={saving}>
                {saving ? "저장 중..." : "저장"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
