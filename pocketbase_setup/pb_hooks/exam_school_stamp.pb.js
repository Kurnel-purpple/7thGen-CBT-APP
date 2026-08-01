/// <reference path="../pb_data/types.d.ts" />

/**
 * Stamps `school_version` on exams server-side, from the creating teacher's own record.
 *
 * Why a hook instead of an API rule: the rule
 *   @request.data.school_version = @request.auth.school_version
 * would be the obvious way to enforce this, but it *requires* the client to send the
 * field. Desktop and Android builds are distributed and self-update, so older clients
 * are in the field for a while after a release — and they would suddenly be unable to
 * create exams at all. Stamping in a hook works for every client version.
 *
 * It also closes a spoofing gap the rule would leave open: whatever the client sends is
 * discarded and replaced with the caller's real school, so a modified client cannot
 * plant an exam in someone else's school.
 *
 * On update, school_version is pinned to its existing value for the same reason —
 * an exam must not be able to move between schools.
 */

onRecordBeforeCreateRequest((e) => {
    const info = $apis.requestInfo(e.httpContext);
    const caller = info.authRecord;
    if (!caller) return; // unauthenticated creates are rejected by the collection rule

    // school_version is authoritative on profiles and may be blank on the users auth
    // record (see admin_user_password.pb.js). Prefer profiles, fall back to users.
    let sv = "";
    try {
        const rows = $app.dao().findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() });
        if (rows.length > 0) sv = (rows[0].getString("school_version") || "").trim();
    } catch (err) { /* no profile row */ }
    if (!sv) sv = (caller.getString("school_version") || "").trim();

    if (sv) {
        e.record.set("school_version", sv);
    } else {
        // Better to refuse than to create an exam that its own students cannot see
        // once the tenancy rules apply.
        throw new BadRequestError("Your account has no school assigned. Set your School ID before creating an exam.");
    }
}, "exams");

onRecordBeforeUpdateRequest((e) => {
    const original = $app.dao().findRecordById("exams", e.record.getId());
    e.record.set("school_version", original.getString("school_version"));
}, "exams");
