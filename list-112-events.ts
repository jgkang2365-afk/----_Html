import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const KEY_FILE_PATH = path.join(process.cwd(), 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.events.readonly'];

async function listEvents() {
    const credentials = JSON.parse(fs.readFileSync(KEY_FILE_PATH, 'utf-8'));
    const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
    const authClient = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient as any });

    const calendarId = process.env.GOOGLE_CALENDAR_ID;

    console.log("Fetching events around 2026-01-12...");
    const response = await calendar.events.list({
        calendarId,
        timeMin: '2026-01-01T00:00:00Z',
        timeMax: '2026-01-31T23:59:59Z',
        singleEvents: true,
        orderBy: 'startTime'
    });

    const events = response.data.items || [];
    events.forEach(event => {
        if (event.summary?.includes('대성') || event.summary?.includes('우정')) {
            console.log(`- [${event.id}] ${event.summary} (${event.start?.date || event.start?.dateTime}) Color: ${event.colorId}`);
        }
    });
}

listEvents();
