#!/usr/bin/env node
/*
 * Resolve duplicate LOGIN accounts (same student name, different user ids).
 *
 * For each name it KEEPS THE NEWEST account and moves every older account's
 * exam results onto it (re-points results.student_id), then deletes the older
 * accounts. A result's term comes from its exam, not its account, so moved
 * results keep their term — April/2nd-term results stay 2nd-term and compile
 * separately from 3rd-term. Same-exam overlaps are harmless (the broadsheet
 * de-dupes at compile time).
 *
 * Node 18+. DRY RUN by default; APPLY=1 to write. You have a backup; read the
 * dry-run summary first.
 *
 *   $env:PB_ADMIN_EMAIL=...; $env:PB_ADMIN_PASSWORD=...
 *   node scripts/merge-accounts.js                   # dry run
 *   $env:APPLY="1"; node scripts/merge-accounts.js   # move results + delete older accounts
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const APPLY = process.env.APPLY === '1';
const TARGET = process.env.TARGET_SCHOOL || 'SEATOSCBT2026';

const nameKey = (v) => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
  catch (e1) {
    const r = await api(null, 'POST', '/api/collections/users/auth-with-password', { identity: EMAIL, password: PASSWORD })
      .catch((e2) => die('Login failed.\n  superuser: ' + e1.message + '\n  app user : ' + e2.message));
    return r.token;
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
async function resultsFor(token, userId) { return fetchAll(token, 'results', `student_id = "${userId}"`); }

function profScore(p) {
  if (!p) return -1;
  let s = 0;
  if (!isBlank(p.class_level)) s += 4;
  if (p.school_version === TARGET) s += 2;
  else if (!isBlank(p.school_version)) s += 1;
  return s;
}

(async () => {
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  const token = await authenticate();
  console.log(`Connected to ${PB_URL}  |  Mode = ${APPLY ? 'APPLY (writes)' : 'DRY RUN'}\n`);

  const profiles = await fetchAll(token, 'profiles', 'role = "student"');
  const users = await fetchAll(token, 'users', 'role = "student"');
  const usersById = new Map(users.map((u) => [u.id, u]));
  const profByUser = new Map();
  for (const p of profiles) { const u = userOf(p); if (!profByUser.has(u)) profByUser.set(u, p); }

  const byName = new Map();
  for (const p of profiles) {
    const k = nameKey(p.full_name); if (!k) continue;
    if (!byName.has(k)) byName.set(k, { name: p.full_name, ids: new Set() });
    byName.get(k).ids.add(userOf(p));
  }
  const multi = [...byName.values()].filter((g) => g.ids.size > 1);

  // Per name: KEEP the newest account; move every older account's results onto
  // it (term travels with each result's exam, so 2nd-term stays 2nd-term), then
  // delete the older accounts.
  const plan = [];
  for (const g of multi) {
    const accts = [];
    for (const uid of g.ids) {
      const rs = await resultsFor(token, uid);
      accts.push({ uid, results: rs, count: rs.length, u: usersById.get(uid) || {}, p: profByUser.get(uid) });
    }
    // Newest first (by users.created). Tiebreak: more results, then richer profile.
    accts.sort((a, b) =>
      String(b.u.created).localeCompare(String(a.u.created)) ||
      (b.count - a.count) || (profScore(b.p) - profScore(a.p)));
    const keeper = accts[0];
    const keeperExams = new Set(keeper.results.map((r) => r.exam_id));
    const losers = accts.slice(1).map((l) => {
      let dup = 0;
      l.results.forEach((r) => { if (keeperExams.has(r.exam_id)) dup++; else keeperExams.add(r.exam_id); });
      return { uid: l.uid, username: l.u.username || '—', created: (l.u.created || '').slice(0, 10), resultIds: l.results.map((r) => r.id), count: l.count, dup };
    });
    plan.push({ name: g.name, keeper, losers });
  }

  let totLosers = 0, totMove = 0, totDup = 0;
  console.log(`Duplicate-account names: ${multi.length}   (keeping the NEWEST account of each)\n`);
  for (const pl of plan) {
    console.log(`${pl.name}`);
    console.log(`   KEEP  ${pl.keeper.u.username || '—'}  (${pl.keeper.uid})  created=${(pl.keeper.u.created || '').slice(0, 10)}  results=${pl.keeper.count}`);
    pl.losers.forEach((l) => {
      totLosers++; totMove += l.resultIds.length; totDup += l.dup;
      console.log(`   move ${String(l.resultIds.length).padStart(3)} result(s) ← ${l.username} (${l.created})  then delete it` + (l.dup ? `   [${l.dup} same-exam overlap → de-duped at compile]` : ''));
    });
    console.log('');
  }
  console.log(`Accounts to delete: ${totLosers}   |   Results to move: ${totMove}   |   Same-exam overlaps: ${totDup}`);
  console.log('(Moved results keep their exam, so their term is unchanged — 2nd-term stays 2nd-term.)');

  if (!APPLY) { console.log('\n— DRY RUN — nothing changed. Add APPLY=1 to execute.'); return; }

  let del = 0, fail = 0, moved = 0;
  for (const pl of plan) {
    for (const l of pl.losers) {
      try {
        for (const rid of l.resultIds) { await api(token, 'PATCH', `/api/collections/results/records/${rid}`, { student_id: pl.keeper.uid }); moved++; }
        await api(token, 'DELETE', `/api/collections/users/records/${l.uid}`); del++;
      } catch (e) { fail++; console.error(`  FAILED ${pl.name} (${l.uid}): ${e.message}  — results already moved: ${l.resultIds.length}`); }
    }
  }
  console.log(`\nDone. Results moved: ${moved}. Older accounts deleted: ${del}. Failed deletes: ${fail}.`);
})().catch((e) => die(e && e.message ? e.message : String(e)));
