import React, { useState, useEffect } from "react";
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
import {
  MeasurementRevenue,
  OtherRevenue,
  SalesSummaryData,
  PERIOD_OPTIONS,
} from "./types";
import { 
  DESIGNATED_OFFICES_FOR_SALES,
  toShortName 
} from "@/lib/constants/designated-offices";

interface StatTablesProps {
  summary: SalesSummaryData;
  measurementRevenue: MeasurementRevenue[];
  otherRevenue: OtherRevenue[];
  allOtherData?: OtherRevenue[];
  formatCurrency: (amount: number | null | undefined) => string;
  yearOptions: { value: string; label: string }[];
  yearlySummaryYear: string;
  setYearlySummaryYear: (year: string) => void;
  yearlySummaryPeriod: string;
  setYearlySummaryPeriod: (period: string) => void;
  unpaidSummaryYear: string;
  setUnpaidSummaryYear: (year: string) => void;
  unpaidSummaryPeriod: string;
  setUnpaidSummaryPeriod: (period: string) => void;
}

export const StatTables: React.FC<StatTablesProps> = ({
  summary,
  measurementRevenue,
  otherRevenue,
  allOtherData,
  formatCurrency,
  yearOptions,
  yearlySummaryYear,
  setYearlySummaryYear,
  yearlySummaryPeriod,
  setYearlySummaryPeriod,
  unpaidSummaryYear,
  setUnpaidSummaryYear,
  unpaidSummaryPeriod,
  setUnpaidSummaryPeriod,
}) => {
  // 서울 시간대(Asia/Seoul) 기준으로 현재 년도 및 주기 가져오기
  const seoulNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const currentYear = seoulNow.getFullYear().toString();
  const currentPeriod = (seoulNow.getMonth() + 1) <= 6 ? "상반기" : "하반기";

  // 미수금 상세 모달 상태
  const [isUnpaidDetailModalOpen, setIsUnpaidDetailModalOpen] = useState(false);
  const [unpaidDetailTitle, setUnpaidDetailTitle] = useState("");
  const [unpaidDetailList, setUnpaidDetailList] = useState<any[]>([]);

  const isMatchSelection = (item: any, target: string) => {
    if (!target) return true;
    
    // 1. 주기 문자열로 매칭 시도
    const period = item.measurement_period || item.revenue_period;
    if (period) {
      if (target === "상반기") return period.includes("상반기") || period.includes("수시(상)");
      if (target === "하반기") return period.includes("하반기") || period.includes("수시(하)");
      return period.includes(target);
    }
    
    // 2. 문자열이 없으면 날짜로 매칭 시도 (측정비 한정)
    const startDate = item.measurement_start_date;
    if (startDate) {
      const month = parseInt(startDate.split("-")[1]);
      if (target === "상반기") return month >= 1 && month <= 6;
      if (target === "하반기") return month >= 7 && month <= 12;
    }
    
    return false;
  };

  const officeLabels: Record<string, string> = {
    천안: "천안",
    대전: "대전",
    평택: "평택",
    경기: "경기",
    기타: "기타",
  };

  const handleUnpaidBusinessClick = (
    office: string | null,
    category: "total" | "business" | "national",
    onlyUnpaid: boolean = false
  ) => {
    const officeLabel = office ? officeLabels[office] || office : "전체";
    const statusLabel = onlyUnpaid ? "미수" : "전체";
    let categoryLabel = "";
    if (category === "total") categoryLabel = `${statusLabel} 합계`;
    else if (category === "business") categoryLabel = `${statusLabel} 사업장`;
    else categoryLabel = `${statusLabel} 국고`;

    const targetYear = unpaidSummaryYear ? parseInt(unpaidSummaryYear) : null;
    const targetPeriod = unpaidSummaryPeriod;

    // 1. 측정일지 데이터 필터링 및 매핑
    const filteredMeasurement = measurementRevenue.filter((item) => {
      const isOtherRevenue = item.revenue_type === '기타매출';
      let officeMatch = false;
      if (isOtherRevenue) {
        officeMatch = !office || office === "기타";
      } else {
        const shortOfficeName = toShortName(item.designated_office || "");
        officeMatch = !office
          ? true
          : office === "기타"
          ? !shortOfficeName || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(shortOfficeName)
          : shortOfficeName === office;
      }
      
      const yearMatch = !targetYear || item.measurement_year === targetYear;
      const periodMatch = isMatchSelection(item, targetPeriod);
      return officeMatch && yearMatch && periodMatch;
    }).map(item => {
      const biz_fee = item.measurement_fee_business || 0;
      const biz_dep = (item.deposit_amount_business || 0) + (item.deposit_amount_business_2 || 0);
      const nat_fee = item.measurement_fee_national || 0;
      const nat_dep = item.deposit_amount_national || 0;
      const total_fee = biz_fee + nat_fee;
      const total_dep = biz_dep + nat_dep;
      
      let unpaid = 0;
      if (category === "total") unpaid = total_fee - total_dep;
      else if (category === "business") unpaid = biz_fee - biz_dep;
      else unpaid = nat_fee - nat_dep;

      return { 
        business_name: item.business_name,
        year: item.measurement_year,
        period: item.measurement_period,
        biz_fee, biz_dep, 
        nat_fee, nat_dep,
        unpaid_amount: unpaid 
      };
    });

    // 2. 기타 매출 데이터 필터링 및 매핑 (기타 행인 경우)
    let filteredOther: any[] = [];
    if (!office || office === "기타") {
      const otherDataToUse = allOtherData || otherRevenue;
      filteredOther = otherDataToUse.filter(item => {
        const yearMatch = !targetYear || item.revenue_year === targetYear;
        const periodMatch = isMatchSelection(item, targetPeriod);
        return yearMatch && periodMatch;
      }).map(item => {
        const amount = item.total_amount || 0;
        const deposit = item.deposit_amount || 0;
        const unpaid = amount - deposit;

        return {
          business_name: item.business_name,
          year: item.revenue_year,
          period: item.revenue_period,
          biz_fee: amount,
          biz_dep: deposit,
          nat_fee: 0,
          nat_dep: 0,
          unpaid_amount: (category === "national" ? 0 : unpaid)
        };
      });
    }

    const businessList = [...filteredMeasurement, ...filteredOther]
      .filter((item) => !onlyUnpaid || item.unpaid_amount > 0)
      .sort((a, b) => b.unpaid_amount - a.unpaid_amount);

    setUnpaidDetailTitle(`${officeLabel} - ${categoryLabel} 상세 내역`);
    setUnpaidDetailList(businessList);
    setIsUnpaidDetailModalOpen(true);
  };

  return (
    <>
      {/* 1. 년도별 집계 현황 */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text-900">년도별 집계 현황</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">년도 선택:</label>
              <Select
                value={yearlySummaryYear}
                onChange={(e) => setYearlySummaryYear(e.target.value)}
                options={[{ value: "", label: "전체" }, ...yearOptions]}
                className="w-32 h-10 bg-blue-50/50 border-blue-400 text-blue-700 font-medium rounded-xl text-center px-2 py-0 border-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">주기 선택:</label>
              <Select
                value={yearlySummaryPeriod}
                onChange={(e) => setYearlySummaryPeriod(e.target.value)}
                options={PERIOD_OPTIONS}
                className="w-32 h-10 bg-blue-50/50 border-blue-400 text-blue-700 font-medium rounded-xl text-center px-2 py-0 border-2"
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-sky-100 border-b-2 border-sky-200 pointer-events-none">
                <TableHead className="text-center font-semibold py-3 px-3 text-black w-[60px] pl-2.5">연번</TableHead>
                <TableHead className="text-left font-semibold py-3 px-4 text-black w-[120px] pl-2.5">매출 구분</TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 text-black">측정비</TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 text-black">부가세</TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 text-black">측정비(총액)</TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 text-black">입금액</TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 text-black">미수금(부가세포함)</TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 whitespace-nowrap text-black">
                  {yearlySummaryYear || "전체"}년 상반기
                </TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 whitespace-nowrap text-black">
                  {yearlySummaryYear || "전체"}년 하반기
                </TableHead>
                <TableHead className="text-right font-semibold py-3 px-4 whitespace-nowrap text-black">
                  {yearlySummaryYear || "전체"}년도 측정비
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(() => {
                const totalRow = {
                  measurementFee: 0,
                  vat: 0,
                  total: 0,
                  deposit: 0,
                  unpaid: 0,
                  firstHalf: 0,
                  secondHalf: 0,
                  yearlyTotal: 0,
                };

                const officeData = [...DESIGNATED_OFFICES_FOR_SALES].map((office) => {
                  let measurementFee = 0;
                  let vat = 0;
                  let totalValue = 0;
                  let deposit = 0;
                  let unpaid = 0;

                  const targetYear = yearlySummaryYear ? parseInt(yearlySummaryYear) : null;
                  const targetPeriod = yearlySummaryPeriod;

                  // 1. 측정비(측정일지) 집계
                  measurementRevenue
                    .filter((item) => {
                      const isOtherRevenue = item.revenue_type === '기타매출';
                      let officeMatch = false;
                      if (isOtherRevenue) {
                        officeMatch = (office === "기타");
                      } else {
                        const shortOfficeName = toShortName(item.designated_office || "");
                        officeMatch = office === "기타" 
                          ? !shortOfficeName || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(shortOfficeName)
                          : shortOfficeName === office;
                      }
                      const yearMatch = !targetYear || item.measurement_year === targetYear;
                      const periodMatch = isMatchSelection(item, targetPeriod);
                      return officeMatch && yearMatch && periodMatch;
                    })
                    .forEach((item) => {
                      const fee = item.measurement_fee_total || 0;
                      const dep = item.deposit_total || 0;
                      measurementFee += fee;
                      totalValue += fee;
                      deposit += dep;
                      unpaid += fee - dep;
                    });

                  // 2. [추가] 기타 매출 집계 (사용자 요청: 기타 = 기타 매출)
                  // '기타' 행인 경우에만 기타 매출 데이터를 합산함
                  if (office === "기타") {
                    const otherDataToUse = allOtherData || otherRevenue;
                    otherDataToUse.forEach(item => {
                      const yearMatch = !targetYear || item.revenue_year === targetYear;
                      const periodMatch = isMatchSelection(item, targetPeriod);
                      if (yearMatch && periodMatch) {
                        measurementFee += item.supply_amount || 0;
                        vat += item.vat_amount || 0;
                        totalValue += item.total_amount || 0;
                        deposit += item.deposit_amount || 0;
                        unpaid += (item.total_amount || 0) - (item.deposit_amount || 0);
                      }
                    });
                  }

                  let firstHalf = 0;
                  let secondHalf = 0;
                  if (targetYear) {
                    // 측정비 상/하반기 집계
                    measurementRevenue
                      .filter((item) => {
                        const isOtherRevenue = item.revenue_type === '기타매출';
                        let officeMatch = false;
                        if (isOtherRevenue) {
                          officeMatch = (office === "기타");
                        } else {
                          const shortOfficeName = toShortName(item.designated_office || "");
                          officeMatch = office === "기타"
                            ? !shortOfficeName || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(shortOfficeName)
                            : shortOfficeName === office;
                        }
                        return officeMatch && item.measurement_year === targetYear;
                      })
                      .forEach((item) => {
                        if (isMatchSelection(item, "상반기")) firstHalf += item.measurement_fee_total || 0;
                        if (isMatchSelection(item, "하반기")) secondHalf += item.measurement_fee_total || 0;
                      });
                    
                    // 기타 매출 상/하반기 집계 (기타 행인 경우)
                    if (office === "기타") {
                      const otherDataToUse = allOtherData || otherRevenue;
                      otherDataToUse.forEach(item => {
                        if (item.revenue_year === targetYear) {
                          if (isMatchSelection(item, "상반기")) firstHalf += item.total_amount || 0;
                          if (isMatchSelection(item, "하반기")) secondHalf += item.total_amount || 0;
                        }
                      });
                    }
                  }

                  totalRow.measurementFee += measurementFee;
                  totalRow.vat += vat;
                  totalRow.total += totalValue;
                  totalRow.deposit += deposit;
                  totalRow.unpaid += unpaid;
                  totalRow.firstHalf += firstHalf;
                  totalRow.secondHalf += secondHalf;
                  totalRow.yearlyTotal += firstHalf + secondHalf;

                  return {
                    office,
                    label: officeLabels[office] || office,
                    measurementFee,
                    vat,
                    totalValue,
                    deposit,
                    unpaid,
                    firstHalf,
                    secondHalf,
                    yearlyTotal: firstHalf + secondHalf,
                  };
                });

                return (
                  <>
                    <TableRow className="bg-gray-100/80 border-t-2 border-gray-300 group relative growable-row">
                      <TableCell colSpan={2} className="font-bold text-gray-900 text-center relative">
                        {/* 표준 블루 인디케이터 바 */}
                        <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                        합계
                      </TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(totalRow.measurementFee)}</TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(totalRow.vat)}</TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(totalRow.total)}</TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(totalRow.deposit)}</TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(totalRow.unpaid)}</TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(yearlySummaryYear ? totalRow.firstHalf : totalRow.total)}</TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(yearlySummaryYear ? totalRow.secondHalf : totalRow.total)}</TableCell>
                      <TableCell className="text-right font-bold text-black py-3 px-4">{formatCurrency(yearlySummaryYear ? totalRow.yearlyTotal : totalRow.total)}</TableCell>
                    </TableRow>
                    {officeData.map((data, index) => (
                      <TableRow key={data.office} className="border-b group relative hover:bg-blue-50/40 transition-colors growable-row">
                        <TableCell className="text-center py-2 pl-2.5 relative">
                          {/* 표준 블루 인디케이터 바 */}
                          <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                          {index + 1}
                        </TableCell>
                        <TableCell className="text-left font-medium pl-2.5">{data.label}</TableCell>
                        <TableCell className="text-right">{formatCurrency(data.measurementFee)}</TableCell>
                        <TableCell className="text-right">{data.vat > 0 ? formatCurrency(data.vat) : "-"}</TableCell>
                        <TableCell className="text-right">{formatCurrency(data.totalValue)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(data.deposit)}</TableCell>
                        <TableCell className="text-right font-bold text-warning-600">{formatCurrency(data.unpaid)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(yearlySummaryYear ? data.firstHalf : data.totalValue)}</TableCell>
                        <TableCell className="text-right">{formatCurrency(yearlySummaryYear ? data.secondHalf : data.totalValue)}</TableCell>
                        <TableCell className="text-right font-bold">{formatCurrency(yearlySummaryYear ? data.yearlyTotal : data.totalValue)}</TableCell>
                      </TableRow>
                    ))}
                  </>
                );
              })()}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* 2. 년도별 측정비 입금 및 미수금 집계 현황 */}
      <Card className="p-4 mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-text-900">년도별 측정비 입금 및 미수금 집계 현황</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">년도 선택:</label>
              <Select
                value={unpaidSummaryYear}
                onChange={(e) => setUnpaidSummaryYear(e.target.value)}
                options={[{ value: "", label: "전체" }, ...yearOptions]}
                className="w-32 h-10 bg-blue-50/50 border-blue-400 text-blue-700 font-medium rounded-xl text-center px-2 py-0 border-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">주기 선택:</label>
              <Select
                value={unpaidSummaryPeriod}
                onChange={(e) => setUnpaidSummaryPeriod(e.target.value)}
                options={PERIOD_OPTIONS}
                className="w-32 h-10 bg-blue-50/50 border-blue-400 text-blue-700 font-medium rounded-xl text-center px-2 py-0 border-2"
              />
            </div>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-sky-100 border-b border-sky-200 pointer-events-none">
              <TableHead rowSpan={2} className="text-center font-bold text-black border-r align-middle pl-2.5 w-[100px]">구분</TableHead>
              <TableHead colSpan={4} className="text-center font-black bg-slate-100 text-slate-800 border-r-2">전체 합계</TableHead>
              <TableHead colSpan={4} className="text-center font-black bg-blue-50 text-blue-800 border-r-2">측정비(사업장)</TableHead>
              <TableHead colSpan={4} className="text-center font-black bg-emerald-50 text-emerald-800">측정비(국고)</TableHead>
            </TableRow>
            <TableRow className="bg-sky-100 border-b-2 border-sky-200 pointer-events-none">
              <TableHead className="text-center">사업장</TableHead>
              <TableHead className="text-center">소계</TableHead>
              <TableHead className="text-center">입금액</TableHead>
              <TableHead className="text-center border-r-2">미수금</TableHead>
              <TableHead className="text-center">사업장</TableHead>
              <TableHead className="text-center">소계</TableHead>
              <TableHead className="text-center">입금액</TableHead>
              <TableHead className="text-center border-r-2">미수금</TableHead>
              <TableHead className="text-center">사업장</TableHead>
              <TableHead className="text-center">소계</TableHead>
              <TableHead className="text-center">입금액</TableHead>
              <TableHead className="text-center">미수금</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(() => {
              const unpaidAnalysis = [...DESIGNATED_OFFICES_FOR_SALES].map((office) => {
                const targetYear = unpaidSummaryYear ? parseInt(unpaidSummaryYear) : null;
                const targetPeriod = unpaidSummaryPeriod;

                const filtered = measurementRevenue.filter((item) => {
                  const isOtherRevenue = item.revenue_type === '기타매출';
                  let officeMatch = false;
                  if (isOtherRevenue) {
                    officeMatch = (office === "기타");
                  } else {
                    const shortOfficeName = toShortName(item.designated_office || "");
                    officeMatch = office === "기타"
                      ? !shortOfficeName || !(DESIGNATED_OFFICES_FOR_SALES as readonly string[]).includes(shortOfficeName)
                      : shortOfficeName === office;
                  }
                  const yearMatch = !targetYear || item.measurement_year === targetYear;
                  const periodMatch = isMatchSelection(item, targetPeriod);
                  return officeMatch && yearMatch && periodMatch;
                });

                let totalCount = 0, totalUnpaidCount = 0, totalSubtotal = 0, totalDeposit = 0;
                let bizCount = 0, bizUnpaidCount = 0, bizSubtotal = 0, bizDeposit = 0;
                let natCount = 0, natUnpaidCount = 0, natSubtotal = 0, natDeposit = 0;

                filtered.forEach(item => {
                  const bFee = item.measurement_fee_business || 0;
                  const bDep = (item.deposit_amount_business || 0) + (item.deposit_amount_business_2 || 0);
                  const nFee = item.measurement_fee_national || 0;
                  const nDep = item.deposit_amount_national || 0;

                  const bUnpaid = bFee - bDep;
                  const nUnpaid = nFee - nDep;
                  const tUnpaid = (bFee + nFee) - (bDep + nDep);

                  if (bFee > 0 || bDep > 0) { 
                    bizCount++; 
                    if (bUnpaid > 0) bizUnpaidCount++;
                    bizSubtotal += bFee; bizDeposit += bDep; 
                  }
                  if (nFee > 0 || nDep > 0) { 
                    natCount++; 
                    if (nUnpaid > 0) natUnpaidCount++;
                    natSubtotal += nFee; natDeposit += nDep; 
                  }
                  if (bFee + nFee > 0 || bDep + nDep > 0) { 
                    totalCount++; 
                    if (tUnpaid > 0) totalUnpaidCount++;
                    totalSubtotal += (bFee + nFee); totalDeposit += (bDep + nDep); 
                  }
                });

                // [수정] '기타' 행인 경우 기타 매출(other_revenue)의 미수금 데이터도 합산함
                if (office === "기타") {
                  const otherDataToUse = allOtherData || otherRevenue;
                  otherDataToUse.forEach(item => {
                    const yearMatch = !targetYear || item.revenue_year === targetYear;
                    const periodMatch = isMatchSelection(item, targetPeriod);
                    if (yearMatch && periodMatch) {
                      const amount = item.total_amount || 0;
                      const deposit = item.deposit_amount || 0;
                      const unpaid = amount - deposit;
                      
                      totalCount++;
                      if (unpaid > 0) totalUnpaidCount++;
                      totalSubtotal += amount;
                      totalDeposit += deposit;
                      
                      // 기타 매출은 성격상 '사업장' 미수금으로 분류
                      bizCount++;
                      if (unpaid > 0) bizUnpaidCount++;
                      bizSubtotal += amount;
                      bizDeposit += deposit;
                    }
                  });
                }
                
                return { office, label: officeLabels[office] || office, totalCount, totalUnpaidCount, totalSubtotal, totalDeposit, bizCount, bizUnpaidCount, bizSubtotal, bizDeposit, natCount, natUnpaidCount, natSubtotal, natDeposit };
              });

              const totalRow = unpaidAnalysis.reduce((acc, row) => {
                acc.totalCount += row.totalCount;
                acc.totalUnpaidCount += row.totalUnpaidCount;
                acc.totalSubtotal += row.totalSubtotal;
                acc.totalDeposit += row.totalDeposit;
                acc.bizCount += row.bizCount;
                acc.bizUnpaidCount += row.bizUnpaidCount;
                acc.bizSubtotal += row.bizSubtotal;
                acc.bizDeposit += row.bizDeposit;
                acc.natCount += row.natCount;
                acc.natUnpaidCount += row.natUnpaidCount;
                acc.natSubtotal += row.natSubtotal;
                acc.natDeposit += row.natDeposit;
                return acc;
              }, {
                totalCount: 0, totalUnpaidCount: 0, totalSubtotal: 0, totalDeposit: 0,
                bizCount: 0, bizUnpaidCount: 0, bizSubtotal: 0, bizDeposit: 0,
                natCount: 0, natUnpaidCount: 0, natSubtotal: 0, natDeposit: 0
              });

              return (
                <>
                  <TableRow className="border-t-2 border-b-2 border-gray-200 bg-gray-50 text-black group relative hover:bg-blue-50/40 transition-colors growable-row">
                    <TableCell className="font-bold text-center relative">
                      {/* 표준 블루 인디케이터 바 */}
                      <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                      합계
                    </TableCell>
                    <TableCell className="text-center font-bold">
                      <span className="text-red-600 cursor-pointer underline hover:text-red-800" onClick={() => handleUnpaidBusinessClick(null, "total", true)}>{totalRow.totalUnpaidCount}</span>
                      <span className="mx-1 text-gray-400">/</span>
                      <span className="text-blue-600 cursor-pointer underline hover:text-blue-800" onClick={() => handleUnpaidBusinessClick(null, "total", false)}>{totalRow.totalCount}</span>
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totalRow.totalSubtotal)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totalRow.totalDeposit)}</TableCell>
                    <TableCell className="text-right font-bold text-warning-600 border-r-2">{formatCurrency(totalRow.totalSubtotal - totalRow.totalDeposit)}</TableCell>
                    
                    <TableCell className="text-center font-bold">
                      <span className="text-red-600 cursor-pointer underline hover:text-red-800" onClick={() => handleUnpaidBusinessClick(null, "business", true)}>{totalRow.bizUnpaidCount}</span>
                      <span className="mx-1 text-gray-400">/</span>
                      <span className="text-blue-600 cursor-pointer underline hover:text-blue-800" onClick={() => handleUnpaidBusinessClick(null, "business", false)}>{totalRow.bizCount}</span>
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totalRow.bizSubtotal)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totalRow.bizDeposit)}</TableCell>
                    <TableCell className="text-right font-bold text-warning-600 border-r-2">{formatCurrency(totalRow.bizSubtotal - totalRow.bizDeposit)}</TableCell>
                    
                    <TableCell className="text-center font-bold">
                      <span className="text-red-600 cursor-pointer underline hover:text-red-800" onClick={() => handleUnpaidBusinessClick(null, "national", true)}>{totalRow.natUnpaidCount}</span>
                      <span className="mx-1 text-gray-400">/</span>
                      <span className="text-blue-600 cursor-pointer underline hover:text-blue-800" onClick={() => handleUnpaidBusinessClick(null, "national", false)}>{totalRow.natCount}</span>
                    </TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totalRow.natSubtotal)}</TableCell>
                    <TableCell className="text-right font-bold">{formatCurrency(totalRow.natDeposit)}</TableCell>
                    <TableCell className="text-right font-bold text-warning-600">{formatCurrency(totalRow.natSubtotal - totalRow.natDeposit)}</TableCell>
                  </TableRow>
                  {unpaidAnalysis.map(row => (
                    <TableRow key={row.office} className="border-b group relative hover:bg-blue-50/40 transition-colors growable-row">
                      <TableCell className="font-medium text-center relative">
                        {/* 표준 블루 인디케이터 바 */}
                        <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                        {row.label}
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-red-600 cursor-pointer underline hover:text-red-800" onClick={() => handleUnpaidBusinessClick(row.office, "total", true)}>{row.totalUnpaidCount}</span>
                        <span className="mx-1 text-gray-400">/</span>
                        <span className="text-blue-600 cursor-pointer underline hover:text-blue-800" onClick={() => handleUnpaidBusinessClick(row.office, "total", false)}>{row.totalCount}</span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(row.totalSubtotal)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.totalDeposit)}</TableCell>
                      <TableCell className="text-right font-bold text-warning-600 border-r-2">{formatCurrency(row.totalSubtotal - row.totalDeposit)}</TableCell>
                      
                      <TableCell className="text-center">
                        <span className="text-red-600 cursor-pointer underline hover:text-red-800" onClick={() => handleUnpaidBusinessClick(row.office, "business", true)}>{row.bizUnpaidCount}</span>
                        <span className="mx-1 text-gray-400">/</span>
                        <span className="text-blue-600 cursor-pointer underline hover:text-blue-800" onClick={() => handleUnpaidBusinessClick(row.office, "business", false)}>{row.bizCount}</span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(row.bizSubtotal)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.bizDeposit)}</TableCell>
                      <TableCell className="text-right font-bold text-warning-600 border-r-2">{formatCurrency(row.bizSubtotal - row.bizDeposit)}</TableCell>
                      
                      <TableCell className="text-center">
                        <span className="text-red-600 cursor-pointer underline hover:text-red-800" onClick={() => handleUnpaidBusinessClick(row.office, "national", true)}>{row.natUnpaidCount}</span>
                        <span className="mx-1 text-gray-400">/</span>
                        <span className="text-blue-600 cursor-pointer underline hover:text-blue-800" onClick={() => handleUnpaidBusinessClick(row.office, "national", false)}>{row.natCount}</span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(row.natSubtotal)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(row.natDeposit)}</TableCell>
                      <TableCell className="text-right font-bold text-warning-600">{formatCurrency(row.natSubtotal - row.natDeposit)}</TableCell>
                    </TableRow>
                  ))}
                </>
              );
            })()}
          </TableBody>
        </Table>
      </Card>

      {/* 미수금 상세 내역 모달 */}
      <Modal isOpen={isUnpaidDetailModalOpen} onClose={() => setIsUnpaidDetailModalOpen(false)} title={unpaidDetailTitle} size="xl">
        <div className="w-full">
          <Table maxHeight="max-h-[60vh]">
            <TableHeader className="sticky top-0 z-10 shadow-sm">
              <TableRow className="bg-sky-100 border-b-2 border-sky-200 pointer-events-none">
                <TableHead className="w-[200px] text-left pl-2.5 whitespace-normal break-all">사업장명</TableHead>
                <TableHead className="text-center w-[80px] whitespace-nowrap">년도</TableHead>
                <TableHead className="text-center w-[100px] whitespace-nowrap">주기</TableHead>
                <TableHead className="text-right whitespace-nowrap">사업장 부담</TableHead>
                <TableHead className="text-right whitespace-nowrap">국고 부담</TableHead>
                <TableHead className="text-right whitespace-nowrap">입금액</TableHead>
                <TableHead className="text-right whitespace-nowrap">미수금</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unpaidDetailList.map((item, idx) => (
                <TableRow key={idx} className="group relative hover:bg-blue-50/40 transition-colors growable-row">
                  <TableCell className="relative pl-2.5 whitespace-normal break-all leading-tight">
                    {/* 표준 블루 인디케이터 바 */}
                    <div className="absolute left-0 top-1 bottom-1 w-[4px] bg-blue-600 rounded-r-sm opacity-0 group-hover:opacity-100 scale-y-0 group-hover:scale-y-100 transition-all duration-200 origin-center pointer-events-none" />
                    {item.business_name}
                  </TableCell>
                  <TableCell className="text-center whitespace-nowrap">{item.year}</TableCell>
                  <TableCell className="text-center whitespace-nowrap">{item.period}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(item.biz_fee)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(item.nat_fee)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{formatCurrency(item.biz_dep + item.nat_dep)}</TableCell>
                  <TableCell className="text-right text-warning-600 font-bold whitespace-nowrap">{formatCurrency(item.unpaid_amount)}원</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Modal>
    </>
  );
};
