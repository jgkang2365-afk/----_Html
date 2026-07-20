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
        <div className="inline-flex items-center gap-2 bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5 text-rose-700">
            <AlertTriangle size={15} className="shrink-0 text-rose-500" />
            <span className="text-xs font-bold whitespace-nowrap">
                데이터 불일치 {issueCount}건 감지됨
            </span>
            <Button
                variant="danger"
                className="h-6 px-2 text-[10px] font-bold rounded flex items-center gap-0.5 shrink-0"
                onClick={onNavigate}
            >
                확인하러 가기 <ArrowRight size={10} />
            </Button>
        </div>
    );
}
