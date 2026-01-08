import { createServerClient } from "./supabase";

/**
 * 데이터베이스 연결 테스트 함수
 * 서버 사이드에서만 실행 가능
 */
export async function testDatabaseConnection(): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    // 환경 변수 확인
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return {
        success: false,
        message: "환경 변수가 설정되지 않았습니다. .env.local 파일을 확인하세요.",
      };
    }

    const supabase = createServerClient();
    
    // Supabase의 기본 정보를 조회하여 연결 테스트
    // 이 방법은 테이블이 없어도 작동합니다
    const { data, error } = await supabase.rpc('version');
    
    // RPC가 없어도 연결은 성공한 것으로 간주
    // 실제로는 Supabase에 연결되었지만 함수가 없을 수 있음
    if (error) {
      // 특정 에러 코드는 연결 성공으로 간주
      // PGRST301: 함수가 없음 (연결은 성공)
      // PGRST116: 테이블이 없음 (연결은 성공)
      if (error.code === "PGRST301" || error.code === "PGRST116" || error.message.includes("schema cache")) {
        return {
          success: true,
          message: "데이터베이스 연결 성공 (테이블/함수는 아직 생성되지 않았습니다)",
        };
      }
      
      // 다른 에러는 실제 연결 문제일 수 있음
      return {
        success: false,
        message: `데이터베이스 연결 실패: ${error.message} (코드: ${error.code})`,
      };
    }

    return {
      success: true,
      message: "데이터베이스 연결 성공",
    };
  } catch (error) {
    return {
      success: false,
      message: `연결 테스트 중 오류 발생: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    };
  }
}

