"use client";

import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Alert } from "@/components/ui/Alert";
import { Modal } from "@/components/ui/Modal";             // Modal 컴포넌트 추가
import { Textarea } from "@/components/ui/Textarea";       // Textarea 컴포넌트 추가
import { DESIGNATED_OFFICES } from "@/lib/constants/designated-offices";

interface QuotaData {
    id?: number;
    year: number;
    period: string;
    office_name: string;
    quota: number;
}

interface ChangeRequest {
    period: string;
    office: string;
    newValue: number;
}

export default function AdminQuotasPage() {
    const currentYear = new Date().getFullYear();
    const [selectedYear, setSelectedYear] = useState(currentYear.toString());
    const [quotas, setQuotas] = useState<QuotaData[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // 변경 사유 모달 상태
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [changeReason, setChangeReason] = useState("");
    const [pendingChange, setPendingChange] = useState<ChangeRequest | null>(null);

    // 년도 옵션 (현재 년도 기준 -2년 ~ +3년)
    const yearOptions = Array.from({ length: 6 }, (_, i) => {
        const year = currentYear - 2 + i;
        return { value: year.toString(), label: year.toString() };
    });

    // 데이터 조회
    const fetchQuotas = async (year: string) => {
        try {
            setLoading(true);
            setError(null);

            const response = await fetch(`/api/admin/quotas?year=${year}`);
            const result = await response.json();

            if (response.ok) {
                const fetchedData = result.data || [];
                const initializedData = initializeData(parseInt(year), fetchedData);
                setQuotas(initializedData);
            } else {
                setError(result.error || "데이터를 불러오는 중 오류가 발생했습니다.");
            }
        } catch (err: any) {
            console.error("데이터 조회 오류:", err);
            setError("데이터를 불러오는 중 오류가 발생했습니다.");
        } finally {
            setLoading(false);
        }
    };

    const initializeData = (year: number, currentData: QuotaData[]): QuotaData[] => {
        const periods = ["상반기", "하반기"];
        const newData: QuotaData[] = [];

        periods.forEach(period => {
            DESIGNATED_OFFICES.forEach(office => {
                const found = currentData.find(d => d.period === period && d.office_name === office);
                if (found) {
                    newData.push(found);
                } else {
                    newData.push({
                        year,
                        period,
                        office_name: office,
                        quota: 0
                    });
                }
            });
        });

        return newData;
    };

    useEffect(() => {
        fetchQuotas(selectedYear);
    }, [selectedYear]);

    // 값 클릭 시 수정 모드 진입 (여기서는 값 수정을 팝업으로 하지 않고, 값 수정 후 저장 시 사유를 묻는 방식 아님.
    // 사용성은 "수정 -> 포커스 아웃 또는 엔터 -> 저장하시겠습니까?(사유입력)" 흐름이 좋음.
    // 하지만 여기서는 개별 수정이 아니라 일괄 수정이므로, "저장" 버튼 클릭 시 변경된 항목이 있으면 사유 입력 팝업을 띄우는 것이 적절함.

    // 우선 Input 변경 핸들러 (UI 상 값 변경)
    const handleChange = (period: string, office: string, value: string) => {
        const numValue = parseInt(value) || 0;
        setQuotas(prev =>
            prev.map(q =>
                (q.period === period && q.office_name === office)
                    ? { ...q, quota: numValue }
                    : q
            )
        );
    };

    // 저장 버튼 클릭 핸들러
    const handleSaveClick = () => {
        setChangeReason("");
        setIsModalOpen(true);
    };

    // 실제 저장 실행 (모달 확인)
    const handleConfirmSave = async () => {
        if (!changeReason.trim()) {
            alert("변경 사유를 입력해주세요.");
            return;
        }

        try {
            setSaving(true);
            setError(null);
            setSuccessMessage(null);
            setIsModalOpen(false);

            const promises = quotas.map(q =>
                fetch("/api/admin/quotas", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        ...q,
                        change_reason: changeReason // 사유 포함
                    })
                })
            );

            await Promise.all(promises);

            setSuccessMessage("저장되었습니다.");
            setTimeout(() => setSuccessMessage(null), 3000);

            fetchQuotas(selectedYear);

        } catch (err: any) {
            console.error("저장 오류:", err);
            setError("저장 중 오류가 발생했습니다.");
        } finally {
            setSaving(false);
        }
    };

    const sortedOffices = [...DESIGNATED_OFFICES];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-text-900">지청별 지정한계 관리</h1>
                    <p className="text-text-700 mt-1">
                        각 연도 및 주기별로 지청의 인가 갯수를 설정합니다.
                    </p>
                </div>
            </div>

            <Card className="p-6">
                <div className="flex items-center gap-4 mb-6">
                    <label className="font-semibold text-text-900">설정 년도:</label>
                    <div className="w-32">
                        <Select
                            options={yearOptions}
                            value={selectedYear}
                            onChange={(e) => setSelectedYear(e.target.value)}
                        />
                    </div>
                    <Button
                        variant="primary"
                        onClick={() => fetchQuotas(selectedYear)}
                        disabled={loading}
                    >
                        조회
                    </Button>
                </div>

                {error && <Alert variant="error" className="mb-4">{error}</Alert>}
                {successMessage && <Alert variant="success" className="mb-4">{successMessage}</Alert>}

                {loading ? (
                    <div className="flex justify-center py-12">
                        <LoadingSpinner />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left border rounded-lg overflow-hidden">
                            <thead className="bg-surface-50 text-text-700 uppercase">
                                <tr>
                                    <th className="px-6 py-3 border-b border-r text-center w-32">구분</th>
                                    {sortedOffices.map(office => (
                                        <th key={office} className="px-6 py-3 border-b text-center">
                                            {office}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {/* 상반기 행 */}
                                <tr className="bg-white border-b hover:bg-slate-50">
                                    <td className="px-6 py-4 font-bold text-center border-r bg-surface-50/50">
                                        상반기
                                    </td>
                                    {sortedOffices.map(office => {
                                        const data = quotas.find(q => q.period === "상반기" && q.office_name === office);
                                        return (
                                            <td key={`상반기-${office}`} className="px-4 py-3 text-center">
                                                <Input
                                                    type="number"
                                                    value={data?.quota.toString() || "0"}
                                                    onChange={(e) => handleChange("상반기", office, e.target.value)}
                                                    className="text-center font-bold"
                                                    min="0"
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                                {/* 하반기 행 */}
                                <tr className="bg-white hover:bg-slate-50">
                                    <td className="px-6 py-4 font-bold text-center border-r bg-surface-50/50">
                                        하반기
                                    </td>
                                    {sortedOffices.map(office => {
                                        const data = quotas.find(q => q.period === "하반기" && q.office_name === office);
                                        return (
                                            <td key={`하반기-${office}`} className="px-4 py-3 text-center">
                                                <Input
                                                    type="number"
                                                    value={data?.quota.toString() || "0"}
                                                    onChange={(e) => handleChange("하반기", office, e.target.value)}
                                                    className="text-center font-bold"
                                                    min="0"
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            </tbody>
                        </table>

                        <div className="mt-6 flex justify-end">
                            <Button
                                variant="primary"
                                size="lg"
                                onClick={handleSaveClick}
                                disabled={saving}
                                className="w-32"
                            >
                                {saving ? "저장 중..." : "저장"}
                            </Button>
                        </div>
                    </div>
                )}
            </Card>

            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800">
                <h4 className="font-bold mb-2">💡 도움말</h4>
                <ul className="list-disc pl-4 space-y-1">
                    <li>표의 숫자를 직접 클릭하여 수정할 수 있습니다.</li>
                    <li>수정 후 <strong>[저장]</strong> 버튼을 누르면, 변경 사유 입력 후 저장됩니다.</li>
                    <li>기본 인가 갯수: 천안 140, 대전 160, 평택 20, 경기 40</li>
                </ul>
            </div>

            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="변경 사유 입력"
            >
                <div className="space-y-4">
                    <p className="text-sm text-text-700">
                        인가 갯수 변경에 대한 사유를 입력해주세요. 이 내용은 변경 이력에 기록됩니다.
                    </p>
                    <div>
                        <label className="block text-sm font-medium text-text-700 mb-1">
                            변경 사유 <span className="text-error-500">*</span>
                        </label>
                        <Textarea
                            value={changeReason}
                            onChange={(e) => setChangeReason(e.target.value)}
                            placeholder="예: 업무량 증가로 인한 추가 배정"
                            className="h-24 resize-none"
                        />
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                        <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                            취소
                        </Button>
                        <Button variant="primary" onClick={handleConfirmSave}>
                            저장
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
