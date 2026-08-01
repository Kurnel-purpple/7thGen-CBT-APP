/// <reference path="../pb_data/types.d.ts" />

/**
 * School join codes + locks `school_version` down so only server code can set it.
 *
 * The problem: `school_version` is the tenancy boundary for exams and profiles, but
 * it was self-declared. Anyone could register claiming any school and read that
 * school's active exams (answer keys included). Pre-filling the field from a branded
 * domain fixes wrong IDs but is not a control — `readOnly` is a DOM attribute and the
 * API never sees it.
 *
 * The fix: a school admin generates a short-lived code and gives it to their intake
 * out of band. Registration collects it, and a hook (pb_hooks/school_join.pb.js)
 * validates it server-side and stamps `school_version` on the users + profiles rows.
 * Accounts are usable immediately, so there is no approval queue to jam on enrolment
 * day, and an attacker cannot claim a school whose code they were never told.
 *
 * This relies on admin self-registration already being closed (the `users` create rule
 * rejects privileged roles) — otherwise an attacker would just become an admin and
 * mint their own codes.
 *
 * Codes are never readable by the browser: list/view is restricted to admins of the
 * owning school, and validation happens with the elevated DAO inside the hook.
 */

const CODES_ID = "sjc7k2m9qw4xz1p";

// Admins manage only their own school's codes; super_admin sees everything.
const OWN_SCHOOL =
    '(@request.auth.role = "admin" && school_version = @request.auth.school_version)' +
    ' || @request.auth.role = "super_admin"';

// On create, the row's school must equal the creating admin's school, so an admin
// cannot mint a code that grants access to somebody else's school.
const CREATE_RULE =
    '(@request.auth.role = "admin" && @request.data.school_version = @request.auth.school_version)' +
    ' || @request.auth.role = "super_admin"';

migrate((db) => {
    const dao = new Dao(db);

    const codes = new Collection({
        "id": CODES_ID,
        "name": "school_join_codes",
        "type": "base",
        "system": false,
        "listRule": OWN_SCHOOL,
        "viewRule": OWN_SCHOOL,
        "createRule": CREATE_RULE,
        "updateRule": OWN_SCHOOL,
        "deleteRule": OWN_SCHOOL,
        "schema": [
            {
                "system": false, "id": "sjccode01", "name": "code", "type": "text",
                "required": true, "presentable": true, "unique": true,
                "options": { "min": 8, "max": 32, "pattern": "" }
            },
            {
                "system": false, "id": "sjcschv01", "name": "school_version", "type": "text",
                "required": true, "presentable": true, "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                "system": false, "id": "sjcexp001", "name": "expires_at", "type": "date",
                "required": true, "presentable": false, "unique": false,
                "options": { "min": "", "max": "" }
            },
            {
                // 0 or empty = unlimited uses until expiry.
                "system": false, "id": "sjcmaxu01", "name": "max_uses", "type": "number",
                "required": false, "presentable": false, "unique": false,
                "options": { "min": 0, "max": null, "noDecimal": true }
            },
            {
                "system": false, "id": "sjcuses01", "name": "uses", "type": "number",
                "required": false, "presentable": false, "unique": false,
                "options": { "min": 0, "max": null, "noDecimal": true }
            },
            {
                "system": false, "id": "sjcrevk01", "name": "revoked", "type": "bool",
                "required": false, "presentable": false, "unique": false, "options": {}
            },
            {
                "system": false, "id": "sjccrby01", "name": "created_by", "type": "text",
                "required": false, "presentable": false, "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            }
        ],
        "indexes": [
            "CREATE UNIQUE INDEX idx_sjc_code ON school_join_codes (code)",
            "CREATE INDEX idx_sjc_school ON school_join_codes (school_version)"
        ]
    });

    dao.saveCollection(codes);

    // ---- Make school_version immutable on UPDATE ----
    //
    // Phase 1 (applied by hand in the admin UI) blocked privileged roles on create and
    // role changes on update. This adds the tenancy half for updates, closing the
    // one-line escalation where any signed-in user could PATCH their own record:
    //   pb.collection('users').update(myId, { school_version: 'SEATOSCBT2026' })
    // and land inside another school.
    //
    // Deliberately NOT locking the CREATE rules here — that is a separate, later
    // migration (1791500400). Locking create rejects any registration that sends
    // school_version, which every not-yet-updated desktop/Android build still does, so
    // it would break enrolment on field installs. Update-locking is safe immediately:
    // after the 1791500050 backfill every account already holds the right school, so
    // nobody legitimately needs to change one.
    const users = dao.findCollectionByNameOrId("users");
    users.updateRule =
        'id = @request.auth.id' +
        ' && (@request.data.role:isset = false || @request.data.role = role)' +
        ' && (@request.data.school_version:isset = false || @request.data.school_version = school_version)';
    dao.saveCollection(users);
}, (db) => {
    const dao = new Dao(db);

    try {
        dao.deleteCollection(dao.findCollectionByNameOrId(CODES_ID));
    } catch (e) {
        // already gone
    }

    const users = dao.findCollectionByNameOrId("users");
    users.updateRule = 'id = @request.auth.id && (@request.data.role:isset = false || @request.data.role = role)';
    return dao.saveCollection(users);
});
