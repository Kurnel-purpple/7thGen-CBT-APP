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

    // Current scheme: an explicit expiry date. Wrapped because the column does not exist
    // until 1791500200 is deployed, and filtering on a missing column throws.
    try {
        collect(dao.findRecordsByFilter(
            "users",
            'demo_expiry != "" && demo_expiry < {:now}',
            "-created",
            200,
            0,
            { now: new Date(now).toISOString() }
        ));
    } catch (e) {
        console.log("[Demo Cleanup] demo_expiry lookup skipped:", e.message);
    }

    // Legacy scheme: DEMO_<expiryMs>_<sessionId>. Kept until those accounts are gone.
    try {
        collect(dao.findRecordsByFilter(
            "users",
            'school_version ~ "DEMO$_%" && school_version != "DEMO_PERSISTENT"',
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

        // Legacy rows still need their expiry parsed out of school_version. Rows found by
        // demo_expiry are already known to be expired.
        const hasExpiryField = !!user.get("demo_expiry");
        if (!hasExpiryField) {
            if (sv.indexOf("_") === -1) continue; // not a legacy demo school after all
            const parts = sv.split("_");
            if (parts.length < 2) continue;
            const expiry = parseInt(parts[1], 10);
            if (isNaN(expiry) || now < expiry) {
                continue; // Not expired yet
            }
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
