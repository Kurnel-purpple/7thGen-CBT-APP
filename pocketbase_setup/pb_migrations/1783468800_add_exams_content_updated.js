/// <reference path="../pb_data/types.d.ts" />

/**
 * Adds `content_updated` to exams — bumped ONLY when the questions payload
 * actually changes (see pb_hooks/exam_content_updated.pb.js).
 *
 * Why: clients cache the heavy questions JSON (with embedded base64 images)
 * in IndexedDB. Validating that cache against the record's `updated` meant
 * every extension grant / status toggle invalidated every machine's cache and
 * forced a multi-MB re-download. Validating against `content_updated` keeps
 * the cache valid until a teacher genuinely edits the questions.
 */
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("exams");

    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "exm_cntupd0",
        "name": "content_updated",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
    }));

    dao.saveCollection(collection);

    // Backfill: existing exams' content is at most as old as their last update
    db.newQuery("UPDATE exams SET content_updated = updated WHERE content_updated = '' OR content_updated IS NULL").execute();
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("exams");
    collection.schema.removeField("exm_cntupd0");
    return dao.saveCollection(collection);
});
