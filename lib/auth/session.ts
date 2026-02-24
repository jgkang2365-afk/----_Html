/**
 * 세션 관리 유틸리티
 * 간단한 쿠키 기반 세션 관리
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "auth_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7일

export interface SessionData {
  userId: number;
  name: string;
  role: "관리자" | "사용자";
}

/**
 * 세션 쿠키 설정
 */
export function setSessionCookie(
  response: NextResponse,
  sessionData: SessionData
): void {
  const sessionValue = JSON.stringify(sessionData);
  response.cookies.set(SESSION_COOKIE_NAME, sessionValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_DURATION / 1000, // 초 단위
    path: "/",
  });
}

/**
 * 세션 쿠키 제거
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.delete(SESSION_COOKIE_NAME);
}

/**
 * 서버 사이드에서 세션 데이터 조회
 */
export async function getSession(): Promise<SessionData | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie?.value) {
      return null;
    }

    try {
      return JSON.parse(sessionCookie.value) as SessionData;
    } catch (parseError) {
      console.error("[getSession] 세션 쿠키 파싱 오류:", parseError);
      return null;
    }
  } catch (error) {
    console.error("[getSession] 함수 오류:", error);
    return null;
  }
}

/**
 * 미들웨어에서 세션 데이터 조회 (NextRequest 사용)
 */
export function getSessionFromRequest(
  request: NextRequest
): SessionData | null {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    return null;
  }

  try {
    return JSON.parse(sessionCookie.value) as SessionData;
  } catch {
    return null;
  }
}
