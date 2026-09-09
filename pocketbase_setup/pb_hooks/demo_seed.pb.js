/// <reference path="../pb_data/types.d.ts" />

/**
 * Demo tenant seeder — POST /api/cbt/demo/reset
 *
 * Wipes and rebuilds the DEMOCBT2026 pitch tenant so every feature of the app is
 * populated and demonstrable: two live exams, a session of history, published report
 * cards, a filled 3rd-term broadsheet, attendance sheets part-marked, homework in both
 * states, a stocked question bank, and a flagged question waiting in the review queue.
 *
 * It exists so a pitch can be run, poked at, and then reset to a known state before the
 * next one — taking a demo exam or resolving a demo flag would otherwise be a one-shot
 * action.
 *
 * ---------------------------------------------------------------------------
 * SAFETY
 * ---------------------------------------------------------------------------
 * This endpoint deletes data. Three independent guards stand in front of it:
 *
 *   1. The target tenant is a hardcoded constant, checked against a deny-list of
 *      real tenants. It cannot be supplied by the caller in any form.
 *   2. The caller must be a PocketBase superuser, or an admin whose own
 *      school_version IS the demo tenant.
 *   3. Deletion runs against an explicit collection allow-list, always filtered by
 *      the tenant, never a wildcard.
 *
 * `attendance` and `attendance_marks` carry school_version only since 1791500700, so
 * rows predating it could be unstamped. Those two are additionally swept by the demo
 * roster's own ids, resolved before anything is deleted.
 *
 * ---------------------------------------------------------------------------
 * WHY EVERYTHING IS IN ONE FUNCTION
 * ---------------------------------------------------------------------------
 * PocketBase's JSVM serialises each handler and re-evaluates it in an isolated
 * context, so a handler cannot see anything declared in this file's outer scope.
 * result_school_stamp.pb.js was broken for exactly this reason. Helpers are therefore
 * declared INSIDE the handler, where they are visible. Do not lift them out.
 *
 * ---------------------------------------------------------------------------
 * DATES ARE RELATIVE, NEVER HARDCODED
 * ---------------------------------------------------------------------------
 * The academic calendar is derived from the moment the reset runs: the current session
 * and term come from the month, and the completed session is the one before it. An
 * assignment "nobody has answered yet" is only convincing while its deadline is still
 * in the future, so every date is an offset from now. The demo does not go stale.
 */

