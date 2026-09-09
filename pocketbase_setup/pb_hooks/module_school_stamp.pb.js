/// <reference path="../pb_data/types.d.ts" />

/**
 * Stamps `school_version` server-side on the module collections scoped by
 * 1791500700_scope_module_collections.js.
 *
 * Why a hook instead of an API rule: a rule of the form
 *   @request.data.school_version = @request.auth.school_version
 * requires the client to send the field, which locks out every desktop and Android
 * build already in the field. Stamping works for every client version, and it also
 * closes the spoofing gap the rule would leave open - whatever the client sends is
 * discarded and replaced with the caller's real school.
 *
 * DO NOT FACTOR THE LOOKUPS OUT INTO SHARED TOP-LEVEL FUNCTIONS.
 * PocketBase's JSVM serialises each handler and re-evaluates it in an isolated context,
 * so a handler cannot see anything declared in this file's outer scope. An earlier
 * version of result_school_stamp.pb.js called a top-level resolveSchool() and every
 * stamp failed with "ReferenceError: resolveSchool is not defined" - silently, because
 * that hook catches and swallows to avoid blocking submissions. The repetition below is
 * the price of the isolation and is deliberate. Multiple collections share one handler
 * via the trailing tag arguments, which is the supported way to cut it down.
 *
 * THROW vs LEAVE BLANK
 * Every create here is staff-initiated except homework_submissions, so an unresolvable
 * school is refused rather than written - a blank row is invisible to its own school
 * once the rules apply, and a teacher can simply retry. homework_submissions is a
 * student's work: refusing it destroys something that may not be recreatable, so it
 * follows result_school_stamp.pb.js and leaves the field blank instead.
 *
 * On update the field is re-resolved from the caller rather than pinned to the row's
 * previous value. Both approaches prevent a row being moved between schools, but this
 * one needs no lookup of the original record and heals rows stamped blank at the same
 * time. super_admin is skipped, since they legitimately act across schools and
 * re-resolving would rewrite another school's row to theirs.
 */

// ---------------------------------------------------------------------------
// CREATE - collections whose school comes from the acting staff account
// ---------------------------------------------------------------------------
onRecordBeforeCreateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return; // unauthenticated creates are rejected by the collection rule

    // school_version is authoritative on profiles and may be blank on the users auth
    // record (see admin_user_password.pb.js). Prefer profiles, fall back to users.
    let sv = "";
    try {
        const rows = $app.dao().findRecordsByFilter(
            "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
        );
        if (rows.length > 0) sv = (rows[0].getString("school_version") || "").trim();
    } catch (err) { /* no profile row */ }
    if (!sv) sv = (caller.getString("school_version") || "").trim();

    if (!sv) {
        throw new BadRequestError("Your account has no school assigned. Set your School ID before saving.");
    }
    e.record.set("school_version", sv);
}, "attendance", "attendance_sheets", "subject_registrations", "question_bank_questions", "homework_assignments");

// ---------------------------------------------------------------------------
// CREATE - attendance_marks: the parent sheet is authoritative
// ---------------------------------------------------------------------------
onRecordBeforeCreateRequest((e) => {
    let sv = "";

    try {
        const sheetId = e.record.getString("sheet_id");
        if (sheetId) {
            const sheet = $app.dao().findRecordById("attendance_sheets", sheetId);
            sv = (sheet.getString("school_version") || "").trim();
        }
    } catch (err) { /* sheet missing or unreadable - fall through to the caller */ }

    if (!sv) {
        const info = $apis.requestInfo(e.httpContext);
        const caller = info.authRecord;
        if (!caller) return;
        try {
            const rows = $app.dao().findRecordsByFilter(
                "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
            );
            if (rows.length > 0) sv = (rows[0].getString("school_version") || "").trim();
        } catch (err) { /* no profile row */ }
        if (!sv) sv = (caller.getString("school_version") || "").trim();
    }

    if (!sv) {
        throw new BadRequestError("Your account has no school assigned. Set your School ID before saving.");
    }
    e.record.set("school_version", sv);
}, "attendance_marks");

// ---------------------------------------------------------------------------
// CREATE - homework_submissions: parent assignment is authoritative, and this one
// must never throw (see header).
// ---------------------------------------------------------------------------
onRecordBeforeCreateRequest((e) => {
    try {
        let sv = "";

        try {
            const assignmentId = e.record.getString("assignment_id");
            if (assignmentId) {
                const assignment = $app.dao().findRecordById("homework_assignments", assignmentId);
                sv = (assignment.getString("school_version") || "").trim();
            }
        } catch (err) { /* assignment missing - fall through */ }

        if (!sv) {
            try {
                const info = $apis.requestInfo(e.httpContext);
                const caller = info.authRecord;
                if (caller) {
                    try {
                        const rows = $app.dao().findRecordsByFilter(
                            "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
                        );
                        if (rows.length > 0) sv = (rows[0].getString("school_version") || "").trim();
                    } catch (err) { /* no profile row */ }
                    if (!sv) sv = (caller.getString("school_version") || "").trim();
                }
            } catch (err) { /* no request context */ }
        }

        e.record.set("school_version", sv);
    } catch (err) {
        console.log("[module_school_stamp] homework_submissions create stamp failed, leaving blank: " + err);
    }
}, "homework_submissions");

// ---------------------------------------------------------------------------
// UPDATE - re-resolve from the caller so a row cannot be moved between schools.
// Blank results heal on the way through. super_admin is left alone.
// ---------------------------------------------------------------------------
onRecordBeforeUpdateRequest((e) => {
    try {
        const info = $apis.requestInfo(e.httpContext);
        const caller = info.authRecord;
        if (!caller) return;
        if ((caller.getString("role") || "") === "super_admin") return;

        let sv = "";
        try {
            const rows = $app.dao().findRecordsByFilter(
                "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
            );
            if (rows.length > 0) sv = (rows[0].getString("school_version") || "").trim();
        } catch (err) { /* no profile row */ }
        if (!sv) sv = (caller.getString("school_version") || "").trim();

        // Unresolvable: leave whatever the row already has rather than blanking it.
        if (sv) e.record.set("school_version", sv);
    } catch (err) {
        console.log("[module_school_stamp] update stamp failed: " + err);
    }
}, "attendance", "attendance_sheets", "attendance_marks", "subject_registrations",
   "question_bank_questions", "homework_assignments", "homework_submissions");
