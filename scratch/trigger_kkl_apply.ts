import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function trigger() {
  const supabase = createServerClient();
  
  // 1. KKL 유한회사 정보 가져오기
  const { data: target, error } = await supabase
    .from("measurement_target_business")
    .select("*")
    .eq("code", "H0394")
    .single();

  if (error || !target) {
    console.error("KKL 레코드 조회 실패:", error);
    return;
  }

  console.log("KKL 데이터 발견:", target.business_name);
  console.log("기동을 위해 sync_status를 '대기'로 초기화...");
  
  await supabase
    .from("measurement_target_business")
    .update({ sync_status: "대기", sync_error_message: null })
    .eq("id", target.id);

  console.log("자동 신청결과 조회 API 호출 시도...");
  
  // API 주소로 직접 포스트 요청
  const response = await fetch("http://localhost:3000/api/businesses/national-support/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_id: target.id,
      sanjae: target.industrial_accident_number,
      commencement: target.commencement_number,
      representative: target.representative_name,
      contact_name: "담당자",
      contact_phone: "010-0000-0000",
      period: "하반기",
      code: "H0394",
      year: 2026
    })
  });

  if (!response.ok) {
    console.error("API 기동 실패:", await response.text());
  } else {
    console.log("API 성공적으로 기동 완료! 백그라운드 크롤링이 시작되었습니다.");
  }
}

trigger().catch(console.error);
