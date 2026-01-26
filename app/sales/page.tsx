import { requireAuth } from "@/lib/auth/require-auth";
import { SalesManagement } from "@/components/features/SalesManagement";

export default async function SalesPage() {
  await requireAuth();

  return (
    <div>
      <SalesManagement />
    </div>
  );
}
