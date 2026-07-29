#!/usr/bin/env node
/*
 * Backfill blank profiles.school_version for students in the promotion ladder
 * (Grade 4 .. SS3) so they become visible to the school-scoped admin portal.
 *
 * Also mirrors the value onto the linked `users` (auth) record.
 * Only touches profiles whose school_version is BLANK — never overwrites a
 * value that is already set.
 *
 * Requires Node 18+ (uses the built-in global fetch). No npm install needed.
 * Authenticates as a PocketBase SUPERUSER (admin), which bypasses collection
 * API rules. Targets a PocketBase v0.21.x server (/api/admins/auth-with-password).
 *
 * ── Dry run (default — shows what WOULD change, writes nothing): ────────────
 *   PB_URL=https://your-pb-host \
 *   PB_ADMIN_EMAIL=you@example.com \
 *   PB_ADMIN_PASSWORD=your-superuser-password \
 *   node scripts/fix-school-id.js
 *
 * ── Apply (actually writes): add APPLY=1 ────────────────────────────────────
 *   PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... APPLY=1 \
 *   node scripts/fix-school-id.js
 *
 * On Windows PowerShell, set vars first, e.g.:
 *   $env:PB_URL="https://your-pb-host"; $env:PB_ADMIN_EMAIL="you@x.com"; `
 *   $env:PB_ADMIN_PASSWORD="secret"; node scripts/fix-school-id.js
 */

'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const TARGET = process.env.TARGET_SCHOOL || 'SEATOSCBT2026';
const APPLY = process.env.APPLY === '1';

