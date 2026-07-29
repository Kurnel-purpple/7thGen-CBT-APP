/// <reference path="../pb_data/types.d.ts" />
// One row per admission candidate — the bridge between a printed access slip
// and the throwaway auth account that actually sits the exam.
//
// Two kinds of row, both created up front by /api/cbt/admission/generate:
//   - NAMED  — full_name filled from the school's paper application forms.
//   - BLANK  — full_name empty; a walk-in types their name at redemption, which
//              writes it once and sets name_locked.
//
// started_at is the anti-bypass token. Only /api/cbt/admission/redeem stamps it,
// server-side. take-exam.html refuses to start without it, so authenticating
// directly with a candidate ID (bypassing the gated redeem endpoint) gains
// nothing — the window/released/device checks can't be skipped.
//
// Admin-only rules: a candidate reads their own record through the redeem and
// exam endpoints, never through the collection API.
migrate((db) => {
  const collection = new Collection({
    "id": "admcandidat0001",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "admission_candidates",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "admc_sessn",
        "name": "session",
        "type": "relation",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "admsessions0001",
          "cascadeDelete": true,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      },
      {
        "system": false,
        "id": "admc_candid",
        "name": "candidate_id",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "admc_user0",
        "name": "user",
        "type": "relation",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "_pb_users_auth_",
          "cascadeDelete": true,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      },
      {
        "system": false,
        "id": "admc_fname",
        "name": "full_name",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "admc_nlock",
        "name": "name_locked",
        "type": "bool",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {}
      },
      {
        "system": false,
        "id": "admc_statu",
        "name": "status",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": ["issued", "started", "submitted", "absent"]
        }
      },
      {
        "system": false,
        "id": "admc_start",
        "name": "started_at",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "admc_devid",
        "name": "device_id",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "admc_decis",
        "name": "decision",
        "type": "select",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": ["undecided", "admitted", "declined"]
        }
      },
      {
        "system": false,
        "id": "admc_schvr",
        "name": "school_version",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_admission_candidates_cid` ON `admission_candidates` (`candidate_id`)",
      "CREATE INDEX `idx_admission_candidates_session` ON `admission_candidates` (`session`)",
      "CREATE INDEX `idx_admission_candidates_user` ON `admission_candidates` (`user`)"
    ],
    "listRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "viewRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "createRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "updateRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "deleteRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("admcandidat0001");
  return dao.deleteCollection(collection);
})
