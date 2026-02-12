"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { AlertTriangle, ArrowRight } from "lucide-react";

interface InconsistencyAlertProps {
    onNavigate: () => void;
}

export function InconsistencyAlert({ onNavigate }: InconsistencyAlertProps) {
    const [issueCount, setIssueCount] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchIssueCount();
    }, []);

    const fetchIssueCount = async () => {
        try {
            const response = await fetch("/api/sync");
            if (response.ok) {
                const data = await response.json();
                setIssueCount(data.verification_issues?.length || 0);
            }
        } catch (error) {
            console.error("Failed to fetch sync status:", error);
        } finally {
            setLoading(false);
        }
    };

    if (loading || issueCount === 0) return null;

    return (
        <div className="mb-6">
            <Alert variant="error" className="border-l-4 border-l-error-500 bg-white shadow-sm">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-error-100 rounded-full text-error-600">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-error-900 text-lg">
                                ⚠️ 데이터 불일치 {issueCount}건 감지됨
                            </h3>
                            <p className="text-sm text-text-600 mt-1">
                                측정사업장(최신) 데이터와 사업장 정보 간의 불일치가 존재합니다.
                                <br />
                                검토 및 해결을 위해 데이터 업로드 탭을 확인해주세요.
                            </p>
                        </div>
                    </div>
                    <Button
                        variant="danger"
                        className="shrink-0 flex items-center gap-2"
                        onClick={onNavigate}
                    >
                        확인하러 가기 <ArrowRight size={16} />
                    </Button>
                </div>
            </Alert>
        </div>
    );
}
