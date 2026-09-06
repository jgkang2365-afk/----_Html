/** KST 기준 K2B 실제결과 검증 스케줄과 재확인 범위. */
export const K2B_VERIFY_UNRESOLVED_DAYS = 7;
/** 내부 전송기록이 비어 있는 최근 일지 후보의 상한. K2B 실제결과와 정확히 한 건만 일치할 때도 자동 확정하지 않고 YELLOW로 남긴다. */
export const K2B_VERIFY_MANUAL_CANDIDATE_LIMIT = 200;
export const K2B_VERIFY_SCHEDULE = "0 1 * * *";
