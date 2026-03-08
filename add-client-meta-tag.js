/**
 * Add client-id meta tag to all HTML pages
 * This ensures consistent client configuration across the app
 */

const fs = require('fs');
const path = require('path');

// Get client ID from command line or use default
const clientId = process.argv[2] || 'default';

console.log(`📝 Adding client-id="${clientId}" to all HTML pages...`);

// Files to update
const htmlFiles = [
    'src/pages/teacher-dashboard.html',
    'src/pages/register.html',
    'src/pages/create-exam.html',
    'src/pages/take-exam.html',
    'src/pages/exam-results.html',
    'src/pages/results.html'
];

let updatedCount = 0;
let skippedCount = 0;

htmlFiles.forEach(filePath => {
    try {
        // Read file
        let content = fs.readFileSync(filePath, 'utf8');

        // Check if meta tag already exists
        if (content.includes('name="client-id"')) {
            console.log(`⏭️  Skipped ${filePath} (already has client-id meta tag)`);

            // Update the content value if it's different
            const regex = /<meta name="client-id" content="([^"]+)">/;
            const match = content.match(regex);
            if (match && match[1] !== clientId) {
                content = content.replace(regex, `<meta name="client-id" content="${clientId}">`);
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`   ✅ Updated client-id to "${clientId}"`);
                updatedCount++;
            } else {
                skippedCount++;
            }
            return;
        }

        // Find the viewport meta tag and add client-id after it
        const viewportRegex = /(<meta name="viewport" content="[^"]+">)/;
        if (viewportRegex.test(content)) {
            content = content.replace(
                viewportRegex,
                `$1\n    <meta name="client-id" content="${clientId}">`
            );

            // Write back to file
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`✅ Added client-id to ${filePath}`);
            updatedCount++;
        } else {
            console.log(`⚠️  Could not find viewport meta tag in ${filePath}`);
            skippedCount++;
        }
    } catch (error) {
        console.error(`❌ Error processing ${filePath}:`, error.message);
        skippedCount++;
    }
});

console.log(`\n📊 Summary:`);
console.log(`   ✅ Updated: ${updatedCount} files`);
console.log(`   ⏭️  Skipped: ${skippedCount} files`);
console.log(`\n✨ Done! All HTML pages now have client-id="${clientId}"`);
