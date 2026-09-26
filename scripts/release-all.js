#!/usr/bin/env node
/**
 * Release every client at once.
 *
 *   npm run release:all -- 2.0.6
 *
 * Bumps package.json on main, commits, tags v2.0.6 (no client suffix) and
 * pushes. That unsuffixed tag is what tells the build workflows to fan out
 * over clients.json and build an APK + installers for EVERY school in
 * parallel, each published to its own release tag.
 *
 * WHY THIS REPLACES release-client.js FOR THE COMMON CASE
 * release-client.js releases one client, by checking out that client's branch
 * and merging main into it. With teachers installing the app on their phones,
 * every school needs its own APK on every release — which meant one branch and
 * one merge per school, every time. Here the client identity is stamped by CI
 * at build time instead (scripts/prepare-client-build.js), so there is nothing
 * to merge and nothing to keep in sync.
 *
 * release-client.js still works and is still the way to ship ONE client a fix
 * without releasing everyone.
 *
 * Adding a school: add it to clients.json. That's the whole change.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const version = (process.argv[2] || '').trim().replace(/^v/, '');

function run(cmd, label) {
    console.log(`\n▶ ${label}`);
    console.log(`  $ ${cmd}`);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function capture(cmd) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error('\n❌ Usage: npm run release:all -- <version>   e.g. 2.0.6\n');
    process.exit(1);
}

const tag = `v${version}`;

// Releasing from anywhere but main would tag the wrong tree — the client
// branches are exactly what this script exists to stop depending on.
const branch = capture('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
    console.error(`\n❌ On branch "${branch}". Run this from main — it releases every client from one tree.\n`);
    process.exit(1);
}

if (capture('git status --porcelain')) {
    console.error('\n❌ You have uncommitted changes. Commit or stash them first.\n');
    process.exit(1);
}

const existing = capture('git tag --list').split('\n');
if (existing.includes(tag)) {
    console.error(`\n❌ Tag ${tag} already exists. Pick a new version.\n`);
    process.exit(1);
}

const { clients } = JSON.parse(fs.readFileSync(path.join(ROOT, 'clients.json'), 'utf8'));
const ids = clients.map((c) => c.id).filter(Boolean);

console.log('\n' + '─'.repeat(55));
console.log(`🚀 Releasing ${tag} for ${ids.length} client(s):`);
for (const c of clients) console.log(`     • ${c.id.padEnd(18)} ${c.name || ''}`);
console.log('─'.repeat(55));

// 1. Version
const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`\n✔ package.json version -> ${version}`);

// 2. Commit (only if the bump actually changed something)
if (capture('git status --porcelain')) {
    run('git add package.json', 'Staging version bump');
    run(`git commit -m "release ${tag}: bump version to ${version}"`, 'Committing');
} else {
    console.log('\n✔ Version already correct — nothing to commit');
}

// 3. Tag + push. The unsuffixed tag is the fan-out signal.
run(`git tag ${tag}`, `Tagging ${tag}`);
run(`git push origin main ${tag}`, 'Pushing main and tag');

console.log('\n' + '─'.repeat(55));
console.log(`✅ ${tag} pushed. Every client is building now, in parallel.`);
console.log('   https://github.com/Kurnel-purpple/7thGen-CBT-APP/actions');
console.log('\n   Each school gets its own release:');
for (const id of ids) {
    console.log(`     ${id === 'default' ? tag : `${tag}-${id}`}`);
}
console.log('');
