#!/usr/bin/env node
/*
 * READ-ONLY. Finds likely duplicate student accounts by grouping `profiles`
 * (and cross-checking `users`) on normalised full name. Writes nothing —
 * this is purely to see the scope and decide what to delete later.
 *
 * Node 18+. No install.
 *   $env:PB_ADMIN_EMAIL="you@x.com"; $env:PB_ADMIN_PASSWORD="secret"
 *   node scripts/audit-duplicates.js
 *
 * Options:
 *   MIN=3   only show names with >= 3 records (default 2)
 *   FULL=1  list every record in every duplicate group (default: top 40 groups)
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const MIN = Math.max(2, parseInt(process.env.MIN || '2', 10));
const FULL = process.env.FULL === '1';

const nameKey = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
    return r.token;
  } catch (e1) {
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

(async () => {
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  const token = await authenticate();
  console.log(`Connected to ${PB_URL} (read-only)\n`);

  const profiles = await fetchAll(token, 'profiles', 'role = "student"');

  const groups = new Map();
  for (const p of profiles) {
    const k = nameKey(p.full_name);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }

  const distinctUsers = (g) => new Set(g.map((p) => p.user || p.id)).size;
  const dups = [...groups.values()].filter((g) => g.length >= MIN).sort((a, b) => b.length - a.length);
  const dupRecords = dups.reduce((n, g) => n + g.length, 0);
  const extra = dups.reduce((n, g) => n + (g.length - 1), 0); // records beyond one-per-name

  // Split the mess: extra profiles that share a user (delete profile only) vs
  // extra user accounts sharing a name (delete profile AND user account).
  let extraSameUser = 0, extraAccounts = 0;
  for (const g of dups) { const u = distinctUsers(g); extraSameUser += (g.length - u); extraAccounts += (u - 1); }

  console.log(`Student profiles                 : ${profiles.length}`);
  console.log(`Distinct names                    : ${groups.size}`);
  console.log(`Names with >= ${MIN} records         : ${dups.length}`);
  console.log(`Records in those groups           : ${dupRecords}`);
  console.log(`Extra (removable) duplicate records: ${extra}`);
  console.log(`  ├─ extra PROFILES for same user  : ${extraSameUser}   (delete profile row only — safe)`);
  console.log(`  └─ extra USER ACCOUNTS (same name): ${extraAccounts}   (delete profile + user account)`);

  const show = FULL ? dups : dups.slice(0, 40);
  console.log(`\nTop ${show.length} duplicate groups${FULL ? ' (FULL)' : ' (set FULL=1 for all + every record)'}:`);
  for (const g of show) {
    const u = distinctUsers(g);
    console.log(`\n  ${g[0].full_name}  ×${g.length}  (${u} user id${u > 1 ? 's' : ''}${u === 1 ? ' — profile spam, one account' : ''})`);
    if (FULL) {
      g.sort((a, b) => String(a.created).localeCompare(String(b.created)));
      g.forEach((p) => console.log(
        `      id=${p.id} user=${p.user || '—'} class="${p.class_level || ''}" ` +
        `school="${p.school_version || ''}" created=${(p.created || '').slice(0, 10)}`));
    }
  }
  console.log('\nRead-only — nothing was changed.');
})().catch((e) => die(e && e.message ? e.message : String(e)));
