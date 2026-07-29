/**
 * Candidate entry — the one surface in the app served to someone with no
 * account: a prospective student holding a printed access slip.
 *
 * Flow: Candidate ID + Access Code -> (name, for blank walk-in codes) ->
 * pre-flight download -> exam.
 *
 * The pre-flight gate is the important part. Network here is assumed flaky in
 * BOTH lab and remote sittings, so the entire exam payload is written to
 * IndexedDB before the candidate is allowed to start. Nothing lazy-loads
 * mid-exam — a candidate must never stall on question 12 because their
 * connection dropped.
 */

(function (global) {
    'use strict';

    const entry = {
        state: 'entry',
        pendingCandidateId: '',
        pendingCode: '',
        context: null,
        countdownTimer: null,

        init() {
            this.cache();
            this.bind();
            this.clearStaleState();
            this.show('entry');
        },

        cache() {
            this.nodes = {
                views: Array.from(document.querySelectorAll('[data-adm-view]')),
                entryForm: document.getElementById('adm-entry-form'),
                candidateIdInput: document.getElementById('adm-candidate-id'),
                codeInput: document.getElementById('adm-access-code'),
                entryStatus: document.getElementById('adm-entry-status'),
                entrySubmit: document.getElementById('adm-entry-submit'),

                nameForm: document.getElementById('adm-name-form'),
                nameInput: document.getElementById('adm-full-name'),
                nameStatus: document.getElementById('adm-name-status'),
                nameSubmit: document.getElementById('adm-name-submit'),

                preflightLabel: document.getElementById('adm-preflight-label'),

                readyName: document.getElementById('adm-ready-name'),
                readyExam: document.getElementById('adm-ready-exam'),
                readySubject: document.getElementById('adm-ready-subject'),
                readyQuestions: document.getElementById('adm-ready-questions'),
                readyDuration: document.getElementById('adm-ready-duration'),
                readyRemaining: document.getElementById('adm-ready-remaining'),
                startBtn: document.getElementById('adm-start-btn'),

                errorMessage: document.getElementById('adm-error-message'),
                errorRetry: document.getElementById('adm-error-retry')
            };
        },

        bind() {
            this.nodes.entryForm?.addEventListener('submit', (e) => this.submitEntry(e));
            this.nodes.nameForm?.addEventListener('submit', (e) => this.submitName(e));
            this.nodes.startBtn?.addEventListener('click', () => this.startExam());
            this.nodes.errorRetry?.addEventListener('click', () => {
                this.show('entry');
                this.nodes.entryStatus.textContent = '';
            });

            // Candidate IDs are printed uppercase; typing is error-prone under
            // exam-hall conditions, so normalise as they type.
            this.nodes.candidateIdInput?.addEventListener('input', (e) => {
                const pos = e.target.selectionStart;
                e.target.value = e.target.value.toUpperCase();
                e.target.setSelectionRange(pos, pos);
            });
            this.nodes.codeInput?.addEventListener('input', (e) => {
                const pos = e.target.selectionStart;
                e.target.value = e.target.value.toUpperCase().replace(/\s/g, '');
                e.target.setSelectionRange(pos, pos);
            });
        },

        /**
         * Lab machines are shared: candidate #2 must never inherit candidate
         * #1's session. Anything left over from a previous sitting on this
         * device is cleared before a new candidate is let anywhere near it.
         */
        clearStaleState() {
            try {
                const previous = global.admissionsService?.getCandidateContext?.();
                if (previous) {
                    global.admissionsService.clearCandidateContext();
                }
                // A teacher may have been signed in on this lab machine. Any
                // stale token is dropped here so the redeemed candidate token
                // can't collide with it.
                if (global.dataService?.pb?.authStore) {
                    global.dataService.pb.authStore.clear();
                }
                localStorage.removeItem('cbt_user_meta');
            } catch (e) {
                console.warn('[Admission] Could not clear previous session state:', e);
            }
        },

        show(view) {
            this.state = view;
            this.nodes.views.forEach((el) => {
                el.style.display = el.dataset.admView === view ? '' : 'none';
            });
            if (view !== 'ready') this.stopCountdown();
        },

        fail(message) {
            this.nodes.errorMessage.textContent = message;
            this.show('error');
        },

        async submitEntry(event) {
            event.preventDefault();
            const n = this.nodes;
            const candidateId = n.candidateIdInput.value.trim().toUpperCase();
            const code = n.codeInput.value.trim();

            if (!candidateId || !code) {
                n.entryStatus.textContent = 'Enter both your Candidate ID and Access Code.';
                n.entryStatus.className = 'adm-status error';
                return;
            }

            this.pendingCandidateId = candidateId;
            this.pendingCode = code;

            n.entrySubmit.disabled = true;
            n.entryStatus.textContent = 'Checking your code…';
            n.entryStatus.className = 'adm-status';

            await this.redeem();
            n.entrySubmit.disabled = false;
        },

        async submitName(event) {
            event.preventDefault();
            const n = this.nodes;
            const fullName = n.nameInput.value.trim();

            if (fullName.length < 3) {
                n.nameStatus.textContent = 'Enter your full name as it appears on your application form.';
                n.nameStatus.className = 'adm-status error';
                return;
            }

            n.nameSubmit.disabled = true;
            n.nameStatus.textContent = 'Saving…';
            n.nameStatus.className = 'adm-status';

            await this.redeem(fullName);
            n.nameSubmit.disabled = false;
        },

        async redeem(fullName) {
            try {
                const response = await global.dataService.redeemAdmissionCode(
                    this.pendingCandidateId, this.pendingCode, fullName
                );

                // Blank walk-in code: ask for a name, then redeem again. The
                // code is not burned by this round trip.
                if (response.needsName) {
                    this.show('name');
                    this.nodes.nameStatus.textContent = '';
                    this.nodes.nameInput.focus();
                    return;
                }

                if (response.token && response.record) {
                    global.dataService.pb.authStore.save(response.token, response.record);

                    // getCurrentUser() reads cbt_user_meta, NOT the authStore —
                    // saving the token alone leaves every downstream page (the
                    // exam engine included) thinking nobody is signed in.
                    const record = response.record;
                    localStorage.setItem('cbt_user_meta', JSON.stringify({
                        id: record.id,
                        profileId: null,
                        email: record.email,
                        username: record.username || response.candidate?.candidateId || '',
                        role: 'applicant',
                        name: record.full_name || response.candidate?.fullName || '',
                        classLevel: null,
                        schoolVersion: record.school_version || null,
                        _pb_user: record
                    }));
                } else if (response.requiresLogin) {
                    // Token binding unavailable server-side — fall back to a
                    // normal sign-in. The gates can't be skipped either way,
                    // because started_at is already stamped.
                    await global.dataService.login(response.loginIdentifier, this.pendingCode);
                }

                await this.preflight(response);
            } catch (error) {
                // PocketBase's ClientResponseError.message is a generic SDK
                // string ("Something went wrong…"); the message the server
                // actually sent lives in error.data.message. Read that FIRST or
                // every real reason is hidden behind boilerplate.
                console.error('[Admission] Redeem failed:', error?.status, error?.data || error);
                const message = error?.data?.message
                    || error?.response?.message
                    || error?.message
                    || 'Could not verify your code. Please check with the exam supervisor.';

                if (this.state === 'name') {
                    this.nodes.nameStatus.textContent = message;
                    this.nodes.nameStatus.className = 'adm-status error';
                } else {
                    this.nodes.entryStatus.textContent = message;
                    this.nodes.entryStatus.className = 'adm-status error';
                }
            }
        },

        /**
         * Download and cache the ENTIRE exam before the candidate can start.
         * This is the difference between a flaky connection being an
         * inconvenience and it costing someone their entrance exam.
         */
        async preflight(response) {
            this.show('preflight');
            const n = this.nodes;

            try {
                n.preflightLabel.textContent = 'Downloading your exam…';

                const raw = response.exam;
                const exam = global.dataService._mapExam(raw);
                // _mapExam drops theory_instructions; the exam engine reads
                // exam.theoryInstructions, so carry it across explicitly.
                exam.theoryInstructions = raw.theory_instructions || '';

                if (!exam || !Array.isArray(exam.questions) || exam.questions.length === 0) {
                    throw new Error('This exam has no questions yet. Please see the exam supervisor.');
                }

                const context = {
                    candidateId: response.candidate.candidateId,
                    fullName: response.candidate.fullName,
                    startedAt: response.candidate.startedAt,
                    sessionTitle: response.candidate.sessionTitle,
                    mode: response.candidate.mode,
                    closesAt: response.candidate.closesAt,
                    examId: exam.id,
                    duration: exam.duration
                };
                global.admissionsService.saveCandidateContext(context);
                this.context = context;

                n.preflightLabel.textContent = 'Saving your exam to this device…';

                if (global.idb?.isIndexedDBAvailable?.()) {
                    await global.idb.saveExam(exam);
                    const cached = await global.idb.hasExamCached(exam.id);
                    if (!cached) throw new Error('cache-verify-failed');
                } else {
                    // No IndexedDB (private mode / old webview) — localStorage
                    // is the exam engine's documented fallback.
                    const cache = JSON.parse(localStorage.getItem('cbt_exam_cache') || '{}');
                    cache[exam.id] = exam;
                    localStorage.setItem('cbt_exam_cache', JSON.stringify(cache));
                }

                // Trusted server time backs the wall-clock timer. Best effort:
                // if it fails we still have the server-stamped started_at.
                try {
                    await global.dataService.syncServerTime();
                } catch (e) { /* offline already — proceed */ }

                this.renderReady(exam);
                this.show('ready');
                this.startCountdown();
            } catch (error) {
                console.error('[Admission] Pre-flight failed:', error);
                this.fail(
                    error?.message === 'cache-verify-failed'
                        ? 'Your exam could not be saved to this device. Check your connection and try again — do not start until this succeeds.'
                        : (error?.message || 'Could not download your exam. Please check your connection and try again.')
                );
            }
        },

        renderReady(exam) {
            const n = this.nodes;
            const ctx = this.context;
            n.readyName.textContent = ctx.fullName || ctx.candidateId;
            n.readyExam.textContent = exam.title || 'Aptitude Test';
            n.readySubject.textContent = exam.subject || '—';
            n.readyQuestions.textContent = String(exam.questions.length);
            n.readyDuration.textContent = `${exam.duration} minutes`;
        },

        /**
         * The remaining time is shown ticking on this screen deliberately. The
         * clock is wall-clock from the server-stamped start, so lingering here
         * costs the candidate their own exam time — showing it makes that
         * honest rather than a hidden penalty.
         */
        startCountdown() {
            this.stopCountdown();
            const tick = () => {
                const ctx = this.context;
                if (!ctx) return;
                const remaining = global.admissionsService.getRemainingMs(ctx.startedAt, ctx.duration);
                if (remaining === null) {
                    this.nodes.readyRemaining.textContent = '—';
                    return;
                }
                const mins = Math.floor(remaining / 60000);
                const secs = Math.floor((remaining % 60000) / 1000);
                this.nodes.readyRemaining.textContent =
                    `${mins}:${String(secs).padStart(2, '0')}`;
                if (remaining <= 0) {
                    this.stopCountdown();
                    this.nodes.startBtn.disabled = true;
                    this.nodes.startBtn.textContent = 'Time expired';
                }
            };
            tick();
            this.countdownTimer = setInterval(tick, 1000);
        },

        stopCountdown() {
            if (this.countdownTimer) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
            }
        },

        startExam() {
            if (!this.context?.examId) return;
            global.location.href = `take-exam.html?id=${encodeURIComponent(this.context.examId)}&admission=1`;
        }
    };

    global.candidateEntry = entry;
})(window);
