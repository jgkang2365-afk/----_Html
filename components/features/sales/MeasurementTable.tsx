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
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { cn } from "@/lib/utils";
import { MeasurementRevenue } from "./types";

interface MeasurementTableProps {
  measurementRevenue: MeasurementRevenue[];
  measurementFilters: any;
  setMeasurementFilters: (filters: any) => void;
  measurementSort: any;
  setMeasurementSort: (sort: any) => void;
  localBusinessName: string;
  setLocalBusinessName: (val: string) => void;
  localRepresentativeName: string;
  setLocalRepresentativeName: (val: string) => void;
  yearOptions: Array<{ value: string; label: string }>;
  periodOptions: Array<{ value: string; label: string }>;
  officeOptions: Array<{ value: string; label: string }>;
  totalCount: number;
  currentPage: number;
  totalPages: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  loading: boolean;
  isMeasurementFiltering: boolean;
  formatCurrency: (amount: number | null | undefined) => string;
  formatDateYYYYMMDD: (val: any) => string;
  setMeasurementDepositDetailItem: (item: any) => void;
  setIsMeasurementDepositDetailModalOpen: (open: boolean) => void;
  handleMeasurementEdit: (item: MeasurementRevenue) => void;
  checkSearchMatch: (target: any, search: string) => boolean;
  checkExactMatch: (target: any, search: string) => boolean;
  isMatchSelection: (target: any, search: string) => boolean;
  getPeriodWeight: (period: string) => number;
  // 신규 추가 props
  isJournalManager?: boolean;
  onPaymentUpload?: () => void;
  onDownloadPaymentTemplate?: () => void;
  processingResults?: Record<number, import("./types").ProcessingResult>;
}

