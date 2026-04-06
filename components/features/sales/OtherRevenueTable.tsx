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
import { OtherRevenue } from "./types";

interface OtherRevenueTableProps {
  data: OtherRevenue[];
  onEdit: (item: OtherRevenue) => void;
  formatCurrency: (amount: number | null | undefined) => string;
}

export const OtherRevenueTable: React.FC<OtherRevenueTableProps> = ({
  data,
  onEdit,
  formatCurrency,
}) => {
  return (
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
                등록된 기타 매출 내역이 없습니다.
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
        </TableBody>
      </Table>
    </div>
  );
};
