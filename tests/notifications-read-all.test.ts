import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync("app/api/notifications/route.ts", "utf8");
const headerSource = readFileSync("components/layout/Header.tsx", "utf8");

test("알림 목록은 최근 50개만 표시하되 전체 미읽음 수를 별도로 집계한다", () => {
  assert.match(routeSource, /\.limit\(50\)/);
  assert.match(routeSource, /select\("\*", \{ count: "exact", head: true \}\)/);
  assert.match(routeSource, /unreadCount: unreadCountResult\.count \|\| 0/);
  assert.match(headerSource, /setUnreadCount\(data\.unreadCount/);
});

test("모두 읽음은 로드된 ID가 아니라 현재 사용자의 전체 미읽음을 갱신한다", () => {
  assert.match(
    routeSource,
    /if \(all\) \{\s*query = query\.eq\("user_id", session\.userId\)\.eq\("is_read", false\)/,
  );
  assert.doesNotMatch(routeSource, /notifications\.map\([^)]*\.id/);
});

test("기존 개별 읽음은 알림 ID와 현재 사용자 조건을 함께 유지한다", () => {
  assert.match(
    routeSource,
    /else if \(id\) \{\s*query = query\.eq\("id", id\)\.eq\("user_id", session\.userId\)/,
  );
});

test("읽음 처리 성공 후에만 목록과 배지 상태를 갱신하고 실패를 표시한다", () => {
  const failureCheckIndex = headerSource.indexOf("if (!res.ok)");
  const listUpdateIndex = headerSource.indexOf("setNotifications((current)");

  assert.ok(failureCheckIndex >= 0);
  assert.ok(listUpdateIndex > failureCheckIndex);
  assert.match(headerSource, /id === undefined \? 0 : Math\.max\(0, current - 1\)/);
  assert.match(headerSource, /toast\.error/);
});

test("50개 초과 상황에서도 전체 읽음 처리 범위는 조회 배열과 무관하다", () => {
  const notifications = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    userId: index < 55 ? 1 : 2,
    isRead: false,
  }));

  const updated = notifications.map((notification) =>
    notification.userId === 1 && !notification.isRead
      ? { ...notification, isRead: true }
      : notification,
  );

  assert.equal(updated.filter((notification) => notification.userId === 1 && !notification.isRead).length, 0);
  assert.equal(updated.filter((notification) => notification.userId === 2 && !notification.isRead).length, 5);
});
