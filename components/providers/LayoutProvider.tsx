"use client";

import { MainLayout } from "@/components/layout/MainLayout";

export function LayoutProvider({ children }: { children: React.ReactNode }) {
  return <MainLayout>{children}</MainLayout>;
}

