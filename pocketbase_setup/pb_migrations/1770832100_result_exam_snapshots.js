/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("yimvumzld545ks8")

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rsltexam1",
    "name": "exam_title",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rsltexam2",
    "name": "exam_subject",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rsltexam3",
    "name": "exam_target_class",
    "type": "text",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "pattern": ""
    }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rsltexam4",
    "name": "exam_duration",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "noDecimal": false
    }
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rsltexam5",
    "name": "exam_has_theory",
    "type": "bool",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {}
  }))

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "rsltexam6",
    "name": "exam_theory_count",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "noDecimal": false
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("yimvumzld545ks8")

  collection.schema.removeField("rsltexam1")
  collection.schema.removeField("rsltexam2")
  collection.schema.removeField("rsltexam3")
  collection.schema.removeField("rsltexam4")
  collection.schema.removeField("rsltexam5")
  collection.schema.removeField("rsltexam6")

  return dao.saveCollection(collection)
})
