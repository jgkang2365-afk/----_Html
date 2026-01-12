"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  parseDateInput,
  formatDateMMDD,
  formatDateYYYYMMDD,
  calculateMeasurementWeekdays,
} from "@/lib/utils/date-utils";
import { MEASURER_LIST, getSurveyCode } from "@/lib/utils/survey-code";

interface BusinessInfo {
  code: string;
  business_name: string;
  business_number?: string;
  address: string;
  office_jurisdiction?: string;
}

interface SurveyFormData {
  measurement_date: string; // YYYY-MM-DD 형식
  end_date: string; // YYYY-MM-DD 형식
  measurement_weekdays: string;
  code: string;
  business_name: string;
  business_number?: string; // 사업자번호
  measurer: string; // 콤마 구분
  survey_code: string;
  address: string;
  preliminary_surveyor: string; // 콤마 구분
  actual_measurer: string; // 콤마 구분
  report_writer: string; // 콤마 구분
}

interface SurveyFormProps {
  initialData?: Partial<SurveyFormData>;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const SurveyForm: React.FC<SurveyFormProps> = ({
  initialData,
  onSuccess,
  onCancel,
}) => {
  const [formData, setFormData] = useState<SurveyFormData>({
    measurement_date: "",
    end_date: "",
    measurement_weekdays: "",
    code: "",
    business_name: "",
    business_number: "",
    measurer: "",
    survey_code: "",
    address: "",
    preliminary_surveyor: "",
    actual_measurer: "",
    report_writer: "",
  });

  const [measurementDateInput, setMeasurementDateInput] = useState(""); // 사용자 입력 (20260101 또는 0101)
  const [endDateInput, setEndDateInput] = useState(""); // 사용자 입력
  const [endDateManuallyModified, setEndDateManuallyModified] = useState(false); // 종료일이 수동으로 수정되었는지 추적
  const [businessList, setBusinessList] = useState<BusinessInfo[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<string>("");
  const [isNewBusiness, setIsNewBusiness] = useState(false);
  const [selectedMeasurers, setSelectedMeasurers] = useState<string[]>([]);
  const [preliminarySurveyors, setPreliminarySurveyors] = useState<string[]>([]);
  const [actualMeasurers, setActualMeasurers] = useState<string[]>([]);
  const [reportWriter, setReportWriter] = useState<string>(""); // 단수 선택
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null); // 경고 메시지
  const [loadingBusiness, setLoadingBusiness] = useState(false);
  
  // 사업장 검색 관련 상태
  const [showBusinessSearch, setShowBusinessSearch] = useState(false);
  const [searchParams, setSearchParams] = useState({
    code: "",
    businessName: "",
    designatedOffice: "",
    address: "",
  });
  const [searchResults, setSearchResults] = useState<BusinessInfo[]>([]);
  const [searching, setSearching] = useState(false);

  // 초기 데이터 설정
  useEffect(() => {
    if (initialData) {
      const data = { ...formData, ...initialData };
      setFormData(data);
      
      // 측정일 입력 필드 설정
      if (initialData.measurement_date) {
        const date = new Date(initialData.measurement_date);
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        setMeasurementDateInput(`${month}${day}`);
      }
      
      // 종료일 입력 필드 설정
      if (initialData.end_date) {
        const date = new Date(initialData.end_date);
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        setEndDateInput(`${month}${day}`);
        setEndDateManuallyModified(true); // 초기 데이터가 있으면 수동 수정된 것으로 간주
      } else if (initialData.measurement_date) {
        // 종료일이 없고 측정일만 있으면 종료일을 측정일과 동일하게 설정
        const date = new Date(initialData.measurement_date);
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        setEndDateInput(`${month}${day}`);
        setEndDateManuallyModified(false); // 자동 설정된 것이므로 수동 수정 아님
      }
      
      // 측정자 설정
      if (initialData.measurer) {
        setSelectedMeasurers(initialData.measurer.split(",").map((m) => m.trim()));
      }
      
      // 예비조사자, 실측정자, 보고서 담당 설정
      if (initialData.preliminary_surveyor) {
        setPreliminarySurveyors(initialData.preliminary_surveyor.split(",").map((m) => m.trim()));
      }
      if (initialData.actual_measurer) {
        setActualMeasurers(initialData.actual_measurer.split(",").map((m) => m.trim()));
      }
      if (initialData.report_writer) {
        // 보고서 담당은 단수이므로 첫 번째 값만 사용
        const writers = initialData.report_writer.split(",").map((m) => m.trim());
        setReportWriter(writers[0] || "");
      }
      
      // 사업장 정보는 초기 데이터에서 자동으로 채워지므로 별도 처리 불필요
    }
  }, [initialData]);

  // 사업장 검색
  const handleBusinessSearch = async () => {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (searchParams.code) params.append("code", searchParams.code);
      if (searchParams.businessName) params.append("businessName", searchParams.businessName);
      if (searchParams.designatedOffice) params.append("designatedOffice", searchParams.designatedOffice);
      if (searchParams.address) params.append("address", searchParams.address);

      const response = await fetch(`/api/business-info/search?${params.toString()}`);
      const data = await response.json();
      
      if (response.ok && data.businesses) {
        setSearchResults(data.businesses);
      } else {
        setError(data.error || "검색 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("사업장 검색 오류:", err);
      setError(err.message || "검색 중 오류가 발생했습니다.");
    } finally {
      setSearching(false);
    }
  };

  // 검색 결과에서 사업장 선택
  const handleSelectBusinessFromSearch = (business: BusinessInfo) => {
    setFormData((prev) => ({
      ...prev,
      code: business.code,
      business_name: business.business_name,
      address: business.address || "",
    }));
    setSelectedBusiness(business.code);
    setIsNewBusiness(false);
    setShowBusinessSearch(false);
    setSearchResults([]);
    setSearchParams({ code: "", businessName: "", designatedOffice: "", address: "" });
  };

  // 측정일 입력 처리
  const handleMeasurementDateChange = (value: string) => {
    setMeasurementDateInput(value);
    
    // 날짜 파싱 및 설정
    const date = parseDateInput(value);
    if (date) {
      const dateStr = formatDateYYYYMMDD(date);
      setFormData((prev) => {
        const updated = { ...prev, measurement_date: dateStr };
        
        // 종료일이 수동으로 수정되지 않았고 비어있거나 측정일과 동일한 경우에만 종료일을 측정일과 동일하게 설정
        if (!endDateManuallyModified && (!prev.end_date || prev.end_date === prev.measurement_date)) {
          setEndDateInput(value);
          updated.end_date = dateStr;
        }
        
        return updated;
      });
      
      // 측정요일 계산
      const currentEndDate = formData.end_date || dateStr;
      updateMeasurementWeekdays(dateStr, currentEndDate);
    } else {
      setFormData((prev) => ({ ...prev, measurement_date: "" }));
    }
  };

  // 종료일 입력 처리
  const handleEndDateChange = (value: string) => {
    setEndDateInput(value);
    setEndDateManuallyModified(true); // 사용자가 수동으로 수정했음을 표시
    
    const date = parseDateInput(value);
    if (date) {
      const dateStr = formatDateYYYYMMDD(date);
      setFormData((prev) => ({ ...prev, end_date: dateStr }));
      
      // 측정요일 계산
      updateMeasurementWeekdays(formData.measurement_date, dateStr);
    } else {
      setFormData((prev) => ({ ...prev, end_date: "" }));
    }
  };

  // 측정요일 업데이트
  const updateMeasurementWeekdays = (startDate: string, endDate: string) => {
    if (startDate && endDate) {
      const weekdays = calculateMeasurementWeekdays(startDate, endDate);
      setFormData((prev) => ({ ...prev, measurement_weekdays: weekdays }));
    }
  };

  // 사업장 선택 처리
  const handleBusinessSelect = (code: string) => {
    setSelectedBusiness(code);
    setIsNewBusiness(false);
    
    const business = businessList.find((b) => b.code === code);
    if (business) {
      setFormData((prev) => ({
        ...prev,
        code: business.code,
        business_name: business.business_name,
        address: business.address || "",
      }));
    }
  };

  // 신규 사업장 등록 모드
  const handleNewBusiness = () => {
    setIsNewBusiness(true);
    setSelectedBusiness("");
    setFormData((prev) => ({
      ...prev,
      code: "",
      business_name: "",
      address: "",
    }));
  };

  // 측정자 선택 처리
  const handleMeasurerToggle = (measurer: string) => {
    const updated = selectedMeasurers.includes(measurer)
      ? selectedMeasurers.filter((m) => m !== measurer)
      : [...selectedMeasurers, measurer];
    
    setSelectedMeasurers(updated);
    
    // 공시료 코드 자동 부여 (첫 번째 측정자 기준)
    const measurerStr = updated.join(", ");
    const surveyCode = getSurveyCode(measurerStr);
    
    setFormData((prev) => ({
      ...prev,
      measurer: measurerStr,
      survey_code: surveyCode || "",
    }));
  };

  // 예비조사자 선택 처리
  const handlePreliminarySurveyorToggle = (measurer: string) => {
    const updated = preliminarySurveyors.includes(measurer)
      ? preliminarySurveyors.filter((m) => m !== measurer)
      : [...preliminarySurveyors, measurer];
    setPreliminarySurveyors(updated);
    setFormData((prev) => ({
      ...prev,
      preliminary_surveyor: updated.join(", "),
    }));
  };

  // 실측정자 선택 처리
  const handleActualMeasurerToggle = (measurer: string) => {
    const updated = actualMeasurers.includes(measurer)
      ? actualMeasurers.filter((m) => m !== measurer)
      : [...actualMeasurers, measurer];
    setActualMeasurers(updated);
    setFormData((prev) => ({
      ...prev,
      actual_measurer: updated.join(", "),
    }));
  };

  // 보고서 담당 선택 처리 (단수 선택)
  const handleReportWriterChange = (measurer: string) => {
    const selected = reportWriter === measurer ? "" : measurer;
    setReportWriter(selected);
    setFormData((prev) => ({
      ...prev,
      report_writer: selected,
    }));
  };

  // 폼 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setWarning(null);

    // 필수 필드 검증
    if (!formData.measurement_date) {
      setError("측정일을 입력해주세요.");
      return;
    }
    if (!formData.business_name) {
      setError("사업장명을 입력해주세요.");
      return;
    }
    if (!formData.measurer) {
      setError("측정자를 선택해주세요.");
      return;
    }

    setLoading(true);

    try {
      const url = initialData && (initialData as any).id 
        ? `/api/survey/${(initialData as any).id}`
        : "/api/survey";
      
      const method = initialData && (initialData as any).id ? "PUT" : "POST";
      
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        // 경고 메시지가 있으면 표시하되 등록은 성공
        if (data.warning) {
          setWarning(data.warning);
        }
        // 경고가 있어도 성공 콜백 실행 (등록은 이미 완료됨)
        if (data.warning) {
          // 경고만 표시하고 성공 콜백은 지연 (사용자가 확인할 시간 제공)
          setTimeout(() => {
            onSuccess?.();
          }, 2000); // 2초 후 자동으로 목록으로 이동
        } else {
          onSuccess?.();
        }
      } else {
        setError(data.error || "저장 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("저장 오류:", err);
      setError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}
      {warning && <Alert variant="warning">{warning}</Alert>}

      {/* 기본 정보 */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text-900 mb-4">기본 정보</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Input
              label="측정일"
              value={measurementDateInput}
              onChange={(e) => handleMeasurementDateChange(e.target.value)}
              placeholder="20260101 또는 0101"
              required
            />
            {formData.measurement_date && (
              <p className="text-sm text-text-500 mt-1">
                표시: {formatDateYYYYMMDD(new Date(formData.measurement_date))}
              </p>
            )}
          </div>
          <div>
            <Input
              label="종료일"
              value={endDateInput}
              onChange={(e) => handleEndDateChange(e.target.value)}
              placeholder="20260101 또는 0101"
            />
            {formData.end_date && (
              <p className="text-sm text-text-500 mt-1">
                표시: {formatDateYYYYMMDD(new Date(formData.end_date))}
              </p>
            )}
          </div>
          <div className="md:col-span-2">
            <Input
              label="측정요일"
              value={formData.measurement_weekdays}
              readOnly
              className="bg-surface-50"
            />
          </div>
        </div>
      </Card>

      {/* 사업장 정보 */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text-900 mb-4">사업장 정보</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="코드"
            value={formData.code}
            readOnly
            className="bg-surface-50"
          />
          <Input
            label="사업자번호"
            value={formData.business_number || ""}
            readOnly
            className="bg-surface-50"
          />
          <Input
            label="사업장명"
            value={formData.business_name}
            readOnly
            className="bg-surface-50"
          />
          <Input
            label="주소"
            value={formData.address}
            readOnly
            className="bg-surface-50"
          />
        </div>
      </Card>

      {/* 측정자 정보 */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text-900 mb-4">측정자 정보</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-700 mb-2">
              측정자 (복수 선택 가능)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {MEASURER_LIST.map((measurer) => (
                <Checkbox
                  key={measurer}
                  label={measurer}
                  checked={selectedMeasurers.includes(measurer)}
                  onChange={() => handleMeasurerToggle(measurer)}
                />
              ))}
            </div>
          </div>
          <Input
            label="공시료 코드"
            value={formData.survey_code}
            readOnly
            className="bg-surface-50"
          />
        </div>
      </Card>

      {/* 담당자 정보 */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text-900 mb-6">담당자 정보</h3>
        <div className="space-y-6">
          {/* 예비조사자 */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <label className="block text-sm font-semibold text-blue-900 mb-3">
              예비조사자 (복수 선택 가능)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {MEASURER_LIST.map((measurer) => (
                <div
                  key={measurer}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${
                    preliminarySurveyors.includes(measurer)
                      ? "bg-blue-100 border-blue-400 shadow-sm"
                      : "bg-white border-blue-200 hover:bg-blue-50"
                  }`}
                  onClick={() => handlePreliminarySurveyorToggle(measurer)}
                >
                  <Checkbox
                    label={measurer}
                    checked={preliminarySurveyors.includes(measurer)}
                    onChange={() => handlePreliminarySurveyorToggle(measurer)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 실측정자 */}
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <label className="block text-sm font-semibold text-green-900 mb-3">
              실측정자 (복수 선택 가능)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {MEASURER_LIST.map((measurer) => (
                <div
                  key={measurer}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${
                    actualMeasurers.includes(measurer)
                      ? "bg-green-100 border-green-400 shadow-sm"
                      : "bg-white border-green-200 hover:bg-green-50"
                  }`}
                  onClick={() => handleActualMeasurerToggle(measurer)}
                >
                  <Checkbox
                    label={measurer}
                    checked={actualMeasurers.includes(measurer)}
                    onChange={() => handleActualMeasurerToggle(measurer)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 보고서 담당 */}
          <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
            <label className="block text-sm font-semibold text-purple-900 mb-3">
              보고서 담당 (단수 선택)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {MEASURER_LIST.map((measurer) => (
                <div
                  key={measurer}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${
                    reportWriter === measurer
                      ? "bg-purple-100 border-purple-400 shadow-sm ring-2 ring-purple-300"
                      : "bg-white border-purple-200 hover:bg-purple-50"
                  }`}
                  onClick={() => handleReportWriterChange(measurer)}
                >
                  <div className="flex items-center">
                    <input
                      type="radio"
                      name="reportWriter"
                      checked={reportWriter === measurer}
                      onChange={() => handleReportWriterChange(measurer)}
                      className="w-4 h-4 text-purple-600 focus:ring-purple-500 focus:ring-2"
                    />
                    <label className="ml-2 text-sm font-medium text-text-700 cursor-pointer">
                      {measurer}
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* 버튼 */}
      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            취소
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "저장 중..." : initialData && (initialData as any).id ? "수정" : "등록"}
        </Button>
      </div>
    </form>
  );
};
