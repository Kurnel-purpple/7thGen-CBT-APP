/// <reference path="../pb_data/types.d.ts" />

/**
 * Scopes the module collections to their school.
 *
 * These seven collections were created by hand in the admin UI rather than by migration,
 * and every one of them shipped with a placeholder rule that was never tightened:
 *
 *   question_bank_questions   list/view: @request.auth.id != ""
 *   attendance                list/view: @request.auth.id != ""
 *   attendance_sheets         ALL FIVE:  @request.auth.id != ""
 *   attendance_marks          ALL FIVE:  @request.auth.id != ""
 *   subject_registrations     ALL FIVE:  @request.auth.id != ""
 *   homework_assignments      list/view: no tenancy clause
 *   homework_submissions      list/view: any teacher or admin, any school
 *
 * Two consequences worth stating plainly, because they are worse than "a data leak":
 *
 *   1. question_bank_questions carries an `answer` column, and any authenticated
 *      account - including a student - could list every school's bank and read it.
 *      That is an exam-integrity hole, not just a tenancy one.
 *   2. The three attendance-family collections granted DELETE to any authenticated
 *      account. Any user of any school could destroy any other school's attendance
 *      records.
 *
 * This is the same class of hole 1791500000/1791500300 closed for exams and
 * 1791500500/1791500600 closes for results. report_cards is the one collection in this
 * group that was written correctly, and its rules are the template used below.
 *
 * WHY THIS IS ONE STEP AND NOT TWO
 * Results needed the field/backfill and the rule tightening split across two deploys
 * because it had 6,375 live rows that would have vanished if scoped before the stamping
 * hook was live. These collections are pre-operational - the tenant has only ever used
 * CBT - so the rows here are throwaway test data. The backfill still runs, and the
 * remaining-blank count per collection is logged; a non-zero number is informational
 * rather than a stop sign, but it is printed so it cannot pass unnoticed.
 *
 * CREATE RULES DELIBERATELY DO NOT CHECK school_version.
 * A rule of the form `@request.data.school_version = @request.auth.school_version`
 * requires the client to send the field, which locks out every desktop and Android
 * build already in the field. The value is stamped server-side instead, by
 * pb_hooks/module_school_stamp.pb.js - same reasoning as exam_school_stamp.pb.js.
 *
 * PRECONDITION - verify before deploying:
 *   Staff `users` rows must have school_version populated. These rules compare against
 *   @request.auth.school_version, which reads the USERS record, not profiles. A blank
 *   there matches nothing, which does not degrade a dashboard - it empties it.
 *   1791500050 normalised this; accounts created since are the risk.
 *
 * Rolling back is a rule revert plus dropping two fields - see the down migration.
 */

const SAME_SCHOOL = 'school_version = @request.auth.school_version';
const STAFF = '(@request.auth.role = "teacher" || @request.auth.role = "admin")';
const ADMIN = '@request.auth.role = "admin"';
const SUPER = '@request.auth.role = "super_admin"';
const AUTHED = '@request.auth.id != ""';

