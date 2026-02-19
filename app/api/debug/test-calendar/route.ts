
import { NextResponse } from "next/server";
import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const calendarId = process.env.GOOGLE_CALENDAR_ID;
        if (!calendarId) {
            return NextResponse.json({ success: false, error: "GOOGLE_CALENDAR_ID not found in env" });
        }

        // Attempt to read credentials file directly
        let credentials;
        const keyFilePath = path.join(process.cwd(), 'google-credentials.json');

        try {
            const keyFileContent = fs.readFileSync(keyFilePath, 'utf-8');
            credentials = JSON.parse(keyFileContent);
        } catch (readError: any) {
            return NextResponse.json({
                success: false,
                error: "Failed to read google-credentials.json",
                path: keyFilePath,
                details: readError.message
            }, { status: 500 });
        }

        const auth = new google.auth.GoogleAuth({
            credentials, // Pass object directly
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
        });

        const authClient = await auth.getClient();
        const calendar = google.calendar({ version: 'v3', auth: authClient as any });

        // Try to list events
        const res = await calendar.events.list({
            calendarId,
            timeMin: new Date().toISOString(),
            maxResults: 1,
            singleEvents: true,
            orderBy: 'startTime',
        });

        return NextResponse.json({
            success: true,
            message: "Google Calendar API Connection Successful (Credentials loaded manually)",
            listResult: res.data.items?.length,
        });

    } catch (error: any) {
        return NextResponse.json({
            success: false,
            error: error.message,
            stack: error.stack,
            details: error
        }, { status: 500 }); // Return JSON even on error
    }
}
