import fetch from 'node-fetch';

async function testApi() {
    const url = 'http://localhost:3000/api/report-processing?year=2026&period=상반기&search=엘에스이';
    try {
        const res = await fetch(url);
        const data: any = await res.json();
        console.log('API Response for 엘에스이:');
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Error fetching API:', e);
    }
}

testApi();
