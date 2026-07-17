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
 *   - a plain "admin" may only find / reset users within their OWN school;
 *   - a "super_admin" may act across all schools.
 *
 * Identity data note: full_name / school_version / class_level live
 * authoritatively on the `profiles` collection — `users` auth records may
 * have them blank or not defined at all. Both the search and the school
 * checks therefore consult BOTH collections; filtering on a column that a
 * collection doesn't have throws in PocketBase, so every filter runs in its
 * own try so one missing column can't blank the whole search.
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

    function profileFor(uid) {
        try {
            const rows = dao.findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: uid });
            return rows.length > 0 ? rows[0] : null;
        } catch (e) {
            return null;
        }
    }

    // The admin's school: their users record, falling back to their profile —
    // either may hold it depending on how the account was created.
    let schoolVersion = caller.getString("school_version");
    if (!schoolVersion) {
        const callerProf = profileFor(caller.getId());
        if (callerProf) schoolVersion = callerProf.getString("school_version");
    }

    function sameSchool(u, prof) {
        if (isSuper) return true;
        // Fail closed: an admin with no school on their users record OR
        // profile may not see anyone — otherwise a misconfigured admin
        // account becomes a cross-tenant search key.
        if (!schoolVersion) return false;
        const us = u ? u.getString("school_version") : "";
        const ps = prof ? prof.getString("school_version") : "";
        return us === schoolVersion || ps === schoolVersion;
    }

    function shapeUser(u, prof) {
        return {
            id: u.getId(),
            username: u.getString("username") || (prof ? prof.getString("username") : ""),
            full_name: u.getString("full_name") || (prof ? prof.getString("full_name") : ""),
            role: u.getString("role") || (prof ? prof.getString("role") : ""),
            email: u.getString("email"),
            school_version: u.getString("school_version") || (prof ? prof.getString("school_version") : "")
        };
    }

    const data = info.data || {};
    const userId = (data.userId || "").toString().trim();
    const query = (data.query || "").toString().trim();

    // Direct lookup by id (an admin picked a specific candidate in the UI).
    if (userId) {
        let rec;
        try {
            rec = dao.findRecordById("users", userId);
        } catch (e) {
            throw new NotFoundError("That user is no longer available.");
        }
        const prof = profileFor(rec.getId());
        if (!sameSchool(rec, prof)) {
            throw new ForbiddenError("That user belongs to a different school.");
        }
        return c.json(200, { candidates: [shapeUser(rec, prof)] });
    }

    if (!query) {
        throw new BadRequestError("Please provide a search term.");
    }

    const byId = {}; // userId -> { u, prof }

    // 1. Search the users auth collection — each field in its own filter so
    //    a column that doesn't exist can't blank the others.
    const userFilters = ["username ~ {:q}", "email ~ {:q}", "full_name ~ {:q}"];
    for (let i = 0; i < userFilters.length; i++) {
        try {
            const rows = dao.findRecordsByFilter("users", userFilters[i], "", 8, 0, { q: query });
            for (let j = 0; j < rows.length; j++) {
                byId[rows[j].getId()] = { u: rows[j], prof: null };
            }
        } catch (e) { /* field not on users — skip */ }
    }

    // 2. Search profiles — where full names actually live.
    const profileFilters = ["full_name ~ {:q}", "username ~ {:q}"];
    for (let i = 0; i < profileFilters.length; i++) {
        try {
            const profs = dao.findRecordsByFilter("profiles", profileFilters[i], "full_name", 8, 0, { q: query });
            for (let j = 0; j < profs.length; j++) {
                const uid = profs[j].getString("user");
                if (!uid) continue;
                if (byId[uid]) {
                    byId[uid].prof = profs[j];
                    continue;
                }
                try {
                    const u = dao.findRecordById("users", uid);
                    byId[uid] = { u: u, prof: profs[j] };
                } catch (e) { /* orphaned profile — skip */ }
            }
        } catch (e) { /* field not on profiles — skip */ }
    }

    const candidates = [];
    const ids = Object.keys(byId);
    for (let i = 0; i < ids.length && candidates.length < 8; i++) {
        const pair = byId[ids[i]];
        if (!pair.prof) pair.prof = profileFor(ids[i]);
        if (!sameSchool(pair.u, pair.prof)) continue;
        candidates.push(shapeUser(pair.u, pair.prof));
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

    function profileFor(uid) {
        try {
            const rows = dao.findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: uid });
            return rows.length > 0 ? rows[0] : null;
        } catch (e) {
            return null;
        }
    }

    let schoolVersion = caller.getString("school_version");
    if (!schoolVersion) {
        const callerProf = profileFor(caller.getId());
        if (callerProf) schoolVersion = callerProf.getString("school_version");
    }

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

    // Tenant isolation: the target's school may live on their users record
    // OR their profile — accept either matching the caller's school.
    // Fail closed: an admin with no resolvable school may not reset anyone.
    if (!isSuper) {
        if (!schoolVersion) {
            throw new ForbiddenError("Your admin account has no school assigned — set your School ID first or contact support.");
        }
        const targetProf = profileFor(target.getId());
        const us = target.getString("school_version");
        const ps = targetProf ? targetProf.getString("school_version") : "";
        if (us !== schoolVersion && ps !== schoolVersion) {
            throw new ForbiddenError("You can only reset passwords for users in your own school.");
        }
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
