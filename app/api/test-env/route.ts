/**
 * 환경 변수 확인 API (디버깅용)
 * GET /api/test-env
 * 
 * 주의: 실제 키 값은 반환하지 않고 존재 여부만 확인합니다.
 */

import { NextResponse } from "next/server";

export async function GET() {
  // 보안을 위해 실제 값은 반환하지 않음
  const envCheck = {
    hasPublicUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    hasPublicKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    hasServerUrl: !!process.env.SUPABASE_URL,
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    // 값의 형식만 확인 (실제 값은 노출하지 않음)
    publicUrlFormat: process.env.NEXT_PUBLIC_SUPABASE_URL 
      ? (process.env.NEXT_PUBLIC_SUPABASE_URL.startsWith('https://') ? '올바른 형식' : '형식 오류: https://로 시작해야 함')
      : '없음',
    publicKeyLength: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY 
      ? `${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length}자`
      : '없음',
    publicKeyStartsWith: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.startsWith('eyJ') ? '올바른 형식 (JWT)' : '형식 오류: JWT 토큰이 아님')
      : '없음',
  };

  return NextResponse.json({
    message: "환경 변수 확인 결과",
    envCheck,
    tips: [
      "NEXT_PUBLIC_SUPABASE_URL은 https://로 시작해야 합니다",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY는 JWT 토큰 형식(eyJ로 시작)이어야 합니다",
      "환경 변수를 변경했다면 개발 서버를 재시작하세요",
      "Supabase 대시보드에서 키가 올바른지 확인하세요",
    ],
  });
}

