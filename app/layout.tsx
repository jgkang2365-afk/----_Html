import type { Metadata } from "next";
import "./globals.css";
import { MainLayout } from "@/components/layout/MainLayout";

export const metadata: Metadata = {
  title: "측정일지 관리 시스템",
  description: "측정사업장 정보를 자동으로 동기화하고 측정일지를 생성·관리하는 웹 플랫폼",
  icons: {
    icon: "data:;base64,iVBORw0KGgo=",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>
        <MainLayout>{children}</MainLayout>
      </body>
    </html>
  );
}
