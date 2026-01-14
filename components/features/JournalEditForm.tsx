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
  onSuccess: () => void;
}

export const JournalEditForm: React.FC<JournalEditFormProps> = ({
  entry,
  onClose,
  onSuccess,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalYear, setOriginalYear] = useState(entry.measurement_year);
  const [originalPeriod, setOriginalPeriod] = useState(entry.measurement_period);
  const [autoFilling, setAutoFilling] = useState(false);
  // 완료여부 체크는 기존 측정일지(id가 있는 경우)를 수정할 때만 적용
  // 검색 결과에서 선택한 경우(id가 null)는 등록 모드이므로 완료여부와 관계없이 등록 가능
  const isCompleted = entry.id ? entry.completion_status === "완료" : false;
  const [formData, setFormData] = useState({
    // 기본 정보
    code: entry.code,
    measurement_year: entry.measurement_year,
    measurement_period: entry.measurement_period,
    note: entry.note ? (typeof entry.note === 'string' ? entry.note.split(',').filter(Boolean) : entry.note) : [],
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
    { value: "하반기", label: "하반기" },
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
    const business = parseFloat(parseCurrency(formData.measurement_fee_business)) || 0;
    const national = parseFloat(parseCurrency(formData.measurement_fee_national)) || 0;
    const total = business + national;
    if (total > 0 || formData.measurement_fee_business || formData.measurement_fee_national) {
      setFormData((prev) => ({
        ...prev,
        measurement_fee_total: total > 0 ? total.toString() : "",
      }));
    }
  }, [formData.measurement_fee_business, formData.measurement_fee_national]);

  // 입금액 합계 자동 계산
  useEffect(() => {
    const business = parseFloat(parseCurrency(formData.deposit_amount_business)) || 0;
    const national = parseFloat(parseCurrency(formData.deposit_amount_national)) || 0;
    const total = business + national;
    if (total > 0 || formData.deposit_amount_business || formData.deposit_amount_national) {
      setFormData((prev) => ({
        ...prev,
        deposit_total: total > 0 ? total.toString() : "",
      }));
    }
  }, [formData.deposit_amount_business, formData.deposit_amount_national]);

  // 측정비 합계 자동 계산
  useEffect(() => {
    const business = parseFloat(parseCurrency(formData.measurement_fee_business)) || 0;
    const national = parseFloat(parseCurrency(formData.measurement_fee_national)) || 0;
    const total = business + national;
    if (total > 0 || formData.measurement_fee_business || formData.measurement_fee_national) {
      setFormData((prev) => ({
        ...prev,
        measurement_fee_total: total > 0 ? total.toString() : "",
      }));
    }
  }, [formData.measurement_fee_business, formData.measurement_fee_national]);

  // 입금액 합계 자동 계산
  useEffect(() => {
    const business = parseFloat(parseCurrency(formData.deposit_amount_business)) || 0;
    const national = parseFloat(parseCurrency(formData.deposit_amount_national)) || 0;
    const total = business + national;
    if (total > 0 || formData.deposit_amount_business || formData.deposit_amount_national) {
      setFormData((prev) => ({
        ...prev,
        deposit_total: total > 0 ? total.toString() : "",
      }));
    }
  }, [formData.deposit_amount_business, formData.deposit_amount_national]);

  // 초기 로드 시 주소가 있으면 자동 입력 및 사업자번호 포맷팅
  useEffect(() => {
    if (entry.address && !entry.office_jurisdiction) {
      handleAddressChange(entry.address);
    }
    // 사업자번호는 표시 시 포맷팅하므로 초기값은 그대로 사용
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 측정년도/측정주기 변경 검증 (수정 모드에서만)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // 측정년도/측정주기 변경 검증은 수정 모드(entry.id가 있는 경우)에서만 적용
    // 등록 모드(entry.id가 null)에서는 검증하지 않음
    if (entry.id) {
      if (
        formData.measurement_year === originalYear &&
        formData.measurement_period === originalPeriod
      ) {
        const confirmed = window.confirm(
          "측정년도와 측정주기가 변경되지 않았습니다. 계속하시겠습니까?"
        );
        if (!confirmed) {
          setLoading(false);
          return;
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
          } else {
            submitData[key] = null;
          }
        } else {
          submitData[key] = value === "" ? null : value;
        }
      });

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
        onSuccess();
        onClose();
      } else {
        setError(data.error || "저장 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("측정일지 저장 오류:", err);
      setError(err.message || "저장 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}
      {isCompleted && (
        <Alert variant="warning">
          완료된 측정일지는 수정할 수 없습니다. 완료여부를 &quot;미완료&quot;로 변경한 후 수정하세요.
        </Alert>
      )}

      {/* 기본 정보 */}
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
            <Input
              label="공문연번"
              value={formData.document_number}
              disabled
              className="bg-surface-50 font-mono"
              placeholder="자동 부여됩니다"
            />
            <Input
              label="연번"
              value={formData.sequence_number}
              disabled
              className="bg-surface-50 font-mono"
              placeholder="자동 부여됩니다"
            />
            <Input
              label="5인 이상 연번"
              value={formData.five_plus_sequence}
              disabled
              className="bg-surface-50 font-mono"
              placeholder="자동 부여됩니다"
            />
          </div>
        </div>
      </div>

      {/* 측정 정보 */}
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

      {/* 사업장 정보 */}
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

      {/* 담당자 정보 */}
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

      {/* K2B 정보 */}
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
        </div>
      </div>

      {/* 측정비 정보 */}
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
          <Input
            label="측정비(사업장)"
            type="text"
            value={formatCurrency(formData.measurement_fee_business)}
            onChange={(e) => {
              const parsed = parseCurrency(e.target.value);
              setFormData({ ...formData, measurement_fee_business: parsed });
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
            placeholder="숫자만 입력"
          />
          <Input
            label="측정비(국고)"
            type="text"
            value={formatCurrency(formData.measurement_fee_national)}
            onChange={(e) => {
              const parsed = parseCurrency(e.target.value);
              setFormData({ ...formData, measurement_fee_national: parsed });
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
            placeholder="숫자만 입력"
          />
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

      {/* 입금 정보 */}
      <div className="bg-surface-50 rounded-lg p-5 border border-surface-200">
        <h3 className="text-lg font-bold text-text-900 mb-4 pb-2 border-b-2 border-primary-500">
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
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="입금일자(사업장)"
              type="date"
              value={normalizeDateForInput(formData.deposit_date_business)}
              onChange={(e) =>
                setFormData({ ...formData, deposit_date_business: e.target.value })
              }
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
              placeholder="숫자만 입력"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="입금일자(국고)"
              type="date"
              value={normalizeDateForInput(formData.deposit_date_national)}
              onChange={(e) =>
                setFormData({ ...formData, deposit_date_national: e.target.value })
              }
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
              label="입금액(국고)"
              type="text"
              value={formatCurrency(formData.deposit_amount_national)}
              onChange={(e) => {
                const parsed = parseCurrency(e.target.value);
                setFormData({ ...formData, deposit_amount_national: parsed });
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
              placeholder="숫자만 입력"
            />
          </div>
        </div>
      </div>

      {/* 특이사항 */}
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

      {/* 버튼 */}
      <div className="flex gap-2 justify-end pt-4 border-t">
        <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
          취소
        </Button>
        <Button type="submit" disabled={loading || isCompleted}>
          {loading ? <LoadingSpinner /> : entry.id ? "수정" : "등록"}
        </Button>
      </div>
    </form>
  );
};

