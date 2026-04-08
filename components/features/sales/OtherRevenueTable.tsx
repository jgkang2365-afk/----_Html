import React from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { OtherRevenue } from "./types";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

interface OtherRevenueTableProps {
  data: OtherRevenue[];
  onEdit: (item: OtherRevenue) => void;
  formatCurrency: (amount: number | null | undefined) => string;
  otherFilters: any;
  setOtherFilters: (filters: any) => void;
  yearOptions: Array<{ value: string; label: string }>;
  periodOptions: Array<{ value: string; label: string }>;
  loading?: boolean;
}

export const OtherRevenueTable: React.FC<OtherRevenueTableProps> = ({
  data,
  onEdit,
  formatCurrency,
  otherFilters,
  setOtherFilters,
  yearOptions,
  periodOptions,
  loading = false,
}) => {
  return (
    <div className="mt-4">
      {/* 필터 섹션: 제목과 우측 정렬된 필터 */}
      <div className="flex justify-between items-center mb-4 px-1">
        <h3 className="text-lg font-bold text-text-800">기타 매출 내역</h3>
        <div className="flex items-center gap-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-primary-500 animate-pulse mr-2">
              <LoadingSpinner className="w-3 h-3" />
              <span>검색 중...</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-600 whitespace-nowrap">년도:</span>
            <Select
              value={otherFilters.year || ""}
              onChange={(e) => setOtherFilters({ ...otherFilters, year: e.target.value })}
              options={[{ value: "", label: "전체" }, ...yearOptions]}
              className="w-[110px] h-9 text-sm pl-3 pr-8 py-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-600 whitespace-nowrap">주기:</span>
            <Select
              value={otherFilters.period || ""}
              onChange={(e) => setOtherFilters({ ...otherFilters, period: e.target.value })}
              options={periodOptions}
              className="w-[130px] h-9 text-sm pl-3 pr-8 py-1"
            />
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="h-9 text-xs ml-1"
            onClick={() => setOtherFilters({ ...otherFilters, year: "", period: "" })}
          >
            초기화
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto border rounded-xl shadow-md bg-white">
        <Table maxHeight="max-h-[600px]">
          <TableHeader>
            <TableRow className="bg-sky-100 hover:bg-sky-100 border-b-2 border-sky-200">
              <TableHead className="text-center font-bold py-3 px-3 text-black w-[60px]">연번</TableHead>
              <TableHead className="font-bold py-3 px-4 text-black">항목명</TableHead>
              <TableHead className="text-center font-bold py-3 px-3 text-black w-[100px]">매출년도</TableHead>
              <TableHead className="text-center font-bold py-3 px-3 text-black w-[100px]">매출주기</TableHead>
              <TableHead className="text-center font-bold py-3 px-4 text-black w-[120px]">계산서 발행일</TableHead>
              <TableHead className="text-right font-bold py-3 px-4 text-black w-[120px]">공급가액</TableHead>
              <TableHead className="text-right font-bold py-3 px-4 text-black w-[120px]">부가세</TableHead>
              <TableHead className="text-right font-bold py-3 px-4 text-black w-[120px]">합계금액</TableHead>
              <TableHead className="text-center font-bold py-3 px-3 text-black w-[120px]">입금일</TableHead>
              <TableHead className="text-right font-bold py-3 px-4 text-black w-[120px]">입금액</TableHead>
              <TableHead className="font-bold py-3 px-4 text-black w-[150px]">비고</TableHead>
              <TableHead className="text-center font-bold py-3 px-3 text-black w-[80px]">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="text-center py-20 text-gray-500">
                  {loading ? "데이터를 불러오는 중..." : "등록된 기타 매출 내역이 없습니다."}
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, index) => (
                <TableRow key={item.id} className="hover:bg-blue-50/30 transition-colors border-b border-gray-100">
                  <TableCell className="text-center py-3 px-3 text-gray-600">{index + 1}</TableCell>
                  <TableCell className="py-3 px-4 font-medium text-black">{item.item_name}</TableCell>
                  <TableCell className="text-center py-3 px-3 text-black">{item.revenue_year || "-"}</TableCell>
                  <TableCell className="text-center py-3 px-3 text-black">{item.revenue_period || "-"}</TableCell>
                  <TableCell className="text-center py-3 px-4 text-black">{item.invoice_date || "-"}</TableCell>
                  <TableCell className="text-right py-3 px-4 text-black">{formatCurrency(item.supply_amount)}원</TableCell>
                  <TableCell className="text-right py-3 px-4 text-black">{formatCurrency(item.vat_amount)}원</TableCell>
                  <TableCell className="text-right py-3 px-4 font-bold text-black">{formatCurrency(item.total_amount)}원</TableCell>
                  <TableCell className="text-center py-3 px-4 text-black">{item.deposit_date || "-"}</TableCell>
                  <TableCell className={`text-right py-3 px-4 font-bold ${item.deposit_amount === item.total_amount ? "text-primary-600" : "text-black"}`}>
                    {formatCurrency(item.deposit_amount)}원
                  </TableCell>
                  <TableCell className="py-3 px-4 text-sm text-gray-600 truncate max-w-[150px]">{item.notes || "-"}</TableCell>
                  <TableCell className="text-center py-3 px-3">
                    <Button variant="secondary" size="sm" onClick={() => onEdit(item)} className="px-2 py-1 text-xs">
                      수정
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
            {/* 현재 페이지 합계 행 추가 */}
            {data.length > 0 && (
              <TableRow className="bg-slate-50 border-t-2 border-slate-200 sticky bottom-0 z-10 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                <TableCell colSpan={5} className="text-center font-bold text-slate-700 py-3">현재 페이지 합계</TableCell>
                <TableCell className="text-right font-bold text-slate-700">
                  {formatCurrency(data.reduce((sum, item) => sum + (item.supply_amount || 0), 0))}원
                </TableCell>
                <TableCell className="text-right font-bold text-slate-700">
                  {formatCurrency(data.reduce((sum, item) => sum + (item.vat_amount || 0), 0))}원
                </TableCell>
                <TableCell className="text-right font-bold text-primary-700">
                  {formatCurrency(data.reduce((sum, item) => sum + (item.total_amount || 0), 0))}원
                </TableCell>
                <TableCell className="text-center text-slate-400">-</TableCell>
                <TableCell className="text-right font-bold text-slate-700">
                  {formatCurrency(data.reduce((sum, item) => sum + (item.deposit_amount || 0), 0))}원
                </TableCell>
                <TableCell colSpan={2} className="text-center text-slate-400">-</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
