"use client";

import React, { useState, useEffect, useRef } from "react";
import { DESIGNATED_OFFICE_OPTIONS_WITHOUT_ALL, toShortName } from "@/lib/constants/designated-offices";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Checkbox } from "@/components/ui/Checkbox";
import { normalizeDateForInput } from "@/lib/utils/date-normalize";
import { formatBusinessNumber, parseBusinessNumber, isValidDigitCount } from "@/lib/utils/business-number";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";

interface JournalEntry {
  id: number | null;
  code: string;
  measurement_year: number;
  measurement_period: string;
  business_name: string;
  designated_office: string;
  address: string;
  completion_status: string;
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  measurer: string | null;
  business_category?: string | null;
  invoice_email_2?: string;
  electronic_invoice_date_2?: string;
  deposit_date_business_2?: string;
  deposit_amount_business_2?: number;
  _isFromBusiness?: boolean;
  [key: string]: any;
}

interface JournalEditFormProps {
  entry: JournalEntry;
  onClose: () => void;
  onSuccess: (savedJournalId?: number | null) => void;
  setIsSubmitting?: (isSubmitting: boolean) => void;
  mode?: 'journal' | 'sales';
}

export const JournalEditForm: React.FC<JournalEditFormProps> = ({
  entry,
  onClose,
  onSuccess,
  setIsSubmitting,
  mode = 'journal',
}) => {
  const { user } = useUser();
  // isAdmin은 user.role이 "관리자"인 경우
  const isAdmin = user?.role === "관리자";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [originalYear, setOriginalYear] = useState(entry.measurement_year);
  const [originalPeriod, setOriginalPeriod] = useState(entry.measurement_period);
  const [autoFilling, setAutoFilling] = useState(false);
  const [pendingNumberRequest, setPendingNumberRequest] = useState<any>(null);
  const [requestingNumberChange, setRequestingNumberChange] = useState(false);
  const [businessCategories, setBusinessCategories] = useState<{ value: string; label: string }[]>([]);
  // 예비조사 정보를 별도로 보여주기 위한 상태
  const [surveyInfo, setSurveyInfo] = useState<any>(null);
  // 전회 측정비 정보 (참고용)
  const [previousMeasurementFee, setPreviousMeasurementFee] = useState<{
    business: number | null;
    national: number | null;
  }>({ business: null, national: null });

  // 전회 이메일 정보 (담당자, 계산서1, 계산서2)
  const [previousEmails, setPreviousEmails] = useState<{
    manager_email: string | null;
    invoice_email: string | null;
    invoice_email_2: string | null;
  }>({ manager_email: null, invoice_email: null, invoice_email_2: null });

  // 완료 상태에 따른 잠금 여부 (관리자나 DB관리는 잠그지 않음)
  const isLockedByCompletion = (entry.id && !isAdmin) ? entry.completion_status === "완료" : false;
  // 기존의 isCompleted 변수 (일부 버튼 비활성화 등에 사용됨)
  const isCompleted = isLockedByCompletion;

  // 측정 시작일 변경 감지를 위한 ref
  const prevStartDateRef = useRef<string | null>(normalizeDateForInput(entry.measurement_start_date));

  const [formData, setFormData] = useState({
    // 기본 정보
    code: entry.code,
    measurement_year: entry.measurement_year,
    measurement_period: entry.measurement_period,
    // note 필드에서 비고 체크박스 옵션에 해당하는 값만 필터링
    note: (() => {
      const validNoteValues = ["최초실시", "고시물질", "공정 수시변경", "소음 85 이상", "전회 미실시", "타기관 신규"];
      if (!entry.note) {
        console.log('[JournalEditForm] 초기화: entry.note가 없음');
        return [];
      }
      if (typeof entry.note === 'string') {
        const noteString = entry.note.trim();
        const splitNotes = noteString.split(',').map(n => n.trim()).filter(Boolean);

        const foundNotes = splitNotes.filter(note => {
          if (note.includes(':')) return false;
          return validNoteValues.includes(note);
        });

        // 초기 상태 설정 시 원본 텍스트(체크박스 이외의 텍스트) 추출은 건너뜀 (useEffect에서 처리)
        return foundNotes;
      }
      if (Array.isArray(entry.note)) {
        return entry.note.filter(note => validNoteValues.includes(String(note)));
      }
      return [];
    })(),
    designated_office: entry.designated_office || "",
    office_jurisdiction: entry.office_jurisdiction || "",
    document_number: entry.document_number || "",
    sequence_number: entry.sequence_number || "",
    five_plus_sequence: entry.five_plus_sequence || "",

    // 측정 정보
    measurement_start_date: normalizeDateForInput(entry.measurement_start_date),
    measurement_end_date: normalizeDateForInput(entry.measurement_end_date),
    measurer: entry.measurer || "",
    completion_status: entry.completion_status || "미완료",

    // 사업장 정보
    business_name: entry.business_name || "",
    total_employees: entry.total_employees || "",
    business_number: entry.business_number || "",
    industrial_accident_number: entry.industrial_accident_number || "",
    commencement_number: entry.commencement_number || "",
    representative_name: entry.representative_name || "",
    national_support_status: entry.national_support_status || "",
    address: entry.address || "",
    phone: entry.phone || "",
    fax: entry.fax || "",
    business_category: entry.business_category || "",

    // 담당자 정보
    manager_name: entry.manager_name || "",
    manager_position: entry.manager_position || "",
    manager_mobile: entry.manager_mobile || "",
    manager_email: entry.manager_email || "",

    // K2B 정보
    k2b_send_date: normalizeDateForInput(entry.k2b_send_date),
    k2b_sender: (entry.report_writer ? entry.report_writer.split(',')[0].trim() : "") || entry.k2b_sender || "",
    invoice_email: entry.invoice_email || "",
    electronic_invoice_date: normalizeDateForInput(entry.electronic_invoice_date),
    invoice_email_2: entry.invoice_email_2 || "",
    electronic_invoice_date_2: normalizeDateForInput(entry.electronic_invoice_date_2),

    // 측정비 정보
    measurement_fee_total: entry.measurement_fee_total || "",
    measurement_fee_business: entry.measurement_fee_business || "",
    measurement_fee_national: entry.measurement_fee_national || "",

    // 입금 정보
    deposit_total: entry.deposit_total || "",
    deposit_date_business: normalizeDateForInput(entry.deposit_date_business),
    deposit_amount_business: entry.deposit_amount_business || "",
    deposit_date_business_2: normalizeDateForInput(entry.deposit_date_business_2),
    deposit_amount_business_2: entry.deposit_amount_business_2 || "",
    deposit_date_national: normalizeDateForInput(entry.deposit_date_national),
    deposit_amount_national: entry.deposit_amount_national || "",

    // 전자계산서 정보 (발행처)
    invoice_business_name: entry.invoice_business_name || "",
    invoice_business_number: entry.invoice_business_number || "",
    
    // 특이사항
    special_notes: entry.special_notes || "",
  });

  // 비고 옵션 (복수 선택 가능)
  const noteOptions = [
    { value: "최초실시", label: "최초실시" },
    { value: "고시물질", label: "고시물질" },
    { value: "공정 수시변경", label: "공정 수시변경" },
    { value: "소음 85 이상", label: "소음 85 이상" },
    { value: "전회 미실시", label: "전회 미실시" },
    { value: "타기관 신규", label: "타기관 신규" },
  ];

  // 지정한계_관할지청 옵션
  const designatedOfficeOptions = DESIGNATED_OFFICE_OPTIONS_WITHOUT_ALL;

  // 측정주기 옵션
  const periodOptions = [
    { value: "상반기", label: "상반기" },
    { value: "상반기(수시)", label: "상반기(수시)" },
    { value: "하반기", label: "하반기" },
    { value: "하반기(수시)", label: "하반기(수시)" },
  ];

  // 국고지원 여부 옵션
  const nationalSupportOptions = [
    { value: "", label: "선택" },
    { value: "지원", label: "지원" },
    { value: "비대상", label: "비대상" },
  ];

  // 완료여부 옵션
  const completionStatusOptions = [
    { value: "미완료", label: "미완료" },
    { value: "완료", label: "완료" },
  ];


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

  // 측정비 합계 자동 계산
  useEffect(() => {
    // 국고지원 여부가 "비대상"인 경우 사업장만으로 계산
    if (formData.national_support_status === "비대상") {
      const business = parseFloat(parseCurrency(formData.measurement_fee_business)) || 0;
      setFormData((prev) => ({
        ...prev,
        measurement_fee_total: business > 0 ? business.toString() : "",
      }));
    } else {
      const business = parseFloat(parseCurrency(formData.measurement_fee_business)) || 0;
      const national = parseFloat(parseCurrency(formData.measurement_fee_national)) || 0;
      const total = business + national;
      if (total > 0 || formData.measurement_fee_business || formData.measurement_fee_national) {
        setFormData((prev) => ({
          ...prev,
          measurement_fee_total: total > 0 ? total.toString() : "",
        }));
      }
    }
  }, [formData.measurement_fee_business, formData.measurement_fee_national, formData.national_support_status]);

  // 입금액 합계 자동 계산 (로직 개선)
  useEffect(() => {
    const getNumber = (val: any) => {
      if (!val) return 0;
      // 콤마 제거 및 공백 제거 후 파싱
      const str = String(val).replace(/,/g, "").trim();
      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    };

    const business = getNumber(formData.deposit_amount_business);
    const business2 = getNumber(formData.deposit_amount_business_2);
    const national = getNumber(formData.deposit_amount_national);

    const isNA = formData.national_support_status === "비대상";

    // 국고지원이 비대상이면 국고 금액 제외하고 합산
    const total = isNA ? (business + business2) : (business + business2 + national);

    const newTotalStr = total > 0 ? total.toString() : "";

    // 현재 값(문자열 변환)과 다를 때만 업데이트 (무한 루프 방지)
    if (String(formData.deposit_total || "") !== newTotalStr) {
      if (total > 0 || formData.deposit_amount_business || formData.deposit_amount_business_2 || (!isNA && formData.deposit_amount_national)) {
        console.log('[JournalEditForm] 입금액 합계 자동 갱신:', {
          기존합계: formData.deposit_total,
          신규합계: newTotalStr,
          상세: { business, business2, national, isNA }
        });
        setFormData((prev) => ({
          ...prev,
          deposit_total: newTotalStr,
        }));
      }
    }
  }, [
    formData.deposit_amount_business,
    formData.deposit_amount_business_2,
    formData.deposit_amount_national,
    formData.national_support_status,
    formData.deposit_total
  ]);

  // 국고지원 여부가 "비대상"일 때 국고 관련 필드 초기화
  useEffect(() => {
    if (formData.national_support_status === "비대상") {
      setFormData((prev) => {
        // 이미 초기화되어 있으면 변경하지 않음
        if (!prev.measurement_fee_national && !prev.deposit_date_national && !prev.deposit_amount_national) {
          return prev;
        }
        console.log('[JournalEditForm] 국고지원 여부가 "비대상"으로 변경되어 국고 관련 필드를 초기화');
        return {
          ...prev,
          measurement_fee_national: "",
          deposit_date_national: "",
          deposit_amount_national: "",
        };
      });
    }
  }, [formData.national_support_status]);

  // 초기 로드 시 주소가 있으면 자동 입력 및 사업자번호 포맷팅
  useEffect(() => {
    if (entry.address && !entry.office_jurisdiction) {
      handleAddressChange(entry.address);
    }
    // 사업자번호는 표시 시 포맷팅하므로 초기값은 그대로 사용
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // entry가 변경될 때 전회 측정비 정보 초기화
  useEffect(() => {
    // 수정 모드(entry.id가 있음)일 때는 전회치를 표시하지 않음
    if (entry.id) {
      setPreviousMeasurementFee({ business: null, national: null });
    }
  }, [entry.id]);

  // 직전 측정일지 및 예비조사 데이터 자동 채우기
  useEffect(() => {
    // 필수 필드가 모두 있을 때만 실행 (등록/수정 모두 포함)
    if (entry.code && entry.measurement_year && entry.measurement_period) {
      const fetchPreviousData = async () => {
        try {
          const response = await fetch(
            `/api/journal/previous-data?code=${encodeURIComponent(entry.code)}&year=${entry.measurement_year}&period=${encodeURIComponent(entry.measurement_period)}`
          );

          if (response.ok) {
            const data = await response.json();

            // 디버깅: 산재관리번호 확인
            console.log('[JournalEditForm] 직전 측정일지 데이터:', {
              hasPreviousData: !!data.previousData,
              industrial_accident_number: data.previousData?.industrial_accident_number,
            });

            // 기존 값이 비어있을 때만 데이터로 채우기
            setFormData((prev) => {
              const updated = { ...prev };

              // 이름/직위 분리 헬퍼 함수
              const separateNameAndPosition = (fullName: string) => {
                if (!fullName) return { name: "", position: "" };
                const trimmed = fullName.trim();
                // 공백이 포함되어 있으면 분리 시도
                if (trimmed.includes(' ')) {
                  const parts = trimmed.split(/\s+/);
                  // "이름 직위" 형식이면 (최소 2단어 이상)
                  if (parts.length >= 2) {
                    const position = parts[parts.length - 1]; // 마지막 단어는 직위
                    const name = parts.slice(0, parts.length - 1).join(' '); // 나머지는 이름
                    return { name, position };
                  }
                }
                return { name: trimmed, position: "" };
              };

              // 직전 측정일지 데이터
              if (data.previousData) {
                let pName = data.previousData.manager_name || "";
                let pPosition = data.previousData.manager_position || "";

                if (pName) {
                  const trimmedName = pName.trim();

                  // 1. 직위가 이미 있는 경우: 이름 끝에 직위가 붙어있으면 제거
                  if (pPosition) {
                    const trimmedPosition = pPosition.trim();
                    if (trimmedPosition && trimmedName.endsWith(trimmedPosition)) {
                      // 이름에서 직위 제거 (예: "이재홍 이사" -> "이재홍")
                      const potentialName = trimmedName.slice(0, -trimmedPosition.length).trim();
                      if (potentialName.length > 0) {
                        console.log('[JournalEditForm] 이름에서 중복 직위 제거:', pName, '->', potentialName);
                        pName = potentialName;
                      }
                    }
                  }
                  // 2. 직위가 없는 경우: 이름에서 분리 시도
                  else {
                    const separated = separateNameAndPosition(pName);
                    if (separated.position) {
                      console.log('[JournalEditForm] 이름/직위 자동 분리 (previousData):', pName, '->', separated);
                      pName = separated.name;
                      pPosition = separated.position;
                    }
                  }
                }

                updated.manager_name = prev.manager_name || pName;
                updated.manager_position = prev.manager_position || pPosition;
                updated.manager_mobile = prev.manager_mobile || data.previousData.manager_mobile || "";
                updated.manager_email = prev.manager_email || data.previousData.manager_email || "";
                // 측정비는 자동으로 채우지 않고 참고용으로만 저장
                // updated.measurement_fee_business = prev.measurement_fee_business || (data.previousData.measurement_fee_business ? String(data.previousData.measurement_fee_business) : "") || "";
                // updated.measurement_fee_national = prev.measurement_fee_national || (data.previousData.measurement_fee_national ? String(data.previousData.measurement_fee_national) : "") || "";
                updated.invoice_email = prev.invoice_email || data.previousData.invoice_email || "";
                updated.invoice_email_2 = prev.invoice_email_2 || data.previousData.invoice_email_2 || "";
                updated.measurer = prev.measurer || data.previousData.measurer || "";
                // K2B 전송자는 예비조사 정보를 우선으로 하므로 여기서는 설정하지 않음
                // updated.k2b_sender = prev.k2b_sender || data.previousData.k2b_sender || "";
                // 산재관리번호 (비어있을 때만 자동 채우기)
                const currentIndustrialAccidentNumber = prev.industrial_accident_number || "";
                const previousIndustrialAccidentNumber = data.previousData.industrial_accident_number || null;
                console.log('[JournalEditForm] 산재관리번호 비교:', {
                  current: currentIndustrialAccidentNumber,
                  previous: previousIndustrialAccidentNumber,
                  willUpdate: !currentIndustrialAccidentNumber && previousIndustrialAccidentNumber
                });
                if (!currentIndustrialAccidentNumber && previousIndustrialAccidentNumber) {
                  updated.industrial_accident_number = previousIndustrialAccidentNumber;
                  console.log('[JournalEditForm] 산재관리번호 자동 채움:', previousIndustrialAccidentNumber);
                }

                // 개시번호 (비어있을 때만 자동 채우기)
                const currentCommencementNumber = prev.commencement_number || "";
                const previousCommencementNumber = data.previousData.commencement_number || null;
                console.log('[JournalEditForm] 개시번호 비교:', {
                  current: currentCommencementNumber,
                  previous: previousCommencementNumber,
                  willUpdate: !currentCommencementNumber && previousCommencementNumber
                });
                if (!currentCommencementNumber && previousCommencementNumber) {
                  updated.commencement_number = previousCommencementNumber;
                  console.log('[JournalEditForm] 개시번호 자동 채움:', previousCommencementNumber);
                }

                // 대표자명 (비어있을 때만 자동 채우기)
                const currentRepresentativeName = prev.representative_name || "";
                const previousRepresentativeName = data.previousData.representative_name || null;
                if (!currentRepresentativeName && previousRepresentativeName) {
                  updated.representative_name = previousRepresentativeName;
                }

                // [ADD] 전화번호 및 FAX 자동 채우기
                if (!prev.phone && data.previousData.phone) {
                  updated.phone = data.previousData.phone;
                }
                if (!prev.fax && data.previousData.fax) {
                  updated.fax = data.previousData.fax;
                }

                // [ADD] 업종분류 자동 채우기
                if (!updated.business_category && data.previousData.business_category) {
                  updated.business_category = data.previousData.business_category;
                }

                // 전회 측정비 정보 저장 (참고용)
                const previousBusinessFee = data.previousData.measurement_fee_business || null;
                const previousNationalFee = data.previousData.measurement_fee_national || null;
                setPreviousMeasurementFee({
                  business: previousBusinessFee,
                  national: previousNationalFee,
                });

                // 전회치 값이 있으면 기본값으로 설정 (등록 모드에서만)
                if (!entry.id) {
                  if (previousBusinessFee && !prev.measurement_fee_business) {
                    updated.measurement_fee_business = String(previousBusinessFee);
                  }
                  if (previousNationalFee && !prev.measurement_fee_national) {
                    updated.measurement_fee_national = String(previousNationalFee);
                  }
                }

                // 전회 이메일 정보 저장
                setPreviousEmails({
                  manager_email: data.previousData.manager_email || null,
                  invoice_email: data.previousData.invoice_email || null,
                  invoice_email_2: data.previousData.invoice_email_2 || null,
                });
              }

              // [NEW] Best Reference Data 활용 (previousData가 없거나 비어있는 필드 채우기)
              if (data.referenceData && data.referenceData.source_type !== 'none') {
                const ref = data.referenceData;
                console.log('[JournalEditForm] Reference Data 활용:', ref);

                // manager_name
                if (!updated.manager_name && ref.manager_name) {
                  updated.manager_name = ref.manager_name;
                }
                // manager_mobile
                if (!updated.manager_mobile && ref.manager_mobile) {
                  updated.manager_mobile = ref.manager_mobile;
                }
                // manager_email
                if (!updated.manager_email && ref.manager_email) {
                  updated.manager_email = ref.manager_email;
                }
                // address
                if (!updated.address && ref.address) {
                  updated.address = ref.address;
                }
                // business_number
                if (!updated.business_number && ref.business_number) {
                  updated.business_number = ref.business_number;
                }
                // total_employees (0인 경우도 포함하여 엄격하게 체크)
                if ((updated.total_employees === "" || updated.total_employees === null) && 
                    (ref.total_employees !== undefined && ref.total_employees !== null)) {
                  updated.total_employees = String(ref.total_employees);
                }
                // business_category (현재 값이 비어있거나 "선택", 또는 기본값 "공업사"일 때 계획 정보 우선)
                if ((!updated.business_category || updated.business_category === "" || updated.business_category === "공업사") && 
                    ref.business_category) {
                  updated.business_category = ref.business_category;
                }
                // invoice_email
                if (!updated.invoice_email && ref.invoice_email) {
                  updated.invoice_email = ref.invoice_email;
                }
                // representative_name
                if (!updated.representative_name && ref.representative_name) {
                  updated.representative_name = ref.representative_name;
                }
                // phone
                if (!updated.phone && ref.phone) {
                  updated.phone = ref.phone;
                }
                // fax
                if (!updated.fax && ref.fax) {
                  updated.fax = ref.fax;
                }

                // 산재관리번호 (비어있을 때만)
                if (!updated.industrial_accident_number && ref.industrial_accident_number) {
                  updated.industrial_accident_number = ref.industrial_accident_number;
                }
                // 개시번호 (비어있을 때만)
                if (!updated.commencement_number && ref.commencement_number) {
                  updated.commencement_number = ref.commencement_number;
                }
              }

              // 요약 정보 (직전 데이터가 없거나 비어있을 때)
              if (data.summaryInfo) {
                let sName = data.summaryInfo.manager_name || "";
                let sPosition = "";

                if (sName) {
                  const separated = separateNameAndPosition(sName);
                  if (separated.position) {
                    console.log('[JournalEditForm] 이름/직위 자동 분리 (summaryInfo):', sName, '->', separated);
                    sName = separated.name;
                    sPosition = separated.position;
                  }
                }

                updated.manager_name = updated.manager_name || sName;
                if (!updated.manager_position && sPosition) {
                  updated.manager_position = sPosition;
                }
                updated.manager_mobile = updated.manager_mobile || data.summaryInfo.manager_mobile || "";
                updated.manager_email = updated.manager_email || data.summaryInfo.manager_email || "";
                // 측정비는 자동으로 채우지 않고 참고용으로만 저장
                // updated.measurement_fee_business = updated.measurement_fee_business || (data.summaryInfo.measurement_fee_business ? String(data.summaryInfo.measurement_fee_business) : "") || "";
                // K2B 전송자는 예비조사 정보를 우선으로 하므로 여기서는 설정하지 않음
                // updated.k2b_sender = updated.k2b_sender || data.summaryInfo.k2b_sender || "";

                // 전회 측정비 정보 저장 (참고용) - summaryInfo에서도 가져오기
                if (!previousMeasurementFee.business && data.summaryInfo.measurement_fee_business) {
                  const summaryBusinessFee = data.summaryInfo.measurement_fee_business || null;
                  setPreviousMeasurementFee((prev) => ({
                    ...prev,
                    business: summaryBusinessFee,
                  }));
                  // 전회치 값이 있으면 기본값으로 설정 (등록 모드에서만)
                  if (!entry.id && summaryBusinessFee && !updated.measurement_fee_business) {
                    updated.measurement_fee_business = String(summaryBusinessFee);
                  }
                }
              }

              // 국고지원 상태 (우선순위: national_support_application > measurement_business > 직전 측정일지)
              // 등록 모드: 기존 값이 없을 때만 가져오기
              // 수정 모드: 기존 값이 없을 때만 가져오기 (건강디딤돌 신청결과 우선)
              if (data.nationalSupportStatus) {
                updated.national_support_status = prev.national_support_status || data.nationalSupportStatus || "";
              }

              // 예비조사 정보 (우선순위: 예비조사 정보가 최우선)
              if (data.surveyInfo) {
                setSurveyInfo(data.surveyInfo);
                console.log('[JournalEditForm] 예비조사 정보 확인:', {
                  report_writer: data.surveyInfo.report_writer,
                  measurer: data.surveyInfo.measurer,
                  기존_k2b_sender: prev.k2b_sender,
                });

                // 측정자 (예비조사의 measurer가 있으면 사용)
                if (data.surveyInfo.measurer) {
                  updated.measurer = prev.measurer || data.surveyInfo.measurer;
                }

                // K2B 전송자 (예비조사의 report_writer가 있으면 기본값으로 설정, 최우선)
                // report_writer는 콤마 구분 문자열일 수 있으므로 첫 번째 값만 사용
                if (data.surveyInfo.report_writer) {
                  // 콤마로 구분된 경우 첫 번째 값만 사용
                  const reportWriterValue = data.surveyInfo.report_writer.split(',').map((w: string) => w.trim()).filter(Boolean)[0] || data.surveyInfo.report_writer.trim();

                  // 예비조사 정보가 있으면 최우선으로 사용 (로그인 사용자 이름이나 기존 DB 값보다 우선)
                  if (reportWriterValue) {
                    updated.k2b_sender = reportWriterValue;
                    console.log('[JournalEditForm] 예비조사 정보(report_writer)로 K2B 전송자 강제 덮어쓰기:', reportWriterValue);
                  }
                }

                // 측정 시작일 (예비조사의 measurement_date가 있으면 기본값으로 설정)
                if (data.surveyInfo.measurement_date && !prev.measurement_start_date) {
                  updated.measurement_start_date = normalizeDateForInput(data.surveyInfo.measurement_date);
                  // 측정 종료일도 비어있으면 측정 시작일과 동일하게 설정
                  if (!prev.measurement_end_date) {
                    updated.measurement_end_date = normalizeDateForInput(data.surveyInfo.measurement_date);
                  }
                }
              }

              // K2B 전송자 fallback: 예비조사 정보가 없을 때만 직전 측정일지나 요약 정보 사용
              if (!updated.k2b_sender) {
                if (data.previousData?.k2b_sender) {
                  updated.k2b_sender = prev.k2b_sender || data.previousData.k2b_sender || "";
                  console.log('[JournalEditForm] 직전 측정일지에서 K2B 전송자 설정:', data.previousData.k2b_sender);
                } else if (data.summaryInfo?.k2b_sender) {
                  updated.k2b_sender = data.summaryInfo.k2b_sender || "";
                  console.log('[JournalEditForm] 요약 정보에서 K2B 전송자 설정:', data.summaryInfo.k2b_sender);
                }
              }

              return updated;
            });
          }
        } catch (err) {
          console.error("직전 측정일지 데이터 조회 오류:", err);
          // 오류가 발생해도 계속 진행
        }
      };

      // 미수금 정보 조회
      const fetchUnpaidInfo = async () => {
        if (!entry.business_name) return;

        try {
          const response = await fetch(
            `/api/sales/check-unpaid?businessName=${encodeURIComponent(entry.business_name)}`
          );

          if (response.ok) {
            const data = await response.json();
            if (data.unpaidCount > 0) {
              // 특이사항에 미수금 정보 추가/업데이트
              setFormData((prev) => {
                const unpaidNoteRaw = `전회 미수 ${data.unpaidCount}회`;
                let currentNotes = prev.special_notes || "";

                // 이미 "전회 미수 ...회" 문구가 있는지 확인
                if (currentNotes.match(/전회 미수 \d+회/)) {
                  // 있으면 새로운 횟수로 교체
                  currentNotes = currentNotes.replace(/전회 미수 \d+회/, unpaidNoteRaw);
                } else {
                  // 없으면 추가
                  currentNotes = currentNotes ? `${currentNotes}\n${unpaidNoteRaw}` : unpaidNoteRaw;
                }

                return {
                  ...prev,
                  special_notes: currentNotes,
                };
              });
            } else {
              // 미수금이 0이면 해당 문구 제거
              setFormData((prev) => {
                let currentNotes = prev.special_notes || "";
                if (currentNotes.match(/전회 미수 \d+회/)) {
                  // 문구 제거 (줄바꿈 처리 포함)
                  currentNotes = currentNotes.replace(/\n?전회 미수 \d+회/, "").trim();
                  return {
                    ...prev,
                    special_notes: currentNotes,
                  };
                }
                return prev;
              });
            }
          }
        } catch (err) {
          console.error("미수금 정보 조회 오류:", err);
          // 오류가 발생해도 계속 진행
        }
      };

      fetchPreviousData();
      fetchUnpaidInfo();
    }
  }, [entry.id, entry.code, entry.measurement_year, entry.measurement_period, entry.business_name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 대기 중인 번호 변경 요청 조회 (수정 모드에서만, 일반 사용자만)
  useEffect(() => {
    if (entry.id && !isAdmin) {
      const fetchPendingRequest = async () => {
        try {
          const response = await fetch(`/api/journal/${entry.id}/number-change-request`);
          if (response.ok) {
            const data = await response.json();
            setPendingNumberRequest(data.request);
          }
        } catch (err) {
          console.error("번호 변경 요청 조회 오류:", err);
        }
      };
      fetchPendingRequest();
    }
  }, [entry.id, isAdmin]);

  // 업종분류 목록 조회
  useEffect(() => {
    const fetchBusinessCategories = async () => {
      try {
        const response = await fetch("/api/business-categories");
        if (response.ok) {
          const data = await response.json();
          const categories = (data.categories || []).map((cat: { id: number; name: string }) => ({
            value: cat.name,
            label: cat.name,
          }));
          setBusinessCategories(categories);
        }
      } catch (err) {
        console.error("업종분류 목록 조회 오류:", err);
        // 기본 목록 설정 (API 실패 시)
        setBusinessCategories([
          { value: "건설", label: "건설" },
          { value: "교육", label: "교육" },
          { value: "공업사", label: "공업사" },
          { value: "도정", label: "도정" },
          { value: "병원", label: "병원" },
          { value: "서비스", label: "서비스" },
          { value: "수리", label: "수리" },
          { value: "실험실", label: "실험실" },
          { value: "인쇄", label: "인쇄" },
          { value: "정비", label: "정비" },
          { value: "제조", label: "제조" },
          { value: "환경", label: "환경" },
          { value: "기타", label: "기타" },
        ]);
      }
    };
    fetchBusinessCategories();
  }, []);



  // 등록 모드일 때 로그인 사용자 정보로 기본값 설정 (Fallback)
  useEffect(() => {
    // 등록 모드이고, 사용자 정보가 있고, 해당 필드가 아직 비어있을 때만 설정
    // 주의: surveyInfo 로드 후 report_writer가 있으면 해당 값이 덮어쓰게 됩니다.
    if (!entry.id && user?.name) {
      setFormData((prev) => {
        // 이미 값이 있으면 (예: surveyInfo나 직전 데이터에서 가져온 경우) 건드리지 않음
        if (prev.k2b_sender) return prev;

        const k2bSenderOptions = ["한기문", "강종구", "이주형", "배윤민", "고유빈"];
        if (k2bSenderOptions.includes(user.name)) {
          return { ...prev, k2b_sender: user.name };
        }
        return prev;
      });
    }
  }, [entry.id, user?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // 수정 모드일 때 건강디딤돌 신청결과 값 가져오기 (국고지원 여부만)
  useEffect(() => {
    // 수정 모드(id가 있음)이고, 필수 필드가 모두 있을 때만 실행
    if (entry.id && entry.code && entry.measurement_year && entry.measurement_period) {
      const fetchNationalSupportStatus = async () => {
        try {
          const response = await fetch(
            `/api/journal/previous-data?code=${encodeURIComponent(entry.code)}&year=${entry.measurement_year}&period=${encodeURIComponent(entry.measurement_period)}`
          );

          if (response.ok) {
            const data = await response.json();

            // 국고지원 상태가 있고, 현재 값이 비어있을 때만 업데이트
            if (data.nationalSupportStatus) {
              setFormData((prev) => {
                // 기존 값이 없거나 빈 문자열일 때만 건강디딤돌 신청결과 값으로 채우기
                if (!prev.national_support_status || prev.national_support_status === "") {
                  console.log('[JournalEditForm] 수정 모드: 건강디딤돌 신청결과 값으로 국고지원 여부 설정', {
                    기존값: prev.national_support_status,
                    신청결과값: data.nationalSupportStatus,
                  });
                  return {
                    ...prev,
                    national_support_status: data.nationalSupportStatus,
                  };
                }
                return prev;
              });
            }
          }
        } catch (err) {
          console.error("건강디딤돌 신청결과 조회 오류:", err);
          // 오류가 발생해도 계속 진행
        }
      };

      fetchNationalSupportStatus();
    }
  }, [entry.id, entry.code, entry.measurement_year, entry.measurement_period]);

  // 인가 갯수(Quota) 상태 추가
  const [officeQuota, setOfficeQuota] = useState<number | null>(null);

  // 인가 갯수 조회 (년도/주기/지정지청 변경 시)
  // 인가 갯수 조회 (년도/주기/지정지청 변경 시)
  const { measurement_year, measurement_period, designated_office } = formData;
  useEffect(() => {
    // 필수 조건 체크
    if (measurement_year && measurement_period && designated_office) {
      const fetchQuota = async () => {
        try {
          const response = await fetch(`/api/admin/quotas?year=${measurement_year}`);
          if (response.ok) {
            const result = await response.json();
            const data = result.data || [];

            // 해당 주기와 지정지청에 맞는 쿼터 찾기
            let matchingQuota = data.find((q: any) =>
              q.period === measurement_period && q.office_name === designated_office
            );

            // '(수시)'가 포함된 경우, '(수시)'를 제거한 주기로 검색 (예: '상반기(수시)' -> '상반기')
            if (!matchingQuota && measurement_period && measurement_period.includes('(수시)')) {
              const basePeriod = measurement_period.replace('(수시)', '');
              matchingQuota = data.find((q: any) =>
                q.period === basePeriod && q.office_name === designated_office
              );
            }

            if (matchingQuota) {
              setOfficeQuota(matchingQuota.quota);
            } else {
              setOfficeQuota(null);
            }
          }
        } catch (err) {
          console.error("인가 갯수 조회 오류:", err);
          setOfficeQuota(null);
        }
      };

      fetchQuota();
    } else {
      setOfficeQuota(null);
    }
  }, [measurement_year, measurement_period, designated_office]);

  // entry가 변경될 때 formData 업데이트 (entry.id가 변경되면 전체 재초기화)
  useEffect(() => {
    // entry.id가 변경되면 전체 formData 재초기화
    console.log('[JournalEditForm] entry 변경 감지:', {
      id: entry.id,
      note: entry.note,
      noteType: typeof entry.note,
      noteLength: entry.note ? (typeof entry.note === 'string' ? entry.note.length : entry.note.length) : 0,
    });

    // note 필드에서 비고 체크박스 옵션에 해당하는 값만 필터링
    const validNoteValues = noteOptions.map(opt => opt.value);
    let noteArray: string[] = [];

    if (entry.note) {
      if (typeof entry.note === 'string') {
        const noteString = entry.note.trim();
        const splitNotes = noteString.split(',').map(n => n.trim()).filter(Boolean);

        noteArray = splitNotes.filter(note => validNoteValues.includes(note));

      } else if (Array.isArray(entry.note)) {
        noteArray = entry.note.filter(note => validNoteValues.includes(String(note)));
      }
    }

    console.log('[JournalEditForm] note 배열 추출:', { selected: noteArray });

    setFormData({
      // 기본 정보
      code: entry.code,
      measurement_year: entry.measurement_year,
      measurement_period: entry.measurement_period,
      note: noteArray,
      designated_office: entry.designated_office || "",
      office_jurisdiction: entry.office_jurisdiction || "",
      document_number: entry.document_number || "",
      sequence_number: entry.sequence_number || "",
      five_plus_sequence: entry.five_plus_sequence || "",

      // 측정 정보
      measurement_start_date: normalizeDateForInput(entry.measurement_start_date),
      measurement_end_date: normalizeDateForInput(entry.measurement_end_date),
      measurer: entry.measurer || "",
      completion_status: entry.completion_status || "미완료",

      // 사업장 정보
      business_name: entry.business_name || "",
      total_employees: entry.total_employees || "",
      business_number: entry.business_number || "",
      industrial_accident_number: entry.industrial_accident_number || "",
      commencement_number: entry.commencement_number || "",
      representative_name: entry.representative_name || "",
      national_support_status: entry.national_support_status || "",
      address: entry.address || "",
      phone: entry.phone || "",
      fax: entry.fax || "",
      business_category: entry.business_category || "",

      // 담당자 정보
      manager_name: entry.manager_name || "",
      manager_position: entry.manager_position || "",
      manager_mobile: entry.manager_mobile || "",
      manager_email: entry.manager_email || "",

      // K2B 정보
      k2b_send_date: normalizeDateForInput(entry.k2b_send_date),
      k2b_sender: entry.k2b_sender || "",
      invoice_email: entry.invoice_email || "",
      electronic_invoice_date: normalizeDateForInput(entry.electronic_invoice_date),
      invoice_email_2: entry.invoice_email_2 || "",
      electronic_invoice_date_2: normalizeDateForInput(entry.electronic_invoice_date_2),

      // 측정비 정보
      measurement_fee_total: entry.measurement_fee_total || "",
      measurement_fee_business: entry.measurement_fee_business || "",
      measurement_fee_national: entry.measurement_fee_national || "",

      // 입금 정보
      deposit_total: entry.deposit_total || "",
      deposit_date_business: normalizeDateForInput(entry.deposit_date_business),
      deposit_amount_business: entry.deposit_amount_business || "",
      deposit_date_business_2: normalizeDateForInput(entry.deposit_date_business_2),
      deposit_amount_business_2: entry.deposit_amount_business_2 || "",
      deposit_date_national: normalizeDateForInput(entry.deposit_date_national),
      deposit_amount_national: entry.deposit_amount_national || "",

      // 전자계산서 정보 (발행처)
      invoice_business_name: entry.invoice_business_name || "",
      invoice_business_number: entry.invoice_business_number || "",

      // 특이사항
      special_notes: entry.special_notes || "",
    });

    // originalYear, originalPeriod도 업데이트
    setOriginalYear(entry.measurement_year);
    setOriginalPeriod(entry.measurement_period);

    // entry 변경 시 ref도 업데이트
    prevStartDateRef.current = normalizeDateForInput(entry.measurement_start_date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, entry.note, entry.code, entry.measurement_year, entry.measurement_period, entry.measurement_start_date, entry.business_category]); // entry의 주요 필드가 변경될 때 전체 재초기화

  // 주소 변경 시 자동으로 소재지 관할청과 지정한계_관할지청 업데이트
  const handleAddressChange = async (newAddress: string) => {
    setFormData({ ...formData, address: newAddress });

    if (!newAddress || newAddress.trim().length < 3) {
      return; // 주소가 너무 짧으면 자동 입력하지 않음
    }

    setAutoFilling(true);
    try {
      const response = await fetch("/api/journal/auto-fill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ address: newAddress }),
      });

      if (response.ok) {
        const data = await response.json();
        setFormData((prev) => ({
          ...prev,
          office_jurisdiction: data.office_jurisdiction || prev.office_jurisdiction,
          designated_office: data.designated_office || prev.designated_office,
        }));
      }
    } catch (err) {
      console.error("자동 입력 오류:", err);
      // 자동 입력 실패해도 계속 진행
    } finally {
      setAutoFilling(false);
    }
  };

  // 금액·입금 상태 및 날짜 기반 자동 완료 전환
  useEffect(() => {
    // 이미 완료 상태가 아닐 때만 체크
    if (formData.completion_status !== "완료") {
      const feeTotal = parseFloat(parseCurrency(formData.measurement_fee_total)) || 0;
      const depositTotal = parseFloat(parseCurrency(formData.deposit_total)) || 0;
      const startDate = formData.measurement_start_date;
      const k2bDate = formData.k2b_send_date;

      // 조건: 1. 측정비 합계 = 입금액 합계 (교차 검증)
      //       2. 측정 시작일 등록됨
      //       3. K2B 전송일 등록됨
      if (feeTotal > 0 && depositTotal > 0 && feeTotal === depositTotal && startDate && k2bDate) {
        console.log('[JournalEditForm] 모든 조건 충족: 완료 상태로 자동 전환');
        setFormData(prev => ({
          ...prev,
          completion_status: "완료"
        }));
      }
    }
  }, [formData.measurement_fee_total, formData.deposit_total, formData.measurement_start_date, formData.k2b_send_date, formData.completion_status]);

  // 업종분류가 '대전/천안 공업사'일 때 자동화 로직 (그 외에는 빈값)
  useEffect(() => {
    const isTargetArea = ["대전", "천안"].includes(formData.designated_office);
    const isAutoRepair = formData.business_category === "공업사";

    if (isTargetArea && isAutoRepair) {
      // ref 업데이트 전 변경 여부 확인 (setFormData 내부가 아닌 여기서 캡처)
      const isStartDateChanged = prevStartDateRef.current !== formData.measurement_start_date;

      setFormData(prev => {
        const updates: any = {};
        let hasUpdates = false;

        // 1. 비고: '공정 수시변경' 자동 체크
        const NOTE_VALUE = "공정 수시변경";
        const currentNotes = Array.isArray(prev.note) ? [...prev.note] : (prev.note ? [String(prev.note)] : []);

        if (!currentNotes.includes(NOTE_VALUE)) {
          currentNotes.push(NOTE_VALUE);
          updates.note = currentNotes;
          hasUpdates = true;
        }

        // 2. 전자계산서 발행일: 측정 시작일 + 1일 (워킹데이 기준)
        const currentStartDate = prev.measurement_start_date;
        const shouldUpdateDate = isStartDateChanged || !prev.electronic_invoice_date;

        if (currentStartDate && shouldUpdateDate) {
          const startDate = new Date(currentStartDate);
          const nextDate = new Date(startDate);
          nextDate.setDate(startDate.getDate() + 1);

          const day = nextDate.getDay(); // 0: 일, 6: 토
          if (day === 6) { // 토요일 -> 월요일 (2일 추가)
            nextDate.setDate(nextDate.getDate() + 2);
          } else if (day === 0) { // 일요일 -> 월요일 (1일 추가)
            nextDate.setDate(nextDate.getDate() + 1);
          }

          const nextWorkingDay = normalizeDateForInput(nextDate.toISOString());

          if (prev.electronic_invoice_date !== nextWorkingDay) {
            updates.electronic_invoice_date = nextWorkingDay;
            hasUpdates = true;
            console.log('[JournalEditForm] 대전/천안 공업사 자동 계산:', nextWorkingDay);
          }
        }

        if (hasUpdates) {
          return { ...prev, ...updates };
        }
        return prev;
      });
    } else {
      // 대전/천안 공업사가 아니면 전자계산서 발행일 비우기
      if (formData.electronic_invoice_date) {
        setFormData(prev => ({ ...prev, electronic_invoice_date: "" }));
      }
      
      // 비고에서 '공정 수시변경' 제거 (선택사항이나 일관성을 위해)
      const NOTE_VALUE = "공정 수시변경";
      const currentNotes = Array.isArray(formData.note) ? [...formData.note] : (formData.note ? [String(formData.note)] : []);
      if (currentNotes.includes(NOTE_VALUE)) {
        setFormData(prev => ({
          ...prev,
          note: currentNotes.filter(n => n !== NOTE_VALUE)
        }));
      }
    }

    // ref 업데이트
    prevStartDateRef.current = formData.measurement_start_date;

  }, [formData.business_category, formData.designated_office, formData.measurement_start_date]);

  // 측정년도/측정주기 변경 검증 (수정 모드에서만)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 중복 제출 방지
    if (loading) {
      console.warn("[JournalEditForm] 이미 제출 중입니다. 중복 제출을 방지합니다.");
      return;
    }

    setLoading(true);
    if (setIsSubmitting) setIsSubmitting(true);
    setError(null);

    // 총인원 검증 (5인 이상 연번과 연관이 있으므로 필수)
    const totalEmployees = formData.total_employees ? parseInt(String(formData.total_employees)) : null;
    if (!totalEmployees || isNaN(totalEmployees)) {
      setError("총인원을 입력해주세요. 5인 이상 연번은 총인원과 연관이 있습니다.");
      setLoading(false);
      if (setIsSubmitting) setIsSubmitting(false);
      return;
    }

    // 측정년도/측정주기 변경 검증 제거 (사용자 요청)

    // 관리자가 연번(공문연번, 연번, 5인 이상 연번)을 변경했는지 확인하고 경고
    if (isAdmin && entry.id) {
      const isSequenceChanged =
        (formData.document_number !== (entry.document_number || "")) ||
        (formData.sequence_number !== (entry.sequence_number || "")) ||
        (formData.five_plus_sequence !== (entry.five_plus_sequence || ""));

      if (isSequenceChanged) {
        const confirmMsg = "⚠️ [경고] 연번(번호표) 변경 감지 ⚠️\n\n" +
          "관리자 권한으로 시스템의 핵심인 '연번'을 강제로 수정하려고 합니다.\n" +
          "연번이 틀어지면 노동지청 보고 서류와 불일치하는 등 치명적인 문제가 발생할 수 있습니다.\n\n" +
          "정말로 이 기록의 연번을 수정하시겠습니까?";

        if (!window.confirm(confirmMsg)) {
          setLoading(false);
          if (setIsSubmitting) setIsSubmitting(false);
          return; // 취소시 중단
        }
      }
    }

    try {
      // 데이터 정리 (빈 문자열을 null로 변환)
      const submitData: any = {};
      Object.keys(formData).forEach((key) => {
        const value = formData[key as keyof typeof formData];

        // note 필드는 배열을 콤마로 구분된 문자열로 변환
        if (key === 'note') {
          if (Array.isArray(value) && value.length > 0) {
            submitData[key] = value.join(',');
            console.log('[JournalEditForm] 저장할 note 값:', submitData[key]);
          } else {
            submitData[key] = null;
          }
        } else {
          submitData[key] = value === "" ? null : value;
        }
      });

      // 국고지원 여부가 "비대상"인 경우 국고 관련 필드를 null로 설정
      if (submitData.national_support_status === "비대상") {
        submitData.measurement_fee_national = null;
        submitData.deposit_date_national = null;
        submitData.deposit_amount_national = null;
        console.log('[JournalEditForm] 국고지원 여부가 "비대상"이므로 국고 관련 필드를 null로 설정');
      }

      // 숫자 필드 변환 (콤마 제거 후 파싱)
      if (submitData.total_employees) {
        submitData.total_employees = parseInt(submitData.total_employees);
      }
      if (submitData.measurement_fee_total) {
        submitData.measurement_fee_total = parseFloat(parseCurrency(String(submitData.measurement_fee_total)));
      }
      if (submitData.measurement_fee_business) {
        submitData.measurement_fee_business = parseFloat(parseCurrency(String(submitData.measurement_fee_business)));
      }
      if (submitData.measurement_fee_national) {
        submitData.measurement_fee_national = parseFloat(parseCurrency(String(submitData.measurement_fee_national)));
      }
      if (submitData.deposit_total) {
        submitData.deposit_total = parseFloat(parseCurrency(String(submitData.deposit_total)));
      }
      if (submitData.deposit_amount_business) {
        submitData.deposit_amount_business = parseFloat(parseCurrency(String(submitData.deposit_amount_business)));
      }
      if (submitData.deposit_amount_national) {
        submitData.deposit_amount_national = parseFloat(parseCurrency(String(submitData.deposit_amount_national)));
      }
      if (submitData.deposit_amount_business_2) {
        submitData.deposit_amount_business_2 = parseFloat(parseCurrency(String(submitData.deposit_amount_business_2)));
      }

      // 입금액 합계 재계산 (비동기 상태 업데이트 지연 방지 및 사업장2 포함 보장)
      const calcBus = typeof submitData.deposit_amount_business === 'number' ? submitData.deposit_amount_business : 0;
      const calcBus2 = typeof submitData.deposit_amount_business_2 === 'number' ? submitData.deposit_amount_business_2 : 0;
      const calcNat = typeof submitData.deposit_amount_national === 'number' ? submitData.deposit_amount_national : 0;

      const calcTotal = calcBus + calcBus2 + calcNat;
      submitData.deposit_total = calcTotal > 0 ? calcTotal : null;

      // 국고지원 여부가 "비대상"인 경우 측정비 합계를 사업장만으로 재계산
      if (submitData.national_support_status === "비대상") {
        const businessFee = submitData.measurement_fee_business || 0;
        submitData.measurement_fee_total = businessFee > 0 ? businessFee : null;

        console.log('[JournalEditForm] 국고지원 여부가 "비대상"이므로 합계를 사업장만으로 재계산:', {
          measurement_fee_total: submitData.measurement_fee_total,
          deposit_total: submitData.deposit_total,
        });
      }

      const url = entry.id ? `/api/journal/${entry.id}` : "/api/journal";
      const method = entry.id ? "PUT" : "POST";

      let response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submitData),
      });

      let data = await response.json();

      // 중복 번호 발생 시 (409 Conflict)
      if (response.status === 409) {
        // 사용자에게 확인 요청
        if (window.confirm(data.message || "중복된 번호가 감지되었습니다. 계속 진행하시겠습니까?")) {
          // 승인 시 confirm_duplicate 플래그 추가하여 재전송
          submitData.confirm_duplicate = true;

          console.log('[JournalEditForm] 중복 승인 후 재전송 시도...');

          response = await fetch(url, {
            method,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(submitData),
          });

          data = await response.json();
        } else {
          // 취소 시 중단
          setLoading(false);
          if (setIsSubmitting) setIsSubmitting(false);
          return;
        }
      }

      if (response.ok) {
        // 저장 성공 메시지 표시
        alert("저장되었습니다.");
        // 저장된 측정일지 ID를 onSuccess에 전달
        onSuccess(data.id || entry.id);
        onClose();
      } else {
        setError(data.error || "저장 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("측정일지 저장 오류:", err);
      setError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      if (setIsSubmitting) setIsSubmitting(false);
    }
  };

  const renderBusinessInfo = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        사업장 정보
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Input
          label="사업장명 *"
          value={formData.business_name}
          onChange={(e) =>
            setFormData({ ...formData, business_name: e.target.value })
          }
          required
        />
        <Input
          label="대표자명"
          value={formData.representative_name}
          onChange={(e) =>
            setFormData({ ...formData, representative_name: e.target.value })
          }
        />
        <div className="md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-6 gap-4">
          <Input
            label="총인원"
            type="number"
            value={formData.total_employees}
            onChange={(e) =>
              setFormData({ ...formData, total_employees: e.target.value })
            }
            className="md:col-span-1"
          />
          <Input
            label="사업자번호"
            value={formatBusinessNumber(formData.business_number)}
            onChange={(e) => {
              // 숫자만 추출하여 저장 (하이픈 제거)
              const numbers = parseBusinessNumber(e.target.value);
              setFormData({ ...formData, business_number: numbers });
            }}
            placeholder="000-00-00000"
            maxLength={12}
            className="md:col-span-2"
            error={!isValidDigitCount(formData.business_number, 10) ? "10자리 숫자를 입력해 주세요" : undefined}
          />
          <Input
            label="산재관리번호"
            value={formData.industrial_accident_number}
            onChange={(e) =>
              setFormData({ ...formData, industrial_accident_number: e.target.value })
            }
            className="md:col-span-2"
            error={!isValidDigitCount(formData.industrial_accident_number, 11) ? "11자리 숫자를 입력해 주세요" : undefined}
          />
          <Input
            label="개시번호"
            value={formData.commencement_number}
            onChange={(e) =>
              setFormData({ ...formData, commencement_number: e.target.value })
            }
            className="md:col-span-1"
            error={!isValidDigitCount(formData.commencement_number, 11) ? "11자리 숫자를 입력해 주세요" : undefined}
          />
        </div>
        <Select
          label="국고지원 여부"
          value={formData.national_support_status}
          onChange={(e) =>
            setFormData({ ...formData, national_support_status: e.target.value })
          }
          options={nationalSupportOptions}
        />
        <Input
          label="주소"
          value={formData.address}
          onChange={(e) => handleAddressChange(e.target.value)}
          className="md:col-span-2 lg:col-span-3"
          placeholder={autoFilling ? "자동 입력 중..." : "주소 입력"}
        />
        <Input
          label="소재지 관할청"
          value={toShortName(formData.office_jurisdiction || "")}
          disabled
          className="bg-surface-50"
          placeholder="주소 입력 시 자동 입력됩니다"
        />
        <Select
          label="업종 분류"
          value={formData.business_category || ""}
          onChange={(e) => setFormData({ ...formData, business_category: e.target.value })}
          options={[
            { value: "", label: "선택" },
            ...businessCategories,
          ]}
        />
        <div className="md:col-span-2 lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="전화번호"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
          />
          <Input
            label="FAX"
            value={formData.fax}
            onChange={(e) => setFormData({ ...formData, fax: e.target.value })}
          />
        </div>
      </div>

      {/* 계산서 발행처 정보 (타업체 발행 요청 대비) */}
      <div className="mt-6 pt-6 border-t border-surface-200">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-md font-semibold text-text-800 flex items-center gap-2">
            <span className="w-1 h-4 bg-primary-500 rounded-full"></span>
            계산서 발행처 정보 (기본값: 사업장 정보와 동일)
          </h4>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setFormData({
                ...formData,
                invoice_business_name: formData.business_name,
                invoice_business_number: formData.business_number
              });
            }}
          >
            사업장 정보 복사
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="계산서 발행 상호"
            value={formData.invoice_business_name}
            onChange={(e) =>
              setFormData({ ...formData, invoice_business_name: e.target.value })
            }
            placeholder="사업장과 다른 상호로 발행 시 입력"
          />
          <Input
            label="계산서 발행 사업자번호"
            value={formatBusinessNumber(formData.invoice_business_number)}
            onChange={(e) => {
              const numbers = parseBusinessNumber(e.target.value);
              setFormData({ ...formData, invoice_business_number: numbers });
            }}
            placeholder="000-00-00000"
            maxLength={12}
          />
        </div>
        <p className="text-[11px] text-text-400 mt-2">
          * 지정된 사업장 정보와 다른 사업자번호로 계산서를 발행해야 하는 경우에만 입력하세요. 빈 칸일 경우 위 사업장 정보가 기본값으로 사용됩니다.
        </p>
      </div>
    </div>
  );

  const renderDepositInfo = () => {
    // 매출관리 모드일 때만 입금 정보 강조 (나머지는 일반 스타일)
    const isSalesMode = mode === 'sales';
    const containerClass = isSalesMode
      ? "bg-teal-50 rounded-lg p-5 border-2 border-primary-600 shadow-md"
      : "bg-surface-50 rounded-lg p-5 border border-surface-200";
    const titleClass = isSalesMode
      ? "text-lg font-bold text-teal-900 mb-4 pb-2 border-b-2 border-primary-500"
      : "text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500";
    const totalInputClass = isSalesMode
      ? "bg-white font-bold text-primary-700"
      : "bg-surface-50";

    // 실시간 합계 계산 (UI 표시용)
    const getNum = (val: any) => {
      if (!val) return 0;
      const str = String(val).replace(/,/g, "").trim();
      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    };
    const currentTotal = (() => {
      const b1 = getNum(formData.deposit_amount_business);
      const b2 = getNum(formData.deposit_amount_business_2); // 사업장2 포함
      const nat = getNum(formData.deposit_amount_national);
      const isNA = formData.national_support_status === "비대상";
      return isNA ? (b1 + b2) : (b1 + b2 + nat);
    })();

    return (
      <div className={containerClass}>
        <h3 className={titleClass}>
          입금 정보
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Input
            label="입금액(합계)"
            type="text"
            value={formatCurrency(currentTotal)}
            onChange={() => { }} // Read-only
            disabled
            className={totalInputClass}
            placeholder="자동 계산됩니다"
          />
          <div>
            <Input
              label="입금일(사업장)"
              type="date"
              value={normalizeDateForInput(formData.deposit_date_business)}
              onChange={(e) => {
                const date = e.target.value;
                setFormData((prev) => {
                  const updated = { ...prev, deposit_date_business: date };

                  // 입금일 입력 시, 입금액(사업장)이 비어있으면 측정비(사업장) 값으로 자동 채움
                  if (date && !prev.deposit_amount_business && prev.measurement_fee_business) {
                    updated.deposit_amount_business = prev.measurement_fee_business;
                  }

                  return updated;
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const inputs = e.currentTarget.form?.querySelectorAll("input");
                  const currentIndex = Array.from(inputs || []).indexOf(e.currentTarget);
                  if (inputs && currentIndex < inputs.length - 1) {
                    inputs[currentIndex + 1].focus();
                  }
                }
              }}
              className="max-w-[200px]"
            />
            <Input
              label="입금액(사업장)"
              type="text"
              value={formatCurrency(formData.deposit_amount_business)}
              onChange={(e) => {
                const parsed = parseCurrency(e.target.value);
                setFormData({ ...formData, deposit_amount_business: parsed });
              }}
              onFocus={() => {
                // 포커스 시 값이 비어있으면 측정비(사업장) 값으로 자동 채움
                if (!formData.deposit_amount_business && formData.measurement_fee_business) {
                  setFormData({ ...formData, deposit_amount_business: formData.measurement_fee_business });
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const inputs = e.currentTarget.form?.querySelectorAll("input");
                  const currentIndex = Array.from(inputs || []).indexOf(e.currentTarget);
                  if (inputs && currentIndex < inputs.length - 1) {
                    inputs[currentIndex + 1].focus();
                  }
                }
              }}
              placeholder={formData.measurement_fee_business ? `기본값: ${formatCurrency(formData.measurement_fee_business)}` : "숫자만 입력"}
              className="font-medium"
            />

            <div className="mt-4 pt-4 border-t border-dashed border-gray-300">
              <Input
                label="입금일(사업장2)"
                type="date"
                value={normalizeDateForInput(formData.deposit_date_business_2)}
                onChange={(e) => setFormData({ ...formData, deposit_date_business_2: e.target.value })}
                className="max-w-[200px]"
              />
              <Input
                label="입금액(사업장2)"
                type="text"
                value={formatCurrency(formData.deposit_amount_business_2)}
                onChange={(e) => {
                  const parsed = parseCurrency(e.target.value);
                  setFormData({ ...formData, deposit_amount_business_2: parsed });
                }}
                placeholder="숫자만 입력"
              />
            </div>
          </div>
          <div>
            <Input
              label="입금일(국고)"
              type="date"
              value={normalizeDateForInput(formData.deposit_date_national)}
              onChange={(e) => {
                const date = e.target.value;
                setFormData((prev) => {
                  const updated = { ...prev, deposit_date_national: date };

                  // 입금일 입력 시, 입금액(국고)이 비어있으면 측정비(국고) 값으로 자동 채움
                  if (date && !prev.deposit_amount_national && prev.measurement_fee_national) {
                    updated.deposit_amount_national = prev.measurement_fee_national;
                  }

                  return updated;
                });
              }}
              disabled={formData.national_support_status === "비대상"}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const inputs = e.currentTarget.form?.querySelectorAll("input");
                  const currentIndex = Array.from(inputs || []).indexOf(e.currentTarget);
                  if (inputs && currentIndex < inputs.length - 1) {
                    inputs[currentIndex + 1].focus();
                  }
                }
              }}
              className={`max-w-[200px] ${formData.national_support_status === "비대상" ? "bg-gray-100 cursor-not-allowed" : ""}`}
            />
            <Input
              label="입금액(국고)"
              type="text"
              value={formatCurrency(formData.deposit_amount_national)}
              onChange={(e) => {
                const parsed = parseCurrency(e.target.value);
                setFormData({ ...formData, deposit_amount_national: parsed });
              }}
              onFocus={() => {
                // 포커스 시 값이 비어있으면 측정비(국고) 값으로 자동 채움
                if (!formData.deposit_amount_national && formData.measurement_fee_national) {
                  setFormData({ ...formData, deposit_amount_national: formData.measurement_fee_national });
                }
              }}
              disabled={formData.national_support_status === "비대상"}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const inputs = e.currentTarget.form?.querySelectorAll("input");
                  const currentIndex = Array.from(inputs || []).indexOf(e.currentTarget);
                  if (inputs && currentIndex < inputs.length - 1) {
                    inputs[currentIndex + 1].focus();
                  }
                }
              }}
              placeholder={formData.measurement_fee_national ? `기본값: ${formatCurrency(formData.measurement_fee_national)}` : "숫자만 입력"}
              className={formData.national_support_status === "비대상" ? "bg-gray-100 cursor-not-allowed" : ""}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderFeeInfo = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        측정비 정보
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Input
          label="측정비(합계)"
          type="text"
          value={formatCurrency(formData.measurement_fee_total)}
          onChange={(e) => {
            const parsed = parseCurrency(e.target.value);
            setFormData({ ...formData, measurement_fee_total: parsed });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const inputs = e.currentTarget.form?.querySelectorAll("input");
              const currentIndex = Array.from(inputs || []).indexOf(e.currentTarget);
              if (inputs && currentIndex < inputs.length - 1) {
                inputs[currentIndex + 1].focus();
              }
            }
          }}
          disabled
          className="bg-surface-50"
          placeholder="자동 계산됩니다"
        />
        <div>
          <Input
            label="측정비(사업장)"
            type="text"
            value={formatCurrency(formData.measurement_fee_business)}
            onChange={(e) => {
              const parsed = parseCurrency(e.target.value);
              setFormData({ ...formData, measurement_fee_business: parsed });
            }}
            list="business-fee-options"
            placeholder={previousMeasurementFee.business ? `전회: ${formatCurrency(String(previousMeasurementFee.business))}원` : "숫자 입력 또는 선택"}
          />
          <datalist id="business-fee-options">
            <option value="200000">200,000원</option>
            {previousMeasurementFee.business && (() => {
              const previousValue = String(previousMeasurementFee.business);
              if (previousValue !== "200000") {
                return <option key={previousValue} value={previousValue}>{formatCurrency(previousValue)}원 (전회치)</option>;
              }
              return null;
            })()}
          </datalist>
          {previousMeasurementFee.business && (
            <p className="mt-1 text-sm text-text-600 font-medium">
              전회: {formatCurrency(String(previousMeasurementFee.business))}원 (참고용)
            </p>
          )}
        </div>
        <div>
          <Input
            label="측정비(국고)"
            type="text"
            value={formatCurrency(formData.measurement_fee_national)}
            onChange={(e) => {
              const parsed = parseCurrency(e.target.value);
              setFormData({ ...formData, measurement_fee_national: parsed });
            }}
            disabled={formData.national_support_status === "비대상"}
            list="national-fee-options"
            placeholder={previousMeasurementFee.national ? `전회: ${formatCurrency(String(previousMeasurementFee.national))}원` : "숫자 입력 또는 선택"}
            className={formData.national_support_status === "비대상" ? "bg-gray-100 cursor-not-allowed" : ""}
          />
          <datalist id="national-fee-options">
            <option value="400000">400,000원</option>
            <option value="1000000">1,000,000원</option>
          </datalist>
          {previousMeasurementFee.national && (
            <p className="mt-1 text-sm text-text-600 font-medium">
              전회: {formatCurrency(String(previousMeasurementFee.national))}원 (참고용)
            </p>
          )}
        </div>
        <div className="col-span-1 md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-2 pt-4 border-t border-dashed border-gray-300">
          <div className="flex flex-col gap-1">
            <Input
              label="계산서 메일"
              type="email"
              value={formData.invoice_email}
              onChange={(e) =>
                setFormData({ ...formData, invoice_email: e.target.value })
              }
            />
            {previousEmails.invoice_email && (
              <div className="px-1 text-[11px] text-text-400 font-medium truncate" title={`전회: ${previousEmails.invoice_email}`}>
                전회: {previousEmails.invoice_email}
              </div>
            )}
          </div>
          <Input
            label="전자계산서 발행일"
            type="date"
            value={normalizeDateForInput(formData.electronic_invoice_date)}
            onChange={(e) =>
              setFormData({ ...formData, electronic_invoice_date: e.target.value })
            }
          />
          <div className="flex flex-col gap-1">
            <Input
              label="계산서 메일2"
              type="email"
              value={formData.invoice_email_2}
              onChange={(e) =>
                setFormData({ ...formData, invoice_email_2: e.target.value })
              }
            />
            {previousEmails.invoice_email_2 && (
              <div className="px-1 text-[11px] text-text-400 font-medium truncate" title={`전회: ${previousEmails.invoice_email_2}`}>
                전회: {previousEmails.invoice_email_2}
              </div>
            )}
          </div>
          <Input
            label="전자계산서 발행일2"
            type="date"
            value={normalizeDateForInput(formData.electronic_invoice_date_2)}
            onChange={(e) =>
              setFormData({ ...formData, electronic_invoice_date_2: e.target.value })
            }
          />
        </div>
      </div>
    </div>
  );

  const renderK2BInfo = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        K2B 정보
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Input
          label="K2B 전송일"
          type="date"
          value={normalizeDateForInput(formData.k2b_send_date)}
          onChange={(e) =>
            setFormData({ ...formData, k2b_send_date: e.target.value })
          }
        />
        <Input
          label="K2B 전송자"
          value={formData.k2b_sender}
          onChange={(e) =>
            setFormData({ ...formData, k2b_sender: e.target.value })
          }
          disabled={isLockedByCompletion}
          className={isLockedByCompletion ? "bg-surface-50" : ""}
        />
        {/* 추후 추가될 자료를 위한 공백(3열) */}
        <div></div>
        <div className="flex flex-col gap-1">
          <Input
            label="계산서 메일"
            value={formData.invoice_email}
            onChange={(e) => setFormData({ ...formData, invoice_email: e.target.value })}
            placeholder="이메일 입력"
          />
          {previousEmails.invoice_email && (
            <div className="px-1 text-[11px] text-text-400 font-medium truncate" title={`전회: ${previousEmails.invoice_email}`}>
              전회: {previousEmails.invoice_email}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderBasicInfo = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        기본 정보
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Input
          label="코드"
          value={formData.code}
          disabled
          className="bg-surface-50"
        />
        <Input
          label="측정년도"
          type="number"
          value={formData.measurement_year}
          onChange={(e) =>
            setFormData({ ...formData, measurement_year: parseInt(e.target.value) || 0 })
          }
          required
        />
        <Select
          label="측정주기 *"
          value={formData.measurement_period}
          onChange={(e) =>
            setFormData({ ...formData, measurement_period: e.target.value })
          }
          options={periodOptions}
          required
        />
        <div className="md:col-span-2 lg:col-span-3 flex flex-col lg:flex-row gap-4 items-end">
          <div className="flex-[2] min-w-0 w-full">
            <label className="block text-sm font-medium text-text-700 mb-1">비고 (복수 선택 가능)</label>
            <div className="flex flex-wrap lg:flex-nowrap gap-x-4 gap-y-2 p-[11px] bg-white border border-surface-200 rounded-lg overflow-x-auto min-h-[50px] items-center">
              {noteOptions.map((option) => {
                const isChecked = Array.isArray(formData.note)
                  ? formData.note.includes(option.value)
                  : formData.note === option.value;

                return (
                  <Checkbox
                    key={option.value}
                    id={`note-${option.value}`}
                    label={option.label}
                    checked={isChecked}
                    onChange={(e) => {
                      // 완료 상태이고 관리자가 아니면 수정 불가
                      if (isLockedByCompletion) return;

                      const currentNotes = Array.isArray(formData.note)
                        ? [...formData.note]
                        : (formData.note ? [formData.note] : []);

                      if (e.target.checked) {
                        // 체크된 경우 추가
                        if (!currentNotes.includes(option.value)) {
                          currentNotes.push(option.value);
                        }
                      } else {
                        // 체크 해제된 경우 제거
                        const index = currentNotes.indexOf(option.value);
                        if (index > -1) {
                          currentNotes.splice(index, 1);
                        }
                      }

                      setFormData({ ...formData, note: currentNotes });
                    }}
                    disabled={isLockedByCompletion}
                  />
                );
              })}
            </div>
          </div>
          <div className="flex-1 grid grid-cols-2 gap-4 w-full">
            <Select
              label="지정지청 *"
              value={formData.designated_office}
              onChange={(e) => {
                const newOffice = e.target.value;
                setFormData((prev) => ({
                  ...prev,
                  designated_office: newOffice
                }));
              }}
              options={designatedOfficeOptions}
              required
              disabled={autoFilling}
              className={autoFilling ? "bg-surface-50" : ""}
            />
            <Select
              label="완료여부"
              value={formData.completion_status}
              onChange={(e) =>
                setFormData({ ...formData, completion_status: e.target.value })
              }
              options={completionStatusOptions}
            // 완료여부는 완료 상태에서도 수정 가능 (미완료로 변경하기 위함)
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 md:col-span-2 lg:col-span-3 max-w-md">
          <div>
            <Input
              label="공문연번"
              value={formData.document_number}
              disabled={(!isAdmin && !!entry.id) || isLockedByCompletion}
              onChange={(e) => setFormData({ ...formData, document_number: e.target.value })}
              className={cn("font-bold", ((!isAdmin && !!entry.id) || isLockedByCompletion) ? "bg-surface-50" : "")}
              placeholder={((!isAdmin && !!entry.id) || isLockedByCompletion) ? "변경 불가 (승인 필요)" : "자동 부여됩니다"}
            />
            {/* 일반 사용자에게만 수정 불가능함을 안내 */}
            {!isAdmin && entry.id && (
              <p className="text-xs text-text-500 mt-1">
                관리자 승인 없이 수정 불가
              </p>
            )}
          </div>
          <div>
            <Input
              label="연번"
              value={formData.sequence_number}
              disabled={(!isAdmin && !!entry.id) || isLockedByCompletion}
              onChange={(e) => setFormData({ ...formData, sequence_number: e.target.value })}
              className={cn("font-bold", ((!isAdmin && !!entry.id) || isLockedByCompletion) ? "bg-surface-50" : "")}
              placeholder={((!isAdmin && !!entry.id) || isLockedByCompletion) ? "변경 불가 (승인 필요)" : "자동 부여됩니다"}
            />
            {!isAdmin && entry.id && (
              <p className="text-xs text-text-500 mt-1">
                관리자 승인 없이 수정 불가
              </p>
            )}
          </div>
          <div>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <Input
                  label="5인 이상 연번"
                  value={formData.five_plus_sequence}
                  disabled={(!isAdmin && !!entry.id) || isLockedByCompletion}
                  onChange={(e) => setFormData({ ...formData, five_plus_sequence: e.target.value })}
                  className={cn("font-bold", ((!isAdmin && !!entry.id) || isLockedByCompletion) ? "bg-surface-50" : "")}
                  placeholder={((!isAdmin && !!entry.id) || isLockedByCompletion) ? "변경 불가 (승인 필요)" : "자동 부여됩니다"}
                />
              </div>
              {officeQuota !== null && (
                <div className="mt-8 text-sm font-medium text-gray-500 whitespace-nowrap pt-1">
                  / {officeQuota}
                </div>
              )}
            </div>
            {!isAdmin && entry.id && (
              <p className="text-xs text-text-500 mt-1">
                관리자 승인 없이 수정 불가
              </p>
            )}
          </div>
        </div>
        {!isAdmin && entry.id && (
          <div className="mt-2">
            {pendingNumberRequest ? (
              <Alert variant="warning" title="번호 변경 요청 대기 중">
                번호 변경 요청이 관리자 승인을 기다리고 있습니다.
                <div className="mt-2 text-sm">
                  <div>공문연번: {pendingNumberRequest.old_document_number || '-'} → {pendingNumberRequest.new_document_number || '-'}</div>
                  <div>연번: {pendingNumberRequest.old_sequence_number || '-'} → {pendingNumberRequest.new_sequence_number || '-'}</div>
                  <div>5인 이상 연번: {pendingNumberRequest.old_five_plus_sequence || '-'} → {pendingNumberRequest.new_five_plus_sequence || '-'}</div>
                  <div className="text-text-500 mt-1">요청일시: {new Date(pendingNumberRequest.requested_at).toLocaleString('ko-KR')}</div>
                </div>
              </Alert>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={async () => {
                  const newDocumentNumber = prompt("새 공문연번을 입력하세요 (변경하지 않으려면 현재 값 입력):", formData.document_number || "");
                  if (newDocumentNumber === null) return;

                  const newSequenceNumber = prompt("새 연번을 입력하세요 (변경하지 않으려면 현재 값 입력):", formData.sequence_number || "");
                  if (newSequenceNumber === null) return;

                  const newFivePlusSequence = prompt("새 5인 이상 연번을 입력하세요 (변경하지 않으려면 현재 값 입력):", formData.five_plus_sequence || "");
                  if (newFivePlusSequence === null) return;

                  // 변경 사항 확인
                  const hasChanges =
                    newDocumentNumber !== formData.document_number ||
                    newSequenceNumber !== formData.sequence_number ||
                    newFivePlusSequence !== formData.five_plus_sequence;

                  if (!hasChanges) {
                    alert("변경할 번호가 없습니다.");
                    return;
                  }

                  setRequestingNumberChange(true);
                  try {
                    const response = await fetch(`/api/journal/${entry.id}/number-change-request`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        document_number: newDocumentNumber,
                        sequence_number: newSequenceNumber,
                        five_plus_sequence: newFivePlusSequence,
                      }),
                    });

                    const data = await response.json();
                    if (response.ok) {
                      alert("번호 변경 요청이 생성되었습니다. 관리자 승인을 기다려주세요.");
                      // 요청 조회
                      const requestResponse = await fetch(`/api/journal/${entry.id}/number-change-request`);
                      if (requestResponse.ok) {
                        const requestData = await requestResponse.json();
                        setPendingNumberRequest(requestData.request);
                      }
                    } else {
                      alert(data.error || "번호 변경 요청 생성에 실패했습니다.");
                    }
                  } catch (err) {
                    console.error("번호 변경 요청 오류:", err);
                    alert("번호 변경 요청 중 오류가 발생했습니다.");
                  } finally {
                    setRequestingNumberChange(false);
                  }
                }}
                disabled={requestingNumberChange || isCompleted}
              >
                {requestingNumberChange ? "요청 중..." : "번호 변경 요청"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderMeasurementInfo = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        측정 정보
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Input
          label="측정 시작일"
          type="date"
          value={normalizeDateForInput(formData.measurement_start_date)}
          onChange={(e) => {
            const startDate = e.target.value;
            setFormData((prev) => {
              const updated = { ...prev, measurement_start_date: startDate };
              // 종료일이 비어있거나 측정 시작일과 동일한 경우 종료일을 측정 시작일과 동일하게 설정
              if (!prev.measurement_end_date || prev.measurement_end_date === prev.measurement_start_date) {
                updated.measurement_end_date = startDate;
              }
              return updated;
            });
          }}
          className="max-w-[200px]"
        />
        <Input
          label="측정 종료일"
          type="date"
          value={normalizeDateForInput(formData.measurement_end_date)}
          onChange={(e) =>
            setFormData({ ...formData, measurement_end_date: e.target.value })
          }
          className="max-w-[200px]"
        />
        <Input
          label="측정자"
          value={formData.measurer}
          onChange={(e) => setFormData({ ...formData, measurer: e.target.value })}
          placeholder="측정자 입력"
          disabled={isLockedByCompletion}
          className={isLockedByCompletion ? "bg-surface-50" : ""}
        />
      </div>
    </div>
  );

  const renderManagerInfo = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        담당자 정보
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Input
          label="담당자 성명"
          value={formData.manager_name}
          onChange={(e) =>
            setFormData({ ...formData, manager_name: e.target.value })
          }
        />
        <Input
          label="담당자 직위"
          value={formData.manager_position}
          onChange={(e) =>
            setFormData({ ...formData, manager_position: e.target.value })
          }
        />
        <Input
          label="담당자 휴대폰"
          value={formData.manager_mobile}
          onChange={(e) =>
            setFormData({ ...formData, manager_mobile: e.target.value })
          }
        />
        <div className="flex flex-col gap-1">
          <Input
            label="담당자 e-mail"
            type="email"
            value={formData.manager_email}
            onChange={(e) =>
              setFormData({ ...formData, manager_email: e.target.value })
            }
          />
          {previousEmails.manager_email && (
            <div className="px-1 text-[11px] text-text-400 font-medium truncate" title={`전회: ${previousEmails.manager_email}`}>
              전회: {previousEmails.manager_email}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderSurveyInfo = () => {
    if (!surveyInfo) return null;

    return (
      <div className="bg-blue-50 rounded-lg p-5 border border-blue-200">
        <h3 className="text-lg font-bold text-blue-900 mb-4 pb-2 border-b-2 border-primary-500">
          예비조사 정보 (참고용)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">예비조사자</label>
            <div className="p-2 bg-white rounded-md border border-gray-300 text-sm">{surveyInfo.preliminary_surveyor || "-"}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">공시료 코드</label>
            <div className="p-2 bg-white rounded-md border border-gray-300 text-sm">{surveyInfo.survey_code || "-"}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">실측정자</label>
            <div className="p-2 bg-white rounded-md border border-gray-300 text-sm">{surveyInfo.actual_measurer || "-"}</div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">보고서 담당</label>
            <div className="p-2 bg-white rounded-md border border-gray-300 text-sm">{surveyInfo.report_writer || "-"}</div>
          </div>
        </div>
      </div>
    );
  };

  const renderSpecialNotes = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        특이사항
      </h3>
      <Textarea
        label="특이사항"
        value={formData.special_notes}
        onChange={(e) =>
          setFormData({ ...formData, special_notes: e.target.value })
        }
        rows={4}
      />
    </div>
  );

  return (
    <form id="journal-edit-form" onSubmit={handleSubmit} className="space-y-6">
      {!isAdmin && isCompleted && (
        <div className="mb-4">
          <span className="text-sm text-yellow-600 bg-yellow-50 px-3 py-1.5 rounded-md font-medium">
            완료된 항목 (일부 수정 가능)
          </span>
        </div>
      )}

        <div className="space-y-3">
          {error && <Alert variant="error">{error}</Alert>}
        </div>


      {
        mode === 'journal' ? (
          <>
            {renderBasicInfo()}
            {renderBusinessInfo()}
            {renderMeasurementInfo()}
            {renderSurveyInfo()}
            {renderManagerInfo()}
            {renderK2BInfo()}
            {renderFeeInfo()}
            {renderDepositInfo()}
            {renderSpecialNotes()}
          </>
        ) : (
          <>
            {renderBusinessInfo()}
            {renderDepositInfo()}
            {renderFeeInfo()}
            {renderK2BInfo()}
            {renderBasicInfo()}
            {renderMeasurementInfo()}
            {renderSurveyInfo()}
            {renderManagerInfo()}
            {renderSpecialNotes()}
          </>
        )
      }
    </form >
  );
};

