/**
 * 측정일지 번호 자동 부여 유틸리티
 * 공문연번, 연번, 5인 이상 연번을 자동으로 부여합니다.
 */

import { createClient } from "@/lib/supabase/server";
import { getDocumentNumberPrefix, toShortName } from "@/lib/constants/designated-offices";

/**
 * 공문연번 자동 부여
 * 지정한계_관할지청 + 측정년도 + 측정주기별로 마지막 번호를 조회하고 다음 번호를 부여합니다.
 * @param designatedOffice 지정한계_관할지청
 * @param measurementYear 측정년도
 * @param measurementPeriod 측정주기 (상반기/하반기)
 * @returns 공문연번 (예: "천-001")
 */
export async function assignDocumentNumber(
  designatedOffice: string,
  measurementYear: number,
  measurementPeriod: string
): Promise<string> {
  const supabase = await createClient();
  
  // 약칭으로 정규화 (기존 전체명과 호환)
  const normalizedOffice = toShortName(designatedOffice);
  const prefix = getDocumentNumberPrefix(normalizedOffice);

  // 해당 지정한계_관할지청 + 측정년도 + 측정주기의 마지막 공문연번 조회
  const officesToMatch = [normalizedOffice];
  if (normalizedOffice !== designatedOffice) {
    officesToMatch.push(designatedOffice);
  }
  
  const { data: lastJournal, error } = await supabase
    .from("measurement_journal")
    .select("document_number")
    .in("designated_office", officesToMatch)
    .eq("measurement_year", measurementYear)
    .eq("measurement_period", measurementPeriod)
    .not("document_number", "is", null)
    .like("document_number", `${prefix}-%`)
    .order("document_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("공문연번 조회 오류:", error);
    throw new Error("공문연번 조회 중 오류가 발생했습니다.");
  }

  let nextNumber = 1;

  if (lastJournal && lastJournal.document_number) {
    // 마지막 번호에서 숫자 부분 추출 (예: "천-001" -> 1)
    const match = lastJournal.document_number.match(/-(\d+)$/);
    if (match) {
      nextNumber = parseInt(match[1], 10) + 1;
    }
  }

  // 3자리 숫자로 포맷팅 (001, 002, 003...)
  const formattedNumber = String(nextNumber).padStart(3, "0");
  return `${prefix}-${formattedNumber}`;
}

/**
 * 연번 자동 부여
 * 지정한계_관할지청 + 측정년도 + 측정주기별로 마지막 번호를 조회하고 다음 번호를 부여합니다.
 * @param designatedOffice 지정한계_관할지청
 * @param measurementYear 측정년도
 * @param measurementPeriod 측정주기 (상반기/하반기)
 * @returns 연번 (예: "001")
 */
export async function assignSequenceNumber(
  designatedOffice: string,
  measurementYear: number,
  measurementPeriod: string
): Promise<string> {
  const supabase = await createClient();

  // 약칭으로 정규화 (기존 전체명과 호환)
  const normalizedOffice = toShortName(designatedOffice);

  // 해당 지정한계_관할지청 + 측정년도 + 측정주기의 마지막 연번 조회
  const officesToMatch = [normalizedOffice];
  if (normalizedOffice !== designatedOffice) {
    officesToMatch.push(designatedOffice);
  }
  
  const { data: lastJournal, error } = await supabase
    .from("measurement_journal")
    .select("sequence_number")
    .in("designated_office", officesToMatch)
    .eq("measurement_year", measurementYear)
    .eq("measurement_period", measurementPeriod)
    .not("sequence_number", "is", null)
    .order("sequence_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("연번 조회 오류:", error);
    throw new Error("연번 조회 중 오류가 발생했습니다.");
  }

  let nextNumber = 1;

  if (lastJournal && lastJournal.sequence_number) {
    // 연번은 숫자 문자열 (예: "001", "002")
    const num = parseInt(lastJournal.sequence_number, 10);
    if (!isNaN(num)) {
      nextNumber = num + 1;
    }
  }

  // 3자리 숫자로 포맷팅 (001, 002, 003...)
  return String(nextNumber).padStart(3, "0");
}

/**
 * 5인 이상 연번 자동 부여
 * 총인원이 5인 이상이면 마지막 번호를 조회하고 증가,
 * 5인 미만이면 직전 번호를 재사용합니다.
 * @param designatedOffice 지정한계_관할지청
 * @param measurementPeriod 측정주기 (상반기/하반기)
 * @param totalEmployees 총인원
 * @returns 5인 이상 연번 (예: "001")
 */
