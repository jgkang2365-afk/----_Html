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
import { MeasurementRevenue } from "./types";

interface ThirdPartyTableProps {
  data: MeasurementRevenue[];
  formatCurrency: (amount: number | null | undefined) => string;
  formatDate: (date: string | null) => string;
  onEdit: (item: MeasurementRevenue) => void;
}

export const ThirdPartyTable: React.FC<ThirdPartyTableProps> = ({
  data,
  formatCurrency,
  formatDate,
  onEdit,
}) => {
  const thirdPartyItems = data.filter(
    (item) =>
      (item.invoice_business_number && item.invoice_business_number !== item.business_number) ||
      (item.invoice_business_name && item.invoice_business_name !== item.business_name)
  );

  return (
    <div className="mt-4">
      <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 mb-4 flex items-start gap-3">
        <div className="bg-blue-500 text-white rounded-full p-1 mt-0.5">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <div>
          <p className="text-sm text-blue-800 font-medium">타업체 발행 현황 안내</p>
          <p className="text-xs text-blue-600 mt-1">
            측정일지에 등록된 사업장과 다른 사업자번호 또는 상호로 계산서를 발행한 내역입니다. 입금 확인 시 발행처 정보를 활용하세요.
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-surface-200 min-h-[500px] bg-white overflow-hidden shadow-sm">
        <Table maxHeight="max-h-[calc(100vh-400px)]">
          <TableHeader>
            <TableRow className="bg-sky-100 border-b-2 border-sky-200 pointer-events-none">
              <TableHead className="w-[90px] text-left pl-2.5">발행일</TableHead>
              <TableHead className="w-[200px]">사업장명 (원래)</TableHead>
              <TableHead className="w-[130px]">사업자번호 (원래)</TableHead>
              <TableHead className="w-[200px] border-l border-primary-100 bg-primary-50/50">발행처 상호 (변경)</TableHead>
              <TableHead className="w-[130px] bg-primary-50/50">발행처 사업자 (변경)</TableHead>
              <TableHead className="w-[120px] text-right">측정비(사업장)</TableHead>
              <TableHead className="w-[90px] text-center">입금상태</TableHead>
              <TableHead className="w-[80px] text-center">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {thirdPartyItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-text-500 py-16">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">📄</span>
                    <p>타업체로 발행된 내역이 발견되지 않았습니다.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              thirdPartyItems.map((item) => {
                const deposit = parseFloat(item.deposit_amount_business?.toString() || "0") + parseFloat(item.deposit_amount_business_2?.toString() || "0");
                const fee = parseFloat(item.measurement_fee_business?.toString() || "0");
                const isPaid = fee > 0 && deposit >= fee;

                return (
                  <TableRow key={item.id} className="hover:bg-blue-50/40 transition-colors group relative growable-row">
                    <TableCell className="w-[90px] text-left py-3 pl-2.5 relative">
                      {/* 표준 블루 인디케이터 바 */}
                      <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                      {item.electronic_invoice_date ? formatDate(item.electronic_invoice_date) : "-"}
                    </TableCell>
                    <TableCell className="py-3 font-medium">{item.business_name}</TableCell>
                    <TableCell className="text-center py-3 text-gray-500 text-sm">{item.business_number || "-"}</TableCell>
                    <TableCell className="py-3 bg-primary-50/30 font-semibold border-l border-primary-100">
                      {item.invoice_business_name || "-"}
                    </TableCell>
                    <TableCell className="text-center py-3 bg-primary-50/30 text-primary-700">
                      {item.invoice_business_number || "-"}
                    </TableCell>
                    <TableCell className="text-right py-3 font-semibold">
                      {formatCurrency(item.measurement_fee_business)}원
                    </TableCell>
                    <TableCell className="text-center py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${isPaid ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700"}`}>
                        {isPaid ? "입금완료" : "미입금"}
                      </span>
                    </TableCell>
                    <TableCell className="text-center py-3">
                      <Button variant="secondary" size="sm" onClick={() => onEdit(item)} className="h-7 text-[11px] px-2">
                        일지수정
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};
