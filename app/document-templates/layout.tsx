import { requireAdmin } from "@/lib/auth/require-permission";

export default async function DocumentTemplatesLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
