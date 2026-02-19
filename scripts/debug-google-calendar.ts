import { google } from 'googleapis';
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const KEY_FILE_PATH = path.join(process.cwd(), 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];
const OUTPUT_FILE = path.join(process.cwd(), 'debug-calendar-output.txt');

function log(message: string) {
    console.log(message);
    try {
        fs.appendFileSync(OUTPUT_FILE, message + '\n');
    } catch (e) {
        console.error('Failed to write to log file:', e);
    }
}

async function listCalendars() {
    // Clear file
    try {
        fs.writeFileSync(OUTPUT_FILE, '');
    } catch (e) {
        console.error('Failed to clear log file:', e);
    }

    log('Checking accessible calendars...');

    try {
        const auth = new google.auth.GoogleAuth({
            keyFile: KEY_FILE_PATH,
            scopes: SCOPES,
        });
        const authClient = await auth.getClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient });

        // Get service account email
        const credentials = JSON.parse(fs.readFileSync(KEY_FILE_PATH, 'utf-8'));
        log(`Service Account Email: ${credentials.client_email}`);

        const response = await calendar.calendarList.list();
        const calendars = response.data.items || [];

        log(`Found ${calendars.length} calendars.`);
        calendars.forEach(cal => {
            log(`- Summary: ${cal.summary}, ID: ${cal.id}, AccessRole: ${cal.accessRole}`);
        });

        const targetId = process.env.GOOGLE_CALENDAR_ID;
        log(`\nTarget Calendar ID: ${targetId}`);

        const target = calendars.find(c => c.id === targetId);
        if (target) {
            log(`SUCCESS: Target calendar found! Access Role: ${target.accessRole}`);
        } else {
            log('FAILURE: Target calendar NOT found in the list. Please check permissions.');
        }

    } catch (error) {
        log(`Error listing calendars: ${error}`);
    }
}

listCalendars().catch(err => log(`Fatal error: ${err}`));
