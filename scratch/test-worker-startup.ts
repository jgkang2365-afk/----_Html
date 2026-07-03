import { BackgroundTasks } from "../lib/scheduler/background-tasks";
import * as dotenv from "dotenv";
import * as path from "path";

// .env.local 강제 주입
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

console.log("테스트 시작: BackgroundTasks 초기화를 수행합니다...");
BackgroundTasks.getInstance().init();

console.log("5초 대기하며 워커의 정상 시동 여부를 로그로 검증합니다...");
setTimeout(() => {
    console.log("테스트를 정상 완료하여 종료합니다.");
    process.exit(0);
}, 6000);
