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

// 3. Remove landing page (client branches only — landing is default/main experience)
run(
    `node -e "\
const fs=require('fs');\
/* Delete landing CSS and JS files */\
['src/css/landing.css','src/js/landing.js'].forEach(f=>{try{fs.unlinkSync(f);console.log('  Deleted '+f)}catch(e){}});\
/* Strip entire landing-view block from index.html */\
let html=fs.readFileSync('src/index.html','utf8');\
/* Remove everything between LANDING PAGE VIEW comment and LOGIN VIEW comment */\
var landingStart=html.indexOf('LANDING PAGE VIEW');\
var loginStart=html.indexOf('LOGIN VIEW');\
if(landingStart!==-1&&loginStart!==-1){\
  /* Walk back to find the <!-- that opens the landing comment */\
  var cutFrom=html.lastIndexOf('<!--',landingStart);\
  /* Walk back to find the <!-- that opens the login comment */\
  var cutTo=html.lastIndexOf('<!--',loginStart);\
  /* Also need to skip any whitespace/newlines before the login comment */\
  if(cutFrom!==-1&&cutTo!==-1&&cutTo>cutFrom){\
    /* Trim trailing whitespace before the login comment */\
    var before=html.substring(0,cutFrom).replace(/[\\r\\n\\s]+$/,'');\
    var after=html.substring(cutTo);\
    html=before+'\\n\\n        '+after;\
    console.log('  Stripped landing-view HTML block ('+((cutTo-cutFrom)/1024|0)+'KB removed)');\
  }else{console.log('  WARNING: Could not find comment boundaries');}\
}else{console.log('  No landing-view block found (already stripped)');}\
/* Remove landing.css link */\
html=html.replace(/\\s*<link[^>]*landing\\.css[^>]*>/g,'');\
/* Remove landing.js script */\
html=html.replace(/\\s*<script[^>]*landing\\.js[^>]*><\\/script>/g,'');\
/* Make login-view visible by default (no longer hidden behind landing) */\
html=html.replace('<div id=\\"login-view\\" style=\\"display:none\\">', '<div id=\\"login-view\\">');\
fs.writeFileSync('src/index.html',html);\
console.log('  Updated src/index.html');"`,
    'Removing landing page files (client branch only)'
);

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

// 6. Stage updated files (including deleted landing files)
run('git add -A package.json src/index.html src/css/landing.css src/js/landing.js src/pages/admin-dashboard.html src/pages/student-dashboard.html src/pages/teacher-dashboard.html src/pages/register.html src/pages/create-exam.html src/pages/take-exam.html src/pages/exam-results.html src/pages/results.html', 'Staging all changes');

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
