/**
 * Fix mobile header layout in create-exam.html - CORRECTED VERSION
 * Row 1: Logo (left) | Back icon (right)
 * Row 2: Teacher name (left) | Dark mode (right)
 */

const fs = require('fs');

const filePath = 'src/pages/create-exam.html';

console.log('📝 Fixing mobile header layout (corrected version)...');

try {
    let content = fs.readFileSync(filePath, 'utf8');

    // Replace the mobile CSS section
    const oldMobileCss = /\.mobile-user-row \{[\s\S]*?\}[\s\S]*?\.mobile-user-name \{[\s\S]*?\}[\s\S]*?@media \(max-width: 600px\) \{[\s\S]*?\.section-header-questions \.actions \.btn \{[\s\S]*?\}[\s\S]*?\}/;

    const newMobileCss = `.mobile-user-row {
            display: none;
            width: 100%;
            justify-content: space-between;
            align-items: center;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--border-color);
        }

        .mobile-user-name {
            font-weight: 600;
            color: var(--text-color);
            font-size: 0.95rem;
        }

        @media (max-width: 600px) {
            .mobile-text {
                display: inline;
            }

            .desktop-text {
                display: none;
            }

            /* Mobile Header Layout - Two Rows */
            .main-header {
                flex-direction: column;
                padding: 12px 15px;
                gap: 0;
            }

            /* First Row: Logo (left) + Back Arrow (right) */
            .logo {
                width: 100%;
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 0;
            }

            .logo h1 {
                font-size: 1.1rem;
                margin: 0;
                order: 1;
            }

            /* Back button on the right side of first row */
            .btn-back-dashboard.mobile-only {
                order: 2;
                padding: 8px 12px !important;
                font-size: 1.3rem !important;
                min-width: auto !important;
                background: transparent !important;
                border: 1px solid var(--border-color) !important;
                color: var(--text-color) !important;
                border-radius: 8px;
                display: flex !important;
                align-items: center;
                justify-content: center;
                line-height: 1;
            }

            .btn-back-dashboard.mobile-only:hover {
                background: var(--inner-bg) !important;
            }

            /* Hide desktop user menu */
            .user-menu.desktop-only {
                display: none !important;
            }

            /* Second Row: Teacher Name (left) + Dark Mode (right) */
            .mobile-user-row {
                display: flex !important;
            }

            #user-desktop-name {
                display: none;
            }

            /* Questions Header */
            .section-header-questions {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }

            .section-header-questions .actions {
                width: 100%;
                display: flex;
                gap: 10px;
            }

            .section-header-questions .actions .btn {
                flex: 1;
                text-align: center;
                margin-right: 0 !important;
            }
        }`;

    content = content.replace(oldMobileCss, newMobileCss);

    // Replace the header HTML - Logo and back button should be in same div
    const oldHeader = /<header class="main-header">[\s\S]*?<\/header>/;

    const newHeader = `<header class="main-header">
            <!-- First Row: Logo (left) + Back button (right) -->
            <div class="logo">
                <h1 class="logo-text">Create New Exam</h1>
                <a href="teacher-dashboard.html" class="btn btn-outline btn-back-dashboard mobile-only">
                    <span>←</span>
                </a>
            </div>
            
            <!-- Desktop user menu -->
            <div class="user-menu desktop-only">
                <span id="user-desktop-name" style="margin-right: 15px; font-weight:bold;">Teacher</span>
                <a href="teacher-dashboard.html" class="btn btn-outline btn-back-dashboard">
                    <span class="desktop-text">← Back to Dashboard</span>
                </a>
            </div>
            
            <!-- Second Row: Teacher name (left) + Dark mode toggle (right) -->
            <div class="mobile-user-row">
                <span class="mobile-user-name" id="user-mobile-name">Teacher</span>
                <!-- Dark mode toggle will be injected here by utils.js -->
            </div>
        </header>`;

    content = content.replace(oldHeader, newHeader);

    // Write back
    fs.writeFileSync(filePath, content, 'utf8');

    console.log('✅ Mobile header layout fixed successfully!');
    console.log('\nLayout:');
    console.log('  Row 1: [Logo]                    [← Back]');
    console.log('  Row 2: [Teacher Name]            [🌙 Dark Mode]');

} catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
}
