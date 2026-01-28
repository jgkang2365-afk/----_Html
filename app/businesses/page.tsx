import { requireAuth } from "@/lib/auth/require-auth";
import { BusinessManagement } from "@/components/features/BusinessManagement";

export default async function BusinessesPage() {
  await requireAuth();

  return (
    <BusinessManagement />
  );
}
