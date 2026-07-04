"use client";

import React, { useState, useEffect } from "react";
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

interface SampleDashboardData {
  totalCount: number;
  incompleteCount: number;
  completeCount: number;
  completionRate: number;
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
  recentActivity: Array<{
    id: number;
    business_name: string;
    completion_status: string;
    created_at: string;
    updated_at: string;
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
      amount: number;
    }>;
  };
  officeRevenue: Array<{
    office: string;
    amount: number;
  }>;
  periodRevenue: Array<{
    period: string;
    amount: number;
  }>;
  newBusinessStats: {
    total: number;
    newCount: number;
    rate: number;
    list: Array<{
      code: string;
      business_name: string;
      period: string;
      designated_office: string;
      manager_name: string;
      manager_mobile: string;
    }>;
  };
}

export const DashboardSample: React.FC = () => {
  const [data, setData] = useState<SampleDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSampleData();
  }, []);

  const loadSampleData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/dashboard/sample", {
        cache: "no-store",
      });

      // 응답이 성공이 아니면 에러 처리
      if (!response.ok) {
        let errorMessage = `서버 오류 (${response.status})`;
        try {
          // JSON 응답 시도
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorData.details || errorMessage;
        } catch (jsonError) {
          // JSON이 아니면 텍스트로 읽기 시도
          try {
            const text = await response.text();
            if (text && text.length > 0) {
              errorMessage = text.substring(0, 200); // 너무 길면 잘라내기
            }
          } catch (textError) {
            // 읽기 실패 시 기본 메시지 사용
            console.error("응답 읽기 실패:", textError);
          }
        }
        console.error("샘플 대시보드 API 오류:", {
          status: response.status,
          statusText: response.statusText,
          errorMessage,
        });
        setError(errorMessage);
        setLoading(false);
        return;
      }

      // 성공 응답 파싱
      const result = await response.json();
      setData(result);
      setLoading(false);
    } catch (err: any) {
      console.error("샘플 대시보드 데이터 로드 오류:", err);
      setError(err.message || "샘플 대시보드 데이터를 불러오는 중 오류가 발생했습니다.");
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number | null | undefined): string => {
    const numAmount = amount ?? 0;
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: "KRW",
    })
      .format(numAmount)
      .replace("₩", "")
      .trim();
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

  return (
    <div className="space-y-4">
      {/* 주요 지표 카드 섹션 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">전체 측정건수</h3>
          <p className="text-2xl font-bold text-text-900">{data.totalCount}건</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">완료 건수</h3>
          <p className="text-2xl font-bold text-primary-600">{data.completeCount}건</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">미완료 건수</h3>
          <p className="text-2xl font-bold text-warning-600">{data.incompleteCount}건</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">K2B 전송율</h3>
          <p className="text-2xl font-bold text-success-600">{data.completionRate.toFixed(1)}%</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">신규사업장 발굴률(건설업 제외)</h3>
          <p className="text-2xl font-bold text-success-600">{data.newBusinessStats?.rate.toFixed(1) || "0.0"}%</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">측정비 매출</h3>
          <p className="text-lg font-bold text-text-900">
            {formatCurrency(data.revenue.measurementFee)}원
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">기타 매출</h3>
          <p className="text-lg font-bold text-text-900">
            {formatCurrency(data.revenue.otherRevenue)}원
          </p>
        </Card>
      </div>

      {/* 재무 지표 카드 섹션 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">총 매출</h3>
          <p className="text-lg font-bold text-primary-600">
            {formatCurrency(data.revenue.total)}원
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">총 입금액</h3>
          <p className="text-lg font-bold text-success-600">
            {formatCurrency(data.revenue.deposit)}원
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">입금률</h3>
          <p className="text-lg font-bold text-success-600">
            {data.revenue.depositRate.toFixed(1)}%
          </p>
        </Card>
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">평균 측정 기간</h3>
          <p className="text-lg font-bold text-primary-600">
            {data.averageMeasurementDays > 0 ? `${data.averageMeasurementDays}일` : "데이터 없음"}
          </p>
        </Card>
      </div>

      {/* 측정주기별 통계 및 국고지원 현황 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">측정주기별 통계</h2>
          <div className="space-y-3">
            {(["상반기", "하반기"] as const).map((period) => {
              const stats = data.periodStats[period];
              const rate = stats.total > 0 ? (stats.complete / stats.total) * 100 : 0;
              return (
                <div key={period} className="border border-surface-200 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold text-text-900">{period}</span>
                    <span className="text-xs text-text-500">{stats.total}건</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-text-600">완료</span>
                      <span className="font-medium text-primary-600">
                        {stats.complete}건 ({rate.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-text-600">미완료</span>
                      <span className="font-medium text-warning-600">{stats.incomplete}건</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">국고지원 현황</h2>
          {data.nationalSupport.전체 === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                <span className="text-sm font-medium text-text-700">지원</span>
                <div className="text-right">
                  <p className="text-lg font-bold text-success-600">{data.nationalSupport.지원}건</p>
                  <p className="text-xs text-text-500">
                    {data.nationalSupport.전체 > 0
                      ? ((data.nationalSupport.지원 / data.nationalSupport.전체) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <span className="text-sm font-medium text-text-700">비대상</span>
                <div className="text-right">
                  <p className="text-lg font-bold text-text-600">{data.nationalSupport.비대상}건</p>
                  <p className="text-xs text-text-500">
                    {data.nationalSupport.전체 > 0
                      ? ((data.nationalSupport.비대상 / data.nationalSupport.전체) * 100).toFixed(1)
                      : 0}%
                  </p>
                </div>
              </div>
              <div className="pt-2 border-t border-surface-200">
                <div className="flex justify-between text-xs text-text-500">
                  <span>전체</span>
                  <span className="font-medium">{data.nationalSupport.전체}건</span>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* K2B 전송 현황 및 연도/주기별 측정건수 추이 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">K2B 전송 현황</h2>
          <div className="space-y-2">
            <div className="flex justify-between items-center py-2 border-b border-surface-100">
              <span className="text-sm text-text-700">전송완료</span>
              <span className="text-sm font-semibold text-success-600">{data.k2bStats.전송완료}건</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-text-700">미전송</span>
              <span className="text-sm font-semibold text-warning-600">{data.k2bStats.미전송}건</span>
            </div>
            {data.totalCount > 0 && (
              <div className="pt-2 border-t border-surface-200">
                <div className="text-xs text-text-500">
                  전송률: {((data.k2bStats.전송완료 / data.totalCount) * 100).toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">연도/주기별 측정건수 추이</h2>
          {data.countTrend.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.countTrend.slice(0, 10).map((item, index) => (
                <div
                  key={index}
                  className="flex justify-between items-center py-1 border-b border-surface-100 last:border-0"
                >
                  <span className="text-sm font-medium text-text-700">
                    {item.year}년 {item.period}
                  </span>
                  <span className="text-sm font-semibold text-text-900 whitespace-nowrap">
                    {item.count}건
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 매출 추이 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">년도별 매출 추이</h2>
          {data.revenueTrend.yearly.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {(() => {
                const maxAmount = Math.max(...data.revenueTrend.yearly.map((item) => item.amount));
                return data.revenueTrend.yearly.map((item) => {
                  const percentage = maxAmount > 0 ? (item.amount / maxAmount) * 100 : 0;
                  return (
                    <div key={item.year} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-700">{item.year}년</span>
                        <span className="text-sm font-semibold text-text-900 whitespace-nowrap">
                          {formatCurrency(item.amount)}원
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-3 bg-surface-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-500 w-12 text-right">
                          {percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">월별 매출 추이 (최근 12개월)</h2>
          {data.revenueTrend.monthly.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(() => {
                const maxAmount = Math.max(...data.revenueTrend.monthly.map((item) => item.amount));
                return data.revenueTrend.monthly.map((item) => {
                  const percentage = maxAmount > 0 ? (item.amount / maxAmount) * 100 : 0;
                  return (
                    <div key={item.month} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-700">{item.month}</span>
                        <span className="text-sm font-semibold text-text-900 whitespace-nowrap">
                          {formatCurrency(item.amount)}원
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2.5 bg-surface-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-500 w-10 text-right">
                          {percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>
      </div>

      {/* 지정지청별 및 측정주기별 매출 현황 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">지정지청별 매출 현황</h2>
          {data.officeRevenue.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {(() => {
                const maxAmount = Math.max(...data.officeRevenue.map((item) => item.amount));
                return data.officeRevenue.map((item) => {
                  const percentage = maxAmount > 0 ? (item.amount / maxAmount) * 100 : 0;
                  return (
                    <div key={item.office} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-text-700 truncate pr-2">
                          {item.office}
                        </span>
                        <span className="text-sm font-semibold text-primary-600 whitespace-nowrap">
                          {formatCurrency(item.amount)}원
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-3 bg-surface-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-500 w-12 text-right">
                          {percentage.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">측정주기별 매출 현황</h2>
          {data.periodRevenue.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-3">
              {(() => {
                const totalRevenue = data.periodRevenue.reduce((sum, p) => sum + p.amount, 0);
                return data.periodRevenue.map((item) => {
                  const percentage = totalRevenue > 0 ? (item.amount / totalRevenue) * 100 : 0;
                  return (
                    <div key={item.period} className="border border-surface-200 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-text-900">{item.period}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-text-500">{percentage.toFixed(1)}%</span>
                          <span className="text-sm font-bold text-primary-600">
                            {formatCurrency(item.amount)}원
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-3 bg-surface-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary-500 rounded-full transition-all"
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </Card>
      </div>

      {/* 최근 측정 활동 */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-text-900 mb-3">최근 측정 활동 (최근 7일)</h2>
        {data.recentActivity.length === 0 ? (
          <p className="text-text-400 text-sm text-center py-4">최근 활동이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50 text-xs">사업장명</TableHead>
                  <TableHead className="bg-surface-50 text-xs">완료상태</TableHead>
                  <TableHead className="bg-surface-50 text-xs">생성일</TableHead>
                  <TableHead className="bg-surface-50 text-xs">수정일</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentActivity.map((activity) => (
                  <TableRow key={activity.id} className="hover:bg-surface-50">
                    <TableCell className="text-sm font-medium">{activity.business_name}</TableCell>
                    <TableCell className="text-sm">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          activity.completion_status === "완료"
                            ? "bg-success-100 text-success-700"
                            : "bg-warning-100 text-warning-700"
                        }`}
                      >
                        {activity.completion_status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(activity.created_at).toLocaleDateString("ko-KR")}
                    </TableCell>
                    <TableCell className="text-sm">
                      {new Date(activity.updated_at).toLocaleDateString("ko-KR")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
};
