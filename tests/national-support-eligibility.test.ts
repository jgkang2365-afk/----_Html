import assert from "node:assert/strict";
import test from "node:test";
import {
  canRequestNationalSupportLookup,
  extractInsuranceNumbers,
  getNationalSupportDisplayStatus,
  hasNationalSupportApplicationInformation,
  getInitialNationalSupportState,
  isValidNationalSupportContactName,
  isValidNationalSupportMobile,
} from "../lib/national-support/eligibility";

test("표제가 있는 산재·개시번호를 비고에서 추출한다", () => {
  assert.deepEqual(
    extractInsuranceNumbers("산재 : 30713637746, 개시번호 : 92515679367"),
    {
      industrialAccidentNumber: "30713637746",
      commencementNumber: "92515679367",
    },
  );
  assert.deepEqual(
    extractInsuranceNumbers("산재: 30781123856, 개시: 92600209747"),
    {
      industrialAccidentNumber: "30781123856",
      commencementNumber: "92600209747",
    },
  );
});

test("최소 정보만 있는 정기 신규 등록은 정보 부족 상태로 등록된다", () => {
  assert.deepEqual(getInitialNationalSupportState({ period: "하반기" }), {
    nationalSupportStatus: null,
    syncStatus: "정보부족",
    shouldQueueLookup: false,
    shouldAutoApply: false,
  });
});

test("조회 정보가 완성된 정기 신규 등록만 후속 조회 대상이 된다", () => {
  assert.deepEqual(getInitialNationalSupportState({
    period: "하반기",
    industrial_accident_number: "30713637746",
    commencement_number: "92515679367",
    representative_name: "홍길동",
  }), {
    nationalSupportStatus: null,
    syncStatus: "조회대기",
    shouldQueueLookup: true,
    shouldAutoApply: false,
  });
});

test("조회 정보와 담당자 정보가 모두 있으면 자동 신청 대상이 된다", () => {
  const input = {
    period: "하반기",
    industrial_accident_number: "30713637746",
    commencement_number: "92515679367",
    representative_name: "홍길동",
    manager_name: "김담당 과장",
    manager_mobile: "010-9241-0780",
  };
  assert.equal(hasNationalSupportApplicationInformation(input), true);
  assert.equal(getInitialNationalSupportState(input).shouldAutoApply, true);
});

test("수시 신규 등록은 자동 비대상이며 조회하지 않는다", () => {
  assert.deepEqual(getInitialNationalSupportState({ period: "하반기(수시)" }), {
    nationalSupportStatus: "비대상",
    syncStatus: "성공",
    shouldQueueLookup: false,
    shouldAutoApply: false,
  });
});

test("표제 없는 숫자나 11자리가 아닌 값은 추출하지 않는다", () => {
  assert.deepEqual(extractInsuranceNumbers("전화 010-1234-5678 / 30713637746"), {
    industrialAccidentNumber: null,
    commencementNumber: null,
  });
  assert.equal(
    extractInsuranceNumbers("산재: 12345").industrialAccidentNumber,
    null,
  );
});

test("정기 측정의 조회 정보가 완성되면 미확인 상태에서도 조회할 수 있다", () => {
  const input = {
    period: "하반기",
    national_support_status: null,
    sync_status: "정보부족",
    industrial_accident_number: "30713637746",
    commencement_number: "92515679367",
    representative_name: "홍길동",
  };
  assert.equal(canRequestNationalSupportLookup(input), true);
  assert.equal(getNationalSupportDisplayStatus(input), "정보 부족");
});

test("수시·비대상·진행 중·완료 상태는 중복 조회하지 않는다", () => {
  const ready = {
    industrial_accident_number: "30713637746",
    commencement_number: "92515679367",
    representative_name: "홍길동",
  };
  assert.equal(canRequestNationalSupportLookup({ ...ready, period: "하반기(수시)" }), false);
  assert.equal(canRequestNationalSupportLookup({ ...ready, period: "하반기", national_support_status: "비대상" }), false);
  assert.equal(canRequestNationalSupportLookup({ ...ready, period: "하반기", sync_status: "조회중" }), false);
  assert.equal(canRequestNationalSupportLookup({ ...ready, period: "하반기", sync_status: "성공", national_support_status: "대상" }), false);
});

test("공단 50인 이상 판정 대기는 확정 비대상과 구분해 표시하고 재조회할 수 있다", () => {
  const input = {
    period: "하반기",
    sync_status: "비대상대기",
    industrial_accident_number: "30713637746",
    commencement_number: "92515679367",
    representative_name: "홍길동",
  };
  assert.equal(getNationalSupportDisplayStatus(input), "50인↑ (신청보류)");
  assert.equal(canRequestNationalSupportLookup(input), true);
});

test("자동 신청 후 확정 결과가 없으면 신청완료 대기로 표시한다", () => {
  assert.equal(
    getNationalSupportDisplayStatus({ period: "하반기", sync_status: "신청완료대기" }),
    "신청완료(결과 대기)",
  );
});


test("자동 신청 담당자와 휴대전화의 더미값을 거부한다", () => {
  assert.equal(isValidNationalSupportContactName("남주원 이사"), true);
  assert.equal(isValidNationalSupportContactName("담당자"), false);
  assert.equal(isValidNationalSupportContactName("1234"), false);
  assert.equal(isValidNationalSupportMobile("010-9241-0780"), true);
  assert.equal(isValidNationalSupportMobile("041-123-4567"), false);
  assert.equal(isValidNationalSupportMobile("010-0000-0000"), false);
  assert.equal(isValidNationalSupportMobile("010-1234-5678"), false);
});
