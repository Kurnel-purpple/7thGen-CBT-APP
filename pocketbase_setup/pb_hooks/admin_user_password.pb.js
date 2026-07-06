/// <reference path="../pb_data/types.d.ts" />

/**
 * Admin User Password Management (server-side)
 *
 * Replaces the old client-side flow that shipped the PocketBase SUPERUSER
 * credentials to the browser (anyone viewing the page source could take over
 * every school's database). These routes run with full server privileges but
 * authorize every action against the CALLER'S OWN token:
 *   - the caller must be an authenticated `users` record, and
 *   - their role must be "admin" or "super_admin".
 *
 * Tenant isolation:
 *   - a plain "admin" may only find / reset users within their OWN
 *     school_version;
 *   - a "super_admin" may act across all schools.
 *
 * Endpoints (auth: the calling admin's normal user token — sent automatically
 * by the PocketBase JS SDK):
 *   POST /api/cbt/admin/find-users     { query } | { userId }  -> { candidates: [...] }
 *   POST /api/cbt/admin/reset-password { userId, newPassword }  -> { success: true }
 *
 * NOTE: v0.21 executes each handler in an isolated goja runtime, so the auth
 * guard and helpers are inlined inside each handler (no shared outer scope).
 */

routerAdd("POST", "/api/cbt/admin/find-users", (c) => {
    const info = $apis.requestInfo(c);
    const caller = info.authRecord;
    if (!caller) {
        throw new UnauthorizedError("You must be signed in.");
    }
    const role = caller.getString("role");
    if (role !== "admin" && role !== "super_admin") {
        throw new ForbiddenError("Only administrators can manage user passwords.");
    }

    const dao = $app.dao();
    const isSuper = role === "super_admin";
    const schoolVersion = caller.getString("school_version");

    const data = info.data || {};
    const userId = (data.userId || "").toString().trim();
    const query = (data.query || "").toString().trim();

    function shapeUser(u) {
        return {
            id: u.getId(),
            username: u.getString("username"),
            full_name: u.getString("full_name"),
            role: u.getString("role"),
            email: u.getString("email"),
            school_version: u.getString("school_version")
        };
    }

    // Direct lookup by id (an admin picked a specific candidate in the UI).
    if (userId) {
        let rec;
        try {
            rec = dao.findRecordById("users", userId);
        } catch (e) {
            throw new NotFoundError("That user is no longer available.");
        }
        if (!isSuper && rec.getString("school_version") !== schoolVersion) {
            throw new ForbiddenError("That user belongs to a different school.");
        }
        return c.json(200, { candidates: [shapeUser(rec)] });
    }

    if (!query) {
        throw new BadRequestError("Please provide a search term.");
    }

    let filter = "(username ~ {:q} || email ~ {:q} || full_name ~ {:q})";
    const params = { q: query };
    if (!isSuper) {
        filter += " && school_version = {:sv}";
        params.sv = schoolVersion;
    }

    let matches = [];
    try {
        matches = dao.findRecordsByFilter("users", filter, "full_name", 8, 0, params);
    } catch (e) {
        matches = [];
    }

    const candidates = [];
    for (let i = 0; i < matches.length; i++) {
        candidates.push(shapeUser(matches[i]));
    }
    return c.json(200, { candidates: candidates });
}, $apis.requireRecordAuth());

routerAdd("POST", "/api/cbt/admin/reset-password", (c) => {
    const info = $apis.requestInfo(c);
    const caller = info.authRecord;
    if (!caller) {
        throw new UnauthorizedError("You must be signed in.");
    }
    const role = caller.getString("role");
    if (role !== "admin" && role !== "super_admin") {
        throw new ForbiddenError("Only administrators can reset user passwords.");
    }

    const dao = $app.dao();
    const isSuper = role === "super_admin";
    const schoolVersion = caller.getString("school_version");

    const data = info.data || {};
    const userId = (data.userId || "").toString().trim();
    const newPassword = (data.newPassword || "").toString();

    if (!userId) {
        throw new BadRequestError("Missing target user.");
    }
    if (newPassword.length < 8) {
        throw new BadRequestError("Password must be at least 8 characters.");
    }

    let target;
    try {
        target = dao.findRecordById("users", userId);
    } catch (e) {
        throw new NotFoundError("User not found.");
    }

    // Tenant isolation: a school admin can only touch users in their own school.
    if (!isSuper && target.getString("school_version") !== schoolVersion) {
        throw new ForbiddenError("You can only reset passwords for users in your own school.");
    }
    // A plain admin may not reset a super_admin account.
    if (target.getString("role") === "super_admin" && !isSuper) {
        throw new ForbiddenError("You are not allowed to reset this account.");
    }

    target.setPassword(newPassword);
    // Invalidate the target's existing sessions/tokens after a reset.
    target.refreshTokenKey();
    dao.saveRecord(target);

    return c.json(200, {
        success: true,
        userId: target.getId(),
        username: target.getString("username"),
        full_name: target.getString("full_name")
    });
}, $apis.requireRecordAuth());
