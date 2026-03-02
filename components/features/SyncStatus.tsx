"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import * as XLSX from 'xlsx';
import { Download } from "lucide-react";

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
  change_details?: string[] | null; // JSONB로 저장되지만 클라이언트에서는 파싱된 배열로 받음
  created_at: string;
}

interface VerificationIssue {
  id: number;
  code: string;
  business_name: string;
  issue_type: 'MISMATCH_NAME' | 'MISMATCH_REPRESENTATIVE' | 'MISSING_IN_BUSINESS_INFO' | 'MISSING_IN_MEASUREMENT';
  description: string;
  created_at: string;
}

export function SyncStatus() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [issues, setIssues] = useState<VerificationIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [referenceDate, setReferenceDate] = useState<string>(new Date().toISOString().split('T')[0]);

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
        setIssues(data.verification_issues || []);
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

  const handleDownloadExcel = () => {
    if (issues.length === 0) {
      alert("다운로드할 데이터가 없습니다.");
      return;
    }

    try {
      // 엑셀 데이터 준비
      const excelData = issues.map(issue => ({
        "코드": issue.code,
        "사업장명": issue.business_name,
        "불일치 유형": issue.issue_type,
        "상세 내용": issue.description,
        "발생 일시": formatDate(issue.created_at)
      }));

      // 워크시트 생성
      const ws = XLSX.utils.json_to_sheet(excelData);

      // 워크북 생성
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "데이터불일치알림");

      // 파일명 생성 (YYYYMMDD)
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const fileName = `데이터_불일치_알림_${year}${month}${day}.xlsx`;

      // 파일 다운로드
      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error("Excel download error:", err);
      alert("엑셀 다운로드 중 오류가 발생했습니다.");
    }
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(date);
  };

  /* 가장 최신 로그를 가져오는 함수 (Status Card용) */
  const getLatestLog = (type: string) => {
    return logs
      .filter((log) => log.sync_type === type)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  };

  const getRecentLogs = (type: string) => {
    // string (YYYY-MM-DD)을 로컬 날짜 객체로 안전하게 변환
    const [y, m, d] = referenceDate.split('-').map(Number);
    const refDate = new Date(y, m - 1, d);

    // 조회일의 끝(23:59:59)
    const endDate = new Date(refDate);
    endDate.setHours(23, 59, 59, 999);

    // 조회일 기준 7일 전의 시작(00:00:00)
    const startDate = new Date(refDate);
    startDate.setDate(startDate.getDate() - 7);
    startDate.setHours(0, 0, 0, 0);

    return logs
      .filter((log) => {
        const logDate = new Date(log.created_at);
        return log.sync_type === type && logDate >= startDate && logDate <= endDate;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  };

  /* 각 동기화 시점별로 의미 있는 변경 내역만 추출 */
  const getUniqueLogs = (targetLogs: SyncLog[]) => {
    return targetLogs.map(log => {
      let display_details: string[] = [];
      let hasNoChanges = false;

      if (log.change_details && log.change_details.length > 0) {
        // 해당 동기화 시점 내에서의 중복만 제거 (Set을 함수 내부로 이동)
        const localSeen = new Set<string>();
        display_details = log.change_details.filter(detail => {
          const key = detail.trim();
          if (localSeen.has(key)) return false;
          localSeen.add(key);
          return true;
        });

        if (display_details.length === 0) {
          hasNoChanges = true;
        }
      } else {
        // 애초에 변경 내역이 없는 경우
        hasNoChanges = true;
      }

      return {
        ...log,
        display_details,
        hasNoChanges
      };
    }).filter(log => !log.hasNoChanges);
  };

  const businessInfoLog = getLatestLog("사업장정보");
  const measurementBusinessLog = getLatestLog("측정사업장");

  const businessInfoLogs = getRecentLogs("사업장정보");
  const measurementBusinessLogs = getRecentLogs("측정사업장");

  const uniqueBusinessInfoLogs = getUniqueLogs(businessInfoLogs);
  const uniqueMeasurementBusinessLogs = getUniqueLogs(measurementBusinessLogs);

  /* 날짜별로 그룹화 */
  const groupLogsByDate = (targetLogs: any[]) => {
    const groups: { [key: string]: any[] } = {};
    targetLogs.forEach(log => {
      const dateKey = new Date(log.created_at).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'short'
      });
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(log);
    });
    return groups;
  };

  const groupedBusinessInfo = groupLogsByDate(uniqueBusinessInfoLogs);
  const groupedMeasurementBusiness = groupLogsByDate(uniqueMeasurementBusinessLogs);

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
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-text-900">Excel 파일 동기화 상태</h2>
              <div className="flex items-center gap-2 mt-1">
                <label htmlFor="ref-date" className="text-xs text-text-500 font-medium">조회일 기준:</label>
                <input
                  id="ref-date"
                  type="date"
                  value={referenceDate}
                  onChange={(e) => setReferenceDate(e.target.value)}
                  className="text-xs border border-surface-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <Button
              variant="primary"
              onClick={handleSync}
              disabled={syncing}
              className="text-sm shadow-sm"
            >
              {syncing ? "동기화 중..." : "수동 동기화 실행"}
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
                <span className="text-sm font-medium text-text-900">사업장정보.xlsx (사업장 정보)</span>
                {businessInfoLog && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${businessInfoLog.status === "성공"
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
                <span className="text-sm font-medium text-text-900">측정사업장.xlsx (측정사업장(최신))</span>
                {measurementBusinessLog && (
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${measurementBusinessLog.status === "성공"
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

      {/* 최근 1주일 변경 내역 표시 (사업장정보) */}
      <Card className="bg-surface-50 border-surface-200">
        <div className="p-4">
          <h3 className="text-[15px] font-bold text-slate-800 mb-3 flex items-center gap-2">
            <span className="p-1 bg-indigo-100 rounded-md">🏢</span> [사업장정보] Excel 가져오기 이력
          </h3>
          <div className="bg-white border border-surface-200 rounded-xl p-4 max-h-[450px] overflow-y-auto text-xs text-text-700 leading-relaxed shadow-inner scrollbar-thin scrollbar-thumb-gray-200">
            {Object.keys(groupedBusinessInfo).length > 0 ? (
              <div className="space-y-8">
                {Object.entries(groupedBusinessInfo).map(([date, dayLogs]) => (
                  <div key={date} className="relative pl-4 border-l-2 border-indigo-100 space-y-5">
                    <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-4 border-indigo-500 shadow-sm"></div>
                    <div className="font-bold text-sm text-indigo-900 mb-2">{date}</div>

                    <div className="space-y-6">
                      {dayLogs.map((log) => (
                        <div key={log.id} className="bg-slate-50/50 rounded-lg p-3 border border-slate-100 hover:border-indigo-200 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">
                                {new Date(log.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span className="text-[11px] font-medium text-slate-500 truncate max-w-[200px]" title={log.file_name}>
                                📁 {log.file_name || '파일명 정보 없음'}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">
                              (처리 {log.records_processed}건 / 수정 {log.records_updated}건)
                            </span>
                          </div>

                          {log.display_details && log.display_details.length > 0 ? (
                            <div className="pl-1.5 border-l-2 border-indigo-200/50 ml-1 mt-2">
                              <ul className="space-y-1.5">
                                {log.display_details.map((detail: string, idx: number) => (
                                  <li key={idx} className="break-all text-slate-700 leading-normal flex items-start gap-1.5">
                                    <span className="text-indigo-400 mt-0.5">•</span>
                                    <span>{detail}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <div className="text-slate-400 pl-4 py-1 text-[11px] italic">기존 데이터와 모두 일치하여 변경 내용 없음</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-text-400 italic py-8 text-center bg-gray-50/50 rounded">
                선택하신 {referenceDate} 기준 1주일간 변경 내역이 없습니다.
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 최근 1주일 변경 내역 표시 (측정사업장) */}
      <Card className="bg-surface-50 border-surface-200">
        <div className="p-4">
          <h3 className="text-[15px] font-bold text-slate-800 mb-3 flex items-center gap-2">
            <span className="p-1 bg-emerald-100 rounded-md">📊</span> [측정사업장] Excel 가져오기 이력
          </h3>
          <div className="bg-white border border-surface-200 rounded-xl p-4 max-h-[450px] overflow-y-auto text-xs text-text-700 leading-relaxed shadow-inner scrollbar-thin scrollbar-thumb-gray-200">
            {Object.keys(groupedMeasurementBusiness).length > 0 ? (
              <div className="space-y-8">
                {Object.entries(groupedMeasurementBusiness).map(([date, dayLogs]) => (
                  <div key={date} className="relative pl-4 border-l-2 border-emerald-100 space-y-5">
                    <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-white border-4 border-emerald-500 shadow-sm"></div>
                    <div className="font-bold text-sm text-emerald-900 mb-2">{date}</div>

                    <div className="space-y-6">
                      {dayLogs.map((log) => (
                        <div key={log.id} className="bg-slate-50/50 rounded-lg p-3 border border-slate-100 hover:border-emerald-200 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold">
                                {new Date(log.created_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span className="text-[11px] font-medium text-slate-500 truncate max-w-[200px]" title={log.file_name}>
                                📁 {log.file_name || '파일명 정보 없음'}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">
                              (처리 {log.records_processed}건 / 수정 {log.records_updated}건)
                            </span>
                          </div>

                          {log.display_details && log.display_details.length > 0 ? (
                            <div className="pl-1.5 border-l-2 border-emerald-200/50 ml-1 mt-2">
                              <ul className="space-y-1.5">
                                {log.display_details.map((detail: string, idx: number) => (
                                  <li key={idx} className="break-all text-slate-700 leading-normal flex items-start gap-1.5">
                                    <span className="text-emerald-400 mt-0.5">•</span>
                                    <span>{detail}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : (
                            <div className="text-slate-400 pl-4 py-1 text-[11px] italic">기존 데이터와 모두 일치하여 변경 내용 없음</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-text-400 italic py-8 text-center bg-gray-50/50 rounded">
                선택하신 {referenceDate} 기준 1주일간 변경 내역이 없습니다.
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 데이터 정합성 검사 결과 */}
      {issues.length > 0 && (
        <Card className="border-error-200 bg-error-50">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-error-900 flex items-center gap-2">
                  ⚠️ 데이터 불일치 알림 ({issues.length}건)
                </h3>
              </div>
              <Button
                variant="secondary"
                onClick={handleDownloadExcel}
                className="text-xs h-8 px-3 bg-white hover:bg-gray-50 text-gray-700 border-gray-300 flex items-center gap-1.5"
              >
                <Download size={14} />
                엑셀 다운로드
              </Button>
            </div>

            <p className="text-sm text-text-700 mb-4 flex flex-col gap-1">
              <span>
                아래 항목들은 <span className="font-bold text-error-600">측정사업장(최신)(measurement_business)</span>과 <span className="font-bold text-indigo-600">사업장 정보(business_info)</span>가 일치하지 않습니다.
              </span>
              <span className="text-xs text-gray-500">
                * 해결 시 자동 삭제 (일자는 데이터 생성/수정일)
              </span>
            </p>

            <div className="max-h-[300px] overflow-y-auto space-y-2 pr-1">
              {issues.map(issue => (
                <div key={issue.id} className="bg-white border border-error-100 rounded p-2 text-sm shadow-sm">
                  <div className="font-medium text-error-800 flex justify-between items-center mb-1">
                    <span>[{issue.code}] {issue.business_name}</span>
                    <span className="text-xs text-gray-400 font-normal ml-2">
                      {formatDate(issue.created_at)}
                    </span>
                  </div>
                  <div className="text-gray-700 text-xs">
                    {issue.description.split(/(\[\[.*?\]\])/).map((part, index) => {
                      if (part.startsWith('[[') && part.endsWith(']]')) {
                        return (
                          <span key={index} className="bg-yellow-300 text-black font-extrabold px-0.5 rounded-sm mx-0.5">
                            {part.slice(2, -2)}
                          </span>
                        );
                      }
                      return <span key={index}>{part}</span>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
