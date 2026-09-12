import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

type Business = {
  code: string | null;
  businessName: string | null;
  year: number;
  period: string;
};

type Job = {
  status: "RUNNING" | "CANCEL_REQUESTED" | "COMPLETED" | "FAILED" | "CONFIRM_REQUIRED";
  jobType: string;
  finalCheck: boolean;
  syncSuccess: boolean;
  trigger?: string;
  slot?: string;
};

const normalizeBusinessName = (value: string | null) =>
  (value ?? "").replace(/\s+/g, "").replaceAll("(주)", "").replaceAll("주식회사", "");

const matchesMesBusiness = (survey: Business, mes: Business) => {
  if (survey.year !== mes.year || survey.period !== mes.period) return false;
  const surveyCode = survey.code?.trim() ?? "";
  const mesCode = mes.code?.trim() ?? "";
  if (surveyCode && mesCode && surveyCode === mesCode) return true;
  const surveyName = normalizeBusinessName(survey.businessName);
  const mesName = normalizeBusinessName(mes.businessName);
  return surveyName !== "" && mesName !== "" && (
    surveyName === mesName || mesName.includes(surveyName) || surveyName.includes(mesName)
  );
};

class MesFinalCheckHarness {
  notifications: Array<{ userId: number; type: string; message: string; isRead: boolean }> = [];
  actions = new Map<string, { status: "PENDING" | "COMPLETED" | "FAILED"; attempts: number; availableAt: number; locked: boolean }>();

  transition(
    job: Job,
    nextStatus: Job["status"],
    surveys: Business[],
    mesRows: Business[],
    users: Array<{ id: number; isJournalManager: boolean }>,
  ) {
    const previousStatus = job.status;
    job.status = nextStatus;
    if (
      previousStatus === "COMPLETED" ||
      nextStatus !== "COMPLETED" ||
      job.jobType !== "MES_SYNC" ||
      job.trigger !== "scheduled" || job.slot !== "14:00" ||
      !job.finalCheck ||
      !job.syncSuccess
    ) return;

    if (!this.actions.has("mes-post-sync:parent")) {
      this.actions.set("mes-post-sync:parent", { status: "PENDING", attempts: 0, availableAt: 0, locked: false });
    }
  }

  async drain(
    parent: Job,
    surveys: Business[],
    mesRows: Business[],
    users: Array<{ id: number; isJournalManager: boolean }>,
    fail = false,
    now = 0,
  ) {
    const action = this.actions.get("mes-post-sync:parent");
    if (!action || action.status !== "PENDING" || action.availableAt > now || action.locked) return;
    action.locked = true;
    await new Promise<void>((resolve) => setImmediate(resolve));
    action.attempts++;
    if (fail) {
      action.status = action.attempts >= 3 ? "FAILED" : "PENDING";
      action.availableAt = now + action.attempts * 5 * 60_000;
      action.locked = false;
      assert.equal(parent.status, "COMPLETED");
      return;
    }
    const missing = surveys.filter((survey) =>
      survey.year > 0 && survey.period.trim() !== "" && !mesRows.some((mes) => matchesMesBusiness(survey, mes))
    );
    action.status = "COMPLETED";
    action.locked = false;
    if (missing.length === 0) return;

    const message = `[MES 미등록 경고] '${missing[0].businessName}'${missing.length > 1 ? ` 외 ${missing.length - 1}개` : ""} 업체가 금일 14:00까지 MES에 등록되지 않았습니다. 기사의 당일 등록 확인이 필요합니다.`;
    for (const user of users.filter((candidate) => candidate.isJournalManager)) {
      this.notifications.push({ userId: user.id, type: "mes_sync_warning", message, isRead: false });
    }
  }
}

const business = (overrides: Partial<Business> = {}): Business => ({
  code: null,
  businessName: "한결산업",
  year: 2026,
  period: "하반기",
  ...overrides,
});

