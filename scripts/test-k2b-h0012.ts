import { K2BService } from "../lib/automation/k2b-service";
import * as dotenv from "dotenv";
import * as path from "path";

// .env.local 로드
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function testH0012() {
    console.log("=== H0012 K2B 업로드 테스트 시작 ===");
    const k2b = new K2BService();

    try {
        await k2b.init();

        // 개별 계정 정보가 있다면 주입, 없으면 환경 변수 사용
        const testId = process.env.K2B_ID;
        const testPw = process.env.K2B_PW;

        console.log(`[Test] 로그인 시도 (ID: ${testId})`);
        await k2b.login(testId, testPw);
        console.log("[Test] 로그인 성공");

        // H0012의 가상 파일 경로 (실제 파일이 있으면 더 좋음)
        const mockFilePath = "C:\\Users\\USER\\Desktop\\H0012_보고서_테스트.pdf";

        // 테스트용 빈 파일 생성 (파일이 없을 경우 대비)
        const fs = require('fs');
        if (!fs.existsSync(mockFilePath)) {
            fs.writeFileSync(mockFilePath, "테스트 파일 내용");
        }

        console.log("[Test] H0012 업로드 프로세스 시작");
        const result = await k2b.uploadReport("안전자동차정비공업사", mockFilePath);

        console.log("[Test] 결과:", result);

        // 육안 확인을 위한 대기
        console.log("[Test] 5초 후 브라우저를 닫습니다...");
        await new Promise(resolve => setTimeout(resolve, 5000));

    } catch (error) {
        console.error("[Test Error]:", error);
    } finally {
        await k2b.quit();
        console.log("=== 테스트 완료 ===");
    }
}

testH0012();
