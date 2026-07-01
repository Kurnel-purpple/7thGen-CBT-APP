/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("yimvumzld545ks8")

  // Idempotent: only add fields the schema doesn't already have.
  // (Some production databases were left in a partial state by an earlier
  // deploy where this migration crashed mid-way; trying to re-add the same
  // fields would error with "duplicate column" and lock the boot loop.)
  const fields = [
    {
      "system": false,
      "id": "rsltexam1",
      "name": "exam_title",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" }
    },
    {
      "system": false,
      "id": "rsltexam2",
      "name": "exam_subject",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" }
    },
    {
      "system": false,
      "id": "rsltexam3",
      "name": "exam_target_class",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "pattern": "" }
    },
    {
      "system": false,
      "id": "rsltexam4",
      "name": "exam_duration",
      "type": "number",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "noDecimal": false }
    },
    {
      "system": false,
      "id": "rsltexam5",
      "name": "exam_has_theory",
      "type": "bool",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {}
    },
    {
      "system": false,
      "id": "rsltexam6",
      "name": "exam_theory_count",
      "type": "number",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": { "min": null, "max": null, "noDecimal": false }
    }
  ]

  let added = 0
  for (const f of fields) {
    if (!collection.schema.getFieldByName(f.name)) {
      collection.schema.addField(new SchemaField(f))
      added++
    }
  }

  if (added === 0) {
    // Schema already has every field — nothing to persist. Treat as success
    // so PocketBase records the migration and stops re-running it.
    return null
  }

  try {
    return dao.saveCollection(collection)
  } catch (e) {
    const msg = String((e && e.message) || e || "")
    // Production databases that were partially migrated may have the columns
    // present at the SQL level even though the schema record doesn't list
    // them. In that case saveCollection raises "duplicate column"; treat
    // that as already-applied so the migration commits and is not retried.
    if (msg.indexOf("duplicate column") !== -1) {
      return null
    }
    throw e
  }
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("yimvumzld545ks8")

  const ids = ["rsltexam1", "rsltexam2", "rsltexam3", "rsltexam4", "rsltexam5", "rsltexam6"]
  for (const id of ids) {
    try { collection.schema.removeField(id) } catch (_) { /* already gone */ }
  }

  return dao.saveCollection(collection)
})
