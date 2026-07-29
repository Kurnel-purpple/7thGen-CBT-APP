/// <reference path="../pb_data/types.d.ts" />

/**
 * Admissions — entrance / aptitude tests for prospective students.
 *
 * Prospective students must not have to create accounts. Instead an admin
 * generates a throwaway auth account per candidate (role "applicant") and hands
 * out a printed slip: Candidate ID + 8-character Access Code. The candidate
 * redeems the slip and goes straight into the exam.
 *
 * WHY THESE RUN SERVER-SIDE
 *   - creating auth records and setting role/school_version is privileged;
 *   - the gating decisions (window open? proctor released? right device?) must
 *     not be client-evaluated;
 *   - `started_at` is the anti-bypass token (see below) and only the server may
 *     stamp it;
 *   - promotion rewrites `role` on a users record.
 *
 * THE ANTI-BYPASS DESIGN
 *   Someone could skip /redeem and call authWithPassword() directly with a
 *   candidate ID — nothing stops that. It gains them nothing: only /redeem
 *   stamps `started_at`, and take-exam.html refuses to start an admission
 *   attempt whose candidate record has no `started_at`. So the window /
 *   released / device checks cannot be skipped.
 *
 * CONNECTIVITY CONTRACT
 *   Network is required at exactly two moments — redemption and submission
 *   sync. Everything between is fully offline (Nigerian network conditions are
 *   flaky in supervised labs AND at home, so both modes assume this).
 *
 * Endpoints:
 *   POST /api/cbt/admission/generate  (admin)      -> { slips: [...] }  ONCE
 *   POST /api/cbt/admission/redeem    (public)     -> { token, record, exam }
 *   POST /api/cbt/admission/exam      (applicant)  -> { exam, candidate }
 *   POST /api/cbt/admission/promote   (admin)      -> { success, userId }
 *
 * NOTE: v0.21 executes each handler in an isolated goja runtime, so every
 * helper is inlined inside each handler. Do not hoist them — the other
 * handlers will not see them.
 */

