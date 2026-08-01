/// <reference path="../pb_data/types.d.ts" />

/**
 * Backfills school_version across users, profiles and exams.
 *
 * Why this is needed: school_version is about to become the tenancy boundary, and the
 * API rules read `@request.auth.school_version` — the *users* copy. But as noted in
 * admin_user_password.pb.js, school_version lives authoritatively on `profiles` and is
 * often blank on the users auth record. Tightening the exam rules against a blank value
 * would show those users zero exams.
 *
 * The platform currently has exactly one real client, and essentially every real
 * account belongs to SEATOS, so every account is normalised to SEATOSCBT2026 except:
 *   - the three DEMOCBT2026 accounts made for the feature-tour video work;
 *   - landing-page demo accounts (school_version 'DEMO_<expiry>_<session>'), which
 *     demo_cleanup.pb.js reaps on expiry and must keep their encoded expiry intact;
 *   - super_admin, which is platform-level and not a member of any school.
 *
 * It also re-backfills exams. 1791500000 already ran that backfill, but it read
 * school_version off each exam's creator — and at that point most creators were blank,
 * so most exams stayed unscoped. Re-running it here, after the users rows are correct,
 * is what actually populates them.
 *
 * Idempotent: every statement skips rows already holding the target value.
 */

const SEATOS = "SEATOSCBT2026";
const DEMO_SCHOOL = "DEMOCBT2026";

// Literal underscore in LIKE needs escaping — '_' is a single-character wildcard in
// SQL. Without ESCAPE, 'DEMO_%' also matches 'DEMOCBT2026' and would sweep the video
// demo accounts into SEATOS. (demo_cleanup.pb.js has this same over-match in its
// filter; it is saved only by a later parts.length check.)
const DEMO_PREFIX_CLAUSE = "COALESCE(school_version,'') NOT LIKE 'DEMO$_%' ESCAPE '$'";
const VIDEO_DEMO_USERNAMES = "('DEMOADMIN1','DEMOSTUDENT1','DEMOTEACHER1')";

migrate((db) => {
    function count(sql) {
        const row = new DynamicModel({ "c": 0 });
        db.newQuery(sql).one(row);
        return row.c;
    }

    console.log("[backfill] users blank before:", count("SELECT COUNT(*) AS c FROM users WHERE COALESCE(school_version,'') = ''"));
    console.log("[backfill] exams unscoped before:", count("SELECT COUNT(*) AS c FROM exams WHERE COALESCE(school_version,'') = ''"));

    // 1. Pin the three video demo accounts to the demo school. DEMOTEACHER1 in
    //    particular is currently blank, which is why the demo admin dashboard reports
    //    zero teachers — doing this first also keeps them out of step 2.
    db.newQuery(
        "UPDATE users SET school_version = {:sv}" +
        " WHERE UPPER(COALESCE(username,'')) IN " + VIDEO_DEMO_USERNAMES +
        "   AND COALESCE(school_version,'') != {:sv}"
    ).bind({ sv: DEMO_SCHOOL }).execute();

    db.newQuery(
        "UPDATE profiles SET school_version = {:sv}" +
        " WHERE user IN (SELECT id FROM users WHERE UPPER(COALESCE(username,'')) IN " + VIDEO_DEMO_USERNAMES + ")" +
        "   AND COALESCE(school_version,'') != {:sv}"
    ).bind({ sv: DEMO_SCHOOL }).execute();

    // 2. Everyone else -> SEATOS.
    db.newQuery(
        "UPDATE users SET school_version = {:sv}" +
        " WHERE COALESCE(role,'') != 'super_admin'" +
        "   AND COALESCE(school_version,'') != {:sv}" +
        "   AND COALESCE(school_version,'') != {:demo}" +
        "   AND " + DEMO_PREFIX_CLAUSE +
        "   AND UPPER(COALESCE(username,'')) NOT IN " + VIDEO_DEMO_USERNAMES
    ).bind({ sv: SEATOS, demo: DEMO_SCHOOL }).execute();

    db.newQuery(
        "UPDATE profiles SET school_version = {:sv}" +
        " WHERE COALESCE(role,'') != 'super_admin'" +
        "   AND COALESCE(school_version,'') != {:sv}" +
        "   AND COALESCE(school_version,'') != {:demo}" +
        "   AND " + DEMO_PREFIX_CLAUSE +
        "   AND user NOT IN (SELECT id FROM users WHERE UPPER(COALESCE(username,'')) IN " + VIDEO_DEMO_USERNAMES + ")"
    ).bind({ sv: SEATOS, demo: DEMO_SCHOOL }).execute();

    // 3. Re-backfill exams now that creators are populated. created_by can hold a
    //    UUID, a username or an email on migrated rows — getExams() compensates for
    //    the same thing, so all three are matched or legacy exams stay unscoped.
    db.newQuery(
        "UPDATE exams SET school_version = COALESCE((" +
        "  SELECT u.school_version FROM users u" +
        "  WHERE u.id = exams.created_by" +
        "     OR u.username = exams.created_by" +
        "     OR u.email = exams.created_by" +
        "  LIMIT 1" +
        "), '')" +
        " WHERE COALESCE(school_version,'') = ''"
    ).execute();

    console.log("[backfill] users blank after:", count("SELECT COUNT(*) AS c FROM users WHERE COALESCE(school_version,'') = ''"));
    console.log("[backfill] profiles blank after:", count("SELECT COUNT(*) AS c FROM profiles WHERE COALESCE(school_version,'') = ''"));
    console.log("[backfill] exams unscoped after:", count("SELECT COUNT(*) AS c FROM exams WHERE COALESCE(school_version,'') = ''"));
    console.log("[backfill] exams on SEATOS:", count("SELECT COUNT(*) AS c FROM exams WHERE school_version = '" + SEATOS + "'"));
}, (db) => {
    // No down migration: the previous values were blank or inconsistent, and restoring
    // that state has no value while losing the corrected data would.
});
