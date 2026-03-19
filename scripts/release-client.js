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

// 2. Merge main (allow conflicts — we auto-resolve landing file conflicts below)
const LANDING_FILES = ['src/landing-view.html', 'src/css/landing.css', 'src/js/landing.js'];

try {
    console.log('\n▶ Merging main into client branch');
    execSync('git merge main --no-edit', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
} catch (err) {
    // Check if the only conflicts are landing files (modify/delete) — auto-resolve them
    const conflicts = execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const landingOnly = conflicts.every(f => LANDING_FILES.includes(f.replace(/\\/g, '/')));
    if (landingOnly && conflicts.length > 0) {
        console.log('  ⚠ Landing file conflicts detected — auto-resolving (delete on client branch)');
        for (const f of conflicts) {
            execSync(`git rm -f "${f}"`, { encoding: 'utf8' });
        }
        // Continue with the merge
        execSync('git -c core.editor=true merge --continue', { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
    } else {
        console.error('❌ Merge conflicts on non-landing files:', conflicts.join(', '));
        execSync('git merge --abort', { encoding: 'utf8' });
        process.exit(1);
    }
}

// 3. Delete landing page files (in case merge brought them back)
console.log('\n▶ Deleting landing page files (client branch only)');
for (const f of LANDING_FILES) {
    try { require('fs').unlinkSync(f); console.log('  Deleted ' + f); } catch { console.log('  Already gone: ' + f); }
}

// 4. Bump version in package.json
run(
    `node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version='${version}';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\\n')"`,
    `Bumping package.json version to ${version}`
);

// 5. Fix meta tags
run(
    `node ${path.join(__dirname, '..', 'add-client-meta-tag.js')} ${clientId}`,
    `Setting client-id="${clientId}" in all HTML files`
);

// 6. Stage all changed/deleted files
run('git add -A', 'Staging all changes');

// 7. Commit only if there are changes
if (hasUncommittedChanges()) {
    run(`git commit -m "release ${tag}: bump version to ${version}, strip landing page, restore ${clientId} meta tags"`, 'Committing changes');
} else {
    console.log('\n✅ No changes needed — skipping commit');
}

// 8. Tag
run(`git tag ${tag}`, `Creating tag: ${tag}`);

// 9. Push branch + tag
run(`git push origin ${clientId} ${tag}`, `Pushing branch and tag to GitHub`);

console.log('\n' + '─'.repeat(55));
console.log(`✅ Done! Release ${tag} is building on GitHub Actions.`);
console.log(`   https://github.com/Kurnel-purpple/7thGen-CBT-APP/actions`);
