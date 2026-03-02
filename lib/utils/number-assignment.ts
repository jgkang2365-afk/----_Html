/**
 * 측정일지 번호 자동 부여 유틸리티
 * 공문연번, 연번, 5인 이상 연번을 자동으로 부여합니다.
 */

// Force Rebuild 2
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

  // 약칭으로 정규화 (기존 전체명과 호환) - Trim input
  const normalizedOffice = toShortName(String(designatedOffice).trim());
  const prefix = getDocumentNumberPrefix(normalizedOffice);

  // 해당 지정한계_관할지청 + 측정년도 + 측정주기의 마지막 공문연번 조회
  // 문자열 정렬이 아닌 숫자 정렬을 위해 모든 레코드를 가져와서 클라이언트에서 정렬
  const officesToMatch = [normalizedOffice];
  if (normalizedOffice !== designatedOffice) {
    officesToMatch.push(designatedOffice);
  }

  // 디버깅: 조회 조건 로그
  console.log(`[공문연번 부여] 조회 조건:`, {
    designatedOffice: normalizedOffice,
    measurementYear,
    measurementPeriod: String(measurementPeriod).trim(),
    prefix,
    officesToMatch
  });

  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select("document_number, designated_office, measurement_year, measurement_period")
    .in("designated_office", officesToMatch)
    .eq("measurement_year", measurementYear)
    // .eq("measurement_period", measurementPeriod) // 주기가 달라도 (예: 상반기 vs 상반기(수시)) 같은 년도/지청이면 연번 공유
    .not("document_number", "is", null)
    .like("document_number", `${prefix}-%`);

  if (error && error.code !== "PGRST116") {
    console.error("공문연번 조회 오류:", error);
    throw new Error("공문연번 조회 중 오류가 발생했습니다.");
  }

  // 디버깅: 조회된 데이터 로그
  console.log(`[공문연번 부여] 조회된 레코드 수: ${journals?.length || 0}건`);
  if (journals && journals.length > 0) {
    console.log(`[공문연번 부여] 조회된 공문연번 상세 (최대 10개):`, journals.slice(0, 10).map(j => ({
      document_number: j.document_number,
      designated_office: j.designated_office,
      measurement_year: j.measurement_year,
      measurement_period: j.measurement_period
    })));
    if (journals.length > 10) {
      console.log(`[공문연번 부여] ... 외 ${journals.length - 10}건 더 있음`);
    }
  }

  let nextNumber = 1;

  if (!error && journals && journals.length > 0) {
    // 숫자 부분을 추출하여 숫자로 정렬
    const sorted = journals
      .map(j => {
        const match = j.document_number.match(/-(\d+)$/);
        return {
          ...j,
          num: match ? parseInt(match[1], 10) : 0
        };
      })
      .filter(j => !isNaN(j.num) && j.num > 0)
      .sort((a, b) => b.num - a.num); // 내림차순 정렬

    if (sorted.length > 0) {
      // 가장 큰 숫자에서 1을 더함
      nextNumber = sorted[0].num + 1;
      console.log(`[공문연번 부여] ===== 최대 공문연번 분석 =====`);
      console.log(`[공문연번 부여] 최대 공문연번: ${sorted[0].document_number} (숫자: ${sorted[0].num})`);
      console.log(`[공문연번 부여] 다음 번호: ${nextNumber}`);
      console.log(`[공문연번 부여] 정렬된 상위 5개:`, sorted.slice(0, 5).map(s => `${s.document_number} (${s.num})`));
      console.log(`[공문연번 부여] ============================`);
    }
  } else {
    console.log(`[공문연번 부여] 해당 조건의 기존 데이터 없음, 첫 번째 번호 부여: ${nextNumber}`);
  }

  // 3자리 숫자로 포맷팅 (001, 002, 003...)
  let formattedNumber = String(nextNumber).padStart(3, "0");
  let documentNumber = `${prefix}-${formattedNumber}`;

  // 중복 확인: 공문연번은 지정지청 + 측정년도 + 측정주기 조합 내에서만 고유하면 됨
  // 같은 지정지청 + 측정년도 + 측정주기 조합에서만 중복 확인
  let attempts = 0;
  const maxAttempts = 1000; // 무한 루프 방지

  while (attempts < maxAttempts) {
    const { data: existing, error: checkError } = await supabase
      .from("measurement_journal")
      .select("id")
      .in("designated_office", officesToMatch)
      .eq("measurement_year", measurementYear)
      // .eq("measurement_period", measurementPeriod) // 주기가 달라도 (예: 상반기 vs 상반기(수시)) 같은 년도/지청이면 중복 체크
      .eq("document_number", documentNumber) // 같은 지정지청 + 측정년도 조합에서만 중복 확인
      .maybeSingle();

    if (checkError && checkError.code !== "PGRST116") {
      console.error("공문연번 중복 확인 오류:", checkError);
      break; // 오류 발생 시 현재 번호 반환
    }

    // 번호가 사용 중이 아니면 반환
    if (!existing) {
      console.log(`[공문연번 부여] 최종 부여된 공문연번: ${documentNumber}`);
      return documentNumber;
    }

    // 번호가 사용 중이면 다음 번호로 증가
    console.log(`[공문연번 부여] ${documentNumber} 중복 발견 (같은 지정지청(${normalizedOffice}) + 측정년도(${measurementYear}) + 측정주기(${measurementPeriod}) 조합에서 사용 중), 다음 번호 시도...`);
    nextNumber++;
    formattedNumber = String(nextNumber).padStart(3, "0");
    documentNumber = `${prefix}-${formattedNumber}`;
    attempts++;
  }

  // 최대 시도 횟수 초과 시 현재 번호 반환 (드물게 발생)
  console.warn(`[공문연번 부여] 최대 시도 횟수(${maxAttempts}) 초과, 현재 번호 반환: ${documentNumber}`);
  return documentNumber;
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

  // 약칭으로 정규화 (기존 전체명과 호환) - Trim Input
  const normalizedOffice = toShortName(String(designatedOffice).trim());

  // 해당 지정한계_관할지청 + 측정년도 + 측정주기의 마지막 연번 조회
  const officesToMatch = [normalizedOffice];
  if (normalizedOffice !== designatedOffice) {
    officesToMatch.push(designatedOffice);
  }

  // 연번을 숫자로 정렬하기 위해 모든 레코드를 가져와서 클라이언트에서 정렬
  const basePeriod = String(measurementPeriod).trim().replace("(수시)", "");
  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select("sequence_number")
    .in("designated_office", officesToMatch)
    .eq("measurement_year", measurementYear)
    .like("measurement_period", `${basePeriod}%`) // '상반기' 또는 '상반기(수시)' 모두 포함
    .not("sequence_number", "is", null);

  if (error && error.code !== "PGRST116") {
    console.error("연번 조회 오류:", error);
    throw new Error("연번 조회 중 오류가 발생했습니다.");
  }

  let lastJournal = null;
  if (!error && journals && journals.length > 0) {
    // 숫자로 변환하여 정렬
    const sorted = journals
      .map(j => ({ ...j, num: parseInt(j.sequence_number, 10) }))
      .filter(j => !isNaN(j.num))
      .sort((a, b) => b.num - a.num);
    if (sorted.length > 0) {
      lastJournal = sorted[0];
    }
  }

  let nextNumber = 1;

  if (lastJournal && lastJournal.sequence_number) {
    // 연번은 숫자 문자열 (예: "1", "2", "11", "44", "101")
    const num = parseInt(lastJournal.sequence_number, 10);
    if (!isNaN(num)) {
      nextNumber = num + 1;
    }
  }

  // 숫자 그대로 반환 (1, 2, 3, 11, 44, 101...)
  return String(nextNumber);
}

