/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const collection = new Collection({
    "id": "hwsubmiss000001",
    "created": "2026-04-30 00:00:00.000Z",
    "updated": "2026-04-30 00:00:00.000Z",
    "name": "homework_submissions",
    "type": "base",
    "system": false,
    "schema": [
      {
        "system": false,
        "id": "hws_aid0000",
        "name": "assignment_id",
        "type": "relation",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "collectionId": "hwasgnmnt000001",
          "cascadeDelete": true,
          "minSelect": null,
          "maxSelect": 1,
          "displayFields": null
        }
      },
      {
        "system": false,
        "id": "hws_sid0000",
        "name": "student_id",
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
        "id": "hws_sname00",
        "name": "student_name",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hws_class00",
        "name": "class_level",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hws_cont000",
        "name": "content",
        "type": "text",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hws_status0",
        "name": "status",
        "type": "select",
        "required": true,
        "presentable": false,
        "unique": false,
        "options": {
          "maxSelect": 1,
          "values": ["submitted", "graded", "returned"]
        }
      },
      {
        "system": false,
        "id": "hws_subat00",
        "name": "submitted_at",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "hws_score00",
        "name": "score",
        "type": "number",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "noDecimal": false }
      },
      {
        "system": false,
        "id": "hws_fdbk000",
        "name": "feedback",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hws_gby0000",
        "name": "graded_by",
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
      },
      {
        "system": false,
        "id": "hws_gat0000",
        "name": "graded_at",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
      },
      {
        "system": false,
        "id": "hws_schver0",
        "name": "school_version",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      },
      {
        "system": false,
        "id": "hws_clntid0",
        "name": "client_id",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
      }
    ],
    "indexes": [
      "CREATE INDEX `idx_hw_sub_assign` ON `homework_submissions` (`assignment_id`)",
      "CREATE INDEX `idx_hw_sub_student` ON `homework_submissions` (`student_id`)",
      "CREATE UNIQUE INDEX `idx_hw_sub_unique` ON `homework_submissions` (`assignment_id`, `student_id`)"
    ],
    "listRule": "@request.auth.id != \"\" && (student_id = @request.auth.id || @request.auth.role = \"teacher\" || @request.auth.role = \"admin\")",
    "viewRule": "@request.auth.id != \"\" && (student_id = @request.auth.id || @request.auth.role = \"teacher\" || @request.auth.role = \"admin\")",
    "createRule": "@request.auth.id = student_id",
    "updateRule": "@request.auth.id = student_id || @request.auth.role = \"teacher\" || @request.auth.role = \"admin\"",
    "deleteRule": "@request.auth.id = student_id || @request.auth.role = \"admin\"",
    "options": {}
  });

  return Dao(db).saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("hwsubmiss000001");
  return dao.deleteCollection(collection);
})