// ---------------------------------------------------------------------------
// POST /api/cbt/admission/generate   (admin)
// Body: { sessionId, named?: ["Ada Obi", ...], blankCount?: 10 }
// Returns the plaintext access codes ONCE — they are hashed as passwords and
// can never be read back. Losing them means regenerating the candidate.
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/cbt/admission/generate", (c) => {
    const info = $apis.requestInfo(c);
    const caller = info.authRecord;
    if (!caller) {
        throw new UnauthorizedError("You must be signed in.");
    }
    const role = caller.getString("role");
    if (role !== "admin" && role !== "super_admin") {
        throw new ForbiddenError("Only administrators can generate admission codes.");
    }

    const dao = $app.dao();
    const isSuper = role === "super_admin";

    // Ambiguity-free alphabet for PRINTED slips: no O/0, no I/1/l.
    // 8 characters is not cosmetic — PocketBase enforces an 8-character minimum
    // on passwords, and the access code IS the password. Shorter codes fail at
    // save. (Declared inside the handler: v0.21 isolates each goja runtime.)
    const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const CODE_LENGTH = 8;

    // The admin's school may live on their users record or their profile —
    // either may hold it depending on how the account was created.
    let schoolVersion = caller.getString("school_version");
    if (!schoolVersion) {
        try {
            const rows = dao.findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() });
            if (rows.length > 0) schoolVersion = rows[0].getString("school_version");
        } catch (e) { /* no profile — handled below */ }
    }

    const data = info.data || {};
    const sessionId = (data.sessionId || "").toString().trim();
    const named = Array.isArray(data.named) ? data.named : [];
    let blankCount = parseInt(data.blankCount, 10);
    if (!Number.isFinite(blankCount) || blankCount < 0) blankCount = 0;

    if (!sessionId) {
        throw new BadRequestError("Missing admission session.");
    }
    if (named.length === 0 && blankCount === 0) {
        throw new BadRequestError("Provide at least one candidate name or a number of blank codes.");
    }
    if (named.length + blankCount > 500) {
        throw new BadRequestError("Generate at most 500 candidates at a time.");
    }

    let session;
    try {
        session = dao.findRecordById("admission_sessions", sessionId);
    } catch (e) {
        throw new NotFoundError("That admission session no longer exists.");
    }

    // Fail closed: an admin with no resolvable school may not generate codes,
    // otherwise a misconfigured account becomes a cross-tenant write key.
    const sessionSchool = session.getString("school_version");
    if (!isSuper) {
        if (!schoolVersion) {
            throw new ForbiddenError("Your admin account has no school assigned — set your School ID first.");
        }
        if (sessionSchool !== schoolVersion) {
            throw new ForbiddenError("That admission session belongs to a different school.");
        }
    }

    const usersCollection = dao.findCollectionByNameOrId("users");
    const candidatesCollection = dao.findCollectionByNameOrId("admission_candidates");

    // Candidate IDs read as <SCHOOL>-<YEAR>-<NNNN> on the printed slip.
    let prefix = (sessionSchool || "SCH").toString().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (prefix.length > 6) prefix = prefix.substring(0, 6);
    if (!prefix) prefix = "SCH";

    let year = new Date().getFullYear();
    const opensAt = session.getString("opens_at");
    if (opensAt) {
        const parsed = new Date(String(opensAt).trim().replace(" ", "T"));
        if (!isNaN(parsed.getTime())) year = parsed.getFullYear();
    }

    // Continue the numbering rather than restarting it, so a second batch for
    // the same session doesn't collide with the first.
    let nextSeq = 1;
    try {
        const existing = dao.findRecordsByFilter(
            "admission_candidates", "session = {:sid}", "-candidate_id", 1, 0, { sid: sessionId }
        );
        if (existing.length > 0) {
            const parts = existing[0].getString("candidate_id").split("-");
            const lastSeq = parseInt(parts[parts.length - 1], 10);
            if (Number.isFinite(lastSeq)) nextSeq = lastSeq + 1;
        }
    } catch (e) { /* first batch for this session */ }

    const requests = [];
    for (let i = 0; i < named.length; i++) {
        requests.push({ fullName: (named[i] || "").toString().trim() });
    }
    for (let i = 0; i < blankCount; i++) {
        requests.push({ fullName: "" });
    }

    const slips = [];
    for (let i = 0; i < requests.length; i++) {
        const seq = nextSeq + i;
        let padded = String(seq);
        while (padded.length < 4) padded = "0" + padded;
        const candidateId = prefix + "-" + year + "-" + padded;
        const code = $security.randomStringWithAlphabet(CODE_LENGTH, CODE_ALPHABET);

        // Email must match dataService.PROXY_DOMAIN so the existing
        // username-style login path works unchanged. Lowercased so casing can
        // never desync between generation and login.
        const email = candidateId.toLowerCase() + "@school.cbt";

        try {
            const user = new Record(usersCollection);
            // PocketBase only auto-generates a username through the record
            // CREATE API — saving straight through the DAO (as we must, to set
            // a privileged role) fails with "unable to save auth record without
            // username". Set it explicitly.
            //
            // Lowercased to match the email exactly, so the /redeem fallback
            // path (a normal login when token issuing is unavailable) resolves
            // to the same record. Hyphens are valid in PB's username pattern.
            user.set("username", candidateId.toLowerCase());
            user.set("email", email);
            user.set("emailVisibility", false);
            user.set("role", "applicant");
            user.set("full_name", requests[i].fullName);
            user.set("school_version", sessionSchool);
            user.setPassword(code);
            dao.saveRecord(user);

            // Deliberately NO profiles row — profiles is the student roster and
            // every roster query in the app reads it. Keeping candidates out of
            // it contains them from broadsheet / attendance / report cards for
            // free. dataService._syncProfileInBackground guards this too.

            const candidate = new Record(candidatesCollection);
            candidate.set("session", sessionId);
            candidate.set("candidate_id", candidateId);
            candidate.set("user", user.getId());
            candidate.set("full_name", requests[i].fullName);
            candidate.set("name_locked", requests[i].fullName !== "");
            candidate.set("status", "issued");
            candidate.set("decision", "undecided");
            candidate.set("school_version", sessionSchool);
            dao.saveRecord(candidate);

            slips.push({
                candidateId: candidateId,
                code: code,
                fullName: requests[i].fullName,
                blank: requests[i].fullName === ""
            });
        } catch (e) {
            // One bad row must not abort the whole batch — the admin gets the
            // slips that worked plus an explicit failure they can retry.
            slips.push({
                candidateId: candidateId,
                error: (e && e.message) || "Could not create this candidate."
            });
        }
    }

    return c.json(200, {
        sessionId: sessionId,
        sessionTitle: session.getString("title"),
        generated: slips.length,
        slips: slips
    });
}, $apis.requireRecordAuth());

