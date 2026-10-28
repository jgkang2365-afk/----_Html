import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";
import { handleManualNationalSupportStatus } from "@/lib/national-support/manual-status-handler";

export async function PATCH(request: NextRequest) {
  return handleManualNationalSupportStatus(request, { getUser, createAdminClient });
}
