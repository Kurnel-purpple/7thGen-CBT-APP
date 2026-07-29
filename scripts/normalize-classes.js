#!/usr/bin/env node
/*
 * Normalise student class_level to the canonical ladder spelling so classes
 * don't split into separate buckets in the admin (e.g. "JSS 1" -> "JSS1",
 * "ss 1" -> "SS1", "grade 4" -> "Grade 4"). Updates both profiles and users.
 * Classes not on the ladder (e.g. "Primary 5") are left untouched.
 *
 * Node 18+. DRY RUN by default; APPLY=1 to write.
 *   $env:PB_ADMIN_EMAIL=...; $env:PB_ADMIN_PASSWORD=...
 *   node scripts/normalize-classes.js            # dry run
 *   $env:APPLY="1"; node scripts/normalize-classes.js   # write
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const APPLY = process.env.APPLY === '1';

const LADDER = ['Grade 4', 'Grade 5&6', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
const key = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();
const CANON = new Map(LADDER.map((c) => [key(c), c]));
const canonicalOf = (v) => CANON.get(key(v)) || null;
const userOf = (p) => p.user || p.id;
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
  try { return (await api(null, 'POST', '/api/admins/auth-with-password', { identity: EMAIL, password: PASSWORD })).token; }
  catch (e1) {
    const r = await api(null, 'POST', '/api/collections/users/auth-with-password', { identity: EMAIL, password: PASSWORD })
      .catch((e2) => die('Login failed.\n  superuser: ' + e1.message + '\n  app user : ' + e2.message));
    return r.token;
  }
}
async function fetchAll(token, collection) {
  const out = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ page: String(page), perPage: '200', filter: 'role = "student"' });
    const r = await api(token, 'GET', `/api/collections/${collection}/records?` + q.toString());
    out.push(...r.items);
    if (page >= (r.totalPages || 1) || r.items.length === 0) break;
  }
  return out;
}

(async () => {
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  const token = await authenticate();
  console.log(`Connected to ${PB_URL}  |  Mode = ${APPLY ? 'APPLY (writes)' : 'DRY RUN'}\n`);

  const profiles = await fetchAll(token, 'profiles');
  const users = await fetchAll(token, 'users');
  const usersById = new Map(users.map((u) => [u.id, u]));

  const changes = []; // { kind, id, from, to, name }
  const summary = {};
  for (const p of profiles) {
    const canon = canonicalOf(p.class_level);
    if (canon && canon !== p.class_level) {
      changes.push({ kind: 'profile', id: p.id, from: p.class_level, to: canon, name: p.full_name });
      summary[`"${p.class_level}" → "${canon}"`] = (summary[`"${p.class_level}" → "${canon}"`] || 0) + 1;
      const u = usersById.get(userOf(p));
      if (u && canonicalOf(u.class_level) === canon && u.class_level !== canon) {
        changes.push({ kind: 'user', id: u.id, from: u.class_level, to: canon, name: u.full_name });
      }
    }
  }

  const profChanges = changes.filter((c) => c.kind === 'profile');
  console.log(`Student profiles                : ${profiles.length}`);
  console.log(`Profiles with non-canonical class: ${profChanges.length}`);
  console.log(`(Plus ${changes.length - profChanges.length} matching users records.)`);
  if (Object.keys(summary).length) {
    console.log('\nBy change:');
    Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n.toString().padStart(4)}  ${k}`));
  }
  if (profChanges.length) {
    console.log('\nSample (first 15):');
    profChanges.slice(0, 15).forEach((c) => console.log(`  ${c.name}  "${c.from}" → "${c.to}"`));
  }

  if (!APPLY) { console.log('\n— DRY RUN — nothing changed. Add APPLY=1 to write.'); return; }

  let ok = 0, fail = 0;
  for (const c of changes) {
    try { await api(token, 'PATCH', `/api/collections/${c.kind === 'user' ? 'users' : 'profiles'}/records/${c.id}`, { class_level: c.to }); ok++; }
    catch (e) { fail++; console.error(`  FAILED ${c.kind} ${c.id} (${c.name}): ${e.message}`); }
  }
  console.log(`\nDone. Updated ${ok} record(s), ${fail} failed.`);
})().catch((e) => die(e && e.message ? e.message : String(e)));
