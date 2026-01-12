import { requireAuth } from "@/lib/auth/require-auth";
import { BusinessManagement } from "@/components/features/BusinessManagement";

export default async function BusinessesPage() {
  await requireAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-6">측정 대상 사업장 관리</h1>
      <BusinessManagement />
    </div>
  );
}
