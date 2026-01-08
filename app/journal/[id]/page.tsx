import { requireAuth } from "@/lib/auth/require-auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { JournalDetail } from "@/components/features/JournalDetail";

interface JournalDetailPageProps {
  params: { id: string };
}

export default async function JournalDetailPage({ params }: JournalDetailPageProps) {
  await requireAuth();

  const supabase = await createClient();
  const { data: journal, error } = await supabase
    .from("measurement_journal")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !journal) {
    redirect("/journal");
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-6">측정일지 상세</h1>
      <JournalDetail journal={journal} />
    </div>
  );
}

