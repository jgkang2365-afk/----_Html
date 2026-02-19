
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load env
dotenv.config({ path: '.env.local' });

async function main() {
    try {
        console.log("Starting Google Calendar Test...");

        const calendarId = process.env.GOOGLE_CALENDAR_ID;
        console.log("Calendar ID:", calendarId);

        if (!calendarId) {
            throw new Error("GOOGLE_CALENDAR_ID not found in env");
        }

        const keyFilePath = path.join(process.cwd(), 'google-credentials.json');
        console.log("Key File Path:", keyFilePath);

        if (!fs.existsSync(keyFilePath)) {
            throw new Error(`Key file not found at ${keyFilePath}`);
        }

        const keyFileContent = fs.readFileSync(keyFilePath, 'utf-8');
        const credentials = JSON.parse(keyFileContent);
        console.log("Credentials loaded successfully.");

        const auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
        });

        const authClient = await auth.getClient();
        console.log("Auth Client created.");

        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        console.log("Listing events...");
        const res = await calendar.events.list({
            calendarId,
            timeMin: new Date().toISOString(),
            maxResults: 1,
            singleEvents: true,
            orderBy: 'startTime',
        });

        console.log("Events found:", res.data.items?.length);
        console.log("Test Successful!");

    } catch (error: any) {
        console.error("Test Failed:", error);
        if (error.response) {
            console.error("Response data:", error.response.data);
        }
    }
}

main();
