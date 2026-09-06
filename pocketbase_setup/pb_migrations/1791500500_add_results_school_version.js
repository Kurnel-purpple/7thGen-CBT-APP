/// <reference path="../pb_data/types.d.ts" />

/**
 * Adds `school_version` to results and backfills it.
 *
 * Why: results is the last collection with no tenancy dimension at all. Its rules have
 * never changed since the collection was created:
 *   list/view: @request.auth.id = student_id || role = "teacher" || role = "admin"
 * so ANY teacher or admin of ANY school can read EVERY result on the platform.
 * Confirmed empirically: a demo teacher in GEN7DEMO listed 6,375 results spanning
 * SS1, SS2, JSS1, JSS2, "Grade 4" and "Grade 5&6" — classes that belong to other
 * tenants entirely, covering 101 distinct students in the first 200 rows alone.
 *
 * This is the same hole 1791500000 + 1791500300 closed for exams; results was simply
 * never included. 1791000300 deliberately left results alone so an applicant could
 * still read their own row, and that access is preserved here (`auth.id = student_id`).
 *
 * It is also the direct cause of the dashboard instability: because the collection is
 * unscoped AND the teacher dashboard sends no filter, every dashboard load paginates
 * all 6,375 rows through a 256MB node.
 *
 * Backfill order matters — the exam is the authoritative source, since a result always
 * belongs to exactly one exam and exams were scoped correctly by 1791500050. The
 * student's own school is only a fallback for rows whose exam has since been deleted.
 *
 * This migration deliberately does NOT tighten the rules — see
 * pb_migrations_pending/1791500600_scope_results.js. Tightening before the stamping
 * hook is live would make every newly submitted result invisible to teachers.
 */
migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("results");

    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "res_schoolv0",
        "name": "school_version",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
    }));

    dao.saveCollection(collection);

    function count(sql) {
        const row = new DynamicModel({ "c": 0 });
        db.newQuery(sql).one(row);
        return row.c;
    }

    console.log("[results-backfill] total rows:", count("SELECT COUNT(*) AS c FROM results"));

    // 1. Authoritative source: the exam the result belongs to.
    db.newQuery(
        "UPDATE results SET school_version = COALESCE((" +
        "  SELECT e.school_version FROM exams e WHERE e.id = results.exam_id LIMIT 1" +
        "), '')" +
        " WHERE COALESCE(school_version,'') = ''"
    ).execute();

    console.log("[results-backfill] still blank after exam pass:",
        count("SELECT COUNT(*) AS c FROM results WHERE COALESCE(school_version,'') = ''"));

    // 2. Fallback for orphans (exam deleted, or an exam that is itself unscoped):
    //    the student's own school.
    db.newQuery(
        "UPDATE results SET school_version = COALESCE((" +
        "  SELECT u.school_version FROM users u WHERE u.id = results.student_id LIMIT 1" +
        "), '')" +
        " WHERE COALESCE(school_version,'') = ''"
    ).execute();

    console.log("[results-backfill] still blank after student pass:",
        count("SELECT COUNT(*) AS c FROM results WHERE COALESCE(school_version,'') = ''"));

    // Per-school tallies, so the split can be sanity-checked before the rules are
    // tightened in 1791500600. `.all()` needs an arrayOf(), not a bare DynamicModel.
    const rows = arrayOf(new DynamicModel({ "school_version": "", "c": 0 }));
    db.newQuery(
        "SELECT COALESCE(school_version,'') AS school_version, COUNT(*) AS c" +
        " FROM results GROUP BY 1 ORDER BY c DESC"
    ).all(rows);
    for (const r of rows) {
        console.log("[results-backfill]   " + (r.school_version || "(blank)") + ": " + r.c);
    }
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("results");
    collection.schema.removeField("res_schoolv0");
    return dao.saveCollection(collection);
});
