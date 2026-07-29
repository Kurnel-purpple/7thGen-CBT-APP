#!/usr/bin/env node
/*
 * Recover students whose class is on their `users` record but missing from the
 * `profiles` record the admin portal reads. For every student profile:
 *   - if profile.class_level is blank but the linked users.class_level is set,
 *     copy the class onto the profile; and
 *   - if the student then has a class and isn't already on the target School ID
 *     (and isn't a demo account), set profile.school_version = TARGET
 *     (mirrored onto the users record too).
 * Students with NO class on either record are left untouched (junk/incomplete).
 *
 * Node 18+. No install. Dry run by default; add APPLY=1 to write.
 *
 *   $env:PB_ADMIN_EMAIL="you@x.com"; $env:PB_ADMIN_PASSWORD="secret"
 *   node scripts/recover-students.js            # dry run
 *   $env:APPLY="1"; node scripts/recover-students.js   # write
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const TARGET = process.env.TARGET_SCHOOL || 'SEATOSCBT2026';
const APPLY = process.env.APPLY === '1';

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
const isDemo = (v) => /^DEMO_/i.test(String(v || ''));
function die(m) { console.error('\nERROR: ' + m); process.exit(1); }

async function api(token, method, path, body) {
  const res = await fetch(PB_URL + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: token } : {}),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${method} ${path} — ${json.message || text}`);
  return json;
}
async function authenticate() {
  try {
    const r = await api(null, 'POST', '/api/admins/auth-with-password', { identity: EMAIL, password: PASSWORD });
    return { token: r.token, mode: 'superuser' };
  } catch (e1) {
    const r = await api(null, 'POST', '/api/collections/users/auth-with-password', { identity: EMAIL, password: PASSWORD })
      .catch((e2) => die('Login failed.\n  superuser: ' + e1.message + '\n  app user : ' + e2.message));
    const role = r.record && r.record.role;
    if (role !== 'admin' && role !== 'super_admin') die(`Signed in as ${EMAIL} but role is "${role}", not admin.`);
    return { token: r.token, mode: `app admin (${role})` };
  }
}
async function fetchAll(token, collection, filter) {
  const out = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ page: String(page), perPage: '200' });
    if (filter) q.set('filter', filter);
    const r = await api(token, 'GET', `/api/collections/${collection}/records?` + q.toString());
    out.push(...r.items);
    if (page >= (r.totalPages || 1) || r.items.length === 0) break;
  }
  return out;
}

(async () => {
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  const { token, mode } = await authenticate();
  console.log(`Connected to ${PB_URL} as ${mode}`);
  console.log(`Target school_version = "${TARGET}"  |  Mode = ${APPLY ? 'APPLY (writes)' : 'DRY RUN'}\n`);

  const profiles = await fetchAll(token, 'profiles', 'role = "student"');
  const users = await fetchAll(token, 'users', 'role = "student"');
  const usersById = new Map(users.map((u) => [u.id, u]));

  const plan = []; // { p, setClass, setSchool }
  let noClassAnywhere = 0, alreadyFine = 0;

  for (const p of profiles) {
    const u = usersById.get(p.user || p.id);
    const setClass = (isBlank(p.class_level) && u && !isBlank(u.class_level)) ? u.class_level : null;
    const effectiveClass = !isBlank(p.class_level) ? p.class_level : (setClass || '');
    const setSchool = (!isBlank(effectiveClass) && p.school_version !== TARGET && !isDemo(p.school_version)) ? TARGET : null;

    if (isBlank(effectiveClass) && !isDemo(p.school_version)) { noClassAnywhere++; continue; }
    if (!setClass && !setSchool) { alreadyFine++; continue; }
    plan.push({ p, setClass, setSchool });
  }

  const recClass = plan.filter((x) => x.setClass).length;
  const recSchool = plan.filter((x) => x.setSchool).length;
  console.log(`Student profiles                 : ${profiles.length}`);
  console.log(`Already fine / demo              : ${alreadyFine}`);
  console.log(`No class on profile OR users     : ${noClassAnywhere}  (left alone — assign a class or clean up)`);
  console.log(`Will recover class (users→profile): ${recClass}`);
  console.log(`Will set school_version=${TARGET} : ${recSchool}`);
  console.log(`Total records to update          : ${plan.length}`);

  if (plan.length) {
    console.log('\nSample (first 15):');
    plan.slice(0, 15).forEach(({ p, setClass, setSchool }) => {
      const bits = [];
      if (setClass) bits.push(`class ""→"${setClass}"`);
      if (setSchool) bits.push(`school "${p.school_version || ''}"→"${setSchool}"`);
      console.log(`  ${p.full_name || p.id}  ${bits.join(', ')}`);
    });
  }

  if (!APPLY) { console.log('\n— DRY RUN — nothing written. Re-run with APPLY=1 to apply.'); return; }

  let ok = 0, fail = 0;
  for (const { p, setClass, setSchool } of plan) {
    const body = {};
    if (setClass) body.class_level = setClass;
    if (setSchool) body.school_version = setSchool;
    try {
      await api(token, 'PATCH', `/api/collections/profiles/records/${p.id}`, body);
      if (setSchool) {
        const uid = p.user || p.id;
        try { await api(token, 'PATCH', `/api/collections/users/records/${uid}`, { school_version: setSchool }); } catch (_) {}
      }
      ok++; if (ok % 25 === 0) console.log(`  ...${ok}/${plan.length}`);
    } catch (e) { fail++; console.error(`  FAILED ${p.id} (${p.full_name || '?'}): ${e.message}`); }
  }
  console.log(`\nDone. Updated ${ok} profile(s), ${fail} failed.`);
})().catch((e) => die(e && e.message ? e.message : String(e)));
