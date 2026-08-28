export function EnvironmentBadge() {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "staging") return null;

  return (
    <div
      role="status"
      className="fixed bottom-3 right-3 z-[100] rounded-md border border-amber-300 bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 shadow-sm"
      title="Cloud Staging Supabase에 연결된 테스트 환경입니다."
    >
      테스트 환경 · 운영 데이터 아님
    </div>
  );
}
