"use client";

import { createClient } from "@/lib/supabase/client";
import type { AutomationJob } from "./jobs";

/**
 * The signal table carries no request/result payload. UI code should fetch its
 * authorised job detail through an API when it needs more than this safe view.
 */
export function subscribeAutomationJob(
  jobId: string,
  onChange: () => void,
) {
  const supabase = createClient();
  const channel = supabase
    .channel(`automation-job:${jobId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "automation_job_signals", filter: `job_id=eq.${jobId}` },
      onChange,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onChange();
    });
  return () => void supabase.removeChannel(channel);
}

export async function fetchAutomationJob(jobId: string): Promise<AutomationJob> {
  const response = await fetch(`/api/automation-jobs/${jobId}`, { cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "작업 상태를 가져오지 못했습니다.");
  return body.job;
}
