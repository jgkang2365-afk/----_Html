import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  collectReportProcessingJournalIdentities,
  executeWithRegisteredMeasurementJournals,
  findMissingRegisteredMeasurementJournals,
  hasRegisteredMeasurementJournal,
  REPORT_PROCESSING_JOURNAL_REQUIRED_CODE,
} from "../lib/report-processing/journal-gate";

type JournalRow = {
  code: string;
  measurement_year: number;
  measurement_period: string;
};

function createJournalClient(getRows: () => JournalRow[]) {
  return {
    from(table: string) {
      assert.equal(table, "measurement_journal");
      return {
        select(columns: string) {
          assert.equal(columns, "code, measurement_year, measurement_period");
          return {
            async in(column: string, codes: string[]) {
              assert.equal(column, "code");
              return {
                data: getRows().filter((row) => codes.includes(row.code)),
                error: null,
              };
            },
          };
        },
      };
    },
  };
}

test("email과 K2B payload에서 exact journal identity를 추출한다", () => {
  assert.deepEqual(
    collectReportProcessingJournalIdentities("email", [
      {
        reports: [
          { code: "SYN001", year: 2026, period: "상반기" },
          { code: "SYN001", year: 2026, period: "상반기" },
        ],
      },
    ]),
    [{ code: "SYN001", year: 2026, period: "상반기" }],
  );
  assert.deepEqual(
    collectReportProcessingJournalIdentities("k2b", [
      { code: "SYN002", year: 2026, period: "하반기(수시)" },
    ]),
    [{ code: "SYN002", year: 2026, period: "하반기(수시)" }],
  );
});

test("정규 journal은 같은 code/year의 수시 identity를 충족하지 않는다", () => {
  const journals = [
    { code: "SYN003", measurement_year: 2026, measurement_period: "상반기" },
  ];
  assert.equal(
    hasRegisteredMeasurementJournal(journals, {
      code: "SYN003",
      year: 2026,
      period: "상반기",
    }),
    true,
  );
  assert.equal(
    hasRegisteredMeasurementJournal(journals, {
      code: "SYN003",
      year: 2026,
      period: "상반기(수시)",
    }),
    false,
  );
});

test("queue 확인 뒤 journal이 삭제되면 외부 side effect stub을 실행하지 않는다", async () => {
  let journals: JournalRow[] = [
    { code: "SYN004", measurement_year: 2026, measurement_period: "하반기" },
  ];
  const client = createJournalClient(() => journals);
  const identities = [{ code: "SYN004", year: 2026, period: "하반기" }];

  assert.deepEqual(
    await findMissingRegisteredMeasurementJournals(client, identities),
    [],
  );

  journals = [];
  let sideEffectCalls = 0;
  const blocked = await executeWithRegisteredMeasurementJournals(
    client,
    identities,
    async () => {
      sideEffectCalls += 1;
      return "sent";
    },
  );
  assert.deepEqual(blocked, { executed: false, missing: identities });
  assert.equal(sideEffectCalls, 0);

  journals = [
    { code: "SYN004", measurement_year: 2026, measurement_period: "하반기" },
  ];
  const allowed = await executeWithRegisteredMeasurementJournals(
    client,
    identities,
    async () => {
      sideEffectCalls += 1;
      return "sent";
    },
  );
  assert.deepEqual(allowed, { executed: true, value: "sent" });
  assert.equal(sideEffectCalls, 1);
});

test("목록·queue·worker·직접 전송 경로가 같은 journal gate를 사용한다", () => {
  const listRoute = readFileSync("app/api/report-processing/route.ts", "utf8");
  const queueRoute = readFileSync("app/api/report-processing/queue/route.ts", "utf8");
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const directEmail = readFileSync("app/api/report-processing/send-email/route.ts", "utf8");
  const directK2B = readFileSync("app/api/report-processing/upload-k2b/route.ts", "utf8");

  assert.match(listRoute, /if \(!journal\) return \[\];/);
  assert.ok(
    queueRoute.indexOf("findMissingRegisteredMeasurementJournals") <
      queueRoute.indexOf(".from('background_jobs')"),
  );
  assert.match(queueRoute, new RegExp(REPORT_PROCESSING_JOURNAL_REQUIRED_CODE));

  assert.match(worker, /executeWithRegisteredMeasurementJournals[\s\S]+emailService\.sendReportEmail/);

  assert.match(worker, /executeWithRegisteredMeasurementJournals[\s\S]+k2b\.uploadReport/);

  assert.match(directEmail, /executeWithRegisteredMeasurementJournals[\s\S]+emailService\.sendReportEmail/);
  assert.match(directK2B, /executeWithRegisteredMeasurementJournals[\s\S]+k2b\.uploadReport/);
});

test("ID-only PATCH는 기존 target identity로 현재 true-confirmed guard를 실행한다", () => {
  const businessesRoute = readFileSync("app/api/businesses/route.ts", "utf8");
  const guardStart = businessesRoute.indexOf("const confirmedIdentityCode");
  const guardEnd = businessesRoute.indexOf("const allowedUpdateColumns", guardStart);
  const guard = businessesRoute.slice(guardStart, guardEnd);

  assert.match(businessesRoute, /select\("id, code, measurement_date/);
  assert.match(guard, /confirmedIdentityCode = existingCode \?\? code \?\? null/);
  assert.match(guard, /confirmedIdentityYear = existingYear/);
  assert.match(guard, /confirmedIdentityPeriod = existingPeriod/);
  assert.match(guard, /\.eq\("code", confirmedIdentityCode\)/);
  assert.match(guard, /\.eq\("measurement_year", Number\(confirmedIdentityYear\)\)/);
  assert.match(guard, /replace\("\(수시\)", ""\)/);
  assert.match(guard, /\.like\("measurement_period", `\$\{basePeriod\}%`\)/);
  assert.doesNotMatch(guard, /&& code && year && period/);
});
