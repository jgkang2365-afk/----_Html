export interface LookupErrorDisplay {
  type: string;
  reason: string;
  action: string;
}

// This is display-only. Match evidence in the stored error; never infer a cause
// from a generic Python/Selenium wrapper or an unqualified timeout.
export function describeNationalSupportLookupError(message: string): LookupErrorDisplay {
  const error = message.trim();
  const matches = (pattern: RegExp) => pattern.test(error);

  if (matches(/(?:No module named|ModuleNotFoundError|ImportError:.*(?:No module named|cannot import name))\s*['"]?(?:selenium|customtkinter|webdriver_manager)\b/i)) {
    const moduleName = error.match(/\b(selenium|customtkinter|webdriver_manager)\b/i)?.[1] ?? "필수 모듈";
    return { type: "실행환경 오류", reason: `자동화 실행에 필요한 ${moduleName} 모듈이 설치되지 않았습니다.`, action: "건강디딤돌 Worker의 Python 환경에 해당 모듈을 설치한 뒤 다시 조회해 주세요." };
  }
  if (matches(/(?:session not created|Chrome failed to start|ChromeDriver.*(?:failed|not found|executable)|chromedriver executable needs to be|Unable to obtain driver for chrome|cannot find Chrome binary|cannot find chrome binary|DevToolsActivePort|브라우저 (?:실행|초기화) 실패)/i)) {
    return { type: "브라우저 오류", reason: "Chrome 또는 WebDriver를 시작하지 못했습니다.", action: "Worker PC의 Chrome 및 WebDriver 설치·실행 상태를 확인한 뒤 다시 조회해 주세요." };
  }
  if (matches(/(?:ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT|net::ERR_|portal\.kosha\.or\.kr.*(?:접속|연결|응답|timeout|timed out)|공단 (?:사이트|페이지).*(?:접속|연결|응답).*(?:실패|지연|시간 초과))/i)) {
    return { type: "접속 오류", reason: "공단 사이트에 연결하지 못했거나 응답을 받지 못했습니다.", action: "네트워크와 공단 사이트 접속 상태를 확인한 뒤 다시 조회해 주세요." };
  }
  if (matches(/(?:NoSuchElementException|Unable to locate element|no such element|(?:화면|페이지|버튼|입력란|입력 필드|체크박스|옵션|항목|요소).*(?:찾을 수 없습니다|탐색 실패)|(?:조회|결과).*(?:테이블|화면 요소).*(?:찾을 수 없습니다|탐색 실패))/i)) {
    return { type: "화면 인식 오류", reason: "공단 화면에서 조회에 필요한 항목을 찾지 못했습니다.", action: "공단 화면이 정상적으로 열리는지 확인하고 다시 조회해 주세요. 반복되면 화면 변경 여부를 담당자에게 알려 주세요." };
  }
  if (matches(/(?:자동 신청 담당자명이 없습니다|담당자명 또는 010 휴대전화가 없습니다|담당자 휴대전화.*010 번호여야|(?:산재|개시|대표자|담당자|휴대전화|전화번호).*(?:누락|없습니다|필수|형식 오류|형식이 올바르지|11자리|010 번호여야)|(?:required argument|invalid format).*(?:sanjae|commencement|representative|contact_name|contact_phone))/i)) {
    const reason = matches(/담당자 휴대전화.*010 번호여야/i)
      ? "신청 담당자 휴대전화가 010 번호 형식에 맞지 않습니다."
      : matches(/자동 신청 담당자명이 없습니다/i)
        ? "자동 신청에 필요한 담당자명이 없습니다."
        : "조회·신청에 필요한 입력값이 없거나 형식이 맞지 않습니다.";
    return { type: "입력정보 오류", reason, action: "산재·개시번호, 대표자명과 신청 담당자 연락처를 확인한 뒤 다시 조회해 주세요." };
  }
  if (matches(/(?:EMPLOYEE_CHECK_FAILED|NO_EMPLOYEE_INFO|근로자\s*수.*(?:확인 실패|확인에 실패|조회 실패|정보 없음|조회할 수 없)|비용\s*지원\s*비율.*(?:조회 실패|확인 실패|찾을 수 없))/i)) {
    const reason = matches(/(?:NO_EMPLOYEE_INFO|근로자\s*수 정보 없음)/i)
      ? "공단에 근로자수 정보가 없습니다."
      : matches(/비용\s*지원\s*비율/i)
        ? "공단의 비용지원비율을 확인하지 못했습니다."
        : "공단의 근로자수를 확인하지 못했습니다.";
    return { type: "근로자수 확인 실패", reason, action: "공단의 근로자수와 비용지원비율을 직접 확인한 뒤 재조회해 주세요." };
  }
  if (matches(/(?:OVER_50|YEAR_CHECK_REQUIRED|신청 시점 50인 이상|신청조건 불충족|신청 조건 불충족|신청 보류|신청을 보류|신청 대상이 아닙니다)/i)) {
    const reason = matches(/(?:OVER_50|신청 시점 50인 이상)/i)
      ? "신청 시점에 근로자 50인 이상으로 확인되어 신청이 보류되었습니다."
      : matches(/YEAR_CHECK_REQUIRED/i)
        ? "신청 연도가 현재 연도와 달라 자동 신청이 보류되었습니다."
        : "저장된 사유에 신청 조건 불충족 또는 신청 보류가 명시되어 있습니다.";
    return { type: "신청조건 불충족·신청 보류", reason, action: "공단의 신청 조건과 현재 신청 가능 여부를 직접 확인해 주세요." };
  }
  if (matches(/(?:JOURNAL_REGISTERED_SKIP|ALREADY_APPLIED|측정일지.*등록.*(?:제외|신청하지 않았)|기존 신청.*(?:확인|내역)|중복 신청.*(?:방지|제외))/i)) {
    const reason = matches(/(?:JOURNAL_REGISTERED_SKIP|측정일지.*등록)/i)
      ? "측정일지가 등록되어 신청 대상에서 제외되었습니다."
      : "기존 신청 내역이 확인되어 중복 신청을 진행하지 않았습니다.";
    return { type: "중복 신청 방지·측정일지 등록 제외", reason, action: "기존 신청 내역과 측정일지 등록 상태를 확인해 주세요." };
  }
  if (matches(/(?:APPLICATION_UNCERTAIN|APPLY_RESULT_UNKNOWN|자동 신청 완료 여부를.*확인하지 못|공단 결과를 \d+회 후속 조회했으나 확정하지 못|신청 결과.*(?:확인 불가|확인하지 못|확정하지 못))/i)) {
    return { type: "신청 결과 확인 불가", reason: "신청 또는 조회 결과를 확정하지 못했습니다.", action: "중복 신청을 피하도록 공단에서 신청 내역과 결과를 직접 확인해 주세요." };
  }
  return { type: "미분류 시스템 오류", reason: "저장된 오류만으로는 실패 원인을 확인할 수 없습니다.", action: "기술 상세를 담당자에게 전달해 원인을 확인해 주세요." };
}
