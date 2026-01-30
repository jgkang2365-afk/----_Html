"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
    calculateMeasurementWeekdays,
} from "@/lib/utils/date-utils";
import { isValidDateString } from "@/lib/utils/date-validator";

interface BusinessInfo {
    code: string;
    business_name: string;
    business_number: string;
    address: string;
}

interface CommonFormValues {
    year: string;
    period: string;
    measurement_date: string;
    end_date: string;
    measurement_weekdays: string;
}

interface BulkRegisterModalProps {
    selectedBusinesses: BusinessInfo[];
    onClose: () => void;
    onSuccess: () => void;
}

export const BulkRegisterModal: React.FC<BulkRegisterModalProps> = ({
    selectedBusinesses,
    onClose,
    onSuccess,
}) => {
    const [commonValues, setCommonValues] = useState<CommonFormValues>({
        year: "2026",
        period: "상반기",
        measurement_date: "",
        end_date: "",
        measurement_weekdays: "",
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);

    // 측정일 입력 시 종료일 및 요일 자동 계산
    const handleMeasurementDateChange = (value: string) => {
        if (value && isValidDateString(value)) {
            setCommonValues((prev) => {
                const updated = {
                    ...prev,
                    measurement_date: value,
                    // 측정종료일 기본값은 측정시작일과 동일하게 설정 (사용자 요구사항)
                    end_date: value,
                };

                // 요일 계산
                updated.measurement_weekdays = calculateMeasurementWeekdays(value, value);

                return updated;
            });
        } else {
            setCommonValues(prev => ({ ...prev, measurement_date: value }));
        }
    };

    const handleEndDateChange = (value: string) => {
        if (value && isValidDateString(value)) {
            setCommonValues((prev) => {
                const updated = { ...prev, end_date: value };
                if (prev.measurement_date) {
                    updated.measurement_weekdays = calculateMeasurementWeekdays(prev.measurement_date, value);
                }
                return updated;
            });
        } else {
            setCommonValues(prev => ({ ...prev, end_date: value }));
        }
    };

    const handleSubmit = async () => {
        if (!commonValues.measurement_date) {
            setError("측정일을 입력해주세요.");
            return;
        }
        // 측정시작일이 있으면 종료일도 필수 (기본값 설정되므로 보통 있음)
        if (!commonValues.end_date) {
            setError("측정종료일을 입력해주세요.");
            return;
        }

        setLoading(true);
        setError(null);
        let successCount = 0;
        const errors: string[] = [];

        try {
            for (let i = 0; i < selectedBusinesses.length; i++) {
                const business = selectedBusinesses[i];

                const payload = {
                    ...commonValues,
                    code: business.code,
                    business_name: business.business_name,
                    business_number: business.business_number,
                    address: business.address,
                    // 측정자 등 기타 정보는 개별 입력을 위해 null 또는 빈 값으로 전송
                    measurer: null,
                    survey_code: null,
                    preliminary_surveyor: null,
                    report_writer: null,
                };

                const response = await fetch("/api/survey", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });

                if (!response.ok) {
                    const data = await response.json();
                    const msg = data.error || "알 수 없는 오류";
                    console.error(`Failed to register ${business.business_name}:`, msg);
                    errors.push(`[${business.business_name}] ${msg}`);
                } else {
                    successCount++;
                }

                setProgress(Math.round(((i + 1) / selectedBusinesses.length) * 100));
            }

            if (errors.length > 0) {
                // 실패 건수가 있는 경우 에러 표시 및 모달 유지
                const errorMsg = `총 ${selectedBusinesses.length}건 중 ${successCount}건 성공, ${errors.length}건 실패.\n\n[실패 사유]\n${errors.join("\n")}`;
                setError(errorMsg);
                // 부분 성공 시에도 목록 갱신을 위해 onSuccess를 호출하고 싶지만, 
                // 현재 구조상 onSuccess는 모달을 닫아버리므로 호출하지 않음.
                // 대신 사용자가 닫기/취소 버튼을 누를 때 목록이 갱신되도록 하거나,
                // 에러 메시지에 "성공한 건은 등록되었습니다"라고 안내.
            } else {
                // 모두 성공 시
                onSuccess();
            }
        } catch (err: any) {
            console.error("일괄 등록 중 오류:", err);
            setError(err.message || "일괄 등록 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6 max-h-[80vh] overflow-y-auto p-1">
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <h3 className="font-semibold text-blue-900 mb-2">선택된 사업장 ({selectedBusinesses.length}건)</h3>
                <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                    {selectedBusinesses.map(b => (
                        <span key={b.code} className="bg-white px-2 py-1 rounded border border-blue-200 text-sm text-blue-800">
                            {b.business_name}
                        </span>
                    ))}
                </div>
            </div>


            {error && <Alert variant="error"><div className="whitespace-pre-wrap">{error}</div></Alert>}


            <Card className="p-6">
                <h3 className="text-lg font-semibold text-text-900 mb-4">측정 일정 일괄 등록</h3>
                <p className="text-sm text-gray-500 mb-4">
                    측정시작일과 종료일을 입력하세요. 나머지 정보(측정자 등)는 등록 후 개별 입력해야 합니다.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                    <Input
                        label="측정시작일"
                        type="date"
                        value={commonValues.measurement_date}
                        onChange={(e) => handleMeasurementDateChange(e.target.value)}
                        required
                    />
                    <div>
                        <Input
                            label="측정종료일"
                            type="date"
                            value={commonValues.end_date}
                            onChange={(e) => handleEndDateChange(e.target.value)}
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">기본값은 측정시작일과 동일합니다.</p>
                    </div>
                </div>

                <div className="mb-2">
                    <Input
                        label="측정요일 (자동 계산)"
                        value={commonValues.measurement_weekdays}
                        readOnly
                        className="bg-surface-50 text-gray-600"
                    />
                </div>
            </Card>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <Button variant="secondary" onClick={onClose} disabled={loading}>
                    취소
                </Button>
                <Button onClick={handleSubmit} disabled={loading} className="w-40 relative">
                    {loading ? (
                        <>
                            <span className="opacity-0">등록 중...</span>
                            <div className="absolute inset-0 flex items-center justify-center">
                                <LoadingSpinner size="sm" />
                                <span className="ml-2 text-xs">{progress}%</span>
                            </div>
                        </>
                    ) : (
                        "일괄 등록하기"
                    )}
                </Button>
            </div>
        </div>
    );
};
