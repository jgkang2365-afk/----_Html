import { LaborOfficeLookup } from "@/components/features/LaborOfficeLookup";
import { requireAuth } from "@/lib/auth/require-auth";

export const dynamic = "force-dynamic";

export default async function LaborOfficesPage() {
  await requireAuth();

  return <div className="space-y-3">
    <h1 className="text-2xl font-bold text-text-900">노동관서 조회</h1>
    <LaborOfficeLookup />
  </div>;
}
