/**
 * Post-submission screen for admission candidates.
 *
 * Two jobs, and the second one matters more:
 *
 *  1. Confirm receipt WITHOUT showing a score. Entrance results go to the
 *     school's ranked list, not to the candidate.
 *
 *  2. Make an unsent submission impossible to miss. A remote candidate whose
 *     device goes offline at submit is holding the only copy of their exam. If
 *     they close the tab believing they are done, that paper is gone. So this
 *     page stays loud and keeps retrying until the result is actually on the
 *     server — and only then tears down the session.
 */

(function (global) {
    'use strict';

    const RETRY_INTERVAL_MS = 15000;

    const complete = {
        retryTimer: null,
        syncing: false,

        async init() {
            this.cache();
            this.bind();

            const context = global.admissionsService?.getCandidateContext?.() || null;
            this.context = context;
            if (context?.fullName) {
                this.nodes.name.textContent = context.fullName;
            }

            await this.evaluate();
        },

        cache() {
            this.nodes = {
                views: Array.from(document.querySelectorAll('[data-adm-done-view]')),
                name: document.getElementById('adm-done-name'),
                pendingStatus: document.getElementById('adm-pending-status'),
                retryBtn: document.getElementById('adm-retry-btn'),
                exitBtn: document.getElementById('adm-exit-btn')
            };
        },

        bind() {
            this.nodes.retryBtn?.addEventListener('click', () => this.trySync(true));
            this.nodes.exitBtn?.addEventListener('click', () => {
                global.location.href = 'admission.html';
            });

            // A reconnect is the moment most likely to succeed — take it
            // immediately rather than waiting for the next poll.
            global.addEventListener('online', () => this.trySync(false));
        },

        show(view) {
            this.nodes.views.forEach((el) => {
                el.style.display = el.dataset.admDoneView === view ? '' : 'none';
            });
        },

        /**
         * Prefer cbtDataService._loadPendingQueue: it reads BOTH the IndexedDB
         * store and the localStorage store and de-duplicates across them.
         * Older builds double-wrote, so counting one store alone can report
         * "all sent" while a copy is still stranded in the other.
         */
        async countPending() {
            const ds = global.dataService;

            if (typeof ds?._loadPendingQueue === 'function') {
                try {
                    const entries = await ds._loadPendingQueue();
                    return Array.isArray(entries) ? entries.length : 0;
                } catch (e) {
                    console.warn('[Admission] Queue read failed, falling back:', e);
                }
            }

            let pending = [];
            try {
                if (global.idb?.isIndexedDBAvailable?.()) {
                    pending = await global.idb.getPendingSubmissions();
                }
            } catch (e) {
                console.warn('[Admission] Could not read IndexedDB queue:', e);
            }

            if (!pending || pending.length === 0) {
                try {
                    pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
                } catch (e) {
                    pending = [];
                }
            }
            return Array.isArray(pending) ? pending.length : 0;
        },

        async evaluate() {
            const outstanding = await this.countPending();

            if (outstanding > 0) {
                this.show('pending');
                this.startRetryLoop();
                this.trySync(false);
                return;
            }

            this.show('done');
            this.stopRetryLoop();
            await this.teardown();
        },

        startRetryLoop() {
            if (this.retryTimer) return;
            this.retryTimer = setInterval(() => this.trySync(false), RETRY_INTERVAL_MS);
        },

        stopRetryLoop() {
            if (this.retryTimer) {
                clearInterval(this.retryTimer);
                this.retryTimer = null;
            }
        },

        async trySync(manual) {
            if (this.syncing) return;
            const n = this.nodes;

            if (!navigator.onLine) {
                n.pendingStatus.textContent = manual
                    ? 'Still no connection. Keep this page open — it will send automatically the moment you are back online.'
                    : 'Waiting for a connection…';
                n.pendingStatus.className = 'adm-status';
                return;
            }

            this.syncing = true;
            n.pendingStatus.textContent = 'Sending your answers…';
            n.pendingStatus.className = 'adm-status';

            try {
                await global.dataService.syncPendingResults();
                const outstanding = await this.countPending();

                if (outstanding === 0) {
                    this.show('done');
                    this.stopRetryLoop();
                    await this.teardown();
                } else {
                    n.pendingStatus.textContent =
                        'Not sent yet. Keep this page open and stay connected — it will keep trying.';
                    n.pendingStatus.className = 'adm-status error';
                }
            } catch (error) {
                n.pendingStatus.textContent =
                    'Could not send yet. Keep this page open — it will keep trying automatically.';
                n.pendingStatus.className = 'adm-status error';
            } finally {
                this.syncing = false;
            }
        },

        /**
         * Only runs once the result is confirmed on the server. Doing this any
         * earlier would drop the auth token the pending-submission queue needs.
         *
         * Lab machines are shared, so this is also what stops candidate #2
         * inheriting candidate #1's session.
         */
        async teardown() {
            const context = this.context;

            try {
                if (context?.examId && global.dataService?.getCurrentUser) {
                    const user = global.dataService.getCurrentUser();
                    if (user?.id) {
                        localStorage.removeItem(`cbt_progress_${context.examId}_${user.id}`);
                        localStorage.removeItem(`attempt_snapshot_${context.examId}_${user.id}`);
                        try {
                            await global.idb?.deleteProgress?.(context.examId, user.id);
                        } catch (e) { /* best effort */ }
                    }
                    try {
                        await global.idb?.deleteExam?.(context.examId);
                    } catch (e) { /* best effort */ }
                }
            } catch (e) {
                console.warn('[Admission] Could not clear local exam state:', e);
            }

            try {
                global.admissionsService?.clearCandidateContext?.();
                localStorage.removeItem('cbt_exam_cache');
                localStorage.removeItem('cbt_user_meta');
                await global.dataService?.logout?.();
            } catch (e) {
                console.warn('[Admission] Could not clear session:', e);
            }
        }
    };

    global.admissionComplete = complete;
})(window);
