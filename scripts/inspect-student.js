#!/usr/bin/env node
/*
 * Read-only diagnostic. Shows every `profiles` AND `users` record matching a
 * name, so we can see why a student is missing (duplicate records, blank class,
 * class on users-but-not-profile, wrong school_version, etc.). Writes nothing.
 *
 * Usage (PowerShell):
 *   $env:PB_ADMIN_EMAIL="you@x.com"; $env:PB_ADMIN_PASSWORD="secret"
 *   $env:NAME="ayodeji umar"; node scripts/inspect-student.js
 *
 * NAME does a case-insensitive "contains" match. Try a surname or a fragment.
 * You can inspect several at once: NAME="ayodeji|dammatie|student example"
 */
'use strict';

const PB_URL = (process.env.PB_URL || 'https://gen7-cbt-app.fly.dev').replace(/\/+$/, '');
const EMAIL = process.env.PB_ADMIN_EMAIL;
const PASSWORD = process.env.PB_ADMIN_PASSWORD;
const NAME = process.env.NAME || '';

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

function row(r) {
  return [
    'id=' + r.id,
    'user=' + (r.user || '—'),
    'class="' + (r.class_level || '') + '"',
    'school="' + (r.school_version || '') + '"',
    'username=' + (r.username || '—'),
    'created=' + (r.created || '').slice(0, 10),
  ].join('  ');
}

(async () => {
  if (!EMAIL || !PASSWORD) die('Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD');
  if (!NAME) die('Set NAME (e.g. NAME="ayodeji umar")');
  const token = await authenticate();
  console.log(`Connected to ${PB_URL}\nSearching name ~ "${NAME}"\n`);

  // PocketBase `~` = contains (case-insensitive), NOT regex — so split "a|b|c"
  // into an OR of separate contains-matches.
  const parts = NAME.split('|').map((s) => s.trim()).filter(Boolean);
  const filter = parts.map((p) => `full_name ~ "${p.replace(/"/g, '\\"')}"`).join(' || ');

  const profiles = await fetchAll(token, 'profiles', filter);
  const users = await fetchAll(token, 'users', filter);

  console.log(`profiles (${profiles.length}):`);
  profiles.forEach((p) => console.log('  [' + (p.full_name || '?') + ']  ' + row(p)));
  console.log(`\nusers (${users.length}):`);
  users.forEach((u) => console.log('  [' + (u.full_name || '?') + ']  ' + row(u)));

  // Cross-reference: for each user, does its profile carry the class?
  console.log('\nCross-check (does the profile have the class the user record has?):');
  users.forEach((u) => {
    const prof = profiles.find((p) => (p.user || p.id) === u.id || p.id === u.id);
    const note = !prof ? 'NO PROFILE RECORD'
      : (prof.class_level ? 'profile has class' : (u.class_level ? 'PROFILE BLANK but users.class="' + u.class_level + '" (recoverable)' : 'both blank'));
    console.log('  ' + (u.full_name || '?') + '  users.class="' + (u.class_level || '') + '"  ->  ' + note);
  });
})().catch((e) => die(e && e.message ? e.message : String(e)));
