"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { useRouter } from "next/navigation";

interface MeasurementBusiness {
  code: string;
  year: number;
  period: string;
  business_name: string;
  address: string;
  total_employees: number | null;
  office_jurisdiction: string | null;
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  measurer: string | null;
}

export const JournalCreate: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<MeasurementBusiness[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<string>("");
  const [formData, setFormData] = useState({
    measurementYear: "",
    measurementPeriod: "",
    note: "",
    designatedOffice: "",
  });

  // URL 파라미터에서 code, year, period 가져오기
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const year = params.get("year");
      const period = params.get("period");

      if (code && year && period) {
        // 해당 측정사업장 찾기
        const business = businesses.find(
          (b) => b.code === code && b.year === parseInt(year) && b.period === period
        );
        if (business) {
          setSelectedBusiness(`${business.code}-${business.year}-${business.period}`);
          setFormData({
            measurementYear: year,
            measurementPeriod: period,
            note: "",
            designatedOffice: "",
          });
        }
      }
    }
  }, [businesses]);

  // 측정사업장 목록 불러오기
  useEffect(() => {
    const fetchBusinesses = async () => {
      try {
        const response = await fetch("/api/journal/businesses");
        if (response.ok) {
          const data = await response.json();
          setBusinesses(data.businesses || []);
        }
      } catch (err) {
        console.error("측정사업장 목록 불러오기 오류:", err);
      }
    };
    fetchBusinesses();
  }, []);

  // 선택된 측정사업장 정보 가져오기
  const selectedBusinessData = businesses.find(
    (b) => `${b.code}-${b.year}-${b.period}` === selectedBusiness
  );

  // 측정사업장 선택 시 자동으로 폼 데이터 채우기
  useEffect(() => {
    if (selectedBusinessData) {
      setFormData({
        measurementYear: selectedBusinessData.year.toString(),
        measurementPeriod: selectedBusinessData.period,
        note: "",
        designatedOffice: "",
      });
    }
  }, [selectedBusinessData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: selectedBusinessData?.code,
          measurementYear: parseInt(formData.measurementYear),
          measurementPeriod: formData.measurementPeriod,
          note: formData.note,
          designatedOffice: formData.designatedOffice,
          ...selectedBusinessData,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        router.push(`/journal/${data.id}`);
      } else {
        setError(data.error || "측정일지 등록 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("측정일지 등록 오류:", err);
      setError(err.message || "측정일지 등록 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 측정사업장 옵션 생성
  const businessOptions = businesses.map((b) => ({
    value: `${b.code}-${b.year}-${b.period}`,
    label: `${b.business_name} (${b.year}년 ${b.period})`,
  }));

  // 측정년도 옵션
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 7 }, (_, i) => {
    const year = currentYear - 5 + i;
    return { value: year.toString(), label: year.toString() };
  });

  // 측정주기 옵션
  const periodOptions = [
    { value: "상반기", label: "상반기" },
    { value: "하반기", label: "하반기" },
  ];

  // 지정한계_관할지청 옵션
  const designatedOfficeOptions = [
    { value: "대전지방고용노동청 천안지청", label: "대전지방고용노동청 천안지청" },
    { value: "대전지방고용노동청", label: "대전지방고용노동청" },
    { value: "중부지방고용노동청 평택지청", label: "중부지방고용노동청 평택지청" },
    { value: "중부지방고용노동청 경기지청", label: "중부지방고용노동청 경기지청" },
  ];

  return (
    <Card className="p-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        {error && <Alert variant="error">{error}</Alert>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="측정사업장 *"
            value={selectedBusiness}
            onChange={(e) => setSelectedBusiness(e.target.value)}
            options={[
              { value: "", label: "측정사업장 선택" },
              ...businessOptions,
            ]}
            required
          />
          <Select
            label="측정년도 *"
            value={formData.measurementYear}
            onChange={(e) =>
              setFormData({ ...formData, measurementYear: e.target.value })
            }
            options={yearOptions}
            required
          />
          <Select
            label="측정주기 *"
            value={formData.measurementPeriod}
            onChange={(e) =>
              setFormData({ ...formData, measurementPeriod: e.target.value })
            }
            options={periodOptions}
            required
          />
          <Input
            label="비고"
            value={formData.note}
            onChange={(e) => setFormData({ ...formData, note: e.target.value })}
            placeholder="최초실시, 고시물질, 소음 85 이상 등"
          />
          <Select
            label="지정한계_관할지청 *"
            value={formData.designatedOffice}
            onChange={(e) =>
              setFormData({ ...formData, designatedOffice: e.target.value })
            }
            options={[
              { value: "", label: "선택" },
              ...designatedOfficeOptions,
            ]}
            required
          />
        </div>

        {selectedBusinessData && (
          <div className="mt-4 p-4 bg-surface-50 rounded-md">
            <h3 className="font-medium text-text-900 mb-2">선택된 측정사업장 정보</h3>
            <div className="grid grid-cols-2 gap-2 text-sm text-text-700">
              <div>사업장명: {selectedBusinessData.business_name}</div>
              <div>주소: {selectedBusinessData.address || "-"}</div>
              <div>총인원: {selectedBusinessData.total_employees || "-"}</div>
              <div>측정자: {selectedBusinessData.measurer || "-"}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-4">
          <Button type="submit" disabled={loading || !selectedBusiness}>
            {loading ? "등록 중..." : "등록"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.back()}
            disabled={loading}
          >
            취소
          </Button>
        </div>
      </form>
    </Card>
  );
};

