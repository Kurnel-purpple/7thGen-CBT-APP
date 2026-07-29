#!/usr/bin/env node
/*
 * De-duplicate "profile spam": one user account that has many `profiles` rows.
 * Groups profiles by their user id and, for any user with more than one, KEEPS
 * the single best row and DELETES the rest. Only the profiles collection is
 * touched — user/login accounts are never deleted.
 *
 * "Best" row, in order: the canonical row whose id == user id, then one with a
 * class, then one on the target School ID, then the newest.
 *
 * It does NOT merge duplicate ACCOUNTS (same name, different user ids) — those
 * are listed at the end for you to handle by hand.
 *
 * Node 18+. DRY RUN by default; add APPLY=1 to delete. This is irreversible —
 * read the dry-run summary first.
 *
 *   $env:PB_ADMIN_EMAIL="you@x.com"; $env:PB_ADMIN_PASSWORD="secret"
 *   node scripts/dedupe-profiles.js            # dry run
 *   $env:APPLY="1"; node scripts/dedupe-profiles.js   # delete
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const TARGET = process.env.TARGET_SCHOOL || 'SEATOSCBT2026';
const APPLY = process.env.APPLY === '1';

const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
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
  try {
    const r = await api(null, 'POST', '/api/admins/auth-with-password', { identity: EMAIL, password: PASSWORD });
    return { token: r.token, mode: 'superuser' };
  } catch (e1) {
    const r = await api(null, 'POST', '/api/collections/users/auth-with-password', { identity: EMAIL, password: PASSWORD })
      .catch((e2) => die('Login failed.\n  superuser: ' + e1.message + '\n  app user : ' + e2.message));
    const role = r.record && r.record.role;
    if (role !== 'admin' && role !== 'super_admin') die(`Role is "${role}", not admin.`);
    return { token: r.token, mode: `app admin (${role})` };
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

function score(p) {
  let s = 0;
  if (p.id === userOf(p)) s += 100;                 // canonical 1:1 profile (id == user id)
  if (!isBlank(p.class_level)) s += 8;              // has a class
  if (p.school_version === TARGET) s += 4;          // on the target School ID
  else if (!isBlank(p.school_version)) s += 2;      // has some School ID
  return s;
}

(async () => {
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  const { token, mode } = await authenticate();
  console.log(`Connected to ${PB_URL} as ${mode}  |  Mode = ${APPLY ? 'APPLY (DELETES rows)' : 'DRY RUN'}\n`);

  const profiles = await fetchAll(token, 'profiles', 'role = "student"');

  // Group by user id -> profile-spam
  const byUser = new Map();
  for (const p of profiles) {
    const u = userOf(p);
    if (!byUser.has(u)) byUser.set(u, []);
    byUser.get(u).push(p);
  }

  const toDelete = [];
  let usersWithSpam = 0;
  for (const [, rows] of byUser) {
    if (rows.length < 2) continue;
    usersWithSpam++;
    rows.sort((a, b) => (score(b) - score(a)) || String(b.created).localeCompare(String(a.created)));
    // rows[0] = keep; rest = delete
    for (let i = 1; i < rows.length; i++) toDelete.push(rows[i]);
  }

  // Account spam: same name across different user ids (informational only)
  const byName = new Map();
  for (const p of profiles) {
    const k = nameKey(p.full_name); if (!k) continue;
    if (!byName.has(k)) byName.set(k, new Set());
    byName.get(k).add(userOf(p));
  }
  const accountSpam = [...byName.entries()].filter(([, s]) => s.size > 1);

  console.log(`Student profiles                    : ${profiles.length}`);
  console.log(`Distinct user accounts              : ${byUser.size}`);
  console.log(`Accounts with duplicate profiles    : ${usersWithSpam}`);
  console.log(`Profile rows to DELETE (keep 1 each) : ${toDelete.length}`);
  console.log(`Profiles remaining after cleanup     : ${profiles.length - toDelete.length}`);
  console.log(`\nSeparate issue — names with multiple ACCOUNTS (NOT touched here): ${accountSpam.length}`);
  accountSpam.slice(0, 40).forEach(([k, s]) => {
    const disp = (profiles.find((p) => nameKey(p.full_name) === k) || {}).full_name || k;
    console.log(`  ${disp}  — ${s.size} accounts: ${[...s].join(', ')}`);
  });

  if (!APPLY) {
    console.log('\n— DRY RUN — nothing deleted. Re-run with APPLY=1 to delete the ' + toDelete.length + ' duplicate profile rows.');
    return;
  }

  let ok = 0, fail = 0;
  for (const p of toDelete) {
    try {
      await api(token, 'DELETE', `/api/collections/profiles/records/${p.id}`);
      ok++; if (ok % 50 === 0) console.log(`  ...deleted ${ok}/${toDelete.length}`);
    } catch (e) { fail++; console.error(`  FAILED delete ${p.id} (${p.full_name || '?'}): ${e.message}`); }
  }
  console.log(`\nDone. Deleted ${ok} duplicate profile row(s), ${fail} failed.`);
})().catch((e) => die(e && e.message ? e.message : String(e)));
