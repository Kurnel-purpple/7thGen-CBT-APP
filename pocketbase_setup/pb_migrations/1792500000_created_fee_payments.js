/// <reference path="../pb_data/types.d.ts" />

/**
 * fee_payments — receipt submission and admin confirmation.
 *
 * A parent/student uploads up to 5 photos of a payment receipt with a purpose and
 * caption; an admin confirms or rejects it. This is deliberately NOT a payment
 * gateway — no card data, no bank connection, no money movement. It is a record of
 * a payment made elsewhere plus a human confirmation step.
 *
 * THREE THINGS THIS MIGRATION GETS RIGHT AT BIRTH, because retrofitting them has
 * cost this project twice already (see 1791500300 for exams, 1791500700 for the
 * module collections):
 *
 * 1. TENANCY. school_version is on the row and in every rule from day one. A
 *    fee record leaking across schools is a financial-privacy breach, not just
 *    an embarrassment.
 *
 * 2. STATUS IS A PRIVILEGE BOUNDARY. `status` decides whether a student owes
 *    money. If a student could write it, they would confirm their own school
 *    fees — structurally the same bug as the users.role self-escalation hole.
 *    So: updateRule is admin-only, and pb_hooks/fees_guard.pb.js additionally
 *    forces status="pending" on create and freezes every field except status
 *    and admin_note on update. Rule + hook, because the rule alone cannot stop
 *    an admin-shaped request from rewriting the amount after the fact.
 *
 * 3. RECEIPTS ARE `file`, NOT BASE64. Every other image in this app is a data
 *    URL inside a text column, which is what put 100GB through the pipe in three
 *    days. These are real files: separately served, cacheable, thumbnailable via
 *    ?thumb=, and never dragged along inside a list response.
 *    `protected: true` — a receipt can carry a bank account number, so the file
 *    URL requires a short-lived file token rather than being world-readable to
 *    anyone who gets the link. feesDataService fetches and caches that token.
 *
 * PRECONDITION — verify before deploying:
 *   Staff `users` rows must have school_version populated. These rules compare
 *   against @request.auth.school_version, which reads the USERS record, not
 *   profiles. A blank there matches nothing, which empties the admin queue
 *   rather than degrading it. 1791500050 normalised this; accounts created
 *   since are the risk.
 *
 * DELETE POLICY. An admin can delete anything in their school. A student can
 * delete ONLY their own row and ONLY while it is still pending — a wrong photo
 * should be retractable, but once an admin has ruled on it the record stops
 * being the student's to erase.
 */

const SUPER = '@request.auth.role = "super_admin"';
const SAME_SCHOOL = 'school_version = @request.auth.school_version';
const ADMIN_HERE = '(@request.auth.role = "admin" && ' + SAME_SCHOOL + ')';
const OWN = '(student = @request.auth.id && ' + SAME_SCHOOL + ')';

migrate((db) => {
    const collection = new Collection({
        "id": "feepayments0001",
        "created": "2026-09-20 00:00:00.000Z",
        "updated": "2026-09-20 00:00:00.000Z",
        "name": "fee_payments",
        "type": "base",
        "system": false,
        "schema": [
            {
                "system": false,
                "id": "fpy_student",
                "name": "student",
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
                // Denormalised so the admin queue renders without an expand —
                // same reasoning as homework's created_by_name.
                "system": false,
                "id": "fpy_stud_nm",
                "name": "student_name",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 120, "pattern": "" }
            },
            {
                "system": false,
                "id": "fpy_class00",
                "name": "class_level",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                // Structured purpose alongside the free-text caption. Caption
                // alone becomes an unsearchable pile by week three; this is what
                // makes the queue filterable and a termly summary possible later.
                "system": false,
                "id": "fpy_purpose",
                "name": "purpose",
                "type": "select",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "maxSelect": 1,
                    "values": ["school_fees", "pta", "uniform", "exam_fee", "books", "transport", "other"]
                }
            },
            {
                "system": false,
                "id": "fpy_caption",
                "name": "caption",
                "type": "text",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 500, "pattern": "" }
            },
            {
                // Optional: some parents pay in instalments and cannot state a
                // figure confidently. The receipt image is the source of truth.
                "system": false,
                "id": "fpy_amount0",
                "name": "amount",
                "type": "number",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": 0, "max": null, "noDecimal": false }
            },
            {
                "system": false,
                "id": "fpy_term000",
                "name": "term",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                "system": false,
                "id": "fpy_session",
                "name": "session",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                // MAX 5 receipt images. protected:true — see the header note.
                // thumbs are generated on demand by PocketBase; the queue list
                // uses 400x0 and the lightbox uses the original.
                "system": false,
                "id": "fpy_receipt",
                "name": "receipts",
                "type": "file",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "mimeTypes": ["image/jpeg", "image/png", "image/webp"],
                    "thumbs": ["400x0", "120x120"],
                    "maxSelect": 5,
                    "maxSize": 5242880,
                    "protected": true
                }
            },
            {
                "system": false,
                "id": "fpy_status0",
                "name": "status",
                "type": "select",
                "required": true,
                "presentable": false,
                "unique": false,
                "options": {
                    "maxSelect": 1,
                    "values": ["pending", "confirmed", "rejected"]
                }
            },
            {
                // Why it was rejected, or a confirmation remark ("receipted,
                // balance N12,000"). Shown to the student — this is the half of
                // the loop that stops a blurry photo sitting pending forever.
                "system": false,
                "id": "fpy_adm_note",
                "name": "admin_note",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": 500, "pattern": "" }
            },
            {
                "system": false,
                "id": "fpy_rev_by0",
                "name": "reviewed_by",
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
                "id": "fpy_rev_nm0",
                "name": "reviewed_by_name",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                "system": false,
                "id": "fpy_rev_at0",
                "name": "reviewed_at",
                "type": "date",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": "", "max": "" }
            },
            {
                "system": false,
                "id": "fpy_schver0",
                "name": "school_version",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            },
            {
                "system": false,
                "id": "fpy_clntid0",
                "name": "client_id",
                "type": "text",
                "required": false,
                "presentable": false,
                "unique": false,
                "options": { "min": null, "max": null, "pattern": "" }
            }
        ],
        "indexes": [
            "CREATE INDEX `idx_fee_pay_student` ON `fee_payments` (`student`)",
            "CREATE INDEX `idx_fee_pay_school_status` ON `fee_payments` (`school_version`, `status`)",
            "CREATE INDEX `idx_fee_pay_created` ON `fee_payments` (`created`)"
        ],
        // A student sees only their own rows; an admin sees their whole school.
        // Teachers are deliberately excluded — fees are not their business.
        "listRule": '@request.auth.id != "" && (' + SUPER + ' || ' + ADMIN_HERE + ' || ' + OWN + ')',
        "viewRule": '@request.auth.id != "" && (' + SUPER + ' || ' + ADMIN_HERE + ' || ' + OWN + ')',
        // Any signed-in account may submit. The hook overwrites student,
        // status and school_version with server-resolved values, so there is
        // nothing useful to forge here.
        "createRule": '@request.auth.id != ""',
        // ONLY an admin may review. See header note 2.
        "updateRule": SUPER + ' || ' + ADMIN_HERE,
        "deleteRule": SUPER + ' || ' + ADMIN_HERE + ' || (student = @request.auth.id && ' + SAME_SCHOOL + ' && status = "pending")',
        "options": {}
    });

    return Dao(db).saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("feepayments0001");
    return dao.deleteCollection(collection);
})
