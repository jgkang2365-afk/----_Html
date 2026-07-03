"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useUser } from "@/hooks/use-user";
import { cn } from "@/lib/utils";
import React from "react";
import { ProfileModal } from "@/components/features/ProfileModal";
import { Settings, Bell, Check, X, MessageSquare } from "lucide-react";
import { QuotaMemoPanel } from "@/components/admin/QuotaMemoPanel";

interface HeaderProps {
  onMenuToggle?: () => void;
}

interface NavItem {
  href: string;
  label: string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "대시보드" },
  { href: "/businesses", label: "측정 대상 사업장 관리" },
  { href: "/survey", label: "예비조사" },
  { href: "/journal", label: "측정일지" },
  { href: "/summary", label: "측정정보 요약" },
  { href: "/report-processing", label: "보고서 처리", adminOnly: true },
  { href: "/businesses/national-support", label: "건강디딤돌 신청결과" },
  { href: "/sales", label: "매출관리" },
];

const adminNavItems: NavItem[] = [
  { href: "/users", label: "사용자 관리", adminOnly: true },
  { href: "/business-categories", label: "업종분류 관리", adminOnly: true },
  { href: "/admin/quotas", label: "지청별 지정한계", adminOnly: true },
];

interface Notification {
  id: number;
  message: string;
  type: string;
  is_read: boolean;
  related_code?: string;
  created_at: string;
}

