'use client';

import React, { useState, useEffect } from 'react';
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
import { toast } from 'sonner';
import { Loader2, Mail, Upload, Search, RefreshCw, X } from 'lucide-react';

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
}

export default function ReportProcessingPage() {
    const [loading, setLoading] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [processingMessage, setProcessingMessage] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [records, setRecords] = useState<BusinessRecord[]>([]);
    const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
    const [filters, setFilters] = useState({
        year: new Date().getFullYear().toString(),
        period: '상반기',
        search: ''
    });

    // 데이터 조회
    const fetchRecords = async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        try {
            const res = await fetch(`/api/report-processing?year=${filters.year}&period=${filters.period}&search=${filters.search}`);
            const data = await res.json();
            if (res.ok) {
                setRecords(data.records);
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
        fetchRecords();
    }, [filters.year, filters.period]);

    // 메일 발송 처리
    const handleSendEmails = async () => {
        if (selectedCodes.length === 0) {
            toast.warning('발송할 업체를 선택해주세요.');
            return;
        }

        const targets = records.filter(r => selectedCodes.includes(r.code));

        if (!confirm(`${targets.length}개 업체에 보고서 이메일을 전송하시겠습니까?`)) return;

        setProcessing(true);
        setProcessingMessage('이메일을 전송하고 있습니다...');
        try {
            const res = await fetch('/api/report-processing/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targets })
            });
            const data = await res.json();

            if (res.ok) {
                toast.success(data.message);
                fetchRecords(); // 상태 갱신
                setSelectedCodes([]);
            } else {
                toast.error(data.error || '전송 실패');
            }
        } catch (error) {
            toast.error('전송 중 서버 오류');
        } finally {
            setProcessing(false);
            setProcessingMessage('');
        }
    };

    // 전체 선택/해제
    const toggleAll = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedCodes(records.map(r => r.code));
        } else {
            setSelectedCodes([]);
        }
    };

    const toggleOne = (code: string, checked: boolean) => {
        if (checked) {
            setSelectedCodes(prev => [...prev, code]);
        } else {
            setSelectedCodes(prev => prev.filter(c => c !== code));
        }
    };

    // K2B 업로드 처리
    const handleUploadK2B = async () => {
        console.log('[K2B Upload] Request started', { selectedCodes });

        if (selectedCodes.length === 0) {
            toast.warning('업로드할 업체를 선택해주세요.');
            return;
        }

        const targets = records.filter(r => selectedCodes.includes(r.code));
        console.log('[K2B Upload] Targets filtered', targets);

        const isConfirmed = confirm(`${targets.length}개 업체의 보고서를 K2B에 자동 업로드하시겠습니까?`);
        console.log('[K2B Upload] User confirmation:', isConfirmed);

        if (!isConfirmed) return;

        setProcessing(true);
        setProcessingMessage('K2B 업로드를 진행하고 있습니다. 브라우저 창을 닫지 마세요...');

        try {
            console.log('[K2B Upload] Calling API /api/report-processing/upload-k2b');
            const res = await fetch('/api/report-processing/upload-k2b', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ targets })
            });

            console.log('[K2B Upload] API Response status:', res.status);
            const data = await res.json();
            console.log('[K2B Upload] API Response data:', data);

            if (res.ok) {
                toast.success(data.message || 'K2B 업로드 완료');
                fetchRecords(); // 상태 갱신
                setSelectedCodes([]);
            } else {
                toast.error(data.error || 'K2B 업로드 실패');
            }
        } catch (error: any) {
            console.error('[K2B Upload] Critical Error:', error);
            toast.error('K2B 업로드 중 서버 오류가 발생했습니다.');
        } finally {
            setProcessing(false);
            setProcessingMessage('');
        }
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">작업환경측정결과 보고서 처리</h1>
                <div className="flex gap-2">
                    <Button
                        variant="primary"
                        onClick={() => fetchRecords(true)}
                        disabled={loading || refreshing}
                    >
                        <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                        새로고침
                    </Button>
                    <Button
                        variant="primary"
                        onClick={handleSendEmails}
                        disabled={loading || selectedCodes.length === 0}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        <Mail className="w-4 h-4 mr-2" />
                        이메일 전송 ({selectedCodes.length})
                    </Button>
                    <Button
                        variant="secondary"
                        onClick={handleUploadK2B}
                        disabled={loading || selectedCodes.length === 0}
                    >
                        <Upload className="w-4 h-4 mr-2" />
                        K2B 업로드 ({selectedCodes.length})
                    </Button>
                </div>
            </div>

            {/* 필터 영역 */}
            <div className="flex gap-4 p-4 bg-white rounded-lg shadow-sm border">
                <div className="w-48">
                    <Select
                        label="년도"
                        value={filters.year}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, year: e.target.value }))}
                        options={[
                            { value: "2024", label: "2024년" },
                            { value: "2025", label: "2025년" },
                            { value: "2026", label: "2026년" },
                        ]}
                    />
                </div>
                <div className="w-48">
                    <Select
                        label="반기"
                        value={filters.period}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilters(prev => ({ ...prev, period: e.target.value }))}
                        options={[
                            { value: "상반기", label: "상반기" },
                            { value: "하반기", label: "하반기" },
                        ]}
                    />
                </div>
                <div className="flex items-end gap-2">
                    <div className="relative w-80">
                        <Input
                            placeholder="업체명 또는 코드 검색 (쉼표 구분 가능)..."
                            value={filters.search}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    fetchRecords();
                                }
                            }}
                            className="pr-10"
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
                    <Button onClick={() => fetchRecords(false)} variant="primary" disabled={loading || refreshing}>
                        {loading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                            <Search className="w-4 h-4 mr-2" />
                        )}
                        검색
                    </Button>
                </div>
            </div>

            {/* 리스트 영역 */}
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[50px]">
                                <Checkbox
                                    checked={selectedCodes.length === records.length && records.length > 0}
                                    onChange={toggleAll}
                                />
                            </TableHead>
                            <TableHead>업체코드</TableHead>
                            <TableHead>사업장명</TableHead>
                            <TableHead>담당자 이메일</TableHead>
                            <TableHead>이메일 발송상태</TableHead>
                            <TableHead>K2B 전송일자</TableHead>
                            <TableHead>K2B 상태</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading && records.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-10">
                                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" />
                                </TableCell>
                            </TableRow>
                        ) : records.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                                    조회된 데이터가 없습니다.
                                </TableCell>
                            </TableRow>
                        ) : (
                            records.map((record: BusinessRecord) => (
                                <TableRow key={record.code}>
                                    <TableCell>
                                        <Checkbox
                                            checked={selectedCodes.includes(record.code)}
                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleOne(record.code, e.target.checked)}
                                        />
                                    </TableCell>
                                    <TableCell className="font-mono text-xs">{record.code}</TableCell>
                                    <TableCell className="font-medium">{record.business_name}</TableCell>
                                    <TableCell className="text-sm truncate max-w-[200px]" title={record.manager_email}>
                                        {record.manager_email || <span className="text-red-400">정보없음</span>}
                                    </TableCell>
                                    <TableCell>
                                        {record.is_email_sent ? (
                                            <span className="text-green-600 text-xs font-semibold bg-green-50 px-2 py-1 rounded border border-green-200">
                                                발송완료 ({record.last_email_sent_at?.substring(5, 16)})
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">미발송</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-xs">
                                        {record.k2b_send_date || '-'}
                                    </TableCell>
                                    <TableCell>
                                        {record.k2b_status ? (
                                            <span className={`text-xs font-semibold px-2 py-1 rounded border ${['업로드 완료', '정상처리'].includes(record.k2b_status)
                                                    ? 'text-green-600 bg-green-50 border-green-200'
                                                    : 'text-red-600 bg-red-50 border-red-200'
                                                }`}>
                                                {['업로드 완료', '정상처리'].includes(record.k2b_status) ? '성공' : '실패'}
                                                {' '}({record.k2b_status})
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">-</span>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>

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
