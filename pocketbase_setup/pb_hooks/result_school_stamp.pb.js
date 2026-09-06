/// <reference path="../pb_data/types.d.ts" />

/**
 * Stamps `school_version` on results server-side, so the tenancy rules in
 * 1791500600_scope_results.js have a value to compare against on every new row.
 *
 * Mirrors pb_hooks/exam_school_stamp.pb.js, with one deliberate difference:
 *
 *   THIS HOOK MUST NEVER THROW.
 *
 * The exam hook refuses the write when it cannot resolve a school, which is safe there —
 * a teacher retries the exam form. A result is a student's submitted exam. Refusing it
 * destroys work that cannot be recreated: the student has already sat the paper, and for
 * offline submissions the queued payload may be the only copy left. An unscoped row is a
 * bad outcome; a lost script is a far worse one. So every lookup is best-effort and a
 * failure to resolve leaves the field blank rather than rejecting the submission.
 *
 * A blank row is still readable by the student who owns it (the rule keeps
 * `@request.auth.id = student_id`); it is only invisible to staff lists, and the update
 * hook below heals it the next time the record is touched.
 *
 * Source of truth is the exam, not the caller: exam_id is required on every result and
 * exams were scoped correctly by 1791500050, so it survives a student whose own
 * school_version is blank or stale. The caller is only a fallback.
 */

function resolveSchool(e, examId) {
    // 1. The exam this result belongs to — authoritative.
    try {
        if (examId) {
            const exam = $app.dao().findRecordById("exams", examId);
            const sv = (exam.getString("school_version") || "").trim();
            if (sv) return sv;
        }
    } catch (err) { /* exam deleted or unreadable — fall through */ }

    // 2. The submitting account. school_version is authoritative on profiles and may be
    //    blank on the users auth record (see admin_user_password.pb.js).
    try {
        const info = $apis.requestInfo(e.httpContext);
        const caller = info.authRecord;
        if (caller) {
            try {
                const rows = $app.dao().findRecordsByFilter(
                    "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
                );
                if (rows.length > 0) {
                    const sv = (rows[0].getString("school_version") || "").trim();
                    if (sv) return sv;
                }
            } catch (err) { /* no profile row */ }
            const sv = (caller.getString("school_version") || "").trim();
            if (sv) return sv;
        }
    } catch (err) { /* no request context */ }

    return "";
}

onRecordBeforeCreateRequest((e) => {
    try {
        // Whatever the client sent is discarded and replaced, so a modified client
        // cannot plant a result in another school.
        e.record.set("school_version", resolveSchool(e, e.record.getString("exam_id")));
    } catch (err) {
        // Never block a submission. Worst case the row is unscoped and gets healed
        // on the next update.
        console.log("[result_school_stamp] create stamp failed, leaving blank: " + err);
    }
}, "results");

onRecordBeforeUpdateRequest((e) => {
    try {
        const original = $app.dao().findRecordById("results", e.record.getId());
        const existing = (original.getString("school_version") || "").trim();
        if (existing) {
            // Pin it — a result must not be able to move between schools.
            e.record.set("school_version", existing);
        } else {
            // Self-heal rows that predate this hook or were stamped blank.
            e.record.set("school_version", resolveSchool(e, e.record.getString("exam_id")));
        }
    } catch (err) {
        console.log("[result_school_stamp] update stamp failed: " + err);
    }
}, "results");
