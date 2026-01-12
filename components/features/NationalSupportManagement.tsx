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

interface NationalSupportEntry {
  id: number;
  code: string;
  year: number;
  period: string;
  application_status: string | null;
  result: string | null;
  national_support_status: string | null;
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

  // 년도 옵션 (현재 년도 기준 -5년 ~ +1년)
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  }).reverse();

  const periodOptions = [
    { value: "상반기", label: "상반기" },
    { value: "하반기", label: "하반기" },
  ];

  // 건강디딤돌 신청결과 목록 로드
  const loadEntries = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (selectedYear) params.append("year", selectedYear);
      if (selectedPeriod) params.append("period", selectedPeriod);
      if (searchCode) params.append("code", searchCode);

      const response = await fetch(`/api/businesses/national-support?${params.toString()}`);
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
  };

  useEffect(() => {
    loadEntries();
  }, [selectedYear, selectedPeriod]);

  // 검색 코드 변경 시 필터링
  useEffect(() => {
    if (!searchCode.trim()) {
      setFilteredEntries(entries);
    } else {
      setFilteredEntries(
        entries.filter((entry) =>
          entry.code.toLowerCase().includes(searchCode.toLowerCase())
        )
      );
    }
  }, [searchCode, entries]);

  // 엑셀 다운로드
  const handleExportExcel = async () => {
    try {
      const params = new URLSearchParams();
      if (selectedYear) params.append("year", selectedYear);
      if (selectedPeriod) params.append("period", selectedPeriod);
      if (searchCode) params.append("code", searchCode);

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

  return (
    <div className="space-y-6">
      {/* 필터 영역 */}
      <Card className="p-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <Select
            label="측정년도"
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            options={yearOptions}
          />
          <Select
            label="측정주기"
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
            options={periodOptions}
          />
          <Input
            label="코드 검색"
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            placeholder="코드 입력"
          />
          <div className="flex gap-2">
            <Button variant="primary" onClick={loadEntries} disabled={loading}>
              {loading ? "조회 중..." : "조회"}
            </Button>
            <Button variant="secondary" onClick={handleExportExcel}>
              엑셀 다운로드
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
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50">코드</TableHead>
                  <TableHead className="bg-surface-50">측정년도</TableHead>
                  <TableHead className="bg-surface-50">측정주기</TableHead>
                  <TableHead className="bg-surface-50">신청 여부</TableHead>
                  <TableHead className="bg-surface-50">신청결과</TableHead>
                  <TableHead className="bg-surface-50">국고지원 상태</TableHead>
                  <TableHead className="bg-surface-50">등록일시</TableHead>
                  <TableHead className="bg-surface-50">수정일시</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.id} className="hover:bg-surface-50">
                    <TableCell className="font-medium">{entry.code}</TableCell>
                    <TableCell>{entry.year}</TableCell>
                    <TableCell>{entry.period}</TableCell>
                    <TableCell>{entry.application_status || "-"}</TableCell>
                    <TableCell>{entry.result || "-"}</TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-sm font-medium ${
                          entry.national_support_status === "지원"
                            ? "bg-green-100 text-green-800"
                            : entry.national_support_status === "비대상"
                            ? "bg-gray-100 text-gray-800"
                            : "bg-surface-100 text-surface-600"
                        }`}
                      >
                        {entry.national_support_status || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {entry.created_at
                        ? new Date(entry.created_at).toLocaleString("ko-KR")
                        : "-"}
                    </TableCell>
                    <TableCell>
                      {entry.updated_at
                        ? new Date(entry.updated_at).toLocaleString("ko-KR")
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
};
