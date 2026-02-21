/**
 * 기존 캘린더 이벤트 일괄 업데이트 (다일 이벤트 반영)
 * 예비조사의 end_date가 있으면 → 다일 이벤트로 표시
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
const path = require('path');

const COLOR_MAP = { '한기문': '10', '배윤민': '6', '강종구': '9', '이주형': '5', '고유빈': '7' };

async function getAuthClient() {
    const keyPath = path.join(process.cwd(), 'google-credentials.json');
    const auth = new google.auth.GoogleAuth({ keyFile: keyPath, scopes: ['https://www.googleapis.com/auth/calendar'] });
    return await auth.getClient();
}

async function getUnpaidText(supabase, code) {
    const { data } = await supabase.from('measurement_journal')
        .select('measurement_year, measurement_period, measurement_fee_business, deposit_amount_business, deposit_amount_business_2')
        .eq('code', code);
    if (!data || data.length === 0) return '';
    const periods = [];
    data.forEach(j => {
        const unpaid = Number(j.measurement_fee_business || 0) - (Number(j.deposit_amount_business || 0) + Number(j.deposit_amount_business_2 || 0));
        if (unpaid > 0) {
            const yr = String(j.measurement_year).slice(-2);
            const pd = j.measurement_period === '상반기' ? '상' : j.measurement_period === '하반기' ? '하' : j.measurement_period;
            periods.push(`${yr}${pd}`);
        }
    });
    return periods.length > 0 ? `${periods.join('/')} 미수` : '';
}

async function updateAll() {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    const authClient = await getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });

    console.log("=== 일괄 업데이트 (다일 이벤트 반영) ===\n");

    const { data: businesses } = await supabase.from('measurement_target_business')
        .select('code, business_name, google_event_id, measurer_id, address, manager_mobile, phone, notes, measurement_date')
        .not('google_event_id', 'is', null);

    const { data: users } = await supabase.from('users').select('id, name');
    const userMap = new Map(users.map(u => [u.id, u.name]));

    let success = 0, fail = 0, multiDay = 0;

    for (const b of businesses) {
        const measurerName = b.measurer_id ? (userMap.get(b.measurer_id) || '미지정') : '미지정';

        // 실측정자 + 종료일 조회
        const { data: surveyData } = await supabase.from('preliminary_survey')
            .select('actual_measurer, end_date')
            .eq('code', b.code)
            .order('measurement_date', { ascending: false })
            .limit(1)
            .maybeSingle();

        let namesDisplay = measurerName;
        if (surveyData?.actual_measurer) {
            const actualList = surveyData.actual_measurer.split(',').map(m => m.trim());
            const additional = actualList.filter(m => m !== measurerName);
            if (additional.length > 0) {
                namesDisplay = `${measurerName}, ${additional.join(', ')}`;
            }
        }

        // 종료일 (다일 이벤트)
        let endDate = undefined;
        if (surveyData?.end_date && surveyData.end_date !== b.measurement_date) {
            endDate = surveyData.end_date;
            multiDay++;
        }

        const unpaidText = await getUnpaidText(supabase, b.code);
        const notesText = b.notes || '';
        const baseSummary = `[${namesDisplay}]${b.business_name}`;
        const suffixParts = [unpaidText, notesText].filter(Boolean);
        const suffix = suffixParts.length > 0 ? ` - ${suffixParts.join(', ')}` : '';
        const summary = baseSummary + suffix;
        const colorId = COLOR_MAP[measurerName];

        // end.date 계산: Google Calendar는 end를 exclusive로 처리
        const lastDay = endDate || b.measurement_date;
        const endCalc = new Date(lastDay);
        endCalc.setDate(endCalc.getDate() + 1);
        const endDateStr = endCalc.toISOString().split('T')[0];

        try {
            await calendar.events.patch({
                calendarId,
                eventId: b.google_event_id,
                requestBody: {
                    summary, colorId, status: 'confirmed',
                    start: { date: b.measurement_date, timeZone: 'Asia/Seoul' },
                    end: { date: endDateStr, timeZone: 'Asia/Seoul' },
                },
            });
            const dayInfo = endDate ? ` (${b.measurement_date} ~ ${endDate})` : '';
            console.log(`✅ ${summary}${dayInfo}`);
            success++;
        } catch (e) {
            console.error(`❌ [${b.code}] ${e.message}`);
            fail++;
        }
        await new Promise(r => setTimeout(r, 100));
    }

    console.log(`\n=== 완료 ===`);
    console.log(`성공: ${success}건, 실패: ${fail}건, 다일 이벤트: ${multiDay}건`);
}

updateAll();
