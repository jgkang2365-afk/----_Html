"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

const BLOCK_OPTIONS = [
  { value: "education", label: "교육" },
  { value: "leave", label: "휴가" },
  { value: "business_trip", label: "출장" },
  { value: "meeting", label: "회의" },
  { value: "medical_checkup", label: "건강검진" },
  { value: "personal", label: "개인 일정" },
  { value: "other", label: "기타" },
];
const BLOCK_LABELS = Object.fromEntries(BLOCK_OPTIONS.map((item) => [item.value, item.label]));

interface UserOption { id: number; name: string; job?: string; is_active: boolean }
interface Block {
  id: number;
  user_id: number;
  start_date: string;
  end_date: string;
  block_type: string;
  note: string | null;
  users?: { name?: string };
}

const emptyForm = {
  id: 0,
  userIds: [] as string[],
  startDate: "",
  endDate: "",
  blockType: "education",
  note: "",
};

export function UserScheduleBlockManagement() {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterUserId) params.set("userId", filterUserId);
    if (filterStartDate) params.set("startDate", filterStartDate);
    if (filterEndDate) params.set("endDate", filterEndDate);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    const [usersResponse, blocksResponse] = await Promise.all([
      fetch("/api/users", { cache: "no-store" }),
      fetch(`/api/user-schedule-blocks${query}`, { cache: "no-store" }),
    ]);
    const [usersResult, blocksResult] = await Promise.all([
      usersResponse.json(),
      blocksResponse.json(),
    ]);
    if (!usersResponse.ok) throw new Error(usersResult.error || "사용자 조회 실패");
    if (!blocksResponse.ok) throw new Error(blocksResult.error || "제외 일정 조회 실패");
    setUsers((usersResult.users || []).filter((user: UserOption) => user.job === "측정" && user.is_active));
    setBlocks(blocksResult.blocks || []);
  }, [filterEndDate, filterStartDate, filterUserId]);

  useEffect(() => {
    void load().catch((caught) =>
      setError(caught instanceof Error ? caught.message : "조회 실패"),
    );
  }, [load]);

  const save = async () => {
    setError(null);
    if (form.userIds.length === 0 || !form.startDate || !form.endDate) {
      setError("사용자를 한 명 이상 선택하고 시작일·종료일을 입력해주세요.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/user-schedule-blocks", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          userId: form.id ? Number(form.userIds[0]) : undefined,
          userIds: form.id ? undefined : form.userIds.map(Number),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error || "저장 실패");
        return;
      }
      setForm(emptyForm);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const allUserIds = users.map((user) => String(user.id));
  const allUsersSelected = users.length > 0 && form.userIds.length === users.length;
  const toggleUser = (userId: string, checked: boolean) => {
    if (form.id > 0) return;
    setForm((previous) => ({
      ...previous,
      userIds: checked
        ? [...new Set([...previous.userIds, userId])]
        : previous.userIds.filter((id) => id !== userId),
    }));
  };

  const remove = async (block: Block) => {
    if (!window.confirm("이 제외 일정을 삭제하시겠습니까?")) return;
    const response = await fetch(`/api/user-schedule-blocks?id=${block.id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error || "삭제 실패");
      return;
    }
    await load();
  };

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}
      <Card className="p-5">
        <h3 className="mb-4 text-lg font-bold">직원 예비조사 제외 일정</h3>
        <div className="grid gap-3 xl:grid-cols-[minmax(620px,2.8fr)_minmax(135px,0.8fr)_minmax(135px,0.8fr)_minmax(130px,0.7fr)_minmax(180px,1fr)_auto] xl:items-end">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-slate-700">사용자</label>
              <span className="text-xs text-slate-500">{form.userIds.length}명 선택</span>
            </div>
            <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 xl:flex-nowrap">
              <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">
                <input
                  type="checkbox"
                  checked={allUsersSelected}
                  disabled={form.id > 0 || users.length === 0}
                  onChange={(event) => setForm((previous) => ({
                    ...previous,
                    userIds: event.target.checked ? allUserIds : [],
                  }))}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                />
                전체
              </label>
              {users.map((user) => (
                <label key={user.id} className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded px-2 py-1 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={form.userIds.includes(String(user.id))}
                    disabled={form.id > 0}
                    onChange={(event) => toggleUser(String(user.id), event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  {user.name}
                </label>
              ))}
            </div>
            {form.id > 0 && <p className="mt-1 text-xs text-slate-500">수정 중에는 기존 직원 선택이 고정됩니다.</p>}
          </div>
          <Input label="시작일" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} />
          <Input label="종료일" type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} />
          <Select label="유형" value={form.blockType} onChange={(event) => setForm({ ...form, blockType: event.target.value })} options={BLOCK_OPTIONS} />
          <Input label="비고" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
          <div className="flex items-end gap-2">
            <Button disabled={saving} onClick={() => void save()}>{saving ? "저장 중..." : form.id ? "수정 저장" : `${form.userIds.length || ""}명 등록`}</Button>
            {form.id > 0 && <Button variant="secondary" onClick={() => setForm(emptyForm)}>취소</Button>}
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-bold">등록 일정 ({blocks.length}건)</h3>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              label="사용자 필터"
              value={filterUserId}
              onChange={(event) => setFilterUserId(event.target.value)}
              options={[
                { value: "", label: "전체 사용자" },
                ...users.map((user) => ({ value: String(user.id), label: user.name })),
              ]}
            />
            <Input
              label="조회 시작일"
              type="date"
              value={filterStartDate}
              onChange={(event) => setFilterStartDate(event.target.value)}
            />
            <Input
              label="조회 종료일"
              type="date"
              value={filterEndDate}
              onChange={(event) => setFilterEndDate(event.target.value)}
            />
          </div>
        </div>
        <div className="divide-y rounded border">
          {blocks.map((block) => (
            <div key={block.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div>
                <span className="font-bold">{block.users?.name || users.find((user) => user.id === block.user_id)?.name}</span>
                <span className="ml-3">{block.start_date} ~ {block.end_date}</span>
                <span className="ml-3 rounded bg-slate-100 px-2 py-0.5">{BLOCK_LABELS[block.block_type]}</span>
                {block.note && <span className="ml-3 text-slate-500">{block.note}</span>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setForm({
                  id: block.id,
                  userIds: [String(block.user_id)],
                  startDate: block.start_date,
                  endDate: block.end_date,
                  blockType: block.block_type,
                  note: block.note || "",
                })}>수정</Button>
                <Button size="sm" variant="danger" onClick={() => void remove(block)}>삭제</Button>
              </div>
            </div>
          ))}
          {blocks.length === 0 && <div className="p-8 text-center text-slate-500">등록된 제외 일정이 없습니다.</div>}
        </div>
      </Card>
    </div>
  );
}
