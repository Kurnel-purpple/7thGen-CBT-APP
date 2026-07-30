/// <reference path="../pb_data/types.d.ts" />

/**
 * School join codes (server-side)
 *
 * `school_version` is the tenancy boundary for exams and profiles, so the browser
 * must never be able to set it — the `users` / `profiles` create+update rules reject
 * any client attempt. These routes are the only way it gets written.
 *
 * A school admin generates a short-lived code and gives it to their intake out of
 * band ("use code XXXX when you register"). Registration collects it and calls
 * /api/cbt/join, which validates server-side and stamps the school. Accounts work
 * immediately, so there is no approval queue to jam on enrolment day, and an attacker
 * cannot claim a school whose code they were never told.
 *
 * This depends on admin self-registration being closed (the `users` create rule
 * rejects privileged roles). Otherwise an attacker would register as an admin and
 * mint codes for themselves.
 *
 * Endpoints (auth: the caller's normal user token, sent automatically by the SDK):
 *   POST /api/cbt/join/code  { expiresInHours?, maxUses? } -> { code, expiresAt, schoolVersion }
 *   POST /api/cbt/join       { code }                      -> { schoolVersion }
 *
 * NOTE: v0.21 runs each handler in an isolated goja runtime, so helpers are inlined
 * per handler rather than shared — same reason as admin_user_password.pb.js.
 */

// Unambiguous alphabet: no O/0 or I/1, because these get read aloud and copied by hand.
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 8;
const DEFAULT_EXPIRY_HOURS = 24;

routerAdd("POST", "/api/cbt/join/code", (c) => {
    const info = $apis.requestInfo(c);
    const caller = info.authRecord;
    if (!caller) {
        throw new UnauthorizedError("You must be signed in.");
    }

    const role = caller.getString("role");
    if (role !== "admin" && role !== "super_admin") {
        throw new ForbiddenError("Only administrators can generate registration codes.");
    }

    const dao = $app.dao();

    // school_version lives authoritatively on profiles; the users row is often blank.
    // Consult both, profiles first, or an admin with a blank auth record could never
    // generate a code. Each filter runs in its own try — filtering on a column a
    // collection doesn't have throws in PocketBase.
    let schoolVersion = "";
    try {
        const rows = dao.findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() });
        if (rows.length > 0) schoolVersion = (rows[0].getString("school_version") || "").trim();
    } catch (e) { /* no profile row */ }
    if (!schoolVersion) schoolVersion = (caller.getString("school_version") || "").trim();

    if (!schoolVersion) {
        throw new BadRequestError("Your account has no school assigned, so it cannot issue codes for one.");
    }

    const body = new DynamicModel({ expiresInHours: null, maxUses: null });
    try { c.bind(body); } catch (e) { /* empty body is fine, defaults apply */ }

    let hours = parseInt(body.expiresInHours, 10);
    if (isNaN(hours) || hours < 1) hours = DEFAULT_EXPIRY_HOURS;
    if (hours > 24 * 30) hours = 24 * 30;

    let maxUses = parseInt(body.maxUses, 10);
    if (isNaN(maxUses) || maxUses < 0) maxUses = 0; // 0 = unlimited until expiry

    const collection = dao.findCollectionByNameOrId("school_join_codes");

    // Unique index on `code` makes a collision a save error rather than a silent
    // overwrite, so retry a few times instead of trusting one draw.
    let saved = null;
    let lastErr = null;
    for (let attempt = 0; attempt < 5 && !saved; attempt++) {
        const code = $security.randomStringWithAlphabet(JOIN_CODE_LENGTH, JOIN_CODE_ALPHABET);
        const rec = new Record(collection);
        rec.set("code", code);
        rec.set("school_version", schoolVersion);
        rec.set("expires_at", new Date(Date.now() + hours * 3600000).toISOString());
        rec.set("max_uses", maxUses);
        rec.set("uses", 0);
        rec.set("revoked", false);
        rec.set("created_by", caller.getId());
        try {
            dao.saveRecord(rec);
            saved = rec;
        } catch (e) {
            lastErr = e;
        }
    }

    if (!saved) {
        throw new BadRequestError("Could not generate a code: " + (lastErr ? lastErr.message : "unknown error"));
    }

    return c.json(200, {
        code: saved.getString("code"),
        expiresAt: saved.getString("expires_at"),
        schoolVersion: schoolVersion,
        maxUses: maxUses
    });
});

