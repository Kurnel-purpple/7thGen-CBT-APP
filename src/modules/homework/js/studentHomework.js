/**
 * Student homework view.
 * Backed by window.dataService (PocketBase) via homeworkDataService.
 *
 * Flow:
 *   - Primary view: list of assignments
 *   - Click row (or its open icon) -> detail "page" replaces the list
 *   - Detail page has a back button to return to the list
 *   - Respond / Edit icon (on list and on detail) opens the response modal
 *   - Submitting the modal closes it and refreshes data
 *   - Graded assignments cannot be edited (no respond/edit affordance shown)
 */

(function (global) {
    'use strict';

    const studentHomework = {
        assignments: [],
        submissionMap: {},
        searchQuery: '',
        viewMode: 'list',           // 'list' | 'detail'
        currentAssignmentId: null,
        responseAssignmentId: null,

        async init() {
            const user = global.dataService?.getCurrentUser?.();
            if (!user) {
                global.location.href = '../index.html';
                return;
            }
            if (user.role !== 'student') {
                global.location.href = 'homework.html';
                return;
            }

            this.cache();
            this.bind();
            await this.refresh();
        },

        cache() {
            this.nodes = {
                userName: document.getElementById('user-name'),
                userAvatar: document.getElementById('sidebar-avatar'),
                classText: document.getElementById('hw-student-class'),
                statOpen: document.getElementById('hw-stat-open'),
                statDueSoon: document.getElementById('hw-stat-due-soon'),
                statSubmitted: document.getElementById('hw-stat-submitted'),
                listView: document.getElementById('hw-list-view'),
                detailView: document.getElementById('hw-detail-view'),
                list: document.getElementById('hw-student-list'),
                listMeta: document.getElementById('hw-list-meta'),
                detail: document.getElementById('hw-student-detail'),
                searchInput: document.getElementById('hw-student-search'),
                backBtn: document.getElementById('hw-back-to-list'),
                // Response modal
                responseModal: document.getElementById('hw-response-modal'),
                responseEyebrow: document.getElementById('hw-response-eyebrow'),
                responseTitle: document.getElementById('hw-response-title'),
                responseAssignment: document.getElementById('hw-response-assignment'),
                responseDue: document.getElementById('hw-response-due'),
                form: document.getElementById('hw-submit-form'),
                textarea: document.getElementById('hw-submit-text'),
                submitBtn: document.getElementById('hw-submit-btn'),
                statusMsg: document.getElementById('hw-submit-status')
            };
        },

        bind() {
            const user = global.dataService.getCurrentUser();
            if (this.nodes.userName) this.nodes.userName.textContent = user.name || user.username || 'Student';
            if (this.nodes.userAvatar) {
                this.nodes.userAvatar.textContent = (user.name || user.username || 'S').trim().charAt(0).toUpperCase();
            }
            if (this.nodes.classText) this.nodes.classText.textContent = user.classLevel || user.class_level || 'Student';

            if (this.nodes.form) {
                this.nodes.form.addEventListener('submit', (event) => this.handleSubmit(event));
            }

            if (this.nodes.searchInput) {
                this.nodes.searchInput.addEventListener('input', (event) => {
                    this.searchQuery = String(event.target.value || '').toLowerCase();
                    this.renderList();
                });
            }

            if (this.nodes.backBtn) {
                this.nodes.backBtn.addEventListener('click', () => this.showList());
            }

            if (this.nodes.responseModal) {
                Array.from(this.nodes.responseModal.querySelectorAll('[data-hw-close-response]')).forEach((el) => {
                    el.addEventListener('click', () => this.closeResponseModal());
                });
            }

            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && this.nodes.responseModal && !this.nodes.responseModal.hidden) {
                    this.closeResponseModal();
                }
            });

            const logoutBtn = document.getElementById('hw-logout-btn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    if (global.auth?.logout) {
                        global.auth.logout();
                    } else if (global.dataService?.logout) {
                        global.dataService.logout().finally(() => { global.location.href = '../index.html'; });
                    } else {
                        global.location.href = '../index.html';
                    }
                });
            }
        },

        async refresh() {
            try {
                this.assignments = await global.dataService.getStudentHomeworkAssignments();
                this.submissionMap = await global.dataService.getOwnHomeworkSubmissionMap();
            } catch (error) {
                console.error('[Homework] student refresh failed:', error);
                this.setStatus(this.friendlyError(error, 'Could not load assignments.'), 'error');
                this.assignments = [];
                this.submissionMap = {};
            }

            this.renderStats();
            this.renderList();

            // Refresh detail if we're currently viewing one
            if (this.viewMode === 'detail' && this.currentAssignmentId) {
                this.renderDetail();
            }
        },

        renderStats() {
            const submitted = this.assignments.filter((item) => !!this.submissionMap[item.id]).length;
            const now = Date.now();
            const dueSoon = this.assignments.filter((item) => {
                const dueAt = new Date(item.dueDate).getTime();
                return !Number.isNaN(dueAt) && dueAt >= now && dueAt <= now + (7 * 24 * 60 * 60 * 1000);
            }).length;
            const open = this.assignments.filter((item) => {
                const dueAt = new Date(item.dueDate).getTime();
                return Number.isNaN(dueAt) || dueAt >= now;
            }).length;

            if (this.nodes.statOpen) this.nodes.statOpen.textContent = String(open);
            if (this.nodes.statDueSoon) this.nodes.statDueSoon.textContent = String(dueSoon);
            if (this.nodes.statSubmitted) this.nodes.statSubmitted.textContent = String(submitted);
        },

        filterList(list) {
            if (!this.searchQuery) return list;
            return list.filter((a) => {
                const haystack = `${a.title} ${a.subject} ${a.targetClass} ${a.instructions}`.toLowerCase();
                return haystack.includes(this.searchQuery);
            });
        },

        renderList() {
            if (!this.nodes.list) return;
            const list = this.filterList(this.assignments);
            if (this.nodes.listMeta) {
                this.nodes.listMeta.textContent = `${list.length} ${list.length === 1 ? 'assignment' : 'assignments'}`;
            }

            if (!list.length) {
                this.nodes.list.innerHTML = `
                    <div class="hw-empty">
                        <div class="hw-empty-title">${this.searchQuery ? 'No matches' : 'Nothing yet'}</div>
                        <div>${this.searchQuery
                            ? 'No assignments match your search.'
                            : 'No homework has been assigned to your class yet.'}</div>
                    </div>`;
                return;
            }

            this.nodes.list.innerHTML = list.map((assignment) => {
                const submission = this.submissionMap[assignment.id];
                const dueState = this.getDueState(assignment.dueDate);
                const state = this.getRowState(assignment, submission, dueState);
                const canRespond = !submission || submission.status === 'returned';
                const respondIcon = !submission
                    ? this.iconCheck('Respond to this assignment')
                    : this.iconEdit('Edit your response');

                return `
                    <article class="hw-row" data-hw-assignment-id="${this.escape(assignment.id)}" tabindex="0" role="button" aria-label="Open ${this.escape(assignment.title)}">
                        <div class="hw-row-main">
                            <h3 class="hw-row-title">${this.escape(assignment.title)}</h3>
                            <div class="hw-row-meta">${this.escape(assignment.subject)} &middot; Due ${this.formatDate(assignment.dueDate)}</div>
                            ${assignment.instructions ? `<div class="hw-row-copy">${this.escape(this.stripHtml(assignment.instructions))}</div>` : ''}
                            <div class="hw-row-chips">
                                <span class="hw-chip ${state.className}">${state.label}</span>
                                ${submission && submission.status === 'graded' && submission.score != null
                                    ? `<span class="hw-chip muted">${submission.score}/${assignment.points || 0}</span>`
                                    : ''}
                            </div>
                        </div>
                        <div class="hw-row-aside">
                            ${canRespond ? `
                                <button type="button" class="hw-icon-btn ${submission ? '' : 'success'}" data-hw-action="respond" title="${submission ? 'Edit your response' : 'Respond'}" aria-label="${submission ? 'Edit your response' : 'Respond to assignment'}">
                                    ${respondIcon}
                                </button>` : ''}
                        </div>
                    </article>
                `;
            }).join('');

            Array.from(this.nodes.list.querySelectorAll('[data-hw-assignment-id]')).forEach((row) => {
                const id = row.getAttribute('data-hw-assignment-id');
                row.addEventListener('click', (event) => {
                    if (event.target.closest('[data-hw-action]')) return; // icon handled separately
                    this.openDetail(id);
                });
                row.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        this.openDetail(id);
                    }
                });
                const respondBtn = row.querySelector('[data-hw-action="respond"]');
                if (respondBtn) {
                    respondBtn.addEventListener('click', (event) => {
                        event.stopPropagation();
                        this.openResponseModal(id);
                    });
                }
            });
        },

        getRowState(assignment, submission, dueState) {
            if (submission?.status === 'graded') return { label: 'Graded', className: 'success' };
            if (submission?.status === 'returned') return { label: 'Returned', className: 'warn' };
            if (submission) return { label: 'Submitted', className: 'primary' };
            return dueState;
        },

        openDetail(assignmentId) {
            this.currentAssignmentId = assignmentId;
            this.viewMode = 'detail';
            this.renderDetail();
            if (this.nodes.listView) this.nodes.listView.classList.add('is-hidden');
            if (this.nodes.detailView) this.nodes.detailView.classList.add('is-open');
            window.scrollTo({ top: 0, behavior: 'instant' });
        },

        showList() {
            this.viewMode = 'list';
            this.currentAssignmentId = null;
            if (this.nodes.detailView) this.nodes.detailView.classList.remove('is-open');
            if (this.nodes.listView) this.nodes.listView.classList.remove('is-hidden');
        },

        renderDetail() {
            if (!this.nodes.detail) return;
            const assignment = this.assignments.find((item) => item.id === this.currentAssignmentId);
            if (!assignment) {
                this.showList();
                return;
            }

            const submission = this.submissionMap[assignment.id] || null;
            const dueState = this.getDueState(assignment.dueDate);
            const state = this.getRowState(assignment, submission, dueState);
            const isGraded = submission?.status === 'graded';
            const canRespond = !submission || submission.status === 'returned';

            const submissionBlock = submission ? `
                <section class="hw-detail-block">
                    <div class="hw-detail-block-label">Your submission</div>
                    <div class="hw-detail-response">${this.escape(submission.content)}</div>
                    <div class="hw-muted" style="margin-top:8px;">Submitted ${this.formatDateTime(submission.submittedAt)}</div>
                    ${(submission.status !== 'submitted') && (submission.score != null || submission.feedback) ? `
                        <div class="hw-feedback-block">
                            <span class="hw-feedback-label">${submission.status === 'returned' ? 'Returned for revision' : 'Teacher feedback'}</span>
                            ${submission.score != null
                                ? `<div class="hw-grade-headline">${submission.score}<small>/ ${assignment.points || 0} pts</small></div>`
                                : ''}
                            ${submission.feedback ? this.escape(submission.feedback) : (submission.score != null ? '' : 'No additional feedback.')}
                        </div>` : ''}
                    ${canRespond ? `
                        <div class="hw-detail-actions">
                            <button type="button" class="btn-primary" id="hw-detail-respond-btn" style="background:var(--primary); color:var(--text-on-primary); border:none; border-radius:var(--radius-pill); padding:10px 22px; font-weight:700; cursor:pointer; font-family:var(--font-family); font-size:0.9rem;">Edit your response</button>
                        </div>` : ''}
                </section>
            ` : `
                <section class="hw-detail-block">
                    <div class="hw-detail-block-label">Your response</div>
                    <p style="color:var(--text-secondary); margin:0 0 14px;">You haven't responded yet.</p>
                    <div class="hw-detail-actions">
                        <button type="button" class="btn-primary" id="hw-detail-respond-btn" style="background:var(--primary); color:var(--text-on-primary); border:none; border-radius:var(--radius-pill); padding:10px 22px; font-weight:700; cursor:pointer; font-family:var(--font-family); font-size:0.9rem;">Respond to assignment</button>
                    </div>
                </section>
            `;

            this.nodes.detail.innerHTML = `
                <div class="hw-row-chips" style="margin-top:0;">
                    <span class="hw-chip ${state.className}">${state.label}</span>
                    <span class="hw-chip primary">${this.escape(assignment.subject)}</span>
                    <span class="hw-chip muted">${this.escape(assignment.targetClass)}</span>
                    <span class="hw-chip muted">${assignment.points || 0} pts</span>
                </div>
                <h2 class="hw-detail-title">${this.escape(assignment.title)}</h2>
                <div class="hw-detail-meta">Assigned by ${this.escape(assignment.createdByName || 'Teacher')} &middot; Due ${this.formatDate(assignment.dueDate)}</div>
                <div class="hw-detail-instructions">${this.escape(this.stripHtml(assignment.instructions || '')) || 'No extra instructions were added.'}</div>
                ${submissionBlock}
                ${isGraded ? `<p class="hw-muted" style="margin-top:18px;">This assignment has been graded. Resubmissions are closed.</p>` : ''}
            `;

            const respondBtn = this.nodes.detail.querySelector('#hw-detail-respond-btn');
            if (respondBtn) {
                respondBtn.addEventListener('click', () => this.openResponseModal(assignment.id));
            }
        },

        openResponseModal(assignmentId) {
            const assignment = this.assignments.find((a) => a.id === assignmentId);
            if (!assignment) return;
            const submission = this.submissionMap[assignmentId] || null;

            // Block editing for graded assignments — defensive, the UI already hides the trigger
            if (submission && submission.status === 'graded') return;

            this.responseAssignmentId = assignmentId;
            if (this.nodes.responseAssignment) this.nodes.responseAssignment.textContent = assignment.title;
            if (this.nodes.responseDue) this.nodes.responseDue.textContent = this.formatDate(assignment.dueDate);
            if (this.nodes.responseEyebrow) this.nodes.responseEyebrow.textContent = submission ? 'Edit Response' : 'New Response';
            if (this.nodes.responseTitle) this.nodes.responseTitle.textContent = submission ? 'Edit your response' : 'Respond to assignment';
            if (this.nodes.submitBtn) this.nodes.submitBtn.textContent = submission ? 'Resubmit Homework' : 'Submit Homework';
            if (this.nodes.textarea) this.nodes.textarea.value = submission?.content || '';
            this.setStatus('', '');
            if (this.nodes.responseModal) {
                this.nodes.responseModal.hidden = false;
                setTimeout(() => this.nodes.textarea?.focus(), 80);
            }
        },

        closeResponseModal() {
            if (this.nodes.responseModal) this.nodes.responseModal.hidden = true;
            this.responseAssignmentId = null;
        },

        async handleSubmit(event) {
            event.preventDefault();
            const assignmentId = this.responseAssignmentId;
            if (!assignmentId) return;
            const content = this.nodes.textarea.value;
            try {
                await global.dataService.submitHomework(assignmentId, { content });
                this.closeResponseModal();
                await this.refresh();
            } catch (error) {
                this.setStatus(this.friendlyError(error, 'Could not submit homework.'), 'error');
            }
        },

        setStatus(message, type) {
            if (!this.nodes.statusMsg) return;
            this.nodes.statusMsg.textContent = message;
            this.nodes.statusMsg.className = `hw-status ${type || ''}`;
        },

        getDueState(dueDate) {
            const dueAt = new Date(dueDate).getTime();
            if (Number.isNaN(dueAt)) return { label: 'No due date', className: 'muted' };
            const now = Date.now();
            if (dueAt < now) return { label: 'Past due', className: 'danger' };
            if (dueAt <= now + (7 * 24 * 60 * 60 * 1000)) return { label: 'Due soon', className: 'warn' };
            return { label: 'Active', className: 'primary' };
        },

        formatDate(value) {
            if (!value) return 'No due date';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return 'No due date';
            return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
        },

        formatDateTime(value) {
            if (!value) return 'Unknown';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return 'Unknown';
            return d.toLocaleString([], {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        },

        stripHtml(value) {
            if (!value) return '';
            const div = document.createElement('div');
            div.innerHTML = String(value);
            return div.textContent || div.innerText || '';
        },

        escape(value) {
            const div = document.createElement('div');
            div.textContent = String(value || '');
            return div.innerHTML;
        },

        iconCheck() {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>';
        },

        iconEdit() {
            return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
        },

        friendlyError(error, fallback) {
            const message = error?.message || error?.data?.message || '';
            if (!message) return fallback;
            if (/auth|login|unauthor|forbid/i.test(message)) return 'You need to be signed in to do that.';
            if (/network|fetch|connect/i.test(message)) return 'Network error. Check your internet connection and try again.';
            if (/collection.*homework_(assignments|submissions)/i.test(message) || /not\s*found.*collection/i.test(message)) {
                return 'Homework collections are missing on the server. Ask your admin to run the homework migrations.';
            }
            return message || fallback;
        }
    };

    global.studentHomework = studentHomework;
})(typeof globalThis !== 'undefined' ? globalThis : window);