export async function assignFivePlusSequenceNumber(
  designatedOffice: string,
  measurementPeriod: string,
  totalEmployees: number | null
): Promise<string> {
  const supabase = await createClient();

  // 약칭으로 정규화 (기존 전체명과 호환)
  const normalizedOffice = toShortName(designatedOffice);

  // 총인원이 5인 미만인 경우
  if (!totalEmployees || totalEmployees < 5) {
    // 직전 5인 이상 연번 조회 (중복 허용, 기존 전체명과 약칭 모두 매칭)
    // .in() 사용하여 더 안전하게 처리
    const officesToMatch = [normalizedOffice];
    if (normalizedOffice !== designatedOffice) {
      officesToMatch.push(designatedOffice);
    }
    
    const { data: lastJournal, error } = await supabase
      .from("measurement_journal")
      .select("five_plus_sequence")
      .in("designated_office", officesToMatch)
      .eq("measurement_period", measurementPeriod)
      .not("five_plus_sequence", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      console.error("5인 이상 연번 조회 오류:", error);
      // 오류가 발생해도 기본값 반환
      return "000";
    }

    if (lastJournal && lastJournal.five_plus_sequence) {
      // 직전 번호 재사용
      return lastJournal.five_plus_sequence;
    }

    // 직전 번호가 없으면 "000" 반환
    return "000";
  }

  // 총인원이 5인 이상인 경우: 마지막 번호 조회 후 증가 (기존 전체명과 약칭 모두 매칭)
  // .in() 사용하여 더 안전하게 처리
  const officesToMatch = [normalizedOffice];
  if (normalizedOffice !== designatedOffice) {
    officesToMatch.push(designatedOffice);
  }
  
  const { data: lastJournal, error } = await supabase
    .from("measurement_journal")
    .select("five_plus_sequence")
    .in("designated_office", officesToMatch)
    .eq("measurement_period", measurementPeriod)
    .not("five_plus_sequence", "is", null)
    .order("five_plus_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("5인 이상 연번 조회 오류:", error);
    throw new Error("5인 이상 연번 조회 중 오류가 발생했습니다.");
  }

  let nextNumber = 1;

  if (lastJournal && lastJournal.five_plus_sequence) {
    const num = parseInt(lastJournal.five_plus_sequence, 10);
    if (!isNaN(num)) {
      nextNumber = num + 1;
    }
  }

  // 3자리 숫자로 포맷팅 (001, 002, 003...)
  return String(nextNumber).padStart(3, "0");
}

/**
 * 측정일지 저장 시 모든 번호를 자동으로 부여합니다.
 * @param journalData 측정일지 데이터
 * @returns 부여된 번호가 포함된 측정일지 데이터
 */
export async function assignAllNumbers(journalData: {
  designated_office: string;
  measurement_year: number;
  measurement_period: string;
  total_employees?: number | null;
  document_number?: string | null;
  sequence_number?: string | null;
  five_plus_sequence?: string | null;
}): Promise<{
  document_number: string;
  sequence_number: string;
  five_plus_sequence: string;
}> {
  // 약칭으로 정규화 (기존 전체명과 호환)
  const normalizedOffice = toShortName(journalData.designated_office);

  // 공문연번이 없으면 자동 부여
  let documentNumber = journalData.document_number;
  if (!documentNumber) {
    documentNumber = await assignDocumentNumber(
      normalizedOffice,
      journalData.measurement_year,
      journalData.measurement_period
    );
  }

  // 연번이 없으면 자동 부여
  let sequenceNumber = journalData.sequence_number;
  if (!sequenceNumber) {
    sequenceNumber = await assignSequenceNumber(
      normalizedOffice,
      journalData.measurement_year,
      journalData.measurement_period
    );
  }

  // 5인 이상 연번이 없으면 자동 부여
  let fivePlusSequence = journalData.five_plus_sequence;
  if (!fivePlusSequence) {
    fivePlusSequence = await assignFivePlusSequenceNumber(
      normalizedOffice,
      journalData.measurement_period,
      journalData.total_employees || null
    );
  }

  return {
    document_number: documentNumber,
    sequence_number: sequenceNumber,
    five_plus_sequence: fivePlusSequence,
  };
}
