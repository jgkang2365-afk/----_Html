"use client";

import { useState, FormEvent, useEffect, Suspense, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isInitialSetup, setIsInitialSetup] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(false);
  
  // 입력 필드 포커스 유지를 위한 ref
  const nameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // 이름 입력 시 최초 설정 필요 여부 확인
  useEffect(() => {
    const checkInitialSetup = async () => {
      if (!name.trim()) {
        setIsInitialSetup(false);
        setConfirmPassword(""); // 이름이 변경되면 확인 비밀번호 초기화
        return;
      }

      // 현재 포커스된 요소와 커서 위치 저장
      const activeElement = document.activeElement as HTMLInputElement | null;
      const savedSelectionStart = activeElement?.selectionStart ?? null;
      const savedSelectionEnd = activeElement?.selectionEnd ?? null;
      const savedInputId = activeElement?.id;

      setCheckingSetup(true);
      try {
        const response = await fetch(`/api/auth/check-initial-setup?name=${encodeURIComponent(name)}`);
        const data = await response.json();
        setIsInitialSetup(data.needsSetup || false);
        if (!data.needsSetup) {
          setConfirmPassword(""); // 일반 로그인이면 확인 비밀번호 초기화
        }
      } catch (err) {
        setIsInitialSetup(false);
        setConfirmPassword("");
      } finally {
        setCheckingSetup(false);
        
        // 포커스와 커서 위치 복원
        requestAnimationFrame(() => {
          if (savedInputId === "name" && nameInputRef.current) {
            nameInputRef.current.focus();
            if (savedSelectionStart !== null && savedSelectionEnd !== null) {
              nameInputRef.current.setSelectionRange(savedSelectionStart, savedSelectionEnd);
            }
          } else if (savedInputId === "password" && passwordInputRef.current) {
            passwordInputRef.current.focus();
            if (savedSelectionStart !== null && savedSelectionEnd !== null) {
              passwordInputRef.current.setSelectionRange(savedSelectionStart, savedSelectionEnd);
            }
          }
        });
      }
    };

    // 디바운싱: 입력 후 500ms 후에 확인
    const timeoutId = setTimeout(checkInitialSetup, 500);
    return () => clearTimeout(timeoutId);
  }, [name]);

  // 입력 핸들러 메모이제이션
  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
  }, []);

  const handlePasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value);
  }, []);

  const handleConfirmPasswordChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setConfirmPassword(e.target.value);
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      let response;
      
      if (isInitialSetup) {
        // 최초 비밀번호 설정 - 비밀번호 확인 검증
        if (password !== confirmPassword) {
          setError("비밀번호가 일치하지 않습니다.");
          setLoading(false);
          return;
        }

        if (password.length < 4) {
          setError("비밀번호는 최소 4자 이상이어야 합니다.");
          setLoading(false);
          return;
        }

        response = await fetch("/api/auth/set-initial-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name, password }),
        });
      } else {
        // 일반 로그인
        response = await fetch("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name, password }),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        // 비밀번호가 설정되지 않은 경우, 초기 설정 모드로 전환
        if (data.error && data.error.includes("비밀번호가 설정되지 않았습니다")) {
          setIsInitialSetup(true);
          setError(null); // 오류 메시지 제거, 초기 설정 모드로 전환
          setLoading(false);
          return;
        }
        setError(data.error || (isInitialSetup ? "비밀번호 설정에 실패했습니다." : "로그인에 실패했습니다."));
        setLoading(false);
        return;
      }

      // 로그인 성공 시 리다이렉트
      // 완전한 페이지 새로고침을 통해 사용자 정보가 즉시 반영되도록 함
      const redirect = searchParams.get("redirect") || "/dashboard";
      window.location.href = redirect;
    } catch (err) {
      setError("예상치 못한 오류가 발생했습니다.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 px-4">
      <Card className="w-full max-w-md">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-text-900 mb-2">
            {isInitialSetup ? "비밀번호 설정" : "로그인"}
          </h1>
          <p className="text-text-700 mb-6">
            {isInitialSetup
              ? "최초 접속 시 비밀번호를 설정해주세요"
              : "측정일지 관리 시스템에 로그인하세요"}
          </p>

          {error && (
            <Alert variant="error" className="mb-4">
              {error}
            </Alert>
          )}

          {isInitialSetup && (
            <Alert variant="warning" className="mb-4">
              최초 접속이므로 비밀번호를 설정해주세요. 설정한 비밀번호로 로그인할 수 있습니다.
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-text-900 mb-2">
                이름
              </label>
              <Input
                ref={nameInputRef}
                id="name"
                key="name-input"
                type="text"
                value={name}
                onChange={handleNameChange}
                placeholder="이름을 입력하세요"
                required
                disabled={loading}
                autoFocus
                autoComplete="username"
              />
              {checkingSetup && (
                <p className="mt-1 text-xs text-text-500">확인 중...</p>
              )}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-900 mb-2">
                {isInitialSetup ? "비밀번호 설정" : "비밀번호"}
              </label>
              <Input
                ref={passwordInputRef}
                id="password"
                key="password-input"
                type="password"
                value={password}
                onChange={handlePasswordChange}
                placeholder={isInitialSetup ? "설정할 비밀번호 (최소 4자)" : "••••••••"}
                required
                disabled={loading}
                autoComplete={isInitialSetup ? "new-password" : "current-password"}
              />
            </div>

            {isInitialSetup && (
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-900 mb-2">
                  비밀번호 확인
                </label>
                <Input
                  id="confirmPassword"
                  key="confirm-password-input"
                  type="password"
                  value={confirmPassword}
                  onChange={handleConfirmPasswordChange}
                  placeholder="비밀번호를 다시 입력하세요"
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="mt-1 text-xs text-red-600">비밀번호가 일치하지 않습니다.</p>
                )}
                {confirmPassword && password === confirmPassword && password.length >= 4 && (
                  <p className="mt-1 text-xs text-green-600">비밀번호가 일치합니다.</p>
                )}
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" disabled={loading || checkingSetup}>
              {loading
                ? isInitialSetup
                  ? "설정 중..."
                  : "로그인 중..."
                : isInitialSetup
                ? "비밀번호 설정 및 로그인"
                : "로그인"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-text-500">
            <p>비밀번호를 잊으셨나요?</p>
            <p className="mt-1">관리자에게 문의하세요.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-surface-50 px-4">
        <Card className="w-full max-w-md">
          <div className="p-6">
            <h1 className="text-2xl font-bold text-text-900 mb-2">로그인</h1>
            <p className="text-text-700 mb-6">측정일지 관리 시스템에 로그인하세요</p>
            <div className="text-center py-8">로딩 중...</div>
          </div>
        </Card>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
