/// <reference path="../pb_data/types.d.ts" />

/**
 * Gives the landing-page demo a real school instead of a special case.
 *
 * Before: Quick Demo minted `school_version = 'DEMO_<expiryMs>_<sessionId>'` — a unique
 * pseudo-school per visitor, with the expiry smuggled into the string for the cleanup
 * cron to parse. Two problems once school_version becomes the tenancy boundary:
 *   1. The client can no longer set school_version at all, so the demo cannot self-assign.
 *   2. A per-visitor school means demo exams live in a school nobody else can see, so a
 *      demo *student* would find an empty app.
 *
 * After: one reserved school, `GEN7DEMO`, joined the same way every other account joins —
 * by redeeming a code. The code is deliberately public, long-lived and unlimited: the
 * demo school holds nothing but demo content, and school_join.pb.js refuses to let
 * admin/super_admin accounts redeem any code, so it grants nothing worth having.
 *
 * The expiry moves to its own `demo_expiry` field on users, stamped server-side by
 * school_join.pb.js when the demo school is joined, so a visitor cannot extend their own
 * trial by editing a string.
 */

const DEMO_SCHOOL = "GEN7DEMO";
const DEMO_CODE = "GEN7DEMO";

migrate((db) => {
    const dao = new Dao(db);

    const users = dao.findCollectionByNameOrId("users");
    users.schema.addField(new SchemaField({
        "system": false,
        "id": "usr_demoexp0",
        "name": "demo_expiry",
        "type": "date",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": "", "max": "" }
    }));
    dao.saveCollection(users);

    // Seed the demo join code. Far-future expiry rather than a null, because expires_at
    // is required and the join hook compares against it.
    const collection = dao.findCollectionByNameOrId("school_join_codes");
    let existing = null;
    try {
        const rows = dao.findRecordsByFilter("school_join_codes", "code = {:code}", "", 1, 0, { code: DEMO_CODE });
        if (rows.length > 0) existing = rows[0];
    } catch (e) { /* first run */ }

    const rec = existing || new Record(collection);
    rec.set("code", DEMO_CODE);
    rec.set("school_version", DEMO_SCHOOL);
    rec.set("expires_at", "2099-12-31 23:59:59.000Z");
    rec.set("max_uses", 0);
    rec.set("uses", existing ? (existing.getInt("uses") || 0) : 0);
    rec.set("revoked", false);
    rec.set("created_by", "system");
    dao.saveRecord(rec);
}, (db) => {
    const dao = new Dao(db);

    try {
        const rows = dao.findRecordsByFilter("school_join_codes", "code = {:code}", "", 1, 0, { code: DEMO_CODE });
        if (rows.length > 0) dao.deleteRecord(rows[0]);
    } catch (e) { /* nothing to remove */ }

    const users = dao.findCollectionByNameOrId("users");
    users.schema.removeField("usr_demoexp0");
    return dao.saveCollection(users);
});
