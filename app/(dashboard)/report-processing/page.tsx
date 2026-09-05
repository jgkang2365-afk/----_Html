'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from '@/components/ui/Table';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { Card } from '@/components/ui/Card';
import {
    collectReportExplorerBusinessNames,
    deriveReportExplorerConnectionStatus,
    getReportExplorerHealth,
    openReportExplorerResult,
    ReportExplorerClientError,
    searchReportExplorer
} from '@/lib/report-explorer/client';
import type {
    ReportExplorerConnectionStatus,
    ReportExplorerMatch,
    ReportExplorerPeriod,
    ReportExplorerQueryResult
} from '@/lib/report-explorer/types';
import { toast } from 'sonner';
import { ExternalLink, FolderSearch, Loader2, Mail, Search, RefreshCw, Upload, X } from 'lucide-react';

interface BusinessRecord {
    code: string;
    business_name: string;
    year: number;
    period: string;
    manager_email: string;
    is_email_sent: boolean;
    last_email_sent_at: string | null;
    k2b_send_date: string | null;
    k2b_status: string | null;
    classification?: '정규' | '추가';
    delivery_status?: 'success' | 'bounced'; // 신규: 수신 성공/반송 여부
    delivery_error?: string | null;         // 신규: 반송 사유
}

const REPORT_PROCESSING_FILTERS_STORAGE_KEY = 'reportProcessingFilters';
const DEFAULT_REPORT_PROCESSING_FILTERS = {
    year: new Date().getFullYear().toString(),
    period: '상반기',
    search: ''
};
const PAGE_SIZE = 10;

function restoreReportProcessingFilters(value: string | null) {
    if (!value) return DEFAULT_REPORT_PROCESSING_FILTERS;

    try {
        const saved = JSON.parse(value);
        return {
            year: typeof saved.year === 'string' ? saved.year : DEFAULT_REPORT_PROCESSING_FILTERS.year,
            period: typeof saved.period === 'string' ? saved.period : DEFAULT_REPORT_PROCESSING_FILTERS.period,
            search: typeof saved.search === 'string' ? saved.search : DEFAULT_REPORT_PROCESSING_FILTERS.search
        };
    } catch {
        return DEFAULT_REPORT_PROCESSING_FILTERS;
    }
}

function reportExplorerStatusLabel(status: ReportExplorerQueryResult['status']) {
    if (status === 'FOUND') return '일치';
    if (status === 'MULTIPLE') return '복수 일치';
    return '미발견';
}

function reportExplorerConnectionStatusLabel(status: ReportExplorerConnectionStatus) {
    if (status === 'connected') return '로컬 탐색기 연결됨';
    if (status === 'storage-error') return '보고서 저장소 연결 오류';
    if (status === 'unchecked') return '연결 확인 전';
    return '로컬 탐색기 연결 안 됨';
}

function reportExplorerConnectionStatusClass(status: ReportExplorerConnectionStatus) {
    if (status === 'unchecked') return 'border-slate-200 bg-slate-50 text-slate-600';
    return status === 'connected'
        ? 'border-green-200 bg-green-50 text-green-700'
        : 'border-red-200 bg-red-50 text-red-700';
}

