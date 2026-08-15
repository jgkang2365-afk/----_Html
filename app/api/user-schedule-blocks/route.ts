import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseDateOnly } from "@/lib/preliminary-survey-v2/calendar";

const BLOCK_TYPES = new Set([
  "education",
  "leave",
  "business_trip",
  "meeting",
  "medical_checkup",
  "personal",
  "other",
]);

type Client = Awaited<ReturnType<typeof createClient>>;
type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

function errorStatus(message: string) {
  return message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
}

async function canManageUser(supabase: Client, session: Session, userId: number) {
  if (session.role === "관리자") return true;
  if (session.userId !== userId) return false;
  const { data } = await supabase
    .from("users")
    .select("job, is_active")
    .eq("id", session.userId)
    .maybeSingle();
  return data?.job === "측정" && data?.is_active !== false;
}

async function areEligibleMeasurementUsers(supabase: Client, userIds: number[]) {
  const { data, error } = await supabase
    .from("users")
    .select("id, job, is_active")
    .in("id", userIds);
  if (error) throw error;
  const eligible = new Set(
    (data ?? [])
      .filter((user) => user.job === "측정" && user.is_active !== false)
      .map((user) => Number(user.id)),
  );
  return userIds.every((userId) => eligible.has(userId));
}

function validatePayload(body: any) {
  const userId = Number(body.userId);
  const startDate = String(body.startDate || "");
  const endDate = String(body.endDate || "");
  const blockType = String(body.blockType || "");
  if (!Number.isInteger(userId) || userId <= 0) return "INVALID_USER_ID";
  if (!parseDateOnly(startDate) || !parseDateOnly(endDate) || endDate < startDate) {
    return "INVALID_DATE_RANGE";
  }
  if (!BLOCK_TYPES.has(blockType)) return "INVALID_BLOCK_TYPE";
  return null;
}

export async function GET(request: NextRequest) {
  try {
    await checkPermission("survey:read");
    const supabase = await createClient();
    const params = new URL(request.url).searchParams;
    let query = supabase
      .from("user_schedule_blocks")
      .select("*, users!user_schedule_blocks_user_id_fkey(name)")
      .order("start_date", { ascending: false });
    const userId = Number(params.get("userId"));
    if (Number.isInteger(userId) && userId > 0) query = query.eq("user_id", userId);
    if (params.get("startDate")) query = query.gte("end_date", params.get("startDate")!);
    if (params.get("endDate")) query = query.lte("start_date", params.get("endDate")!);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ blocks: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCHEDULE_BLOCK_QUERY_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function POST(request: NextRequest) {
  try {
    await checkPermission("survey:write");
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const userIds = [...new Set<number>(
      (Array.isArray(body.userIds) ? body.userIds : [body.userId])
        .map(Number)
        .filter((id: number) => Number.isInteger(id) && id > 0),
    )];
    if (userIds.length === 0 || userIds.length > 100) {
      return NextResponse.json({ error: "INVALID_USER_IDS" }, { status: 400 });
    }
    const validationError = validatePayload({ ...body, userId: userIds[0] });
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
    const supabase = await createClient();
    if (!(await areEligibleMeasurementUsers(supabase, userIds))) {
      return NextResponse.json({ error: "INELIGIBLE_USER" }, { status: 400 });
    }
    const manageable = await Promise.all(userIds.map((userId) => canManageUser(supabase, session, userId)));
    if (manageable.some((allowed) => !allowed)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data, error } = await supabase
      .from("user_schedule_blocks")
      .insert(userIds.map((userId) => ({
        user_id: userId,
        start_date: body.startDate,
        end_date: body.endDate,
        block_type: body.blockType,
        note: String(body.note || "").trim() || null,
        created_by: session.userId,
      })))
      .select();
    if (error) throw error;
    return NextResponse.json({ success: true, blocks: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCHEDULE_BLOCK_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await checkPermission("survey:write");
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const id = Number(body.id);
    const validationError = validatePayload(body);
    if (!Number.isInteger(id) || validationError) {
      return NextResponse.json({ error: validationError || "INVALID_BLOCK_ID" }, { status: 400 });
    }
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("user_schedule_blocks")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "BLOCK_NOT_FOUND" }, { status: 404 });
    if (!(await areEligibleMeasurementUsers(supabase, [Number(body.userId)]))) {
      return NextResponse.json({ error: "INELIGIBLE_USER" }, { status: 400 });
    }
    if (
      !(await canManageUser(supabase, session, Number(existing.user_id))) ||
      !(await canManageUser(supabase, session, Number(body.userId)))
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { data, error } = await supabase
      .from("user_schedule_blocks")
      .update({
        user_id: Number(body.userId),
        start_date: body.startDate,
        end_date: body.endDate,
        block_type: body.blockType,
        note: String(body.note || "").trim() || null,
      })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, block: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCHEDULE_BLOCK_UPDATE_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await checkPermission("survey:write");
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "INVALID_BLOCK_ID" }, { status: 400 });
    }
    const supabase = await createClient();
    const { data: existing } = await supabase
      .from("user_schedule_blocks")
      .select("user_id")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "BLOCK_NOT_FOUND" }, { status: 404 });
    if (!(await canManageUser(supabase, session, Number(existing.user_id)))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { error } = await supabase.from("user_schedule_blocks").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SCHEDULE_BLOCK_DELETE_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}
