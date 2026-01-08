"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface TabProps {
  items: TabItem[];
  defaultTab?: string;
  className?: string;
}

export const Tab: React.FC<TabProps> = ({ items, defaultTab, className }) => {
  const [activeTab, setActiveTab] = useState(defaultTab || items[0]?.id);

  const activeContent = items.find((item) => item.id === activeTab)?.content;

  return (
    <div className={cn("w-full", className)}>
      {/* 탭 헤더 */}
      <div className="flex border-b border-surface-100" role="tablist">
        {items.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`tabpanel-${item.id}`}
              id={`tab-${item.id}`}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "px-4 py-3 text-sm font-medium transition-colors",
                "focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2",
                isActive
                  ? "text-primary-500 border-b-2 border-primary-500 font-semibold"
                  : "text-text-700 border-b-2 border-transparent hover:bg-surface-50"
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* 탭 내용 */}
      <div
        id={`tabpanel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className="mt-4"
      >
        {activeContent}
      </div>
    </div>
  );
};