migrate((db) => {
    const dao = new Dao(db);

    // ----------------------------------------------------------------
    // 1. Schema - the two collections with no tenancy dimension at all
    // ----------------------------------------------------------------

    const attendance = dao.findCollectionByNameOrId("attendance");
    attendance.schema.addField(new SchemaField({
        "system": false,
        "id": "att_schoolv0",
        "name": "school_version",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
    }));
    dao.saveCollection(attendance);

    const marks = dao.findCollectionByNameOrId("attendance_marks");
    marks.schema.addField(new SchemaField({
        "system": false,
        "id": "atm_schoolv0",
        "name": "school_version",
        "type": "text",
        "required": false,
        "presentable": false,
        "unique": false,
        "options": { "min": null, "max": null, "pattern": "" }
    }));
    dao.saveCollection(marks);

    // ----------------------------------------------------------------
    // 2. Backfill
    //
    // school_version is authoritative on profiles and may be blank on the users auth
    // record (see admin_user_password.pb.js), so every person-based lookup below tries
    // profiles first and falls back to users. Rows whose owning account no longer
    // exists are left blank and counted.
    // ----------------------------------------------------------------

    function count(sql) {
        const row = new DynamicModel({ "c": 0 });
        db.newQuery(sql).one(row);
        return row.c;
    }

    // Resolve a school from a column holding a user id.
    function byUser(table, idColumn) {
        return "UPDATE " + table + " SET school_version = COALESCE((" +
            "  SELECT p.school_version FROM profiles p" +
            "   WHERE p.user = " + table + "." + idColumn +
            "     AND COALESCE(p.school_version,'') != '' LIMIT 1" +
            "), (" +
            "  SELECT u.school_version FROM users u" +
            "   WHERE u.id = " + table + "." + idColumn +
            "     AND COALESCE(u.school_version,'') != '' LIMIT 1" +
            "), '')" +
            " WHERE COALESCE(school_version,'') = ''";
    }

    // Resolve a school from a parent row in another table.
    function byParent(table, fkColumn, parentTable) {
        return "UPDATE " + table + " SET school_version = COALESCE((" +
            "  SELECT x.school_version FROM " + parentTable + " x" +
            "   WHERE x.id = " + table + "." + fkColumn +
            "     AND COALESCE(x.school_version,'') != '' LIMIT 1" +
            "), '')" +
            " WHERE COALESCE(school_version,'') = ''";
    }

    const passes = [
        // attendance - only has student_id to go on
        byUser("attendance", "student_id"),

        // attendance_sheets - the sheet's own teacher
        byUser("attendance_sheets", "teacher_id"),

        // attendance_marks - parent sheet is authoritative, student is the fallback
        byParent("attendance_marks", "sheet_id", "attendance_sheets"),
        byUser("attendance_marks", "student_id"),

        byUser("subject_registrations", "student_id"),
        byUser("question_bank_questions", "created_by"),
        byUser("homework_assignments", "created_by"),

        // homework_submissions - parent assignment first, then the submitting student
        byParent("homework_submissions", "assignment_id", "homework_assignments"),
        byUser("homework_submissions", "student_id")
    ];

    for (let i = 0; i < passes.length; i++) {
        db.newQuery(passes[i]).execute();
    }

    const tables = [
        "attendance", "attendance_sheets", "attendance_marks", "subject_registrations",
        "question_bank_questions", "homework_assignments", "homework_submissions"
    ];
    for (let i = 0; i < tables.length; i++) {
        const t = tables[i];
        console.log("[module-scope] " + t +
            ": total " + count("SELECT COUNT(*) AS c FROM " + t) +
            ", still blank " + count("SELECT COUNT(*) AS c FROM " + t +
                " WHERE COALESCE(school_version,'') = ''"));
    }

    // ----------------------------------------------------------------
    // 3. Rules
    //
    // Shape follows report_cards, the one collection in this group that was written
    // correctly: reads are same-school, writes are staff-only and same-school, and
    // super_admin keeps platform-wide access.
    //
    // Where a row belongs to a student, `@request.auth.id = <student column>` stays
    // FIRST in the read rule. That is what keeps a student able to read their own row
    // even if it was stamped blank - the same guarantee 1791500600 preserves for
    // results.
    // ----------------------------------------------------------------

    function setRules(name, rules) {
        const c = dao.findCollectionByNameOrId(name);
        c.listRule = rules.list;
        c.viewRule = rules.view;
        c.createRule = rules.create;
        c.updateRule = rules.update;
        c.deleteRule = rules.del;
        dao.saveCollection(c);
    }

    // Answer keys live here. Students have no legitimate read: every surface that loads
    // this module (create-exam, question-bank, question-picker, teacher-dashboard) is
    // staff-only, so restricting to staff removes nothing a student can reach today.
    setRules("question_bank_questions", {
        list:   '(' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        view:   '(' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        create: STAFF,
        update: '((created_by = @request.auth.id || ' + ADMIN + ') && ' + SAME_SCHOOL + ') || ' + SUPER,
        del:    '((created_by = @request.auth.id || ' + ADMIN + ') && ' + SAME_SCHOOL + ') || ' + SUPER
    });

    setRules("attendance", {
        list:   '@request.auth.id = student_id || (' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        view:   '@request.auth.id = student_id || (' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        create: STAFF,
        update: '(' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        del:    '(' + ADMIN + ' && ' + SAME_SCHOOL + ') || ' + SUPER
    });

    // Sheets and registrations stay readable by any account in the school - students
    // read their own row off these to render their attendance grid.
    setRules("attendance_sheets", {
        list:   '(' + AUTHED + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        view:   '(' + AUTHED + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        create: STAFF,
        update: '(' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        del:    '(' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER
    });

    setRules("attendance_marks", {
        list:   '@request.auth.id = student_id || (' + AUTHED + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        view:   '@request.auth.id = student_id || (' + AUTHED + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        create: STAFF,
        update: '(' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        del:    '(' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER
    });

    // Students register themselves for subjects and unregister again - see
    // studentSubjectRegistration.js doRegister/doUnregister, which run as the student.
    // A staff-only create/delete here would break subject registration outright, so a
    // student keeps both for their OWN row. `@request.data.student_id` is the submitted
    // value on create; `student_id` is the stored one on update/delete.
    setRules("subject_registrations", {
        list:   '@request.auth.id = student_id || (' + AUTHED + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        view:   '@request.auth.id = student_id || (' + AUTHED + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        create: '@request.auth.id = @request.data.student_id || ' + STAFF + ' || ' + SUPER,
        update: '@request.auth.id = student_id || (' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        del:    '@request.auth.id = student_id || (' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER
    });

    // Homework already had sensible role logic - only the tenancy clause was missing.
    setRules("homework_assignments", {
        list:   '(' + AUTHED + ' && ' + SAME_SCHOOL +
                ' && (status = "published" || created_by = @request.auth.id || ' + ADMIN + ')) || ' + SUPER,
        view:   '(' + AUTHED + ' && ' + SAME_SCHOOL +
                ' && (status = "published" || created_by = @request.auth.id || ' + ADMIN + ')) || ' + SUPER,
        create: AUTHED + ' && ' + STAFF,
        update: '@request.auth.id = created_by || ' + ADMIN + ' || ' + SUPER,
        del:    '@request.auth.id = created_by || ' + ADMIN + ' || ' + SUPER
    });

    setRules("homework_submissions", {
        list:   '@request.auth.id = student_id || (' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        view:   '@request.auth.id = student_id || (' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        create: '@request.auth.id = student_id',
        update: '@request.auth.id = student_id || (' + STAFF + ' && ' + SAME_SCHOOL + ') || ' + SUPER,
        del:    '@request.auth.id = student_id || (' + ADMIN + ' && ' + SAME_SCHOOL + ') || ' + SUPER
    });

}, (db) => {
    // ---- down: restore the original rules, drop the two added fields ----
    const dao = new Dao(db);

    function restore(name, rules) {
        const c = dao.findCollectionByNameOrId(name);
        c.listRule = rules.list;
        c.viewRule = rules.view;
        c.createRule = rules.create;
        c.updateRule = rules.update;
        c.deleteRule = rules.del;
        dao.saveCollection(c);
    }

    const OPEN = '@request.auth.id != ""';

    restore("question_bank_questions", {
        list: OPEN, view: OPEN, create: OPEN,
        update: 'created_by = @request.auth.id',
        del: 'created_by = @request.auth.id'
    });

    restore("attendance", {
        list: OPEN, view: OPEN,
        create: '@request.auth.role = "admin" || @request.auth.role = "teacher"',
        update: '@request.auth.role = "admin" || @request.auth.role = "teacher"',
        del: '@request.auth.role = "admin"'
    });

    restore("attendance_sheets", { list: OPEN, view: OPEN, create: OPEN, update: OPEN, del: OPEN });
    restore("attendance_marks", { list: OPEN, view: OPEN, create: OPEN, update: OPEN, del: OPEN });
    restore("subject_registrations", { list: OPEN, view: OPEN, create: OPEN, update: OPEN, del: OPEN });

    restore("homework_assignments", {
        list: '@request.auth.id != "" && (status = "published" || created_by = @request.auth.id || @request.auth.role = "admin")',
        view: '@request.auth.id != "" && (status = "published" || created_by = @request.auth.id || @request.auth.role = "admin")',
        create: '@request.auth.id != "" && (@request.auth.role = "teacher" || @request.auth.role = "admin")',
        update: '@request.auth.id = created_by || @request.auth.role = "admin"',
        del: '@request.auth.id = created_by || @request.auth.role = "admin"'
    });

    restore("homework_submissions", {
        list: '@request.auth.id != "" && (student_id = @request.auth.id || @request.auth.role = "teacher" || @request.auth.role = "admin")',
        view: '@request.auth.id != "" && (student_id = @request.auth.id || @request.auth.role = "teacher" || @request.auth.role = "admin")',
        create: '@request.auth.id = student_id',
        update: '@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"',
        del: '@request.auth.id = student_id || @request.auth.role = "admin"'
    });

    const attendance = dao.findCollectionByNameOrId("attendance");
    attendance.schema.removeField("att_schoolv0");
    dao.saveCollection(attendance);

    const marks = dao.findCollectionByNameOrId("attendance_marks");
    marks.schema.removeField("atm_schoolv0");
    dao.saveCollection(marks);
});
