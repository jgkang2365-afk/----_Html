const fs = require('fs');
const path = require('path');

const directoriesToClean = [
    '.next',
    'node_modules/.cache',
    'out',
    'dist'
];

console.log('🛑 Force Cleaning caches and build artifacts...');

directoriesToClean.forEach(dir => {
    const fullPath = path.resolve(process.cwd(), dir);
    if (fs.existsSync(fullPath)) {
        try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            console.log(`   - ${dir} deleted`);
        } catch (err) {
            console.error(`   - Failed to delete ${dir}: ${err.message}`);
        }
    }
});

console.log('✨ Force cleaning completed.');
