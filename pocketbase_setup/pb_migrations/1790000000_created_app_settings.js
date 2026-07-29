/// <reference path="../pb_data/types.d.ts" />
// Generic per-school key/value settings store. First consumer is the term
// calendar (key = "term_calendar", value = { session, terms:[{term,start,end}] })
// which lets an admin configure exact term boundary dates; the client falls
// back to a month-based rule (Utils.getCurrentTerm) when no record exists.
migrate((db) => {
  const collection = new Collection({
    "id": "appsettings0001",
    "created": "2026-07-23 00:00:00.000Z",
    "updated": "2026-07-23 00:00:00.000Z",
    "name": "app_settings",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "aps_key0000",
        "name": "key",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "aps_value00",
        "name": "value",
        "type": "json",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "maxSize": 2000000 }
      },
      {
        "system": false,
        "id": "aps_schver0",
        "name": "school_version",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_app_settings_scope_key` ON `app_settings` (`school_version`, `key`)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "viewRule": "@request.auth.id != \"\"",
    "createRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "updateRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "deleteRule": "@request.auth.role = \"admin\" || @request.auth.role = \"super_admin\"",
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("appsettings0001");
  return dao.deleteCollection(collection);
})
