/**
 * Strip Landing Page
 * Removes all landing page files and HTML from the build.
 * Called by release-client.js for client branches (landing page is main-branch only).
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// 1. Delete landing CSS and JS files
['src/css/landing.css', 'src/js/landing.js'].forEach(f => {
    const full = path.join(root, f);
    try {
        fs.unlinkSync(full);
        console.log(`  Deleted ${f}`);
    } catch (e) {
        // File may already be deleted from a previous release
    }
});

// 2. Strip landing HTML from index.html
const indexPath = path.join(root, 'src/index.html');
let html = fs.readFileSync(indexPath, 'utf8');
const originalSize = html.length;

// Method A: Use comment markers (clean merge from main)
const landingMarker = html.indexOf('LANDING PAGE VIEW');
const loginMarker = html.indexOf('LOGIN VIEW');

if (landingMarker !== -1 && loginMarker !== -1) {
    const cutFrom = html.lastIndexOf('<!--', landingMarker);
    const cutTo = html.lastIndexOf('<!--', loginMarker);

    if (cutFrom !== -1 && cutTo !== -1 && cutTo > cutFrom) {
        const before = html.substring(0, cutFrom).replace(/[\r\n\s]+$/, '');
        const after = html.substring(cutTo);
        html = before + '\n\n        ' + after;
        console.log(`  Stripped landing-view block via markers (${((cutTo - cutFrom) / 1024) | 0}KB removed)`);
    }
}

// Method B: Fallback — remove any orphaned landing HTML left from a broken prior strip
// This catches cases where the comment markers were removed but inner content survived
const landingPatterns = [
    // Remove entire lines that contain landing-specific classes/IDs
    /^.*class="landing-[^"]*".*$/gm,
    /^.*id="landing-[^"]*".*$/gm,
    // Remove the demo modal
    /^.*id="demo-modal".*$/gm,
    /^.*class="demo-[^"]*".*$/gm,
    // Remove landing-specific inline elements
    /^.*id="landing-download-btn".*$/gm,
    /^.*id="landing-try-online-btn".*$/gm,
    /^.*id="landing-demo-btn".*$/gm,
    /^.*data-count=".*$/gm,
];

let fallbackRemoved = 0;
for (const pattern of landingPatterns) {
    const before = html.length;
    html = html.replace(pattern, '');
    fallbackRemoved += before - html.length;
}

if (fallbackRemoved > 0) {
    console.log(`  Fallback: removed ${fallbackRemoved} bytes of orphaned landing HTML`);
}

// Clean up excessive blank lines left after removal
html = html.replace(/\n{4,}/g, '\n\n');

// 3. Remove landing.css link and landing.js script tags
html = html.replace(/\s*<link[^>]*landing\.css[^>]*>/g, '');
html = html.replace(/\s*<script[^>]*landing\.js[^>]*><\/script>/g, '');

// 4. Make login-view visible by default (no longer hidden behind landing page)
html = html.replace(
    '<div id="login-view" style="display:none">',
    '<div id="login-view">'
);

fs.writeFileSync(indexPath, html);

const removed = originalSize - html.length;
console.log(`  Updated src/index.html (${removed > 0 ? removed + ' bytes removed' : 'no changes needed'})`);
