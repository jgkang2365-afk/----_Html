/**
 * 초기 사용자 데이터 생성 스크립트
 * 실행: npm run init-users (package.json에 스크립트 추가 필요)
 * 또는: npx tsx scripts/init-users.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import * as bcrypt from "bcryptjs";

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

// 초기 사용자 목록
const users = [
  { name: "이태환", role: "사용자" },
  { name: "강종구", role: "관리자" },
  { name: "배윤민", role: "사용자" },
  { name: "고유빈", role: "사용자" },
  { name: "김민영", role: "사용자" },
  { name: "양세경", role: "사용자" },
  { name: "이주형", role: "사용자" },
  { name: "한기문", role: "사용자" },
];

async function initUsers() {
  console.log("초기 사용자 데이터 생성 중...\n");
  console.log("⚠️  비밀번호는 설정하지 않습니다. 사용자가 최초 로그인 시 설정합니다.\n");

  for (const user of users) {
    try {
      // 기존 사용자 확인
      const { data: existingUser } = await supabase
        .from("users")
        .select("id, name, password_hash")
        .eq("name", user.name)
        .single();

      if (existingUser) {
        // 기존 사용자가 있으면 역할만 업데이트 (비밀번호는 유지)
        const { error: updateError } = await supabase
          .from("users")
          .update({
            role: user.role,
            updated_at: new Date().toISOString(),
          })
          .eq("name", user.name);

        if (updateError) {
          console.error(`❌ ${user.name} 업데이트 실패:`, updateError.message);
        } else {
          const status = existingUser.password_hash ? "비밀번호 설정됨" : "비밀번호 미설정";
          console.log(`✓ ${user.name} (${user.role}) 업데이트 완료 [${status}]`);
        }
      } else {
        // 새 사용자 생성 (비밀번호 없이)
        const { error: insertError } = await supabase
          .from("users")
          .insert({
            name: user.name,
            role: user.role,
            password_hash: null, // 비밀번호는 최초 로그인 시 설정
          });

        if (insertError) {
          console.error(`❌ ${user.name} 생성 실패:`, insertError.message);
        } else {
          console.log(`✓ ${user.name} (${user.role}) 생성 완료 [비밀번호 미설정]`);
        }
      }
    } catch (error) {
      console.error(`❌ ${user.name} 처리 중 오류:`, error);
    }
  }

  console.log("\n초기 사용자 데이터 생성 완료!");
  console.log("\n📝 사용자 안내:");
  console.log("  - 최초 로그인 시 비밀번호를 설정할 수 있습니다.");
  console.log("  - 설정한 비밀번호로 이후 로그인할 수 있습니다.");
}

initUsers().catch(console.error);
