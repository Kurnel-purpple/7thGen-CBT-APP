/// <reference path="../pb_data/types.d.ts" />
// An admission session = one entrance/aptitude exam + one delivery mode + one
// time window + its batch of candidate access codes.
//
// The session (not a class) is the unit exams are assigned to, so a school can
// run two sittings of the same entrance exam (morning/afternoon, or a resit for
// latecomers) without them colliding.
//
// mode:
//   "lab"    — supervised, on school devices. The teacher in the room is the
//              security; codes work whenever the session is open.
//   "remote" — candidate sits it elsewhere. Adds window enforcement + a proctor
//              "released" gate + single-device binding.
//
// Admin-only on every rule: applicants must never be able to read this
// collection. They receive their exam through /api/cbt/admission/exam instead.
migrate((db) => {
  const collection = new Collection({
    "id": "admsessions0001",
    "created": "2026-07-26 00:00:00.000Z",
    "updated": "2026-07-26 00:00:00.000Z",
    "name": "admission_sessions",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "adms_title",
        "name": "title",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "adms_exam0",
        "name": "exam_id",
        "type": "relation",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "z3galr6ey3e0y5w",
          "cascadeDelete": false,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      },
      {
        "system": false,
        "id": "adms_mode0",
        "name": "mode",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "maxSelect": 1, "values": ["lab", "remote"] }
      },
      {
        "system": false,
        "id": "adms_opens",
        "name": "opens_at",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "adms_close",
        "name": "closes_at",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "adms_relsd",
        "name": "released",
        "type": "bool",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {}
      },
      {
        "system": false,
        "id": "adms_statu",
        "name": "status",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "maxSelect": 1, "values": ["draft", "open", "closed"] }
      },
      {
        "system": false,
        "id": "adms_class",
        "name": "entry_class",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "adms_schvr",
        "name": "school_version",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "adms_crtby",
        "name": "created_by",
        "type": "relation",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "_pb_users_auth_",
          "cascadeDelete": false,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      }
    ],
    "indexes": [
      "CREATE INDEX `idx_admission_sessions_school` ON `admission_sessions` (`school_version`)"
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
  const collection = dao.findCollectionByNameOrId("admsessions0001");
  return dao.deleteCollection(collection);
})
