import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';

// 환경 변수 및 파일 경로 설정
const KEY_FILE_PATH = path.join(process.cwd(), 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

const DEBUG_LOG_PATH = path.join(process.cwd(), 'debug-calendar.log');

function logDebug(message: string, data?: any) {
    const timestamp = new Date().toISOString();
    const logMsg = `[${timestamp}] ${message} ${data ? JSON.stringify(data) : ''}\n`;
    try {
        fs.appendFileSync(DEBUG_LOG_PATH, logMsg);
    } catch (e) {
        console.error("Failed to write to debug log", e);
    }
    console.log(message, data);
}

/**
 * Google 인증 클라이언트 생성
 * - Vercel 배포: GOOGLE_CREDENTIALS_JSON 환경변수 사용
 * - 로컬 개발: google-credentials.json 파일 사용
 */
const getAuthClient = async () => {
    try {
        let credentials: any;

        // 1순위: 환경변수 (Vercel 배포 환경)
        if (process.env.GOOGLE_CREDENTIALS_JSON) {
            credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
            logDebug("Using credentials from GOOGLE_CREDENTIALS_JSON env var");
        }
        // 2순위: 파일 (로컬 개발 환경)
        else if (fs.existsSync(KEY_FILE_PATH)) {
            const keyFileContent = fs.readFileSync(KEY_FILE_PATH, 'utf-8');
            credentials = JSON.parse(keyFileContent);
            logDebug("Using credentials from file: " + KEY_FILE_PATH);
        }
        else {
            throw new Error(`Google credentials not found. Set GOOGLE_CREDENTIALS_JSON env var or place google-credentials.json at: ${KEY_FILE_PATH}`);
        }

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: SCOPES,
        });
        return auth.getClient();
    } catch (error) {
        logDebug("Auth Client Creation Error", error);
        throw error;
    }
};

/**
 * 예비조사 일정 구글 캘린더 등록
 * @param eventData 이벤트 데이터
 */
export async function createSurveyEvent(eventData: {
    summary: string;
    description?: string;
    date: string; // YYYY-MM-DD (시작일)
    endDate?: string; // YYYY-MM-DD (종료일, 없으면 시작일과 동일)
    location?: string;
    colorId?: string;
}) {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    if (!calendarId) {
        logDebug('GOOGLE_CALENDAR_ID environment variable is not set. Skipping calendar sync.');
        return null;
    }

    try {
        logDebug("Creating Calendar Event", eventData);
        const authClient = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        // Normalize date to YYYY-MM-DD to avoid API errors
        const normalizeDate = (d: string) => {
            const dateObj = new Date(d);
            if (isNaN(dateObj.getTime())) return d;
            return dateObj.toISOString().split('T')[0];
        };
        const startDateNormalized = normalizeDate(eventData.date);

        // Calculate end date: endDate+1 (Google Calendar의 종일 이벤트는 end를 exclusive로 처리)
        let lastDay = eventData.endDate ? normalizeDate(eventData.endDate) : startDateNormalized;
        
        // 방어코드: endDate가 startDate보다 이전인 경우 startDate로 덮어쓰기
        if (eventData.endDate && new Date(lastDay) < new Date(startDateNormalized)) {
            lastDay = startDateNormalized;
        }

        const endCalc = new Date(lastDay);
        endCalc.setDate(endCalc.getDate() + 1);
        const endDateStr = endCalc.toISOString().split('T')[0];

        const event: any = {
            summary: eventData.summary,
            description: eventData.description,
            location: eventData.location,
            colorId: eventData.colorId,
            status: 'confirmed',
            start: {
                date: startDateNormalized,
                timeZone: 'Asia/Seoul',
            },
            end: {
                date: endDateStr,
                timeZone: 'Asia/Seoul',
            },
        };

        const response = await calendar.events.insert({
            calendarId,
            requestBody: event,
        });

        logDebug(`Event created successfully: ${response.data.id}`);
        return response.data;
    } catch (error) {
        logDebug('Error creating Google Calendar event:', error);
        return null;
    }
}

/**
 * 구글 캘린더 일정 수정 (System-as-Master)
 */
export async function updateSurveyEvent(eventId: string, eventData: {
    summary: string;
    description?: string;
    date: string; // YYYY-MM-DD (시작일)
    endDate?: string; // YYYY-MM-DD (종료일, 없으면 시작일과 동일)
    location?: string;
    colorId?: string;
}) {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return null;

    try {
        logDebug(`Updating Calendar Event: ${eventId}`, eventData);
        const authClient = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        // Normalize date to YYYY-MM-DD to avoid API errors
        const normalizeDate = (d: string) => {
            const dateObj = new Date(d);
            if (isNaN(dateObj.getTime())) return d;
            return dateObj.toISOString().split('T')[0];
        };
        const startDateNormalized = normalizeDate(eventData.date);

        // Calculate end date: endDate+1
        let lastDay = eventData.endDate ? normalizeDate(eventData.endDate) : startDateNormalized;
        
        // 방어코드: endDate가 startDate보다 이전인 경우 startDate로 덮어쓰기
        if (eventData.endDate && new Date(lastDay) < new Date(startDateNormalized)) {
            lastDay = startDateNormalized;
        }

        const endCalc = new Date(lastDay);
        endCalc.setDate(endCalc.getDate() + 1);
        const endDateStr = endCalc.toISOString().split('T')[0];

        const event: any = {
            summary: eventData.summary,
            description: eventData.description,
            location: eventData.location,
            colorId: eventData.colorId,
            status: 'confirmed',
            start: {
                date: startDateNormalized,
                timeZone: 'Asia/Seoul',
            },
            end: {
                date: endDateStr,
                timeZone: 'Asia/Seoul',
            },
        };

        const response = await calendar.events.patch({
            calendarId,
            eventId,
            requestBody: event,
        });

        logDebug(`Event updated successfully: ${response.data.id}`);
        return response.data;
    } catch (error: any) {
        logDebug('Error updating Google Calendar event:', error);
        if (error.code === 404 || error.code === 410) {
            logDebug('Event not found (404/410), assuming deleted.');
            return null;
        }
        return null;
    }
}

/**
 * 구글 캘린더 일정 조회 (사용자 수동 변경 내역 보존용)
 * @param eventId 이벤트 ID
 * @returns 이벤트 데이터
 */
export async function getSurveyEvent(eventId: string) {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return null;

    try {
        const authClient = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        const response = await calendar.events.get({
            calendarId,
            eventId,
        });

        return response.data;
    } catch (error: any) {
        logDebug('Error getting Google Calendar event:', error);
        return null;
    }
}

/**
 * 구글 캘린더 일정 삭제 (System-as-Master)
 */
export async function deleteSurveyEvent(eventId: string) {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (!calendarId) return false;

    try {
        logDebug(`Deleting Calendar Event: ${eventId}`);
        const authClient = await getAuthClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        await calendar.events.delete({
            calendarId,
            eventId,
        });

        logDebug(`Event deleted: ${eventId}`);
        return true;
    } catch (error) {
        logDebug('Error deleting Google Calendar event:', error);
        return false;
    }
}
