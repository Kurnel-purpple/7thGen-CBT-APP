/// <reference path="../pb_data/types.d.ts" />

/**
 * Two changes to app_settings, both needed before school branding can live here.
 *
 * 1. TENANCY — app_settings was missed by 1791500700 and had no school check:
 *      listRule/viewRule: @request.auth.id != ""
 *      create/update/delete: role = "admin" || role = "super_admin"
 *    The client filters by school_version in dataService._appSettingsFilter, but a
 *    filter is only the query — the rules let any authenticated user LIST every
 *    school's settings, and any school's admin UPDATE them. That is not cosmetic:
 *    "report_card_template" holds the grading scale that decides every grade, and
 *    "school_theme" (added below) would let one school reskin another's app.
 *
 *    Same shape as the exams/profiles rules from 1791500300. Reads stay open to any
 *    signed-in member of the school because students need the term calendar and the
 *    theme; writes stay admin-only, now confined to their own school.
 *
 * 2. LOGO — a `file` field, not a base64 string in `value`. The report-card template
 *    stores its logo as a data: URI inside the JSON blob, which is tolerable there
 *    (fetched rarely) but not for an app-wide theme read on every page load by every
 *    user. See the note at the top of src/core/shared/imageUpload.js.
 *
 * Safe to run against live data: adding an optional field touches no existing rows,
 * and every caller already scopes its queries by school_version, so correct
 * behaviour does not change — only the rules that were failing to enforce it.
 */

const SAME_SCHOOL = 'school_version = @request.auth.school_version';
const SUPER = '@request.auth.role = "super_admin"';

const READ =
    '@request.auth.id != ""' +
    ' && (' + SAME_SCHOOL + ' || ' + SUPER + ')';

const WRITE =
    '(@request.auth.role = "admin" && ' + SAME_SCHOOL + ')' +
    ' || ' + SUPER;

// Previous values, for the down migration.
const OLD_READ = '@request.auth.id != ""';
const OLD_WRITE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

migrate((db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("app_settings");

    collection.schema.addField(new SchemaField({
        "system": false,
        "id": "aps_logo000",
        "name": "logo",
        "type": "file",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": {
            "maxSelect": 1,
            "maxSize": 2097152,
            "mimeTypes": [
                "image/jpeg",
                "image/png",
                "image/webp",
                "image/svg+xml"
            ],
            "thumbs": ["64x64", "200x0"],
            "protected": false
        }
    }));

    collection.listRule = READ;
    collection.viewRule = READ;
    collection.createRule = WRITE;
    collection.updateRule = WRITE;
    collection.deleteRule = WRITE;

    return dao.saveCollection(collection);
}, (db) => {
    const dao = new Dao(db);
    const collection = dao.findCollectionByNameOrId("app_settings");

    collection.schema.removeField("aps_logo000");

    collection.listRule = OLD_READ;
    collection.viewRule = OLD_READ;
    collection.createRule = OLD_WRITE;
    collection.updateRule = OLD_WRITE;
    collection.deleteRule = OLD_WRITE;

    return dao.saveCollection(collection);
});
