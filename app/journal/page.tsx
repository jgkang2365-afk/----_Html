import { requireAuth } from "@/lib/auth/require-auth";
export const dynamic = 'force-dynamic';
import { JournalSearch } from "@/components/features/JournalSearch";

export default async function JournalPage() {
  await requireAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-6">측정일지</h1>
      <JournalSearch />
    </div>
  );
}