// ---------------------------------------------------------------------------
// POST /api/cbt/admission/redeem   (PUBLIC — no auth)
// Body: { candidateId, code, deviceId, fullName? }
// The single gated entry point into an admission exam.
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/cbt/admission/redeem", (c) => {
    const info = $apis.requestInfo(c);
    const data = info.data || {};

    // Candidate IDs are copied off a printed slip by a nervous teenager in an
    // exam hall. Be forgiving about everything that does NOT affect identity:
    //   - a dropped leading zero ("…-001" for "…-0001") — by far the commonest
    //   - en/em dashes, underscores, slashes or spaces used as the separator
    //     (phone keyboards and copy-paste substitute these freely)
    //   - case and stray whitespace
    // Generated IDs are always <PREFIX>-<YEAR>-<4 digits>, so padding the
    // trailing number back to 4 can never collide with another candidate.
    function normaliseCandidateId(raw) {
        let s = String(raw || "").trim().toUpperCase();
        s = s.replace(/[\s_\/‐‑‒–—―]+/g, "-");
        s = s.replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
        const m = s.match(/^(.*-)(\d{1,4})$/);
        if (m) {
            let n = m[2];
            while (n.length < 4) n = "0" + n;
            s = m[1] + n;
        }
        return s;
    }

    const candidateIdRaw = (data.candidateId || "").toString().trim().toUpperCase();
    const candidateId = normaliseCandidateId(candidateIdRaw);
    const code = (data.code || "").toString().trim().toUpperCase();
    const deviceId = (data.deviceId || "").toString().trim();
    const fullName = (data.fullName || "").toString().trim();

    if (!candidateId || !code) {
        console.log("[admission/redeem] EMPTY INPUT — candidateId='" + candidateId
            + "' codeLen=" + code.length + " (body keys: " + Object.keys(data).join(",") + ")");
        throw new BadRequestError("Enter your Candidate ID and Access Code.");
    }
    if (!deviceId) {
        console.log("[admission/redeem] NO DEVICE ID for '" + candidateId + "'");
        throw new BadRequestError("Could not identify this device. Please reload the page.");
    }

    const dao = $app.dao();

    function parseDate(raw) {
        if (!raw) return null;
        // PocketBase serialises dates as "2026-07-26 10:00:00.000Z" — goja's
        // Date parser wants the T separator.
        const d = new Date(String(raw).trim().replace(" ", "T"));
        return isNaN(d.getTime()) ? null : d;
    }

    // Deliberately vague on failure: don't confirm whether an ID exists.
    const INVALID = "Invalid Candidate ID or Access Code.";

    // The client message stays vague — a public endpoint must not confirm
    // whether a Candidate ID exists. The SERVER log says exactly which check
    // failed, so `fly logs` can tell a mistyped code apart from a genuine fault
    // (a swallowed lookup exception used to look identical to a wrong code).
    let candidate = null;
    let lookupError = null;
    try {
        const rows = dao.findRecordsByFilter(
            "admission_candidates", "candidate_id = {:cid}", "", 1, 0, { cid: candidateId }
        );
        if (rows.length > 0) candidate = rows[0];
    } catch (e) {
        lookupError = (e && e.message) || String(e);
    }

    if (lookupError) {
        console.log("[admission/redeem] LOOKUP THREW for '" + candidateId + "': " + lookupError);
        throw new BadRequestError(INVALID);
    }
    if (!candidate) {
        console.log("[admission/redeem] NO CANDIDATE ROW matching candidate_id '" + candidateId
            + "' (as typed: '" + candidateIdRaw + "')");
        throw new BadRequestError(INVALID);
    }

    let user;
    try {
        user = dao.findRecordById("users", candidate.getString("user"));
    } catch (e) {
        console.log("[admission/redeem] CANDIDATE '" + candidateId + "' HAS NO USER RECORD (user field = '"
            + candidate.getString("user") + "'): " + ((e && e.message) || e));
        throw new BadRequestError(INVALID);
    }

    let passwordOk = false;
    try {
        passwordOk = user.validatePassword(code);
    } catch (e) {
        console.log("[admission/redeem] validatePassword THREW for '" + candidateId + "': " + ((e && e.message) || e));
        throw new BadRequestError(INVALID);
    }
    if (!passwordOk) {
        console.log("[admission/redeem] WRONG CODE for '" + candidateId + "' (received " + code.length + " chars)");
        throw new BadRequestError(INVALID);
    }

    console.log("[admission/redeem] credentials OK for '" + candidateId + "'");

    let session;
    try {
        session = dao.findRecordById("admission_sessions", candidate.getString("session"));
    } catch (e) {
        throw new NotFoundError("This admission session no longer exists. Please see the exam supervisor.");
    }

    // --- Gate 1: session must be open ---------------------------------------
    const status = session.getString("status");
    if (status === "draft") {
        throw new ForbiddenError("This admission test has not been opened yet. Please see the exam supervisor.");
    }
    if (status === "closed") {
        throw new ForbiddenError("This admission test has closed.");
    }

    // --- Gate 2: remote sessions add a window + a proctor release -----------
    // Lab sessions skip both: the supervisor in the room is the control, and
    // enforcing a window there would lock out a candidate whose sitting simply
    // started late.
    const alreadyStartedAt = parseDate(candidate.getString("started_at"));
    if (session.getString("mode") === "remote") {
        if (!session.getBool("released")) {
            throw new ForbiddenError("This test has not been released yet. Please wait for your supervisor.");
        }
        const now = new Date();
        const opensAt = parseDate(session.getString("opens_at"));
        const closesAt = parseDate(session.getString("closes_at"));
        if (opensAt && now < opensAt) {
            throw new ForbiddenError("This test is not open yet. It opens at " + opensAt.toISOString() + ".");
        }
        if (closesAt && now > closesAt) {
            throw new ForbiddenError("The time window for this test has closed.");
        }
    }

    // --- Gate 3: one device per code ----------------------------------------
    // Bound on first redemption. A reconnecting candidate returns on the SAME
    // device and passes; a second person with a copy of the slip does not.
    const boundDevice = candidate.getString("device_id");
    if (boundDevice && boundDevice !== deviceId) {
        throw new ForbiddenError("This Access Code is already in use on another device. Please see the exam supervisor.");
    }

    // --- Gate 4: already submitted ------------------------------------------
    if (candidate.getString("status") === "submitted") {
        throw new ForbiddenError("You have already submitted this test. Your responses have been recorded.");
    }

    // --- Claim a blank (walk-in) code ---------------------------------------
    if (!candidate.getBool("name_locked")) {
        if (!fullName) {
            // Signals the client to show the name field, without burning the code.
            return c.json(200, { needsName: true, candidateId: candidateId });
        }
        candidate.set("full_name", fullName);
        candidate.set("name_locked", true);
        user.set("full_name", fullName);
        dao.saveRecord(user);
    }

    // --- Stamp the clock (first redemption only) ----------------------------
    // Wall-clock from here, NOT time-in-app: a candidate who disconnects burns
    // their own exam time, so going offline deliberately gains nothing, while a
    // 90-second network blip doesn't destroy a legitimate attempt.
    if (!alreadyStartedAt) {
        candidate.set("started_at", new Date().toISOString());
        candidate.set("status", "started");
    }
    if (!boundDevice) {
        candidate.set("device_id", deviceId);
    }
    dao.saveRecord(candidate);

    let exam;
    try {
        exam = dao.findRecordById("exams", session.getString("exam_id"));
    } catch (e) {
        throw new NotFoundError("The exam for this session is missing. Please see the exam supervisor.");
    }

    // Applicants have no read access to `exams` (see migration 1791000300), so
    // the full payload is served here — pre-cached client-side before the timer
    // starts, so nothing lazy-loads mid-exam on a weak connection.
    let questions = exam.get("questions");
    if (typeof questions === "string") {
        try { questions = JSON.parse(questions); } catch (e) { questions = []; }
    }

    const payload = {
        candidate: {
            candidateId: candidateId,
            fullName: candidate.getString("full_name"),
            startedAt: candidate.getString("started_at"),
            sessionTitle: session.getString("title"),
            mode: session.getString("mode"),
            closesAt: session.getString("closes_at") || null
        },
        exam: {
            id: exam.getId(),
            title: exam.getString("title"),
            subject: exam.getString("subject"),
            target_class: exam.getString("target_class"),
            duration: exam.getFloat("duration"),
            pass_score: exam.getFloat("pass_score"),
            instructions: exam.getString("instructions"),
            theory_instructions: exam.getString("theory_instructions"),
            scramble_questions: exam.getBool("scramble_questions"),
            school_level: exam.getString("school_level"),
            status: exam.getString("status"),
            questions: questions
        }
    };

    // Issue the auth token here so gating + clock-stamp + session are atomic.
    // If the binding is unavailable the client falls back to a normal login —
    // it still cannot skip the gates, because started_at is already stamped and
    // the exam page requires it.
    try {
        payload.token = $tokens.recordAuthToken($app, user);
        payload.record = {
            id: user.getId(),
            email: user.getString("email"),
            role: "applicant",
            full_name: user.getString("full_name"),
            school_version: user.getString("school_version"),
            collectionId: user.collection().getId(),
            collectionName: "users"
        };
    } catch (e) {
        payload.requiresLogin = true;
        payload.loginIdentifier = candidateId.toLowerCase();
    }

    return c.json(200, payload);
});

