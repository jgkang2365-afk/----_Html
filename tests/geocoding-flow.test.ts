import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  normalizeAddressForGeocoding,
  isValidAddress
} from "../lib/naver-map/geocoding";

const root = process.cwd();
const routeSource = readFileSync(path.join(root, "app", "api", "businesses", "route.ts"), "utf8");
const geocodeRouteSource = readFileSync(path.join(root, "app", "api", "businesses", "geocode", "route.ts"), "utf8");
const componentSource = readFileSync(
  path.join(root, "components", "features", "MeasurementTargetBusinessManagement.tsx"),
  "utf8",
);

test("주소 정규화 헬퍼 테스트", () => {
  // 앞뒤 공백 제거, 줄바꿈 제거, 연속 공백 하나로 축소 검증
  assert.equal(normalizeAddressForGeocoding("  서울시 강남구 \n 테헤란로 123   "), "서울시 강남구 테헤란로 123");
  assert.equal(normalizeAddressForGeocoding("\r\n\t 부산광역시 \r 중구 중앙대로 55"), "부산광역시 중구 중앙대로 55");
  assert.equal(normalizeAddressForGeocoding(""), "");
  assert.equal(normalizeAddressForGeocoding(null), "");
});

test("주소 유효성 검증 테스트", () => {
  // 정상 주소
  assert.equal(isValidAddress("서울시 강남구 테헤란로 123"), true);
  
  // 비정상 주소들 걸러내기
  assert.equal(isValidAddress(""), false);
  assert.equal(isValidAddress("-"), false);
  assert.equal(isValidAddress("없음"), false);
  assert.equal(isValidAddress("미등록"), false);
  assert.equal(isValidAddress("  -  "), false);
  assert.equal(isValidAddress("N/A"), false);
});

test("PATCH API에서 주소 변경 시 좌표 무효화 처리가 포함되어 있다", () => {
  assert.match(routeSource, /updates\.hasOwnProperty\('address'\)/);
  assert.match(routeSource, /geocoding_status = "STALE"/);
  assert.match(routeSource, /latitude = null/);
  assert.match(routeSource, /longitude = null/);
  assert.match(routeSource, /coordinate_locked/);
});

test("Geocoding API Route에 필수 검증 및 RLS 권한 확인이 구현되어 있다", () => {
  // 1. 관리자 권한 확인
  assert.match(geocodeRouteSource, /checkPermission\("journal:write"\)/);
  
  // 2. 최대 10개 검증
  assert.match(geocodeRouteSource, /businessIds\.length > MAX_BATCH_SIZE/);
  
  // 3. 중복 주소 캐싱 맵 존재 여부
  assert.match(geocodeRouteSource, /new Map/);
  assert.match(geocodeRouteSource, /resultByAddress\.get/);
  
  // 4. coordinate_locked 시 덮어쓰기 방지
  assert.match(geocodeRouteSource, /coordinate_locked/);
});

test("사업장 관리 화면에 다중 선택 UI와 [지도에서 위치 보기] 연동이 존재한다", () => {
  // 1. 상태 및 플래그
  assert.match(componentSource, /selectedBusinessIds/);
  assert.match(componentSource, /isMapModalOpen/);
  
  // 2. 최대 10개 선택 제한 메시지
  assert.match(componentSource, /최대 10개까지만 선택할 수 있습니다/);
  
  // 3. 버튼 텍스트와 렌더링
  assert.match(componentSource, /지도에서 위치 보기/);
  assert.match(componentSource, /BusinessMapModal/);
});
