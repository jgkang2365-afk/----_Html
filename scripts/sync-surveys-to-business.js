const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const KEY_FILE_PATH = path.join(process.cwd(), 'google-credentials.json');
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

const getAuthClient = async () => {
    let credentials;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
        credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    } else if (fs.existsSync(KEY_FILE_PATH)) {
        const keyFileContent = fs.readFileSync(KEY_FILE_PATH, 'utf-8');
        credentials = JSON.parse(keyFileContent);
    } else {
        throw new Error('Google credentials not found.');
    }

    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: SCOPES,
    });
    return auth.getClient();
};

async function createEvent(calendar, calendarId, eventData) {
    const lastDay = eventData.endDate || eventData.date;
    const endCalc = new Date(lastDay);
    endCalc.setDate(endCalc.getDate() + 1);
    const endDateStr = endCalc.toISOString().split('T')[0];

    const event = {
        summary: eventData.summary,
        description: eventData.description,
        location: eventData.location,
        colorId: eventData.colorId,
        status: 'confirmed',
        start: { date: eventData.date, timeZone: 'Asia/Seoul' },
        end: { date: endDateStr, timeZone: 'Asia/Seoul' },
    };

    const response = await calendar.events.insert({
        calendarId,
        requestBody: event,
    });
    return response.data;
}

async function updateEvent(calendar, calendarId, eventId, eventData) {
    const lastDay = eventData.endDate || eventData.date;
    const endCalc = new Date(lastDay);
    endCalc.setDate(endCalc.getDate() + 1);
    const endDateStr = endCalc.toISOString().split('T')[0];

    const event = {
        summary: eventData.summary,
        description: eventData.description,
        location: eventData.location,
        colorId: eventData.colorId,
        status: 'confirmed',
        start: { date: eventData.date, timeZone: 'Asia/Seoul' },
        end: { date: endDateStr, timeZone: 'Asia/Seoul' },
    };

    const response = await calendar.events.update({
        calendarId,
        eventId,
        requestBody: event,
    });
    return response.data;
}

