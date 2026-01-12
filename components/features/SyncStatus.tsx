"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

interface SyncLog {
  id: number;
  file_name: string;
  sync_type: string;
  sync_start_time: string;
  sync_end_time?: string;
  status: "성공" | "실패" | "진행중";
  records_processed: number;
  records_updated: number;
  records_inserted: number;
  error_message?: string;
  created_at: string;
}

export function SyncStatus() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchSyncLogs();
  }, []);

  const fetchSyncLogs = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/sync");
      if (response.ok) {
        const data = await response.json();
        setLogs(data.logs || []);
      } else {
        setError("동기화 로그를 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err) {
      setError("동기화 로그를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      setSuccess(null);

      const response = await fetch("/api/sync", {
        method: "POST",
      });

      // 리다이렉트 응답 처리
      if (response.redirected || response.status === 307 || response.status === 308) {
        setError("권한이 없습니다. 관리자에게 문의하세요.");
        setSyncing(false);
        return;
      }

      if (!response.ok) {
        // HTTP 에러 상태 코드 처리
        const errorData = await response.json().catch(() => ({ error: "서버 오류가 발생했습니다." }));
        const errorMsg = errorData.error || errorData.message || `서버 오류 (${response.status})`;
        console.error("동기화 오류 상세:", errorData);
        setError(errorMsg);
        return;
      }

      const data = await response.json();

      if (data.success) {
        setSuccess("동기화가 완료되었습니다.");
        // 동기화 로그 새로고침
        await fetchSyncLogs();
      } else {
        // 더 자세한 에러 메시지 표시
        const errorMsg = data.error || data.message || "동기화 중 오류가 발생했습니다.";
        console.error("동기화 오류 상세:", data);
        setError(errorMsg);
      }
    } catch (err) {
      console.error("동기화 오류:", err);
      setError(err instanceof Error ? err.message : "동기화 중 오류가 발생했습니다.");
    } finally {
      setSyncing(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const getLatestLog = (type: string) => {
    return logs
      .filter((log) => log.sync_type === type)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  };

  const businessInfoLog = getLatestLog("사업장정보");
  const measurementBusinessLog = getLatestLog("측정사업장");

  if (loading) {
    return (
      <Card>
        <div className="p-6">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-text-900">Excel 파일 동기화 상태</h2>
          <Button
            variant="primary"
            onClick={handleSync}
            disabled={syncing}
            className="text-sm"
          >
            {syncing ? "동기화 중..." : "수동 동기화"}
          </Button>
        </div>

        {error && (
          <Alert variant="error" className="mb-3 text-sm">
            {error}
          </Alert>
        )}

        {success && (
          <Alert variant="success" className="mb-3 text-sm">
            {success}
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* 사업장정보 동기화 상태 */}
          <div className="border border-surface-200 rounded p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-text-900">사업장정보.xlsx</span>
              {businessInfoLog && (
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    businessInfoLog.status === "성공"
                      ? "bg-success-100 text-success-700"
                      : businessInfoLog.status === "실패"
                      ? "bg-error-100 text-error-700"
                      : "bg-warning-100 text-warning-700"
                  }`}
                >
                  {businessInfoLog.status}
                </span>
              )}
            </div>
            {businessInfoLog ? (
              <div className="text-xs text-text-600">
                {formatDate(businessInfoLog.sync_end_time || businessInfoLog.sync_start_time)} · {businessInfoLog.records_processed}건
              </div>
            ) : (
              <div className="text-xs text-text-400">동기화 기록 없음</div>
            )}
          </div>

          {/* 측정사업장 동기화 상태 */}
          <div className="border border-surface-200 rounded p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-text-900">측정사업장.xlsx</span>
              {measurementBusinessLog && (
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    measurementBusinessLog.status === "성공"
                      ? "bg-success-100 text-success-700"
                      : measurementBusinessLog.status === "실패"
                      ? "bg-error-100 text-error-700"
                      : "bg-warning-100 text-warning-700"
                  }`}
                >
                  {measurementBusinessLog.status}
                </span>
              )}
            </div>
            {measurementBusinessLog ? (
              <div className="text-xs text-text-600">
                {formatDate(measurementBusinessLog.sync_end_time || measurementBusinessLog.sync_start_time)} · {measurementBusinessLog.records_processed}건
              </div>
            ) : (
              <div className="text-xs text-text-400">동기화 기록 없음</div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

