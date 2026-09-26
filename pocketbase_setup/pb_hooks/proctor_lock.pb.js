/// <reference path="../pb_data/types.d.ts" />

/**
 * Light proctoring — server-side enforcement.
 *
 * Two pieces:
 *
 *   1. An update guard on `results`, so a student cannot undo their own lockout.
 *   2. POST /api/cbt/proctor-breach, a sendBeacon target, so a breach that
 *      happens as the page is being destroyed still gets recorded.
 *
 *
 * WHY A HOOK AND NOT AN API RULE
 *
 * The results updateRule is, and must stay:
 *     @request.auth.id = student_id || (staff && same school) || super_admin
 * The student clause is not slack — it is what lets the exam page autosave
 * answers mid-attempt (ds.syncProgressToServer). Removing it to protect the
 * lockout would break answer persistence, which is far more valuable than the
 * lockout is. So the narrow rule "a student may write to their own row, but
 * not THESE two things" has to live in a hook.
 *
 *
 * WHY OWNERSHIP AND NOT ROLE
 *
 * The obvious check is "let teachers and admins through, block students". It is
 * the wrong check here. Role is read from the caller's auth record, and an
 * account can currently PATCH its own `role` field — so a role test is only as
 * strong as that separate, still-open hole, and a student who escalates would
 * walk straight through this guard.
 *
 * Ownership cannot be escalated. `student_id` is on the row, set at creation,
 * and a caller either is that id or is not. So the rule is:
 *
 *     the row's OWN student may not clear a breach or reopen their submission
 *
 * A teacher or admin granting a retake is, by definition, never the row's own
 * student, so the legitimate path is untouched and stays correct even if the
 * role field is compromised. (The same-school restriction on who counts as
 * staff is already enforced by the collection rules; this hook does not
 * re-litigate it.)
 *
 *
 * FAILURE DIRECTION
 *
 * A results row is a student's sat exam. Every read here is best-effort and any
 * unexpected failure lets the write THROUGH, for the reason spelled out at
 * length in result_school_stamp.pb.js: an unenforced lockout is a bad outcome,
 * a destroyed script is a much worse one. The guard throws only on a breach it
 * has positively confirmed.
 *
 *
 * DO NOT FACTOR THE SHARED LOGIC OUT INTO A TOP-LEVEL FUNCTION.
 * PocketBase's JSVM serialises each record handler and re-evaluates it in an
 * isolated context, so a handler cannot see anything declared in this file's
 * outer scope — it fails at runtime with "X is not defined". The duplication
 * between the handler below and the route is deliberate. See the same warning
 * in result_school_stamp.pb.js, which was written after that bug bit.
 */

onRecordBeforeUpdateRequest((e) => {
    // --- who is calling? ---
    let callerId = "";
    try {
        const caller = $apis.requestInfo(e.httpContext).authRecord;
        // No auth record means a superuser/console write or an internal save.
        // Neither is a student undoing a lockout.
        if (!caller) return;
        callerId = caller.getId();
    } catch (err) {
        return; // no request context — not a student write
    }

    const ownerId = e.record.getString("student_id");
    if (!ownerId || callerId !== ownerId) return; // staff grant — allowed

    // --- what did the row look like before this write? ---
    let original = null;
    try {
        // originalCopy() is the pre-change snapshot PocketBase already holds, so
        // the common case (an answer autosave, every few seconds, per student)
        // costs no extra query.
        if (typeof e.record.originalCopy === "function") {
            original = e.record.originalCopy();
        }
    } catch (err) { /* fall through to the lookup */ }

    if (!original) {
        try {
            original = $app.dao().findRecordById("results", e.record.getId());
        } catch (err) {
            return; // cannot read the old state — do not risk the submission
        }
    }

    let existing = {};
    let incoming = {};
    try {
        let rawOld = "";
        try { rawOld = original.getString("flags"); } catch (err) { rawOld = ""; }
        existing = JSON.parse(rawOld || "{}") || {};

        let rawNew = "";
        try { rawNew = e.record.getString("flags"); } catch (err) { rawNew = ""; }
        incoming = JSON.parse(rawNew || "{}") || {};
    } catch (err) {
        return; // unparseable flags — fail open
    }

    const existingStatus = String(existing._status || "");
    const incomingStatus = String(incoming._status || "");
    const wasBreached = !!(existing._proctor && existing._proctor.breached === true);

    // --- 1. a student may not reopen their own submitted attempt ---
    //
    // No legitimate client path does this. saveResult only ever moves
    // in-progress -> completed; syncProgressToServer writes only while the row
    // is already in-progress; resolve-mode grading goes through updateResult,
    // which merges into the stored flags and leaves _status where it was.
    // completed -> in-progress from the owning student is a hand-crafted
    // request, and it is exactly the bypass this feature exists to stop.
    if (existingStatus === "completed" && incomingStatus === "in-progress") {
        throw new ForbiddenError(
            "A submitted exam can only be reopened by a teacher or an administrator."
        );
    }

    // --- 2. a student may not erase the proctoring record ---
    //
    // Repaired rather than rejected. Losing _proctor is usually not an attack:
    // the ordinary submission path rebuilds the flags object from scratch and
    // would drop it by accident, and refusing those writes would cost real
    // answers. Re-attaching the stored record is strictly safer and leaves the
    // rest of the write intact.
    //
    // This covers warn mode as well as strict. A warn-mode incident never locks
    // anything, but it is the entire point of running an exam in warn mode, and
    // it would otherwise be wiped by the student's own submission minutes later.
    if (existing._proctor) {
        const incomingProctor = incoming._proctor;
        const nowBreached = !!(incomingProctor && incomingProctor.breached === true);

        // Restore when the record is being dropped outright, or when a breach is
        // being replaced by something that is not one. A newer breach landing on
        // top of an older record is a genuine update and is left alone.
        if (!incomingProctor || (wasBreached && !nowBreached)) {
            incoming._proctor = existing._proctor;
            e.record.set("flags", incoming);
        }
    }
}, "results");


