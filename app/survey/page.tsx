"use client";

import { useEffect, useState } from "react";
import { PreliminarySurveyPersonAssignments } from "@/components/features/PreliminarySurveyPersonAssignments";
import { PreliminarySurveyV2Plans } from "@/components/features/PreliminarySurveyV2Plans";
import { UserScheduleBlockManagement } from "@/components/features/UserScheduleBlockManagement";
import {
  SURVEY_TAB_IDS,
  SURVEY_TAB_ORDER_STORAGE_KEY,
  moveSurveyTab,
  restoreSurveyTabOrder,
  type SurveyTabId,
} from "@/lib/preliminary-survey-v2/tab-order";

const TAB_LABELS: Record<SurveyTabId, string> = {
  plans: "예비조사 계획",
  list: "예비조사 목록",
  "person-assignments": "개인별 배정 현황",
  "schedule-blocks": "직원 불가 일정",
};

function isSurveyTabId(value: string | null): value is SurveyTabId {
  return SURVEY_TAB_IDS.includes(value as SurveyTabId);
}

export default function SurveyPage() {
  const [activeTab, setActiveTab] = useState<SurveyTabId>("plans");
  const [tabOrder, setTabOrder] = useState<SurveyTabId[]>([...SURVEY_TAB_IDS]);
  const [draggedTab, setDraggedTab] = useState<SurveyTabId | null>(null);

  useEffect(() => {
    const savedTab = window.localStorage.getItem("surveyActiveTab");
    setActiveTab(isSurveyTabId(savedTab) ? savedTab : "plans");
    setTabOrder(restoreSurveyTabOrder(window.localStorage.getItem(SURVEY_TAB_ORDER_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    window.localStorage.setItem("surveyActiveTab", activeTab);
  }, [activeTab]);

  const saveTabOrder = (next: SurveyTabId[]) => {
    setTabOrder(next);
    window.localStorage.setItem(SURVEY_TAB_ORDER_STORAGE_KEY, JSON.stringify(next));
  };

  return <div className="space-y-6">
    <div className="sticky top-16 z-40 flex h-12 items-center gap-8 border-b border-surface-200 bg-surface-50/95 backdrop-blur lg:top-28">
      <h1 className="shrink-0 text-2xl font-bold text-text-900">예비조사</h1>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {tabOrder.map((tabId) => <button
          key={tabId}
          type="button"
          draggable
          onDragStart={() => setDraggedTab(tabId)}
          onDragEnd={() => setDraggedTab(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (draggedTab) saveTabOrder(moveSurveyTab(tabOrder, draggedTab, tabId));
            setDraggedTab(null);
          }}
          onClick={() => setActiveTab(tabId)}
          aria-current={activeTab === tabId ? "page" : undefined}
          className={`cursor-grab whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors active:cursor-grabbing ${activeTab === tabId ? "border-b-2 border-primary-500 text-primary-500" : "text-text-700 hover:text-text-900"}`}
        >{TAB_LABELS[tabId]}</button>)}
        <button type="button" onClick={() => saveTabOrder([...SURVEY_TAB_IDS])} className="ml-auto whitespace-nowrap px-3 py-2 text-xs text-text-500 hover:text-text-900">기본 순서로 복원</button>
      </div>
    </div>

    {activeTab === "plans" && <PreliminarySurveyV2Plans />}
    {activeTab === "list" && <PreliminarySurveyV2Plans mode="list" />}
    {activeTab === "person-assignments" && <PreliminarySurveyPersonAssignments />}
    {activeTab === "schedule-blocks" && <UserScheduleBlockManagement />}
  </div>;
}