// ---------------------------------------------------------------------------
// POST /api/cbt/admission/exam   (applicant auth)
// Re-fetch the payload for the caller's OWN session — used when a candidate
// reloads and the local cache was lost. Never serves any other exam.
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/cbt/admission/exam", (c) => {
    const info = $apis.requestInfo(c);
    const caller = info.authRecord;
    if (!caller) {
        throw new UnauthorizedError("You must be signed in.");
    }
    if (caller.getString("role") !== "applicant") {
        throw new ForbiddenError("This endpoint is for admission candidates only.");
    }

    const dao = $app.dao();

    let candidate;
    try {
        const rows = dao.findRecordsByFilter(
            "admission_candidates", "user = {:uid}", "", 1, 0, { uid: caller.getId() }
        );
        if (rows.length === 0) throw new Error("not found");
        candidate = rows[0];
    } catch (e) {
        throw new NotFoundError("No admission candidate record found for this account.");
    }

    // No started_at means /redeem was bypassed — refuse. This is what makes a
    // direct authWithPassword() worthless as an attack.
    if (!candidate.getString("started_at")) {
        throw new ForbiddenError("This test has not been started. Please enter your Access Code again.");
    }
    if (candidate.getString("status") === "submitted") {
        throw new ForbiddenError("You have already submitted this test.");
    }

    let session, exam;
    try {
        session = dao.findRecordById("admission_sessions", candidate.getString("session"));
        exam = dao.findRecordById("exams", session.getString("exam_id"));
    } catch (e) {
        throw new NotFoundError("The exam for this session is missing.");
    }

    if (session.getString("status") === "closed") {
        throw new ForbiddenError("This admission test has closed.");
    }

    let questions = exam.get("questions");
    if (typeof questions === "string") {
        try { questions = JSON.parse(questions); } catch (e) { questions = []; }
    }

    return c.json(200, {
        candidate: {
            candidateId: candidate.getString("candidate_id"),
            fullName: candidate.getString("full_name"),
            startedAt: candidate.getString("started_at"),
            sessionTitle: session.getString("title"),
            mode: session.getString("mode"),
            closesAt: session.getString("closes_at") || null
        },
        exam: {
            id: exam.getId(),
            title: exam.getString("title"),
            subject: exam.getString("subject"),
            target_class: exam.getString("target_class"),
            duration: exam.getFloat("duration"),
            pass_score: exam.getFloat("pass_score"),
            instructions: exam.getString("instructions"),
            theory_instructions: exam.getString("theory_instructions"),
            scramble_questions: exam.getBool("scramble_questions"),
            school_level: exam.getString("school_level"),
            status: exam.getString("status"),
            questions: questions
        }
    });
}, $apis.requireRecordAuth());

