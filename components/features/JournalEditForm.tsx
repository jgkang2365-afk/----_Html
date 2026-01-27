"use client";

import React, { useState, useEffect } from "react";
import { DESIGNATED_OFFICE_OPTIONS_WITHOUT_ALL } from "@/lib/constants/designated-offices";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Checkbox } from "@/components/ui/Checkbox";
import { normalizeDateForInput } from "@/lib/utils/date-normalize";
import { formatBusinessNumber, parseBusinessNumber } from "@/lib/utils/business-number";
import { useUser } from "@/hooks/use-user";

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
  const isAdmin = user?.role === "관리자" || user?.role === "DB관리";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalYear, setOriginalYear] = useState(entry.measurement_year);
  const [originalPeriod, setOriginalPeriod] = useState(entry.measurement_period);
  const [autoFilling, setAutoFilling] = useState(false);
  const [completionSuggestion, setCompletionSuggestion] = useState<string | null>(null);
  const [pendingNumberRequest, setPendingNumberRequest] = useState<any>(null);
  const [requestingNumberChange, setRequestingNumberChange] = useState(false);
  const [businessCategories, setBusinessCategories] = useState<{ value: string; label: string }[]>([]);
  // 전회 측정비 정보 (참고용)
  const [previousMeasurementFee, setPreviousMeasurementFee] = useState<{
    business: number | null;
    national: number | null;
  }>({ business: null, national: null });
  // 완료여부 체크는 기존 측정일지(id가 있는 경우)를 수정할 때만 적용
  // 검색 결과에서 선택한 경우(id가 null)는 등록 모드이므로 완료여부와 관계없이 등록 가능
  const isCompleted = (entry.id && user?.role !== "DB관리") ? entry.completion_status === "완료" : false;
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
        // 개선된 파싱: 콤마로 분리하고, 체크박스 값만 추출
        // 콜론(:)이 포함된 항목(예비조사 정보)은 제외
        const noteString = entry.note.trim();
        const splitNotes = noteString.split(',').map(n => n.trim()).filter(Boolean);

        // 체크박스 값만 필터링 (콜론이 없는 항목 중 validNoteValues에 일치하는 것만)
        const foundNotes = splitNotes.filter(note => {
          // 콜론이 포함된 항목은 예비조사 정보이므로 제외
          if (note.includes(':')) {
            return false;
          }
          // validNoteValues에 정확히 일치하는 것만 포함
          return validNoteValues.includes(note);
        });

        console.log('[JournalEditForm] 초기화: note 파싱 (개선)', {
          원본: entry.note,
          split후: splitNotes,
          추출된값: foundNotes,
          제외된항목: splitNotes.filter(n => n.includes(':') || !validNoteValues.includes(n)),
        });
        return foundNotes;
      }
      if (Array.isArray(entry.note)) {
        const filtered = entry.note.filter(note => validNoteValues.includes(note));
        console.log('[JournalEditForm] 초기화: note 배열 필터링', {
          원본: entry.note,
          필터링후: filtered,
        });
        return filtered;
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
    representative_name: entry.representative_name || "",
    national_support_status: entry.national_support_status || "",
    address: entry.address || "",
    phone: entry.phone || "",
    fax: entry.fax || "",
    business_category: (() => {
      // 지정지청이 "대전"이고 업종분류가 비어있으면 기본값 "공업사"
      if (entry.designated_office === "대전" && !entry.business_category) {
        return "공업사";
      }
      return entry.business_category || "";
    })(),

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

    // 측정비 정보
    measurement_fee_total: entry.measurement_fee_total || "",
    measurement_fee_business: entry.measurement_fee_business || "",
    measurement_fee_national: entry.measurement_fee_national || "",

    // 입금 정보
    deposit_total: entry.deposit_total || "",
    deposit_date_business: normalizeDateForInput(entry.deposit_date_business),
    deposit_amount_business: entry.deposit_amount_business || "",
    deposit_date_national: normalizeDateForInput(entry.deposit_date_national),
    deposit_amount_national: entry.deposit_amount_national || "",

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

  // 입금액 합계 자동 계산
  useEffect(() => {
    // 국고지원 여부가 "비대상"인 경우 사업장만으로 계산
    if (formData.national_support_status === "비대상") {
      const business = parseFloat(parseCurrency(formData.deposit_amount_business)) || 0;
      setFormData((prev) => ({
        ...prev,
        deposit_total: business > 0 ? business.toString() : "",
      }));
    } else {
      const business = parseFloat(parseCurrency(formData.deposit_amount_business)) || 0;
      const national = parseFloat(parseCurrency(formData.deposit_amount_national)) || 0;
      const total = business + national;
      if (total > 0 || formData.deposit_amount_business || formData.deposit_amount_national) {
        setFormData((prev) => ({
          ...prev,
          deposit_total: total > 0 ? total.toString() : "",
        }));
      }
    }
  }, [formData.deposit_amount_business, formData.deposit_amount_national, formData.national_support_status]);

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

  // 등록 모드일 때 직전 측정일지 데이터 자동 채우기
  useEffect(() => {
    // 등록 모드(id가 null)이고, 필수 필드가 모두 있을 때만 실행
    if (!entry.id && entry.code && entry.measurement_year && entry.measurement_period) {
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
                console.log('[JournalEditForm] 예비조사 정보 확인:', {
                  report_writer: data.surveyInfo.report_writer,
                  measurer: data.surveyInfo.measurer,
                  기존_k2b_sender: prev.k2b_sender,
                });

                // 측정자 (예비조사의 measurer가 있으면 무조건 사용, 기존 값 덮어쓰기)
                if (data.surveyInfo.measurer) {
                  updated.measurer = data.surveyInfo.measurer;
                }

                // K2B 전송자 (예비조사의 report_writer가 있으면 기본값으로 설정, 최우선)
                // report_writer는 콤마 구분 문자열일 수 있으므로 첫 번째 값만 사용
                if (data.surveyInfo.report_writer) {
                  // 콤마로 구분된 경우 첫 번째 값만 사용
                  const reportWriterValue = data.surveyInfo.report_writer.split(',').map((w: string) => w.trim()).filter(Boolean)[0] || data.surveyInfo.report_writer.trim();

                  // 등록 모드: 항상 예비조사 정보 사용
                  // 수정 모드: 예비조사 정보를 우선 사용 (기존 값 덮어쓰기)
                  updated.k2b_sender = reportWriterValue;
                  console.log('[JournalEditForm] 예비조사 정보에서 K2B 전송자 기본값 설정:', {
                    모드: entry.id ? '수정' : '등록',
                    기존값: prev.k2b_sender,
                    원본값: data.surveyInfo.report_writer,
                    설정값: reportWriterValue,
                  });
                }

                // 측정 시작일 (예비조사의 measurement_date가 있으면 기본값으로 설정)
                if (data.surveyInfo.measurement_date && !prev.measurement_start_date) {
                  updated.measurement_start_date = normalizeDateForInput(data.surveyInfo.measurement_date);
                  // 측정 종료일도 비어있으면 측정 시작일과 동일하게 설정
                  if (!prev.measurement_end_date) {
                    updated.measurement_end_date = normalizeDateForInput(data.surveyInfo.measurement_date);
                  }
                }

                // note 필드에 예비조사 정보 추가
                const noteParts: string[] = [];
                if (data.surveyInfo.preliminary_surveyor) {
                  noteParts.push(`예비조사자: ${data.surveyInfo.preliminary_surveyor}`);
                }
                if (data.surveyInfo.survey_code) {
                  noteParts.push(`공시료 코드: ${data.surveyInfo.survey_code}`);
                }
                if (data.surveyInfo.actual_measurer) {
                  noteParts.push(`실측정자: ${data.surveyInfo.actual_measurer}`);
                }
                if (data.surveyInfo.report_writer) {
                  noteParts.push(`보고서 담당: ${data.surveyInfo.report_writer}`);
                }

                // note 필드에 추가 (기존 note 배열에 추가)
                if (noteParts.length > 0) {
                  const currentNotes = Array.isArray(prev.note) ? [...prev.note] : (prev.note ? [prev.note] : []);
                  noteParts.forEach(part => {
                    if (!currentNotes.some(n => n.includes(part.split(':')[0]))) {
                      currentNotes.push(part);
                    }
                  });
                  updated.note = currentNotes;
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
              // 특이사항에 미수금 정보 추가
              setFormData((prev) => {
                const unpaidNote = `전회 미수 ${data.unpaidCount}회`;
                const currentNotes = prev.special_notes || "";
                // 이미 미수금 정보가 있으면 추가하지 않음
                if (!currentNotes.includes("전회 미수")) {
                  return {
                    ...prev,
                    special_notes: currentNotes ? `${currentNotes}\n${unpaidNote}` : unpaidNote,
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
        ]);
      }
    };
    fetchBusinessCategories();
  }, []);

  // 지정지청이 "대전"으로 변경되면 업종분류 기본값을 "공업사"로 설정
  useEffect(() => {
    if (formData.designated_office === "대전" && !formData.business_category) {
      setFormData((prev) => ({
        ...prev,
        business_category: "공업사",
      }));
    }
  }, [formData.designated_office]);

  // 등록 모드일 때 로그인 사용자 정보로 기본값 설정
  // 주의: 측정자는 예비조사 정보에서 가져오므로 여기서는 설정하지 않음
  useEffect(() => {
    // 등록 모드이고, 사용자 정보가 있고, 해당 필드가 비어있을 때만 설정
    if (!entry.id && user?.name) {
      setFormData((prev) => {
        const updated = { ...prev };
        // 측정자는 예비조사 정보에서 가져오므로 로그인 사용자 정보로 설정하지 않음
        // K2B 전송자 기본값 (비어있을 때만, K2B 전송자 옵션에 있는 경우만)
        const k2bSenderOptions = ["한기문", "강종구", "이주형", "배윤민", "고유빈"];
        if (!prev.k2b_sender && k2bSenderOptions.includes(user.name)) {
          updated.k2b_sender = user.name;
        }
        return updated;
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
        // 개선된 파싱: 콤마로 분리하고, 체크박스 값만 추출
        // 콜론(:)이 포함된 항목(예비조사 정보)은 제외
        const noteString = entry.note.trim();
        const splitNotes = noteString.split(',').map(n => n.trim()).filter(Boolean);

        // 체크박스 값만 필터링 (콜론이 없는 항목 중 validNoteValues에 일치하는 것만)
        noteArray = splitNotes.filter(note => {
          // 콜론이 포함된 항목은 예비조사 정보이므로 제외
          if (note.includes(':')) {
            return false;
          }
          // validNoteValues에 정확히 일치하는 것만 포함
          return validNoteValues.includes(note);
        });

        console.log('[JournalEditForm] note 파싱 상세 (개선):', {
          원본값: entry.note,
          split후: splitNotes,
          추출된값: noteArray,
          validNoteValues: validNoteValues,
          제외된항목: splitNotes.filter(n => n.includes(':') || !validNoteValues.includes(n)),
        });
      } else if (Array.isArray(entry.note)) {
        // 배열인 경우에도 비고 체크박스 옵션에 해당하는 값만 필터링
        console.log('[JournalEditForm] note 배열 파싱:', {
          원본배열: entry.note,
          validNoteValues: validNoteValues,
        });
        noteArray = entry.note.filter(note => validNoteValues.includes(note));
      }
    }

    console.log('[JournalEditForm] note 배열 변환 결과 (필터링 후):', noteArray);

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
      representative_name: entry.representative_name || "",
      national_support_status: entry.national_support_status || "",
      address: entry.address || "",
      phone: entry.phone || "",
      fax: entry.fax || "",
      business_category: (() => {
        // 지정지청이 "대전"이고 업종분류가 비어있으면 기본값 "공업사"
        if (entry.designated_office === "대전" && !entry.business_category) {
          return "공업사";
        }
        return entry.business_category || "";
      })(),

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

      // 측정비 정보
      measurement_fee_total: entry.measurement_fee_total || "",
      measurement_fee_business: entry.measurement_fee_business || "",
      measurement_fee_national: entry.measurement_fee_national || "",

      // 입금 정보
      deposit_total: entry.deposit_total || "",
      deposit_date_business: normalizeDateForInput(entry.deposit_date_business),
      deposit_amount_business: entry.deposit_amount_business || "",
      deposit_date_national: normalizeDateForInput(entry.deposit_date_national),
      deposit_amount_national: entry.deposit_amount_national || "",

      // 특이사항
      special_notes: entry.special_notes || "",
    });

    // originalYear, originalPeriod도 업데이트
    setOriginalYear(entry.measurement_year);
    setOriginalPeriod(entry.measurement_period);
  }, [entry.id, entry.note, entry.code, entry.measurement_year, entry.measurement_period]); // entry의 주요 필드가 변경될 때 전체 재초기화

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

  // 금액·입금 상태 기반 자동 완료여부 제안
  useEffect(() => {
    // 완료 상태가 아닐 때만 제안
    if (formData.completion_status !== "완료") {
      const feeTotal = parseFloat(parseCurrency(formData.measurement_fee_total)) || 0;
      const depositTotal = parseFloat(parseCurrency(formData.deposit_total)) || 0;
      const endDate = formData.measurement_end_date;

      // 조건: 측정비 합계 = 입금액 합계이고, 측정 종료일이 과거인 경우
      if (feeTotal > 0 && depositTotal > 0 && feeTotal === depositTotal && endDate) {
        const endDateObj = new Date(endDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        endDateObj.setHours(0, 0, 0, 0);

        // 측정 종료일이 오늘 이전이면 완료 제안
        if (endDateObj <= today) {
          setCompletionSuggestion("측정비와 입금액이 일치하고 측정이 종료되었습니다. 완료여부를 '완료'로 변경하시겠습니까?");
        } else {
          setCompletionSuggestion(null);
        }
      } else {
        setCompletionSuggestion(null);
      }
    } else {
      setCompletionSuggestion(null);
    }
  }, [formData.measurement_fee_total, formData.deposit_total, formData.measurement_end_date, formData.completion_status]);

  // 업종분류가 '공업사'일 때 자동화 로직
  useEffect(() => {
    if (formData.business_category === "공업사") {
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
        if (prev.measurement_start_date) {
          const startDate = new Date(prev.measurement_start_date);
          const nextDate = new Date(startDate);
          nextDate.setDate(startDate.getDate() + 1);

          const day = nextDate.getDay(); // 0: 일, 6: 토
          if (day === 6) { // 토요일 -> 월요일 (2일 추가)
            nextDate.setDate(nextDate.getDate() + 2);
          } else if (day === 0) { // 일요일 -> 월요일 (1일 추가)
            nextDate.setDate(nextDate.getDate() + 1);
          }

          const nextWorkingDay = normalizeDateForInput(nextDate.toISOString()); // YYYY-MM-DD 변환

          // 기존 값과 다르면 업데이트 (사용자가 수정한 경우 덮어쓰게 되지만, '기본값' 요구사항에 따라 반영)
          if (prev.electronic_invoice_date !== nextWorkingDay) {
            updates.electronic_invoice_date = nextWorkingDay;
            hasUpdates = true;
          }
        }

        if (hasUpdates) {
          return { ...prev, ...updates };
        }
        return prev;
      });
    }
  }, [formData.business_category, formData.measurement_start_date]);

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
            console.log('[JournalEditForm] 저장할 note 값: null (빈 배열)');
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

      // 국고지원 여부가 "비대상"인 경우 측정비 합계와 입금액 합계를 사업장만으로 재계산
      if (submitData.national_support_status === "비대상") {
        const businessFee = submitData.measurement_fee_business || 0;
        const businessDeposit = submitData.deposit_amount_business || 0;
        submitData.measurement_fee_total = businessFee > 0 ? businessFee : null;
        submitData.deposit_total = businessDeposit > 0 ? businessDeposit : null;
        console.log('[JournalEditForm] 국고지원 여부가 "비대상"이므로 합계를 사업장만으로 재계산:', {
          measurement_fee_total: submitData.measurement_fee_total,
          deposit_total: submitData.deposit_total,
        });
      }

      const url = entry.id ? `/api/journal/${entry.id}` : "/api/journal";
      const method = entry.id ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(submitData),
      });

      const data = await response.json();

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
          label="총인원"
          type="number"
          value={formData.total_employees}
          onChange={(e) =>
            setFormData({ ...formData, total_employees: e.target.value })
          }
        />
        <Input
          label="사업자번호"
          value={formatBusinessNumber(formData.business_number)}
          onChange={(e) => {
            // 숫자만 추출하여 저장 (하이픈 제거)
            const numbers = parseBusinessNumber(e.target.value);
            setFormData({ ...formData, business_number: numbers });
          }}
          placeholder="305-86-41481"
          maxLength={12}
        />
        <Input
          label="산재관리번호"
          value={formData.industrial_accident_number}
          onChange={(e) =>
            setFormData({ ...formData, industrial_accident_number: e.target.value })
          }
        />
        <Input
          label="대표자명"
          value={formData.representative_name}
          onChange={(e) =>
            setFormData({ ...formData, representative_name: e.target.value })
          }
        />
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
          value={formData.office_jurisdiction}
          disabled
          className="bg-surface-50"
          placeholder="주소 입력 시 자동 입력됩니다"
        />
        <Select
          label="업종 분류"
          value={formData.business_category}
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
    </div>
  );
  ;

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

    return (
      <div className={containerClass}>
        <h3 className={titleClass}>
          입금 정보
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Input
            label="입금액(합계)"
            type="text"
            value={formatCurrency(formData.deposit_total)}
            onChange={(e) => {
              const parsed = parseCurrency(e.target.value);
              setFormData({ ...formData, deposit_total: parsed });
            }}
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
              className={`font-medium ${formData.national_support_status === "비대상" ? "bg-gray-100 cursor-not-allowed" : ""}`}
            />
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
        <Input
          label="계산서 메일"
          type="email"
          value={formData.invoice_email}
          onChange={(e) =>
            setFormData({ ...formData, invoice_email: e.target.value })
          }
        />
        <Input
          label="전자계산서 발행일"
          type="date"
          value={normalizeDateForInput(formData.electronic_invoice_date)}
          onChange={(e) =>
            setFormData({ ...formData, electronic_invoice_date: e.target.value })
          }
          className="max-w-[200px]"
        />
      </div>
    </div>
  );

  const renderK2BInfo = () => (
    <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
      <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
        K2B 정보
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="K2B 전송일"
          type="date"
          value={normalizeDateForInput(formData.k2b_send_date)}
          onChange={(e) =>
            setFormData({ ...formData, k2b_send_date: e.target.value })
          }
          className="max-w-[200px]"
        />
        <Input
          label="K2B 전송자"
          value={formData.k2b_sender}
          onChange={(e) =>
            setFormData({ ...formData, k2b_sender: e.target.value })
          }
        />
        <Input
          label="계산서 메일"
          value={formData.invoice_email}
          onChange={(e) => setFormData({ ...formData, invoice_email: e.target.value })}
          placeholder="이메일 입력"
        />
        <Input
          label="전자계산서 발행일"
          type="date"
          value={normalizeDateForInput(formData.electronic_invoice_date)}
          onChange={(e) =>
            setFormData({ ...formData, electronic_invoice_date: e.target.value })
          }
          className="max-w-[200px]"
        />
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
        <div className="md:col-span-2 lg:col-span-3 flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0">
            <label className="block text-sm font-medium text-text-700 mb-2">비고 (복수 선택 가능)</label>
            <div className="flex flex-nowrap gap-x-4 gap-y-2 p-3 bg-white border border-surface-200 rounded-lg overflow-x-auto">
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
                  />
                );
              })}
            </div>
          </div>
          <div className="flex-1 grid grid-cols-3 gap-4">
            <Input
              label="소재지 관할청"
              value={formData.office_jurisdiction}
              disabled
              className="bg-surface-50"
              placeholder="주소 입력 시 자동 입력됩니다"
            />
            <Select
              label="지정지청 *"
              value={formData.designated_office}
              onChange={(e) =>
                setFormData({ ...formData, designated_office: e.target.value })
              }
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
              disabled={isCompleted}
              className={isCompleted ? "bg-surface-50" : ""}
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 md:col-span-2 lg:col-span-3 max-w-md">
          <div>
            <Input
              label="공문연번"
              value={formData.document_number}
              disabled={!isAdmin && !!entry.document_number} // 기존 값이 있으면 관리자만 수정 가능
              onChange={(e) => isAdmin && setFormData({ ...formData, document_number: e.target.value })}
              className={isAdmin || !entry.document_number ? "" : "bg-surface-50 font-mono"}
              placeholder={!isAdmin && !!entry.document_number ? "변경 불가" : "자동 부여됩니다"}
            />
            {!isAdmin && (
              <p className="text-xs text-text-500 mt-1">
                {entry.document_number ? "관리자만 수정 가능" : "관리자 승인 필요"}
              </p>
            )}
          </div>
          <div>
            <Input
              label="연번"
              value={formData.sequence_number}
              disabled={!isAdmin && !!entry.sequence_number} // 기존 값이 있으면 관리자만 수정 가능
              onChange={(e) => isAdmin && setFormData({ ...formData, sequence_number: e.target.value })}
              className={isAdmin || !entry.sequence_number ? "" : "bg-surface-50 font-mono"}
              placeholder={!isAdmin && !!entry.sequence_number ? "변경 불가" : "자동 부여됩니다"}
            />
            {!isAdmin && (
              <p className="text-xs text-text-500 mt-1">
                {entry.sequence_number ? "관리자만 수정 가능" : "관리자 승인 필요"}
              </p>
            )}
          </div>
          <div>
            <Input
              label="5인 이상 연번"
              value={formData.five_plus_sequence}
              disabled={!isAdmin && !!entry.five_plus_sequence} // 기존 값이 있으면 관리자만 수정 가능
              onChange={(e) => isAdmin && setFormData({ ...formData, five_plus_sequence: e.target.value })}
              className={isAdmin || !entry.five_plus_sequence ? "" : "bg-surface-50 font-mono"}
              placeholder={!isAdmin && !!entry.five_plus_sequence ? "변경 불가" : "자동 부여됩니다"}
            />
            {!isAdmin && (
              <p className="text-xs text-text-500 mt-1">
                {entry.five_plus_sequence ? "관리자만 수정 가능" : "관리자 승인 필요"}
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
        <Input
          label="담당자 e-mail"
          type="email"
          value={formData.manager_email}
          onChange={(e) =>
            setFormData({ ...formData, manager_email: e.target.value })
          }
        />
      </div>
    </div>
  );



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
      {/* 오류 및 알림 메시지 영역 - 상단 고정 (높이 고정) */}
      <div className="sticky top-0 z-20 bg-white -mx-8 px-8 pt-0 pb-3 border-b border-surface-200 h-28">
        <div className="h-full overflow-y-auto space-y-3">
          {error && <Alert variant="error">{error}</Alert>}
          {isCompleted && (
            <Alert variant="warning">
              완료된 측정일지입니다. 입금, 측정비, K2B 정보 등 일부 항목만 수정 가능합니다.
            </Alert>
          )}
          {completionSuggestion && (
            <Alert variant="warning">
              {completionSuggestion}
              <div className="mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFormData({ ...formData, completion_status: "완료" });
                    setCompletionSuggestion(null);
                  }}
                >
                  완료로 변경
                </Button>
              </div>
            </Alert>
          )}
        </div>
      </div>

      {mode === 'journal' ? (
        <>
          {renderBasicInfo()}
          {renderBusinessInfo()}
          {renderMeasurementInfo()}
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
          {renderManagerInfo()}
          {renderSpecialNotes()}
        </>
      )}
    </form>
  );
};