export const MeasurementTable: React.FC<MeasurementTableProps> = ({
  measurementRevenue,
  measurementFilters,
  setMeasurementFilters,
  measurementSort,
  setMeasurementSort,
  localBusinessName,
  setLocalBusinessName,
  localRepresentativeName,
  setLocalRepresentativeName,
  yearOptions,
  periodOptions,
  officeOptions,
  totalCount,
  currentPage,
  totalPages,
  setCurrentPage,
  loading,
  isMeasurementFiltering,
  formatCurrency,
  formatDateYYYYMMDD,
  setMeasurementDepositDetailItem,
  setIsMeasurementDepositDetailModalOpen,
  handleMeasurementEdit,
  checkSearchMatch,
  checkExactMatch,
  isMatchSelection,
  getPeriodWeight,
  isJournalManager,
  onPaymentUpload,
  onDownloadPaymentTemplate,
  processingResults = {},
}) => {
  // 필터링 적용
                let filteredMeasurement = measurementRevenue.filter((item) => {
                  if (measurementFilters.businessName && !checkSearchMatch(item.business_name, measurementFilters.businessName)) return false;
                  if (measurementFilters.representativeName && !checkSearchMatch(item.representative_name, measurementFilters.representativeName)) return false;
                  if (measurementFilters.year && !checkExactMatch(item.measurement_year, measurementFilters.year)) return false;
                  if (measurementFilters.period && !isMatchSelection(item.measurement_period, measurementFilters.period)) return false;
                  if (measurementFilters.designatedOffice && !checkExactMatch(item.designated_office, measurementFilters.designatedOffice)) return false;
                  if (measurementFilters.hasInvoiceDate === "yes" && !item.electronic_invoice_date) return false;
                  if (measurementFilters.hasInvoiceDate === "no" && item.electronic_invoice_date) return false;
                  return true;
                });

                // 정렬 적용
                filteredMeasurement.sort((a, b) => {
                  let result = 0;
                  let aValue: any;
                  let bValue: any;

                  // 미수금액 컬럼 처리 (계산된 값)
                  if (measurementSort.column === "unpaid") {
                    const aTotal = parseFloat(a.measurement_fee_total?.toString() || "0") || 0;
                    const aDeposit = parseFloat(a.deposit_total?.toString() || "0") || 0;
                    aValue = aTotal - aDeposit;

                    const bTotal = parseFloat(b.measurement_fee_total?.toString() || "0") || 0;
                    const bDeposit = parseFloat(b.deposit_total?.toString() || "0") || 0;
                    bValue = bTotal - bDeposit;
                  } else {
                    aValue = a[measurementSort.column as keyof MeasurementRevenue];
                    bValue = b[measurementSort.column as keyof MeasurementRevenue];
                  }

                  // 문자열 비교
                  if (typeof aValue === "string" && typeof bValue === "string") {
                    aValue = aValue.toLowerCase();
                    bValue = bValue.toLowerCase();
                  }

                  // null 처리
                  if (aValue === null || aValue === undefined) aValue = "";
                  if (bValue === null || bValue === undefined) bValue = "";

                  if (aValue > bValue) result = measurementSort.direction === "asc" ? 1 : -1;
                  else if (aValue < bValue) result = measurementSort.direction === "asc" ? -1 : 1;

                  if (result !== 0) return result;

                  // 2차 정렬: 년도 내림차순 (DESC)
                  if (a.measurement_year !== b.measurement_year) {
                    return b.measurement_year - a.measurement_year;
                  }

                  // 3차 정렬: 주기 내림차순 (하반기 > 상반기)
                  const aWeight = getPeriodWeight(a.measurement_period);
                  const bWeight = getPeriodWeight(b.measurement_period);
                  return bWeight - aWeight;
                });

                // 정렬 아이콘 컴포넌트
                const MeasurementSortIcon = ({ column }: { column: string }) => {
                  if (measurementSort.column !== column) {
                    return <span className="text-gray-400 text-xs ml-1">↕</span>;
                  }
                  return (
                    <span className={`text-xs ml-1 font-bold ${measurementSort.direction === "asc" ? "text-red-600" : "text-blue-600"}`}>
                      {measurementSort.direction === "asc" ? "↑" : "↓"}
                    </span>
                  );
                };

                // 정렬 핸들러
                const handleMeasurementSort = (column: string) => {
                  if (measurementSort.column === column) {
                    setMeasurementSort({
                      column,
                      direction: measurementSort.direction === "asc" ? "desc" : "asc",
                    });
                  } else {
                    setMeasurementSort({ column, direction: "desc" });
                  }
                };

                return (
                  <div className="mt-4">
                    <div className="sticky top-[-1px] z-40 bg-white py-3 flex justify-between items-center border-b border-surface-100 mb-2">
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-medium text-text-700">
                          검색 결과: <span className="text-primary-600 font-bold">{totalCount.toLocaleString()}</span>건 
                          <span className="text-text-400 font-normal ml-2">({currentPage} / {totalPages} 페이지)</span>
                        </div>
                        {isMeasurementFiltering && (
                          <div className="flex items-center gap-2 text-xs text-primary-500 animate-pulse">
                            <LoadingSpinner className="w-3 h-3" />
                            <span>검색 중...</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isJournalManager && (
                          <Button
                            variant="primary"
                            size="sm"
                            className="h-8 text-xs px-3 bg-green-600 hover:bg-green-700 border-none"
                            onClick={onPaymentUpload}
                          >
                            국고지원금 업로드
                          </Button>
                        )}
                        {isJournalManager && (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-8 text-xs px-3"
                            onClick={onDownloadPaymentTemplate}
                          >
                            📥 양식 다운로드
                          </Button>
                        )}
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => {
                            const initial = {
                              businessName: "",
                              representativeName: "",
                              year: "",
                              period: "",
                              designatedOffice: "",
                              hasInvoiceDate: "",
                            };
                            setMeasurementFilters(initial);
                            // 로컬 상태 동기화는 useEffect에서 처리됨
                            // setDebouncedMeasurementFilters(initial); // Removed as debounce logic was removed
                            setMeasurementSort({ column: "measurement_fee_total", direction: "desc" });
                          }}
                        >
                          필터 초기화
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg border border-surface-200 min-h-[500px] bg-white">
                      <Table className="table-fixed" maxHeight="max-h-[calc(100vh-350px)]">
                        <TableHeader>
                          <TableRow className="bg-sky-100 border-b-2 border-sky-200">
                            <TableHead className="w-[80px] pl-2.5">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_year")}
                                >
                                  측정년도
                                  <MeasurementSortIcon column="measurement_year" />
                                </div>
                                <Select
                                  value={measurementFilters.year}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, year: e.target.value })
                                  }
                                  options={[{ value: "", label: "전체" }, ...yearOptions]}
                                  className="text-sm h-8 py-1 px-2 text-left"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[100px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_period")}
                                >
                                  측정주기
                                  <MeasurementSortIcon column="measurement_period" />
                                </div>
                                <Select
                                  value={measurementFilters.period}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, period: e.target.value })
                                  }
                                  options={periodOptions}
                                  className="text-sm h-8 py-1 px-2 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[220px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("business_name")}
                                >
                                  사업장명
                                  <MeasurementSortIcon column="business_name" />
                                </div>
                                <Input
                                  value={localBusinessName}
                                  onChange={(e) => setLocalBusinessName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      setMeasurementFilters({ ...measurementFilters, businessName: localBusinessName });
                                    }
                                  }}
                                  onBlur={() => {
                                    setMeasurementFilters({ ...measurementFilters, businessName: localBusinessName });
                                  }}
                                  placeholder="입력 후 Enter"
                                  className="text-xs h-8 text-left"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[120px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("representative_name")}
                                >
                                  대표자명
                                  <MeasurementSortIcon column="representative_name" />
                                </div>
                                <Input
                                  value={localRepresentativeName}
                                  onChange={(e) => setLocalRepresentativeName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      setMeasurementFilters({ ...measurementFilters, representativeName: localRepresentativeName });
                                    }
                                  }}
                                  onBlur={() => {
                                    setMeasurementFilters({ ...measurementFilters, representativeName: localRepresentativeName });
                                  }}
                                  placeholder="입력 후 Enter"
                                  className="text-xs h-8 text-left"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[100px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("designated_office")}
                                >
                                  지정지청
                                  <MeasurementSortIcon column="designated_office" />
                                </div>
                                <Select
                                  value={measurementFilters.designatedOffice}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, designatedOffice: e.target.value })
                                  }
                                  options={officeOptions}
                                  className="text-sm h-8 py-1 px-2 text-left"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[110px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_fee_business")}
                                >
                                  측정비(사업장)
                                  <MeasurementSortIcon column="measurement_fee_business" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-center w-[100px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("deposit_date_business")}
                                >
                                  측정비(입금일)
                                  <MeasurementSortIcon column="deposit_date_business" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[100px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_fee_national")}
                                >
                                  측정비(국고)
                                  <MeasurementSortIcon column="measurement_fee_national" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[110px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("measurement_fee_total")}
                                >
                                  측정비(합계)
                                  <MeasurementSortIcon column="measurement_fee_total" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[110px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("deposit_total")}
                                >
                                  입금액
                                  <MeasurementSortIcon column="deposit_total" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="text-right w-[100px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center justify-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("unpaid")}
                                >
                                  미수금액
                                  <MeasurementSortIcon column="unpaid" />
                                </div>
                                <div className="text-xs text-text-500 h-8 flex items-center justify-center">-</div>
                              </div>
                            </TableHead>
                            <TableHead className="w-[120px]">
                              <div className="space-y-1">
                                <div
                                  className="flex items-center cursor-pointer hover:text-primary-600"
                                  onClick={() => handleMeasurementSort("electronic_invoice_date")}
                                >
                                  계산서 발행일
                                  <MeasurementSortIcon column="electronic_invoice_date" />
                                </div>
                                <Select
                                  value={measurementFilters.hasInvoiceDate}
                                  onChange={(e) =>
                                    setMeasurementFilters({ ...measurementFilters, hasInvoiceDate: e.target.value })
                                  }
                                  options={[
                                    { value: "", label: "전체" },
                                    { value: "yes", label: "발행일 있음" },
                                    { value: "no", label: "발행일 없음" },
                                  ]}
                                  className="text-sm h-8 py-1 px-2 text-center"
                                />
                              </div>
                            </TableHead>
                            <TableHead className="w-[80px] text-center">관리</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {measurementRevenue.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={13} className="text-center text-text-500 py-8">
                                {loading ? "데이터를 불러오는 중..." : "항목이 없습니다."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            measurementRevenue.map((item) => {
                              const total = parseFloat(item.measurement_fee_total?.toString() || "0");
                              const deposit = parseFloat(item.deposit_total?.toString() || "0");
                              const unpaid = total - deposit;
                              return (
                                  <TableRow key={item.id} className="group relative hover:bg-blue-50/40 transition-colors growable-row">
                                    <TableCell className="w-[100px] pl-3 relative">
                                      <div className="flex items-center gap-2.5">
                                        {/* 처리 상태 신호등 */}
                                        {processingResults[item.id] && (
                                          <div 
                                            className={cn(
                                              "w-3 h-3 rounded-full flex-shrink-0 shadow-sm",
                                              processingResults[item.id].status === 'success' ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]" :
                                              processingResults[item.id].status === 'error' ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]" :
                                              processingResults[item.id].status === 'loading' ? "bg-yellow-400 animate-pulse" :
                                              "bg-gray-300"
                                            )}
                                            title={processingResults[item.id].message}
                                          />
                                        )}
                                        <span className="font-medium">{item.measurement_year}</span>
                                      </div>
                                      
                                      {/* 표준 블루 인디케이터 바 */}
                                      <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                                    </TableCell>

                                  <TableCell>{item.measurement_period}</TableCell>
                                  <TableCell className="font-medium truncate max-w-[200px]" title={item.business_name}>{item.business_name}</TableCell>
                                  <TableCell>{item.representative_name}</TableCell>
                                  <TableCell>{item.designated_office}</TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.measurement_fee_business)}원
                                  </TableCell>
                                  <TableCell className="text-right text-sm align-top">
                                    <div className="flex flex-col gap-1 items-end">
                                      {item.deposit_date_business ? (
                                        <div className="whitespace-nowrap">
                                          <span className="text-[10px] text-blue-400 mr-1">사:</span>
                                          <span className="text-blue-600">{item.deposit_date_business}</span>
                                        </div>
                                      ) : (!item.deposit_date_business_2 && !item.deposit_date_national ? <span className="text-gray-400">-</span> : null)}

                                      {item.deposit_date_business_2 && (
                                        <div className="whitespace-nowrap">
                                          <span className="text-[10px] text-indigo-400 mr-1">사2:</span>
                                          <span className="text-indigo-600">{item.deposit_date_business_2}</span>
                                        </div>
                                      )}

                                      {item.deposit_date_national && (
                                        <div className="whitespace-nowrap">
                                          <span className="text-[10px] text-gray-400 mr-1">국:</span>
                                          <span className="text-gray-600">{item.deposit_date_national}</span>
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatCurrency(item.measurement_fee_national)}원
                                  </TableCell>
                                  <TableCell className="text-right font-semibold">
                                    {formatCurrency(item.measurement_fee_total)}원
                                  </TableCell>
                                  <TableCell className="text-right align-top">
                                    <div className="flex flex-col items-end gap-1">
                                      <div
                                        className="font-semibold cursor-pointer hover:text-primary-600 border-b border-transparent hover:border-primary-600 transition-colors"
                                        onClick={() => {
                                          if (item.deposit_total && parseFloat(item.deposit_total.toString()) > 0) {
                                            setMeasurementDepositDetailItem(item);
                                            setIsMeasurementDepositDetailModalOpen(true);
                                          }
                                        }}
                                        title="클릭하여 상세 내역 보기"
                                      >
                                        {formatCurrency(item.deposit_total)}원
                                      </div>

                                      {/* 상세 내역 표시 */}
                                      {((item.deposit_amount_business || 0) > 0) && (
                                        <div className="text-[11px] text-blue-600 whitespace-nowrap">
                                          사: {formatCurrency(item.deposit_amount_business)}
                                          {item.deposit_date_business && <span className="text-[10px] ml-1 text-blue-400">({item.deposit_date_business.substring(5)})</span>}
                                        </div>
                                      )}
                                      {((item.deposit_amount_business_2 || 0) > 0) && (
                                        <div className="text-[11px] text-indigo-600 whitespace-nowrap">
                                          사2: {formatCurrency(item.deposit_amount_business_2)}
                                          {item.deposit_date_business_2 && <span className="text-[10px] ml-1 text-indigo-400">({item.deposit_date_business_2.substring(5)})</span>}
                                        </div>
                                      )}
                                      {((item.deposit_amount_national || 0) > 0) && (
                                        <div className="text-[11px] text-gray-500 whitespace-nowrap">
                                          국: {formatCurrency(item.deposit_amount_national)}
                                          {item.deposit_date_national && <span className="text-[10px] ml-1 text-gray-400">({item.deposit_date_national.substring(5)})</span>}
                                        </div>
                                      )}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right text-warning-600 font-semibold">
                                    {formatCurrency(unpaid)}원
                                  </TableCell>
                                  <TableCell>
                                    {item.electronic_invoice_date
                                      ? formatDateYYYYMMDD(item.electronic_invoice_date)
                                      : "-"}
                                  </TableCell>
                                  <TableCell>
                                     <Button
                                       variant="secondary"
                                       size="sm"
                                       onClick={() => handleMeasurementEdit(item)}
                                     >
                                       관리
                                     </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          )}
                          {/* 현재 페이지 합계 행 추가 */}
                          {measurementRevenue.length > 0 && (
                            <TableRow className="bg-slate-50 border-t-2 border-slate-200 sticky bottom-0 z-10 shadow-[0_-2px_4px_rgba(0,0,0,0.05)]">
                              <TableCell colSpan={5} className="text-center font-bold text-slate-700 py-3">현재 페이지 합계</TableCell>
                              <TableCell className="text-right font-bold text-slate-700">
                                {formatCurrency(measurementRevenue.reduce((sum, item) => sum + (item.measurement_fee_business || 0), 0))}원
                              </TableCell>
                              <TableCell className="text-right text-slate-500">-</TableCell>
                              <TableCell className="text-right font-bold text-slate-700">
                                {formatCurrency(measurementRevenue.reduce((sum, item) => sum + (item.measurement_fee_national || 0), 0))}원
                              </TableCell>
                              <TableCell className="text-right font-bold text-blue-700">
                                {formatCurrency(measurementRevenue.reduce((sum, item) => sum + (item.measurement_fee_total || 0), 0))}원
                              </TableCell>
                              <TableCell className="text-right font-bold text-slate-700">
                                {formatCurrency(measurementRevenue.reduce((sum, item) => sum + (item.deposit_total || 0), 0))}원
                              </TableCell>
                              <TableCell className="text-right font-bold text-warning-700">
                                {formatCurrency(
                                  measurementRevenue.reduce((sum, item) => {
                                    const total = parseFloat(item.measurement_fee_total?.toString() || "0") || 0;
                                    const deposit = parseFloat(item.deposit_total?.toString() || "0") || 0;
                                    return sum + (total - deposit);
                                  }, 0)
                                )}원
                              </TableCell>
                              <TableCell colSpan={2} className="text-center text-slate-400">-</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    {/* 페이지네이션 컨트롤 */}
                    <div className="mt-4 flex flex-col items-center gap-3 py-4 border-t border-surface-100">
                      <div className="flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={currentPage <= 1 || loading}
                          onClick={() => setCurrentPage(1)}
                          className="px-2"
                        >
                          맨앞
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={currentPage <= 1 || loading}
                          onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                          className="px-2"
                        >
                          이전
                        </Button>
                        
                        <div className="flex items-center px-4">
                          <span className="text-sm font-medium">
                            <span className="text-primary-600 font-bold">{currentPage}</span> / {totalPages}
                          </span>
                        </div>

                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={currentPage >= totalPages || loading}
                          onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                          className="px-2"
                        >
                          다음
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={currentPage >= totalPages || loading}
                          onClick={() => setCurrentPage(totalPages)}
                          className="px-2"
                        >
                          맨뒤
                        </Button>
                      </div>
                      <div className="text-xs text-text-500">
                        전체 {totalCount.toLocaleString()}개의 데이터 중 {(currentPage - 1) * 50 + 1}~{Math.min(currentPage * 50, totalCount)}번째 항목 표시 중
                      </div>
                    </div>
                  </div>
                );
};
