import { requireAuth } from "@/lib/auth/require-auth";
export const dynamic = "force-dynamic";
import { CustomQueryExport } from "@/components/features/CustomQueryExport";

export default async function CustomReportsPage() {
  // 사용자 권한 확인
  await requireAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-text-900 mb-4">사용자 정의 보고서</h1>
      <p className="text-text-700 mb-6">
        원하는 필터 조건을 적용하여 데이터를 조회하고, 출력할 컬럼과 순서를 커스텀 설정하여 맞춤형 엑셀을 다운로드할 수 있습니다.
      </p>
      <CustomQueryExport />
    </div>
  );
}
