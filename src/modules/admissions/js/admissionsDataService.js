/**
 * Admissions Data Service
 * Extends window.dataService with admission-specific functionality.
 * Persists to PocketBase collections: admission_sessions, admission_candidates.
 * Privileged operations go through /api/cbt/admission/* (see pb_hooks/admission.pb.js).
 * Must be loaded AFTER dataService.js
 */

(function (ds) {
    if (!ds) {
        console.error('[admissionsDataService] window.dataService not found — load dataService.js first');
        return;
    }

    const SESSIONS = 'admission_sessions';
    const CANDIDATES = 'admission_candidates';
    const API = '/api/cbt/admission';

    function schoolFilter() {
        const user = ds.getCurrentUser();
        const school = user?.schoolVersion || '';
        return school ? `school_version = "${school}"` : '';
    }

    // --- Mapping -----------------------------------------------------------

    ds._mapAdmissionSession = function (record) {
        if (!record) return null;
        return {
            id: record.id,
            title: record.title || '',
            examId: record.exam_id || '',
            mode: record.mode || 'lab',
            opensAt: record.opens_at || '',
            closesAt: record.closes_at || '',
            released: !!record.released,
            status: record.status || 'draft',
            entryClass: record.entry_class || '',
            schoolVersion: record.school_version || '',
            createdBy: record.created_by || '',
            created: record.created,
            updated: record.updated
        };
    };

    ds._mapAdmissionCandidate = function (record) {
        if (!record) return null;
        return {
            id: record.id,
            sessionId: record.session || '',
            candidateId: record.candidate_id || '',
            userId: record.user || '',
            fullName: record.full_name || '',
            nameLocked: !!record.name_locked,
            status: record.status || 'issued',
            startedAt: record.started_at || '',
            deviceId: record.device_id || '',
            decision: record.decision || 'undecided',
            schoolVersion: record.school_version || ''
        };
    };

    // --- Sessions ----------------------------------------------------------

    ds.getAdmissionSessions = async function () {
        const filter = schoolFilter();
        const records = await ds.pb.collection(SESSIONS).getFullList({
            sort: '-created',
            ...(filter ? { filter } : {})
        });
        return records.map(ds._mapAdmissionSession);
    };

    ds.getAdmissionSession = async function (sessionId) {
        const record = await ds.pb.collection(SESSIONS).getOne(sessionId);
        return ds._mapAdmissionSession(record);
    };

    ds.createAdmissionSession = async function (data) {
        const user = ds.getCurrentUser();
        if (!user?.schoolVersion) {
            throw new Error('Your admin account has no School ID set. Set it before creating an admission session.');
        }
        const record = await ds.pb.collection(SESSIONS).create({
            title: data.title,
            exam_id: data.examId,
            mode: data.mode || 'lab',
            opens_at: data.opensAt || null,
            closes_at: data.closesAt || null,
            released: !!data.released,
            status: data.status || 'draft',
            entry_class: data.entryClass || '',
            school_version: user.schoolVersion,
            created_by: user.id
        });
        return ds._mapAdmissionSession(record);
    };

    ds.updateAdmissionSession = async function (sessionId, updates) {
        const payload = {};
        if (updates.title !== undefined) payload.title = updates.title;
        if (updates.examId !== undefined) payload.exam_id = updates.examId;
        if (updates.mode !== undefined) payload.mode = updates.mode;
        if (updates.opensAt !== undefined) payload.opens_at = updates.opensAt || null;
        if (updates.closesAt !== undefined) payload.closes_at = updates.closesAt || null;
        if (updates.released !== undefined) payload.released = !!updates.released;
        if (updates.status !== undefined) payload.status = updates.status;
        if (updates.entryClass !== undefined) payload.entry_class = updates.entryClass;
        const record = await ds.pb.collection(SESSIONS).update(sessionId, payload);
        return ds._mapAdmissionSession(record);
    };

    ds.deleteAdmissionSession = async function (sessionId) {
        // admission_candidates cascades on the session relation, and the users
        // records cascade from those — so this purges the candidate accounts and
        // their PII too. That is the intended post-cycle cleanup.
        await ds.pb.collection(SESSIONS).delete(sessionId);
        return true;
    };

    // --- Candidates --------------------------------------------------------

    ds.getAdmissionCandidates = async function (sessionId) {
        const records = await ds.pb.collection(CANDIDATES).getFullList({
            filter: `session = "${sessionId}"`,
            sort: 'candidate_id'
        });
        return records.map(ds._mapAdmissionCandidate);
    };

    /**
     * Reconciliation: fix a walk-in's mistyped name before ranking. Writes to
     * both the candidate row and the auth record so the ranked list and the
     * result snapshot agree.
     */
    ds.updateAdmissionCandidateName = async function (candidateRecordId, fullName) {
        const name = String(fullName || '').trim();
        if (!name) throw new Error('Enter a name.');
        const record = await ds.pb.collection(CANDIDATES).update(candidateRecordId, {
            full_name: name,
            name_locked: true
        });
        return ds._mapAdmissionCandidate(record);
    };

    ds.setAdmissionCandidateDecision = async function (candidateRecordId, decision) {
        const record = await ds.pb.collection(CANDIDATES).update(candidateRecordId, { decision });
        return ds._mapAdmissionCandidate(record);
    };

    ds.markAdmissionCandidateAbsent = async function (candidateRecordId) {
        const record = await ds.pb.collection(CANDIDATES).update(candidateRecordId, { status: 'absent' });
        return ds._mapAdmissionCandidate(record);
    };

    // --- Privileged endpoints ---------------------------------------------

    /**
     * Returns the plaintext access codes ONCE. They are stored as password
     * hashes and can never be read back — the caller must print or export them
     * before navigating away.
     */
    ds.generateAdmissionCodes = async function (sessionId, { named = [], blankCount = 0 } = {}) {
        return ds.pb.send(`${API}/generate`, {
            method: 'POST',
            body: { sessionId, named, blankCount }
        });
    };

    /**
     * PUBLIC — called by a prospective student with no account.
     *
     * Returns one of:
     *   { needsName: true }                  — blank walk-in code, prompt for a name
     *   { token, record, exam, candidate }   — redeemed, auth issued
     *   { requiresLogin: true, ... }         — token binding unavailable server-side;
     *                                          caller falls back to dataService.login()
     */
    ds.redeemAdmissionCode = async function (candidateId, code, fullName) {
        const deviceId = window.admissionsService
            ? window.admissionsService.getDeviceId()
            : 'dev-unknown';

        return ds.pb.send(`${API}/redeem`, {
            method: 'POST',
            body: {
                candidateId: String(candidateId || '').trim().toUpperCase(),
                code: String(code || '').trim(),
                deviceId,
                fullName: fullName ? String(fullName).trim() : undefined
            }
        });
    };

    /**
     * Re-fetch the caller's own admission exam. Applicants have no read access
     * to the `exams` collection at all (migration 1791000300), so this is the
     * only way they can get their paper — used when a candidate reloads and the
     * local cache was lost.
     */
    ds.fetchAdmissionExam = async function () {
        return ds.pb.send(`${API}/exam`, { method: 'POST', body: {} });
    };

    ds.promoteAdmissionCandidate = async function (candidateRecordId, { classLevel, username, fullName } = {}) {
        return ds.pb.send(`${API}/promote`, {
            method: 'POST',
            body: { candidateRecordId, classLevel, username, fullName }
        });
    };

    // --- Ranking -----------------------------------------------------------

    /**
     * The admission list: candidates joined to their results, ranked by score.
     *
     * Cohorts are capped at 500 per batch, so joining client-side is cheaper
     * than a per-candidate request. Candidates with no result are kept in the
     * list — "started but never received" is the case an admin most needs to
     * see (a remote candidate whose device went offline at submit and has to be
     * chased by phone).
     */
    ds.getAdmissionRanking = async function (sessionId) {
        const session = await ds.getAdmissionSession(sessionId);
        const candidates = await ds.getAdmissionCandidates(sessionId);

        let results = [];
        try {
            results = await ds.pb.collection('results').getFullList({
                filter: `exam_id = "${session.examId}"`
            });
        } catch (e) {
            console.warn('[Admissions] Could not load results for ranking:', e);
        }

        const byUser = {};
        results.forEach((r) => {
            if (r.student_id) byUser[r.student_id] = r;
        });

        const rows = candidates.map((candidate) => {
            const result = byUser[candidate.userId] || null;
            const flags = result?.flags || {};
            const submitted = !!result?.submitted_at;

            return {
                ...candidate,
                resultId: result?.id || null,
                score: submitted ? (result.score ?? 0) : null,
                totalPoints: submitted ? (result.total_points ?? 0) : null,
                percentage: submitted && result.total_points
                    ? Math.round((result.score / result.total_points) * 100)
                    : null,
                submittedAt: result?.submitted_at || null,
                timeAnomaly: !!flags._time_anomaly,
                elapsedMins: flags._elapsed_mins ?? null,
                // The chase list: they redeemed a code but no result ever arrived.
                missingResult: candidate.status === 'started' && !submitted
            };
        });

        rows.sort((a, b) => {
            if (a.percentage === null && b.percentage === null) {
                return a.candidateId.localeCompare(b.candidateId);
            }
            if (a.percentage === null) return 1;
            if (b.percentage === null) return -1;
            return b.percentage - a.percentage;
        });

        rows.forEach((row, index) => {
            row.rank = row.percentage === null ? null : index + 1;
        });

        return { session, rows };
    };
})(window.dataService);
