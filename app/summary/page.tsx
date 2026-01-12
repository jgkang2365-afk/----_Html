import { requireAuth } from "@/lib/auth/require-auth";
import { SummaryTable } from "@/components/features/SummaryTable";

export default async function SummaryPage() {
  await requireAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-4">측정정보 요약</h1>
      <p className="text-text-700 mb-6">측정일지와 예비조사 정보를 통합하여 확인할 수 있습니다.</p>
      <SummaryTable />
    </div>
  );
}
