/// <reference path="../pb_data/types.d.ts" />

/**
 * Adds `proctoring` to exams — the per-exam light-proctoring mode.
 *
 *   ""       treated as "off" (see below)
 *   "off"    no monitoring at all
 *   "warn"   monitor and warn the student, but never auto-submit and never lock
 *   "strict" two strikes -> auto-submit; a confirmed close -> immediate submit,
 *            and in both cases the attempt is locked until a teacher or admin
 *            grants a retake
 *
 * Deliberately a nullable text field rather than a select with a default:
 *
 *   - Blank is the "off" value, so EVERY exam that already exists stays
 *     unproctored without a backfill pass. Nothing that a school is part-way
 *     through sitting changes behaviour under them.
 *   - Older desktop/Android builds in the field submit exam payloads with no
 *     `proctoring` key at all. A required field with a default would reject
 *     those writes; a nullable one accepts them and leaves the exam off, which
 *     is the safe direction to fail.
 *
 * The pattern still rejects a typo'd value, so a bad client cannot store
 * "strickt" and silently end up unproctored.
 */
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("exams");

    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "exm_proctor",
        "name": "proctoring",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "min": null,
            "max": 16,
            "pattern": "^(off|warn|strict)?$"
        }
    }));

    return dao.saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("exams");
    collection.schema.removeField("exm_proctor");
    return dao.saveCollection(collection);
});
