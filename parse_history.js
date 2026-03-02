const fs = require('fs');

const data = JSON.parse(fs.readFileSync('history_H0033.json', 'utf8').replace(/\[dotenv[^\]]+\] [^\n]+\n/, "").replace(/Fetching sync logs...\n/, "").replace(/Recent History logs mentioning H0033:\n/, ""));

data.forEach(log => {
    const h0033Logs = log.change_details.filter(d => d.includes('H0033'));
    console.log(`Time: ${log.created_at}, Type: ${log.sync_type}`);
    console.log(h0033Logs.join('\n'));
});
