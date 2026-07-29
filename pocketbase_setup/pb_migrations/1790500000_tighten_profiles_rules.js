/// <reference path="../pb_data/types.d.ts" />
// Tighten profiles write access.
//
// BEFORE (original schema):
//   updateRule: "@request.auth.id != user"   → any logged-in user could edit
//   deleteRule: "@request.auth.id != user"     ANY OTHER user's profile.
//
// AFTER:
//   - admins / super_admins may update or delete any profile (needed for the
//     user manager and end-of-session class promotion);
//   - a normal user may update their OWN profile, but only if the update does
//     not change their role (blocks self privilege-escalation via profiles);
//   - deletes are admin-only.
//
// listRule / viewRule / createRule are left unchanged (any authenticated user
// can read the roster and create their own profile on first login).
//
// Idempotent: re-running just re-applies the same rule strings.

const PROFILES_ID = "zcs0vt9obnt3yzy";

const NEW_UPDATE_RULE =
  '@request.auth.role = "admin" || @request.auth.role = "super_admin" || ' +
  '(@request.auth.id = user && (@request.data.role:isset = false || @request.data.role = role))';
const NEW_DELETE_RULE =
  '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

const OLD_UPDATE_RULE = "@request.auth.id != user";
const OLD_DELETE_RULE = "@request.auth.id != user";

migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId(PROFILES_ID);
  collection.updateRule = NEW_UPDATE_RULE;
  collection.deleteRule = NEW_DELETE_RULE;
  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId(PROFILES_ID);
  collection.updateRule = OLD_UPDATE_RULE;
  collection.deleteRule = OLD_DELETE_RULE;
  return dao.saveCollection(collection);
});
