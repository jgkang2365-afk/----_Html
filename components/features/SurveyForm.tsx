"use client";

import React, { useState, useEffect, useRef } from "react";
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
  "이태환, 강종구",
  "이주형",
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
  year: string;
  period: string;
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
    year: "2026",
    period: "상반기",
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
  const [unpaidWarningMessage, setUnpaidWarningMessage] = useState<React.ReactNode>("");

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

  // 사용자 목록 (측정자와 연동)
  const [users, setUsers] = useState<Array<{ id: number; name: string; survey_code: string | null }>>([]);

  // 순번 자동 계산 (신규 등록 시)
  const [nextSequenceNumber, setNextSequenceNumber] = useState<number | null>(null);

  // 사용자 목록 가져오기
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch("/api/users");
        if (response.ok) {
          const data = await response.json();
          // survey_code가 있는 사용자만 필터링
          const usersWithSurveyCode = (data.users || []).filter(
            (user: { survey_code?: string | null }) => user.survey_code
          );
          setUsers(usersWithSurveyCode);
        }
      } catch (err) {
        console.error("사용자 목록 가져오기 실패:", err);
      }
    };
    fetchUsers();
  }, []);

  // 순번 자동 계산 (신규 등록 시만)
  useEffect(() => {
    if (!initialData?.id) {
      // 신규 등록 시 현재 등록된 예비조사 중 가장 큰 순번 + 1
      const fetchNextSequence = async () => {
        try {
          const response = await fetch("/api/survey?maxSequence=true");
          if (response.ok) {
            const data = await response.json();
            setNextSequenceNumber((data.maxSequence || 0) + 1);
          } else {
            // API가 없으면 기본값 1로 설정
            setNextSequenceNumber(1);
          }
        } catch (err) {
          console.error("순번 조회 실패:", err);
          setNextSequenceNumber(1);
        }
      };
      fetchNextSequence();
    }
  }, [initialData?.id]);

  // 초기 데이터 설정
  useEffect(() => {
    if (initialData) {
      // 날짜 값을 엄격하게 정규화
      const normalizedMeasurementDate = normalizeForDateInput(initialData.measurement_date);
      const normalizedEndDate = normalizeForDateInput(initialData.end_date);

      // 실측정자 및 보고서 담당 처리 (formData 설정보다 먼저 계산)
      let initialActualMeasurers: string[] = [];
      if (initialData.actual_measurer) {
        initialActualMeasurers = initialData.actual_measurer.split(",").map((m) => m.trim());
      }

      let initialReportWriter = "";
      if (initialData.report_writer) {
        // 보고서 담당은 단수이므로 첫 번째 값만 사용
        const writers = initialData.report_writer.split(",").map((m) => m.trim());
        initialReportWriter = writers[0] || "";

        // 보고서 담당자가 실측정자 목록에 없으면 추가
        if (initialReportWriter && !initialActualMeasurers.includes(initialReportWriter)) {
          initialActualMeasurers.push(initialReportWriter);
        }
      }

      setActualMeasurers(initialActualMeasurers);
      setReportWriter(initialReportWriter);

      // 정규화된 날짜를 포함한 초기 데이터 설정
      setFormData({
        year: initialData.year ? String(initialData.year) : "2026",
        period: initialData.period || "상반기",
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
        actual_measurer: initialActualMeasurers.join(", "), // 계산된 값 사용 (중요: 보고서 담당자 포함된 값)
        report_writer: initialReportWriter,
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
        const businessCount = data.businessUnpaidCount || 0;
        const businessAmount = data.businessUnpaidAmount || 0;
        const nationalCount = data.nationalUnpaidCount || 0;
        const nationalAmount = data.nationalUnpaidAmount || 0;

        const businessMsg = businessCount > 0
          ? `사업장 미수: ${businessCount}건 (${businessAmount.toLocaleString()}원)`
          : "";
        const nationalMsg = nationalCount > 0
          ? `국고 미수: ${nationalCount}건 (${nationalAmount.toLocaleString()}원)`
          : "";

        let textColorClass = "text-gray-800";
        let titleColorClass = "text-gray-800";

        if (businessCount > 0) {
          textColorClass = "text-red-600 font-bold";
          titleColorClass = "text-red-600";
        } else if (nationalCount > 0) {
          textColorClass = "text-blue-600 font-bold";
          titleColorClass = "text-blue-600";
        }

        const message = (
          <div className="text-left">
            <p className={`text-lg font-bold mb-2 ${titleColorClass}`}>
              &quot;{businessName}&quot; 업체는 미수금이 있습니다.
            </p>
            <div className={`p-3 bg-white rounded border border-gray-200 ${textColorClass}`}>
              {[businessMsg, nationalMsg].filter(Boolean).map((msg, idx) => (
                <p key={idx} className="mb-1 last:mb-0">{msg}</p>
              ))}
            </div>
            <p className="mt-2 text-sm text-gray-600">
              새로운 예비조사 등록 시 주의해주세요.
            </p>
          </div>
        );

        setUnpaidWarningMessage(message);
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
  // 측정자별 예비조사자 매핑
  const getPreliminarySurveyorByMeasurer = (measurer: string): string | null => {
    const mapping: Record<string, string> = {
      "이태환": "이태환",
      "한기문": "한기문",
      "이주형": "이주형",
      "강종구": "이태환, 강종구",
      "배윤민": "한기문, 배윤민",
      "고유빈": "이주형, 고유빈",
    };
    return mapping[measurer] || null;
  };

  const handleMeasurerToggle = (measurer: string) => {
    const isAdding = !selectedMeasurers.includes(measurer);
    const updated = isAdding
      ? [...selectedMeasurers, measurer]
      : selectedMeasurers.filter((m) => m !== measurer);

    setSelectedMeasurers(updated);

    // 공시료 코드 자동 부여
    // 첫 번째 측정자의 공시료 코드를 사용
    let surveyCode = "";
    if (updated.length > 0) {
      const firstMeasurer = updated[0];
      // 사용자 목록에서 해당 측정자의 survey_code 확인
      const user = users.find((u) => u.name === firstMeasurer);

      if (user && user.survey_code) {
        // 사용자에 등록된 공시료 코드가 있으면 사용
        surveyCode = user.survey_code;
      } else {
        // 없으면 기존 로직 사용
        surveyCode = getSurveyCode(firstMeasurer) || "";
      }
    }

    const measurerStr = updated.join(", ");

    // 측정자 선택/해제에 따라 예비조사자 자동 설정
    let updatedPreliminarySurveyors = [...preliminarySurveyors];
    const correspondingPreliminarySurveyor = getPreliminarySurveyorByMeasurer(measurer);

    if (correspondingPreliminarySurveyor) {
      if (isAdding) {
        // 측정자가 선택되면 해당 예비조사자 조합도 자동으로 체크
        if (!updatedPreliminarySurveyors.includes(correspondingPreliminarySurveyor)) {
          updatedPreliminarySurveyors = [...updatedPreliminarySurveyors, correspondingPreliminarySurveyor];
        }
      } else {
        // 측정자가 해제되면 해당 예비조사자 조합도 자동으로 해제
        updatedPreliminarySurveyors = updatedPreliminarySurveyors.filter((p) => p !== correspondingPreliminarySurveyor);
      }
    }

    setPreliminarySurveyors(updatedPreliminarySurveyors);

    setFormData((prev) => ({
      ...prev,
      measurer: measurerStr,
      survey_code: surveyCode,
      preliminary_surveyor: updatedPreliminarySurveyors.join(", "),
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

    // 실측정자가 선택되면 보고서 담당도 동일 이름으로 자동 체크
    if (updated.includes(measurer)) {
      // 실측정자가 추가된 경우, 보고서 담당도 동일 이름으로 설정
      setReportWriter(measurer);
      setFormData((prev) => ({
        ...prev,
        report_writer: measurer,
      }));
    } else {
      // 실측정자가 해제된 경우, 보고서 담당이 해당 이름이면 해제
      if (reportWriter === measurer) {
        setReportWriter("");
        setFormData((prev) => ({
          ...prev,
          report_writer: "",
        }));
      }
    }
  };

  // 보고서 담당 선택 처리 (단수 선택)
  const handleReportWriterChange = (measurer: string) => {
    const selected = reportWriter === measurer ? "" : measurer;
    setReportWriter(selected);

    // 보고서 담당자가 선택되면 실측정자 목록에도 자동으로 추가 (기존 목록 유지)
    if (selected && !actualMeasurers.includes(selected)) {
      const updatedActuals = [...actualMeasurers, selected];
      setActualMeasurers(updatedActuals);
      setFormData((prev) => ({
        ...prev,
        report_writer: selected,
        actual_measurer: updatedActuals.join(", "),
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        report_writer: selected,
      }));
    }
  };

  // 스크롤 처리를 위한 Ref
  const topRef = useRef<HTMLDivElement>(null);

  // 폼 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log("[SurveyForm] Submitting formData:", formData);
    setError(null);
    setWarning(null);

    // 에러 발생 시 최상단으로 스크롤하는 함수
    const scrollToTop = () => {
      setTimeout(() => {
        if (topRef.current) {
          topRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
    };

    // 필수 필드 검증
    if (!formData.measurement_date) {
      const msg = "측정일을 입력해주세요.";
      setError(msg);
      scrollToTop();
      return;
    }
    if (!formData.business_name) {
      const msg = "사업장명을 입력해주세요.";
      setError(msg);
      scrollToTop();
      return;
    }
    if (!formData.measurer) {
      const msg = "측정자를 선택해주세요.";
      setError(msg);
      scrollToTop();
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
          scrollToTop(); // 경고 메시지도 보이도록 스크롤
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
        scrollToTop();
      }
    } catch (err: any) {
      console.error("저장 오류:", err);
      setError(err.message || "저장 중 오류가 발생했습니다.");
      scrollToTop();
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div ref={topRef} /> {/* 스크롤 타겟 */}
      {error && <Alert variant="error">{error}</Alert>}
      {warning && <Alert variant="warning">{warning}</Alert>}

      {/* 기본 정보 */}
      <Card className="p-6">
        <h3 className="text-lg font-semibold text-text-900 mb-4">기본 정보</h3>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mb-6">
          <div className="md:col-span-3 lg:col-span-2">
            <Input
              label="년도"
              type="number"
              value={formData.year}
              onChange={(e) => setFormData(prev => ({ ...prev, year: e.target.value }))}
              required
            />
          </div>
          <div className="md:col-span-9 lg:col-span-10">
            <label className="block text-sm font-medium text-text-700 mb-2">
              주기
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {["상반기", "상반기(수시)", "하반기", "하반기(수시)"].map((period) => (
                <div
                  key={period}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${formData.period === period
                    ? "bg-indigo-100 border-indigo-400 shadow-sm ring-2 ring-indigo-300"
                    : "bg-white border-gray-200 hover:bg-indigo-50"
                    }`}
                  onClick={() => setFormData(prev => ({ ...prev, period }))}
                >
                  <div className="flex items-center justify-center">
                    <input
                      type="radio"
                      name="period"
                      checked={formData.period === period}
                      onChange={() => setFormData(prev => ({ ...prev, period }))}
                      className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 focus:ring-2 cursor-pointer"
                    />
                    <label className="ml-2 text-sm font-medium text-text-700 cursor-pointer">
                      {period}
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Input
            label="순번"
            value={
              initialData?.id
                ? ((initialData as any).sequence_number?.toString() || "-")
                : (nextSequenceNumber?.toString() || "계산 중...")
            }
            readOnly
            className="bg-surface-50"
          />
          <Input
            label="측정일"
            type="date"
            value={formData.measurement_date || ""}
            onChange={(e) => handleMeasurementDateChange(e.target.value)}
            required
          />
          <Input
            label="측정종료일"
            type="date"
            value={formData.end_date || ""}
            onChange={(e) => handleEndDateChange(e.target.value)}
          />
          <Input
            label="측정요일"
            value={formData.measurement_weekdays}
            readOnly
            className="bg-surface-50"
          />
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
            onChange={(e) => setFormData(prev => ({ ...prev, business_name: e.target.value }))}
            className=""
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {PRELIMINARY_SURVEYOR_OPTIONS.map((option) => (
                <div
                  key={option}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${preliminarySurveyors.includes(option)
                    ? "bg-blue-100 border-blue-400 shadow-sm"
                    : "bg-white border-blue-200 hover:bg-blue-50"
                    }`}
                  onClick={() => handlePreliminarySurveyorToggle(option)}
                >
                  <Checkbox
                    label={option}
                    checked={preliminarySurveyors.includes(option)}
                    onChange={() => { }} // 중복 토글 방지를 위해 빈 함수로 설정 (div onClick에서 처리)
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {MEASURER_LIST.map((measurer) => (
                <div
                  key={measurer}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${actualMeasurers.includes(measurer)
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {MEASURER_LIST.map((measurer) => (
                <div
                  key={measurer}
                  className={`p-2 rounded-md border transition-colors cursor-pointer ${reportWriter === measurer
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
