"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useRouter } from "next/navigation";

interface JournalDetailProps {
  journal: any;
}

export const JournalDetail: React.FC<JournalDetailProps> = ({ journal }) => {
  const router = useRouter();

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-900">측정일지 정보</h2>
          <Button variant="secondary" onClick={() => router.back()}>
            목록으로
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium text-text-700">사업장명</label>
            <p className="text-text-900">{journal.business_name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-text-700">측정년도</label>
            <p className="text-text-900">{journal.measurement_year}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-text-700">측정주기</label>
            <p className="text-text-900">{journal.measurement_period}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-text-700">완료여부</label>
            <p className="text-text-900">{journal.completion_status}</p>
          </div>
        </div>
        <div className="mt-4">
          <p className="text-sm text-text-500">
            측정일지 수정 기능은 M3-T3에서 구현 예정입니다.
          </p>
        </div>
      </Card>
    </div>
  );
};

