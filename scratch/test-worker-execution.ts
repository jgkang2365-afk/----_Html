import { createClient } from "../lib/supabase/server";
import { BackgroundTasks } from "../lib/scheduler/background-tasks";
import * as dotenv from "dotenv";
import * as path from "path";

// .env.local 강제 주입
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function runExecutionTest() {
    console.log("=== 백그라운드 워커 통합 실행 테스트 시작 ===");
    const supabase = await createClient();

    // 1. 테스트용 임시 사용자 ID 확인 (가짜 알림 대상용)
    const { data: user } = await supabase.from('users').select('id, name').limit(1).single();
    if (!user) {
        console.error("테스트 오류: 데이터베이스에 사용자가 존재하지 않습니다.");
        process.exit(1);
    }
    console.log(`임시 요청자 설정: ID = ${user.id}, 이름 = ${user.name}`);

    // 2. 가짜 이메일 전송 작업 큐에 인서트
    const testCompanyName = "가짜테스트업체_Antigravity";
    const { data: job, error: insertError } = await supabase
        .from('background_jobs')
        .insert({
            job_type: 'email',
            status: 'pending',
            payload: {
                targets: [
                    {
                        business_name: testCompanyName,
                        manager_email: "antigravity_test@example.com",
                        reports: [
                            { year: 2026, period: "상반기", code: "H9999", classification: "정규" }
                        ]
                    }
                ],
                requestUser: {
                    id: user.id,
                    name: user.name
                }
            }
        })
        .select('id')
        .single();

    if (insertError || !job) {
        console.error("❌ 작업 등록 실패:", insertError?.message);
        process.exit(1);
    }
    console.log(`✅ 가짜 작업 큐 등록 완료: ID = ${job.id}`);

    // 3. 백그라운드 워커 기동
    console.log("로컬 백그라운드 워커(BackgroundTasks)를 시작합니다...");
    BackgroundTasks.getInstance().init();

    // 4. 워커가 폴링하여 가져가고 처리(실패)할 때까지 10초간 대기
    console.log("워커가 작업을 가로채 처리할 때까지 10초간 대기합니다...");
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 5. 결과 검증
    console.log("\n=== 데이터베이스 결과 검증 ===");
    
    // (1) 작업 상태 확인 (파일이 없어 failed이어야 함)
    const { data: finalJob } = await supabase
        .from('background_jobs')
        .select('*')
        .eq('id', job.id)
        .single();

    console.log(`- 최종 작업 상태: ${finalJob?.status}`);
    console.log(`- 에러 메시지: ${finalJob?.error_message}`);

    const isJobFailedOk = finalJob?.status === 'failed' && finalJob?.error_message?.includes("로컬 보고서 파일");
    if (isJobFailedOk) {
        console.log("➡️ [합격] 작업이 파일 없음 예외를 포착하여 failed 상태 및 적합한 에러 로그를 남겼습니다.");
    } else {
        console.error("➡️ [불합격] 작업이 원하는 상태(failed) 및 원인(파일 없음)으로 종료되지 않았습니다.");
    }

    // (2) 알림 테이블 확인 (notifications)
    const { data: notifications } = await supabase
        .from('notifications')
        .select('*')
        .like('message', `%${testCompanyName}%`)
        .order('created_at', { ascending: false });

    console.log(`- 생성된 알림 개수: ${notifications?.length || 0}건`);
    if (notifications && notifications.length > 0) {
        console.log(`- 알림 메시지 내용: ${notifications[0].message}`);
        console.log("➡️ [합격] notifications 테이블에 실패 알림이 올바르게 삽입되었습니다.");
    } else {
        console.error("➡️ [불합격] 알림 테이블에 에러 알림이 유실되었습니다.");
    }

    // 6. 클린업 (가짜 데이터 원상복구)
    console.log("\n=== 테스트 데이터 클린업 ===");
    await supabase.from('background_jobs').delete().eq('id', job.id);
    if (notifications && notifications.length > 0) {
        await supabase.from('notifications').delete().like('message', `%${testCompanyName}%`);
    }
    console.log("클린업 완료.");

    if (isJobFailedOk && notifications && notifications.length > 0) {
        console.log("\n🎉 최종 검증 결과: 통합 테스트 [성공] 🎉");
        process.exit(0);
    } else {
        console.error("\n❌ 최종 검증 결과: 통합 테스트 [실패] ❌");
        process.exit(1);
    }
}

runExecutionTest();
