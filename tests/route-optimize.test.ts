import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const apiSource = readFileSync(
  path.join(root, "app", "api", "businesses", "route-optimize", "route.ts"),
  "utf8"
);
const modalSource = readFileSync(
  path.join(root, "components", "features", "BusinessMapModal.tsx"),
  "utf8"
);

// 순열 알고리즘 자가 테스트
function getPermutations<T>(array: T[]): T[][] {
  if (array.length <= 1) return [array];
  const result: T[][] = [];

  for (let i = 0; i < array.length; i++) {
    const current = array[i];
    const remaining = [...array.slice(0, i), ...array.slice(i + 1)];
    const remainingPerms = getPermutations(remaining);

    for (const perm of remainingPerms) {
      result.push([current, ...perm]);
    }
  }

  return result;
}

test("순열(Permutation) 전수 탐색 검증 - 3개 대상 시 6개 순열 생성", () => {
  const items = ["B", "C", "D"];
  const perms = getPermutations(items);
  assert.equal(perms.length, 6);
  assert.deepEqual(perms[0], ["B", "C", "D"]);
  assert.deepEqual(perms[5], ["D", "C", "B"]);
});

test("카카오 directions API 직접 연동 테스트", async () => {
  const apiKey = process.env.KAKAO_REST_API_KEY || "295dc1e4b41efd01e4da0f09322f27db";
  const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.append("origin", "127.110153,37.394725");
  url.searchParams.append("destination", "127.108243,37.401927");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${apiKey}` }
  });
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.routes[0].result_code, 0);
  assert.ok(data.routes[0].summary.distance > 0);
  assert.ok(data.routes[0].summary.duration > 0);
});

test("route-optimize API 소스 코드 구조 검증", () => {
  // 1. 카카오 Directions API 사용
  assert.match(apiSource, /apis-navi\.kakaomobility\.com\/v1\/directions/);
  // 2. 0번째 사업장 출발지 고정
  assert.match(apiSource, /businesses\[0\]/);
  // 3. 순열 전수 생성 (getPermutations)
  assert.match(apiSource, /getPermutations/);
  // 4. 승용차 추천 경로 (priority RECOMMEND)
  assert.match(apiSource, /priority.*RECOMMEND/);
  // 5. 총 이동거리/이용시간 포맷팅
  assert.match(apiSource, /formattedTotalDistance/);
  assert.match(apiSource, /formattedTotalDuration/);
});

test("BusinessMapModal 최적 동선 UI 구조 검증", () => {
  // 1. 최적 동선 계산 버튼
  assert.match(modalSource, /최적 동선 계산/);
  // 2. Polyline 및 번호 마커 렌더링
  assert.match(modalSource, /naverMaps\.Polyline/);
  assert.match(modalSource, /orderedBusinesses/);
  // 3. 요약 패널 총 이동거리 및 이동시간
  assert.match(modalSource, /총 이동거리/);
  assert.match(modalSource, /총 이동시간/);
});
