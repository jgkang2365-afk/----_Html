"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface User {
  id: string;
  email: string;
  name: string;
  role: "관리자" | "사용자";
}

export function useUser() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    try {
      const response = await fetch("/api/auth/user", {
        cache: "no-store",
      });

      if (response.ok) {
        const data = await response.json();
        console.log("[useUser] 사용자 정보:", data.user);
        setUser(data.user);
      } else {
        console.error("[useUser] 사용자 정보 조회 실패:", response.status, response.statusText);
        try {
          const errorData = await response.json();
          console.error("[useUser] 에러 상세:", errorData);
        } catch {
          // JSON 파싱 실패 시 무시
        }
        setUser(null);
      }
    } catch (error) {
      console.error("[useUser] 사용자 정보 조회 예외:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
    // 사용자 정보가 로드되지 않았을 경우 재시도
    const retryTimer = setTimeout(() => {
      if (!user && !loading) {
        console.log("[useUser] 사용자 정보가 없어 재시도합니다.");
        fetchUser();
      }
    }, 1000);

    return () => clearTimeout(retryTimer);
  }, []);

  // pathname 변경 시 사용자 정보 다시 가져오기 (로그인 후 페이지 이동 시)
  // 이전 pathname을 추적하여 로그인 페이지에서 다른 페이지로 이동할 때만 refetch
  useEffect(() => {
    if (pathname && pathname !== "/login") {
      // 로그인 페이지가 아닐 때만 refetch (너무 자주 호출되지 않도록)
      // 단, 이미 사용자 정보가 있으면 refetch하지 않음 (불필요한 요청 방지)
      if (!user) {
        console.log("[useUser] pathname 변경 감지, 사용자 정보 refetch:", pathname);
        fetchUser();
      }
    }
  }, [pathname]);

  const logout = async () => {
    try {
      // 로그아웃 API 호출
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (error) {
      console.error("Logout API error:", error);
    } finally {
      // API 성공 여부와 상관없이 클라이언트 상태 초기화 및 로그인 페이지로 강제 이동
      setUser(null);
      // window.location.href를 사용하여 전체 페이지를 새로고침하며 이동 (메모리 및 상태 완전 초기화)
      window.location.href = "/login";
    }
  };

  return { user, loading, logout, refetch: fetchUser };
}

