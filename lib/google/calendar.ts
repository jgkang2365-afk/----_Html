import { google } from 'googleapis';
import path from 'path';

// 환경 변수 및 파일 경로 설정
const KEY_FILE_PATH = path.join(process.cwd(), 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

/**
 * Google 인증 클라이언트 생성
 */
const getAuthClient = async () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: KEY_FILE_PATH,
        scopes: SCOPES,
    });
    return auth.getClient();
};

/**
 * 예비조사 일정 구글 캘린더 등록
 * @param eventData 이벤트 데이터
 */
export async function createSurveyEvent(eventData: {
    summary: string;
    description?: string;
    date: string; // YYYY-MM-DD
    location?: string;
    colorId?: string;
}) {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!calendarId) {
        console.warn('GOOGLE_CALENDAR_ID environment variable is not set. Skipping calendar sync.');
        return null;
    }

    try {
        const authClient = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        const event = {
            summary: eventData.summary,
            description: eventData.description,
            location: eventData.location,
            colorId: eventData.colorId,
            start: {
                date: eventData.date, // "YYYY-MM-DD" format for all-day event
                timeZone: 'Asia/Seoul',
            },
            end: {
                date: eventData.date, // Google Calendar API: end date is exclusive for all-day events, but for simplicity let's see if same date works or if we need +1 day. 
                // Actually for all-day events, end date must be the next day.
                // Let's handle date calculation.
                timeZone: 'Asia/Seoul',
            },
        };

        // Calculate end date (next day) for all-day event
        const startDate = new Date(eventData.date);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 1);

        // Format YYYY-MM-DD
        const nextDay = endDate.toISOString().split('T')[0];
        event.end.date = nextDay;

        const response = await calendar.events.insert({
            calendarId,
            requestBody: event,
        });

        console.log(`Event created: ${response.data.htmlLink}`);
        return response.data;
    } catch (error) {
        console.error('Error creating Google Calendar event:', error);
        // Throw error or return null depending on desired behavior. 
        // Usually helpful to log but not crash the main app flow, but for now we log.
        return null;
    }
}

/**
 * 구글 캘린더 일정 수정 (System-as-Master)
 */
export async function updateSurveyEvent(eventId: string, eventData: {
    summary: string;
    description?: string;
    date: string; // YYYY-MM-DD
    location?: string;
    colorId?: string;
}) {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return null;

    try {
        const authClient = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        const event: any = {
            summary: eventData.summary,
            description: eventData.description,
            location: eventData.location,
            colorId: eventData.colorId,
            start: {
                date: eventData.date,
                timeZone: 'Asia/Seoul',
            },
            end: {
                date: eventData.date,
                timeZone: 'Asia/Seoul',
            },
        };

        // Calculate end date (next day) for all-day event
        const startDate = new Date(eventData.date);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 1);
        const nextDay = endDate.toISOString().split('T')[0];
        event.end.date = nextDay;

        const response = await calendar.events.patch({
            calendarId,
            eventId,
            requestBody: event,
        });

        console.log(`Event updated: ${response.data.htmlLink}`);
        return response.data;
    } catch (error: any) {
        console.error('Error updating Google Calendar event:', error);
        // If event not found (deleted manually), return null so we can try creating it
        if (error.code === 404 || error.code === 410) {
            console.log('Event not found (404/410), assuming deleted.');
            return null;
        }
        return null; // For other errors, we might want to throw or return null
    }
}

/**
 * 구글 캘린더 일정 삭제 (System-as-Master)
 */
export async function deleteSurveyEvent(eventId: string) {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return false;

    try {
        const authClient = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        await calendar.events.delete({
            calendarId,
            eventId,
        });

        console.log(`Event deleted: ${eventId}`);
        return true;
    } catch (error) {
        console.error('Error deleting Google Calendar event:', error);
        return false;
    }
}
