#!/usr/bin/env node
/*
 * Mirror profiles.class_level -> users.class_level for students.
 *
 * WHY: the live exams API rule filters what a student sees by the AUTH
 * (users) record's class_level. Promotions only write profiles (admins may
 * not update other users' records), so promoted students keep getting the
 * OLD class's exams from the server. This aligns the users mirror so the
 * rule matches. Classes are canonicalised ("JSS 1" -> "JSS1") to match how
 * exams store target_class.
 *
 * Node 18+. DRY RUN by default; APPLY=1 to write.
 *   $env:PB_ADMIN_EMAIL=...; $env:PB_ADMIN_PASSWORD=...
 *   node scripts/sync-users-class.js            # dry run
 *   $env:APPLY="1"; node scripts/sync-users-class.js   # write
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const APPLY = process.env.APPLY === '1';

const LADDER = ['Grade 4', 'Grade 5&6', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3', 'Graduated'];
const key = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();
const CANON = new Map(LADDER.map((c) => [key(c), c]));
const canonicalOf = (v) => CANON.get(key(v)) || String(v || '').trim();
const userOf = (p) => p.user || p.id;
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
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
  catch (e1) { die('Superuser login failed: ' + e1.message); }
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

  const changes = [];
  for (const p of profiles) {
    if (isBlank(p.class_level)) continue;
    const u = usersById.get(userOf(p));
    if (!u) continue;
    const want = canonicalOf(p.class_level);
    if (!want || u.class_level === want) continue;
    changes.push({ uid: u.id, name: p.full_name || u.full_name || '?', from: u.class_level || '(blank)', to: want });
  }

  console.log(`Student profiles: ${profiles.length}  |  users out of sync: ${changes.length}\n`);
  const summary = {};
  changes.forEach((c) => { const k = `"${c.from}" → "${c.to}"`; summary[k] = (summary[k] || 0) + 1; });
  Object.entries(summary).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${String(n).padStart(4)}  ${k}`));
  if (changes.length) {
    console.log('\nSample (first 15):');
    changes.slice(0, 15).forEach((c) => console.log(`  ${c.name}: ${c.from} → ${c.to}`));
  }

  if (!APPLY) { console.log('\n— DRY RUN — nothing changed. Add APPLY=1 to write.'); return; }

  let ok = 0, fail = 0;
  for (const c of changes) {
    try { await api(token, 'PATCH', `/api/collections/users/records/${c.uid}`, { class_level: c.to }); ok++; }
    catch (e) { fail++; console.error(`  FAILED ${c.name} (${c.uid}): ${e.message}`); }
  }
  console.log(`\nDone. Updated ${ok} users record(s), ${fail} failed.`);
})().catch((e) => die(e && e.message ? e.message : String(e)));
