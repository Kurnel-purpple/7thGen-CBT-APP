/// <reference path="../pb_data/types.d.ts" />

/**
 * Mirror profiles.class_level -> users.class_level on the server.
 *
 * WHY: the exams list/view rule filters what a student sees by the AUTH
 * (users) record's class_level, but class changes (end-of-session promotion,
 * admin corrections) are written to PROFILES — admins may not update other
 * users' auth records, so the client-side mirror attempt always fails and the
 * student keeps receiving the OLD class's exams. This hook runs with server
 * privileges and keeps the users mirror in lockstep.
 *
 * NOTE: v0.21 executes each handler in an isolated goja runtime — no shared
 * outer scope between handlers.
 */

onRecordAfterUpdateRequest((e) => {
    try {
        const cls = e.record.getString("class_level");
        if (!cls) return;
        const userId = e.record.getString("user") || e.record.id;
        const user = $app.dao().findRecordById("users", userId);
        if (user && user.getString("class_level") !== cls) {
            user.set("class_level", cls);
            $app.dao().saveRecord(user);
        }
    } catch (err) {
        // Never block a profile save over the mirror — the nightly/next
        // promotion run or scripts/sync-users-class.js can realign it.
        console.log("[mirror_profile_class] mirror failed:", err);
    }
}, "profiles");
