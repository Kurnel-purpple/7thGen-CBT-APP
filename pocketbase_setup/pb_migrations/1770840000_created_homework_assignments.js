/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "hwasgnmnt000001",
    "created": "2026-04-30 00:00:00.000Z",
    "updated": "2026-04-30 00:00:00.000Z",
    "name": "homework_assignments",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "hwa_title00",
        "name": "title",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hwa_subj000",
        "name": "subject",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hwa_targt00",
        "name": "target_class",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hwa_due0000",
        "name": "due_date",
        "type": "date",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "hwa_pts0000",
        "name": "points",
        "type": "number",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "noDecimal": false }
      },
      {
        "system": false,
        "id": "hwa_inst000",
        "name": "instructions",
        "type": "editor",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "convertUrls": false }
      },
      {
        "system": false,
        "id": "hwa_status0",
        "name": "status",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": ["draft", "published", "archived"]
        }
      },
      {
        "system": false,
        "id": "hwa_creby00",
        "name": "created_by",
        "type": "relation",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "_pb_users_auth_",
          "cascadeDelete": false,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      },
      {
        "system": false,
        "id": "hwa_creby_n",
        "name": "created_by_name",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hwa_schver0",
        "name": "school_version",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hwa_clntid0",
        "name": "client_id",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX `idx_hw_assign_target` ON `homework_assignments` (`target_class`)",
      "CREATE INDEX `idx_hw_assign_creator` ON `homework_assignments` (`created_by`)",
      "CREATE INDEX `idx_hw_assign_school` ON `homework_assignments` (`school_version`)"
    ],
    "listRule": "@request.auth.id != \"\" && (status = \"published\" || created_by = @request.auth.id || @request.auth.role = \"admin\")",
    "viewRule": "@request.auth.id != \"\" && (status = \"published\" || created_by = @request.auth.id || @request.auth.role = \"admin\")",
    "createRule": "@request.auth.id != \"\" && (@request.auth.role = \"teacher\" || @request.auth.role = \"admin\")",
    "updateRule": "@request.auth.id = created_by || @request.auth.role = \"admin\"",
    "deleteRule": "@request.auth.id = created_by || @request.auth.role = \"admin\"",
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("hwasgnmnt000001");
  return dao.deleteCollection(collection);
})
