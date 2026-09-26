/// <reference path="../pb_data/types.d.ts" />

/**
 * Server-side guard for fee_payments.
 *
 * The collection rules in 1792500000_created_fee_payments.js decide WHO may
 * write. This hook decides WHAT they may write, which rules cannot express:
 *
 *   CREATE  - the submitter is pinned to the caller, the row is stamped with the
 *             caller's school, and `status` is forced to "pending". Without the
 *             last one a student simply POSTs status="confirmed" and clears their
 *             own school fees. That is the same class of hole as the users.role
 *             self-escalation already on the backlog, so it is closed here on the
 *             server rather than trusted to the form.
 *
 *   UPDATE  - everything except `status` and `admin_note` is restored from the
 *             stored row. An admin reviews a submission; an admin does not get to
 *             edit the amount, swap the receipt images, or reassign the payment to
 *             another student after the fact. These are financial records and the
 *             submitted half of them is the parent's statement, not the school's.
 *             reviewed_by / reviewed_at are stamped from the caller and the server
 *             clock, never from the request body.
 *
 * DO NOT FACTOR THE LOOKUPS OUT INTO SHARED TOP-LEVEL FUNCTIONS.
 * PocketBase's JSVM serialises each handler and re-evaluates it in an isolated
 * context, so a handler cannot see anything declared in this file's outer scope.
 * An earlier version of result_school_stamp.pb.js called a top-level
 * resolveSchool() and every stamp failed with "ReferenceError: resolveSchool is
 * not defined" - silently. The repetition below is the price of that isolation
 * and is deliberate.
 *
 * THROW RATHER THAN LEAVE BLANK.
 * result_school_stamp.pb.js leaves school_version blank on an unresolvable school
 * because refusing a student's exam submission destroys work that cannot be
 * recreated. A fee receipt is different: the photo is still on the parent's phone,
 * and a blank school_version makes the row invisible to the very admin who is
 * supposed to confirm it. A parent who believes they submitted and was never seen
 * is worse than a parent who is told to try again, so this refuses.
 */

// ---------------------------------------------------------------------------
// CREATE - pin the submitter, stamp the school, force pending
// ---------------------------------------------------------------------------
onRecordBeforeCreateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return; // unauthenticated creates are rejected by the collection rule

    // school_version is authoritative on profiles and may be blank on the users
    // auth record (see admin_user_password.pb.js). Prefer profiles, fall back.
    let sv = "";
    let fullName = "";
    let classLevel = "";
    try {
        const rows = $app.dao().findRecordsByFilter(
            "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
        );
        if (rows.length > 0) {
            sv = (rows[0].getString("school_version") || "").trim();
            fullName = (rows[0].getString("full_name") || "").trim();
            classLevel = (rows[0].getString("class_level") || "").trim();
        }
    } catch (err) { /* no profile row */ }
    if (!sv) sv = (caller.getString("school_version") || "").trim();
    if (!fullName) fullName = (caller.getString("full_name") || caller.getString("name") || "").trim();
    if (!fullName) fullName = caller.getString("username") || "";

    if (!sv) {
        throw new BadRequestError("Your account has no school assigned. Ask your school admin to set your School ID before submitting a receipt.");
    }

    e.record.set("school_version", sv);
    e.record.set("student", caller.getId());
    e.record.set("student_name", fullName);
    if (classLevel) e.record.set("class_level", classLevel);

    // The privilege boundary. Whatever the client sent is discarded.
    e.record.set("status", "pending");
    e.record.set("reviewed_by", "");
    e.record.set("reviewed_by_name", "");
    e.record.set("reviewed_at", "");
    e.record.set("admin_note", "");
}, "fee_payments");

// ---------------------------------------------------------------------------
// UPDATE - only status and admin_note are the reviewer's to change
// ---------------------------------------------------------------------------
onRecordBeforeUpdateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return;

    const role = (caller.getString("role") || "").trim();
    if (role !== "admin" && role !== "super_admin") {
        // The collection rule already refuses this; a second refusal here means
        // a rule regression cannot silently become a self-confirmation hole.
        throw new ForbiddenError("Only a school admin can review a payment.");
    }

    const original = e.record.originalCopy();

    // Freeze the submitted half of the record. An admin reviews; they do not
    // rewrite what the parent said or replace the evidence.
    const frozen = [
        "student", "student_name", "class_level",
        "purpose", "caption", "amount", "term", "session",
        "receipts", "school_version", "client_id"
    ];
    for (let i = 0; i < frozen.length; i++) {
        e.record.set(frozen[i], original.get(frozen[i]));
    }

    const nextStatus = (e.record.getString("status") || "").trim();
    const prevStatus = (original.getString("status") || "").trim();

    const allowed = ["pending", "confirmed", "rejected"];
    if (allowed.indexOf(nextStatus) === -1) {
        throw new BadRequestError("Unknown payment status.");
    }

    if (nextStatus !== prevStatus) {
        if (nextStatus === "pending") {
            // Reopening a decision - drop the stale reviewer stamp so the row
            // does not read as "reviewed" while sitting back in the queue.
            e.record.set("reviewed_by", "");
            e.record.set("reviewed_by_name", "");
            e.record.set("reviewed_at", "");
        } else {
            let reviewerName = (caller.getString("full_name") || caller.getString("name") || "").trim();
            if (!reviewerName) {
                try {
                    const rows = $app.dao().findRecordsByFilter(
                        "profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
                    );
                    if (rows.length > 0) reviewerName = (rows[0].getString("full_name") || "").trim();
                } catch (err) { /* no profile row */ }
            }
            if (!reviewerName) reviewerName = caller.getString("username") || "Admin";

            e.record.set("reviewed_by", caller.getId());
            e.record.set("reviewed_by_name", reviewerName);
            // Server clock, not the client's - a device with a wrong date must
            // not be able to backdate a confirmation.
            e.record.set("reviewed_at", new Date().toISOString().replace("T", " ").substring(0, 19) + "Z");
        }
    }
}, "fee_payments");
