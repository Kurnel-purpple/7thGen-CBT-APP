#!/usr/bin/env node
/*
 * READ-ONLY. For students who have more than one LOGIN account (same name,
 * different user ids), show each account's exam-result activity so you can
 * decide which to keep. Writes nothing.
 *
 * "results" count = completed/among-all result rows whose student_id = that
 * account's user id. The account with the results is the one to keep.
 *
 * Node 18+.  $env:PB_ADMIN_EMAIL=...; $env:PB_ADMIN_PASSWORD=...; node scripts/audit-accounts.js
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;

const nameKey = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
async function fetchAll(token, collection, filter) {
  const out = [];
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ page: String(page), perPage: '200', filter });
    const r = await api(token, 'GET', `/api/collections/${collection}/records?` + q.toString());
    out.push(...r.items);
    if (page >= (r.totalPages || 1) || r.items.length === 0) break;
  }
  return out;
}
async function resultCount(token, userId) {
  const q = new URLSearchParams({ page: '1', perPage: '1', filter: `student_id = "${userId}"` });
  const r = await api(token, 'GET', '/api/collections/results/records?' + q.toString());
  return r.totalItems || 0;
}

(async () => {
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  const token = await authenticate();
  console.log(`Connected to ${PB_URL} (read-only)\n`);

  const profiles = await fetchAll(token, 'profiles', 'role = "student"');
  const users = await fetchAll(token, 'users', 'role = "student"');
  const usersById = new Map(users.map((u) => [u.id, u]));

  // names -> set of distinct account (user) ids, from profiles
  const byName = new Map();
  for (const p of profiles) {
    const k = nameKey(p.full_name); if (!k) continue;
    if (!byName.has(k)) byName.set(k, { name: p.full_name, ids: new Set() });
    byName.get(k).ids.add(userOf(p));
  }
  const multi = [...byName.values()].filter((g) => g.ids.size > 1).sort((a, b) => b.ids.size - a.ids.size);

  console.log(`Names with multiple accounts: ${multi.length}\n`);

  let cleanEmpties = 0, conflicts = 0;
  for (const g of multi) {
    const rows = [];
    for (const uid of g.ids) {
      const u = usersById.get(uid) || {};
      const results = await resultCount(token, uid);
      rows.push({ uid, username: u.username || '—', cls: u.class_level || '', results, created: (u.created || '').slice(0, 10) });
    }
    rows.sort((a, b) => b.results - a.results);
    const withResults = rows.filter((r) => r.results > 0).length;
    if (withResults <= 1) cleanEmpties++; else conflicts++;

    const flag = withResults > 1 ? '  ⚠ CONFLICT (more than one has results)' : '';
    console.log(`${g.name}  (${g.ids.size} accounts)${flag}`);
    rows.forEach((r, i) => {
      const keep = i === 0 ? '  <= KEEP (most results)' : (r.results === 0 ? '  (empty — safe to delete)' : '  (has results!)');
      console.log(`   ${r.uid}  user=${r.username}  class="${r.cls}"  results=${r.results}  created=${r.created}${keep}`);
    });
    console.log('');
  }

  console.log('Summary:');
  console.log(`  Clean cases (only one account has results / all empty): ${cleanEmpties}  -> safe to auto-merge`);
  console.log(`  CONFLICTS (2+ accounts have results, need manual care) : ${conflicts}`);
  console.log('\nRead-only — nothing changed.');
})().catch((e) => die(e && e.message ? e.message : String(e)));