export const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, logout, refetch } = useUser();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const isAdmin = user?.role === "관리자";
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const unreadCount = notifications.filter(n => !n.is_read).length;
  const [isMemoOpen, setIsMemoOpen] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) {
        const data = await res.json();
        const list = data.notifications || [];
        setNotifications(list);
        return list;
      }
    } catch (err) {
      console.error("알림 fetch 에러:", err);
    }
    return [];
  };

  const markAsRead = async (id?: number) => {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true }),
      });
      if (res.ok) {
        const updated = await fetchNotifications();
        if (updated && updated.filter((n: Notification) => !n.is_read).length === 0) {
          setShowNotifications(false);
        }
      }
    } catch (err) {
      console.error("알림 읽음 처리 에러:", err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 60000); // 1분마다 확인
      return () => clearInterval(interval);
    }
  }, [user]);

  useEffect(() => {
    if (!loading) {
      console.log("[Header] 사용자 정보:", user);
      console.log("[Header] 관리자 여부:", isAdmin);
    }
  }, [user, loading, isAdmin]);

  return (
    <header className="bg-white border-b border-surface-100 sticky top-0 z-50">
      <div className="h-16 flex items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-4">
          {/* 모바일 메뉴 버튼 */}
          <button
            onClick={onMenuToggle}
            className="lg:hidden p-2 rounded-md hover:bg-surface-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="메뉴 열기"
          >
            <svg
              className="w-6 h-6 text-text-700"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M4 6h16M4 12h16M4 18h16"></path>
            </svg>
          </button>

          {/* 로고/제목 */}
          <h1 className="text-xl font-bold text-primary-600">측정일지 관리 시스템</h1>
        </div>

        {/* 사용자 메뉴 */}
        <div className="flex items-center gap-2">
          {user && (
            <div className="flex items-center gap-2 mr-2">
              {/* 메모장 버튼 (알림 좌측) */}
              <Button
                variant="secondary"
                size="sm"
                className="h-9 w-9 p-0 rounded-full bg-white border border-surface-100 hover:bg-primary-50 text-primary-600 shadow-sm"
                onClick={() => setIsMemoOpen(true)}
                title="메모장"
              >
                <MessageSquare size={20} />
              </Button>

              <div className="relative">
                <Button
                variant="secondary"
                size="sm"
                className="relative h-9 w-9 p-0 rounded-full"
                onClick={() => setShowNotifications(!showNotifications)}
                title="알림"
              >
                <Bell size={20} className="text-text-600" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white border-2 border-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Button>

              {/* 알림 드롭다운 */}
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-surface-100 overflow-hidden animate-in fade-in zoom-in duration-200">
                  <div className="p-3 border-b border-surface-100 flex items-center justify-between bg-surface-50/50">
                    <span className="text-sm font-bold text-text-900">알림</span>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAsRead()}
                        className="text-[11px] text-primary-600 hover:text-primary-700 font-medium"
                      >
                        모두 읽음 처리
                      </button>
                    )}
                  </div>
                  <div className="max-h-96 overflow-y-auto no-scrollbar">
                    {notifications.filter(n => !n.is_read).length === 0 ? (
                      <div className="p-8 text-center text-sm text-text-400">
                        표시할 새로운 알림이 없습니다.
                      </div>
                    ) : (
                      notifications
                        .filter(n => !n.is_read)
                        .map((noti) => (
                          <div
                            key={noti.id}
                            className="p-3 border-b border-surface-50 transition-colors hover:bg-surface-50 cursor-default group"
                          >
                            <div className="flex justify-between gap-2">
                              <p
                                className="text-xs leading-relaxed text-text-900 font-medium"
                                dangerouslySetInnerHTML={{ __html: noti.message }}
                              />
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markAsRead(noti.id);
                                }}
                                className="shrink-0 text-primary-500 hover:text-primary-600 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="읽음 처리"
                              >
                                <Check size={14} />
                              </button>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between">
                              <span className="text-[10px] text-text-400">
                                {new Date(noti.created_at).toLocaleString("ko-KR", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {noti.related_code && (
                                <Link
                                  href={`/businesses?code=${noti.related_code}`}
                                  className="text-[10px] text-primary-500 hover:underline"
                                  onClick={() => setShowNotifications(false)}
                                >
                                  이동
                                </Link>
                              )}
                            </div>
                          </div>
                        ))
                    )}
                  </div>
                </div>
              )}
              </div>
            </div>
          )}

          <div className="relative">
            {user ? (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 pr-4 border-r border-surface-100">
                  <div className="hidden sm:block text-right">
                    <div className="text-sm font-bold text-text-900 leading-tight">{user.name} 님</div>
                    <div className="text-[11px] text-text-500">{isAdmin ? "관리자" : "사용자"}</div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 px-2"
                    onClick={() => setShowProfileModal(true)}
                    title="내 정보 수정"
                  >
                    <Settings size={16} />
                  </Button>
                </div>
                <Button variant="secondary" size="sm" onClick={logout} className="h-8">
                  로그아웃
                </Button>
              </div>
            ) : (
              <Link href="/login" passHref legacyBehavior>
                <Button variant="primary" size="sm">
                  로그인
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* 상단 네비게이션바 (데스크톱 전용) */}
      <nav className="hidden lg:block border-t border-surface-100 bg-white/95 backdrop-blur-sm">
        <div className="px-4 lg:px-6">
          <div className="flex items-center justify-between py-2">
            {/* 일반 메뉴 */}
            <ul className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              {navItems.filter(item => !item.adminOnly || isAdmin).map((item) => {
                const isActive =
                  pathname === item.href ||
                  (pathname?.startsWith(item.href + "/") &&
                    !navItems.some(
                      (other) =>
                        other.href !== item.href &&
                        other.href.startsWith(item.href) &&
                        (pathname === other.href || pathname.startsWith(other.href + "/"))
                    ));

                return (
                  <li key={item.href} className="shrink-0">
                    <Link
                      href={item.href}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap block",
                        isActive
                          ? "bg-primary-50 text-primary-600"
                          : "text-text-700 hover:bg-surface-50 hover:text-text-900"
                      )}
                      aria-current={isActive ? "page" : undefined}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* 우측 메뉴 영역 (내맘대로 및 관리자 메뉴) */}
            <div className="flex items-center gap-3 shrink-0 ml-auto pl-4">
              <Link
                href="/custom-reports"
                className={cn(
                  "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap block",
                  pathname === "/custom-reports"
                    ? "bg-primary-50 text-primary-600 font-bold"
                    : "text-text-700 hover:bg-surface-50 hover:text-text-900"
                )}
                aria-current={pathname === "/custom-reports" ? "page" : undefined}
              >
                내맘대로
              </Link>

              {!loading && isAdmin && (
                <ul className="flex items-center gap-1 border-l border-surface-200 pl-3">
                  {adminNavItems.map((item) => {
                    const isActive =
                      pathname === item.href || pathname?.startsWith(item.href + "/");

                    return (
                      <li key={item.href} className="shrink-0">
                        <Link
                          href={item.href}
                          className={cn(
                            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors whitespace-nowrap block",
                            isActive
                              ? "bg-primary-50 text-primary-600"
                              : "text-text-700 hover:bg-surface-50 hover:text-text-900"
                          )}
                          aria-current={isActive ? "page" : undefined}
                        >
                          {item.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* 메모장 사이드바 패널 (전역) */}
      <QuotaMemoPanel 
        isOpen={isMemoOpen} 
        onClose={() => setIsMemoOpen(false)} 
        currentUserId={user?.id}
        isAdmin={isAdmin}
      />

      {/* 내 정보 수정 모달 */}
      {user && (
        <ProfileModal
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          user={user}
          onUpdate={refetch}
        />
      )}
    </header>
  );
};
