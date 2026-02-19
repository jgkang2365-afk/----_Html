import { requireAuth } from "@/lib/auth/require-auth";
export const dynamic = 'force-dynamic';
import { DashboardClient } from "@/components/features/DashboardClient";

export default async function DashboardPage() {
  await requireAuth(); // 보호된 라우트

  return (
    <DashboardClient />
  );
}
