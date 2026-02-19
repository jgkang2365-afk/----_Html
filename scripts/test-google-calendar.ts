import { createSurveyEvent } from '../lib/google/calendar';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function testCalendarSync() {
    console.log('Testing Google Calendar Sync...');

    const today = new Date().toISOString().split('T')[0];

    const result = await createSurveyEvent({
        summary: '[테스트] 구글 캘린더 연동 테스트',
        description: '이 이벤트는 자동화 스크립트에 의해 생성되었습니다.',
        date: today,
        location: '테스트 장소',
    });

    if (result) {
        console.log('Successfully created test event!');
        console.log('Event Link:', result.htmlLink);
    } else {
        console.error('Failed to create test event.');
    }
}

testCalendarSync().catch(console.error);
