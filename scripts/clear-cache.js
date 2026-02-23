const fs = require('fs');
const path = require('path');

const directoriesToClean = [
    '.next',
    path.join('node_modules', '.cache')
];

console.log('🧹 Cleaning caches...');

directoriesToClean.forEach(dir => {
    const fullPath = path.resolve(process.cwd(), dir);
    if (fs.existsSync(fullPath)) {
        try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`   - ${dir} deleted`);
        } catch (err) {
            console.error(`   - Failed to delete ${dir}: ${err.message}`);
        }
    } else {
        console.log(`   - ${dir} not found, skipping`);
    }
});

console.log('✨ Cache cleaning completed.');
