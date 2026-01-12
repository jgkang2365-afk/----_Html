import { requireAuth } from "@/lib/auth/require-auth";
import { NationalSupportManagement } from "@/components/features/NationalSupportManagement";

export default async function NationalSupportPage() {
  await requireAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-6">건강디딤돌 신청결과</h1>
      <NationalSupportManagement />
    </div>
  );
}
