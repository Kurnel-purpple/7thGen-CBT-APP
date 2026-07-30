/// <reference path="../pb_data/types.d.ts" />

/**
 * Adds `school_version` to exams and backfills it from each exam's creator.
 *
 * Why: exams had no tenancy dimension at all. `getExams()` filtered only on
 * status / created_by / target_class, and the collection's list+view rules were
 * `auth.id != "" && auth.role != "applicant" && (status = "active" || created_by = auth.id)`.
 * The effect was that any authenticated user of any school could read any other
 * school's active exams — including the embedded answer keys, since answers live
 * in the questions payload so offline grading can work. Confirmed empirically:
 * a brand-new student in a fresh school version saw four exams belonging to other
 * schools. `1791000300_scope_collections_from_applicants.js` already documented
 * the list-rule half of this as a known open hole.
 *
 * This migration deliberately does NOT tighten the rules. Tightening before every
 * row is populated would hide every existing exam from every student the moment it
 * ran. Order is: add + backfill (here) -> ship the client that writes the field ->
 * tighten rules (later migration).
 */
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("exams");

    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "exm_schoolv0",
        "name": "school_version",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
    }));

    dao.saveCollection(collection);

    // Backfill from the creating teacher's school.
    //
    // `created_by` is usually the users UUID, but migrated rows can hold a username
    // or an email instead — dataService.getExams() compensates for the same thing
    // when it builds its teacher filter, so the backfill has to match all three or
    // legacy exams would end up unscoped and invisible once the rules tighten.
    db.newQuery(
        "UPDATE exams SET school_version = COALESCE((" +
        "  SELECT u.school_version FROM users u" +
        "  WHERE u.id = exams.created_by" +
        "     OR u.username = exams.created_by" +
        "     OR u.email = exams.created_by" +
        "  LIMIT 1" +
        "), '')" +
        " WHERE school_version = '' OR school_version IS NULL"
    ).execute();
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("exams");
    collection.schema.removeField("exm_schoolv0");
    return dao.saveCollection(collection);
});
