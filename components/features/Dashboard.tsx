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
      id: number;
      measurement_year: number;
      measurement_period: string;
      business_name: string;
      measurement_fee_total: number;
      deposit_total: number;
      unpaid_amount: number;
      completion_status: string;
    }>;
    totalAmount: number;
    count: number;
  };
}

export const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unpaidYear, setUnpaidYear] = useState<number | "">("");
  const [unpaidPeriod, setUnpaidPeriod] = useState<string>("");

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

  const filteredUnpaidList = data?.unpaid.list.filter((item) => {
    if (unpaidYear && item.measurement_year !== unpaidYear) return false;
    if (unpaidPeriod && item.measurement_period !== unpaidPeriod) return false;
    return true;
  }) || [];

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return <Alert variant="error" message={error} />;
  }

  if (!data) {
    return <Alert variant="error" message="데이터를 불러올 수 없습니다." />;
  }

  return (
    <div className="space-y-6">
      {/* 측정건수 및 미완료 건수 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6">
          <h3 className="text-sm font-medium text-text-600 mb-2">전체 측정건수</h3>
          <p className="text-3xl font-bold text-text-900">{data.totalCount}건</p>
        </Card>
        <Card className="p-6">
          <h3 className="text-sm font-medium text-text-600 mb-2">완료 건수</h3>
          <p className="text-3xl font-bold text-primary-600">{data.completeCount}건</p>
        </Card>
        <Card className="p-6">
          <h3 className="text-sm font-medium text-text-600 mb-2">미완료 건수</h3>
          <p className="text-3xl font-bold text-warning-600">{data.incompleteCount}건</p>
        </Card>
      </div>

      {/* 매출현황 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6">
          <h3 className="text-sm font-medium text-text-600 mb-2">측정비 매출</h3>
          <p className="text-2xl font-bold text-text-900">
            {formatCurrency(data.revenue.measurementFee)}원
          </p>
        </Card>
        <Card className="p-6">
          <h3 className="text-sm font-medium text-text-600 mb-2">기타 매출</h3>
          <p className="text-2xl font-bold text-text-900">
            {formatCurrency(data.revenue.otherRevenue)}원
          </p>
        </Card>
        <Card className="p-6">
          <h3 className="text-sm font-medium text-text-600 mb-2">총 매출</h3>
          <p className="text-2xl font-bold text-primary-600">
            {formatCurrency(data.revenue.total)}원
          </p>
        </Card>
      </div>

      {/* 측정완료일 기준 25일 경과 사업장 목록 */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-text-900 mb-4">
          측정완료일 기준 25일 경과 사업장 ({data.overdueBusinesses.length}건)
        </h2>
        {data.overdueBusinesses.length === 0 ? (
          <p className="text-text-500 text-center py-8">경과 사업장이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50">사업장명</TableHead>
                  <TableHead className="bg-surface-50">지정한계_관할지청</TableHead>
                  <TableHead className="bg-surface-50">완료일</TableHead>
                  <TableHead className="bg-surface-50">경과일수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.overdueBusinesses.map((business) => (
                  <TableRow key={business.id} className="hover:bg-surface-50">
                    <TableCell className="font-medium">{business.business_name}</TableCell>
                    <TableCell>{business.designated_office}</TableCell>
                    <TableCell>{business.completion_date}</TableCell>
                    <TableCell className="text-warning-600 font-semibold">
                      {business.days_overdue}일
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* 지정한계_관할지청별 사업장 수 */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-text-900 mb-4">
          지정한계_관할지청별 사업장 수
        </h2>
        {data.officeStats.length === 0 ? (
          <p className="text-text-500 text-center py-8">데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50">지정한계_관할지청</TableHead>
                  <TableHead className="bg-surface-50 text-right">사업장 수</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.officeStats.map((stat) => (
                  <TableRow key={stat.office} className="hover:bg-surface-50">
                    <TableCell className="font-medium">{stat.office}</TableCell>
                    <TableCell className="text-right">{stat.count}건</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* 년도별 매출 추이 */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-text-900 mb-4">년도별 매출 추이</h2>
        {data.revenueTrend.yearly.length === 0 ? (
          <p className="text-text-500 text-center py-8">데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50">년도</TableHead>
                  <TableHead className="bg-surface-50 text-right">매출액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.revenueTrend.yearly.map((item) => (
                  <TableRow key={item.year} className="hover:bg-surface-50">
                    <TableCell className="font-medium">{item.year}년</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.amount)}원
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* 월별 매출 추이 */}
      <Card className="p-6">
        <h2 className="text-xl font-semibold text-text-900 mb-4">월별 매출 추이 (최근 12개월)</h2>
        {data.revenueTrend.monthly.length === 0 ? (
          <p className="text-text-500 text-center py-8">데이터가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50">월</TableHead>
                  <TableHead className="bg-surface-50 text-right">매출액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.revenueTrend.monthly.map((item) => (
                  <TableRow key={item.month} className="hover:bg-surface-50">
                    <TableCell className="font-medium">{item.month}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.amount)}원
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* 미수관리 */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-text-900">
            미수관리 (총 {formatCurrency(data.unpaid.totalAmount)}원, {data.unpaid.count}건)
          </h2>
          <div className="flex gap-2">
            <input
              type="number"
              placeholder="년도"
              value={unpaidYear}
              onChange={(e) =>
                setUnpaidYear(e.target.value ? parseInt(e.target.value) : "")
              }
              className="px-3 py-1 border border-surface-300 rounded-md text-sm"
            />
            <select
              value={unpaidPeriod}
              onChange={(e) => setUnpaidPeriod(e.target.value)}
              className="px-3 py-1 border border-surface-300 rounded-md text-sm"
            >
              <option value="">전체</option>
              <option value="상반기">상반기</option>
              <option value="하반기">하반기</option>
            </select>
          </div>
        </div>
        {filteredUnpaidList.length === 0 ? (
          <p className="text-text-500 text-center py-8">미수 내역이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-surface-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="bg-surface-50">측정년도</TableHead>
                  <TableHead className="bg-surface-50">측정주기</TableHead>
                  <TableHead className="bg-surface-50">사업장명</TableHead>
                  <TableHead className="bg-surface-50 text-right">측정비</TableHead>
                  <TableHead className="bg-surface-50 text-right">입금액</TableHead>
                  <TableHead className="bg-surface-50 text-right">미수금액</TableHead>
                  <TableHead className="bg-surface-50">완료여부</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUnpaidList.map((item) => (
                  <TableRow key={item.id} className="hover:bg-surface-50">
                    <TableCell>{item.measurement_year}</TableCell>
                    <TableCell>{item.measurement_period}</TableCell>
                    <TableCell className="font-medium">{item.business_name}</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.measurement_fee_total)}원
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(item.deposit_total)}원
                    </TableCell>
                    <TableCell className="text-right text-warning-600 font-semibold">
                      {formatCurrency(item.unpaid_amount)}원
                    </TableCell>
                    <TableCell>{item.completion_status}</TableCell>
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