// ---------------------------------------------------------------------------
// POST /api/cbt/admission/promote   (admin)
// Body: { candidateRecordId, classLevel, username?, fullName? }
// The handoff seam: admissions stops owning the record, the student system
// takes over. Keeps the SAME user id so the aptitude result stays attached.
// ---------------------------------------------------------------------------
routerAdd("POST", "/api/cbt/admission/promote", (c) => {
    const info = $apis.requestInfo(c);
    const caller = info.authRecord;
    if (!caller) {
        throw new UnauthorizedError("You must be signed in.");
    }
    const role = caller.getString("role");
    if (role !== "admin" && role !== "super_admin") {
        throw new ForbiddenError("Only administrators can admit candidates.");
    }

    const dao = $app.dao();
    const isSuper = role === "super_admin";

    let schoolVersion = caller.getString("school_version");
    if (!schoolVersion) {
        try {
            const rows = dao.findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: caller.getId() });
            if (rows.length > 0) schoolVersion = rows[0].getString("school_version");
        } catch (e) { /* handled below */ }
    }

    const data = info.data || {};
    const candidateRecordId = (data.candidateRecordId || "").toString().trim();
    const classLevel = (data.classLevel || "").toString().trim();
    const newUsername = (data.username || "").toString().trim();
    const newFullName = (data.fullName || "").toString().trim();

    if (!candidateRecordId) {
        throw new BadRequestError("Missing candidate.");
    }
    if (!classLevel) {
        throw new BadRequestError("Choose the class this candidate is being admitted into.");
    }

    let candidate;
    try {
        candidate = dao.findRecordById("admission_candidates", candidateRecordId);
    } catch (e) {
        throw new NotFoundError("Candidate not found.");
    }

    if (!isSuper) {
        if (!schoolVersion) {
            throw new ForbiddenError("Your admin account has no school assigned — set your School ID first.");
        }
        if (candidate.getString("school_version") !== schoolVersion) {
            throw new ForbiddenError("That candidate belongs to a different school.");
        }
    }

    let user;
    try {
        user = dao.findRecordById("users", candidate.getString("user"));
    } catch (e) {
        throw new NotFoundError("The account for this candidate no longer exists.");
    }

    const fullName = newFullName || candidate.getString("full_name");
    const schoolForRecord = candidate.getString("school_version");

    // Same user id, new role — this is what keeps the aptitude `results` row
    // attached to the now-real student instead of orphaning it.
    user.set("role", "student");
    user.set("full_name", fullName);
    user.set("class_level", classLevel);
    if (newUsername) {
        // Keep username and email in step — the admin user manager searches on
        // `username`, so leaving the old candidate ID there would make an
        // admitted student findable only by their pre-admission code.
        user.set("username", newUsername.toLowerCase());
        user.set("email", newUsername.toLowerCase() + "@school.cbt");
    }
    dao.saveRecord(user);

    // Now they belong on the roster, so give them the profiles row that
    // applicants deliberately never had.
    try {
        const profilesCollection = dao.findCollectionByNameOrId("profiles");
        let profile = null;
        try {
            const rows = dao.findRecordsByFilter("profiles", "user = {:uid}", "", 1, 0, { uid: user.getId() });
            if (rows.length > 0) profile = rows[0];
        } catch (e) { /* none yet */ }

        if (!profile) profile = new Record(profilesCollection);
        profile.set("user", user.getId());
        profile.set("role", "student");
        profile.set("full_name", fullName);
        profile.set("class_level", classLevel);
        profile.set("school_version", schoolForRecord);
        dao.saveRecord(profile);
    } catch (e) {
        console.log("[admission/promote] profile creation failed: " + ((e && e.message) || e));
    }

    candidate.set("decision", "admitted");
    dao.saveRecord(candidate);

    return c.json(200, {
        success: true,
        userId: user.getId(),
        candidateId: candidate.getString("candidate_id"),
        fullName: fullName,
        classLevel: classLevel
    });
}, $apis.requireRecordAuth());

