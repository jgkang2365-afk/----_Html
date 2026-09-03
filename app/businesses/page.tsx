import { requireAuth } from "@/lib/auth/require-auth";
export const dynamic = 'force-dynamic';
import { MeasurementTargetBusinessManagement } from "@/components/features/MeasurementTargetBusinessManagement";
import { CalendarResyncAdminPanel } from "@/components/features/CalendarResyncAdminPanel";

export default async function BusinessesPage() {
  const session = await requireAuth();

  return (
    <>
      <MeasurementTargetBusinessManagement />
      {session.role === "관리자" ? <CalendarResyncAdminPanel /> : null}
    </>
  );
}
