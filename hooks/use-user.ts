"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface User {
  id: string;
  email: string;
  name: string;
  role: "관리자" | "사용자";
}

export function useUser() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

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

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      setUser(null);
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  return { user, loading, logout, refetch: fetchUser };
}