async function run() {
    console.log("Starting survey sync to business list...");

    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    let calendar = null;
    if (calendarId) {
        try {
            const authClient = await getAuthClient();
            calendar = google.calendar({ version: 'v3', auth: authClient });
            console.log("Google Calendar Client Initialized.");
        } catch (e) {
            console.error("Failed to initialize Google Calendar client:", e);
        }
    }

    // Get all users for measurer_id mapping
    const { data: users } = await supabase.from('users').select('id, name');
    const userMap = {};
    users?.forEach(u => {
        if (u.name) userMap[u.name.trim()] = u.id;
    });

    // Color map
    const colorMap = { '한기문': '10', '배윤민': '6', '강종구': '9', '이주형': '5', '고유빈': '7' };

    // Get all preliminary surveys
    const { data: surveys, error: surveyError } = await supabase
        .from('preliminary_survey')
        .select('*');

    if (surveyError) {
        console.error("Error fetching surveys:", surveyError);
        return;
    }

    console.log(`Found ${surveys.length} surveys to process...`);

    let updatedCount = 0;
    let calendarUpdatedCount = 0;

    for (const survey of surveys) {
        if (!survey.code || !survey.year || !survey.period) continue;

        const { data: targetBiz } = await supabase
            .from('measurement_target_business')
            .select('*')
            .eq('code', survey.code)
            .eq('year', survey.year)
            .eq('period', survey.period)
            .maybeSingle();

        if (!targetBiz) continue;

        let measurerId = null;
        if (survey.report_writer) {
            measurerId = userMap[survey.report_writer.trim()] || null;
        }

        // Update target business
        const updates = {
            is_registered: '확정',
            measurer_id: measurerId,
            measurement_date: survey.measurement_date
        };

        const { error: updateError } = await supabase
            .from('measurement_target_business')
            .update(updates)
            .eq('id', targetBiz.id);

        if (updateError) {
            console.error(`Failed to update business ${survey.code}:`, updateError);
            continue;
        }

        updatedCount++;
        console.log(`Updated business ${survey.code} - ${targetBiz.business_name}`);

        // Calendar Sync Logic
        const isAfterCutoff = new Date(survey.measurement_date) >= new Date("2026-02-22");
        if (isAfterCutoff && calendar && calendarId) {
            try {
                // Get unpaid info
                let unpaidText = "";
                const { data: journalData } = await supabase
                    .from("measurement_journal")
                    .select("measurement_year, measurement_period, measurement_fee_business, deposit_amount_business, deposit_amount_business_2")
                    .eq("code", survey.code);

                if (journalData && journalData.length > 0) {
                    const unpaidPeriods = [];
                    journalData.forEach(j => {
                        const feeBiz = Number(j.measurement_fee_business || 0);
                        const depBiz = Number(j.deposit_amount_business || 0);
                        const depBiz2 = Number(j.deposit_amount_business_2 || 0);
                        if (feeBiz - (depBiz + depBiz2) > 0) {
                            const yr = String(j.measurement_year).slice(-2);
                            const pd = j.measurement_period === "상반기" ? "상" : j.measurement_period === "하반기" ? "하" : j.measurement_period;
                            unpaidPeriods.push(`${yr}${pd}`);
                        }
                    });
                    if (unpaidPeriods.length > 0) unpaidText = `${unpaidPeriods.join("/")} 미수`;
                }

                const reportWriterName = survey.report_writer || '미지정';
                let namesDisplay = reportWriterName;
                if (survey.actual_measurer) {
                    const actualList = survey.actual_measurer.split(",").map(m => m.trim());
                    const additional = actualList.filter(m => m !== reportWriterName);
                    if (additional.length > 0) {
                        namesDisplay = `${reportWriterName}, ${additional.join(", ")}`;
                    }
                }

                const notesText = targetBiz.notes || "";
                const baseSummary = `[${namesDisplay}]${survey.business_name || targetBiz.business_name}`;
                const suffixParts = [unpaidText, notesText].filter(Boolean);
                const suffix = suffixParts.length > 0 ? ` - ${suffixParts.join(" / ")}` : "";
                const newSummary = baseSummary + suffix;

                const eventData = {
                    summary: newSummary,
                    description: `사업장: ${survey.business_name || targetBiz.business_name}\n주소: ${targetBiz.address || "주소 미입력"}\n담당자: ${reportWriterName}\n연락처: ${targetBiz.manager_mobile || targetBiz.phone || "없음"}\n비고: ${notesText}`.trim(),
                    date: survey.measurement_date,
                    endDate: (survey.end_date && survey.end_date !== survey.measurement_date) ? survey.end_date : undefined,
                    location: targetBiz.address || "",
                    colorId: colorMap[reportWriterName]
                };

                if (targetBiz.google_event_id) {
                    await updateEvent(calendar, calendarId, targetBiz.google_event_id, eventData);
                    console.log(`  -> Updated Google Calendar event: ${targetBiz.google_event_id}`);
                } else {
                    const newEvent = await createEvent(calendar, calendarId, eventData);
                    if (newEvent && newEvent.id) {
                        await supabase.from("measurement_target_business").update({ google_event_id: newEvent.id }).eq("id", targetBiz.id);
                        console.log(`  -> Created Google Calendar event: ${newEvent.id}`);
                    }
                }
                calendarUpdatedCount++;
            } catch (calErr) {
                console.error(`  -> Failed to sync calendar for ${survey.code}:`, calErr.message || calErr);
            }
        } else if (!isAfterCutoff) {
            console.log(`  -> Skipped Calendar sync: Date ${survey.measurement_date} < 2026-02-22`);
        }
    }

    console.log(`\nSync complete! Updated ${updatedCount} businesses. Synced ${calendarUpdatedCount} calendar events.`);
}

run();
