/**
 * 업무 배정·추천에 사용할 수 있는 측정 사용자 판정의 단일 원천입니다.
 * 사용자 관리 목록과 QA 로그인 계정의 존재 여부에는 관여하지 않습니다.
 */
export interface OperationalMeasurementUser {
  id: number | string | null | undefined;
  job?: string | null;
  is_active?: boolean | null;
}

export function isOperationalMeasurementUser(user: OperationalMeasurementUser): boolean {
  const id = Number(user.id);
  return Number.isInteger(id) &&
    id > 0 &&
    (id < 9000 || id > 9999) &&
    user.is_active === true &&
    user.job === "측정";
}

export function operationalMeasurementUsers<T extends OperationalMeasurementUser>(users: T[] | null | undefined): T[] {
  return (users ?? []).filter(isOperationalMeasurementUser);
}
