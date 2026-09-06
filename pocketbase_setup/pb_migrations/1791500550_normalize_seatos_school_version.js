/// <reference path="../pb_data/types.d.ts" />

/**
 * Folds the SEATOS school_version variants into one canonical value.
 *
 * MUST run before 1791500600_scope_results.js.
 *
 * 1791500500's backfill revealed that SEATOS exists under three different values:
 *   SEATOSCBT2026  6180 results   <- canonical
 *   Seatoscbt2026   152 results   <- same string, different case
 *   SEATOS2026       11 results   <- older identifier, confirmed same school
 *
 * SQLite compares TEXT with `=` case-sensitively, and every tenancy rule is
 * `school_version = @request.auth.school_version`. So `Seatoscbt2026` is treated as a
 * different school from `SEATOSCBT2026`: those 163 results would disappear from their
 * own teachers' dashboards the moment 1791500600 tightens the results rules.
 *
 * This is not hypothetical for exams — 1791500300 already tightened those, and the
 * variants came from the exams table (the results backfill's first pass filled every
 * row, so none fell through to the student fallback). Whichever side of the split an
 * account sits on, it cannot see the other, which is why this is worth fixing on its
 * own merits and not just as a precondition.
 *
 * Deliberately narrow: it folds ONLY case-variants of SEATOSCBT2026 and SEATOS2026.
 * GEN7DEMO and the landing-page demo values (DEMO_<expiry>_<session>, whose encoded
 * expiry demo_cleanup.pb.js reaps against) are untouched.
 *
 * NOTHING IS DELETED. `tenants` has a UNIQUE index on school_version and app_settings
 * one on (school_version, key), so a variant row can collide with an existing canonical
 * row. Those are left in place and logged rather than merged or dropped — losing a
 * settings row silently is worse than leaving a duplicate for a human to look at.
 */

const CANON = "SEATOSCBT2026";

// Case-insensitive match on either variant, excluding rows already canonical.
const VARIANT =
    "(UPPER(COALESCE(school_version,'')) = 'SEATOSCBT2026'" +
    " OR UPPER(COALESCE(school_version,'')) = 'SEATOS2026')" +
    " AND school_version != '" + CANON + "'";

// Every collection carrying a school_version column. Tables whose column may not exist
// on a given deployment are tolerated — see the try/catch in `fold`.
const SIMPLE_TABLES = [
    "users",
    "profiles",
    "exams",
    "results",
    "messages",
    "homework_assignments",
    "homework_submissions",
    "admission_sessions",
    "admission_candidates",
    "school_join_codes"
];

migrate((db) => {
    function count(sql) {
        const row = new DynamicModel({ "c": 0 });
        try {
            db.newQuery(sql).one(row);
            return row.c;
        } catch (e) {
            return -1; // table or column absent on this deployment
        }
    }

    function fold(table) {
        const before = count("SELECT COUNT(*) AS c FROM " + table + " WHERE " + VARIANT);
        if (before < 0) {
            console.log("[normalize] " + table + ": no school_version column, skipped");
            return;
        }
        if (before === 0) {
            console.log("[normalize] " + table + ": already canonical");
            return;
        }
        try {
            db.newQuery(
                "UPDATE " + table + " SET school_version = {:sv} WHERE " + VARIANT
            ).bind({ sv: CANON }).execute();
            console.log("[normalize] " + table + ": folded " + before + " row(s)");
        } catch (e) {
            console.log("[normalize] " + table + ": FAILED - " + e);
        }
    }

    for (const t of SIMPLE_TABLES) fold(t);

    // --- Constrained tables: update only where it cannot collide ---

    // tenants: UNIQUE(school_version)
    const tenantClash = count(
        "SELECT COUNT(*) AS c FROM tenants WHERE " + VARIANT +
        " AND EXISTS (SELECT 1 FROM tenants t2 WHERE t2.school_version = '" + CANON + "')"
    );
    if (tenantClash > 0) {
        console.log("[normalize] tenants: " + tenantClash +
            " variant row(s) LEFT AS-IS - a '" + CANON + "' tenant already exists. Merge by hand.");
    }
    try {
        db.newQuery(
            "UPDATE tenants SET school_version = {:sv} WHERE " + VARIANT +
            " AND NOT EXISTS (SELECT 1 FROM tenants t2 WHERE t2.school_version = {:sv})"
        ).bind({ sv: CANON }).execute();
    } catch (e) {
        console.log("[normalize] tenants: skipped - " + e);
    }

    // app_settings: UNIQUE(school_version, key)
    const settingsClash = count(
        "SELECT COUNT(*) AS c FROM app_settings s WHERE " +
        VARIANT.replace(/school_version/g, "s.school_version") +
        " AND EXISTS (SELECT 1 FROM app_settings s2 WHERE s2.school_version = '" + CANON +
        "' AND s2.key = s.key)"
    );
    if (settingsClash > 0) {
        console.log("[normalize] app_settings: " + settingsClash +
            " variant row(s) LEFT AS-IS - a canonical row with the same key exists. Merge by hand.");
    }
    try {
        db.newQuery(
            "UPDATE app_settings SET school_version = {:sv} WHERE " + VARIANT +
            " AND NOT EXISTS (SELECT 1 FROM app_settings s2 WHERE s2.school_version = {:sv}" +
            " AND s2.key = app_settings.key)"
        ).bind({ sv: CANON }).execute();
    } catch (e) {
        console.log("[normalize] app_settings: skipped - " + e);
    }

    // --- Report the final split, so 1791500600 can be deployed on evidence ---
    const rows = arrayOf(new DynamicModel({ "school_version": "", "c": 0 }));
    db.newQuery(
        "SELECT COALESCE(school_version,'') AS school_version, COUNT(*) AS c" +
        " FROM results GROUP BY 1 ORDER BY c DESC"
    ).all(rows);
    for (const r of rows) {
        console.log("[normalize] results now: " + (r.school_version || "(blank)") + ": " + r.c);
    }
}, (db) => {
    // No down migration. The previous state was three inconsistent spellings of one
    // school; restoring that has no value, and the mapping back is not recoverable
    // (nothing records which rows were originally which variant).
});
