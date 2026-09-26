#!/usr/bin/env node
/**
 * Stamp a checkout with a client's identity, in place, for CI to build from.
 *
 * WHY THIS EXISTS
 * A packaged app (Electron / Android) has no hostname, so themeApplier's domain
 * map can't tell it which school it belongs to. The only signal it has is the
 * <meta name="client-id"> baked into its HTML at build time. Until now that was
 * achieved by keeping a long-lived branch per client (seatos, greenwood,
 * sunrise) and merging main into it before every release — which meant a new
 * client cost a new branch, and every release cost a merge that could conflict.
 *
 * Nothing about that needed a branch. The branch only ever carried two edits:
 * the meta tag, and the deleted landing page. Both are done here instead, on a
 * throwaway CI checkout of main, so a client release is a workflow run rather
 * than a branch to maintain forever.
 *
 * This script only touches the working tree — no git, no commit, no push. CI
 * discards the checkout afterwards.
 *
 *   node scripts/prepare-client-build.js <clientId> <version>
 *   node scripts/prepare-client-build.js seatos 2.0.6
 *   node scripts/prepare-client-build.js default 2.0.6
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// Deleted for client builds: a school's installer shouldn't carry the public
// marketing site. `default` keeps them — that build IS the public one.
const LANDING_FILES = [
    'src/landing-view.html',
    'src/css/landing.css',
    'src/js/landing.js'
];

const clientId = (process.argv[2] || 'default').trim();
const version = (process.argv[3] || '').trim();

if (!/^[a-z0-9][a-z0-9-]*$/.test(clientId)) {
    console.error(`❌ Invalid client id: "${clientId}" (expected lowercase letters, digits and hyphens)`);
    process.exit(1);
}
if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`❌ Invalid version: "${version}" (expected semver, e.g. 2.0.6)`);
    process.exit(1);
}

console.log(`\n📦 Preparing build — client: ${clientId}${version ? `  version: ${version}` : ''}`);

// 1. Version. Skipped when CI derived it from the tag and already applied it.
if (version) {
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`  ✔ package.json version -> ${version}`);
}

// 2. Meta tag. Reuses the existing script so there is one implementation of
//    "which HTML files carry the tag, and where in them it goes".
execFileSync('node', [path.join(ROOT, 'add-client-meta-tag.js'), clientId], {
    cwd: ROOT,
    stdio: 'inherit'
});

// 3. Landing page — client builds only.
if (clientId === 'default') {
    console.log('  ✔ Keeping landing page (default build is the public site)');
} else {
    for (const rel of LANDING_FILES) {
        const abs = path.join(ROOT, rel);
        try {
            fs.unlinkSync(abs);
            console.log(`  ✔ Removed ${rel}`);
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
            console.log(`  – Not present: ${rel}`);
        }
    }
}

console.log(`\n✅ Checkout prepared for "${clientId}".\n`);