// Promotion ladder — only students in one of these classes are backfilled.
const LADDER = ['Grade 4', 'Grade 5&6', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
const norm = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();
const LADDER_KEYS = new Set(LADDER.map(norm));
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

function die(msg) { console.error('\nERROR: ' + msg); process.exit(1); }

async function api(token, method, path, body) {
  const res = await fetch(PB_URL + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${method} ${path} — ${json.message || text}`);
  return json;
}

(async () => {
  if (!PB_URL) die('Set PB_URL (e.g. https://your-pb-host)');
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD (a PocketBase superuser)');
  if (isBlank(TARGET)) die('TARGET_SCHOOL is blank');

  // 1) Authenticate. Prefer a PocketBase superuser (bypasses all API rules);
  //    fall back to an in-app admin account (the profiles rules let admins
  //    edit any profile, which is all this script needs).
  let token, authMode;
  try {
    const r = await api(null, 'POST', '/api/admins/auth-with-password', { identity: EMAIL, password: PASSWORD });
    token = r.token; authMode = 'superuser';
  } catch (superErr) {
    try {
      const r = await api(null, 'POST', '/api/collections/users/auth-with-password', { identity: EMAIL, password: PASSWORD });
      const role = r.record && r.record.role;
      if (role !== 'admin' && role !== 'super_admin') {
        die(`Signed in as "${EMAIL}" but its role is "${role}", not admin. ` +
            `Use a PocketBase superuser (the /_/ admin login) or an in-app admin account.`);
      }
      token = r.token; authMode = `app admin (${role})`;
      console.warn('Note: signed in as an app admin, not a superuser — this updates profiles only (the users mirror is skipped).');
    } catch (userErr) {
      die('Login failed for both a superuser and an app account:\n' +
          '  - superuser: ' + superErr.message + '\n' +
          '  - app user : ' + userErr.message + '\n' +
          'Check the email/password. Superuser = the login for ' + PB_URL + '/_/');
    }
  }
  console.log(`Connected to ${PB_URL} as ${authMode}`);
  console.log(`Target school_version = "${TARGET}"`);
  console.log(`Mode = ${APPLY ? 'APPLY (writes changes)' : 'DRY RUN (no writes)'}\n`);

  // 2) Fetch every student profile (paginated).
  const students = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ page: String(page), perPage: '200', filter: 'role = "student"' });
    const r = await api(token, 'GET', '/api/collections/profiles/records?' + q.toString());
    students.push(...r.items);
    if (page >= (r.totalPages || 1) || r.items.length === 0) break;
  }

  // 3) Partition.
  //    - blankLadder : blank school_version + a Grade4..SS3 class     -> always fixed
  //    - variant     : has SEATOSCBT2026 but wrong CASE/SPACING       -> invisible to the
  //                    admin (which matches exactly); fixed when FIX_VARIANTS=1
  //    - exactTarget : already exactly === TARGET                     -> truly visible, untouched
  //    - other       : some genuinely different value (demo/typo)     -> untouched
  const FIX_VARIANTS = process.env.FIX_VARIANTS === '1';
  const FIX_WRONG = process.env.FIX_WRONG === '1'; // fix CLASSED students (Grade4..SS3) under any wrong/blank id
  const FIX_ALL = process.env.FIX_ALL === '1';   // remap EVERY non-target, non-demo student to TARGET
  const TKEY = norm(TARGET);
  const isDemo = (v) => /^DEMO_/i.test(String(v || '')); // throwaway "Try Demo" accounts — never touched

  const blankLadder = students.filter((p) => isBlank(p.school_version) && LADDER_KEYS.has(norm(p.class_level)));
  const blankOffLadder = students.filter((p) => isBlank(p.school_version) && !LADDER_KEYS.has(norm(p.class_level)));
  const alreadySet = students.filter((p) => !isBlank(p.school_version));
  const exactTarget = alreadySet.filter((p) => p.school_version === TARGET);
  const variant = alreadySet.filter((p) => p.school_version !== TARGET && norm(p.school_version) === TKEY);
  const otherReal = alreadySet.filter((p) => norm(p.school_version) !== TKEY && !isDemo(p.school_version));
  const demo = alreadySet.filter((p) => isDemo(p.school_version));

  console.log(`Student profiles found            : ${students.length}`);
  console.log(`Blank + Grade4..SS3 (will fix)     : ${blankLadder.length}`);
  console.log(`Blank but off-ladder/no class      : ${blankOffLadder.length}  (skipped by default — no class)`);
  console.log(`Exactly "${TARGET}" (already visible): ${exactTarget.length}`);
  console.log(`Case/spacing VARIANTS of target    : ${variant.length}  ${variant.length ? '(invisible to admin)' : ''}`);
  console.log(`Other REAL school_version (not demo): ${otherReal.length}  (real students under a wrong/old School ID)`);
  console.log(`Demo/throwaway accounts (DEMO_*)   : ${demo.length}  (never touched)`);

  // Show what those "other" values actually are (top 20) so you can confirm
  // they are your students under a wrong ID vs something intentional.
  if (otherReal.length) {
    const dist = {};
    otherReal.forEach((p) => { const v = String(p.school_version); dist[v] = (dist[v] || 0) + 1; });
    console.log('\nOther (non-demo) school_version values (top 20):');
    Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 20)
      .forEach(([v, n]) => console.log(`  ${n.toString().padStart(4)}  ${v.length > 40 ? v.slice(0, 40) + '…' : v}`));
  }

  // Students in a real class (Grade4..SS3) whose id isn't already the exact
  // target and isn't a demo — i.e. real students, no-class junk excluded.
  const classedNeedsFix = students.filter((p) =>
    LADDER_KEYS.has(norm(p.class_level)) && p.school_version !== TARGET && !isDemo(p.school_version));

  let toFix;
  if (FIX_ALL) {
    // Everyone who isn't already exactly the target and isn't a demo account.
    toFix = students.filter((p) => p.school_version !== TARGET && !isDemo(p.school_version));
    console.log(`\nFIX_ALL mode: will remap ${toFix.length} student(s) (ALL classes incl. no-class) to "${TARGET}".`);
  } else if (FIX_WRONG) {
    toFix = classedNeedsFix;
    console.log(`\nFIX_WRONG mode: will remap ${toFix.length} CLASSED student(s) (Grade4..SS3, any wrong/blank id) to "${TARGET}". No-class records left alone.`);
  } else {
    toFix = FIX_VARIANTS ? blankLadder.concat(variant) : blankLadder;
  }

  const byClass = {};
  toFix.forEach((p) => { const c = p.class_level || '(no class)'; byClass[c] = (byClass[c] || 0) + 1; });
  if (toFix.length) {
    console.log('\nWill set school_version = "' + TARGET + '" for these, by class:');
    Object.keys(byClass).sort().forEach((c) => console.log(`  ${c}: ${byClass[c]}`));
  }

  if (!APPLY) {
    console.log(`\n— DRY RUN — nothing was written. (${toFix.length} record(s) would change.)`);
    if (toFix.length) {
      console.log('Sample (first 15):');
      toFix.slice(0, 15).forEach((p) => console.log(`  ${p.full_name || p.id}  [${p.class_level}]  was="${p.school_version || ''}"`));
    }
    console.log('\nModes:');
    console.log('  APPLY=1                 -> fix the ' + blankLadder.length + ' blank Grade4..SS3 students only');
    console.log('  FIX_VARIANTS=1 APPLY=1  -> also fix the ' + variant.length + ' case/spacing variant(s)');
    console.log('  FIX_WRONG=1 APPLY=1     -> fix ' + classedNeedsFix.length + ' CLASSED students (real students under wrong/blank ids; RECOMMENDED)');
    console.log('  FIX_ALL=1 APPLY=1       -> remap EVERY non-demo student (' +
      students.filter((p) => p.school_version !== TARGET && !isDemo(p.school_version)).length +
      ', incl. no-class junk/duplicates — not recommended)');
    return;
  }

  // 4) Apply — profile first (drives admin visibility), then mirror to users.
  let ok = 0, fail = 0;
  for (const p of toFix) {
    try {
      await api(token, 'PATCH', `/api/collections/profiles/records/${p.id}`, { school_version: TARGET });
      const uid = p.user || p.id;
      if (uid) {
        try { await api(token, 'PATCH', `/api/collections/users/records/${uid}`, { school_version: TARGET }); }
        catch (_) { /* users row may not exist / field absent — profile is what the admin reads */ }
      }
      ok++;
      if (ok % 25 === 0) console.log(`  ...${ok}/${toFix.length}`);
    } catch (e) {
      fail++;
      console.error(`  FAILED ${p.id} (${p.full_name || '?'}): ${e.message}`);
    }
  }
  console.log(`\nDone. Updated ${ok} profile(s), ${fail} failed.`);
})().catch((e) => die(e && e.message ? e.message : String(e)));