export default function ReportProcessingPage() {
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const [activeJob, setActiveJob] = useState<{ id: string; type: 'email' | 'k2b' } | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [records, setRecords] = useState<BusinessRecord[]>([]);
    const [selectedKeys, setSelectedKeys] = useState<string[]>([]); // 기기: code 기반 -> key `${code}-${year}-${period}` 기반
    const [filters, setFilters] = useState(DEFAULT_REPORT_PROCESSING_FILTERS);
    const [filtersReady, setFiltersReady] = useState(false);
    const [manualExplorerNames, setManualExplorerNames] = useState('');
    const [explorerYear, setExplorerYear] = useState('');
    const [explorerPeriod, setExplorerPeriod] = useState<ReportExplorerPeriod | ''>('');
    const [reportPage, setReportPage] = useState(1);
    const [explorerPage, setExplorerPage] = useState(1);
    const [explorerResults, setExplorerResults] = useState<ReportExplorerQueryResult[]>([]);
    const [explorerHasSearched, setExplorerHasSearched] = useState(false);
    const [explorerConnectionStatus, setExplorerConnectionStatus] = useState<ReportExplorerConnectionStatus>('unchecked');
    const [explorerMessage, setExplorerMessage] = useState<string | null>(null);
    const [explorerSearching, setExplorerSearching] = useState(false);
    const [explorerOpeningResultId, setExplorerOpeningResultId] = useState<string | null>(null);
    const explorerAbortControllerRef = useRef<AbortController | null>(null);

    // 시스템 기준 현재 주기 정의 (정규/추가 구분용)
    const CURRENT_YEAR = new Date().getFullYear();
    const CURRENT_PERIOD = '상반기';

    // 데이터 조회
    const fetchRecords = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const res = await fetch(`/api/report-processing?year=${filters.year}&period=${filters.period}&search=${filters.search}&t=${Date.now()}`);
            const data = await res.json();
            if (res.ok) {
                // 구분(정규/추가) 데이터 부여
                const enrichedRecords = (data.records || []).map((r: BusinessRecord) => ({
                    ...r,
                    classification: (r.year === CURRENT_YEAR && r.period === CURRENT_PERIOD) ? '정규' : '추가'
                }));
                setRecords(enrichedRecords);
                const availableKeys = new Set(enrichedRecords.map((record: BusinessRecord) =>
                    `${record.code}-${record.year}-${record.period}`));
                setSelectedKeys((current) => current.filter((key) => availableKeys.has(key)));
                setReportPage(1);
            } else {
                toast.error(data.error || '데이터 조회 실패');
            }
        } catch (error) {
            toast.error('서버 연결 오류');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        setFilters(restoreReportProcessingFilters(localStorage.getItem(REPORT_PROCESSING_FILTERS_STORAGE_KEY)));
        setFiltersReady(true);
    }, []);

    useEffect(() => {
        if (!filtersReady) return;
        localStorage.setItem(REPORT_PROCESSING_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    }, [filters, filtersReady]);

    useEffect(() => {
        if (!filtersReady) return;
        fetchRecords();
    }, [filters.year, filters.period, filtersReady]);

    useEffect(() => {
        setExplorerYear(filters.year === 'all' ? '' : filters.year);
    }, [filters.year]);

    useEffect(() => {
        setExplorerPeriod(filters.period === '상반기' || filters.period === '하반기' ? filters.period : '');
    }, [filters.period]);

    const selectedRecords = useMemo(
        () => records.filter((record) => selectedKeys.includes(`${record.code}-${record.year}-${record.period}`)),
        [records, selectedKeys]
    );
    const explorerBasisCount = selectedRecords.length > 0 ? selectedRecords.length : records.length;
    const effectiveExplorerYear = filters.year === 'all' ? explorerYear : filters.year;
    const effectiveExplorerPeriod = filters.period === 'all' ? explorerPeriod : filters.period as ReportExplorerPeriod;
    const reportPageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
    const visibleRecords = records.slice((reportPage - 1) * PAGE_SIZE, reportPage * PAGE_SIZE);
    const explorerRows = useMemo(() => explorerResults.reduce<Array<{
        result: ReportExplorerQueryResult;
        match: ReportExplorerMatch | null;
    }>>((rows, result) => [
        ...rows,
        ...(result.matches.length === 0
            ? [{ result, match: null }]
            : result.matches.map((match) => ({ result, match }))),
    ], []), [explorerResults]);
    const explorerPageCount = Math.max(1, Math.ceil(explorerRows.length / PAGE_SIZE));
    const visibleExplorerRows = explorerRows.slice((explorerPage - 1) * PAGE_SIZE, explorerPage * PAGE_SIZE);

    const cancelReportExplorerRequest = useCallback((notify = true) => {
        const controller = explorerAbortControllerRef.current;
        if (!controller) return false;

        controller.abort();
        explorerAbortControllerRef.current = null;
        setExplorerSearching(false);
        setExplorerOpeningResultId(null);
        if (notify) toast.info('보고서 탐색 요청을 취소했습니다.');
        return true;
    }, []);

    const createExplorerRequestController = useCallback(() => {
        cancelReportExplorerRequest(false);
        const controller = new AbortController();
        explorerAbortControllerRef.current = controller;
        return controller;
    }, [cancelReportExplorerRequest]);

    const updateExplorerHealth = useCallback(async () => {
        const controller = createExplorerRequestController();
        try {
            const health = await getReportExplorerHealth(controller.signal);
            if (explorerAbortControllerRef.current !== controller) return;
            setExplorerConnectionStatus(deriveReportExplorerConnectionStatus(health.issues, health.status === 'ok' && health.issues.length === 0));
            setExplorerMessage(health.issues.length > 0 ? health.message : null);
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            if (error instanceof ReportExplorerClientError) {
                setExplorerConnectionStatus(deriveReportExplorerConnectionStatus(error.issues, false));
                setExplorerMessage(error.message);
                return;
            }
            setExplorerConnectionStatus('disconnected');
            setExplorerMessage('보고서 탐색기 상태를 확인할 수 없습니다.');
        } finally {
            if (explorerAbortControllerRef.current === controller) explorerAbortControllerRef.current = null;
        }
    }, [createExplorerRequestController]);

    useEffect(() => {
        return () => {
            cancelReportExplorerRequest(false);
        };
    }, [cancelReportExplorerRequest]);

    const cancelActiveJob = useCallback(async () => {
        if (!activeJob) return;
        const label = activeJob.type === 'email' ? '이메일 전송' : 'K2B 업로드';
        if (!confirm(`진행 중인 ${label} 작업을 중단하시겠습니까?\n이미 처리된 항목은 되돌릴 수 없고, 남은 항목만 중단됩니다.`)) return;

        try {
            const res = await fetch('/api/report-processing/cancel-job', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jobId: activeJob.id })
            });
            const data = await res.json();
            if (res.ok && data.success) {
                toast.info(`[${label}] 중단 요청을 전달했습니다.`);
                if (data.status === 'cancelled') setActiveJob(null);
            } else {
                toast.error(data.error || '중단 요청을 전달하지 못했습니다.');
            }
        } catch {
            toast.error('중단 요청 중 서버 연결 오류가 발생했습니다.');
        }
    }, [activeJob]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            if (cancelReportExplorerRequest()) {
                event.preventDefault();
                return;
            }
            if (activeJob) {
                event.preventDefault();
                void cancelActiveJob();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [activeJob, cancelActiveJob, cancelReportExplorerRequest]);
    // 백그라운드 작업 상태 실시간 모니터링 헬퍼
    const monitorJob = (jobId: string, jobType: 'email' | 'k2b') => {
        const startTime = Date.now();
        let notifiedProcessing = false;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/report-processing/job-status?id=${jobId}`);
                if (!res.ok) return;

                const data = await res.json();
                const status = data.status;
                const errorMsg = data.errorMessage;

                // 1. 상태가 processing으로 전환되었을 때 알림
                if (status === 'processing' && !notifiedProcessing) {
                    toast.info(`[${jobType === 'email' ? '이메일' : 'K2B'}] 사내 PC에서 백그라운드 작업을 시작했습니다.`);
                    notifiedProcessing = true;
                }

                // 2. 완료 또는 실패 시 감시 종료 및 목록 새로고침
                if (status === 'success') {
                    toast.success(`[${jobType === 'email' ? '이메일' : 'K2B'}] 백그라운드 작업이 완료되었습니다.`);
                    clearInterval(interval);
                    setActiveJob(null);
                    fetchRecords(); // 목록 새로고침
                } else if (status === 'cancelled') {
                    toast.warning(`[${jobType === 'email' ? '이메일' : 'K2B'}] 사용자 요청으로 작업을 중단했습니다.`);
                    clearInterval(interval);
                    setActiveJob(null);
                    fetchRecords();
                } else if (status === 'failed') {
                    toast.error(`[${jobType === 'email' ? '이메일' : 'K2B'}] 백그라운드 작업 실패: ${errorMsg || '알 수 없는 오류'}`);
                    clearInterval(interval);
                    setActiveJob(null);
                    fetchRecords(); // 목록 새로고침
                }

                // 3. 1분이 지났는데도 여전히 pending 이면 미구동 경고
                const elapsedSeconds = (Date.now() - startTime) / 1000;
                if (status === 'pending' && elapsedSeconds >= 60) {
                    toast.error(
                        `[로컬 서버 미구동] 전송 요청이 접수되었으나 1분 동안 처리되지 않았습니다. 사내 로컬 컴퓨터의 개발 서버가 켜져 있는지 확인해 주세요.`,
                        { duration: 10000 }
                    );
                    clearInterval(interval);
                }

            } catch (err) {
                console.error("작업 상태 모니터링 오류:", err);
            }
        }, 5000);
    };

    // 메일 발송 처리 (합산 발송 로직 포함)
    const handleSendEmails = async () => {
        if (selectedKeys.length === 0) {
            toast.warning('발송할 항목을 선택해주세요.');
            return;
        }

        // 1. 선택된 레코드들 필터링 및 그룹화 로직
        const selectedRecords = records.filter(r => 
            selectedKeys.includes(`${r.code}-${r.year}-${r.period}`)
        );

        // 업체명 + 이메일 기준으로 그룹화하여 합산 발송 준비
        const groups: Record<string, { business_name: string; manager_email: string; reports: any[] }> = {};
        
        selectedRecords.forEach(r => {
            const groupKey = `${r.code}-${r.manager_email}`;
            if (!groups[groupKey]) {
                groups[groupKey] = {
                    business_name: r.business_name,
                    manager_email: r.manager_email,
                    reports: []
                };
            }
            groups[groupKey].reports.push({
                code: r.code,
                year: r.year,
                period: r.period,
                classification: r.classification
            });
        });

        const targetGroups = Object.values(groups);

        if (!confirm(`${targetGroups.length}개 업체에 보고서 메일을 백그라운드 전송하시겠습니까?\n(선택 항목: ${selectedRecords.length}개, 합산 발송 적용됨)`)) return;

        setProcessing(true);
        setProcessingMessage('전송 요청을 등록하는 중...');

        try {
            const res = await fetch('/api/report-processing/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_type: 'email',
                    targets: targetGroups
                })
            });

            const data = await res.json();

            if (res.ok && data.jobId) {
                toast.success('이메일 발송 요청이 등록되었습니다. 사내 로컬 컴퓨터에서 백그라운드로 발송됩니다.');
                setSelectedKeys([]);
                setActiveJob({ id: data.jobId, type: 'email' });
                // 백그라운드 모니터링 개시
                monitorJob(data.jobId, 'email');
            } else {
                toast.error(data.error || '이메일 발송 요청 등록 실패');
            }
        } catch (error) {
            toast.error('전송 요청 중 오류가 발생했습니다.');
        } finally {
            setProcessing(false);
            setProcessingMessage('');
        }
    };

    // 전체 선택/해제
    const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedKeys(records.map(r => `${r.code}-${r.year}-${r.period}`));
        } else {
            setSelectedKeys([]);
        }
    };

    const toggleOne = (key: string, checked: boolean) => {
        if (checked) {
            setSelectedKeys(prev => [...prev, key]);
        } else {
            setSelectedKeys(prev => prev.filter(k => k !== key));
        }
    };

    // K2B 업로드 처리 (선택 항목 전체 순차 업로드)
    const handleUploadK2B = async () => {
        if (selectedKeys.length === 0) {
            toast.warning('업로드할 항목을 선택해주세요.');
            return;
        }

        const targets = records.filter(r => 
            selectedKeys.includes(`${r.code}-${r.year}-${r.period}`)
        );

        const isConfirmed = confirm(`${targets.length}개 항목의 보고서를 K2B에 백그라운드로 자동 업로드하시겠습니까?`);
        if (!isConfirmed) return;

        setProcessing(true);
        setProcessingMessage('업로드 요청을 등록하는 중...');

        try {
            const res = await fetch('/api/report-processing/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_type: 'k2b',
                    targets
                })
            });

            const data = await res.json();

            if (res.ok && data.jobId) {
                toast.success('K2B 업로드 요청이 등록되었습니다. 사내 로컬 컴퓨터에서 자동 업로드가 실행됩니다.');
                setSelectedKeys([]);
                setActiveJob({ id: data.jobId, type: 'k2b' });
                // 백그라운드 모니터링 개시
                monitorJob(data.jobId, 'k2b');
            } else {
                toast.error(data.error || 'K2B 업로드 요청 등록 실패');
            }
        } catch (error: any) {
            toast.error('K2B 업로드 요청 중 오류가 발생했습니다.');
        } finally {
            setProcessing(false);
            setProcessingMessage('');
        }
    };

    const handleExplorerSearch = async () => {
        if (!effectiveExplorerYear || !effectiveExplorerPeriod) {
            toast.warning('보고서 탐색할 연도와 주기를 선택해주세요.');
            return;
        }
        const businessNames = collectReportExplorerBusinessNames({ useCurrentResults: true, records, selectedKeys, manualInput: manualExplorerNames });
        if (businessNames.length === 0) {
            toast.warning('현재 결과를 사용하거나 사업장명을 직접 입력해주세요.');
            return;
        }
        const controller = createExplorerRequestController();
        setExplorerSearching(true);
        setExplorerResults([]);
        setExplorerHasSearched(false);
        setExplorerMessage(null);
        try {
            const results = await searchReportExplorer({ year: Number(effectiveExplorerYear), period: effectiveExplorerPeriod, businessNames }, controller.signal);
            if (explorerAbortControllerRef.current !== controller) return;
            setExplorerResults(results);
            setExplorerHasSearched(true);
            setExplorerPage(1);
            setExplorerConnectionStatus('connected');
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            if (error instanceof ReportExplorerClientError) {
                setExplorerConnectionStatus(deriveReportExplorerConnectionStatus(error.issues, false));
                setExplorerMessage(error.message);
            } else {
                setExplorerConnectionStatus('disconnected');
                setExplorerMessage('보고서 탐색 중 알 수 없는 오류가 발생했습니다.');
            }
        } finally {
            if (explorerAbortControllerRef.current === controller) {
                explorerAbortControllerRef.current = null;
                setExplorerSearching(false);
            }
        }
    };

    const handleExplorerOpen = async (resultId: string) => {
        const controller = createExplorerRequestController();
        setExplorerOpeningResultId(resultId);
        setExplorerMessage(null);
        try {
            await openReportExplorerResult(resultId, controller.signal);
            if (explorerAbortControllerRef.current !== controller) return;
            setExplorerConnectionStatus('connected');
            toast.success('보고서 폴더를 열었습니다.');
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            if (error instanceof ReportExplorerClientError) {
                setExplorerConnectionStatus(deriveReportExplorerConnectionStatus(error.issues, false));
                setExplorerMessage(error.message);
            } else {
                setExplorerConnectionStatus('disconnected');
                setExplorerMessage('보고서 폴더를 열지 못했습니다.');
            }
        } finally {
            if (explorerAbortControllerRef.current === controller) {
                explorerAbortControllerRef.current = null;
                setExplorerOpeningResultId(null);
            }
        }
    };

    return (
        <div className="w-full min-w-0 max-w-[calc(100vw-2rem)] space-y-4 overflow-hidden p-4 md:p-6 lg:max-w-none">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h1 className="text-xl font-bold text-gray-800 md:text-2xl">작업환경측정결과 보고서 처리</h1>
                <div className="flex flex-wrap gap-2">
                    {activeJob && (
                        <Button size="sm" variant="secondary" onClick={cancelActiveJob} className="h-10 border-red-200 px-4 text-red-700 hover:bg-red-50">
                            <X className="w-4 h-4 mr-2" />
                            진행 작업 중단 (Esc)
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => fetchRecords(true)}
                        disabled={loading || refreshing}
                        className="h-10 px-4"
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        새로고침
                    </Button>
                    <Button
                        size="sm"
                        variant="primary"
                        onClick={handleSendEmails}
                        disabled={loading || selectedKeys.length === 0}
                        className="h-10 bg-blue-600 px-4 hover:bg-blue-700"
                    >
                        <Mail className="w-4 h-4 mr-2" />
                        이메일 합산 전송 ({selectedKeys.length})
                    </Button>
                    <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleUploadK2B}
                        disabled={loading || selectedKeys.length === 0}
                        className="h-10 px-4"
                    >
                        <Upload className="w-4 h-4 mr-2" />
                        K2B 업로드 ({selectedKeys.length})
                    </Button>
                </div>
            </div>

            <Card className="grid gap-3 p-4 md:grid-cols-[10rem_10rem_minmax(18rem,1fr)] md:items-end">
                <div>
                    <Select
                        label="년도"
                        value={filters.year}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, year: e.target.value }))}
                        className="h-10 py-0 text-sm"
                        options={[
                            { value: "all", label: "전체" },
                            { value: "2024", label: "2024년" },
                            { value: "2025", label: "2025년" },
                            { value: "2026", label: "2026년" },
                        ]}
                    />
                </div>
                <div>
                    <Select
                        label="주기"
                        value={filters.period}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, period: e.target.value }))}
                        className="h-10 py-0 text-sm"
                        options={[
                            { value: "all", label: "전체" },
                            { value: "상반기", label: "상반기" },
                            { value: "하반기", label: "하반기" },
                        ]}
                    />
                </div>
                <div className="flex min-w-0 items-end gap-2">
                    <div className="relative min-w-0 flex-1">
                        <Input
                            label="사업장 검색"
                            placeholder="업체명 또는 코드 (쉼표 구분 가능)"
                            value={filters.search}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    fetchRecords();
                                }
                            }}
                            className="h-10 pr-10 text-sm"
                        />
                        {filters.search && !loading && (
                            <button
                                onClick={() => {
                                    setFilters(prev => ({ ...prev, search: '' }));
                                    // 검색어가 비워지면 즉시 조회
                                    setTimeout(() => fetchRecords(), 0);
                                }}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-400 hover:text-text-600 transition-colors"
                                title="검색어 초기화"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                    <Button size="sm" className="h-10 shrink-0 px-4" onClick={() => fetchRecords(false)} variant="primary" disabled={loading || refreshing}>
                        {loading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Search className="w-4 h-4 mr-2" />
                        )}
                        검색
                    </Button>
                </div>
            </Card>

            <section aria-label="보고서 처리 결과" className="space-y-2">
                <Table className="min-w-[1000px] table-fixed text-sm">
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-11">
                                <Checkbox
                                    checked={selectedKeys.length === records.length && records.length > 0}
                                    onChange={toggleAll}
                                />
                            </TableHead>
                            <TableHead className="w-16 text-center">구분</TableHead>
                            <TableHead className="w-20 text-center">년도</TableHead>
                            <TableHead className="w-20 text-center">주기</TableHead>
                            <TableHead className="w-24">업체코드</TableHead>
                            <TableHead className="w-40">사업장명</TableHead>
                            <TableHead className="w-48">담당자 이메일</TableHead>
                            <TableHead className="w-44">이메일 발송 상태</TableHead>
                            <TableHead className="w-28">K2B 전송일자</TableHead>
                            <TableHead className="w-28">K2B 상태</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading && records.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-20 text-center">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                                </TableCell>
                            </TableRow>
                        ) : records.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={10} className="h-20 text-center text-muted-foreground">
                                    조회된 데이터가 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            visibleRecords.map((record: BusinessRecord) => {
                                const rowKey = `${record.code}-${record.year}-${record.period}`;
                                return (
                                    <TableRow key={rowKey} className="h-12">
                                        <TableCell className="px-4 py-2">
                                            <Checkbox
                                                checked={selectedKeys.includes(rowKey)}
                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleOne(rowKey, e.target.checked)}
                                            />
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className={`text-sm px-2 py-0.5 rounded-full font-medium ${
                                                record.classification === '정규' 
                                                ? 'bg-blue-100 text-blue-700' 
                                                : 'bg-gray-100 text-gray-600'
                                            }`}>
                                                {record.classification}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center text-sm">{record.year}년</TableCell>
                                        <TableCell className="text-center text-sm">{record.period}</TableCell>
                                        <TableCell className="font-mono text-sm">{record.code}</TableCell>
                                        <TableCell className="truncate font-medium" title={record.business_name}>{record.business_name}</TableCell>
                                        <TableCell className="text-sm truncate max-w-[200px]" title={record.manager_email}>
                                            {record.manager_email || <span className="text-red-400">정보없음</span>}
                                        </TableCell>
                                        <TableCell>
                                            {record.delivery_status === 'bounced' ? (
                                                <span className="text-red-600 text-sm font-semibold bg-red-50 px-2 py-1 rounded border border-red-200" title={record.delivery_error || '반송됨'}>
                                                    반송됨 (확인필요)
                                                </span>
                                            ) : record.is_email_sent ? (
                                                <span className="text-green-600 text-sm font-semibold bg-green-50 px-2 py-1 rounded border border-green-200">
                                                    발송완료 ({record.last_email_sent_at?.substring(5, 16)})
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground text-sm">미발송</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {record.k2b_send_date || '-'}
                                        </TableCell>
                                        <TableCell>
                                            {record.k2b_status ? (
                                                <span className={`text-sm font-semibold px-2 py-1 rounded border ${record.k2b_status === '정상처리'
                                                    ? 'text-green-600 bg-green-50 border-green-200'
                                                    : 'text-red-600 bg-red-50 border-red-200'
                                                    }`}>
                                                    {record.k2b_status === '정상처리' ? '성공' : '실패'}
                                                    {' '}({record.k2b_status})
                                                </span>
                                            ) : (
                                                <span className="text-muted-foreground text-sm">-</span>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
                {records.length > PAGE_SIZE && (
                    <div className="flex h-12 items-center justify-center gap-3" aria-label="보고서 처리 페이지">
                        <Button type="button" size="sm" variant="secondary" className="h-9 px-3" disabled={reportPage === 1} onClick={() => setReportPage((page) => page - 1)}>이전</Button>
                        <span className="min-w-20 text-center text-sm text-slate-600">{reportPage} / {reportPageCount}</span>
                        <Button type="button" size="sm" variant="secondary" className="h-9 px-3" disabled={reportPage === reportPageCount} onClick={() => setReportPage((page) => page + 1)}>다음</Button>
                    </div>
                )}
            </section>

            <Card className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <h2 className="text-base font-bold text-slate-800">보고서 탐색기</h2>
                        <span className="text-sm text-slate-500">
                            {effectiveExplorerYear ? `${effectiveExplorerYear}년` : '연도 선택 필요'} · {effectiveExplorerPeriod || '주기 선택 필요'} | {selectedRecords.length > 0 ? `선택 ${explorerBasisCount}건` : `결과 ${explorerBasisCount}건`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className={`rounded-full border px-2 py-1 font-medium ${reportExplorerConnectionStatusClass(explorerConnectionStatus)}`}>{reportExplorerConnectionStatusLabel(explorerConnectionStatus)}</span>
                        <Button type="button" variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => void updateExplorerHealth()} disabled={explorerSearching || explorerOpeningResultId !== null}>연결 확인</Button>
                    </div>
                </div>
                {explorerMessage && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{explorerMessage}</p>}
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(18rem,1fr)_auto_auto] md:items-end">
                        <Input
                            id="report-explorer-manual-names"
                            label="추가 사업장명"
                            value={manualExplorerNames}
                            onChange={(event) => setManualExplorerNames(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void handleExplorerSearch();
                                }
                            }}
                            placeholder="쓰리디, 보스턴, 대흥산업"
                            className="h-10 text-sm"
                        />
                        {filters.year === 'all' && <Select label="탐색 연도" value={explorerYear} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => setExplorerYear(event.target.value)} className="h-10 py-0 text-sm md:w-36" options={[{ value: '', label: '연도 선택' }, { value: '2024', label: '2024년' }, { value: '2025', label: '2025년' }, { value: '2026', label: '2026년' }]} />}
                        {filters.period === 'all' && <Select label="탐색 주기" value={explorerPeriod} onChange={(event: React.ChangeEvent<HTMLSelectElement>) => { const period = event.target.value; setExplorerPeriod(period === '상반기' || period === '하반기' ? period : ''); }} className="h-10 py-0 text-sm md:w-36" options={[{ value: '', label: '주기 선택' }, { value: '상반기', label: '상반기' }, { value: '하반기', label: '하반기' }]} />}
                    </div>
                    <Button type="button" size="sm" className="h-10 w-full px-4 md:w-auto" variant="primary" onClick={() => void handleExplorerSearch()} disabled={explorerSearching || explorerOpeningResultId !== null}>
                        {explorerSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderSearch className="mr-2 h-4 w-4" />} 보고서 폴더 검색
                    </Button>
                </div>
                <div className="space-y-2">
                    <Table className="min-w-[820px] table-fixed text-sm">
                        <TableHeader><TableRow><TableHead className="w-48">검색 사업장</TableHead><TableHead className="w-64">일치 사업장 폴더</TableHead><TableHead>경로</TableHead><TableHead className="w-28 text-center">상태</TableHead><TableHead className="w-24 text-center">동작</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {explorerRows.length === 0 ? (
                                <TableRow className="h-12">
                                    <TableCell colSpan={5} className="px-4 py-2 text-left text-muted-foreground sm:text-center">
                                        {explorerHasSearched ? '일치하는 보고서 폴더가 없습니다.' : '보고서 폴더를 검색해주세요.'}
                                    </TableCell>
                                </TableRow>
                            ) : visibleExplorerRows.map(({ result, match }) => (
                                <TableRow key={match?.resultId ?? `${result.query}-${result.status}`} className="h-12">
                                    <TableCell className="truncate px-4 py-2 font-medium" title={result.query}>{result.query}</TableCell>
                                    <TableCell className="truncate px-4 py-2" title={match?.folderName}>{match?.folderName ?? '-'}</TableCell>
                                    <TableCell className="truncate px-4 py-2" title={match?.path}>{match?.path ?? '-'}</TableCell>
                                    <TableCell className="px-4 py-2 text-center"><span className={`inline-flex h-7 items-center rounded-full border px-2 text-xs font-medium ${result.status === 'FOUND' ? 'border-green-200 bg-green-50 text-green-700' : result.status === 'MULTIPLE' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>{reportExplorerStatusLabel(result.status)}</span></TableCell>
                                    <TableCell className="px-4 py-2 text-center">{match ? <Button type="button" variant="secondary" size="sm" className="h-8 px-3 text-xs" onClick={() => void handleExplorerOpen(match.resultId)} disabled={explorerOpeningResultId !== null || explorerSearching}>{explorerOpeningResultId === match.resultId ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ExternalLink className="mr-1 h-4 w-4" />열기</>}</Button> : '-'}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    {explorerRows.length > PAGE_SIZE && (
                        <div className="flex h-12 items-center justify-center gap-3" aria-label="보고서 탐색 결과 페이지">
                            <Button type="button" size="sm" variant="secondary" className="h-9 px-3" disabled={explorerPage === 1} onClick={() => setExplorerPage((page) => page - 1)}>이전</Button>
                            <span className="min-w-20 text-center text-sm text-slate-600">{explorerPage} / {explorerPageCount}</span>
                            <Button type="button" size="sm" variant="secondary" className="h-9 px-3" disabled={explorerPage === explorerPageCount} onClick={() => setExplorerPage((page) => page + 1)}>다음</Button>
                        </div>
                    )}
                </div>
            </Card>

            {/* 작업 오버레이 */}
            {processing && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center">
                    <div className="bg-white p-8 rounded-xl shadow-2xl border flex flex-col items-center space-y-4 max-w-sm w-full mx-4">
                        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                        <div className="text-center">
                            <h3 className="text-lg font-bold text-gray-900">처리 중</h3>
                            <p className="text-sm text-gray-500 mt-1">{processingMessage}</p>
                        </div>
                        <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                            <div className="bg-blue-600 h-full animate-progress-indeterminate"></div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}





