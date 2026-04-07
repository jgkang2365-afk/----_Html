import { DESIGNATED_OFFICE_OPTIONS } from "@/lib/constants/designated-offices";

export interface MeasurementRevenue {
  id: number;
  code: string;
  measurement_year: number;
  measurement_period: string;
  business_name: string;
  designated_office: string;
  measurement_fee_total: number | null;
  measurement_fee_business: number | null;
  measurement_fee_national: number | null;
  deposit_total: number | null;
  deposit_date_business: string | null;
  deposit_amount_business: number | null;
  deposit_date_business_2: string | null;
  deposit_amount_business_2: number | null;
  deposit_date_national: string | null;
  deposit_amount_national: number | null;
  invoice_email: string | null;
  electronic_invoice_date: string | null;
  invoice_email_2: string | null;
  electronic_invoice_date_2: string | null;
  representative_name: string | null;
  business_number: string | null;
  invoice_business_name: string | null;
  invoice_business_number: string | null;
}

export interface OtherRevenue {
  id: number;
  item_name: string;
  invoice_date: string | null;
  supply_amount: number | null;
  vat_amount: number | null;
  total_amount: number;
  deposit_date: string | null;
  deposit_amount: number | null;
  notes: string | null;
  designated_office: string | null;
  revenue_year: number | null;
  revenue_period: string | null;
}

export interface OfficeSummary {
  measurementRevenue: number;
  measurementVat: number;
  measurementTotal: number;
  measurementDeposit: number;
  measurementUnpaid: number;
  otherRevenue: number;
  otherVat: number;
  otherTotal: number;
  otherDeposit: number;
  otherUnpaid: number;
  totalRevenue: number;
  totalVat: number;
  totalAmount: number;
  totalDeposit: number;
  totalUnpaid: number;
}

export interface YearlySummary {
  firstHalf: OfficeSummary;
  secondHalf: OfficeSummary;
  total: OfficeSummary;
}

export interface SalesSummaryData {
  byOffice: Record<string, OfficeSummary>;
  byYear: Record<number, YearlySummary>;
}

export const OFFICE_OPTIONS = DESIGNATED_OFFICE_OPTIONS;
export const PERIOD_OPTIONS = [
  { value: "", label: "전체" },
  { value: "상반기", label: "상반기" },
  { value: "하반기", label: "하반기" },
];