/**
 * POST /api/cbt/proctor-breach
 *
 * Called with navigator.sendBeacon at the moment the exam page is being torn
 * down — the student confirmed the browser's "Leave site?" prompt, or closed
 * the tab, or the OS took the app away for good.
 *
 * Not $apis.requireRecordAuth(): sendBeacon cannot set an Authorization header.
 * It cannot set arbitrary headers at all, so the caller's own auth token is
 * carried in the body and verified here. The token is the same one the client
 * already holds, so this exposes nothing new — and the endpoint refuses to
 * touch any row whose student_id is not the token's own record.
 *
 * The client grades synchronously before the beacon leaves (grading is pure
 * arithmetic over answers it already has), so the payload is a finished result
 * and the attempt lands submitted rather than stranded in-progress. If the
 * score is missing or unusable the row is still marked breached and left
 * in-progress for a teacher to finalise with the existing auto-submit action —
 * a locked attempt with no score is recoverable, a lost one is not.
 */
routerAdd("POST", "/api/cbt/proctor-breach", (c) => {
    const info = $apis.requestInfo(c);
    const data = info.data || {};

    const token = String(data.token || "").trim();
    const examId = String(data.examId || "").trim();
    if (!token || !examId) {
        throw new BadRequestError("Missing token or exam.");
    }

    // --- verify the caller ---
    let student = null;
    try {
        student = $app.dao().findAuthRecordByToken(token, $app.settings().recordAuthToken.secret);
    } catch (err) {
        throw new UnauthorizedError("Invalid session.");
    }
    if (!student) throw new UnauthorizedError("Invalid session.");
    const studentId = student.getId();

    // --- find the attempt ---
    let row = null;
    try {
        const rows = $app.dao().findRecordsByFilter(
            "results",
            "exam_id = {:exam} && student_id = {:student}",
            "-created", 1, 0,
            { exam: examId, student: studentId }
        );
        if (rows.length > 0) row = rows[0];
    } catch (err) {
        throw new BadRequestError("Could not load the attempt.");
    }
    // Nothing to mark. Not an error worth surfacing — the page is already gone.
    if (!row) return c.json(200, { ok: true, marked: false });

    let flags = {};
    try {
        flags = JSON.parse(row.getString("flags") || "{}") || {};
    } catch (err) {
        flags = {};
    }

    // Already finished and NOT via a breach — a normal submission that raced the
    // beacon (the student pressed Submit and the page then unloaded). Leave it.
    if (String(flags._status || "") === "completed" && !(flags._proctor && flags._proctor.breached)) {
        return c.json(200, { ok: true, marked: false });
    }

    // Warn mode reports the same incidents but must never lock the attempt: it
    // exists so a school can see how often students really leave before anyone
    // risks an auto-submit on it. Only strict sets breached, and only breached
    // rows are refused re-entry.
    const isStrict = String(data.mode || "strict") !== "warn";

    const events = Array.isArray(data.events) ? data.events.slice(-20) : [];
    flags._proctor = {
        breached: isStrict,
        mode: isStrict ? "strict" : "warn",
        reason: String(data.reason || "left_page"),
        at: new Date().toISOString(),
        strikes: Number(data.strikes) || 1,
        remainingSeconds: Number.isFinite(Number(data.remainingSeconds))
            ? Number(data.remainingSeconds)
            : null,
        events: events,
        via: "beacon"
    };

    const score = Number(data.score);
    const totalPoints = Number(data.totalPoints);
    // A warn-mode leave never submits the attempt either — the student is free to
    // come back and carry on, which is the whole difference between the modes.
    const canFinalise = isStrict && Number.isFinite(score) && Number.isFinite(totalPoints);

    if (canFinalise) {
        flags._status = "completed";
        // Match what the normal submission path clears, so a reopened-for-extension
        // attempt that then breaches does not keep stale reopen markers.
        delete flags._reopenedForExtension;
        delete flags._reopenedAt;

        const passScore = Number.isFinite(Number(data.passScore)) ? Number(data.passScore) : 50;
        row.set("score", score);
        row.set("total_points", Math.round(totalPoints));
        row.set("pass_score", passScore);
        row.set("passed", score >= passScore);
        row.set("submitted_at", new Date().toISOString());
        if (data.answers && typeof data.answers === "object") {
            row.set("answers", data.answers);
        }
    }

    row.set("flags", flags);

    try {
        $app.dao().saveRecord(row);
    } catch (err) {
        console.log("[proctor-breach] save failed for exam " + examId + ": " + err);
        throw new BadRequestError("Could not record the breach.");
    }

    return c.json(200, { ok: true, marked: true, finalised: canFinalise });
});
