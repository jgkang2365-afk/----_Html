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

interface NationalSupportEntry {
  id: number;
  code: string;
  year: number;
  period: string;
  application_status: string | null;
  result: string | null;
  national_support_status: string | null;
  business_name: string | null;
  address?: string | null; // Added
  created_at: string;
  updated_at: string;
}

export const NationalSupportManagement: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<NationalSupportEntry[]>([]);
  const [filteredEntries, setFilteredEntries] = useState<NationalSupportEntry[]>([]);

  // 필터 상태
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<string>(currentYear.toString());
  const [selectedPeriod, setSelectedPeriod] = useState<string>("상반기");
  const [searchCode, setSearchCode] = useState("");
  const [searchResult, setSearchResult] = useState("");

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<NationalSupportEntry | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    year: currentYear.toString(),
    period: "상반기",
    application_status: "",
    result: "",
    national_support_status: "",
  });
  const [saving, setSaving] = useState(false);

  // 년도 옵션 (현재 년도 기준 -5년 ~ +1년)
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse();

  const periodOptions = [
    { value: "상반기", label: "상반기" },
    { value: "상반기(수시)", label: "상반기(수시)" },
    { value: "하반기", label: "하반기" },
    { value: "하반기(수시)", label: "하반기(수시)" },
  ];

  // 건강디딤돌 신청결과 목록 로드
  const loadEntries = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedYear) params.append("year", selectedYear);
      if (selectedPeriod) params.append("period", selectedPeriod);
      if (searchCode) params.append("code", searchCode);
      if (searchResult) params.append("result", searchResult);

      const response = await fetch(`/api/businesses/national-support?${params.toString()}`);

      if (!response.ok) {
        let errorMessage = "건강디딤돌 신청결과 목록을 불러오는 중 오류가 발생했습니다.";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch {
          // JSON 파싱 실패 시 기본 메시지 사용
          errorMessage = `서버 오류 (${response.status})`;
        }
        setError(errorMessage);
        return;
      }

      const data = await response.json();

      if (response.ok) {
        setEntries(data.entries || []);
        setFilteredEntries(data.entries || []);
      } else {
        setError(data.error || "건강디딤돌 신청결과 목록을 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("건강디딤돌 신청결과 목록 로드 오류:", err);
      setError(err.message || "건강디딤돌 신청결과 목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [selectedYear, selectedPeriod, searchCode, searchResult]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // 검색어 변경 시 필터링 (클라이언트 사이드 보조)
  useEffect(() => {
    let filtered = entries;

    if (searchCode.trim()) {
      const searchLower = searchCode.toLowerCase();
      filtered = filtered.filter((entry) =>
        entry.code.toLowerCase().includes(searchLower) ||
        (entry.business_name && entry.business_name.toLowerCase().includes(searchLower))
      );
    }

    if (searchResult.trim()) {
      const resultLower = searchResult.toLowerCase();
      filtered = filtered.filter((entry) =>
        entry.result && entry.result.toLowerCase().includes(resultLower)
      );
    }

    setFilteredEntries(filtered);
  }, [searchCode, searchResult, entries]);

  // 엑셀 다운로드
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // 엑셀 다운로드
  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedYear) params.append("year", selectedYear);
      if (selectedPeriod) params.append("period", selectedPeriod);
      if (searchCode) params.append("code", searchCode);
      if (searchResult) params.append("result", searchResult);

      const response = await fetch(`/api/export/national-support?${params.toString()}`);

      if (!response.ok) {
        throw new Error("엑셀 다운로드 실패");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `건강디딤돌_신청결과_${selectedYear}_${selectedPeriod}_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      console.error("엑셀 다운로드 오류:", err);
      alert("엑셀 다운로드 중 오류가 발생했습니다: " + (err.message || "알 수 없는 오류"));
    }
  };

  // 엑셀 업로드
  const handleUploadExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`${file.name} 파일을 업로드하시겠습니까?\n(${selectedYear}년 ${selectedPeriod} 기준으로 처리됩니다.)`)) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("year", selectedYear);
    formData.append("period", selectedPeriod);

    try {
      const response = await fetch("/api/businesses/national-support/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        alert(data.message || "업로드가 완료되었습니다.");
        loadEntries();
      } else {
        throw new Error(data.error || "업로드 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("업로드 오류:", err);
      alert("업로드 실패: " + (err.message || "알 수 없는 오류"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      {/* 필터 영역 */}
      <Card className="p-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-3 p-1">
          <div className="w-[100px]">
            <Select
              label="측정년도"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              options={yearOptions}
              className="text-center"
            />
          </div>
          <div className="w-[120px]">
            <Select
              label="측정주기"
              value={selectedPeriod}
              onChange={(e) => setSelectedPeriod(e.target.value)}
              options={periodOptions}
              className="text-center"
            />
          </div>
          <div className="w-[200px]">
            <Input
              label="코드/사업장명 검색"
              value={searchCode}
              onChange={(e) => setSearchCode(e.target.value)}
              placeholder="코드 또는 사업장명"
            />
          </div>
          <div className="w-[120px]">
            <Select
              label="신청결과"
              value={searchResult}
              onChange={(e) => setSearchResult(e.target.value)}
              options={[
                { value: "", label: "전체" },
                { value: "대상", label: "대상" },
                { value: "비대상", label: "비대상" }
              ]}
              className="text-center"
            />
          </div>

          <div className="flex gap-2 ml-auto">
            <Button variant="primary" onClick={loadEntries} disabled={loading} className="whitespace-nowrap px-4">
              {loading ? "조회..." : "조회"}
            </Button>
            <Button variant="secondary" onClick={handleExportExcel} className="whitespace-nowrap px-4">
              엑셀 다운로드
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".xlsx,.xls"
              onChange={handleUploadExcel}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="whitespace-nowrap px-4"
            >
              {uploading ? "업로드 중..." : "엑셀 업로드"}
            </Button>
            <Button
              variant="primary"
              className="whitespace-nowrap px-6"
              onClick={() => {
                setSelectedEntry(null);
                setFormData({
                  code: "",
                  year: selectedYear,
                  period: selectedPeriod,
                  application_status: "",
                  result: "",
                  national_support_status: "",
                });
                setIsModalOpen(true);
              }}
            >
              등록
            </Button>
          </div>
        </div>
      </Card>

      {error && <Alert variant="error">{error}</Alert>}

      {/* 목록 테이블 */}
      <Card className="p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-text-900 mb-6">
          건강디딤돌 신청결과 목록 ({filteredEntries.length}건)
        </h2>

        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-text-500 text-lg">조회 결과가 없습니다.</p>
          </div>
        ) : (
          <Table maxHeight="max-h-[calc(100vh-300px)]">
            <TableHeader>
              <TableRow>
                <TableHead className="bg-surface-50 w-[120px]">코드</TableHead>
                <TableHead className="bg-surface-50 w-[220px]">사업장명</TableHead>
                <TableHead className="bg-surface-50 w-[300px]">주소</TableHead>
                <TableHead className="bg-surface-50 text-center w-[100px]">측정년도</TableHead>
                <TableHead className="bg-surface-50 text-center w-[100px]">측정주기</TableHead>
                <TableHead className="bg-surface-50 text-center w-[100px]">신청 여부</TableHead>
                <TableHead className="bg-surface-50 text-center w-[100px]">신청결과</TableHead>
                <TableHead className="bg-surface-50 text-center w-[120px]">국고지원 상태</TableHead>
                <TableHead className="bg-surface-50 w-[180px]">등록일시</TableHead>
                <TableHead className="bg-surface-50 w-[180px]">수정일시</TableHead>
                <TableHead className="bg-surface-50 w-[80px]">관리</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry) => (
                <TableRow key={entry.id} className="hover:bg-surface-50">
                  <TableCell className="font-medium align-middle">{entry.code}</TableCell>
                  <TableCell className="font-medium align-middle truncate max-w-[220px]" title={entry.business_name || ""}>{entry.business_name || "-"}</TableCell>
                  <TableCell className="text-sm text-text-500 align-middle truncate max-w-[300px]" title={entry.address || ""}>{entry.address || "-"}</TableCell>
                  <TableCell className="text-center align-middle">{entry.year}</TableCell>
                  <TableCell className="align-middle text-center">{entry.period}</TableCell>
                  <TableCell className="align-middle text-center">{entry.application_status || "-"}</TableCell>
                  <TableCell className="align-middle text-center">{entry.result || "-"}</TableCell>
                  <TableCell className="align-middle text-center">
                    <span
                      className={`px-2 py-1 rounded text-sm font-medium ${entry.national_support_status === "지원"
                        ? "bg-green-100 text-green-800"
                        : entry.national_support_status === "비대상"
                          ? "bg-gray-100 text-gray-800"
                          : "bg-surface-100 text-surface-600"
                        }`}
                    >
                      {entry.national_support_status || "-"}
                    </span>
                  </TableCell>
                  <TableCell className="align-middle text-sm text-text-500">
                    {entry.created_at
                      ? new Date(entry.created_at).toLocaleString("ko-KR")
                      : "-"}
                  </TableCell>
                  <TableCell className="align-middle text-sm text-text-500">
                    {entry.updated_at
                      ? new Date(entry.updated_at).toLocaleString("ko-KR")
                      : "-"}
                  </TableCell>
                  <TableCell className="align-middle">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedEntry(entry);
                        setFormData({
                          code: entry.code,
                          year: entry.year.toString(),
                          period: entry.period,
                          application_status: entry.application_status || "",
                          result: entry.result || "",
                          national_support_status: entry.national_support_status || "",
                        });
                        setIsModalOpen(true);
                      }}
                    >
                      수정
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* 등록/수정 모달 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedEntry(null);
          setFormData({
            code: "",
            year: selectedYear,
            period: selectedPeriod,
            application_status: "",
            result: "",
            national_support_status: "",
          });
        }}
        title={selectedEntry ? "건강디딤돌 신청결과 수정" : "건강디딤돌 신청결과 등록"}
      >
        <div className="space-y-4">
          <Input
            label="코드 *"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            placeholder="코드 입력"
            required
            disabled={!!selectedEntry}
          />
          {selectedEntry && (
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="사업장명"
                value={selectedEntry.business_name || ""}
                readOnly
                disabled
                className="bg-gray-100"
              />
              <Input
                label="주소"
                value={selectedEntry.address || ""}
                readOnly
                disabled
                className="bg-gray-100"
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="측정년도 *"
              type="number"
              value={formData.year}
              onChange={(e) => setFormData({ ...formData, year: e.target.value })}
              required
            />
            <Select
              label="측정주기 *"
              value={formData.period}
              onChange={(e) => setFormData({ ...formData, period: e.target.value })}
              options={periodOptions}
              required
            />
          </div>
          <Input
            label="신청 여부"
            value={formData.application_status}
            onChange={(e) => setFormData({ ...formData, application_status: e.target.value })}
            placeholder="예: ○"
          />
          <Input
            label="신청결과"
            value={formData.result}
            onChange={(e) => setFormData({ ...formData, result: e.target.value })}
            placeholder="예: 대상, 비대상"
          />
          <Select
            label="국고지원 상태"
            value={formData.national_support_status}
            onChange={(e) => setFormData({ ...formData, national_support_status: e.target.value })}
            options={[
              { value: "", label: "자동 계산" },
              { value: "지원", label: "지원" },
              { value: "비대상", label: "비대상" },
            ]}
          />
          <div className="flex gap-2 justify-end pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setIsModalOpen(false);
                setSelectedEntry(null);
                setFormData({
                  code: "",
                  year: selectedYear,
                  period: selectedPeriod,
                  application_status: "",
                  result: "",
                  national_support_status: "",
                });
              }}
            >
              취소
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!formData.code || !formData.year || !formData.period) {
                  alert("코드, 측정년도, 측정주기는 필수입니다.");
                  return;
                }

                setSaving(true);
                try {
                  const url = selectedEntry
                    ? `/api/businesses/national-support/${selectedEntry.id}`
                    : "/api/businesses/national-support";
                  const method = selectedEntry ? "PATCH" : "POST";

                  const response = await fetch(url, {
                    method,
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify(formData),
                  });

                  const data = await response.json();

                  if (response.ok) {
                    alert(selectedEntry ? "수정되었습니다." : "등록되었습니다.");
                    setIsModalOpen(false);
                    setSelectedEntry(null);
                    setFormData({
                      code: "",
                      year: selectedYear,
                      period: selectedPeriod,
                      application_status: "",
                      result: "",
                      national_support_status: "",
                    });
                    loadEntries();
                  } else {
                    alert(data.error || "오류가 발생했습니다.");
                  }
                } catch (err: any) {
                  console.error("저장 오류:", err);
                  alert("저장 중 오류가 발생했습니다: " + (err.message || "알 수 없는 오류"));
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
            >
              {saving ? "저장 중..." : selectedEntry ? "수정" : "등록"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
