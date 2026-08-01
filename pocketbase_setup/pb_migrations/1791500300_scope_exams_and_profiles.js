/// <reference path="../pb_data/types.d.ts" />

/**
 * Scopes exams and profiles to the caller's school.
 *
 * BEFORE — exams list/view:
 *   @request.auth.id != "" && @request.auth.role != "applicant"
 *     && (status = "active" || created_by = @request.auth.id)
 * i.e. any authenticated non-applicant could read ANY school's active exams, including
 * the embedded answer keys (answers live in the questions payload so offline grading
 * works). Confirmed empirically: a student in DEMOCBT2026 listed four SEATOS exams.
 * exams update/delete were worse — `@request.auth.role = "admin"` with no tenancy
 * check let any school's admin modify or delete every exam on the platform.
 *
 * profiles list/view were unscoped too, exposing every user's name, class and school
 * across all tenants to any authenticated user.
 *
 * Safe to run only after 1791500050 populated school_version on users, profiles and
 * exams — these rules compare against @request.auth.school_version, which is the users
 * copy, and a blank value matches nothing. Verified before deploying: 0 blank users,
 * 0 blank profiles, 0 unscoped exams, 314 exams on SEATOSCBT2026.
 *
 * super_admin keeps cross-school access throughout — it is the platform-level role that
 * manages tenants and needs to see all of them. The `applicant` exclusion from
 * 1791000300 is preserved.
 *
 * NOTE: this does not by itself stop someone registering while *claiming* a school they
 * do not belong to — school_version is still client-declared at signup. That closes
 * with 1791500100 (join codes) + pb_hooks/school_join.pb.js. This migration closes the
 * leak between accounts that already exist and makes the boundary real.
 */

const SAME_SCHOOL = 'school_version = @request.auth.school_version';
const SUPER = '@request.auth.role = "super_admin"';

const EXAMS_READ =
    '@request.auth.id != "" && @request.auth.role != "applicant"' +
    ' && (status = "active" || created_by = @request.auth.id)' +
    ' && (' + SAME_SCHOOL + ' || ' + SUPER + ')';

// Teachers keep their own exams; admins are confined to their own school.
const EXAMS_WRITE =
    '@request.auth.id = created_by' +
    ' || (@request.auth.role = "admin" && ' + SAME_SCHOOL + ')' +
    ' || ' + SUPER;

const PROFILES_READ =
    '@request.auth.id != "" && @request.auth.role != "applicant"' +
    ' && (' + SAME_SCHOOL + ' || ' + SUPER + ')';

const PROFILES_UPDATE =
    '(@request.auth.role = "admin" && ' + SAME_SCHOOL + ')' +
    ' || ' + SUPER +
    ' || (@request.auth.id = user && (@request.data.role:isset = false || @request.data.role = role))';

const PROFILES_DELETE =
    '(@request.auth.role = "admin" && ' + SAME_SCHOOL + ')' + ' || ' + SUPER;

// Previous values, for the down migration.
const OLD_EXAMS_READ =
    '@request.auth.id != "" && @request.auth.role != "applicant" && (status = "active" || created_by = @request.auth.id)';
const OLD_EXAMS_WRITE = '@request.auth.id = created_by || @request.auth.role = "admin"';
const OLD_PROFILES_READ = '@request.auth.id != "" && @request.auth.role != "applicant"';
const OLD_PROFILES_UPDATE =
    '@request.auth.role = "admin" || @request.auth.role = "super_admin" || ' +
    '(@request.auth.id = user && (@request.data.role:isset = false || @request.data.role = role))';
const OLD_PROFILES_DELETE = '@request.auth.role = "admin" || @request.auth.role = "super_admin"';

migrate((db) => {
    const dao = new Dao(db);

    const exams = dao.findCollectionByNameOrId("exams");
    exams.listRule = EXAMS_READ;
    exams.viewRule = EXAMS_READ;
    exams.updateRule = EXAMS_WRITE;
    exams.deleteRule = EXAMS_WRITE;
    // createRule is intentionally left as-is (`role = "teacher"`): school_version is
    // stamped by pb_hooks/exam_school_stamp.pb.js instead, so exam creation keeps
    // working on older desktop/Android builds still in the field.
    dao.saveCollection(exams);

    const profiles = dao.findCollectionByNameOrId("profiles");
    profiles.listRule = PROFILES_READ;
    profiles.viewRule = PROFILES_READ;
    profiles.updateRule = PROFILES_UPDATE;
    profiles.deleteRule = PROFILES_DELETE;
    dao.saveCollection(profiles);
}, (db) => {
    const dao = new Dao(db);

    const exams = dao.findCollectionByNameOrId("exams");
    exams.listRule = OLD_EXAMS_READ;
    exams.viewRule = OLD_EXAMS_READ;
    exams.updateRule = OLD_EXAMS_WRITE;
    exams.deleteRule = OLD_EXAMS_WRITE;
    dao.saveCollection(exams);

    const profiles = dao.findCollectionByNameOrId("profiles");
    profiles.listRule = OLD_PROFILES_READ;
    profiles.viewRule = OLD_PROFILES_READ;
    profiles.updateRule = OLD_PROFILES_UPDATE;
    profiles.deleteRule = OLD_PROFILES_DELETE;
    return dao.saveCollection(profiles);
});
