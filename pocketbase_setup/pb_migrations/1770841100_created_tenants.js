/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "tenants00000001",
    "created": "2026-04-30 00:00:00.000Z",
    "updated": "2026-04-30 00:00:00.000Z",
    "name": "tenants",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "tnt_schver0",
        "name": "school_version",
        "type": "text",
        "required": true,
        "presentable": true,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "tnt_name000",
        "name": "name",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "tnt_clntid0",
        "name": "client_id",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "tnt_plan000",
        "name": "plan",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": ["trial", "basic", "pro", "enterprise", "custom"]
        }
      },
      {
        "system": false,
        "id": "tnt_status0",
        "name": "status",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": ["trial", "active", "suspended", "expired"]
        }
      },
      {
        "system": false,
        "id": "tnt_mods000",
        "name": "modules_enabled",
        "type": "json",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "maxSize": 200000 }
      },
      {
        "system": false,
        "id": "tnt_exp0000",
        "name": "plan_expires_at",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "tnt_contact",
        "name": "contact_email",
        "type": "email",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "exceptDomains": null, "onlyDomains": null }
      },
      {
        "system": false,
        "id": "tnt_notes00",
        "name": "notes",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX `idx_tenants_school_version` ON `tenants` (`school_version`)"
    ],
    // listRule / viewRule:
    //   - super_admins see every tenant
    //   - everyone else sees only their own tenant (matched by school_version)
    //     so the frontend can fetch its own modules at boot
    "listRule": "@request.auth.id != \"\" && (@request.auth.role = \"super_admin\" || school_version = @request.auth.school_version)",
    "viewRule": "@request.auth.id != \"\" && (@request.auth.role = \"super_admin\" || school_version = @request.auth.school_version)",
    "createRule": "@request.auth.role = \"super_admin\"",
    "updateRule": "@request.auth.role = \"super_admin\"",
    "deleteRule": "@request.auth.role = \"super_admin\"",
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("tenants00000001");
  return dao.deleteCollection(collection);
})
