/**
 * 노동지청별 관할지역 매칭 유틸리티
 * 주소를 기준으로 소재지 관할청을 자동으로 매칭합니다.
 */

import { readFileSync } from "fs";
import { join } from "path";

interface JurisdictionMapping {
  office: string;
  regions: string[];
}

let jurisdictionCache: JurisdictionMapping[] | null = null;

/**
 * CSV 파일을 읽어서 노동지청별 관할지역 매핑 데이터를 로드합니다.
 * CSV 형식: "노동청 --> 약칭, 관할구역"
 */
function loadJurisdictionData(): JurisdictionMapping[] {
  if (jurisdictionCache) {
    return jurisdictionCache;
  }

  try {
    const csvPath = join(process.cwd(), "노동지청별 관할지역.csv");
    const csvContent = readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n").filter((line) => line.trim());

    const mappings: JurisdictionMapping[] = [];

    // 첫 번째 줄은 헤더이므로 건너뜀
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // CSV 파싱 (--> 기준으로 분리)
      const arrowIndex = line.indexOf("-->");
      if (arrowIndex === -1) continue;

      const officePart = line.substring(0, arrowIndex).trim();
      const shortAndRegions = line.substring(arrowIndex + 3).trim();
      
      // 약칭과 관할구역 분리 (첫 번째 쉼표 기준)
      const firstCommaIndex = shortAndRegions.indexOf(",");
      if (firstCommaIndex === -1) continue;

      const shortName = shortAndRegions.substring(0, firstCommaIndex).trim();
      const regionsStr = shortAndRegions.substring(firstCommaIndex + 1).trim();
      
      // 관할구역 파싱: 먼저 쉼표 기준으로 분리, 그 다음 · 기준으로 분리
      // 예: "대전광역시, 세종특별자치시, 충청남도 공주시·논산시·계룡시 및 금산군"
      // -> ["대전광역시", "세종특별자치시", "충청남도 공주시·논산시·계룡시 및 금산군"]
      const regions: string[] = [];
      const commaSeparatedParts = regionsStr.split(",").map((p) => p.trim()).filter((p) => p);
      
      for (const part of commaSeparatedParts) {
        // 각 부분을 · 기준으로 다시 분리
        const dotSeparatedParts = part.split("·").map((p) => p.trim()).filter((p) => p);
        for (const subPart of dotSeparatedParts) {
          // " 및 "로 연결된 부분도 분리
          const andSeparatedParts = subPart.split(" 및 ").map((p) => p.trim()).filter((p) => p);
          regions.push(...andSeparatedParts);
        }
      }

      if (officePart && shortName && regions.length > 0) {
        mappings.push({ office: shortName, regions }); // 약칭으로 저장
      }
    }

    jurisdictionCache = mappings;
    return mappings;
  } catch (error) {
    console.error("노동지청별 관할지역 CSV 파일 읽기 실패:", error);
    return [];
  }
}

/**
 * 주소를 기준으로 소재지 관할청을 찾습니다.
 * @param address 주소 문자열
 * @returns 매칭된 노동지청 약칭 또는 null
 */
export function findOfficeByAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  const mappings = loadJurisdictionData();
  const normalizedAddress = address.trim();

  // 주소에서 시/도, 시/군/구 정보 추출
  // 더 구체적인 매칭을 위해 더 긴 키워드를 우선 처리
  const matches: Array<{ office: string; keywordLength: number }> = [];
  
  for (const mapping of mappings) {
    for (const region of mapping.regions) {
      // 키워드가 주소에 포함되어 있는지 확인
      // 더 긴 키워드를 우선 처리하기 위해 키워드 길이를 저장
      if (normalizedAddress.includes(region)) {
        matches.push({ office: mapping.office, keywordLength: region.length });
      }
    }
  }
  
  // 가장 긴 키워드와 매칭된 office 반환 (더 구체적인 매칭 우선)
  if (matches.length > 0) {
    matches.sort((a, b) => b.keywordLength - a.keywordLength);
    return matches[0].office;
  }

  return null;
}

/**
 * CSV 파일에서 약칭 매핑 정보 로드
 */
let officeToShortCache: Record<string, string> | null = null;

function loadOfficeShortNameMap(): Record<string, string> {
  if (officeToShortCache) {
    return officeToShortCache;
  }

  const mapping: Record<string, string> = {};

  try {
    const csvPath = join(process.cwd(), "노동지청별 관할지역.csv");
    const csvContent = readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n").filter((line) => line.trim());

    // 첫 번째 줄은 헤더이므로 건너뜀
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // CSV 파싱 (--> 기준으로 분리)
      const arrowIndex = line.indexOf("-->");
      if (arrowIndex === -1) continue;

      const officePart = line.substring(0, arrowIndex).trim();
      const shortPart = line.substring(arrowIndex + 3).trim();
      
      // 약칭 추출 (쉼표 이전까지)
      const shortName = shortPart.split(",")[0].trim();
      
      if (officePart && shortName) {
        mapping[officePart] = shortName;
      }
    }

    officeToShortCache = mapping;
  } catch (error) {
    console.error("CSV 파일 읽기 오류:", error);
  }

  return mapping;
}

/**
 * 전체명을 약칭으로 변환합니다.
 * CSV 파일에서 전체명 → 약칭 매핑 정보를 읽어옵니다.
 * @param fullName 전체명 (예: "대전지방고용노동청 천안지청", "대전지방고용노동청" 등)
 * @returns 약칭 (예: "천안", "대전", "서산", "청주" 등) 또는 원본값 (매칭 실패 시)
 */
