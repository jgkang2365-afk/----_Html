import { createSurveyEvent } from '../lib/google/calendar';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function testColorEvent() {
    console.log('Testing Google Calendar Sync with Colors...');

    const testData = [
        { name: '한기문', colorId: '10', colorName: 'Basil' },
        { name: '배윤민', colorId: '6', colorName: 'Tangerine' },
    ];

    for (const person of testData) {
        const eventTitle = `[${person.name}]테스트사업장-${person.colorName}`;
        const date = new Date().toISOString().split('T')[0]; // Today

        console.log(`Creating event for ${person.name} (${person.colorName})...`);

        try {
            const result = await createSurveyEvent({
                summary: eventTitle,
                date: date,
                description: `Color Test for ${person.name}`,
                location: 'Test Location',
                colorId: person.colorId
            });

            if (result) {
                console.log(`SUCCESS: Created event for ${person.name}. Link: ${result.htmlLink}`);
            } else {
                console.log(`FAILURE: Failed to create event for ${person.name}`);
            }
        } catch (e) {
            console.error(`ERROR: ${e}`);
        }
    }
}

testColorEvent();