// ---------------------------------------------------------------------------
// results hooks — clock-tamper detection + candidate status
// ---------------------------------------------------------------------------

// Every hook body below is written out in full rather than calling a shared
// helper. v0.21 isolates each handler in its own goja runtime with NO access to
// the outer scope, so a module-level function would be undefined at call time.
// The duplication is required, not an oversight — admin_user_password.pb.js
// repeats its profileFor helper across handlers for the same reason.

/**
 * BEFORE create/update of `results` — clock-tamper detection.
 *
 * An offline candidate runs a LOCAL countdown, so a tampered device clock can't
 * be prevented, only detected. Compare elapsed wall-clock against the exam
 * duration and FLAG rather than reject: a legitimate candidate on a flaky
 * connection must never lose their paper over a clock skew. The admin console
 * surfaces `_time_anomaly` for review.
 *
 * Registered on BOTH create and update: an online attempt updates the
 * in-progress row created by startExamSession(), while an offline attempt that
 * never reached the server arrives later as a create.
 */
onRecordBeforeCreateRequest((e) => {
    try {
        const record = e.record;
        if (!record) return;

        // Cheap short-circuit FIRST: the caller's own auth record is already in
        // memory, so a normal student submission costs zero extra queries here.
        // A whole class submitting at once is the load case that matters on a
        // 1GB node — only fall back to a lookup when there is no caller.
        const caller = $apis.requestInfo(e.httpContext).authRecord;
        if (caller && caller.getString("role") !== "applicant") return;

        const dao = $app.dao();
        const studentId = record.getString("student_id");
        if (!studentId) return;

        if (!caller) {
            let user;
            try {
                user = dao.findRecordById("users", studentId);
            } catch (err) { return; }
            if (user.getString("role") !== "applicant") return;
        }

        let candidate;
        try {
            const rows = dao.findRecordsByFilter(
                "admission_candidates", "user = {:uid}", "", 1, 0, { uid: studentId }
            );
            if (rows.length === 0) return;
            candidate = rows[0];
        } catch (err) { return; }

        const rawStart = candidate.getString("started_at");
        if (!rawStart) return;
        const startedAt = new Date(String(rawStart).trim().replace(" ", "T"));
        if (isNaN(startedAt.getTime())) return;

        let exam;
        try {
            exam = dao.findRecordById("exams", record.getString("exam_id"));
        } catch (err) { return; }

        const durationMins = exam.getFloat("duration") || 0;
        if (durationMins <= 0) return;

        // Generous grace: a submission has to survive a flaky sync queue
        // draining long after the candidate actually finished.
        const GRACE_MINS = 10;
        const elapsedMins = (Date.now() - startedAt.getTime()) / 60000;

        let flags = record.get("flags");
        if (typeof flags === "string") {
            try { flags = JSON.parse(flags); } catch (err) { flags = {}; }
        }
        if (!flags || typeof flags !== "object") flags = {};

        flags._admission = true;
        flags._candidate_id = candidate.getString("candidate_id");
        flags._started_at = rawStart;
        flags._elapsed_mins = Math.round(elapsedMins);
        if (elapsedMins > durationMins + GRACE_MINS) {
            flags._time_anomaly = true;
        }

        record.set("flags", flags);
    } catch (err) {
        // Never block a submission because the anomaly check itself failed —
        // losing a candidate's paper is far worse than missing a flag.
        console.log("[admission] anomaly check skipped: " + ((err && err.message) || err));
    }
}, "results");

