/**
 * 관리자(강종구) 비밀번호 초기화 스크립트
 * 실행: npx tsx scripts/reset-admin-password.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// .env.local 파일 로드
config({ path: resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("환경 변수가 설정되지 않았습니다.");
  console.error("NEXT_PUBLIC_SUPABASE_URL:", supabaseUrl ? "설정됨" : "없음");
  console.error("SUPABASE_SERVICE_ROLE_KEY:", supabaseServiceKey ? "설정됨" : "없음");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function resetAdminPassword() {
  console.log("관리자(강종구) 비밀번호 초기화 중...\n");

  try {
    // 강종구 사용자 확인 (password_hash 컬럼이 없을 수 있으므로 먼저 테이블 구조 확인)
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name, role, password_hash")
      .eq("name", "강종구")
      .single();

    if (userError) {
      if (userError.message?.includes("password_hash") || userError.message?.includes("does not exist")) {
        console.error("❌ 데이터베이스 마이그레이션이 필요합니다.");
        console.error("\n다음 마이그레이션을 먼저 실행해주세요:");
        console.error("  1. lib/db/migrations/011_update_users_for_simple_auth.sql");
        console.error("\nSupabase SQL Editor에서 위 파일의 내용을 실행하세요.");
        process.exit(1);
      }
      console.error("❌ 강종구 사용자를 찾을 수 없습니다.");
      console.error("오류:", userError?.message);
      process.exit(1);
    }

    if (!user) {
      console.error("❌ 강종구 사용자를 찾을 수 없습니다.");
      process.exit(1);
    }

    console.log(`현재 상태:`);
    console.log(`  - 이름: ${user.name}`);
    console.log(`  - 역할: ${user.role}`);
    console.log(`  - 비밀번호 설정 여부: ${user.password_hash ? "설정됨" : "미설정"}\n`);

    // 비밀번호 초기화 (NULL로 설정)
    const { error: updateError } = await supabase
      .from("users")
      .update({
        password_hash: null,
        updated_at: new Date().toISOString(),
      })
      .eq("name", "강종구");

    if (updateError) {
      console.error("❌ 비밀번호 초기화 실패:", updateError.message);
      process.exit(1);
    }

    console.log("✅ 관리자(강종구) 비밀번호가 초기화되었습니다.\n");
    console.log("📝 다음 단계:");
    console.log("  1. 로그인 페이지(/login)로 이동");
    console.log("  2. 이름에 '강종구' 입력");
    console.log("  3. 비밀번호 설정 모드가 표시되면 비밀번호를 2번 입력하여 설정");
    console.log("  4. 설정한 비밀번호로 로그인");
  } catch (error) {
    console.error("❌ 오류 발생:", error);
    process.exit(1);
  }
}

resetAdminPassword().catch(console.error);
