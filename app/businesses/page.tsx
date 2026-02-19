import { requireAuth } from "@/lib/auth/require-auth";
export const dynamic = 'force-dynamic';
import { MeasurementTargetBusinessManagement } from "@/components/features/MeasurementTargetBusinessManagement";

export default async function BusinessesPage() {
  await requireAuth();

  return (
    <MeasurementTargetBusinessManagement />
  );
}
