import { NextResponse } from "next/server";
import { google } from "googleapis";

export async function GET() {
    const diagnostics: any = {
        timestamp: new Date().toISOString(),
        checks: {},
    };

    // 1. 환경변수 확인
    diagnostics.checks.GOOGLE_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID
        ? `설정됨 (${process.env.GOOGLE_CALENDAR_ID.substring(0, 10)}...)`
        : "❌ 미설정";

    diagnostics.checks.GOOGLE_CREDENTIALS_JSON = process.env.GOOGLE_CREDENTIALS_JSON
        ? `설정됨 (${process.env.GOOGLE_CREDENTIALS_JSON.substring(0, 30)}...)`
        : "❌ 미설정";

    // 2. 인증 테스트
    try {
        if (!process.env.GOOGLE_CREDENTIALS_JSON) {
            diagnostics.checks.auth = "❌ GOOGLE_CREDENTIALS_JSON 없음";
        } else {
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
            diagnostics.checks.credentials_parse = "✅ JSON 파싱 성공";
            diagnostics.checks.credentials_type = credentials.type;
            diagnostics.checks.credentials_email = credentials.client_email;

            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/calendar.events"],
            });
            const authClient = await auth.getClient();
            diagnostics.checks.auth = "✅ Google Auth 성공";

            // 3. 캘린더 API 테스트
            const calendar = google.calendar({ version: "v3", auth: authClient });
            const calendarId = process.env.GOOGLE_CALENDAR_ID;

            if (calendarId) {
                const events = await calendar.events.list({
                    calendarId,
                    maxResults: 1,
                    timeMin: new Date().toISOString(),
                });
                diagnostics.checks.calendar_api = `✅ 캘린더 접근 성공 (${events.data.items?.length || 0}개 이벤트)`;

                // 4. 테스트 이벤트 생성/삭제
                const testEvent = await calendar.events.insert({
                    calendarId,
                    requestBody: {
                        summary: "[테스트] 진단 - 자동 삭제됨",
                        start: { date: "2026-02-28" },
                        end: { date: "2026-03-01" },
                    },
                });
                if (testEvent.data.id) {
                    diagnostics.checks.create_event = `✅ 이벤트 생성 성공 (${testEvent.data.id})`;
                    // 즉시 삭제
                    await calendar.events.delete({ calendarId, eventId: testEvent.data.id });
                    diagnostics.checks.delete_event = "✅ 테스트 이벤트 삭제 완료";
                }
            }
        }
    } catch (error: any) {
        diagnostics.checks.error = {
            message: error.message,
            code: error.code,
            stack: error.stack?.split("\n").slice(0, 3),
        };
    }

    return NextResponse.json(diagnostics, { status: 200 });
}