export function fullNameToShortName(fullName: string | null | undefined): string | null {
  if (!fullName) return null;

  const normalized = fullName.trim();
  
  // 이미 약칭인 경우 (지청이나 고용노동청이 포함되지 않은 경우)
  if (!normalized.includes("지청") && !normalized.includes("고용노동청")) {
    return normalized;
  }

  // CSV 파일을 읽어서 전체명 → 약칭 매핑 사용
  const mapping = loadOfficeShortNameMap();
  
  if (mapping[normalized]) {
    return mapping[normalized];
  }

  // 매칭 실패 시 원본 그대로 반환
  return normalized;
}

/**
 * 소재지 관할청을 기준으로 지정한계_관할지청을 자동 분류합니다.
 * 
 * 지정한계_관할지청 매핑 규칙 (측정일지 구현 정보.txt 참고):
 * 1. "대전지방고용노동청" (정확히 일치, 천안지청 제외) → "대전"
 * 2. "중부지방고용노동청 평택지청" → "평택"
 * 3. "중부지방고용노동청 경기지청" → "경기"
 * 4. 그 외 모든 지청 → "천안" (대전지방고용노동청 천안지청 포함, 대전지방고용노동청의 하위 지청 포함, 서울, 부산, 광주, 대구, 제주 등 모든 기타 지청)
 * 
 * 중요: "대전지방고용노동청"은 정확히 일치하는 경우에만 "대전"으로 분류하고,
 * "대전지방고용노동청 천안지청", "대전지방고용노동청 청주지청", "대전지방고용노동청 보령지청" 등
 * 하위 지청은 모두 "천안"으로 분류합니다.
 * 
 * @param officeJurisdiction 소재지 관할청 (전체명 또는 약칭)
 * @returns 지정한계_관할지청 (천안, 대전, 평택, 경기 중 하나)
 */
export function classifyDesignatedOffice(
  officeJurisdiction: string | null | undefined
): string {
  if (!officeJurisdiction) {
    return "천안"; // 기본값 (그 외 모든 지청)
  }

  const normalized = officeJurisdiction.trim();

  // 이미 지정한계_관할지청 약칭인 경우 그대로 반환
  if (["천안", "대전", "평택", "경기"].includes(normalized)) {
    return normalized;
  }

  // 규칙 2: "중부지방고용노동청 평택지청" 또는 "평택지청" → "평택"
  // (규칙 2와 3을 먼저 체크해야 함, 평택/경기는 중부지방고용노동청의 하위 지청이지만 예외)
  if (normalized.includes("중부지방고용노동청 평택지청") || normalized === "평택지청") {
    return "평택";
  }

  // 규칙 3: "중부지방고용노동청 경기지청" 또는 "경기지청" → "경기"
  if (normalized.includes("중부지방고용노동청 경기지청") || normalized === "경기지청") {
    return "경기";
  }

  // 규칙 1: "대전지방고용노동청"이 정확히 일치하는 경우만 → "대전"
  // (하위 지청이 있으면 "지청"이 포함되므로 정확히 일치하지 않음)
  if (normalized === "대전지방고용노동청") {
    return "대전";
  }

  // 규칙 4: 그 외 모든 지청 (대전지방고용노동청의 하위 지청 포함, 대전지방고용노동청 천안지청 포함, 서울, 부산, 광주, 대구, 제주 등) → "천안"
  return "천안";
}

/**
 * 약칭을 전체명으로 변환합니다.
 * CSV 파일에서 약칭 → 전체명 매핑 정보를 읽어옵니다.
 * @param shortName 약칭 (예: "천안", "대전", "서산", "청주" 등)
 * @returns 전체명 (예: "대전지방고용노동청 천안지청", "대전지방고용노동청", "대전지방고용노동청 보령지청" 등) 또는 원본값
 */
export function shortNameToFullName(shortName: string | null | undefined): string | null {
  if (!shortName) return null;

  const normalized = shortName.trim();
  
  // 이미 전체명인 경우 (지청 또는 고용노동청 포함)
  if (normalized.includes("지청") || normalized.includes("고용노동청")) {
    return normalized;
  }

  // CSV 파일을 읽어서 약칭 → 전체명 매핑 생성
  try {
    const csvPath = join(process.cwd(), "노동지청별 관할지역.csv");
    const csvContent = readFileSync(csvPath, "utf-8");
    const lines = csvContent.split("\n").filter((line) => line.trim());
    const shortToFullMap: Record<string, string> = {};
    
    // 첫 번째 줄은 헤더이므로 건너뜀
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const arrowIndex = line.indexOf("-->");
      if (arrowIndex === -1) continue;
      const officePart = line.substring(0, arrowIndex).trim(); // 전체명
      const shortPart = line.substring(arrowIndex + 3).trim();
      const shortNameFromCsv = shortPart.split(",")[0].trim(); // 약칭
      if (officePart && shortNameFromCsv) {
        shortToFullMap[shortNameFromCsv] = officePart; // 약칭 → 전체명
      }
    }
    
    // 약칭이면 전체명으로 변환
    if (shortToFullMap[normalized]) {
      return shortToFullMap[normalized];
    }
    
    // 매칭 실패 시 원본 그대로 반환
    return normalized;
  } catch (error) {
    console.error("CSV 파일 읽기 오류:", error);
    return normalized;
  }
}

/**
 * 주소를 기준으로 지정한계_관할지청을 자동으로 결정합니다.
 * @param address 주소 문자열
 * @returns 지정한계_관할지청
 */
export function getDesignatedOfficeByAddress(address: string | null | undefined): string {
  const officeJurisdiction = findOfficeByAddress(address);
  return classifyDesignatedOffice(officeJurisdiction);
}
