import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-permission";

/**
 * 사용자 관리 페이지는 관리자만 접근 가능
 */
export default async function UsersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return <>{children}</>;
}
