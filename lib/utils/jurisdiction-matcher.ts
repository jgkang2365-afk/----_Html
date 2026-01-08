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

      // CSV 파싱 (쉼표로 분리, 따옴표 처리)
      const parts: string[] = [];
      let currentPart = "";
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
          parts.push(currentPart.trim());
          currentPart = "";
        } else {
          currentPart += char;
        }
      }
      parts.push(currentPart.trim());

      if (parts.length >= 2 && parts[0] && parts[1]) {
        const office = parts[0].trim();
        const regions = parts[1]
          .split("·")
          .map((r) => r.trim())
          .filter((r) => r);

        if (office && regions.length > 0) {
          mappings.push({ office, regions });
        }
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
 * @returns 매칭된 노동지청명 또는 null
 */
export function findOfficeByAddress(address: string | null | undefined): string | null {
  if (!address) return null;

  const mappings = loadJurisdictionData();
  const normalizedAddress = address.trim();

  // 주소에서 시/도, 시/군/구 정보 추출
  for (const mapping of mappings) {
    for (const region of mapping.regions) {
      // 지역명이 주소에 포함되어 있는지 확인
      // 예: "서울특별시 중구" -> "중구" 매칭
      // 예: "경기도 평택시" -> "평택시" 매칭
      const regionKeywords = region
        .split("·")
        .map((r) => r.trim())
        .filter((r) => r);

      for (const keyword of regionKeywords) {
        // 키워드가 주소에 포함되어 있는지 확인
        if (normalizedAddress.includes(keyword)) {
          return mapping.office;
        }
      }
    }
  }

  return null;
}

/**
 * 소재지 관할청을 기준으로 지정한계_관할지청을 자동 분류합니다.
 * @param officeJurisdiction 소재지 관할청
 * @returns 지정한계_관할지청
 */
export function classifyDesignatedOffice(
  officeJurisdiction: string | null | undefined
): string {
  if (!officeJurisdiction) {
    return "대전지방고용노동청 천안지청"; // 기본값
  }

  const normalized = officeJurisdiction.trim();

  // 대전지방고용노동청 (본청)
  if (normalized === "대전지방고용노동청") {
    return "대전지방고용노동청";
  }

  // 중부지방고용노동청 평택지청
  if (normalized.includes("평택지청")) {
    return "중부지방고용노동청 평택지청";
  }

  // 중부지방고용노동청 경기지청
  if (normalized.includes("경기지청")) {
    return "중부지방고용노동청 경기지청";
  }

  // 그 외 모든 지청은 대전지방고용노동청 천안지청으로 귀속
  return "대전지방고용노동청 천안지청";
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
