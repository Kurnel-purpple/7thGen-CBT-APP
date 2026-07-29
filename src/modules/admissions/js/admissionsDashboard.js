/**
 * Admin console for entrance / aptitude tests.
 * Backed by window.dataService (PocketBase) via admissionsDataService.
 */

(function (global) {
    'use strict';

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function fmtDateTime(value) {
        if (!value) return '—';
        const d = new Date(String(value).replace(' ', 'T'));
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString(undefined, {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    }

    // <input type="datetime-local"> needs a naive local string, not an ISO Z.
    function toLocalInput(value) {
        if (!value) return '';
        const d = new Date(String(value).replace(' ', 'T'));
        if (isNaN(d.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // Path data only — wrapped in a 24x24 stroked <svg> by renderBottomNav.
    const NAV_ICONS = {
        back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
        sessions: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
        candidates: '<path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
        ranking: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
        plus: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
        generate: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>'
    };

    const NAV_SLOTS = [
        { view: 'sessions', label: 'Sessions', icon: NAV_ICONS.sessions },
        { view: 'candidates', label: 'Candidates', icon: NAV_ICONS.candidates, needsSession: true },
        { view: 'ranking', label: 'Ranking', icon: NAV_ICONS.ranking, needsSession: true }
    ];

    const dashboard = {
        sessions: [],
        exams: [],
        candidates: [],
        ranking: [],
        selectedSessionId: null,
        currentTab: 'candidates',
        searchQuery: '',

        async init() {
            const ds = global.dataService;
            const user = ds?.getCurrentUser?.();
            if (!user) {
                global.location.href = '../index.html';
                return;
            }
            if (user.role !== 'admin' && user.role !== 'super_admin') {
                global.location.href = '../index.html';
                return;
            }

            this.cache();
            this.bind();
            this.populateClassOptions();
            this.renderIdentity(user);
            await this.loadExams();
            await this.refreshSessions();
        },

        cache() {
            this.nodes = {
                userName: document.getElementById('user-name'),
                avatar: document.getElementById('sidebar-avatar'),
                roleText: document.getElementById('adm-role-text'),
                logoutBtn: document.getElementById('adm-logout-btn'),

                sessionsList: document.getElementById('adm-sessions-list'),
                sessionsMeta: document.getElementById('adm-sessions-meta'),

                detailSection: document.getElementById('adm-detail-section'),
                detailEyebrow: document.getElementById('adm-detail-eyebrow'),
                remoteNotice: document.getElementById('adm-remote-notice'),

                tabButtons: Array.from(document.querySelectorAll('[data-adm-tab]')),
                panels: Array.from(document.querySelectorAll('[data-adm-panel]')),

                sessionsSection: document.getElementById('adm-sessions-section'),
                bottomNav: document.getElementById('adm-bottom-nav'),

                candidatesBody: document.getElementById('adm-candidates-body'),
                candidatesCards: document.getElementById('adm-candidates-cards'),
                candidatesEmpty: document.getElementById('adm-candidates-empty'),
                rankingBody: document.getElementById('adm-ranking-body'),
                rankingCards: document.getElementById('adm-ranking-cards'),
                rankingEmpty: document.getElementById('adm-ranking-empty'),
                missingNotice: document.getElementById('adm-missing-notice'),
                missingCount: document.getElementById('adm-missing-count'),

                searchInput: document.getElementById('adm-search-input'),
                newSessionCta: document.getElementById('adm-new-session-cta'),
                generateCta: document.getElementById('adm-generate-cta'),
                editSessionCta: document.getElementById('adm-edit-session-cta'),
                deleteSessionCta: document.getElementById('adm-delete-session-cta'),

                sessionModal: document.getElementById('adm-session-modal'),
                sessionForm: document.getElementById('adm-session-form'),
                sessionIdInput: document.getElementById('adm-session-id'),
                sessionTitleInput: document.getElementById('adm-session-title'),
                sessionExamSelect: document.getElementById('adm-session-exam'),
                sessionClassSelect: document.getElementById('adm-session-class'),
                sessionStatusSelect: document.getElementById('adm-session-status'),
                sessionOpens: document.getElementById('adm-session-opens'),
                sessionCloses: document.getElementById('adm-session-closes'),
                sessionModalTitle: document.getElementById('adm-session-modal-title'),
                sessionEyebrow: document.getElementById('adm-session-eyebrow'),
                sessionSubmit: document.getElementById('adm-session-submit'),
                sessionStatusMsg: document.getElementById('adm-session-status-msg'),
                modeHint: document.getElementById('adm-mode-hint'),
                remoteOnly: Array.from(document.querySelectorAll('.adm-remote-only')),

                generateModal: document.getElementById('adm-generate-modal'),
                generateForm: document.getElementById('adm-generate-form'),
                generateNames: document.getElementById('adm-generate-names'),
                generateBlanks: document.getElementById('adm-generate-blanks'),
                generateSubmit: document.getElementById('adm-generate-submit'),
                generateStatus: document.getElementById('adm-generate-status'),

                slipsModal: document.getElementById('adm-slips-modal'),
                slipsGrid: document.getElementById('adm-slips-grid'),
                printBtn: document.getElementById('adm-print-btn'),

                renameModal: document.getElementById('adm-rename-modal'),
                renameForm: document.getElementById('adm-rename-form'),
                renameRecordId: document.getElementById('adm-rename-record-id'),
                renameName: document.getElementById('adm-rename-name'),
                renameTitle: document.getElementById('adm-rename-title'),
                renameEyebrow: document.getElementById('adm-rename-eyebrow'),
                renameSubmit: document.getElementById('adm-rename-submit'),
                renameStatus: document.getElementById('adm-rename-status'),

                promoteModal: document.getElementById('adm-promote-modal'),
                promoteForm: document.getElementById('adm-promote-form'),
                promoteCandidateId: document.getElementById('adm-promote-candidate-id'),
                promoteName: document.getElementById('adm-promote-name'),
                promoteClass: document.getElementById('adm-promote-class'),
                promoteUsername: document.getElementById('adm-promote-username'),
                promoteSubmit: document.getElementById('adm-promote-submit'),
                promoteStatus: document.getElementById('adm-promote-status'),
                promoteTitle: document.getElementById('adm-promote-title')
            };
        },

        bind() {
            const n = this.nodes;

            n.logoutBtn?.addEventListener('click', async () => {
                await global.dataService.logout();
                global.location.href = '../index.html';
            });

            n.newSessionCta?.addEventListener('click', () => this.openSessionModal(null));
            n.editSessionCta?.addEventListener('click', () => {
                const session = this.selectedSession();
                if (session) this.openSessionModal(session);
            });
            n.deleteSessionCta?.addEventListener('click', () => this.deleteSession());
            n.generateCta?.addEventListener('click', () => this.openGenerateModal());
            n.printBtn?.addEventListener('click', () => global.print());

            n.tabButtons.forEach((btn) => {
                btn.addEventListener('click', () => this.switchTab(btn.dataset.admTab));
            });

            n.searchInput?.addEventListener('input', (e) => {
                this.searchQuery = e.target.value.trim().toLowerCase();
                this.renderCandidates();
                this.renderRanking();
            });

            document.querySelectorAll('[data-adm-close-session]').forEach((el) =>
                el.addEventListener('click', () => this.closeModal(n.sessionModal)));
            document.querySelectorAll('[data-adm-close-generate]').forEach((el) =>
                el.addEventListener('click', () => this.closeModal(n.generateModal)));
            document.querySelectorAll('[data-adm-close-slips]').forEach((el) =>
                el.addEventListener('click', () => this.closeModal(n.slipsModal)));
            document.querySelectorAll('[data-adm-close-promote]').forEach((el) =>
                el.addEventListener('click', () => this.closeModal(n.promoteModal)));
            document.querySelectorAll('[data-adm-close-rename]').forEach((el) =>
                el.addEventListener('click', () => this.closeModal(n.renameModal)));

            document.querySelectorAll('input[name="adm-mode"]').forEach((radio) => {
                radio.addEventListener('change', () => this.syncModeFields());
            });

            n.sessionForm?.addEventListener('submit', (e) => this.submitSession(e));
            n.generateForm?.addEventListener('submit', (e) => this.submitGenerate(e));
            n.promoteForm?.addEventListener('submit', (e) => this.submitPromote(e));
            n.renameForm?.addEventListener('submit', (e) => this.submitRename(e));
        },

        renderIdentity(user) {
            const n = this.nodes;
            if (n.userName) n.userName.textContent = user.name || 'Admin';
            if (n.avatar) n.avatar.textContent = (user.name || 'A').charAt(0).toUpperCase();
            if (n.roleText) n.roleText.textContent = user.role === 'super_admin' ? 'Super Admin' : 'Administrator';
        },

        populateClassOptions() {
            const classes = global.academicEntities?.getAllClasses?.() || [];
            [this.nodes.sessionClassSelect, this.nodes.promoteClass].forEach((select) => {
                if (!select) return;
                const first = select.querySelector('option');
                select.innerHTML = '';
                if (first) select.appendChild(first);
                classes.forEach((cls) => {
                    const opt = document.createElement('option');
                    opt.value = cls.value;
                    opt.textContent = cls.text;
                    select.appendChild(opt);
                });
            });
        },

        async loadExams() {
            try {
                this.exams = await global.dataService.getExamSummaries({});
            } catch (e) {
                console.warn('[Admissions] Could not load exams:', e);
                this.exams = [];
            }
            const select = this.nodes.sessionExamSelect;
            if (!select) return;
            select.innerHTML = '<option value="">Select an exam</option>';

            // Exam titles are commonly just "<Term> - <Subject>", which reads
            // identically across classes — "Third Term - ICT" could be JSS1 or
            // JSS2. Group by target class so the choice is never ambiguous.
            const byClass = new Map();
            this.exams.forEach((exam) => {
                const key = exam.targetClass || 'Unassigned';
                if (!byClass.has(key)) byClass.set(key, []);
                byClass.get(key).push(exam);
            });

            const classOrder = (global.academicEntities?.PROMOTION_LADDER || []).slice();
            const rank = (name) => {
                const i = classOrder.findIndex(
                    (c) => String(c).replace(/\s+/g, '').toUpperCase() === String(name).replace(/\s+/g, '').toUpperCase()
                );
                return i === -1 ? classOrder.length + 1 : i;
            };

            Array.from(byClass.keys())
                .sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)))
                .forEach((className) => {
                    const group = document.createElement('optgroup');
                    group.label = className === 'All' ? 'All Classes' : className;
                    byClass.get(className)
                        .sort((a, b) => String(a.title).localeCompare(String(b.title)))
                        .forEach((exam) => {
                            const opt = document.createElement('option');
                            opt.value = exam.id;
                            const subject = exam.subject || 'General';
                            // Skip the subject when the title already carries it,
                            // so options don't read "Third Term - ICT — ICT".
                            const titleHasSubject = String(exam.title).toLowerCase()
                                .includes(subject.toLowerCase());
                            opt.textContent = titleHasSubject
                                ? exam.title
                                : `${exam.title} — ${subject}`;
                            group.appendChild(opt);
                        });
                    select.appendChild(group);
                });
        },

        selectedSession() {
            return this.sessions.find((s) => s.id === this.selectedSessionId) || null;
        },

        // --- Sessions ------------------------------------------------------

        async refreshSessions() {
            this.loadError = null;
            try {
                this.sessions = await global.dataService.getAdmissionSessions();
            } catch (e) {
                console.error('[Admissions] Failed to load sessions:', e);
                this.sessions = [];
                const status = e?.status ?? e?.statusCode;
                // A 404 here means the admission_sessions collection isn't on
                // the server — the migrations haven't been deployed. Say so,
                // rather than rendering an empty state that looks like
                // "no sessions yet" and sends the admin round in circles.
                this.loadError = status === 404
                    ? 'The admissions collections are missing from the server. The database migrations have not been deployed yet — run a backend deploy before using this page.'
                    : (e?.message || 'Could not load admission sessions.');
            }
            this.renderSessions();

            if (this.selectedSessionId && !this.selectedSession()) {
                this.selectedSessionId = null;
            }
            if (this.selectedSessionId) {
                await this.loadSessionDetail();
            } else {
                this.nodes.detailSection.style.display = 'none';
            }
            this.renderBottomNav();
        },

        renderSessions() {
            const n = this.nodes;
            if (!n.sessionsList) return;

            // The heading already says "Sessions" — the badge is just the count.
            n.sessionsMeta.textContent = this.loadError ? '—' : String(this.sessions.length);

            if (this.loadError) {
                n.sessionsList.innerHTML =
                    `<div class="adm-notice warn"><div><strong>Admissions is not ready yet</strong>${esc(this.loadError)}</div></div>`;
                return;
            }

            if (this.sessions.length === 0) {
                n.sessionsList.innerHTML =
                    '<div class="adm-empty">No admission sessions yet. Create one to start issuing access codes.</div>';
                return;
            }

            n.sessionsList.innerHTML = this.sessions.map((s) => {
                const exam = this.exams.find((e) => e.id === s.examId);
                const selected = s.id === this.selectedSessionId ? ' selected' : '';
                const heldBadge = s.mode === 'remote' && !s.released
                    ? '<span class="adm-pill warn">Held</span>' : '';
                const isOpen = s.id === this.selectedSessionId;
                // A real <button> can't contain the Edit/Delete buttons, so the
                // row is a div that behaves like one (click + Enter/Space).
                return `
                    <div class="adm-session-row${selected}" data-session-id="${esc(s.id)}"
                         role="button" tabindex="0" aria-expanded="${isOpen}">
                        <span class="adm-session-main">
                            <span class="adm-session-top">
                                <span class="adm-session-name">${esc(s.title)}</span>
                                <span class="adm-session-actions">
                                    <button type="button" class="adm-session-icon-btn" data-adm-edit-session="${esc(s.id)}"
                                            title="Edit session" aria-label="Edit ${esc(s.title)}">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    </button>
                                    <button type="button" class="adm-session-icon-btn danger" data-adm-delete-session="${esc(s.id)}"
                                            title="Delete session" aria-label="Delete ${esc(s.title)}">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                                    </button>
                                </span>
                            </span>
                            <span class="adm-session-meta-row">
                                <span class="adm-session-sub">
                                    ${esc(exam ? exam.title : 'Exam missing')}
                                    ${s.entryClass ? ' &middot; ' + esc(s.entryClass) : ''}
                                </span>
                                <span class="adm-session-tags">
                                    ${heldBadge}
                                    <span class="adm-pill mode-${esc(s.mode)}">${s.mode === 'lab' ? 'Lab' : 'Remote'}</span>
                                    <span class="adm-pill status-${esc(s.status)}">${esc(s.status)}</span>
                                </span>
                            </span>
                        </span>
                    </div>`;
            }).join('');

            n.sessionsList.querySelectorAll('[data-session-id]').forEach((row) => {
                row.addEventListener('click', () => this.toggleSession(row.dataset.sessionId));
                row.addEventListener('keydown', (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    this.toggleSession(row.dataset.sessionId);
                });
            });

            // The row-level verbs must not also open/close the row they sit on.
            n.sessionsList.querySelectorAll('[data-adm-edit-session]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const session = this.sessions.find((s) => s.id === btn.dataset.admEditSession);
                    if (session) this.openSessionModal(session);
                });
            });
            n.sessionsList.querySelectorAll('[data-adm-delete-session]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteSession(btn.dataset.admDeleteSession);
                });
            });
        },

        // The row is a disclosure: tapping the open one closes it again.
        toggleSession(sessionId) {
            if (sessionId && sessionId === this.selectedSessionId) {
                this.closeSession();
                return Promise.resolve();
            }
            return this.selectSession(sessionId);
        },

        closeSession() {
            this.selectedSessionId = null;
            this.renderSessions();
            this.nodes.detailSection.style.display = 'none';
            this.renderBottomNav();
        },

        async selectSession(sessionId) {
            this.selectedSessionId = sessionId;
            this.renderSessions();
            this.renderBottomNav();
            await this.loadSessionDetail();
            // The detail lands below the fold on a phone — take the reader to it
            // rather than leaving the tap looking like it did nothing.
            if (global.innerWidth <= 768) {
                this.nodes.detailSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        },

        async loadSessionDetail() {
            const session = this.selectedSession();
            const n = this.nodes;
            if (!session) {
                n.detailSection.style.display = 'none';
                return;
            }

            n.detailSection.style.display = '';
            n.detailEyebrow.textContent = session.mode === 'remote' ? 'Remote session' : 'Supervised session';
            n.remoteNotice.style.display = session.mode === 'remote' ? '' : 'none';

            try {
                this.candidates = await global.dataService.getAdmissionCandidates(session.id);
            } catch (e) {
                console.error('[Admissions] Failed to load candidates:', e);
                this.candidates = [];
            }
            this.renderCandidates();

            try {
                const { rows } = await global.dataService.getAdmissionRanking(session.id);
                this.ranking = rows;
            } catch (e) {
                console.error('[Admissions] Failed to load ranking:', e);
                this.ranking = [];
            }
            this.renderRanking();
        },

        openSessionModal(session) {
            const n = this.nodes;
            n.sessionForm.reset();
            n.sessionStatusMsg.textContent = '';
            n.sessionStatusMsg.className = 'adm-status';

            if (session) {
                n.sessionEyebrow.textContent = 'Edit session';
                n.sessionModalTitle.textContent = 'Edit Admission Session';
                n.sessionSubmit.textContent = 'Save changes';
                n.sessionIdInput.value = session.id;
                n.sessionTitleInput.value = session.title;
                n.sessionExamSelect.value = session.examId;
                n.sessionClassSelect.value = session.entryClass || '';
                n.sessionStatusSelect.value = session.status;
                n.sessionOpens.value = toLocalInput(session.opensAt);
                n.sessionCloses.value = toLocalInput(session.closesAt);
                const modeRadio = document.querySelector(`input[name="adm-mode"][value="${session.mode}"]`);
                if (modeRadio) modeRadio.checked = true;
                const releasedRadio = document.querySelector(
                    `input[name="adm-released"][value="${session.released ? 'yes' : 'no'}"]`);
                if (releasedRadio) releasedRadio.checked = true;
            } else {
                n.sessionEyebrow.textContent = 'New session';
                n.sessionModalTitle.textContent = 'Create Admission Session';
                n.sessionSubmit.textContent = 'Create session';
                n.sessionIdInput.value = '';
            }

            this.syncModeFields();
            this.openModal(n.sessionModal);
        },

        syncModeFields() {
            const mode = document.querySelector('input[name="adm-mode"]:checked')?.value || 'lab';
            const isRemote = mode === 'remote';
            this.nodes.remoteOnly.forEach((el) => {
                el.style.display = isRemote ? '' : 'none';
            });
            this.nodes.modeHint.textContent = isRemote
                ? 'Remote: the window and the proctor release are enforced when a candidate redeems, and each code binds to the first device that uses it.'
                : 'Supervised: the teacher in the room is the control, so codes work any time the session is open.';
        },

        async submitSession(event) {
            event.preventDefault();
            const n = this.nodes;
            const id = n.sessionIdInput.value;
            const mode = document.querySelector('input[name="adm-mode"]:checked')?.value || 'lab';
            const released = document.querySelector('input[name="adm-released"]:checked')?.value === 'yes';

            const payload = {
                title: n.sessionTitleInput.value.trim(),
                examId: n.sessionExamSelect.value,
                entryClass: n.sessionClassSelect.value,
                status: n.sessionStatusSelect.value,
                mode,
                released: mode === 'remote' ? released : false,
                opensAt: mode === 'remote' && n.sessionOpens.value ? new Date(n.sessionOpens.value).toISOString() : null,
                closesAt: mode === 'remote' && n.sessionCloses.value ? new Date(n.sessionCloses.value).toISOString() : null
            };

            if (!payload.title || !payload.examId) {
                n.sessionStatusMsg.textContent = 'Give the session a title and choose an exam.';
                n.sessionStatusMsg.className = 'adm-status error';
                return;
            }

            n.sessionSubmit.disabled = true;
            try {
                if (id) {
                    await global.dataService.updateAdmissionSession(id, payload);
                } else {
                    const created = await global.dataService.createAdmissionSession(payload);
                    this.selectedSessionId = created.id;
                }
                this.closeModal(n.sessionModal);
                await this.refreshSessions();
            } catch (e) {
                n.sessionStatusMsg.textContent = e?.message || 'Could not save the session.';
                n.sessionStatusMsg.className = 'adm-status error';
            } finally {
                n.sessionSubmit.disabled = false;
            }
        },

        // Called both from the row's trash icon (with an id) and the detail
        // head's Delete CTA (without one, meaning the open session).
        async deleteSession(sessionId) {
            const session = sessionId
                ? this.sessions.find((s) => s.id === sessionId)
                : this.selectedSession();
            if (!session) return;

            const confirmed = global.confirm(
                `Delete "${session.title}"?\n\n` +
                'This permanently removes every candidate in this session, their accounts and their ' +
                'personal details. Results already recorded are kept only for candidates you have ' +
                'already promoted to students.\n\nThis cannot be undone.'
            );
            if (!confirmed) return;

            try {
                await global.dataService.deleteAdmissionSession(session.id);
                // Deleting a row other than the open one must not close it.
                if (this.selectedSessionId === session.id) this.selectedSessionId = null;
                await this.refreshSessions();
            } catch (e) {
                global.alert(e?.message || 'Could not delete the session.');
            }
        },

        // --- Candidates ----------------------------------------------------

        matchesSearch(candidate) {
            if (!this.searchQuery) return true;
            return `${candidate.candidateId} ${candidate.fullName}`.toLowerCase().includes(this.searchQuery);
        },

        candidateView(c) {
            const unclaimed = !c.nameLocked;
            return {
                unclaimed,
                statusPill: {
                    issued: '<span class="adm-pill">Issued</span>',
                    started: '<span class="adm-pill warn">Sitting</span>',
                    submitted: '<span class="adm-pill ok">Submitted</span>',
                    absent: '<span class="adm-pill danger">Absent</span>'
                }[c.status] || `<span class="adm-pill">${esc(c.status)}</span>`,
                nameCell: unclaimed
                    ? '<em style="color:var(--text-secondary);">Unclaimed walk-in code</em>'
                    : esc(c.fullName),
                actions: `
                    <button class="adm-cta muted" data-adm-rename="${esc(c.id)}" type="button">
                        ${unclaimed ? 'Set name' : 'Fix name'}
                    </button>
                    ${c.status === 'issued'
                        ? `<button class="adm-cta danger" data-adm-absent="${esc(c.id)}" type="button">Absent</button>`
                        : ''}`
            };
        },

        renderCandidates() {
            const n = this.nodes;
            if (!n.candidatesBody) return;

            const rows = this.candidates.filter((c) => this.matchesSearch(c));
            n.candidatesEmpty.style.display = rows.length ? 'none' : '';

            n.candidatesBody.innerHTML = rows.map((c) => {
                const v = this.candidateView(c);
                return `
                    <tr>
                        <td class="adm-cid">${esc(c.candidateId)}</td>
                        <td>${v.nameCell}</td>
                        <td>${v.statusPill}</td>
                        <td>${fmtDateTime(c.startedAt)}</td>
                        <td><span class="adm-row-actions">${v.actions}</span></td>
                    </tr>`;
            }).join('');

            // Mobile: the same rows as cards — two rows of two cells, with the
            // actions on their own line underneath.
            if (n.candidatesCards) {
                n.candidatesCards.innerHTML = rows.map((c) => {
                    const v = this.candidateView(c);
                    return `
                        <article class="adm-card">
                            <div class="adm-card-grid">
                                <div class="adm-card-cell">
                                    <span class="adm-card-label">Candidate ID</span>
                                    <span class="adm-card-value adm-cid">${esc(c.candidateId)}</span>
                                </div>
                                <div class="adm-card-cell right">
                                    <span class="adm-card-label">Status</span>
                                    <span class="adm-card-value">${v.statusPill}</span>
                                </div>
                                <div class="adm-card-cell">
                                    <span class="adm-card-label">Name</span>
                                    <span class="adm-card-value${v.unclaimed ? ' muted' : ' strong'}">${v.nameCell}</span>
                                </div>
                                <div class="adm-card-cell right">
                                    <span class="adm-card-label">Started</span>
                                    <span class="adm-card-value stamp">${fmtDateTime(c.startedAt)}</span>
                                </div>
                            </div>
                            <div class="adm-card-actions">${v.actions.trim()}</div>
                        </article>`;
                }).join('');
            }

            // Both renderings carry the same data attributes, so bind across the
            // pair rather than once per container.
            [n.candidatesBody, n.candidatesCards].forEach((host) => {
                if (!host) return;
                host.querySelectorAll('[data-adm-rename]').forEach((btn) => {
                    btn.addEventListener('click', () => this.renameCandidate(btn.dataset.admRename));
                });
                host.querySelectorAll('[data-adm-absent]').forEach((btn) => {
                    btn.addEventListener('click', () => this.markAbsent(btn.dataset.admAbsent));
                });
            });
        },

        /**
         * Reconciliation. Walk-ins type their own names under exam-hall
         * conditions, so misspellings and near-duplicates are the norm, not the
         * exception — this is what keeps the ranked list matchable to the paper
         * application files.
         *
         * Uses a real modal rather than window.prompt(): prompt() is a no-op in
         * the packaged desktop shell and is suppressed by several mobile web
         * views, which is why the button appeared to do nothing there.
         */
        renameCandidate(recordId) {
            const candidate = this.candidates.find((c) => c.id === recordId);
            if (!candidate) return;
            const n = this.nodes;

            n.renameForm.reset();
            n.renameStatus.textContent = '';
            n.renameStatus.className = 'adm-status';
            n.renameRecordId.value = recordId;
            n.renameName.value = candidate.fullName || '';
            n.renameEyebrow.textContent = candidate.candidateId;
            n.renameTitle.textContent = candidate.nameLocked ? 'Fix candidate name' : 'Set candidate name';

            this.openModal(n.renameModal);
            n.renameName.focus();
            n.renameName.select();
        },

        async submitRename(event) {
            event.preventDefault();
            const n = this.nodes;
            const recordId = n.renameRecordId.value;
            const name = n.renameName.value.trim();

            if (!name) {
                n.renameStatus.textContent = 'Enter a name.';
                n.renameStatus.className = 'adm-status error';
                return;
            }

            n.renameSubmit.disabled = true;
            try {
                await global.dataService.updateAdmissionCandidateName(recordId, name);
                this.closeModal(n.renameModal);
                await this.loadSessionDetail();
            } catch (e) {
                n.renameStatus.textContent = e?.message || 'Could not update the name.';
                n.renameStatus.className = 'adm-status error';
            } finally {
                n.renameSubmit.disabled = false;
            }
        },

        async markAbsent(recordId) {
            try {
                await global.dataService.markAdmissionCandidateAbsent(recordId);
                await this.loadSessionDetail();
            } catch (e) {
                global.alert(e?.message || 'Could not update the candidate.');
            }
        },

        // --- Codes ---------------------------------------------------------

        openGenerateModal() {
            if (!this.selectedSession()) return;
            const n = this.nodes;
            n.generateForm.reset();
            n.generateBlanks.value = '0';
            n.generateStatus.textContent = '';
            n.generateStatus.className = 'adm-status';
            this.openModal(n.generateModal);
        },

        async submitGenerate(event) {
            event.preventDefault();
            const n = this.nodes;
            const session = this.selectedSession();
            if (!session) return;

            const named = n.generateNames.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean);
            const blankCount = parseInt(n.generateBlanks.value, 10) || 0;

            if (named.length === 0 && blankCount === 0) {
                n.generateStatus.textContent = 'Add at least one name, or a number of blank codes.';
                n.generateStatus.className = 'adm-status error';
                return;
            }

            n.generateSubmit.disabled = true;
            n.generateStatus.textContent = 'Generating…';
            n.generateStatus.className = 'adm-status';

            try {
                const response = await global.dataService.generateAdmissionCodes(session.id, { named, blankCount });
                this.closeModal(n.generateModal);
                this.showSlips(response, session);
                await this.loadSessionDetail();
            } catch (e) {
                n.generateStatus.textContent = e?.message || 'Could not generate codes.';
                n.generateStatus.className = 'adm-status error';
            } finally {
                n.generateSubmit.disabled = false;
            }
        },

        showSlips(response, session) {
            const n = this.nodes;
            const school = global.dataService.getCurrentUser()?.schoolVersion || '';
            const slips = response?.slips || [];

            n.slipsGrid.innerHTML = slips.map((slip) => {
                if (slip.error) {
                    return `
                        <div class="adm-slip">
                            <div class="adm-slip-school">${esc(school)}</div>
                            <div class="adm-slip-name" style="color:#EA4335;">Failed: ${esc(slip.error)}</div>
                            <div class="adm-slip-field">
                                <div class="adm-slip-label">Candidate ID</div>
                                <div class="adm-slip-value">${esc(slip.candidateId)}</div>
                            </div>
                        </div>`;
                }
                return `
                    <div class="adm-slip">
                        <div class="adm-slip-school">${esc(school)} &middot; ${esc(session.title)}</div>
                        <div class="adm-slip-name">${slip.blank ? '____________________' : esc(slip.fullName)}</div>
                        <div class="adm-slip-field">
                            <div class="adm-slip-label">Candidate ID</div>
                            <div class="adm-slip-value">${esc(slip.candidateId)}</div>
                        </div>
                        <div class="adm-slip-field">
                            <div class="adm-slip-label">Access Code</div>
                            <div class="adm-slip-value">${esc(slip.code)}</div>
                        </div>
                    </div>`;
            }).join('');

            this.openModal(n.slipsModal);
        },

        // --- Ranking -------------------------------------------------------

        renderRanking() {
            const n = this.nodes;
            if (!n.rankingBody) return;

            const rows = this.ranking.filter((r) => this.matchesSearch(r));
            n.rankingEmpty.style.display = rows.length ? 'none' : '';

            const missing = this.ranking.filter((r) => r.missingResult).length;
            n.missingNotice.style.display = missing > 0 ? '' : 'none';
            n.missingCount.textContent = String(missing);

            n.rankingBody.innerHTML = rows.map((r) => {
                const v = this.rankingView(r);
                return `
                    <tr>
                        <td class="adm-num">${r.rank ?? '—'}</td>
                        <td>
                            <div>${esc(r.fullName || 'Unnamed')}${v.anomaly}</div>
                            <div class="adm-cid" style="color:var(--text-secondary);">${esc(r.candidateId)}</div>
                        </td>
                        <td>${v.scoreCell}</td>
                        <td class="adm-num">${v.percentCell}</td>
                        <td>${fmtDateTime(r.submittedAt)}</td>
                        <td>${v.decisionPill}</td>
                        <td><span class="adm-row-actions">${v.actions}</span></td>
                    </tr>`;
            }).join('');

            // Mobile: position and identity lead the card, the three numbers sit
            // in a row beneath, and the decision verbs close it out.
            if (n.rankingCards) {
                n.rankingCards.innerHTML = rows.map((r) => {
                    const v = this.rankingView(r);
                    return `
                        <article class="adm-card">
                            <div class="adm-card-head">
                                <span class="adm-rank-chip">${r.rank ?? '—'}</span>
                                <div class="adm-card-head-main">
                                    <div class="adm-card-title">${esc(r.fullName || 'Unnamed')}</div>
                                    <div class="adm-cid adm-card-cid">${esc(r.candidateId)}</div>
                                </div>
                                <span class="adm-card-head-tags">${v.anomaly}${v.decisionPill}</span>
                            </div>
                            <div class="adm-card-grid three">
                                <div class="adm-card-cell">
                                    <span class="adm-card-label">Score</span>
                                    <span class="adm-card-value">${v.scoreCell}</span>
                                </div>
                                <div class="adm-card-cell">
                                    <span class="adm-card-label">Percent</span>
                                    <span class="adm-card-value adm-num">${v.percentCell}</span>
                                </div>
                                <div class="adm-card-cell right">
                                    <span class="adm-card-label">Submitted</span>
                                    <span class="adm-card-value stamp">${fmtDateTime(r.submittedAt)}</span>
                                </div>
                            </div>
                            <div class="adm-card-actions">${v.actions.trim()}</div>
                        </article>`;
                }).join('');
            }

            [n.rankingBody, n.rankingCards].forEach((host) => {
                if (!host) return;
                host.querySelectorAll('[data-adm-promote]').forEach((btn) => {
                    btn.addEventListener('click', () => this.openPromoteModal(btn.dataset.admPromote));
                });
                host.querySelectorAll('[data-adm-decline]').forEach((btn) => {
                    btn.addEventListener('click', () => this.setDecision(btn.dataset.admDecline, 'declined'));
                });
            });
        },

        rankingView(r) {
            return {
                decisionPill: {
                    admitted: '<span class="adm-pill ok">Admitted</span>',
                    declined: '<span class="adm-pill danger">Declined</span>'
                }[r.decision] || '<span class="adm-pill">Undecided</span>',

                anomaly: r.timeAnomaly
                    ? ` <span class="adm-pill warn" title="Submitted ${esc(r.elapsedMins)} minutes after starting — longer than the exam allows. Review before ranking.">Time flag</span>`
                    : '',

                scoreCell: r.percentage === null
                    ? (r.missingResult
                        ? '<span class="adm-pill warn">No result received</span>'
                        : '<span style="color:var(--text-secondary);">—</span>')
                    : `<span class="adm-num">${esc(r.score)} / ${esc(r.totalPoints)}</span>`,

                percentCell: r.percentage === null ? '—' : esc(r.percentage) + '%',

                actions: `
                    ${r.decision !== 'admitted'
                        ? `<button class="adm-cta" data-adm-promote="${esc(r.id)}" type="button">Admit</button>`
                        : ''}
                    ${r.decision !== 'declined'
                        ? `<button class="adm-cta danger" data-adm-decline="${esc(r.id)}" type="button">Decline</button>`
                        : ''}`
            };
        },

        async setDecision(recordId, decision) {
            try {
                await global.dataService.setAdmissionCandidateDecision(recordId, decision);
                await this.loadSessionDetail();
            } catch (e) {
                global.alert(e?.message || 'Could not update the decision.');
            }
        },

        openPromoteModal(recordId) {
            const row = this.ranking.find((r) => r.id === recordId);
            if (!row) return;
            const n = this.nodes;
            const session = this.selectedSession();

            n.promoteForm.reset();
            n.promoteStatus.textContent = '';
            n.promoteStatus.className = 'adm-status';
            n.promoteCandidateId.value = recordId;
            n.promoteName.value = row.fullName || '';
            n.promoteClass.value = session?.entryClass || '';
            n.promoteTitle.textContent = `Admit ${row.fullName || row.candidateId}`;
            this.openModal(n.promoteModal);
        },

        async submitPromote(event) {
            event.preventDefault();
            const n = this.nodes;
            const recordId = n.promoteCandidateId.value;
            const classLevel = n.promoteClass.value;
            const fullName = n.promoteName.value.trim();
            const username = n.promoteUsername.value.trim();

            if (!classLevel) {
                n.promoteStatus.textContent = 'Choose the class this candidate is joining.';
                n.promoteStatus.className = 'adm-status error';
                return;
            }

            n.promoteSubmit.disabled = true;
            try {
                await global.dataService.promoteAdmissionCandidate(recordId, { classLevel, username, fullName });
                this.closeModal(n.promoteModal);
                await this.loadSessionDetail();
            } catch (e) {
                n.promoteStatus.textContent = e?.message || 'Could not admit this candidate.';
                n.promoteStatus.className = 'adm-status error';
            } finally {
                n.promoteSubmit.disabled = false;
            }
        },

        // --- UI plumbing ---------------------------------------------------

        switchTab(tab) {
            if (!tab) return;
            this.currentTab = tab;
            this.nodes.tabButtons.forEach((btn) => {
                btn.classList.toggle('active', btn.dataset.admTab === tab);
            });
            this.nodes.panels.forEach((panel) => {
                panel.style.display = panel.dataset.admPanel === tab ? '' : 'none';
            });
            this.renderBottomNav();
        },

        // --- Mobile bottom nav ----------------------------------------------
        // Contextual: the slot for the screen you are already on is replaced by
        // that screen's own primary verb, so the bar never links to where you
        // already are. With no session picked there is nothing to tab between,
        // so only Sessions (as "New Session") is offered.

        navView() {
            return this.selectedSessionId ? this.currentTab : 'sessions';
        },

        renderBottomNav() {
            const nav = this.nodes?.bottomNav;
            if (!nav) return;

            const I = NAV_ICONS;
            const view = this.navView();
            const hasSession = !!this.selectedSessionId;

            const items = [{
                key: 'back',
                label: 'Back',
                icon: I.back,
                onClick: () => this.goBack()
            }];

            const proxy = (sourceId, label, icon) => ({
                key: 'action:' + sourceId,
                label,
                icon,
                sourceId,
                onClick: () => {
                    const btn = document.getElementById(sourceId);
                    if (btn && !btn.disabled) btn.click();
                }
            });

            NAV_SLOTS.forEach((slot) => {
                // The tabs only mean anything once a session is open.
                if (slot.needsSession && !hasSession) return;

                if (slot.view === view) {
                    if (slot.view === 'sessions') {
                        items.push(proxy('adm-new-session-cta', 'New Session', I.plus));
                    } else if (slot.view === 'candidates') {
                        items.push(proxy('adm-generate-cta', 'Generate', I.generate));
                    }
                    // Ranking acts row by row, so its slot simply drops.
                    return;
                }

                items.push({
                    key: 'view:' + slot.view,
                    label: slot.label,
                    icon: slot.icon,
                    onClick: () => this.navigateTo(slot.view)
                });
            });

            // Exactly one item carries the highlight — where you are most likely
            // headed next.
            const wanted = {
                sessions: 'action:adm-new-session-cta',
                candidates: 'action:adm-generate-cta',
                // Admitting happens per candidate, so the roster is the next stop.
                ranking: 'view:candidates'
            }[view];
            const suggested = items.find((it) => it.key === wanted);
            if (suggested) suggested.suggested = true;

            nav.innerHTML = '';
            items.forEach((item) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'bottom-nav-item' + (item.suggested ? ' active nav-action-primary' : '');
                const source = item.sourceId ? document.getElementById(item.sourceId) : null;
                if (source && source.disabled) btn.disabled = true;
                btn.innerHTML =
                    '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
                    'stroke-width="2" width="22" height="22">' + item.icon + '</svg></span>' +
                    '<span>' + esc(item.label) + '</span>';
                btn.addEventListener('click', item.onClick);
                nav.appendChild(btn);
            });
        },

        navigateTo(view) {
            if (view === 'sessions') {
                this.nodes.sessionsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            this.switchTab(view);
            this.nodes.detailSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },

        // A picked session is a screen of its own on mobile, so Back closes it
        // before it leaves the module.
        goBack() {
            if (this.selectedSessionId) {
                this.closeSession();
                this.nodes.sessionsSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            if (global.Utils?.goBack) global.Utils.goBack();
            else global.history.back();
        },

        openModal(modal) {
            if (modal) modal.hidden = false;
        },

        closeModal(modal) {
            if (modal) modal.hidden = true;
        }
    };

    global.admissionsDashboard = dashboard;
})(window);
