import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isMeasurementMapMessage,
  isValidKoreanCoordinate,
  LONG_SEGMENT_WARNING_MINUTES,
  MAX_OPTIMIZATION_BUSINESSES,
  retainAvailableBusinessIds,
  toMeasurementMapBusiness,
} from "../lib/measurement-map/types";

const nearbySource = readFileSync("app/api/businesses/nearby/route.ts", "utf8");
const routeSource = readFileSync("app/api/businesses/route-optimize/route.ts", "utf8");
const parentSource = readFileSync(
  "components/features/MeasurementTargetBusinessManagement.tsx",
  "utf8",
);
const viewerSource = readFileSync("components/features/MeasurementMapViewer.tsx", "utf8");


test("대한민국 범위 좌표만 지도와 경로 계산에 허용한다", () => {
  assert.equal(isValidKoreanCoordinate(36.8151, 127.1139), true);
  assert.equal(isValidKoreanCoordinate(32.9999, 127.1139), false);
  assert.equal(isValidKoreanCoordinate(36.8151, 132.0001), false);
  assert.equal(isValidKoreanCoordinate(Number.NaN, 127.1139), false);
});

test("지도 동기화 메시지는 payload 구조까지 검증한다", () => {
  const business = {
    id: 1,
    code: "ABC001",
    year: 2026,
    period: "하반기",
    business_name: "테스트 사업장",
    address: "충남 천안시",
    latitude: 36.8,
    longitude: 127.1,
  };
  assert.ok(toMeasurementMapBusiness(business));
  assert.equal(
    isMeasurementMapMessage({
      type: "MAP_INITIALIZE",
      payload: {
        context: { year: 2026, period: "하반기" },
        businesses: [business],
        baseBusinessId: 1,
      },
    }),
    true,
  );
  assert.equal(isMeasurementMapMessage({ type: "MAP_INITIALIZE" }), false);
  assert.equal(
    isMeasurementMapMessage({ type: "REMOVE_BUSINESS", payload: {} }),
    false,
  );
});

test("후보 조회는 연도·주기·미실시·예정일·비활성 조건을 서버에서 적용한다", () => {
  assert.match(nearbySource, /\.eq\("year", year\)/);
  assert.match(nearbySource, /\.eq\("period", period\)/);
  assert.match(nearbySource, /\.eq\("is_registered", "미실시"\)/);
  assert.match(nearbySource, /includeScheduled \|\| !business\.measurement_date/);
  assert.match(nearbySource, /managementStatus === "거래종료"/);
  assert.match(nearbySource, /\.sort\(\(a, b\) => a\.distanceKm - b\.distanceKm\)/);
});

test("경로 계산은 출발지 고정, 최대 6개, TTL 캐시와 구간 장거리 상수를 사용한다", () => {
  assert.equal(MAX_OPTIMIZATION_BUSINESSES, 6);
  assert.equal(LONG_SEGMENT_WARNING_MINUTES, 30);
  assert.match(routeSource, /startBusinessId/);
  assert.match(routeSource, /remainingPermutations/);
  assert.match(routeSource, /segmentTtlCache/);
  assert.match(routeSource, /request\.signal/);
  assert.match(
    routeSource,
    /segmentRes\.duration >= LONG_SEGMENT_WARNING_MINUTES \* 60/,
  );
});

test("메인 화면은 이름이 고정된 크기 조절 가능 독립 창을 연다", () => {
  assert.match(parentSource, /MEASUREMENT_MAP_VIEWER_NAME/);
  assert.match(parentSource, /width=1500,height=900,resizable=yes,scrollbars=yes/);
  assert.match(parentSource, /viewer\.focus\(\)/);
  assert.match(parentSource, /BroadcastChannel\(MEASUREMENT_MAP_CHANNEL\)/);
});

test("자동 새로고침은 현재 목록에 남아 있는 사업장 선택을 유지한다", () => {
  const retained = retainAvailableBusinessIds(
    new Set<string | number>([1, "2", 3]),
    [{ id: "1" }, { id: 3 }, { id: 4 }],
  );

  assert.deepEqual(Array.from(retained), [1, 3]);
  assert.match(parentSource, /if \(options\?\.silent\)/);
  assert.match(
    parentSource,
    /retainAvailableBusinessIds\(previous, fetchedData\)/,
  );
});

test("선택 사업장은 모두 펼치고 주변 후보만 남은 높이에서 스크롤한다", () => {
  assert.match(viewerSource, /data-section="selected-businesses" className="mt-3 space-y-2"/);
  assert.match(viewerSource, /data-section="nearby-candidates" className="min-h-\[160px\] flex-1 overflow-y-auto p-4"/);
  assert.match(viewerSource, /const label = isStart \? "🚩"/);
  assert.match(viewerSource, />🚩 출발지<\/span>/);
});

test("후보 추가 중에는 기준 사업장을 지도 중심에 고정한다", () => {
  assert.match(viewerSource, /lastCenteredBaseIdRef/);
  assert.match(viewerSource, /map\.setCenter\(basePosition\)/);
  assert.match(viewerSource, /map\.setZoom\(12\)/);
  assert.match(viewerSource, /!routeResult &&/);
});

test("같은 기준 사업장의 주변 업체 버튼도 후보를 다시 조회한다", () => {
  assert.doesNotMatch(viewerSource, /if \(idMatches\(id, baseBusinessId\)\) return/);
  assert.match(viewerSource, /setCandidateReloadKey\(\(current\) => current \+ 1\)/);
  assert.match(viewerSource, /주변 미실시 후보를 다시 조회합니다/);
  assert.match(viewerSource, /candidateReloadKey, context/);
});
