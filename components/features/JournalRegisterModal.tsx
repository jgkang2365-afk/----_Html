"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { DESIGNATED_OFFICE_OPTIONS_WITHOUT_ALL } from "@/lib/constants/designated-offices";

interface Business {
    code: string;
    business_name: string;
}

interface JournalRegisterModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (data: {
        code: string;
        business_name: string;
        measurement_year: string;
        measurement_period: string;
        designated_office: string;
        address: string;
        business_number?: string;
        representative_name?: string;
        total_employees?: number | null;
        phone?: string;
        fax?: string;
        manager_name?: string;
        manager_position?: string;
        manager_mobile?: string;
        manager_email?: string;
        industrial_accident_number?: string;
        commencement_number?: string;
        invoice_email?: string;
        special_notes?: string;
    }) => void;
}

export const JournalRegisterModal: React.FC<JournalRegisterModalProps> = ({
    isOpen,
    onClose,
    onSelect,
}) => {
    const [loading, setLoading] = useState(false);
    const [businesses, setBusinesses] = useState<Business[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedBusinessCode, setSelectedBusinessCode] = useState("");

    // Default values
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const initialPeriod = currentMonth <= 6 ? "상반기" : "하반기";

    const [year, setYear] = useState(currentYear.toString());
    const [period, setPeriod] = useState(initialPeriod);
    const [designatedOffice, setDesignatedOffice] = useState("");

    // Load businesses on mount
    useEffect(() => {
        if (isOpen) {
            const fetchBusinesses = async () => {
                setLoading(true);
                try {
                    const response = await fetch("/api/journal/businesses");
                    if (response.ok) {
                        const data = await response.json();
                        setBusinesses(data.businesses || []);
                    }
                } catch (err) {
                    console.error("Failed to fetch businesses", err);
                } finally {
                    setLoading(false);
                }
            };

            // Reset states
            setSearchTerm("");
            setSearchQuery("");
            setSelectedBusinessCode("");
            setYear(currentYear.toString());
            setPeriod(initialPeriod);
            setDesignatedOffice("");

            fetchBusinesses();
        }
    }, [isOpen, currentYear, initialPeriod]);

    // Filter businesses
    const filteredBusinesses = useMemo(() => {
        if (!searchQuery) return businesses.slice(0, 50); // Limit initial display
        return businesses.filter(b =>
            b.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            b.code.toLowerCase().includes(searchQuery.toLowerCase())
        ).slice(0, 100); // Limit search results
    }, [businesses, searchQuery]);

    const handleSearch = () => {
        setSearchQuery(searchTerm);
    };

    const handleSelect = async () => {
        if (!selectedBusinessCode) return;

        setLoading(true);
        try {
            const response = await fetch(`/api/journal/businesses?code=${selectedBusinessCode}&year=${year}&period=${period}`);
            if (response.ok) {
                const data = await response.json();
                const business = data.business;

                onSelect({
                    code: business.code,
                    business_name: business.business_name,
                    measurement_year: year,
                    measurement_period: period,
                    designated_office: designatedOffice,
                    address: business.address || business.address1 || "",
                    business_number: business.business_number || "",
                    representative_name: business.representative_name || "",
                    total_employees: business.total_employees,
                    phone: business.phone || "",
                    fax: business.fax || "",
                    manager_name: business.manager_name || "",
                    manager_position: business.manager_position || "",
                    manager_mobile: business.manager_mobile || "",
                    manager_email: business.manager_email || "",
                    industrial_accident_number: business.industrial_accident_number || "",
                    commencement_number: business.commencement_number || "",
                    invoice_email: business.invoice_email || "",
                    special_notes: business.special_notes || "",
                });
                onClose();
            }
        } catch (err) {
            console.error("Failed to fetch business details", err);
        } finally {
            setLoading(false);
        }
    };

    const yearOptions = Array.from({ length: 3 }, (_, i) => {
        const y = currentYear - 1 + i;
        return { value: y.toString(), label: y.toString() };
    }).reverse();

    const periodOptions = [
        { value: "상반기", label: "상반기" },
        { value: "하반기", label: "하반기" },
    ];

    const designatedOfficeOptions = DESIGNATED_OFFICE_OPTIONS_WITHOUT_ALL;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="측정일지 등록 - 사업장 선택"
            size="lg"
        >
            <div className="space-y-6">
                <div className="space-y-4">
                    <div className="flex gap-2 items-end">
                        <div className="flex-1">
                            <Input
                                label="사업장 검색 (명칭 또는 코드)"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        handleSearch();
                                    }
                                }}
                                placeholder="사업장명 또는 코드 입력 후 조회..."
                                autoFocus
                            />
                        </div>
                        <Button
                            type="button"
                            onClick={handleSearch}
                            className="mb-[2px]"
                            variant="secondary"
                        >
                            조회
                        </Button>
                    </div>

                    <div className="border rounded-md max-h-60 overflow-y-auto">
                        {loading ? (
                            <div className="p-4 flex justify-center"><LoadingSpinner /></div>
                        ) : filteredBusinesses.length === 0 ? (
                            <div className="p-4 text-center text-gray-500">검색 결과가 없습니다.</div>
                        ) : (
                            <ul className="divide-y">
                                {filteredBusinesses.map((b) => (
                                    <li
                                        key={b.code}
                                        className={`p-3 cursor-pointer hover:bg-gray-50 flex justify-between items-center ${selectedBusinessCode === b.code ? 'bg-blue-50 border-l-4 border-blue-500' : ''}`}
                                        onClick={() => setSelectedBusinessCode(b.code)}
                                    >
                                        <span className="font-medium">{b.business_name}</span>
                                        <span className="text-sm text-gray-500">{b.code}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <Select
                            label="측정년도"
                            value={year}
                            onChange={(e) => setYear(e.target.value)}
                            options={yearOptions}
                        />
                        <Select
                            label="측정주기"
                            value={period}
                            onChange={(e) => setPeriod(e.target.value)}
                            options={periodOptions}
                        />
                    </div>
                    <Select
                        label="지정지청 (필수)"
                        value={designatedOffice}
                        onChange={(e) => setDesignatedOffice(e.target.value)}
                        options={[{ value: "", label: "선택하세요" }, ...designatedOfficeOptions]}
                    />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                    <Button variant="secondary" onClick={onClose}>
                        취소
                    </Button>
                    <Button
                        onClick={handleSelect}
                        disabled={!selectedBusinessCode || !year || !period || !designatedOffice}
                    >
                        다음 (입력)
                    </Button>
                </div>
            </div>
        </Modal>
    );
};
