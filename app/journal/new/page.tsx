import { requireAuth } from "@/lib/auth/require-auth";
import { JournalCreate } from "@/components/features/JournalCreate";

export default async function JournalCreatePage() {
  await requireAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-6">측정일지 등록</h1>
      <JournalCreate />
    </div>
  );
}

