// Read-only Docker Local HTTP check for the true-confirmed administrator editor.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { config } from "dotenv";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });
assert.match(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", /^http:\/\/127\.0\.0\.1:/);
const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(secret, "local service key required");
const base = process.env.ADMIN_EDIT_LOCAL_URL ?? "http://127.0.0.1:3237";
assert.match(base, /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/);

function cookie(userId, role, proof) {
  const session = encodeURIComponent(JSON.stringify({ userId, name: "local test", role }));
  if (!proof) return `auth_session=${session}`;
  const value = `${userId}.${Math.floor(Date.now() / 1000) + 300}`;
  const signature = createHmac("sha256", secret)
    .update(`preliminary-admin-edit-v1|${value}`).digest("hex");
  return `auth_session=${session}; preliminary_admin_edit_proof=${value}.${signature}`;
}

async function call(path, actor, body) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { Cookie: actor, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

const path = "/api/preliminary-survey-v2/reverse-planner?measurementDate=2026-09-21";
const unsigned = await call(path, cookie(2, "관리자", false));
assert.equal(unsigned.status, 200);
assert.equal(unsigned.body.canOverride, false);
const denied = await call(path, cookie(13, "사용자", true));
assert.equal(denied.status, 403);
const admin = await call(path, cookie(2, "관리자", true));
assert.equal(admin.status, 200);
assert.equal(admin.body.canOverride, true);
for (const code of ["H0176", "H0215"]) {
  const target = admin.body.snapshot.targets.find((item) => item.code === code);
  assert.ok(target?.trueConfirmed && target.existingPlan, `${code} must be persisted and true-confirmed`);
  assert.equal(target.fixedAssignments.length, 0);
  assert.equal(target.existingPlan.assignments.length, 1);
  console.log(`${code}: ${target.existingPlan.preliminaryDate}, ${target.existingPlan.participantUserIds.join(",")}, assignment preserved`);
}
console.log("local admin read, role denial, signed proof: PASS");
const preview = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
  action: "preview", measurementDate: "2026-09-21",
});
assert.equal(preview.status, 200, preview.body.error);
assert.ok(preview.body.previewToken);
for (const code of ["H0176", "H0215"]) {
  const target = admin.body.snapshot.targets.find((item) => item.code === code);
  const proposal = {
    measurementDate: "2026-09-21", previewToken: preview.body.previewToken,
    sourceFingerprint: preview.body.sourceFingerprint, targetId: target.id,
    preliminaryDate: target.existingPlan.preliminaryDate,
    surveyMethod: target.existingPlan.surveyMethod,
    participantUserIds: target.existingPlan.participantUserIds,
    responsibleUserId: target.existingPlan.responsibleUserId,
    reviewerUserId: target.existingPlan.reviewerUserId,
  };
  const validation = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
    action: "validate_admin_edit", ...proposal,
  });
  assert.equal(validation.status, 200, validation.body.error);
  assert.ok(["normal", "policy_exception", "evidence_required"].includes(validation.body.category));
  const measurementProposal = { ...proposal, measurementAssignments: target.existingPlan.assignments.map((item) => ({
    measurementDate: item.measurementDate, assigneeUserId: code === "H0176" ? 13 : 16,
  })) };
  const measurementValidation = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
    action: "validate_admin_edit", ...measurementProposal,
  });
  assert.equal(measurementValidation.status, 200, measurementValidation.body.error);
  assert.ok(measurementValidation.body.publicCodeImpacts.some((item) => item.businessCode === code));
  assert.ok(measurementValidation.body.existingWarnings.every((warning) =>
    target.existingPlan.warnings?.includes(warning) || typeof warning === "string"));
  if (code === "H0176") {
    assert.ok(measurementValidation.body.publicCodeImpacts.some((item) => item.businessCode === "H0215"));
  } else {
    assert.ok(measurementValidation.body.existingWarnings.length > 0,
      "H0215의 기존 측정자·공시료 확인사항이 보존되어야 합니다.");
    console.log(`H0215 existing warnings retained: ${measurementValidation.body.existingWarnings.join(",")}`);
  }
  const unacknowledgedImpact = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
    action: "save_admin_edit", ...measurementProposal, requestId: crypto.randomUUID(),
    overrideReason: "로컬 영향 확인 누락 시험", adminConfirmed: true,
    acknowledgedViolations: measurementValidation.body.violations,
    acknowledgedPublicCodeImpacts: [],
  });
  assert.equal(unacknowledgedImpact.status, 409);
  const noReason = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
    action: "save_admin_edit", ...proposal, requestId: crypto.randomUUID(),
  });
  assert.equal(noReason.status, 409);
  console.log(`${code}: validation=${validation.body.category}, no-reason save denied`);
  const invalidEmployee = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
    action: "validate_admin_edit", ...proposal, participantUserIds: [999999], responsibleUserId: 999999,
  });
  assert.equal(invalidEmployee.status, 400);
  assert.equal(invalidEmployee.body.category, "structural");
  const deniedWrite = await call("/api/preliminary-survey-v2/reverse-planner", cookie(13, "사용자", true), {
    action: "save_admin_edit", ...proposal, requestId: crypto.randomUUID(),
  });
  assert.equal(deniedWrite.status, 403);
}
const exceptionTarget = admin.body.snapshot.targets.find((item) => item.code === "H0176");
const outsideRule = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
  action: "validate_admin_edit", measurementDate: "2026-09-21",
  previewToken: preview.body.previewToken, sourceFingerprint: preview.body.sourceFingerprint,
  targetId: exceptionTarget.id, preliminaryDate: "2026-09-22",
  surveyMethod: exceptionTarget.existingPlan.surveyMethod,
  participantUserIds: exceptionTarget.existingPlan.participantUserIds,
  responsibleUserId: exceptionTarget.existingPlan.responsibleUserId,
  reviewerUserId: exceptionTarget.existingPlan.reviewerUserId,
});
assert.equal(outsideRule.status, 200, outsideRule.body.error);
assert.equal(outsideRule.body.category, "policy_exception");
assert.ok(outsideRule.body.violations.length > 0);
const unconfirmedException = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
  action: "save_admin_edit", measurementDate: "2026-09-21",
  previewToken: preview.body.previewToken, sourceFingerprint: preview.body.sourceFingerprint,
  targetId: exceptionTarget.id, preliminaryDate: "2026-09-22",
  surveyMethod: exceptionTarget.existingPlan.surveyMethod,
  participantUserIds: exceptionTarget.existingPlan.participantUserIds,
  responsibleUserId: exceptionTarget.existingPlan.responsibleUserId,
  reviewerUserId: exceptionTarget.existingPlan.reviewerUserId,
  overrideReason: "로컬 관리자 예외 확인 시험", requestId: crypto.randomUUID(),
});
assert.equal(unconfirmedException.status, 409);
console.log(`H0176: policy exception warnings=${outsideRule.body.violations.length}`);
const browserFixture = admin.body.snapshot.targets.find((item) => item.code === "ZT9901");
if (browserFixture) {
  console.log(`ZT9901 GET: id=${browserFixture.id}, confirmed=${browserFixture.trueConfirmed}, plan=${Boolean(browserFixture.existingPlan)}`);
  const fixtureValidation = await call("/api/preliminary-survey-v2/reverse-planner", cookie(2, "관리자", true), {
    action: "validate_admin_edit", measurementDate: "2026-09-21",
    previewToken: preview.body.previewToken, sourceFingerprint: preview.body.sourceFingerprint,
    targetId: browserFixture.id, preliminaryDate: "2026-09-10",
    surveyMethod: browserFixture.existingPlan.surveyMethod,
    participantUserIds: browserFixture.existingPlan.participantUserIds,
    responsibleUserId: browserFixture.existingPlan.responsibleUserId,
    reviewerUserId: browserFixture.existingPlan.reviewerUserId,
  });
  console.log(`ZT9901 POST: status=${fixtureValidation.status}, category=${fixtureValidation.body.category}, error=${fixtureValidation.body.error}`);
}
