import { requireAuth } from "@/lib/auth/require-auth";
import { DashboardSample } from "@/components/features/DashboardSample";
import { redirect } from "next/navigation";

export default async function DashboardSamplePage() {
  try {
    await requireAuth();
  } catch (error) {
    // 인증 실패 시 로그인 페이지로 리다이렉트
    console.error("[DashboardSamplePage] 인증 오류:", error);
    redirect("/login");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-900 mb-2">대시보드 샘플</h1>
        <p className="text-text-700">
          추가된 유의미한 통계 자료들을 확인할 수 있는 샘플 페이지입니다.
        </p>
      </div>

      <DashboardSample />
    </div>
  );
}