/**
 * 5인 이상 연번 자동 부여
 * 년도별 지정지청별로 상∙하반기를 구분하여 부여합니다.
 * 총인원이 5인 이상이면 마지막 번호를 조회하고 증가,
 * 5인 미만이면 직전 번호를 재사용합니다.
 * @param designatedOffice 지정한계_관할지청
 * @param measurementYear 측정년도
 * @param measurementPeriod 측정주기 (상반기/하반기)
 * @param totalEmployees 총인원
 * @returns 5인 이상 연번 (예: "001")
 */
export async function assignFivePlusSequenceNumber(
  designatedOffice: string,
  measurementYear: number,
  measurementPeriod: string,
  totalEmployees: number | null
): Promise<string> {
  const supabase = await createClient();

  // 약칭으로 정규화 (기존 전체명과 호환) - Trim Input
  const normalizedOffice = toShortName(String(designatedOffice).trim());

  // (수시)를 제거한 기본 주기(상반기/하반기) 추출
  const basePeriod = String(measurementPeriod).trim().replace("(수시)", "");

  // 총인원이 5인 미만인 경우: 마지막 5인 이상 연번 재사용(최대값 조회)
  if (!totalEmployees || totalEmployees < 5) {
    // 직전 5인 이상 연번 조회 (중복 허용, 기존 전체명과 약칭 모두 매칭)
    // 년도별, 지정지청별, 측정주기별로 구분하여 조회
    const officesToMatch = [normalizedOffice];
    if (normalizedOffice !== designatedOffice) {
      officesToMatch.push(designatedOffice);
    }

    // Created_at 기준이 아니라 번호 기준 최대값 조회를 위해 모든 레코드 가져옴
    const { data: journals, error } = await supabase
      .from("measurement_journal")
      .select("five_plus_sequence")
      .in("designated_office", officesToMatch)
      .eq("measurement_year", measurementYear)
      .like("measurement_period", `${basePeriod}%`) // '상반기' 또는 '상반기(수시)' 모두 매치
      .not("five_plus_sequence", "is", null);

    if (error && error.code !== "PGRST116") {
      console.error("5인 이상 연번 조회 오류:", error);
      return "0";
    }

    let lastJournal = null;
    if (!error && journals && journals.length > 0) {
      // 숫자로 변환하여 정렬 (내림차순)
      const sorted = journals
        .map(j => ({ ...j, num: parseInt(j.five_plus_sequence, 10) }))
        .filter(j => !isNaN(j.num))
        .sort((a, b) => b.num - a.num);

      if (sorted.length > 0) {
        lastJournal = sorted[0];
      }
    }

    if (lastJournal && lastJournal.five_plus_sequence) {
      // 직전 번호(최대값) 재사용
      return lastJournal.five_plus_sequence;
    }

    // 직전 번호가 없으면 "0" 반환
    return "0";
  }

  // 총인원이 5인 이상인 경우: 마지막 번호 조회 후 증가 (기존 전체명과 약칭 모두 매칭)
  // 년도별, 지정지청별, 측정주기별로 구분하여 조회
  const officesToMatch = [normalizedOffice];
  if (normalizedOffice !== designatedOffice) {
    officesToMatch.push(designatedOffice);
  }

  // 5인 이상 연번을 숫자로 정렬하기 위해 모든 레코드를 가져와서 클라이언트에서 정렬
  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select("five_plus_sequence")
    .in("designated_office", officesToMatch)
    .eq("measurement_year", measurementYear)
    .like("measurement_period", `${basePeriod}%`) // '상반기' 또는 '상반기(수시)' 모두 매치
    .not("five_plus_sequence", "is", null);

  if (error && error.code !== "PGRST116") {
    console.error("5인 이상 연번 조회 오류:", error);
    throw new Error("5인 이상 연번 조회 중 오류가 발생했습니다.");
  }

  let lastJournal = null;
  if (!error && journals && journals.length > 0) {
    // 숫자로 변환하여 정렬
    const sorted = journals
      .map(j => ({ ...j, num: parseInt(j.five_plus_sequence, 10) }))
      .filter(j => !isNaN(j.num))
      .sort((a, b) => b.num - a.num);
    if (sorted.length > 0) {
      lastJournal = sorted[0];
    }
  }

  let nextNumber = 1;

  if (lastJournal && lastJournal.five_plus_sequence) {
    const num = parseInt(lastJournal.five_plus_sequence, 10);
    if (!isNaN(num)) {
      nextNumber = num + 1;
    }
  }

  // 숫자 그대로 반환 (1, 2, 3, 11, 44, 101...)
  return String(nextNumber);
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
  // 약칭으로 정규화 (기존 전체명과 호환) - Trim Input
  const normalizedOffice = toShortName(String(journalData.designated_office).trim());

  // 공문연번이 없으면 자동 부여
  let documentNumber = journalData.document_number;
  if (!documentNumber) {
    documentNumber = await assignDocumentNumber(
      normalizedOffice,
      journalData.measurement_year,
      journalData.measurement_period // Trimmed inside the function
    );
  }

  // 연번이 없으면 자동 부여
  let sequenceNumber = journalData.sequence_number;
  if (!sequenceNumber) {
    sequenceNumber = await assignSequenceNumber(
      normalizedOffice,
      journalData.measurement_year,
      journalData.measurement_period // Trimmed inside the function
    );
  }

  // 5인 이상 연번이 없으면 자동 부여
  let fivePlusSequence = journalData.five_plus_sequence;
  if (!fivePlusSequence) {
    fivePlusSequence = await assignFivePlusSequenceNumber(
      normalizedOffice,
      journalData.measurement_year,
      journalData.measurement_period, // Trimmed inside the function
      journalData.total_employees || null
    );
  }

  return {
    document_number: documentNumber,
    sequence_number: sequenceNumber,
    five_plus_sequence: fivePlusSequence,
  };
}
