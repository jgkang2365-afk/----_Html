import { requireAuth } from "@/lib/auth/require-auth";
import { SyncStatus } from "@/components/features/SyncStatus";
import { Dashboard } from "@/components/features/Dashboard";

export default async function DashboardPage() {
  await requireAuth(); // 보호된 라우트

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-900 mb-2">대시보드</h1>
        <p className="text-text-700">측정일지 관리 시스템 대시보드입니다.</p>
      </div>

      {/* Excel 파일 동기화 상태 */}
      <SyncStatus />

      {/* 대시보드 지표 */}
      <Dashboard />
    </div>
  );
}