// Same check on the update path — see the create hook above for the rationale.
onRecordBeforeUpdateRequest((e) => {
    try {
        const record = e.record;
        if (!record) return;

        // Cheap short-circuit FIRST: the caller's own auth record is already in
        // memory, so a normal student submission costs zero extra queries here.
        // A whole class submitting at once is the load case that matters on a
        // 1GB node — only fall back to a lookup when there is no caller.
        const caller = $apis.requestInfo(e.httpContext).authRecord;
        if (caller && caller.getString("role") !== "applicant") return;

        const dao = $app.dao();
        const studentId = record.getString("student_id");
        if (!studentId) return;

        if (!caller) {
            let user;
            try {
                user = dao.findRecordById("users", studentId);
            } catch (err) { return; }
            if (user.getString("role") !== "applicant") return;
        }

        let candidate;
        try {
            const rows = dao.findRecordsByFilter(
                "admission_candidates", "user = {:uid}", "", 1, 0, { uid: studentId }
            );
            if (rows.length === 0) return;
            candidate = rows[0];
        } catch (err) { return; }

        const rawStart = candidate.getString("started_at");
        if (!rawStart) return;
        const startedAt = new Date(String(rawStart).trim().replace(" ", "T"));
        if (isNaN(startedAt.getTime())) return;

        let exam;
        try {
            exam = dao.findRecordById("exams", record.getString("exam_id"));
        } catch (err) { return; }

        const durationMins = exam.getFloat("duration") || 0;
        if (durationMins <= 0) return;

        const GRACE_MINS = 10;
        const elapsedMins = (Date.now() - startedAt.getTime()) / 60000;

        let flags = record.get("flags");
        if (typeof flags === "string") {
            try { flags = JSON.parse(flags); } catch (err) { flags = {}; }
        }
        if (!flags || typeof flags !== "object") flags = {};

        flags._admission = true;
        flags._candidate_id = candidate.getString("candidate_id");
        flags._started_at = rawStart;
        flags._elapsed_mins = Math.round(elapsedMins);
        if (elapsedMins > durationMins + GRACE_MINS) {
            flags._time_anomaly = true;
        }

        record.set("flags", flags);
    } catch (err) {
        console.log("[admission] anomaly check skipped: " + ((err && err.message) || err));
    }
}, "results");

