import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

const normalizeTemplate = (template: any, ownerNames: Map<number, string>, currentUserId: number) => ({
  id: String(template.id),
  name: template.name,
  filters: Array.isArray(template.filters) ? template.filters : [],
  columns: Array.isArray(template.columns) ? template.columns : [],
  isPublic: !!template.is_public,
  isOwner: Number(template.owner_id) === currentUserId,
  ownerName: ownerNames.get(Number(template.owner_id)) || "알 수 없음",
  updatedAt: template.updated_at,
});

async function requireUser() {
  const user = await getUser();
  if (!user) throw new Error("Unauthorized");
  return { ...user, numericId: Number(user.id) };
}

export async function GET() {
  try {
    await checkPermission("journal:read");
    const user = await requireUser();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("custom_report_templates")
      .select("id, owner_id, name, is_public, filters, columns, updated_at")
      .or(`owner_id.eq.${user.numericId},is_public.eq.true`)
      .order("is_public", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const ownerIds = Array.from(new Set((data || []).map((template: any) => Number(template.owner_id))));
    const ownerNames = new Map<number, string>();
    if (ownerIds.length > 0) {
      const { data: owners, error: ownerError } = await supabase
        .from("users")
        .select("id, name")
        .in("id", ownerIds);
      if (ownerError) throw ownerError;
      (owners || []).forEach((owner: any) => ownerNames.set(Number(owner.id), owner.name));
    }

    return NextResponse.json({
      success: true,
      templates: (data || []).map((template: any) => normalizeTemplate(template, ownerNames, user.numericId)),
    });
  } catch (error: any) {
    const message = error?.message || "템플릿을 불러오지 못했습니다.";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const user = await requireUser();
    const body = await request.json();
    const id = body.id ? Number(body.id) : null;
    const name = String(body.name || "").trim();
    const filters = Array.isArray(body.filters) ? body.filters : [];
    const columns = Array.isArray(body.columns) ? body.columns : [];
    const isPublic = body.isPublic === true;

    if (!name) {
      return NextResponse.json({ error: "템플릿 이름을 입력해 주세요." }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: "템플릿 이름은 100자 이하로 입력해 주세요." }, { status: 400 });
    }

    const supabase = await createClient();
    const values = { name, filters, columns, is_public: isPublic };
    let result;

    if (id) {
      const { data: existing, error: existingError } = await supabase
        .from("custom_report_templates")
        .select("id, owner_id")
        .eq("id", id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) {
        return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
      }
      if (Number(existing.owner_id) !== user.numericId) {
        return NextResponse.json({ error: "다른 사용자의 템플릿은 수정할 수 없습니다." }, { status: 403 });
      }

      result = await supabase
        .from("custom_report_templates")
        .update(values)
        .eq("id", id)
        .select("id, owner_id, name, is_public, filters, columns, updated_at")
        .single();
    } else {
      result = await supabase
        .from("custom_report_templates")
        .insert({ ...values, owner_id: user.numericId })
        .select("id, owner_id, name, is_public, filters, columns, updated_at")
        .single();
    }

    if (result.error) {
      if (result.error.code === "23505") {
        return NextResponse.json({ error: "같은 이름의 개인 템플릿이 이미 있습니다." }, { status: 409 });
      }
      throw result.error;
    }

    const ownerNames = new Map<number, string>([[user.numericId, user.name]]);
    return NextResponse.json({
      success: true,
      template: normalizeTemplate(result.data, ownerNames, user.numericId),
    });
  } catch (error: any) {
    const message = error?.message || "템플릿 저장 중 오류가 발생했습니다.";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await checkPermission("journal:write");
    const user = await requireUser();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!id) {
      return NextResponse.json({ error: "삭제할 템플릿이 지정되지 않았습니다." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: existing, error: existingError } = await supabase
      .from("custom_report_templates")
      .select("id, owner_id")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) {
      return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
    }
    if (Number(existing.owner_id) !== user.numericId) {
      return NextResponse.json({ error: "다른 사용자의 템플릿은 삭제할 수 없습니다." }, { status: 403 });
    }

    const { error } = await supabase.from("custom_report_templates").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    const message = error?.message || "템플릿 삭제 중 오류가 발생했습니다.";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}