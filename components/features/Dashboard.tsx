"use client";

import React, { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/Table";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { Alert } from "@/components/ui/Alert";
import { Select } from "@/components/ui/Select";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  Line, ComposedChart
} from "recharts";
import { Banknote, TrendingUp, ClipboardCheck, Send, AlertTriangle, Phone, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/Modal";


interface DashboardData {
  totalCount: number;
  incompleteCount: number;
  completeCount: number;
  completionRate: number;
  executionStats?: {
    total: number;
    executed: number;
    rate: number;
  };
  revenue: {
    measurementFee: number;
    otherRevenue: number;
    total: number;
    deposit: number;
    depositRate: number;
  };
  periodStats: {
    상반기: { total: number; complete: number; incomplete: number };
    하반기: { total: number; complete: number; incomplete: number };
  };
  nationalSupport: {
    지원: number;
    비대상: number;
    전체: number;
  };
  overdueItems: Array<{
    id: number;
    business_name: string;
    measurement_end_date: string;
    elapsed_days: number;
    remaining_days: number;
    status_prediction: string;
    measurer: string;
  }>;
  k2bStats: {
    전송완료: number;
    미전송: number;
  };
  countTrend: Array<{
    year: number;
    period: string;
    count: number;
  }>;
  averageMeasurementDays: number;
  revenueTrend: {
    yearly: Array<{
      year: number;
      amount: number;
    }>;
    monthly: Array<{
      month: string;
      current: number | null;
      previous: number;
    }>;
    comparisonYear: number;
    prevYear: number;
  };
  officeRevenue: Array<{
    office: string;
    amount: number;
  }>;
  periodRevenue: Array<{
    period: string;
    amount: number;
  }>;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#6366f1'];
const STATUS_COLORS = { complete: '#10b981', incomplete: '#f59e0b' };

export const Dashboard: React.FC<{ year: string; period: string }> = ({ year, period }) => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 계산서 발행 현황 데이터 상태
  const [invoiceStatusData, setInvoiceStatusData] = useState<any[]>([]);
  const [invoiceLoading, setInvoiceLoading] = useState(false);

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedManagerData, setSelectedManagerData] = useState<any>(null);
  const [selectedBusinessCode, setSelectedBusinessCode] = useState<string | null>(null);

  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        if (year !== "전체") params.append("year", year);
        if (period !== "전체") params.append("period", period);

        const response = await fetch(`/api/dashboard?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          let errorMessage = `서버 오류 (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorData.details || errorMessage;
          } catch (jsonError) {
            // Ignore
          }
          setError(errorMessage);
          setLoading(false);
          return;
        }

        const result = await response.json();
        setData(result);
        setLoading(false);
      } catch (err: any) {
        console.error("대시보드 데이터 로드 오류:", err);
        setError(err.message || "대시보드 데이터를 불러오는 중 오류가 발생했습니다.");
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [year, period]);

  // 계산서 발행 현황 데이터 로드
  useEffect(() => {
    const loadInvoiceStatus = async () => {
      try {
        setInvoiceLoading(true);
        const params = new URLSearchParams();
        if (year !== "전체") params.append("year", year);
        if (period !== "전체") params.append("period", period);

        const response = await fetch(`/api/dashboard/invoice-status?${params.toString()}`);
        if (response.ok) {
          const result = await response.json();
          setInvoiceStatusData(result.data || []);
        }
      } catch (err) {
        console.error("계산서 현황 로드 오류:", err);
      } finally {
        setInvoiceLoading(false);
      }
    };

    loadInvoiceStatus();
  }, [year, period]);

  const handleBarClick = (entry: any) => {
    if (entry && entry.unissued_list && entry.unissued_list.length > 0) {
      setSelectedManagerData(entry);
      setIsModalOpen(true);
    }
  };

  const formatCurrency = (amount: number | null | undefined): string => {
    const numAmount = amount ?? 0;
    // 억/만 단위 간소화 (그래프용)
    if (numAmount >= 100000000) {
      return (numAmount / 100000000).toFixed(1) + "억";
    } else if (numAmount >= 10000) {
      return (numAmount / 10000).toFixed(0) + "만";
    }
    return new Intl.NumberFormat("ko-KR").format(numAmount);
  };

  const formatFullCurrency = (amount: number | null | undefined): string => {
    const numAmount = amount ?? 0;
    return new Intl.NumberFormat("ko-KR").format(numAmount);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <Alert variant="error">{error}</Alert>;
  }

  if (!data) {
    return <Alert variant="error">데이터를 불러올 수 없습니다.</Alert>;
  }

  // 차트 데이터 준비
  const pieData = data.officeRevenue.map(item => ({ name: item.office, value: item.amount }));
  const periodBarData = [
    {
      name: "상반기",
      완료: data.periodStats.상반기.complete,
      미완료: data.periodStats.상반기.incomplete,
      total: data.periodStats.상반기.total
    },
    {
      name: "하반기",
      완료: data.periodStats.하반기.complete,
      미완료: data.periodStats.하반기.incomplete,
      total: data.periodStats.하반기.total
    }
  ];


  return (
    <div className="space-y-6">
      {/* 1. 핵심 지표 (KPI) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPIButton
          title="총 매출"
          value={`${formatFullCurrency(data.revenue.total)}원`}
          subValue={`목표 대비 ${data.revenue.total > 0 ? '달성중' : '-'}`}
          icon={<Banknote className="w-6 h-6" />}
          color="blue"
        />
        <KPIButton
          title="입금률"
          value={`${data.revenue.depositRate.toFixed(1)}%`}
          subValue={`미수금 ${formatCurrency(data.revenue.total - data.revenue.deposit)}원`}
          icon={<TrendingUp className="w-6 h-6" />}
          color={data.revenue.depositRate >= 80 ? "green" : "orange"}
        />
        <KPIButton
          title="실시율"
          value={`${data.executionStats?.rate.toFixed(1) || "0.0"}%`}
          subValue={`실시 ${data.executionStats?.executed || 0} / 전체 ${data.executionStats?.total || 0}`}
          icon={<ClipboardCheck className="w-6 h-6" />}
          color={data.executionStats && data.executionStats.rate >= 80 ? "green" : "blue"}
        />
        <KPIButton
          title="측정 완료율"
          value={`${data.completionRate.toFixed(1)}%`}
          subValue={`전송완료 ${data.completeCount} / 전체 ${data.totalCount}`}
          icon={<Send className="w-6 h-6" />}
          color={data.completionRate >= 80 ? "green" : "purple"}
        />
      </div>

      {/* 2. 메인 차트: 매출 추이 & 지청별 비중 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 월별 매출 추이 (비교 그래프) */}
        <Card className="col-span-2 p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-800">
              월별 매출 추이 ({data.revenueTrend.comparisonYear} vs {data.revenueTrend.prevYear})
            </h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.revenueTrend.monthly} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="month" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCurrency} />
                <Tooltip
                  formatter={(value: any, name: any) => [
                    `${formatFullCurrency(value)}원`,
                    name === "current" ? `${data.revenueTrend.comparisonYear}년` : `${data.revenueTrend.prevYear}년`
                  ]}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <Legend formatter={(value) => value === "current" ? `${data.revenueTrend.comparisonYear}년 (현재)` : `${data.revenueTrend.prevYear}년 (이전)`} />

                {/* 이전 년도: 점선 Line */}
                <Line type="monotone" dataKey="previous" stroke="#9ca3af" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 4, fill: '#9ca3af' }} name="previous" />

                {/* 현재 년도: 영역 Area */}
                <Area type="monotone" dataKey="current" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorCurrent)" dot={{ r: 4, fill: '#3b82f6' }} name="current" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 지청별 매출 비중 */}
        <Card className="p-6 shadow-sm">
          <h3 className="text-lg font-bold text-gray-800 mb-6">지청별 매출 비중</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `${formatFullCurrency(value)}원`} />
                <Legend content={renderCustomizedLegend} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* 3. 하단 차트: 완료 현황 & 테이블 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-800">계산서 발행 현황</h3>
            <span className="text-xs text-text-400">계획담당자 기준 (클릭 시 미발행 목록 표시)</span>
          </div>
          <div className="h-[300px] w-full">
            {invoiceLoading ? (
              <div className="flex justify-center items-center h-full">
                <LoadingSpinner />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={invoiceStatusData}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                  <XAxis type="number" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" fontSize={14} width={60} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                  <Bar
                    name="발행 완료"
                    dataKey="issued"
                    stackId="a"
                    fill="#10b981"
                    radius={[0, 0, 0, 0]}
                    barSize={30}
                    style={{ cursor: 'pointer' }}
                    onClick={(data) => handleBarClick(data)}
                    activeBar={{ fillOpacity: 0.8, stroke: '#fff', strokeWidth: 1 }}
                  />
                  <Bar
                    name="미발행 (일지등록)"
                    dataKey="unissued_registered"
                    stackId="a"
                    fill="#f59e0b"
                    radius={[0, 0, 0, 0]}
                    barSize={30}
                    style={{ cursor: 'pointer' }}
                    onClick={(data) => handleBarClick(data)}
                    activeBar={{ fillOpacity: 0.8, stroke: '#fff', strokeWidth: 1 }}
                  />
                  <Bar
                    name="미발행 (일지미등록)"
                    dataKey="unissued_unregistered"
                    stackId="a"
                    fill="#ef4444"
                    radius={[0, 4, 4, 0]}
                    barSize={30}
                    style={{ cursor: 'pointer' }}
                    onClick={(data) => handleBarClick(data)}
                    activeBar={{ fillOpacity: 0.8, stroke: '#fff', strokeWidth: 1 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* 측정 경과 일수(K2B 전송 잔여일수) 현황 */}
        <Card className="p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-red-500 animate-pulse" />
            <h3 className="text-lg font-bold text-gray-800">측정 경과 일수(측정종료일 기준 20일 경과만 표시)</h3>
            <span className="text-xs text-gray-500 font-normal ml-auto">기준: 측정종료일 포함 30일</span>
          </div>
          <div className="relative border rounded-md">
            <Table maxHeight="max-h-[600px]">
              <TableHeader className="bg-sky-100 border-b-2 border-sky-200 z-20 text-black font-bold">
                <TableRow className="border-b border-sky-200 hover:bg-transparent">
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[5%] text-center">No</TableHead>
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[20%]">사업장명</TableHead>
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[10%]">보고서 담당자</TableHead>
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[15%]">측정종료일</TableHead>
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[10%]">경과일수</TableHead>
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[10%] transition-colors">잔여일수</TableHead>
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[15%]">K2B전송일</TableHead>
                  <TableHead className="sticky top-0 bg-sky-100 z-20 text-xs font-bold text-black h-10 w-[15%]">처리결과</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.overdueItems.map((item) => (
                  <TableRow key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-blue-50/40 group relative growable-row transition-colors">
                    <TableCell className="text-sm font-medium text-slate-700 py-3 text-center relative">
                      {/* 표준 블루 인디케이터 바 */}
                      <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                      {item.id % 100} {/* 순번 가공 예시 */}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-gray-700 py-3 truncate max-w-[150px]" title={item.business_name}>{item.business_name}</TableCell>
                    <TableCell className="text-sm text-gray-600 py-3">{item.measurer}</TableCell>
                    <TableCell className="text-sm text-gray-600 py-3">
                      {new Date(item.measurement_end_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-gray-600 py-3">
                      {item.elapsed_days}일
                    </TableCell>
                    <TableCell className={`text-sm font-bold py-3 ${item.remaining_days >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      {item.remaining_days >= 0 ? `-${item.remaining_days}일` : `+${Math.abs(item.remaining_days)}일`}
                    </TableCell>
                    <TableCell className="text-sm text-gray-400 py-3">-</TableCell>
                    <TableCell className="py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${item.status_prediction === "적합"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                        }`}>
                        {item.status_prediction}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
                {data.overdueItems.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-gray-400 py-8">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-2xl">✓</span>
                        <span>미처리된 K2B 전송 건이 없습니다. (최근 20일 이상 경과 건 없음)</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

        </Card>
      </div >

      {/* 계산서 미발행 업체 목록 모달 */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${selectedManagerData?.name || ''} 담당 미발행 업체 목록 (계산서 미발행 ${selectedManagerData?.unissued_registered || 0}건, 일지 미등록 ${selectedManagerData?.unissued_unregistered || 0}건)`}
        size="2xl"
        resizable={true}
      >
        <div className="space-y-4 pt-4">
          <div className="border rounded-xl overflow-hidden shadow-sm bg-white">
            <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
              <Table>
                <TableHeader className="bg-sky-100 border-b-2 border-sky-200 sticky top-0 z-20">
                  <TableRow className="border-b border-sky-200">
                    <TableHead className="font-bold text-black h-11 min-w-[250px] pl-6 text-sm">업체명</TableHead>
                    <TableHead className="font-bold text-black text-center h-11 w-[120px] text-sm">K2B 전송 여부</TableHead>
                    <TableHead className="font-bold text-black text-center h-11 w-[160px] text-sm">상태</TableHead>
                    <TableHead className="font-bold text-black text-center h-11 w-[100px] text-sm">담당자</TableHead>
                    <TableHead className="font-bold text-black text-center h-11 w-[150px] text-sm">연락처</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...(selectedManagerData?.unissued_list || [])]
                    .sort((a, b) => {
                      if (a.status === "일지등록/계산서미발행" && b.status !== "일지등록/계산서미발행") return -1;
                      if (a.status !== "일지등록/계산서미발행" && b.status === "일지등록/계산서미발행") return 1;
                      return 0;
                    })
                    .map((company: any, idx: number) => {
                      const isSelected = selectedBusinessCode === company.code;
                      return (
                        <TableRow
                          key={idx}
                          className={cn(
                            "hover:bg-blue-50/40 transition-colors group relative cursor-pointer",
                            isSelected && "bg-blue-50/60"
                          )}
                          onClick={() => setSelectedBusinessCode(company.code)}
                        >
                          <TableCell className="font-medium text-slate-800 py-2.5 pl-6 relative">
                            {/* 표준 블루 인디케이터 바 */}
                            <div className={cn(
                              "absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm transition-all duration-200 origin-center pointer-events-none",
                              isSelected ? "opacity-100 scale-y-100" : "opacity-0 scale-y-0 group-hover:opacity-100 group-hover:scale-y-100"
                            )} />

                             <div className="flex items-center gap-2.5">
                               <div className={`w-1.5 h-1.5 rounded-full ${company.status === "일지등록/계산서미발행" ? "bg-amber-400" : "bg-rose-400"}`} />
                               <span
                                 className="text-primary-600 hover:text-primary-700 hover:underline cursor-pointer transition-colors block truncate max-w-[300px] font-bold"
                                 title={`${company.business_name} ${company.period ? `(${company.period})` : ''} - 클릭 시 측정일지로 이동하며 즉시 수정 창이 뜹니다.`}
                                 onClick={(e) => {
                                   e.stopPropagation();
                                   const searchYear = year === "전체" ? (company.period?.match(/\d{4}년/)?.[0]?.replace('년', '') || "") : year;
                                   const searchPeriod = company.period?.includes("상반기") ? "상반기" : (company.period?.includes("하반기") ? "하반기" : "");
                                   window.open(`/journal?code=${company.code}&businessName=${encodeURIComponent(company.business_name)}&year=${searchYear}&period=${searchPeriod}&autoOpen=true`, '_blank');
                                 }}
                               >
                                 {company.business_name}
                                 {company.period && (
                                   <span className="ml-1 text-[10px] text-slate-400 font-normal">
                                     ({company.period})
                                   </span>
                                 )}
                               </span>
                             </div>
                          </TableCell>
                          <TableCell className="text-center py-2.5 w-[120px]">
                            <span className={cn(
                              "inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold border",
                              company.k2b_send_date
                                ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                                : "bg-slate-50 text-slate-400 border-slate-100"
                            )}>
                              {company.k2b_send_date ? "완료" : "미완료"}
                            </span>
                          </TableCell>
                          <TableCell className="text-center py-2.5 w-[160px]">
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-bold ${company.status === "일지등록/계산서미발행"
                              ? "bg-amber-100 text-amber-700 border border-amber-200"
                              : "bg-rose-100 text-rose-700 border border-rose-200"
                              }`}>
                              {company.status}
                            </span>
                          </TableCell>
                          <TableCell className="text-center text-slate-600 text-sm py-2.5 w-[100px]">{company.manager_name || '-'}</TableCell>
                          <TableCell className="text-center py-2.5 w-[150px]">
                            <span className="text-slate-600 text-sm font-medium whitespace-nowrap">
                              {company.manager_mobile || '-'}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      </Modal>
    </div >
  );
};

// 보조 컴포넌트들 (KPIButton, Legend)
const KPIButton = ({ title, value, subValue, icon, color }: { title: string, value: string, subValue: string, icon: React.ReactNode, color: string }) => {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    green: "bg-emerald-50 text-emerald-600 border-emerald-100",
    orange: "bg-amber-50 text-amber-600 border-amber-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100",
    red: "bg-rose-50 text-rose-600 border-rose-100",
  };

  const activeColor = colorMap[color] || colorMap.blue;

  return (
    <Card className="p-5 shadow-sm hover:shadow-md transition-shadow duration-200 border-l-4 border-l-transparent hover:border-l-primary-500">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-text-500 mb-1">{title}</p>
          <h3 className="text-2xl font-bold text-text-900">{value}</h3>
          <p className="text-xs text-text-400 mt-2">{subValue}</p>
        </div>
        <div className={`p-3 rounded-xl ${activeColor} transition-transform hover:scale-110`}>
          {icon}
        </div>
      </div>
    </Card>
  );
};

const renderCustomizedLegend = (props: any) => {
  const { payload } = props;
  return (
    <ul className="flex flex-wrap justify-center gap-2 mt-4 text-xs">
      {payload.map((entry: any, index: number) => (
        <li key={`item-${index}`} className="flex items-center gap-1 text-gray-600">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span>{entry.value}</span>
        </li>
      ))}
    </ul>
  );
};
