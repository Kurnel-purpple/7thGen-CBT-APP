/// <reference path="../pb_data/types.d.ts" />

/**
 * Demo Account Cleanup Hook
 * Runs every 10 minutes to delete expired demo accounts and their associated data.
 *
 * Demo accounts are identified by school_version starting with "DEMO_".
 * The persistent demo teacher (school_version = "DEMO_PERSISTENT") is never deleted.
 *
 * Format: DEMO_<unix_expiry_ms>_<sessionId>
 */

cronAdd("demo_cleanup", "*/10 * * * *", (c) => {
    const dao = $app.dao();

    console.log("[Demo Cleanup] Running scheduled cleanup...");

    let demoUsers;
    try {
        demoUsers = dao.findRecordsByFilter(
            "users",
            'school_version ~ "DEMO_" && school_version != "DEMO_PERSISTENT"',
            "-created",
            200,  // max records per run
            0
        );
    } catch (e) {
        console.log("[Demo Cleanup] No demo users found or query error:", e.message);
        return;
    }

    if (!demoUsers || demoUsers.length === 0) {
        console.log("[Demo Cleanup] No demo users to clean up.");
        return;
    }

    const now = Date.now();
    let deletedCount = 0;

    for (let i = 0; i < demoUsers.length; i++) {
        const user = demoUsers[i];
        const sv = user.getString("school_version");

        // Extract expiry timestamp: DEMO_<expiry>_<sessionId>
        const parts = sv.split("_");
        if (parts.length < 2) continue;

        const expiry = parseInt(parts[1], 10);
        if (isNaN(expiry) || now < expiry) {
            continue; // Not expired yet
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