routerAdd("POST", "/api/cbt/demo/reset", (c) => {

    // =========================================================================
    // CONSTANTS
    // =========================================================================
    const TENANT = "DEMOCBT2026";
    const SCHOOL_NAME = "GEN7TECH";
    const PROXY_DOMAIN = "school.cbt";   // dataService._generateEmail
    const CLASS_LEVEL = "JSS3";
    const SCHOOL_LEVEL = "Junior Secondary";
    const DEMO_PASSWORD = "Gen7Demo!2026";

    // Tenants this endpoint must never touch, whatever else changes.
    const PROTECTED = ["SEATOSCBT2026", "GEN7DEMO", "DEMO_PERSISTENT", ""];

    if (PROTECTED.indexOf(TENANT) !== -1) {
        throw new BadRequestError("Demo reset refused: target tenant is a protected value.");
    }

    // =========================================================================
    // GUARD — who may call this
    // =========================================================================
    const info = $apis.requestInfo(c);
    const superuser = info.admin;         // PocketBase superuser (bootstraps the first run)
    const caller = info.authRecord;

    if (!superuser) {
        if (!caller) {
            throw new UnauthorizedError("Sign in as the demo admin to reset the demo data.");
        }
        const role = caller.getString("role") || "";
        if (role !== "admin" && role !== "super_admin") {
            throw new ForbiddenError("Only an admin can reset the demo data.");
        }
        if (role !== "super_admin" && (caller.getString("school_version") || "") !== TENANT) {
            throw new ForbiddenError("Demo reset is only available inside the demo school.");
        }
    }

    const dao = $app.dao();

    // =========================================================================
    // HELPERS (declared here deliberately — see header)
    // =========================================================================

    // findRecordsByFilter caps its page size, so anything that can exceed a few
    // hundred rows has to be walked.
    function findAll(collection, filter) {
        const out = [];
        let offset = 0;
        for (let guard = 0; guard < 100; guard++) {
            let batch;
            try {
                batch = dao.findRecordsByFilter(collection, filter, "", 500, offset);
            } catch (err) {
                break; // collection missing on this server — nothing to do
            }
            if (!batch || batch.length === 0) break;
            for (let i = 0; i < batch.length; i++) out.push(batch[i]);
            if (batch.length < 500) break;
            offset += 500;
        }
        return out;
    }

    function wipe(collection, filter) {
        const rows = findAll(collection, filter);
        let n = 0;
        for (let i = 0; i < rows.length; i++) {
            try { dao.deleteRecord(rows[i]); n++; } catch (err) { /* already gone */ }
        }
        return n;
    }

    function quoteList(ids) {
        const parts = [];
        for (let i = 0; i < ids.length; i++) parts.push('"' + ids[i] + '"');
        return parts.join(",");
    }

    // null/undefined are skipped rather than written: setting null on a relation or a
    // date field can be rejected outright, and "field absent" is what the app's own
    // writers produce for an ungraded submission or an unpublished card anyway.
    function newRecord(collectionName, fields) {
        const col = dao.findCollectionByNameOrId(collectionName);
        const rec = new Record(col);
        for (const k in fields) {
            if (fields[k] === null || fields[k] === undefined) continue;
            rec.set(k, fields[k]);
        }
        dao.saveRecord(rec);
        return rec;
    }

    function iso(d) { return d.toISOString(); }
    function isoDate(d) { return d.toISOString().slice(0, 10); }
    function daysFrom(base, n) {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + n);
        return d;
    }

    // Deterministic pseudo-random in [0,1). Seeded by the row's own coordinates, so a
    // reset reproduces exactly the same numbers — a demo that reads differently every
    // time invites questions about whether the data is real.
    function rand(a, b, cc) {
        let x = ((a + 1) * 73856093) ^ ((b + 1) * 19349663) ^ ((cc + 1) * 83492791);
        x = Math.abs(x % 100000);
        return x / 100000;
    }

    function gradeFor(pct) {
        if (pct >= 96) return { letter: "A++", label: "Outstanding" };
        if (pct >= 91) return { letter: "A+", label: "Excellent" };
        if (pct >= 80) return { letter: "A", label: "Very Good" };
        if (pct >= 70) return { letter: "B+", label: "Good" };
        if (pct >= 60) return { letter: "B", label: "Credit" };
        if (pct >= 50) return { letter: "C+", label: "Pass" };
        return { letter: "C", label: "Weak" };
    }

    // =========================================================================
    // CALENDAR — derived from now (see header)
    // =========================================================================
    const now = new Date();
    const month = now.getMonth();          // 0-11
    const year = now.getFullYear();

    // Nigerian academic year opens in September.
    const sessionStartYear = month >= 8 ? year : year - 1;
    const CURRENT_SESSION = sessionStartYear + "/" + (sessionStartYear + 1);
    const PAST_SESSION = (sessionStartYear - 1) + "/" + sessionStartYear;

    let CURRENT_TERM;
    if (month >= 8 && month <= 11) CURRENT_TERM = "1st Term";
    else if (month >= 0 && month <= 3) CURRENT_TERM = "2nd Term";
    else CURRENT_TERM = "3rd Term";

    const PAST_TERMS = ["1st Term", "2nd Term", "3rd Term"];

    // =========================================================================
    // FIXTURE DATA
    // =========================================================================
    const SUBJECTS = [
        "Mathematics", "English Language", "Basic Science", "Basic Technology",
        "Social Studies", "Civic Education", "Computer Studies", "Agricultural Science"
    ];

    // 14 students: enough that a broadsheet reads like a class rather than a fixture.
    // The first is the account you log in as during a cross-role walkthrough, so it
    // must be a real roster member with a full history like everyone else.
    const STUDENTS = [
        { user: "demo.student", name: "Chidi Nwosu", ability: 14 },
        { user: "demo.adaeze", name: "Adaeze Okonkwo", ability: 20 },
        { user: "demo.bola", name: "Bola Adeyemi", ability: 6 },
        { user: "demo.damilola", name: "Damilola Ogunleye", ability: 17 },
        { user: "demo.emeka", name: "Emeka Obi", ability: -2 },
        { user: "demo.fatima", name: "Fatima Bello", ability: 22 },
        { user: "demo.gbenga", name: "Gbenga Alabi", ability: 3 },
        { user: "demo.halima", name: "Halima Yusuf", ability: 11 },
        { user: "demo.ifeoma", name: "Ifeoma Eze", ability: 18 },
        { user: "demo.jide", name: "Jide Balogun", ability: -5 },
        { user: "demo.kemi", name: "Kemi Adebayo", ability: 9 },
        { user: "demo.lanre", name: "Lanre Ojo", ability: 1 },
        { user: "demo.maryam", name: "Maryam Sani", ability: 13 },
        { user: "demo.ngozi", name: "Ngozi Uche", ability: 7 }
    ];

    // The five with the deepest paperwork — report cards across all three past terms,
    // homework submissions, the fullest attendance record.
    const DEEP = 5;

    const TEACHER_REMARKS = [
        "A consistently strong term. Contributes well in class and submits work on time.",
        "Good progress this term. More attention to written expression would lift the average further.",
        "Capable but inconsistent. Regular revision would close the gap between test and exam scores.",
        "Excellent attitude to learning. Continues to set a good example for the class.",
        "A solid term overall. Should be encouraged to ask questions when a topic is unclear."
    ];
    const PRINCIPAL_REMARKS = [
        "An impressive result. Keep it up next session.",
        "A promising performance. Sustained effort will bring further improvement.",
        "Satisfactory. There is clear room to do better next term.",
        "Very well done. A pleasing report.",
        "Fair result. More consistency is expected next term."
    ];

    // Two live exams get real question sets — these are the ones a client will click
    // into, and the ones the question bank is stocked from.
    const LIVE_QUESTIONS = {
        "Mathematics": [
            { text: "Simplify: 3x + 5x - 2x", options: ["4x", "6x", "8x", "10x"], answer: "6x",
              explanation: "Collect like terms: 3x + 5x = 8x, then 8x - 2x = 6x." },
            { text: "What is 15% of 240?", options: ["24", "30", "36", "40"], answer: "36",
              explanation: "15% of 240 = 0.15 x 240 = 36." },
            { text: "The angles of a triangle sum to:", options: ["90 degrees", "180 degrees", "270 degrees", "360 degrees"], answer: "180 degrees",
              explanation: "The interior angles of any triangle always total 180 degrees." },
            { text: "Solve for y: 4y - 8 = 12", options: ["3", "4", "5", "6"], answer: "5",
              explanation: "4y = 20, so y = 5." },
            { text: "Which of these is a prime number?", options: ["21", "27", "29", "33"], answer: "29",
              explanation: "29 has no divisors other than 1 and itself." },
            { text: "Find the area of a rectangle 12cm by 7cm.", options: ["19 sq cm", "38 sq cm", "84 sq cm", "94 sq cm"], answer: "84 sq cm",
              explanation: "Area = length x breadth = 12 x 7 = 84 sq cm." },
            { text: "Express 0.75 as a fraction in its lowest terms.", options: ["3/4", "7/5", "4/3", "75/10"], answer: "3/4",
              explanation: "0.75 = 75/100 = 3/4." },
            { text: "What is the value of 2 raised to power 5?", options: ["10", "16", "25", "32"], answer: "32",
              explanation: "2x2x2x2x2 = 32." },
            { text: "The perimeter of a square of side 9cm is:", options: ["18cm", "27cm", "36cm", "81cm"], answer: "36cm",
              explanation: "Perimeter = 4 x side = 4 x 9 = 36cm." },
            { text: "Which number is the median of 4, 8, 6, 10, 2?", options: ["4", "6", "8", "10"], answer: "6",
              explanation: "Ordered: 2, 4, 6, 8, 10. The middle value is 6." }
        ],
        "Basic Science": [
            { text: "Which gas do plants absorb during photosynthesis?", options: ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], answer: "Carbon dioxide",
              explanation: "Plants take in carbon dioxide and release oxygen during photosynthesis." },
            { text: "The basic unit of life is the:", options: ["Atom", "Cell", "Tissue", "Organ"], answer: "Cell",
              explanation: "All living organisms are made up of one or more cells." },
            { text: "Water boils at what temperature at sea level?", options: ["50 degrees C", "90 degrees C", "100 degrees C", "150 degrees C"], answer: "100 degrees C",
              explanation: "At standard atmospheric pressure water boils at 100 degrees Celsius." },
            { text: "Which organ pumps blood around the body?", options: ["Liver", "Heart", "Lung", "Kidney"], answer: "Heart",
              explanation: "The heart is a muscular pump that circulates blood." },
            { text: "A substance made of only one kind of atom is called:", options: ["A mixture", "A compound", "An element", "A solution"], answer: "An element",
              explanation: "Elements contain only one type of atom." },
            { text: "The force that pulls objects towards the earth is:", options: ["Friction", "Gravity", "Tension", "Magnetism"], answer: "Gravity",
              explanation: "Gravity is the attractive force exerted by the earth on objects." },
            { text: "Which of these is a renewable source of energy?", options: ["Coal", "Petrol", "Solar", "Diesel"], answer: "Solar",
              explanation: "Solar energy is replenished continuously by the sun." },
            { text: "The process by which a liquid changes to gas is:", options: ["Condensation", "Evaporation", "Freezing", "Melting"], answer: "Evaporation",
              explanation: "Evaporation converts a liquid into vapour." },
            { text: "How many bones are in the adult human body?", options: ["106", "186", "206", "306"], answer: "206",
              explanation: "An adult human skeleton has 206 bones." },
            { text: "Which part of the plant absorbs water from the soil?", options: ["Leaf", "Stem", "Root", "Flower"], answer: "Root",
              explanation: "Roots take up water and dissolved minerals from the soil." }
        ]
    };

    const GENERAL_INSTRUCTIONS =
        "Answer ALL questions. Each question carries equal marks. " +
        "You may use the question navigator to move between questions and flag any " +
        "question you wish to return to. Your answers are saved automatically. " +
        "Click Submit when you have finished, or the exam will submit itself when the " +
        "timer reaches zero.";

    // =========================================================================
    // EXECUTION
    //
    // Everything below runs inside one try/catch. PocketBase turns an uncaught error
    // in a route handler into a bare 400 with an empty data object and logs nothing
    // at all, which makes a failure anywhere in ~700 lines completely undiagnosable.
    // `step` is updated at each phase so a failure reports where it happened as well
    // as what went wrong.
    // =========================================================================
    let step = "teardown";
    try {

    // =========================================================================
    // 1. TEARDOWN
    // =========================================================================
    const F = 'school_version = "' + TENANT + '"';

    // Resolve the roster BEFORE deleting anything — attendance and attendance_marks
    // may hold rows that predate school_version and can only be found by student id.
    const existingUsers = findAll("users", F);
    const existingIds = [];
    for (let i = 0; i < existingUsers.length; i++) existingIds.push(existingUsers[i].getId());

    const removed = {};
    removed.results = wipe("results", F);
    removed.report_cards = wipe("report_cards", F);
    removed.question_bank_questions = wipe("question_bank_questions", F);
    removed.homework_submissions = wipe("homework_submissions", F);
    removed.homework_assignments = wipe("homework_assignments", F);
    removed.attendance_marks = wipe("attendance_marks", F);
    removed.attendance_sheets = wipe("attendance_sheets", F);
    removed.subject_registrations = wipe("subject_registrations", F);
    removed.attendance = wipe("attendance", F);
    removed.messages = wipe("messages", F);
    removed.exams = wipe("exams", F);
    removed.app_settings = wipe("app_settings", F);

    // Second sweep for the two collections that were unscoped before 1791500700, plus
    // anything a demo account created that missed its stamp.
    if (existingIds.length > 0) {
        const idList = quoteList(existingIds);
        removed.attendance += wipe("attendance", "student_id IN (" + idList + ")");
        removed.attendance_marks += wipe("attendance_marks", "student_id IN (" + idList + ")");
        removed.results += wipe("results", "student_id IN (" + idList + ")");
        removed.messages += wipe("messages", "from_id IN (" + idList + ") || to_id IN (" + idList + ")");
    }

    removed.profiles = wipe("profiles", F);
    removed.users = wipe("users", F);

    // =========================================================================
    // 2. TENANT
    // =========================================================================
    step = "tenant";
    const ALL_MODULES = [
        "cbt", "attendance", "report_cards", "broadsheet",
        "homework", "question_bank", "admissions"
    ];

    let tenantRec = null;
    try {
        const rows = findAll("tenants", F);
        tenantRec = rows.length > 0 ? rows[0] : null;
    } catch (err) { /* tenants collection absent */ }

    try {
        if (tenantRec) {
            tenantRec.set("name", SCHOOL_NAME);
            tenantRec.set("plan", "enterprise");
            tenantRec.set("status", "active");
            tenantRec.set("modules_enabled", ALL_MODULES);
            dao.saveRecord(tenantRec);
        } else {
            newRecord("tenants", {
                school_version: TENANT,
                name: SCHOOL_NAME,
                plan: "enterprise",
                status: "active",
                modules_enabled: ALL_MODULES
            });
        }
    } catch (err) {
        console.log("[demo_seed] tenant row skipped: " + err);
    }

    // =========================================================================
    // 3. ACCOUNTS
    // =========================================================================
    step = "accounts";
    const usersCol = dao.findCollectionByNameOrId("users");

    function makeAccount(username, fullName, role, classLevel) {
        const u = new Record(usersCol);
        // username is required AND unique on an auth collection. Creating through the
        // REST API gets one auto-generated by PocketBase's form layer, but this saves
        // straight through the DAO, which skips that entirely — leaving every account
        // with a blank username, and the second one colliding on the unique index.
        // Dots are not valid in a PocketBase username, so the account names are
        // normalised here while the login email keeps its dotted form.
        u.setUsername(username.replace(/\./g, "_"));
        u.setEmail(username + "@" + PROXY_DOMAIN);
        u.setPassword(DEMO_PASSWORD);
        u.setVerified(true);
        u.set("emailVisibility", false);
        u.set("role", role);
        u.set("full_name", fullName);
        u.set("school_version", TENANT);
        if (classLevel) u.set("class_level", classLevel);
        dao.saveRecord(u);

        // profiles.id mirrors the user id — dataService.registerUser creates it that
        // way and parts of the admin dashboard look profiles up by that id.
        try {
            const pcol = dao.findCollectionByNameOrId("profiles");
            const p = new Record(pcol);
            p.setId(u.getId());
            p.set("user", u.getId());
            p.set("role", role);
            p.set("full_name", fullName);
            p.set("school_version", TENANT);
            if (classLevel) p.set("class_level", classLevel);
            dao.saveRecord(p);
        } catch (err) {
            console.log("[demo_seed] profile for " + username + " failed: " + err);
        }
        return u;
    }

    const adminRec = makeAccount("demo.admin", "Demo Administrator", "admin", null);
    const teacherRec = makeAccount("demo.teacher", "Mrs. Folake Adewale", "teacher", null);
    const teacherId = teacherRec.getId();
    const teacherName = teacherRec.getString("full_name");

    const studentRecs = [];
    for (let i = 0; i < STUDENTS.length; i++) {
        studentRecs.push(makeAccount(STUDENTS[i].user, STUDENTS[i].name, "student", CLASS_LEVEL));
    }

    // =========================================================================
    // 4. EXAMS
    //
    // Historical exams are lightweight shells: grading reads score and totalPoints off
    // the RESULT, never the exam's questions, so a full question set on 24 archived
    // papers would be dead weight on a 1GB node. They are archived rather than deleted
    // because generateReportCardData excludes results whose exam is soft-deleted — and
    // archived keeps them off the main dashboard while still clickable.
    //
    // Titles MUST carry the term signature. There is no `term` column on results, so
    // the report card engine bins a result by parsing its exam title. No signature,
    // no broadsheet session column.
    // =========================================================================
    step = "exams";
    const examIdBySubjectTerm = {};
    let examCount = 0;

    for (let t = 0; t < PAST_TERMS.length; t++) {
        for (let s = 0; s < SUBJECTS.length; s++) {
            const title = PAST_TERMS[t] + " " + SUBJECTS[s] + " Examination";
            const rec = newRecord("exams", {
                title: title,
                subject: SUBJECTS[s],
                target_class: CLASS_LEVEL,
                school_level: SCHOOL_LEVEL,
                duration: 45,
                pass_score: 50,
                instructions: GENERAL_INSTRUCTIONS,
                questions: [],
                status: "archived",
                created_by: teacherId,
                scramble_questions: false,
                school_version: TENANT,
                client_id: "demo_hist_" + t + "_" + s
            });
            examIdBySubjectTerm[PAST_TERMS[t] + "|" + SUBJECTS[s]] = {
                id: rec.getId(), title: title, subject: SUBJECTS[s]
            };
            examCount++;
        }
    }

    // Two live exams for the current term, with real question sets.
    function buildQuestions(subject) {
        const src = LIVE_QUESTIONS[subject] || [];
        const out = [];
        for (let i = 0; i < src.length; i++) {
            out.push({
                id: "q" + (i + 1),
                type: "multiple-choice",
                text: src[i].text,
                options: src[i].options,
                answer: src[i].answer,
                explanation: src[i].explanation,
                points: 10
            });
        }
        return out;
    }

    const liveExams = [];
    const liveSpecs = [
        { subject: "Mathematics", offset: 3 },
        { subject: "Basic Science", offset: 8 }
    ];
    for (let i = 0; i < liveSpecs.length; i++) {
        const spec = liveSpecs[i];
        const title = CURRENT_TERM + " " + spec.subject + " Examination";
        const rec = newRecord("exams", {
            title: title,
            subject: spec.subject,
            target_class: CLASS_LEVEL,
            school_level: SCHOOL_LEVEL,
            duration: 40,
            pass_score: 50,
            instructions: GENERAL_INSTRUCTIONS,
            theory_instructions: "Answer any TWO questions from this section. Write clearly.",
            questions: buildQuestions(spec.subject),
            status: "active",
            created_by: teacherId,
            scheduled_date: isoDate(daysFrom(now, spec.offset)),
            scramble_questions: i === 1,
            school_version: TENANT,
            client_id: "demo_live_" + i
        });
        liveExams.push({ id: rec.getId(), title: title, subject: spec.subject });
        examCount++;
    }

    // One recently archived exam for the current term — the "1 archived" on the
    // dashboard, distinct from the previous session's history.
    const recentArchived = newRecord("exams", {
        title: CURRENT_TERM + " Computer Studies Continuous Assessment",
        subject: "Computer Studies",
        target_class: CLASS_LEVEL,
        school_level: SCHOOL_LEVEL,
        duration: 25,
        pass_score: 50,
        instructions: GENERAL_INSTRUCTIONS,
        questions: [],
        status: "archived",
        created_by: teacherId,
        scramble_questions: false,
        school_version: TENANT,
        client_id: "demo_recent_archived"
    });
    examCount++;

    // =========================================================================
    // 5. RESULTS
    //
    // result.score is a PERCENTAGE (0-100), not raw marks — the report card engine
    // recovers raw points as (score / 100) * totalPoints. Seeding marks here instead
    // of a percentage silently skews every subject total.
    //
    // Each paper is out of 100: CA out of 40, exam out of 60. flags._caScore and
    // flags._caTotal drive the report card's "CA / 40 | Exam / 60" columns.
    // =========================================================================
    function scoreFor(studentIdx, subjectIdx, termIdx) {
        const base = 52 + STUDENTS[studentIdx].ability;
        const swing = Math.round(rand(studentIdx, subjectIdx, termIdx) * 22) - 8;
        let pct = base + swing + (termIdx * 2); // gentle improvement across the session
        if (pct < 38) pct = 38;
        if (pct > 97) pct = 97;
        return pct;
    }

    step = "results";
    let resultCount = 0;

    function writeResult(examMeta, studentIdx, pct, submittedAt, extraFlags) {
        const total = 100;
        const raw = Math.round(pct); // total = 100, so raw points equal the percentage
        // CA is capped at 40 and can never exceed what was actually scored.
        let ca = Math.round(raw * 0.38);
        if (ca > 40) ca = 40;
        if (ca > raw) ca = raw;

        const flags = {
            _status: "completed",
            _studentName: STUDENTS[studentIdx].name,
            _caScore: ca,
            _caTotal: 40
        };
        if (extraFlags) {
            for (const k in extraFlags) flags[k] = extraFlags[k];
        }

        newRecord("results", {
            exam_id: examMeta.id,
            student_id: studentRecs[studentIdx].getId(),
            score: pct,
            total_points: total,
            pass_score: 50,
            passed: pct >= 50,
            answers: {},
            submitted_at: submittedAt,
            exam_title: examMeta.title,
            exam_subject: examMeta.subject,
            exam_target_class: CLASS_LEVEL,
            exam_duration: 45,
            exam_has_theory: false,
            exam_theory_count: 0,
            flags: flags,
            school_version: TENANT
        });
        resultCount++;
    }

    // A full session of history: every student, every subject, all three past terms.
    // This is what fills the 3rd term broadsheet's cumulative session columns, which
    // are recomputed from raw results rather than read off saved report cards.
    for (let t = 0; t < PAST_TERMS.length; t++) {
        // Roughly: 1st term ~10 months ago, 2nd ~6, 3rd ~3.
        const monthsAgo = [10, 6, 3][t];
        const when = new Date(now.getTime());
        when.setMonth(when.getMonth() - monthsAgo);

        for (let s = 0; s < SUBJECTS.length; s++) {
            const meta = examIdBySubjectTerm[PAST_TERMS[t] + "|" + SUBJECTS[s]];
            for (let i = 0; i < STUDENTS.length; i++) {
                writeResult(meta, i, scoreFor(i, s, t), iso(when));
            }
        }
    }

    // Current term: nine students have sat the live Mathematics paper, five have not —
    // so the teacher's results view shows partial completion, and demo.student can sit
    // it live during a walkthrough.
    const takenBy = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const recentWhen = iso(daysFrom(now, -2));
    for (let k = 0; k < takenBy.length; k++) {
        const idx = takenBy[k];
        // One flagged question left unresolved, waiting in the teacher's Flag Review.
        const extra = (k === 0)
            ? { _flaggedQuestions: ["q4"], _flagNote: "Question 4 may have two correct options." }
            : null;
        writeResult(liveExams[0], idx, scoreFor(idx, 0, 2), recentWhen, extra);
    }

    // =========================================================================
    // 6. REPORT CARDS
    //
    // Shape mirrors generateReportCardData exactly — subjects[] entries and the
    // class_position/class_size ranking. A card whose subject entries are shaped
    // differently saves fine and renders blank.
    // =========================================================================
    step = "report_cards";
    let cardCount = 0;

    function buildCards(termIdx, publish) {
        const term = PAST_TERMS[termIdx];
        const cards = [];

        for (let i = 0; i < STUDENTS.length; i++) {
            const subjects = [];
            let totalScore = 0;
            let pctSum = 0;

            for (let s = 0; s < SUBJECTS.length; s++) {
                const pct = scoreFor(i, s, termIdx);
                const raw = Math.round(pct);
                let ca = Math.round(raw * 0.38);
                if (ca > 40) ca = 40;
                if (ca > raw) ca = raw;
                const g = gradeFor(pct);
                subjects.push({
                    name: SUBJECTS[s],
                    score: raw,
                    caScore: ca,
                    caTotal: 40,
                    examScore: raw - ca,
                    examTotal: 60,
                    totalPossible: 100,
                    percentage: pct,
                    grade: g.letter,
                    gradeLabel: g.label,
                    examCount: 1
                });
                totalScore += raw;
                pctSum += pct;
            }
            subjects.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });

            const avg = Math.round(pctSum / SUBJECTS.length);
            const present = 52 + Math.round(rand(i, termIdx, 7) * 8);
            const absent = Math.round(rand(i, termIdx, 11) * 4);
            const late = Math.round(rand(i, termIdx, 13) * 3);
            const totalDays = present + absent + late;

            cards.push({
                studentIdx: i,
                subjects: subjects,
                totalScore: totalScore,
                averageScore: avg,
                attendance: {
                    present: present,
                    absent: absent,
                    late: late,
                    excused: 0,
                    totalDays: totalDays,
                    attendanceRate: Math.round((present / totalDays) * 100)
                }
            });
        }

        // Rank on average, ties share a position — same rule the app applies.
        const sorted = cards.slice().sort(function (a, b) { return b.averageScore - a.averageScore; });
        for (let k = 0; k < sorted.length; k++) {
            if (k > 0 && sorted[k].averageScore === sorted[k - 1].averageScore) {
                sorted[k].classPosition = sorted[k - 1].classPosition;
            } else {
                sorted[k].classPosition = k + 1;
            }
            sorted[k].classSize = cards.length;
        }

        for (let k = 0; k < cards.length; k++) {
            const cd = cards[k];
            const i = cd.studentIdx;
            newRecord("report_cards", {
                student_id: studentRecs[i].getId(),
                student_name: STUDENTS[i].name,
                class_level: CLASS_LEVEL,
                term: term,
                session: PAST_SESSION,
                school_version: TENANT,
                subjects: cd.subjects,
                total_score: cd.totalScore,
                average_score: cd.averageScore,
                class_position: cd.classPosition,
                class_size: cd.classSize,
                attendance: cd.attendance,
                teacher_remarks: TEACHER_REMARKS[i % TEACHER_REMARKS.length],
                principal_remarks: PRINCIPAL_REMARKS[cd.classPosition % PRINCIPAL_REMARKS.length],
                status: publish ? "published" : "draft",
                generated_by: teacherId,
                generated_at: iso(now),
                published_at: publish ? iso(daysFrom(now, -20)) : null
            });
            cardCount++;
        }
    }

    // The whole class gets a published 3rd term card — that is the one a student opens
    // as "last term's report" and the one the teacher's compiled list shows.
    buildCards(2, true);
    // The deep history that makes the session columns meaningful.
    buildCards(0, true);
    buildCards(1, true);

    // =========================================================================
    // 7. ATTENDANCE
    // Recent columns are deliberately left unmarked so marking can be demonstrated.
    // =========================================================================
    step = "attendance";
    let sheetCount = 0, markCount = 0, regCount = 0;

    function buildSheet(kind, subject, columns) {
        const rec = newRecord("attendance_sheets", {
            kind: kind,
            teacher_id: teacherId,
            teacher_name: teacherName,
            class_level: CLASS_LEVEL,
            subject: subject,
            term: CURRENT_TERM,
            session: CURRENT_SESSION,
            school_version: TENANT,
            columns: columns,
            manual_roster: []
        });
        sheetCount++;
        return rec.getId();
    }

    // Subject sheet — twelve periods, the last three left blank.
    const subjectColumns = [];
    for (let i = 0; i < 12; i++) {
        subjectColumns.push({
            key: "s-" + (i + 1),
            label: "Session " + (i + 1),
            date: isoDate(daysFrom(now, -(36 - i * 3)))
        });
    }
    const subjectSheetId = buildSheet("subject", "Mathematics", subjectColumns);

    // Form sheet — the last four school days, all marked but today.
    const formColumns = [];
    for (let i = 9; i >= 0; i--) {
        const d = daysFrom(now, -i);
        const day = d.getDay();
        if (day === 0 || day === 6) continue;
        formColumns.push({ key: "d-" + isoDate(d), label: isoDate(d), date: isoDate(d) });
    }
    const formSheetId = buildSheet("form", "", formColumns);

    // The sheet vocabulary is present | absent | ph (public holiday) | mtb (mid-term
    // break) — there is no "late". Seeding one produced marks the grid could not
    // render and the student stat cards could not count.
    const MARK_STATES = ["present", "present", "present", "present",
                         "present", "present", "absent", "present"];

    function markSheet(sheetId, columns, leaveBlank) {
        const upTo = columns.length - leaveBlank;
        for (let ci = 0; ci < upTo; ci++) {
            for (let i = 0; i < STUDENTS.length; i++) {
                const pick = Math.floor(rand(i, ci, 3) * MARK_STATES.length);
                newRecord("attendance_marks", {
                    sheet_id: sheetId,
                    student_id: studentRecs[i].getId(),
                    column_key: columns[ci].key,
                    date: columns[ci].date,
                    status: MARK_STATES[pick],
                    marked_by: teacherId,
                    marked_at: iso(new Date(columns[ci].date)),
                    school_version: TENANT
                });
                markCount++;
            }
        }
    }

    markSheet(subjectSheetId, subjectColumns, 3);
    markSheet(formSheetId, formColumns, 1);

    // Registrations — everyone on Mathematics, so the subject sheet has a roster.
    for (let i = 0; i < STUDENTS.length; i++) {
        newRecord("subject_registrations", {
            student_id: studentRecs[i].getId(),
            student_name: STUDENTS[i].name,
            class_level: CLASS_LEVEL,
            subject: "Mathematics",
            term: CURRENT_TERM,
            session: CURRENT_SESSION,
            school_version: TENANT
        });
        regCount++;
    }

    // =========================================================================
    // 8. HOMEWORK — one awaiting responses, one already answered and part-graded
    // =========================================================================
    step = "homework";
    const pendingHw = newRecord("homework_assignments", {
        title: "Algebra Practice: Simplifying Expressions",
        subject: "Mathematics",
        target_class: CLASS_LEVEL,
        due_date: iso(daysFrom(now, 6)),
        points: 20,
        instructions: "<p>Complete <strong>questions 1 to 12</strong> on page 84 of your " +
            "textbook. Show all working. Submit your answers here before the deadline.</p>",
        status: "published",
        created_by: teacherId,
        created_by_name: teacherName,
        school_version: TENANT,
        client_id: "demo_hw_pending"
    });

    const gradedHw = newRecord("homework_assignments", {
        title: "Photosynthesis: Short Answer Questions",
        subject: "Basic Science",
        target_class: CLASS_LEVEL,
        due_date: iso(daysFrom(now, -4)),
        points: 20,
        instructions: "<p>In your own words, explain the process of photosynthesis. " +
            "Your answer should mention <em>chlorophyll</em>, <em>carbon dioxide</em>, " +
            "<em>water</em> and <em>sunlight</em>.</p>",
        status: "published",
        created_by: teacherId,
        created_by_name: teacherName,
        school_version: TENANT,
        client_id: "demo_hw_graded"
    });

    const HW_ANSWERS = [
        "Photosynthesis is the process where green plants use sunlight to make their own food. The chlorophyll in the leaves traps sunlight, and the plant combines carbon dioxide from the air with water from the soil to produce glucose and oxygen.",
        "Plants make food using sunlight. Chlorophyll absorbs the light energy. Carbon dioxide enters through the stomata and water comes up from the roots. The products are glucose and oxygen.",
        "It is how plants feed themselves. Sunlight is trapped by chlorophyll, then water and carbon dioxide are changed into starch. Oxygen is given off as a waste product.",
        "Photosynthesis happens in the leaf. The green colouring, chlorophyll, takes in sunlight. Water from the roots and carbon dioxide from the air are used to make food for the plant."
    ];
    const HW_FEEDBACK = [
        "Excellent - all four elements covered clearly and in your own words.",
        "Good answer. Mention where in the leaf this happens for full marks.",
        "Correct overall, though glucose rather than starch is the immediate product."
    ];

    let submissionCount = 0;
    for (let i = 0; i < 10; i++) {
        const graded = i < 6;
        newRecord("homework_submissions", {
            assignment_id: gradedHw.getId(),
            student_id: studentRecs[i].getId(),
            student_name: STUDENTS[i].name,
            class_level: CLASS_LEVEL,
            content: HW_ANSWERS[i % HW_ANSWERS.length],
            status: graded ? "graded" : "submitted",
            submitted_at: iso(daysFrom(now, -(6 - Math.floor(i / 3)))),
            score: graded ? (13 + Math.round(rand(i, 2, 5) * 7)) : null,
            feedback: graded ? HW_FEEDBACK[i % HW_FEEDBACK.length] : "",
            graded_by: graded ? teacherId : null,
            graded_at: graded ? iso(daysFrom(now, -2)) : null,
            school_version: TENANT,
            client_id: "demo_hwsub_" + i
        });
        submissionCount++;
    }

    // =========================================================================
    // 9. QUESTION BANK — stocked from the live papers
    // =========================================================================
    step = "question_bank";
    let bankCount = 0;
    for (let e = 0; e < liveExams.length; e++) {
        const src = LIVE_QUESTIONS[liveExams[e].subject] || [];
        for (let q = 0; q < src.length; q++) {
            newRecord("question_bank_questions", {
                text: src[q].text,
                type: "multiple-choice",
                subject: liveExams[e].subject,
                target_class: CLASS_LEVEL,
                school_level: SCHOOL_LEVEL,
                term: CURRENT_TERM,
                difficulty: q < 3 ? "easy" : (q < 7 ? "medium" : "hard"),
                points: 10,
                options: src[q].options,
                answer: src[q].answer,
                explanation: src[q].explanation,
                tags: [liveExams[e].subject.toLowerCase().replace(/ /g, "-"), "jss3"],
                source: liveExams[e].title,
                created_by: teacherId,
                school_version: TENANT
            });
            bankCount++;
        }
    }

    // =========================================================================
    // 10. MESSAGES — an empty inbox reads like a dead feature
    // =========================================================================
    // =========================================================================
    // 10. REPORT CARD ACCESS CODE
    //
    // Report cards are gated behind a per-class 6-digit code that an admin normally
    // generates by hand. Without one seeded, a demo runs into a locked screen at the
    // exact moment it is meant to show off the report card — so the code is part of
    // the fixture, and the reset reports it alongside the logins.
    //
    // Shape and key must match getReportCardAccessCodes(): a { classLevel: code }
    // object stored in app_settings under `report_card_access_codes`, scoped to the
    // school. Note the SETTING key is not the localStorage key next to it in that
    // file — the localStorage one is only an offline fallback.
    // =========================================================================
    step = "access_codes";
    const REPORT_CARD_CODE = "123456";
    newRecord("app_settings", {
        key: "report_card_access_codes",
        value: { JSS3: REPORT_CARD_CODE },
        school_version: TENANT
    });

    // =========================================================================
    // 11. REPORT CARD LETTERHEAD
    //
    // Without this the printed card has no school name, address, logo or contact
    // line — the header renders each of those only `if (tpl.<field>)`, so an unset
    // template gives a blank letterhead on the single most client-facing page in
    // the app.
    //
    // Only the letterhead is stored: reportCardTemplate.withDefaults() merges a
    // partial over the full defaults, so marks, grading scale and layout keep the
    // shipped values rather than being frozen at whatever they are today.
    //
    // withClientFallbacks() fills schoolName from the client config but NOT the
    // logo, so the crest has to be set explicitly. It is an inline SVG data URI
    // rather than the app's icon.png: vector prints cleanly at any size, and it
    // keeps ~15KB of base64 out of this file.
    // =========================================================================
    step = "letterhead";
    const CREST = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA5NiA5NiI+PHJlY3Qgd2lkdGg9Ijk2IiBoZWlnaHQ9Ijk2IiByeD0iMjAiIGZpbGw9IiMxQTU2QzQiLz48cGF0aCBkPSJNNDggMTYgTDc2IDI4IHYyNCBjMCAxNy0xMiAyNi0yOCAzMC0xNi00LTI4LTEzLTI4LTMwVjI4eiIgZmlsbD0iI2ZmZmZmZiIgb3BhY2l0eT0iMC4xNCIvPjx0ZXh0IHg9IjQ4IiB5PSI2MSIgZm9udC1mYW1pbHk9IlNlZ29lIFVJLEhlbHZldGljYSxBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjMzIiBmb250LXdlaWdodD0iNzAwIiBmaWxsPSIjZmZmZmZmIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5HNzwvdGV4dD48L3N2Zz4K";

    newRecord("app_settings", {
        key: "report_card_template",
        value: {
            schoolName: SCHOOL_NAME,
            schoolTagline: "Knowledge  |  Integrity  |  Service",
            address: "12 Independence Way, Central Business District, Abuja, FCT",
            phone: "+234 800 000 0000",
            email: "info@gen7tech.demo",
            website: "www.gen7tech.demo",
            logo: CREST,
            documentTitle: "PROGRESS REPORT"
        },
        school_version: TENANT
    });

    step = "messages";
    let messageCount = 0;
    try {
        // The access code arrives the way it would at a real school — the admin sends
        // it to the class teacher. It also means a reset never leaves you hunting for
        // the code: it is sitting unread in the teacher's inbox on next login.
        newRecord("messages", {
            from_id: adminRec.getId(),
            to_id: teacherId,
            message: "Report card access code for " + CLASS_LEVEL + " is " +
                REPORT_CARD_CODE + ". Enter it under Report Cards to unlock class " +
                "teacher access. Please do not share it outside the staff room.",
            school_version: TENANT,
            read: false
        });
        messageCount++;

        newRecord("messages", {
            from_id: studentRecs[0].getId(),
            to_id: teacherId,
            message: "Good afternoon ma. Please will the Mathematics exam cover simultaneous equations?",
            school_version: TENANT,
            read: true
        });
        newRecord("messages", {
            from_id: teacherId,
            to_id: studentRecs[0].getId(),
            message: "Good afternoon Chidi. Yes, simultaneous equations are included. Revise chapters 6 and 7.",
            school_version: TENANT,
            read: true
        });
        newRecord("messages", {
            from_id: studentRecs[3].getId(),
            to_id: teacherId,
            message: "Ma, I could not submit the science homework because of a network problem. May I still send it?",
            school_version: TENANT,
            read: false
        });
        messageCount += 3;
    } catch (err) {
        console.log("[demo_seed] messages skipped: " + err);
    }

    // =========================================================================
    // DONE
    // =========================================================================
    const summary = {
        tenant: TENANT,
        school: SCHOOL_NAME,
        session: { current: CURRENT_SESSION, currentTerm: CURRENT_TERM, completed: PAST_SESSION },
        removed: removed,
        created: {
            accounts: studentRecs.length + 2,
            students: studentRecs.length,
            exams: examCount,
            results: resultCount,
            reportCards: cardCount,
            attendanceSheets: sheetCount,
            attendanceMarks: markCount,
            subjectRegistrations: regCount,
            homeworkAssignments: 2,
            homeworkSubmissions: submissionCount,
            questionBank: bankCount,
            messages: messageCount
        },
        login: {
            admin: "demo.admin",
            teacher: "demo.teacher",
            student: "demo.student",
            password: DEMO_PASSWORD,
            reportCardCode: REPORT_CARD_CODE
        }
    };

    console.log("[demo_seed] reset complete: " + JSON.stringify(summary.created));

    return c.json(200, { ok: true, summary: summary });

    } catch (err) {
        // Report rather than rethrow. An uncaught error here becomes a bare 400 with
        // an empty body and no log line, which is undiagnosable; this returns the
        // failing phase and the underlying message to the caller AND the log.
        const detail = String((err && err.message) ? err.message : err);
        console.log("[demo_seed] FAILED during '" + step + "': " + detail);
        return c.json(500, { ok: false, step: step, error: detail });
    }
});
