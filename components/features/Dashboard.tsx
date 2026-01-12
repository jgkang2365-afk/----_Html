"use client";

import React, { useState, useEffect } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
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

interface DashboardData {
  totalCount: number;
  incompleteCount: number;
  completeCount: number;
  overdueBusinesses: Array<{
    id: number;
    business_name: string;
    completion_date: string;
    designated_office: string;
    days_overdue: number;
  }>;
  officeStats: Array<{
    office: string;
    count: number;
  }>;
  revenue: {
    measurementFee: number;
    otherRevenue: number;
    total: number;
  };
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
  unpaid: {
    list: Array<{
      business_name: string;
      measurement_fee_total: number;
      measurement_fee_business: number;
      measurement_fee_national: number;
      unpaid_count: number;
      unpaid_total: number;
    }>;
    totalAmount: number;
    count: number;
  };
}

export const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/dashboard");
      const result = await response.json();

      if (response.ok) {
        setData(result);
      } else {
        setError(result.error || "대시보드 데이터를 불러오는 중 오류가 발생했습니다.");
      }
    } catch (err: any) {
      console.error("대시보드 데이터 로드 오류:", err);
      setError(err.message || "대시보드 데이터를 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency: "KRW",
    })
      .format(amount)
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
      {/* 측정건수 및 매출 카드 섹션 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
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
        <Card className="p-4">
          <h3 className="text-xs font-medium text-text-500 mb-1">총 매출</h3>
          <p className="text-lg font-bold text-primary-600">
            {formatCurrency(data.revenue.total)}원
          </p>
        </Card>
      </div>

      {/* 측정완료일 기준 25일 경과 사업장 목록 */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-text-900 mb-3">
          측정완료일 기준 25일 경과 사업장 ({data.overdueBusinesses.length}건)
        </h2>
        {data.overdueBusinesses.length === 0 ? (
          <p className="text-text-400 text-sm text-center py-4">경과 사업장이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50 text-xs">사업장명</TableHead>
                  <TableHead className="bg-surface-50 text-xs">지정한계_관할지청</TableHead>
                  <TableHead className="bg-surface-50 text-xs">완료일</TableHead>
                  <TableHead className="bg-surface-50 text-xs">경과일수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.overdueBusinesses.map((business) => (
                  <TableRow key={business.id} className="hover:bg-surface-50">
                    <TableCell className="text-sm font-medium">{business.business_name}</TableCell>
                    <TableCell className="text-sm">{business.designated_office}</TableCell>
                    <TableCell className="text-sm">{business.completion_date}</TableCell>
                    <TableCell className="text-sm text-warning-600 font-semibold">
                      {business.days_overdue}일
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* 지정한계_관할지청별 사업장 수 및 매출 추이 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">
            지정한계_관할지청별 사업장 수
          </h2>
          {data.officeStats.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {data.officeStats.map((stat) => (
                <div key={stat.office} className="flex justify-between items-center py-1 border-b border-surface-100 last:border-0">
                  <span className="text-sm text-text-700 truncate pr-2">{stat.office}</span>
                  <span className="text-sm font-semibold text-text-900 whitespace-nowrap">{stat.count}건</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">년도별 매출 추이</h2>
          {data.revenueTrend.yearly.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {data.revenueTrend.yearly.map((item) => (
                <div key={item.year} className="flex justify-between items-center py-1 border-b border-surface-100 last:border-0">
                  <span className="text-sm font-medium text-text-700">{item.year}년</span>
                  <span className="text-sm font-semibold text-text-900 whitespace-nowrap">
                    {formatCurrency(item.amount)}원
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-text-900 mb-3">월별 매출 추이 (최근 12개월)</h2>
          {data.revenueTrend.monthly.length === 0 ? (
            <p className="text-text-400 text-sm text-center py-4">데이터가 없습니다.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {data.revenueTrend.monthly.map((item) => (
                <div key={item.month} className="flex justify-between items-center py-1 border-b border-surface-100 last:border-0">
                  <span className="text-sm font-medium text-text-700">{item.month}</span>
                  <span className="text-sm font-semibold text-text-900 whitespace-nowrap">
                    {formatCurrency(item.amount)}원
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 미수관리 */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-text-900 mb-3">
          미수관리 (총 {formatCurrency(data.unpaid.totalAmount)}원, {data.unpaid.count}개 사업장)
        </h2>
        {data.unpaid.list.length === 0 ? (
          <p className="text-text-400 text-sm text-center py-4">미수대상 사업장이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50 text-xs">사업장명</TableHead>
                  <TableHead className="bg-surface-50 text-xs text-right">측정비(합계)</TableHead>
                  <TableHead className="bg-surface-50 text-xs text-right">측정비(사업장)</TableHead>
                  <TableHead className="bg-surface-50 text-xs text-right">측정비(국고)</TableHead>
                  <TableHead className="bg-surface-50 text-xs text-right">미수 횟수</TableHead>
                  <TableHead className="bg-surface-50 text-xs text-right">미수금액(합계)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.unpaid.list.map((item, index) => (
                  <TableRow key={index} className="hover:bg-surface-50">
                    <TableCell className="text-sm font-medium">{item.business_name}</TableCell>
                    <TableCell className="text-sm text-right">
                      {formatCurrency(item.measurement_fee_total)}원
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {formatCurrency(item.measurement_fee_business)}원
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {formatCurrency(item.measurement_fee_national)}원
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {item.unpaid_count}건
                    </TableCell>
                    <TableCell className="text-sm text-right text-warning-600 font-semibold">
                      {formatCurrency(item.unpaid_total)}원
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