test("MES 사업장명은 동일 정규화 후 동등 또는 긴 이름이 짧은 이름을 포함하면 양방향 매칭한다", () => {
  const matches: Array<[string, string]> = [
    ["(주) 한결 산업", "주식회사한결\t산업"],
    ["주식회사 한결산업", "한결 산업"],
    ["한결\n산업", "(주)한결산업"],
  ];
  for (const [surveyName, mesName] of matches) {
    assert.equal(matchesMesBusiness(business({ businessName: surveyName }), business({ businessName: mesName })), true);
    assert.equal(matchesMesBusiness(business({ businessName: mesName }), business({ businessName: surveyName })), true);
  }

  assert.equal(matchesMesBusiness(business({ businessName: "한결" }), business({ businessName: "한결산업" })), true);
  assert.equal(matchesMesBusiness(business({ businessName: "한결산업 지점" }), business({ businessName: "한결산업" })), true);
  assert.equal(matchesMesBusiness(business({ businessName: "한결산업" }), business({ businessName: "한결상사" })), false);
  assert.equal(matchesMesBusiness(business(), business({ year: 2025 })), false);
  assert.equal(matchesMesBusiness(business(), business({ period: "상반기" })), false);
});

test("코드 매칭도 동일 연도와 주기를 반드시 요구한다", () => {
  assert.equal(matchesMesBusiness(business({ code: " A-1 ", businessName: "불일치" }), business({ code: "A-1" })), true);
  assert.equal(matchesMesBusiness(business({ code: "A-1" }), business({ code: "A-1", year: 2025 })), false);
  assert.equal(matchesMesBusiness(business({ code: "A-1" }), business({ code: "A-1", period: "상반기" })), false);
});

test("검증된 14시 MES 성공의 최초 COMPLETED 전이만 최종 점검을 실행한다", async () => {
  const cases: Array<[Job, Job["status"], number]> = [
    [{ status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true }, "COMPLETED", 1],
    [{ status: "CANCEL_REQUESTED", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true }, "COMPLETED", 1],
    [{ status: "COMPLETED", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true }, "COMPLETED", 0],
    [{ status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true }, "FAILED", 0],
    [{ status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true }, "CONFIRM_REQUIRED", 0],
    [{ status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: false }, "COMPLETED", 0],
    [{ status: "RUNNING", jobType: "MES_SYNC", trigger: "manual", slot: "14:00", finalCheck: true, syncSuccess: true }, "COMPLETED", 0],
    [{ status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "11:30", finalCheck: true, syncSuccess: true }, "COMPLETED", 0],
    [{ status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "12:00", finalCheck: true, syncSuccess: true }, "COMPLETED", 0],
    [{ status: "RUNNING", jobType: "DOCUMENT_GENERATION", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true }, "COMPLETED", 0],
  ];
  for (const [job, nextStatus, expected] of cases) {
    const harness = new MesFinalCheckHarness();
    const surveys = [business({ businessName: "미등록" })];
    const users = [{ id: 1, isJournalManager: true }];
    harness.transition(job, nextStatus, surveys, [], users);
    assert.equal(harness.actions.size, expected);
    await harness.drain(job, surveys, [], users);
    assert.equal(harness.notifications.length, expected);
  }
});

test("COMPLETED 상태의 반복 저장은 알림을 중복 생성하지 않는다", async () => {
  const harness = new MesFinalCheckHarness();
  const job: Job = { status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true };
  const surveys = [business({ businessName: "미등록" })];
  const users = [{ id: 1, isJournalManager: true }];

  harness.transition(job, "COMPLETED", surveys, [], users);
  harness.transition(job, "COMPLETED", surveys, [], users);
  assert.equal(harness.actions.size, 1);
  await harness.drain(job, surveys, [], users);
  await harness.drain(job, surveys, [], users);
  assert.equal(harness.notifications.length, 1);
});

test("미등록 업체가 있을 때만 일지담당자별 읽지 않은 경고를 한 건씩 생성한다", async () => {
  const harness = new MesFinalCheckHarness();
  const job: Job = { status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true };
  const surveys = [business({ businessName: "등록업체" }), business({ businessName: "미등록A" }), business({ businessName: "미등록B" })];
  const mesRows = [business({ businessName: "(주) 등록 업체" })];

  harness.transition(job, "COMPLETED", surveys, mesRows, [
    { id: 10, isJournalManager: true },
    { id: 11, isJournalManager: false },
    { id: 12, isJournalManager: true },
  ]);
  await harness.drain(job, surveys, mesRows, [
    { id: 10, isJournalManager: true },
    { id: 11, isJournalManager: false },
    { id: 12, isJournalManager: true },
  ]);

  assert.deepEqual(harness.notifications.map((notification) => notification.userId), [10, 12]);
  assert.ok(harness.notifications.every((notification) => notification.type === "mes_sync_warning" && !notification.isRead));
  assert.ok(harness.notifications.every((notification) => notification.message.includes("'미등록A' 외 1개")));
});

