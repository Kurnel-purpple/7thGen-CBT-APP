/**
 * Add Configuration System to All HTML Pages
 * This script adds the config initialization to all HTML files
 * 
 * Run: node add-config-to-pages.js
 */

const fs = require('fs');
const path = require('path');

const configInitCode = `
    <!-- Configuration System -->
    <script type="module">
        import { initConfig } from '../config/index.js';
        // Initialize configuration before other scripts
        await initConfig();
    </script>
`;

const configInitCodeRoot = `
    <!-- Configuration System -->
    <script type="module">
        import { initConfig } from './config/index.js';
        // Initialize configuration before other scripts
        await initConfig();
    </script>
`;

const pagesToUpdate = [
    { file: 'src/pages/student-dashboard.html', code: configInitCode },
    { file: 'src/pages/teacher-dashboard.html', code: configInitCode },
    { file: 'src/pages/create-exam.html', code: configInitCode },
    { file: 'src/pages/take-exam.html', code: configInitCode },
    { file: 'src/pages/exam-results.html', code: configInitCode },
    { file: 'src/pages/results.html', code: configInitCode }
];

function addConfigToPage(filePath, configCode) {
    const fullPath = path.join(__dirname, filePath);

    if (!fs.existsSync(fullPath)) {
        console.log(`⚠️  Skipping ${filePath} - file not found`);
        return;
    }

    let content = fs.readFileSync(fullPath, 'utf8');

    // Check if already added
    if (content.includes('Configuration System')) {
        console.log(`✓  ${filePath} - already has config system`);
        return;
    }

    // Find the Supabase script section
    const supabasePattern = /<script src=".*supabaseClient\.js"><\/script>/;
    const match = content.match(supabasePattern);

    if (match) {
        // Insert config code after Supabase
        content = content.replace(
            match[0],
            match[0] + configCode
        );

        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`✅ ${filePath} - config system added`);
    } else {
        console.log(`⚠️  ${filePath} - could not find insertion point`);
    }
}

console.log('\n🔧 Adding Configuration System to HTML Pages\n');

pagesToUpdate.forEach(({ file, code }) => {
    addConfigToPage(file, code);
});

console.log('\n✨ Done!\n');
