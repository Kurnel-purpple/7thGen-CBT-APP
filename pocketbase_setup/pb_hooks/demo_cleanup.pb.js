/// <reference path="../pb_data/types.d.ts" />

/**
 * Demo Account Cleanup Hook
 * Runs every 10 minutes to delete expired demo accounts and their associated data.
 *
 * Demo accounts now live in the reserved `GEN7DEMO` school and carry their expiry in a
 * `demo_expiry` date field, stamped server-side by school_join.pb.js. Previously the
 * expiry was smuggled into school_version as `DEMO_<expiryMs>_<sessionId>` and parsed
 * back out here; that scheme is still handled so accounts created before the change are
 * still reaped.
 *
 * Note on the legacy filter: `school_version ~ "DEMO_"` is a SQL LIKE, where `_` is a
 * single-character wildcard — so it also matched unrelated values like "DEMOCBT2026".
 * Those only escaped deletion because of the `parts.length < 2` check below. The legacy
 * branch now requires a literal underscore explicitly rather than relying on that.
 */

cronAdd("demo_cleanup", "*/10 * * * *", (c) => {
    const dao = $app.dao();

    console.log("[Demo Cleanup] Running scheduled cleanup...");

    const now = Date.now();
    const candidates = [];
    const seen = {};

    function collect(rows) {
        if (!rows) return;
        for (let i = 0; i < rows.length; i++) {
            const id = rows[i].getId();
            if (!seen[id]) { seen[id] = true; candidates.push(rows[i]); }
        }
    }

    // Gather candidates with cheap filters, then decide expiry in JS below.
    //
    // The comparison deliberately does NOT happen in the filter any more. Doing
    // `demo_expiry < {:now}` meant relying on how PocketBase compares a date column
    // against a string, and the formats did not agree: values are written
    // space-separated ("2026-07-30 12:00:00.000Z") while toISOString() produces
    // "2026-07-30T12:00:00.000Z". A space sorts before 'T', so every *future* expiry
    // compared as already past and freshly created demo accounts were deleted within
    // minutes — taking their profiles and their ability to log in with them.
    try {
        collect(dao.findRecordsByFilter("users", 'demo_expiry != ""', "-created", 200, 0));
    } catch (e) {
        // demo_expiry does not exist until 1791500200 is deployed, and filtering on a
        // missing column throws.
        console.log("[Demo Cleanup] demo_expiry lookup skipped:", e.message);
    }

    // Legacy scheme: DEMO_<expiryMs>_<sessionId>. A broad contains-match is fine because
    // the loop below refuses to delete anything without a verified expiry — an earlier
    // attempt at `~ "DEMO$_%"` was silently matching nothing, since `~` has no ESCAPE.
    try {
        collect(dao.findRecordsByFilter(
            "users",
            'school_version ~ "DEMO" && school_version != "DEMO_PERSISTENT"',
            "-created",
            200,
            0
        ));
    } catch (e) {
        console.log("[Demo Cleanup] legacy lookup skipped:", e.message);
    }

    if (candidates.length === 0) {
        console.log("[Demo Cleanup] No demo users to clean up.");
        return;
    }

    let deletedCount = 0;

    for (let i = 0; i < candidates.length; i++) {
        const user = candidates[i];
        const sv = user.getString("school_version") || "";

        // Never delete without an explicit, verified expiry in the past. Being returned
        // by either query above is not on its own evidence that an account is expired —
        // both filters are deliberately broad, and an account with a cleared expiry (the
        // persistent demo teacher and student) must survive forever.
        const rawExpiry = user.getString("demo_expiry") || "";
        let expiryMs = NaN;

        if (rawExpiry) {
            // Stored space-separated; Date.parse wants the 'T'.
            expiryMs = Date.parse(rawExpiry.replace(' ', 'T'));
        } else if (sv.indexOf("_") !== -1) {
            // Legacy DEMO_<expiryMs>_<sessionId>. Values without a literal underscore
            // (GEN7DEMO, DEMOCBT2026) fall through and are left alone.
            const parts = sv.split("_");
            if (parts.length >= 2) expiryMs = parseInt(parts[1], 10);
        }

        if (isNaN(expiryMs) || now < expiryMs) {
            continue; // no verifiable expiry, or not due yet
        }

        const userId = user.getId();
        const userRole = user.getString("role");

        console.log("[Demo Cleanup] Deleting expired demo user:", userId, "role:", userRole);

        try {
            // 1. If teacher, delete their exams and associated results
            if (userRole === "teacher") {
                let exams;
                try {
                    exams = dao.findRecordsByFilter(
                        "exams",
                        'created_by = "' + userId + '"',
                        "",
                        500,
                        0
                    );
                } catch (e) {
                    exams = [];
                }

                for (let j = 0; j < exams.length; j++) {
                    const examId = exams[j].getId();

                    // Delete results for this exam
                    try {
                        const results = dao.findRecordsByFilter(
                            "results",
                            'exam_id = "' + examId + '"',
                            "",
                            1000,
                            0
                        );
                        for (let k = 0; k < results.length; k++) {
                            dao.deleteRecord(results[k]);
                        }
                    } catch (e) {
                        // No results for this exam
                    }

                    // Delete the exam
                    dao.deleteRecord(exams[j]);
                }
            }

            // 2. If student, delete their results
            if (userRole === "student") {
                try {
                    const results = dao.findRecordsByFilter(
                        "results",
                        'student_id = "' + userId + '"',
                        "",
                        1000,
                        0
                    );
                    for (let k = 0; k < results.length; k++) {
                        dao.deleteRecord(results[k]);
                    }
                } catch (e) {
                    // No results for this student
                }
            }

            // 3. Delete the user (profile auto-cascades via cascadeDelete)
            dao.deleteRecord(user);
            deletedCount++;

        } catch (e) {
            console.log("[Demo Cleanup] Error deleting user " + userId + ":", e.message);
        }
    }

    console.log("[Demo Cleanup] Finished. Deleted " + deletedCount + " expired demo user(s).");
});
