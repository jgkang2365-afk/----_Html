import { requireAuth } from "@/lib/auth/require-auth";
import { SalesManagement } from "@/components/features/SalesManagement";

export default async function SalesPage() {
  await requireAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-4">매출관리</h1>
      <p className="text-text-700 mb-6">측정비와 기타 매출을 관리하고 집계할 수 있습니다.</p>
      <SalesManagement />
    </div>
  );
}
