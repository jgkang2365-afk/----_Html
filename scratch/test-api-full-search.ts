import fetch from 'node-fetch';

async function testApi() {
    const search = '지방도, 태안발전, 상하수도관, 엘에스이';
    const url = `http://localhost:3000/api/report-processing?year=2026&period=상반기&search=${encodeURIComponent(search)}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        console.log(`API Response for ${search}:`);
        data.records.forEach((r: any) => {
            console.log(`- ${r.business_name} (${r.code}): K2B Status: ${r.k2b_status}, Date: ${r.k2b_send_date}`);
        });
    } catch (e) {
        console.error('Error fetching API:', e);
    }
}

testApi();
