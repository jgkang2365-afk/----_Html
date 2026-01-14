"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Modal } from "@/components/ui/Modal";
import {
  formatDateYYYYMMDD,
  calculateMeasurementWeekdays,
} from "@/lib/utils/date-utils";
import { normalizeForDateInput, isValidDateString } from "@/lib/utils/date-validator";
import { formatBusinessNumber } from "@/lib/utils/business-number";
import { MEASURER_LIST, getSurveyCode } from "@/lib/utils/survey-code";

// 예비조사자 조합 목록
const PRELIMINARY_SURVEYOR_OPTIONS = [
  "이태환",
  "한기문",
  "이주형",
  "이태환, 강종구",
  "한기문, 배윤민",
  "이주형, 고유빈",
];

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
  initialData?: Partial<SurveyFormData> & { id?: number };
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

  const [endDateManuallyModified, setEndDateManuallyModified] = useState(false); // 종료일이 수동으로 수정되었는지 추적
  const [businessList, setBusinessList] = useState<BusinessInfo[]>([]);
  const [selectedBusiness, setSelectedBusiness] = useState<string>("");
  const [isNewBusiness, setIsNewBusiness] = useState(false);
  const [selectedMeasurers, setSelectedMeasurers] = useState<string[]>([]);
  const [preliminarySurveyors, setPreliminarySurveyors] = useState<string[]>([]); // 선택된 예비조사자 조합 배열
  const [actualMeasurers, setActualMeasurers] = useState<string[]>([]);
  const [reportWriter, setReportWriter] = useState<string>(""); // 단수 선택
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null); // 경고 메시지
  const [loadingBusiness, setLoadingBusiness] = useState(false);
  const [isUnpaidWarningModalOpen, setIsUnpaidWarningModalOpen] = useState(false);
  const [unpaidWarningMessage, setUnpaidWarningMessage] = useState<string>("");
  
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
      // 날짜 값을 엄격하게 정규화
      const normalizedMeasurementDate = normalizeForDateInput(initialData.measurement_date);
      const normalizedEndDate = normalizeForDateInput(initialData.end_date);
      
      // 정규화된 날짜를 포함한 초기 데이터 설정
      setFormData({
        measurement_date: normalizedMeasurementDate,
        end_date: normalizedEndDate || normalizedMeasurementDate, // 종료일이 없으면 측정일과 동일하게
        measurement_weekdays: initialData.measurement_weekdays || "",
        code: initialData.code || "",
        business_name: initialData.business_name || "",
        business_number: initialData.business_number || "",
        measurer: initialData.measurer || "",
        survey_code: initialData.survey_code || "",
        address: initialData.address || "",
        preliminary_surveyor: initialData.preliminary_surveyor || "",
        actual_measurer: initialData.actual_measurer || "",
        report_writer: initialData.report_writer || "",
      });
      
      // 종료일이 없고 측정일만 있으면 종료일을 측정일과 동일하게 설정
      if (normalizedMeasurementDate && !normalizedEndDate) {
        setEndDateManuallyModified(false);
      } else if (normalizedEndDate) {
        setEndDateManuallyModified(true); // 초기 데이터가 있으면 수동 수정된 것으로 간주
      }
      
      // 측정자 설정
      if (initialData.measurer) {
        setSelectedMeasurers(initialData.measurer.split(",").map((m) => m.trim()));
      }
      
      // 예비조사자 설정 (조합 목록과 매칭)
      if (initialData.preliminary_surveyor) {
        const savedValue = initialData.preliminary_surveyor.trim();
        // 저장된 값 정규화 함수 (공백 제거 후 비교)
        const normalizeValue = (value: string) => 
          value.replace(/\s*,\s*/g, ",").trim();
        
        const normalizedSavedValue = normalizeValue(savedValue);
        
        // 저장된 값이 여러 조합으로 저장되어 있을 수 있음 (콤마로 구분된 여러 조합)
        // 예: "이태환, 한기문" -> ["이태환", "한기문"]로 분리
        // 하지만 실제로는 "이태환, 한기문"이 하나의 조합일 수도 있음
        
        // 먼저 전체 값이 조합 목록 중 하나와 일치하는지 확인
        let matchedOptions: string[] = [];
        PRELIMINARY_SURVEYOR_OPTIONS.forEach((option) => {
          const normalizedOption = normalizeValue(option);
          if (normalizedOption === normalizedSavedValue) {
            matchedOptions.push(option);
          }
        });
        
        // 일치하는 조합이 없으면, 저장된 값을 콤마로 분리하여 각각이 조합 목록에 있는지 확인
        if (matchedOptions.length === 0 && savedValue.includes(",")) {
          const parts = savedValue.split(",").map(s => s.trim()).filter(Boolean);
          PRELIMINARY_SURVEYOR_OPTIONS.forEach((option) => {
            const normalizedOption = normalizeValue(option);
            // 조합의 각 부분이 저장된 값의 부분과 일치하는지 확인
            const optionParts = option.split(",").map(s => s.trim());
            if (optionParts.every(part => parts.includes(part)) && 
                parts.every(part => optionParts.includes(part))) {
              matchedOptions.push(option);
            }
          });
        }
        
        if (matchedOptions.length > 0) {
          setPreliminarySurveyors(matchedOptions);
        } else {
          // 일치하는 조합이 없으면 빈 배열로 설정 (사용자가 수동으로 선택하도록)
          setPreliminarySurveyors([]);
        }
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

  // 측정일이 변경될 때 종료일 자동 설정 (초기값이 비어있을 때)
  useEffect(() => {
    if (formData.measurement_date && isValidDateString(formData.measurement_date) && !endDateManuallyModified && !formData.end_date) {
      setFormData((prev) => ({ ...prev, end_date: prev.measurement_date }));
    }
  }, [formData.measurement_date, endDateManuallyModified, formData.end_date]);

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

  // 미수금 확인 함수
  const checkUnpaidCount = async (businessName: string) => {
    if (!businessName || !businessName.trim()) {
      return;
    }

    try {
      const response = await fetch(`/api/sales/check-unpaid?businessName=${encodeURIComponent(businessName)}`);
      const data = await response.json();

      if (response.ok && data.hasWarning) {
        setUnpaidWarningMessage(
          `"${businessName}" 업체는 측정비(사업장) 기준으로 미수금이 ${data.unpaidCount}회 있습니다. 등록 시 주의해주세요.`
        );
        setIsUnpaidWarningModalOpen(true);
      }
    } catch (err) {
      console.error("미수금 확인 오류:", err);
      // 오류 발생 시에도 계속 진행 (경고만 표시하지 않음)
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
    
    // 미수금 확인
    checkUnpaidCount(business.business_name);
  };

  // 측정일 입력 처리
  const handleMeasurementDateChange = (value: string) => {
    // HTML5 date input: 날짜 선택 도구 사용 시 완전한 값, 수동 입력 시 부분 값도 올 수 있음
    // 완전한 YYYY-MM-DD 형식일 때만 저장, 부분 입력은 무시 (브라우저가 처리하도록)
    if (value && isValidDateString(value)) {
      setFormData((prev) => {
        const updated = { ...prev, measurement_date: value };
        
        // 종료일이 수동으로 수정되지 않았고 비어있거나 측정일과 동일한 경우에만 종료일을 측정일과 동일하게 설정
        if (!endDateManuallyModified && (!prev.end_date || prev.end_date === prev.measurement_date)) {
          updated.end_date = value;
        }
        
        // 측정요일 계산
        const currentEndDate = updated.end_date || value;
        if (value && currentEndDate) {
          updateMeasurementWeekdays(value, currentEndDate);
        }
        
        return updated;
      });
    } else if (!value) {
      // 빈 값일 때는 빈 문자열로 저장
      setFormData((prev) => ({ ...prev, measurement_date: "" }));
    }
    // 부분 입력(value가 있지만 유효하지 않음)은 무시 - 브라우저가 처리하도록
  };

  // 종료일 입력 처리
  const handleEndDateChange = (value: string) => {
    // HTML5 date input: 날짜 선택 도구 사용 시 완전한 값, 수동 입력 시 부분 값도 올 수 있음
    // 완전한 YYYY-MM-DD 형식일 때만 저장, 부분 입력은 무시 (브라우저가 처리하도록)
    if (value && isValidDateString(value)) {
      setEndDateManuallyModified(true); // 사용자가 수동으로 수정했음을 표시
      setFormData((prev) => {
        const updated = { ...prev, end_date: value };
        // 측정요일 계산
        if (prev.measurement_date && value) {
          updateMeasurementWeekdays(prev.measurement_date, value);
        }
        return updated;
      });
    } else if (!value) {
      // 빈 값일 때는 빈 문자열로 저장
      setEndDateManuallyModified(true);
      setFormData((prev) => ({ ...prev, end_date: "" }));
    }
    // 부분 입력(value가 있지만 유효하지 않음)은 무시 - 브라우저가 처리하도록
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
      
      // 미수금 확인
      checkUnpaidCount(business.business_name);
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

  // 예비조사자 선택 처리 (조합 단위로 선택)
  const handlePreliminarySurveyorToggle = (option: string) => {
    const updated = preliminarySurveyors.includes(option)
      ? preliminarySurveyors.filter((o) => o !== option)
      : [...preliminarySurveyors, option];
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
      const isEditMode = initialData?.id !== undefined;
      const url = isEditMode 
        ? `/api/survey/${initialData.id}`
        : "/api/survey";
      
      const method = isEditMode ? "PUT" : "POST";
      
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
          <Input
            label="측정일"
            type="date"
            value={formData.measurement_date || ""}
            onChange={(e) => handleMeasurementDateChange(e.target.value)}
            required
          />
          <Input
            label="종료일"
            type="date"
            value={formData.end_date || formData.measurement_date || ""}
            onChange={(e) => handleEndDateChange(e.target.value)}
          />
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
            value={formatBusinessNumber(formData.business_number)}
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {PRELIMINARY_SURVEYOR_OPTIONS.map((option) => (
                <div
                  key={option}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${
                    preliminarySurveyors.includes(option)
                      ? "bg-blue-100 border-blue-400 shadow-sm"
                      : "bg-white border-blue-200 hover:bg-blue-50"
                  }`}
                  onClick={() => handlePreliminarySurveyorToggle(option)}
                >
                  <Checkbox
                    label={option}
                    checked={preliminarySurveyors.includes(option)}
                    onChange={() => handlePreliminarySurveyorToggle(option)}
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
          {loading ? "저장 중..." : initialData?.id ? "수정" : "등록"}
        </Button>
      </div>

      {/* 미수금 경고 모달 */}
      <Modal
        isOpen={isUnpaidWarningModalOpen}
        onClose={() => setIsUnpaidWarningModalOpen(false)}
        title="미수금 경고"
        size="md"
      >
        <div className="py-4">
          <Alert variant="warning">{unpaidWarningMessage}</Alert>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" onClick={() => setIsUnpaidWarningModalOpen(false)}>
              확인
            </Button>
          </div>
        </div>
      </Modal>
    </form>
  );
};
