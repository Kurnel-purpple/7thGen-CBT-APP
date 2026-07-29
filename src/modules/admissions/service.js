/**
 * Admissions module — public surface.
 *
 * Deliberately thin. The admissions module owns the candidate lifecycle
 * (sessions, codes, redemption, ranking, promotion) but borrows the entire exam
 * engine from CBT. Anything here that looks like exam logic is a bug — it
 * belongs in src/modules/cbt/.
 */

// Per-school enablement is handled by the existing module system — `admissions`
// in config modules.enabled, overridden at runtime by the tenant's
// modules_enabled list (see core/modules/pageBootstrap.js). Schools that don't
// run entrance exams simply don't have the module, so there is no separate
// feature flag here.

// Where the candidate's redeemed context lives for the duration of their sitting.
// localStorage, not sessionStorage: a candidate on a flaky connection may close
// the tab, or the browser may be killed mid-exam, and they must be able to
// resume. Cleared explicitly on submit — see clearCandidateContext().
const CANDIDATE_CONTEXT_KEY = 'cbt.admission.candidate';
const DEVICE_ID_KEY = 'cbt.admission.deviceId';

const admissionsService = {
    moduleId: 'admissions',
    candidateContextKey: CANDIDATE_CONTEXT_KEY,

    getStatus() {
        return {
            moduleId: 'admissions',
            ready: true,
            note: 'Entrance/aptitude tests for prospective students. Reuses the CBT exam engine.'
        };
    },

    /**
     * A stable per-browser identifier used for single-device binding on remote
     * sessions. Not a security control on its own — it stops a candidate from
     * handing their slip to someone else to sit in parallel, nothing more.
     */
    getDeviceId() {
        try {
            let id = localStorage.getItem(DEVICE_ID_KEY);
            if (!id) {
                id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
                localStorage.setItem(DEVICE_ID_KEY, id);
            }
            return id;
        } catch (e) {
            // Private mode with storage blocked — fall back to a per-load id.
            // Device binding degrades to "one redemption per page load".
            return 'dev-ephemeral-' + Math.random().toString(36).slice(2, 10);
        }
    },

    saveCandidateContext(context) {
        try {
            localStorage.setItem(CANDIDATE_CONTEXT_KEY, JSON.stringify(context));
        } catch (e) {
            console.warn('[Admissions] Could not persist candidate context:', e);
        }
        return context;
    },

    getCandidateContext() {
        try {
            const raw = localStorage.getItem(CANDIDATE_CONTEXT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) {
            return null;
        }
    },

    clearCandidateContext() {
        try {
            localStorage.removeItem(CANDIDATE_CONTEXT_KEY);
        } catch (e) { /* ignore */ }
    },

    isCandidate(user) {
        const u = user || (window.dataService && dataService.getCurrentUser && dataService.getCurrentUser());
        return !!(u && u.role === 'applicant');
    },

    /**
     * Remaining milliseconds for an admission attempt, measured as WALL CLOCK
     * from the server-stamped start — not time-in-app.
     *
     * This is the whole answer to "what happens when a remote candidate drops
     * off mid-exam". Resuming is allowed, but a disconnect burns the
     * candidate's own exam time, so going offline deliberately gains nothing
     * while a 90-second network blip doesn't destroy a legitimate attempt.
     *
     * Falls back to the device clock when no trusted server offset is available
     * (fully offline since page load). That is spoofable — the server flags the
     * discrepancy on submit via the _time_anomaly check rather than silently
     * accepting it.
     */
    getRemainingMs(startedAtIso, durationMins) {
        const started = new Date(startedAtIso);
        if (isNaN(started.getTime())) return null;

        const durationMs = (Number(durationMins) || 0) * 60 * 1000;
        if (durationMs <= 0) return null;

        const trustedNow = (window.dataService && dataService.getTrustedNow && dataService.getTrustedNow()) || null;
        const now = trustedNow ? trustedNow.getTime() : Date.now();

        return Math.max(0, started.getTime() + durationMs - now);
    }
};

// The candidate entry page and admissionsDataService are classic scripts, not
// ES modules, so they reach this through the global rather than an import.
if (typeof window !== 'undefined') {
    window.admissionsService = admissionsService;
}

export default admissionsService;
