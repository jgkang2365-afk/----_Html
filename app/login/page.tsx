"use client";

import { useState, FormEvent, useEffect, Suspense, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
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
  const [rememberName, setRememberName] = useState(false);

  // 입력 필드 포커스 유지를 위한 ref
  const nameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // LocalStorage에서 저장된 이름 불러오기
  useEffect(() => {
    const savedName = localStorage.getItem("savedLoginName");
    if (savedName) {
      setName(savedName);
      setRememberName(true);
    }
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

      // 로그인 성공 시 이름 저장 처리
      if (rememberName) {
        localStorage.setItem("savedLoginName", name);
      } else {
        localStorage.removeItem("savedLoginName");
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
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름을 입력하세요"
                required
                disabled={loading}
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-text-900 mb-2">
                {isInitialSetup ? "비밀번호 설정" : "비밀번호"}
              </label>
              <Input
                ref={passwordInputRef}
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="비밀번호를 다시 입력하세요"
                  required
                  disabled={loading}
                  autoComplete="new-password"
                />
                <div className="min-h-[1.25rem] mt-1">
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-red-600">비밀번호가 일치하지 않습니다.</p>
                  )}
                  {confirmPassword && password === confirmPassword && password.length >= 4 && (
                    <p className="text-xs text-green-600">비밀번호가 일치합니다.</p>
                  )}
                </div>
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading
                ? isInitialSetup
                  ? "설정 중..."
                  : "로그인 중..."
                : isInitialSetup
                  ? "비밀번호 설정 및 로그인"
                  : "로그인"}
            </Button>

            <div className="flex items-center justify-end mt-2">
              <Checkbox
                id="rememberName"
                label="이름 저장"
                checked={rememberName}
                onChange={(e) => setRememberName(e.target.checked)}
                disabled={loading}
              />
            </div>
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