test("후속 알림 실패는 부모 완료를 바꾸지 않고 DB 전용 작업만 재시도한다", async () => {
  const harness = new MesFinalCheckHarness();
  const job: Job = { status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true };
  harness.transition(job, "COMPLETED", [], [], []);
  await harness.drain(job, [], [], [], true, 0);
  assert.equal(harness.actions.get("mes-post-sync:parent")?.status, "PENDING");
  assert.equal(harness.actions.get("mes-post-sync:parent")?.availableAt, 5 * 60_000);
  await harness.drain(job, [], [], [], true, 5 * 60_000);
  assert.equal(harness.actions.get("mes-post-sync:parent")?.availableAt, 15 * 60_000);
  await harness.drain(job, [], [], [], true, 15 * 60_000);
  assert.equal(harness.actions.get("mes-post-sync:parent")?.status, "FAILED");
  assert.equal(job.status, "COMPLETED");
  assert.equal(harness.notifications.length, 0);
});

test("동시 drain은 한 action만 선점하고 알림을 한 번만 만든다", async () => {
  const harness = new MesFinalCheckHarness();
  const parent: Job = { status: "RUNNING", jobType: "MES_SYNC", trigger: "scheduled", slot: "14:00", finalCheck: true, syncSuccess: true };
  const surveys = [business({ businessName: "미등록" })];
  const users = [{ id: 1, isJournalManager: true }];
  harness.transition(parent, "COMPLETED", surveys, [], users);
  await Promise.all([
    harness.drain(parent, surveys, [], users),
    harness.drain(parent, surveys, [], users),
  ]);
  assert.equal(harness.actions.get("mes-post-sync:parent")?.attempts, 1);
  assert.equal(harness.notifications.length, 1);
  assert.equal(parent.status, "COMPLETED");
});

test("제한된 서버 schedule은 5분·10분 재시도의 당일 실행 기회를 제공한다", () => {
  const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
  const postSchedules = config.crons.filter((entry: { path: string }) => entry.path.startsWith("/api/cron/mes-post-sync/"));
  const minutes = postSchedules.map((entry: { schedule: string }) => {
    const [minute, hour, day, month, weekday] = entry.schedule.split(" ");
    assert.deepEqual([day, month, weekday], ["*", "*", "*"]);
    assert.ok(!minute.includes(",") && !minute.includes("/") && !hour.includes(",") && !hour.includes("/"));
    return Number(hour) * 60 + Number(minute);
  }).sort((a: number, b: number) => a - b);
  assert.ok(minutes.includes(5 * 60 + 5));
  assert.ok(minutes.includes(5 * 60 + 10));
  assert.ok(minutes.includes(5 * 60 + 20));
  assert.ok(minutes.includes(6 * 60 + 10));
  assert.ok(minutes.every((minute: number) => minute >= 5 * 60 + 5 && minute <= 7 * 60));
  const scheduler = fs.readFileSync(path.join(process.cwd(), "lib/scheduler/background-tasks.ts"), "utf8");
  assert.match(scheduler, /'5,10,20,30,40,50 14 \* \* \*'/);
  assert.doesNotMatch(scheduler, /'\*\/5 \* \* \* \*'/);
});

test("운영 SQL은 행동 모델과 같은 동등·양방향 포함 및 terminal gate를 사용한다", () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/20260911025729_automation_jobs_common_v1.sql"),
    "utf8",
  );
  const functionSql = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.run_mes_final_post_sync_check"),
    migration.indexOf("REVOKE ALL ON FUNCTION public.run_mes_final_post_sync_check(UUID) FROM PUBLIC"),
  );
  assert.ok(functionSql.includes("regexp_replace(coalesce(m.business_name,''), '[[:space:]]+', '', 'g')"));
  assert.ok(functionSql.includes("= replace(replace(regexp_replace(coalesce(s.business_name,''), '[[:space:]]+', '', 'g')"));
  assert.equal(functionSql.match(/strpos\(/g)?.length, 2);
  assert.ok(functionSql.includes("OLD.status <> 'COMPLETED' AND NEW.status = 'COMPLETED'"));
  assert.ok(functionSql.includes("'MES_POST_SYNC_CHECK'"));
  assert.ok(functionSql.includes("ON CONFLICT (idempotency_key) DO NOTHING"));
});