routerAdd("POST", "/api/cbt/join", (c) => {
    const info = $apis.requestInfo(c);
    const caller = info.authRecord;
    if (!caller) {
        throw new UnauthorizedError("You must be signed in to join a school.");
    }

    // Admin school assignment stays a superuser action. Otherwise an admin of one
    // school could redeem another school's student code and inherit admin rights
    // over that school's exams.
    const role = caller.getString("role");
    if (role === "admin" || role === "super_admin") {
        throw new ForbiddenError("Administrator accounts cannot join a school with a code.");
    }

    const body = new DynamicModel({ code: "" });
    c.bind(body);

    const code = (body.code || "").trim().toUpperCase();
    if (!code) {
        throw new BadRequestError("Enter the registration code your school gave you.");
    }

    const dao = $app.dao();

    let rows = [];
    try {
        rows = dao.findRecordsByFilter("school_join_codes", "code = {:code}", "", 1, 0, { code: code });
    } catch (e) {
        throw new BadRequestError("Could not check that code. Please try again.");
    }
    if (rows.length === 0) {
        throw new BadRequestError("That registration code is not valid.");
    }

    const rec = rows[0];

    if (rec.getBool("revoked")) {
        throw new BadRequestError("That registration code has been revoked. Ask your school for a new one.");
    }

    const expiresAt = rec.getDateTime("expires_at");
    if (expiresAt && expiresAt.time && expiresAt.time() < new Date().getTime()) {
        throw new BadRequestError("That registration code has expired. Ask your school for a new one.");
    }

    const maxUses = rec.getInt("max_uses") || 0;
    const uses = rec.getInt("uses") || 0;
    if (maxUses > 0 && uses >= maxUses) {
        throw new BadRequestError("That registration code has already been used the maximum number of times.");
    }

    const schoolVersion = (rec.getString("school_version") || "").trim();
    if (!schoolVersion) {
        throw new BadRequestError("That code is not attached to a school. Ask your school for a new one.");
    }

    // Stamp BOTH rows. The API rules read @request.auth.school_version, which is the
    // users copy, while the app reads profiles — they have to agree or the user is
    // visible to one and invisible to the other.
    const userRec = dao.findRecordById("users", caller.getId());
    userRec.set("school_version", schoolVersion);

    // Landing-page demo accounts are time-limited. The expiry is set here rather than by
    // the client so a visitor cannot extend their own trial — users.Update lets them
    // write their own record, and demo_expiry is not otherwise guarded.
    if (schoolVersion === "GEN7DEMO") {
        userRec.set("demo_expiry", new Date(Date.now() + 3600000).toISOString());
    }

    dao.saveRecord(userRec);

    try {
        const profiles = dao.findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() });
        if (profiles.length > 0) {
            profiles[0].set("school_version", schoolVersion);
            dao.saveRecord(profiles[0]);
        }
        // No profile row yet: the client creates it on first login and will read the
        // school off the users record, so there is nothing to reconcile here.
    } catch (e) {
        console.log("[join] could not update profile for", caller.getId(), e.message);
    }

    rec.set("uses", uses + 1);
    try {
        dao.saveRecord(rec);
    } catch (e) {
        // The join already succeeded; a failed counter bump must not fail the request.
        console.log("[join] could not increment uses for code", code, e.message);
    }

    return c.json(200, { schoolVersion: schoolVersion });
});