/**
 * AFTER create/update of `results` — mark the candidate submitted, so the admin
 * console can tell "still sitting it" apart from "started but never received".
 * The latter is the remote candidate whose device went offline at submit and
 * has to be chased by phone.
 */
onRecordAfterCreateRequest((e) => {
    try {
        const record = e.record;
        if (!record) return;
        if (!record.getString("submitted_at")) return;

        // Same short-circuit as the before-hooks: a normal student submission
        // must not pay for an admissions lookup it will never need.
        const caller = $apis.requestInfo(e.httpContext).authRecord;
        if (caller && caller.getString("role") !== "applicant") return;

        const dao = $app.dao();
        const studentId = record.getString("student_id");
        if (!studentId) return;

        const rows = dao.findRecordsByFilter(
            "admission_candidates", "user = {:uid}", "", 1, 0, { uid: studentId }
        );
        if (rows.length === 0) return;

        const candidate = rows[0];
        if (candidate.getString("status") === "submitted") return;
        candidate.set("status", "submitted");
        dao.saveRecord(candidate);
    } catch (err) {
        console.log("[admission] submit marker skipped: " + ((err && err.message) || err));
    }
}, "results");

// Same marker on the update path — see the create hook above.
onRecordAfterUpdateRequest((e) => {
    try {
        const record = e.record;
        if (!record) return;
        if (!record.getString("submitted_at")) return;

        // Same short-circuit as the before-hooks: a normal student submission
        // must not pay for an admissions lookup it will never need.
        const caller = $apis.requestInfo(e.httpContext).authRecord;
        if (caller && caller.getString("role") !== "applicant") return;

        const dao = $app.dao();
        const studentId = record.getString("student_id");
        if (!studentId) return;

        const rows = dao.findRecordsByFilter(
            "admission_candidates", "user = {:uid}", "", 1, 0, { uid: studentId }
        );
        if (rows.length === 0) return;

        const candidate = rows[0];
        if (candidate.getString("status") === "submitted") return;
        candidate.set("status", "submitted");
        dao.saveRecord(candidate);
    } catch (err) {
        console.log("[admission] submit marker skipped: " + ((err && err.message) || err));
    }
}, "results");
