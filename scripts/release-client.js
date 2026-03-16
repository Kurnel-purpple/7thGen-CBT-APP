/**
 * Release Client Script
 * Automates merging main into a client branch, fixing meta tags, tagging, and pushing.
 *
 * Usage:
 *   node scripts/release-client.js <clientId> <version>
 *   npm run release:client -- seatos 1.3.5
 *
 * Example:
 *   node scripts/release-client.js seatos 1.3.5
 *   → checks out seatos, merges main, fixes meta tags, tags v1.3.5-seatos, pushes
 */

const { execSync } = require('child_process');
const path = require('path');

// ─── Args ────────────────────────────────────────────────────────────────────
const [clientId, version] = process.argv.slice(2);

if (!clientId || !version) {
    console.error('❌ Usage: node scripts/release-client.js <clientId> <version>');
    console.error('   Example: node scripts/release-client.js seatos 1.3.5');
    process.exit(1);
}

const tag = `v${version}-${clientId}`;

// ─── Helpers ─────────────────────────────────────────────────────────────────
function run(cmd, label) {
    console.log(`\n▶ ${label || cmd}`);
    try {
        const out = execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
        if (out.trim()) console.log(out.trim());
    } catch (err) {
        const msg = (err.stderr || err.stdout || err.message || '').trim();
        console.error(`❌ Failed: ${msg}`);
        process.exit(1);
    }
}

function hasUncommittedChanges() {
    try {
        const out = execSync('git status --porcelain', { encoding: 'utf8' });
        return out.trim().length > 0;
    } catch {
        return false;
    }
}

// ─── Steps ───────────────────────────────────────────────────────────────────
console.log(`\n🚀 Releasing client: ${clientId}  version: ${version}  tag: ${tag}`);
console.log('─'.repeat(55));

// 1. Switch to client branch
run(`git checkout ${clientId}`, `Switching to branch: ${clientId}`);

// 2. Merge main
run('git merge main --no-edit', 'Merging main into client branch');

// 3. Bump version in package.json
run(
    `node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='${version}';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\\n')"`,
    `Bumping package.json version to ${version}`
);

// 4. Fix meta tags
run(
    `node ${path.join(__dirname, '..', 'add-client-meta-tag.js')} ${clientId}`,
    `Setting client-id="${clientId}" in all HTML files`
);

// 5. Stage updated files
run('git add package.json src/index.html src/pages/admin-dashboard.html src/pages/student-dashboard.html src/pages/teacher-dashboard.html src/pages/register.html src/pages/create-exam.html src/pages/take-exam.html src/pages/exam-results.html src/pages/results.html', 'Staging package.json + HTML files');

// 6. Commit only if there are changes
if (hasUncommittedChanges()) {
    run(`git commit -m "release ${tag}: bump version to ${version} + restore ${clientId} meta tags"`, 'Committing version bump + meta tags');
} else {
    console.log('\n✅ No changes needed — skipping commit');
}

// 7. Tag
run(`git tag ${tag}`, `Creating tag: ${tag}`);

// 8. Push branch + tag
run(`git push origin ${clientId} ${tag}`, `Pushing branch and tag to GitHub`);

console.log('\n' + '─'.repeat(55));
console.log(`✅ Done! Release ${tag} is building on GitHub Actions.`);
console.log(`   https://github.com/Kurnel-purpple/7thGen-CBT-APP/actions`);
