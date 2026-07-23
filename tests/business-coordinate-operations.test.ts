import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectCoordinateAddress } from "../lib/business-coordinates/service";

const businessRoute = readFileSync("app/api/businesses/route.ts", "utf8");
const createRoute = readFileSync("app/api/businesses/create/route.ts", "utf8");
const uploadRoute = readFileSync("app/api/businesses/upload/route.ts", "utf8");
const geocodeRoute = readFileSync("app/api/businesses/geocode/route.ts", "utf8");
const nearbyRoute = readFileSync("app/api/businesses/nearby/route.ts", "utf8");
const legacyMapModal = readFileSync("components/features/BusinessMapModal.tsx", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260723_move_coordinates_to_business_info.sql",
  "utf8",
);

test("좌표 조회 주소는 도로명, 지번, 통합 주소 순서로 선택한다", () => {
  assert.equal(
    selectCoordinateAddress(
      { address1: "  충남   천안시 도로 1 ", address2: "충남 천안시 지번 2" },
      "통합 주소",
    ),
    "충남 천안시 도로 1",
  );
  assert.equal(selectCoordinateAddress({ address1: "-", address2: "지번 주소" }, "통합 주소"), "지번 주소");
  assert.equal(selectCoordinateAddress({ address1: null, address2: null }, " 통합  주소 "), "통합 주소");
  assert.equal(selectCoordinateAddress(null, null), "");
});

test("좌표의 권위 있는 저장소는 business_info이며 기존 정상 좌표를 최초 이관한다", () => {
  assert.match(migration, /ALTER TABLE public\.business_info/);
  assert.match(migration, /PARTITION BY target\.code/);
  assert.match(migration, /info\.latitude IS NULL/);
  assert.match(migration, /info\.latitude NOT BETWEEN 33 AND 39/);
  assert.match(businessRoute, /latitude: basicInfo\?\.latitude \?\? item\.latitude/);
  assert.match(nearbyRoute, /\.from\("business_info"\)\.select\("code, latitude, longitude"\)/);
});

test("신규·간편·엑셀 등록은 저장 후 공통 좌표 서비스를 호출한다", () => {
  assert.match(businessRoute, /await ensureBusinessCoordinate\(supabase/);
  assert.match(createRoute, /await ensureBusinessCoordinate\(supabase/);
  assert.match(uploadRoute, /await ensureBusinessCoordinate\(supabase/);
  assert.match(uploadRoute, /const BATCH_SIZE = 3/);
  assert.match(businessRoute, /businessCreated: true/);
  assert.match(createRoute, /businessCreated: true/);
});

test("지도 화면은 좌표 API를 호출하지 않고 DB 좌표 미등록 항목을 분리한다", () => {
  assert.doesNotMatch(legacyMapModal, /fetch\("\/api\/businesses\/geocode"/);
  assert.match(legacyMapModal, /좌표 미등록 상태입니다/);
});

test("관리자 좌표 API는 현황 집계와 요청 내 사업장·주소 중복 방지를 제공한다", () => {
  assert.match(geocodeRoute, /export async function GET/);
  assert.match(geocodeRoute, /resultByCode/);
  assert.match(geocodeRoute, /resultByAddress/);
  assert.match(geocodeRoute, /MAX_BATCH_SIZE = 10/);
});
