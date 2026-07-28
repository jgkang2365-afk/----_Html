import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canonicalizeBusinessInfoOfficeJurisdiction } from "../lib/sync/office-jurisdiction";

test("사업장정보 엑셀의 승인된 네 관할청 전체명만 약칭으로 저장한다", () => {
  assert.equal(
    canonicalizeBusinessInfoOfficeJurisdiction(" 중부지방고용노동청 경기지청 "),
    "경기"
  );
  assert.equal(
    canonicalizeBusinessInfoOfficeJurisdiction("중부지방고용노동청 평택지청"),
    "평택"
  );
  assert.equal(canonicalizeBusinessInfoOfficeJurisdiction("대전지방고용노동청"), "대전");
  assert.equal(
    canonicalizeBusinessInfoOfficeJurisdiction("대전지방고용노동청 천안지청"),
    "천안"
  );
});

test("승인되지 않은 관할청 전체명은 앞뒤 공백 외에는 변경하지 않는다", () => {
  for (const value of [
    "대전지방고용노동청 보령지청",
    "서울지방고용노동청",
    "부산지방고용노동청",
    "광주지방고용노동청",
    "중부지방고용노동청 경기지청 별관",
  ]) {
    assert.equal(canonicalizeBusinessInfoOfficeJurisdiction(` ${value} `), value);
  }
});

test("관할 정규화는 정확 일치 표만 사용하며 주소·부분 문자열 추론을 하지 않는다", () => {
  const helper = readFileSync("lib/sync/office-jurisdiction.ts", "utf8");
  assert.doesNotMatch(helper, /\.includes\(|toShortName|findOfficeByAddress/i);
});

test("사업장정보 엑셀 동기화는 관할청 저장 직전에 canonicalization helper를 사용한다", () => {
  const excelSync = readFileSync("lib/sync/excel-sync.ts", "utf8");
  assert.match(
    excelSync,
    /canonicalizeBusinessInfoOfficeJurisdiction\(officeJurisdictionValue\)/
  );
  assert.match(excelSync, /office_jurisdiction = canonicalValue/);
  assert.doesNotMatch(excelSync, /officeJurisdictionValue\.includes\(/);
});

test("H0508 재정정은 현재 전체 관할값이 일치할 때만 수행한다", () => {
  const migration = readFileSync(
    "supabase/migrations/20260728_reapply_h0508_business_info_office_jurisdiction.sql",
    "utf8"
  );
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /COMMIT;/);
  assert.match(migration, /UPDATE public\.business_info/);
  assert.match(migration, /SET office_jurisdiction = '경기'/);
  assert.match(migration, /code = 'H0508'/);
  assert.match(migration, /office_jurisdiction = '중부지방고용노동청 경기지청'/);
  assert.doesNotMatch(migration, /ILIKE|LIKE|%|created_at/i);
});
