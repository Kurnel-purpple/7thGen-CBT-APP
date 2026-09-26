/// <reference path="../pb_data/types.d.ts" />

/**
 * SECOND STEP — do not deploy until 1791500500 has run and the stamping hook is live.
 *
 * Closes the last unscoped collection. Before this, results list/view/update were:
 *   @request.auth.id = student_id || @request.auth.role = "teacher" || = "admin"
 * with no tenancy check at all, so any teacher or admin of any school could read — and
 * update — every result on the platform. Verified against production: a GEN7DEMO demo
 * teacher listed 6,375 results belonging to other tenants.
 *
 * PRECONDITIONS — verify all three before deploying:
 *   1. 1791500500 has run, and its "[results-backfill] still blank after student pass"
 *      line reported 0 (or a number you have consciously accepted — those rows become
 *      invisible to staff, though their own student keeps access).
 *   2. pb_hooks/result_school_stamp.pb.js is deployed, and a fresh submission comes back
 *      with school_version populated. If the rules tighten while new rows are stamped
 *      blank, every newly submitted result disappears from teacher dashboards.
 *   3. Spot-check that `@request.auth.school_version` is populated on the *users* rows of
 *      real teachers and admins — that is the copy these rules read, and a blank value
 *      matches nothing, which would empty their dashboards. 1791500050 normalised this,
 *      but accounts created since then are worth a look.
 *
 * Rolling back is a rule revert — run the down migration, or paste the old rules into
 * the admin UI if results start disappearing.
 *
 * Deliberately preserved:
 *   - `@request.auth.id = student_id` stays first in the read rule, which is what keeps
 *     an applicant able to read their own row (see 1791000300) and what keeps a student
 *     whose result was stamped blank from losing access to it.
 *   - createRule is untouched (`@request.auth.id = student_id`): school_version is
 *     stamped by the hook, so submissions keep working on older desktop/Android builds
 *     still in the field, exactly as exams do.
 */

const SAME_SCHOOL = 'school_version = @request.auth.school_version';
const SUPER = '@request.auth.role = "super_admin"';
const STAFF = '(@request.auth.role = "teacher" || @request.auth.role = "admin")';

const RESULTS_READ =
    '@request.auth.id = student_id' +
    ' || (' + STAFF + ' && ' + SAME_SCHOOL + ')' +
    ' || ' + SUPER;

// Teachers grade theory answers and resolve flags, so they keep update access — but
// only within their own school.
const RESULTS_UPDATE = RESULTS_READ;

const RESULTS_DELETE =
    '(@request.auth.role = "admin" && ' + SAME_SCHOOL + ')' +
    ' || ' + SUPER;

// Previous values, for the down migration.
const OLD_READ =
    '@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"';
const OLD_DELETE = '@request.auth.role = "admin"';

migrate((db) => {
    const dao = new Dao(db);
    const results = dao.findCollectionByNameOrId("results");

    results.listRule = RESULTS_READ;
    results.viewRule = RESULTS_READ;
    results.updateRule = RESULTS_UPDATE;
    results.deleteRule = RESULTS_DELETE;

    return dao.saveCollection(results);
}, (db) => {
    const dao = new Dao(db);
    const results = dao.findCollectionByNameOrId("results");

    results.listRule = OLD_READ;
    results.viewRule = OLD_READ;
    results.updateRule = OLD_READ;
    results.deleteRule = OLD_DELETE;

    return dao.saveCollection(results);
});
