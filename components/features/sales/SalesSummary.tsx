import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/Table";
import { Modal } from "@/components/ui/Modal";
import { MeasurementRevenue, SalesSummaryData } from "./types";

interface SalesSummaryProps {
  summary: SalesSummaryData | null;
  salesSummaryYear: string;
  setSalesSummaryYear: (year: string) => void;
  yearOptions: Array<{ value: string; label: string }>;
  measurementRevenue: MeasurementRevenue[];
  formatCurrency: (amount: number | null | undefined) => string;
}

export const SalesSummary: React.FC<SalesSummaryProps> = ({
  summary,
  salesSummaryYear,
  setSalesSummaryYear,
  yearOptions,
  measurementRevenue,
  formatCurrency,
}) => {
  const [isSalesDetailModalOpen, setIsSalesDetailModalOpen] = useState(false);
  const [salesDetailType, setSalesDetailType] = useState<"measurementTotal" | "measurementDeposit" | null>(null);
  const [salesDetailList, setSalesDetailList] = useState<MeasurementRevenue[]>([]);
  const [salesDetailTitle, setSalesDetailTitle] = useState<string>("");

  if (!summary) return null;

  return (
    <>
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text-900">매출 집계</h2>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-text-700 whitespace-nowrap">년도 선택:</label>
            <Select
              value={salesSummaryYear}
              onChange={(e) => setSalesSummaryYear(e.target.value)}
              options={[{ value: "", label: "전체" }, ...yearOptions]}
              className="w-32 bg-primary-50 border-2 border-primary-400 text-primary-700 font-medium focus:border-primary-600 focus:ring-2 focus:ring-primary-300 text-center"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>구분</TableHead>
                <TableHead className="text-right">공급가액</TableHead>
                <TableHead className="text-right">부가세</TableHead>
                <TableHead className="text-right">합계</TableHead>
                <TableHead className="text-right">입금액</TableHead>
                <TableHead className="text-right">미수금(부가세 포함)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                let measurementRevenueSum = 0;
                let measurementDepositSum = 0;
                let measurementUnpaidSum = 0;

                let otherRevenueSum = 0;
                let otherVatSum = 0;
                let otherTotalSum = 0;
                let otherDepositSum = 0;
                let otherUnpaidSum = 0;

                if (salesSummaryYear && salesSummaryYear !== "" && summary.byYear) {
                  const yearData = summary.byYear[parseInt(salesSummaryYear)]?.total;
                  if (yearData) {
                    measurementRevenueSum = yearData.measurementRevenue;
                    measurementDepositSum = yearData.measurementDeposit;
                    measurementUnpaidSum = yearData.measurementUnpaid;

                    otherRevenueSum = yearData.otherRevenue;
                    otherVatSum = yearData.otherVat;
                    otherTotalSum = yearData.otherTotal;
                    otherDepositSum = yearData.otherDeposit;
                    otherUnpaidSum = yearData.otherUnpaid;
                  }
                } else if (summary.byOffice) {
                  Object.values(summary.byOffice).forEach((officeData) => {
                    measurementRevenueSum += officeData.measurementRevenue;
                    measurementDepositSum += officeData.measurementDeposit;
                    measurementUnpaidSum += officeData.measurementUnpaid;

                    otherRevenueSum += officeData.otherRevenue;
                    otherVatSum += officeData.otherVat;
                    otherTotalSum += officeData.otherTotal;
                    otherDepositSum += officeData.otherDeposit;
                    otherUnpaidSum += officeData.otherUnpaid;
                  });
                }

                const measurementTotalSum = measurementRevenueSum;

                const handleMeasurementTotalClick = () => {
                  setSalesDetailType("measurementTotal");
                  setSalesDetailList(measurementRevenue);
                  setSalesDetailTitle(`측정비 합계 내역(현재 페이지)${salesSummaryYear ? ` (${salesSummaryYear}년)` : ""}`);
                  setIsSalesDetailModalOpen(true);
                };

                const handleMeasurementDepositClick = () => {
                  setSalesDetailType("measurementDeposit");
                  const itemsWithDeposit = measurementRevenue.filter((item) => (item.deposit_total || 0) > 0);
                  setSalesDetailList(itemsWithDeposit);
                  setSalesDetailTitle(`측정비 입금액 내역(현재 페이지)${salesSummaryYear ? ` (${salesSummaryYear}년)` : ""}`);
                  setIsSalesDetailModalOpen(true);
                };

                return (
                  <>
                    <TableRow>
                      <TableCell className="font-medium">측정비</TableCell>
                      <TableCell className="text-right">{formatCurrency(measurementRevenueSum)}원</TableCell>
                      <TableCell className="text-right">0원</TableCell>
                      <TableCell
                        className="text-right font-semibold cursor-pointer hover:bg-gray-100"
                        onClick={handleMeasurementTotalClick}
                      >
                        {formatCurrency(measurementTotalSum)}원
                      </TableCell>
                      <TableCell
                        className="text-right cursor-pointer hover:bg-gray-100"
                        onClick={handleMeasurementDepositClick}
                      >
                        {formatCurrency(measurementDepositSum)}원
                      </TableCell>
                      <TableCell className="text-right text-warning-600 font-semibold">
                        {formatCurrency(measurementUnpaidSum)}원
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium">기타</TableCell>
                      <TableCell className="text-right">{formatCurrency(otherRevenueSum)}원</TableCell>
                      <TableCell className="text-right">{formatCurrency(otherVatSum)}원</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(otherTotalSum)}원</TableCell>
                      <TableCell className="text-right">{formatCurrency(otherDepositSum)}원</TableCell>
                      <TableCell className="text-right text-warning-600 font-semibold">
                        {formatCurrency(otherUnpaidSum)}원
                      </TableCell>
                    </TableRow>
                  </>
                );
              })()}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Modal
        isOpen={isSalesDetailModalOpen}
        onClose={() => setIsSalesDetailModalOpen(false)}
        title={salesDetailTitle}
        size="2xl"
      >
        <div>
          {salesDetailList.length === 0 ? (
            <div className="py-8 text-center text-text-600 text-sm">내역이 없습니다.</div>
          ) : (
            <Table maxHeight="max-h-[60vh]">
              <TableHeader>
                <TableRow className="bg-sky-100">
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">연번</TableHead>
                  <TableHead className="font-semibold py-1 px-2 text-black text-sm">사업장명</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정년도</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">측정주기</TableHead>
                  <TableHead className="text-center font-semibold py-1 px-2 text-black text-sm">관할지청</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">측정비(합계)</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">입금액</TableHead>
                  <TableHead className="text-right font-semibold py-1 px-2 text-black text-sm">미수금액</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {salesDetailList.map((item, index) => {
                  const total = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
                  const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
                  const unpaid = total - deposit;

                  return (
                    <TableRow key={item.id || index} className="border-b border-gray-200">
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{index + 1}</TableCell>
                      <TableCell className="text-black py-1 px-2 text-sm">{item.business_name}</TableCell>
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{item.measurement_year}</TableCell>
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{item.measurement_period}</TableCell>
                      <TableCell className="text-center text-black py-1 px-2 text-sm">{item.designated_office || "-"}</TableCell>
                      <TableCell className="text-right text-black py-1 px-2 text-sm">
                        {formatCurrency(total)}원
                      </TableCell>
                      <TableCell className="text-right text-black py-1 px-2 text-sm">
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="font-bold text-black border-b border-gray-200 pb-0.5 mb-0.5 w-full text-right">
                            {formatCurrency(deposit)}원
                          </div>
                          {(item.deposit_amount_business || 0) > 0 && (
                            <div className="text-[11px] text-gray-600 flex justify-end items-center gap-1 whitespace-nowrap">
                              <span className="text-gray-400">사1:</span>
                              <span>{formatCurrency(item.deposit_amount_business)}</span>
                              {item.deposit_date_business && (
                                <span className="text-gray-400 text-[10px] tracking-tighter">
                                  ({item.deposit_date_business.substring(5)})
                                </span>
                              )}
                            </div>
                          )}
                          {(item.deposit_amount_business_2 || 0) > 0 && (
                            <div className="text-[11px] text-indigo-600 flex justify-end items-center gap-1 whitespace-nowrap">
                              <span className="text-indigo-400">사2:</span>
                              <span>{formatCurrency(item.deposit_amount_business_2)}</span>
                              {item.deposit_date_business_2 && (
                                <span className="text-indigo-400 text-[10px] tracking-tighter">
                                  ({item.deposit_date_business_2.substring(5)})
                                </span>
                              )}
                            </div>
                          )}
                          {(item.deposit_amount_national || 0) > 0 && (
                            <div className="text-[11px] text-emerald-600 flex justify-end items-center gap-1 whitespace-nowrap">
                              <span className="text-emerald-400">국:</span>
                              <span>{formatCurrency(item.deposit_amount_national)}</span>
                              {item.deposit_date_national && (
                                <span className="text-emerald-400 text-[10px] tracking-tighter">
                                  ({item.deposit_date_national.substring(5)})
                                </span>
                              )}
                            </div>
                          )}
                          {deposit === 0 && <div className="text-gray-400 text-xs">-</div>}
                        </div>
                      </TableCell>
                      <TableCell className={`text-right py-1 px-2 text-sm font-semibold ${unpaid > 0 ? "text-warning-600" : "text-black"}`}>
                        {formatCurrency(unpaid)}원
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="border-t-2 border-gray-300 bg-gray-50">
                  <TableCell colSpan={5} className="text-center font-bold text-black py-2 px-2">합계</TableCell>
                  <TableCell className="text-right font-bold text-black py-2 px-2">
                    {formatCurrency(
                      salesDetailList.reduce((sum, item) => sum + (parseFloat(item.measurement_fee_total?.toString() || "0") || 0), 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right font-bold text-black py-2 px-2">
                    {formatCurrency(
                      salesDetailList.reduce((sum, item) => sum + (parseFloat(item.deposit_total?.toString() || "0") || 0), 0)
                    )}원
                  </TableCell>
                  <TableCell className="text-right font-bold text-black py-2 px-2">
                    {formatCurrency(
                      salesDetailList.reduce((sum, item) => {
                        const total = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
                        const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
                        return sum + (total - deposit);
                      }, 0)
                    )}원
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>
      </Modal>
    </>
  );
};
