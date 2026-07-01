/**
 * Teacher / admin homework dashboard.
 * Backed by window.dataService (PocketBase) via homeworkDataService.
 */

(function (global) {
    'use strict';

    const dashboard = {
        currentView: 'assignments',
        assignments: [],
        submissionSummary: [],
        searchQuery: '',
        editingId: null,
        gradingSubmission: null,
        gradingAssignment: null,
        userRole: null,

        async init() {
            const user = global.dataService?.getCurrentUser?.();
            if (!user) {
                global.location.href = '../index.html';
                return;
            }
            if (user.role === 'student') {
                global.location.href = 'student-homework.html';
                return;
            }

            this.userRole = user.role || null;
            this.cache();
            this.bind();
            this.populateFormOptions();
            await this.refresh();
        },

        cache() {
            this.nodes = {
                userName: document.getElementById('user-name'),
                userAvatar: document.getElementById('sidebar-avatar'),
                roleText: document.getElementById('homework-role-text'),
                createForm: document.getElementById('hw-create-form'),
                editIdInput: document.getElementById('hw-edit-id'),
                titleInput: document.getElementById('hw-title'),
                subjectSelect: document.getElementById('hw-subject'),
                classSelect: document.getElementById('hw-class'),
                dueDateInput: document.getElementById('hw-due-date'),
                pointsInput: document.getElementById('hw-points'),
                instructionsInput: document.getElementById('hw-instructions'),
                composerEyebrow: document.getElementById('hw-composer-eyebrow'),
                composerTitle: document.getElementById('hw-composer-title'),
                submitBtn: document.getElementById('hw-submit-btn'),
                composerModal: document.getElementById('hw-composer-modal'),
                statAssignments: document.getElementById('hw-stat-assignments'),
                statDueSoon: document.getElementById('hw-stat-due-soon'),
                statSubmissions: document.getElementById('hw-stat-submissions'),
                statPending: document.getElementById('hw-stat-pending'),
                assignmentsList: document.getElementById('hw-assignments-list'),
                submissionsList: document.getElementById('hw-submissions-list'),
                assignmentsMeta: document.getElementById('hw-assignments-meta'),
                submissionsMeta: document.getElementById('hw-submissions-meta'),
                createStatus: document.getElementById('hw-create-status'),
                viewButtons: Array.from(document.querySelectorAll('[data-hw-view-btn]')),
                viewSections: Array.from(document.querySelectorAll('[data-hw-view]')),
                searchInput: document.getElementById('hw-search-input'),
                createCta: document.getElementById('hw-create-cta'),
                gradeModal: document.getElementById('hw-grade-modal'),
                gradeForm: document.getElementById('hw-grade-form'),
                gradeStudent: document.getElementById('hw-grade-student'),
                gradeAssignment: document.getElementById('hw-grade-assignment'),
                gradeWhen: document.getElementById('hw-grade-when'),
                gradeContent: document.getElementById('hw-grade-content'),
                gradeScore: document.getElementById('hw-grade-score'),
                gradeFeedback: document.getElementById('hw-grade-feedback'),
                gradeStatus: document.getElementById('hw-grade-status-select'),
                gradeStatusMsg: document.getElementById('hw-grade-status-msg')
            };
        },

        bind() {
            const user = global.dataService.getCurrentUser();
            if (this.nodes.userName) this.nodes.userName.textContent = user.name || user.username || 'Teacher';
            if (this.nodes.userAvatar) {
                this.nodes.userAvatar.textContent = (user.name || user.username || 'T').trim().charAt(0).toUpperCase();
            }
            if (this.nodes.roleText) this.nodes.roleText.textContent = user.role === 'admin' ? 'Administrator' : 'Teacher';

            if (this.nodes.createForm) {
                this.nodes.createForm.addEventListener('submit', (event) => this.handleCreate(event));
            }

            this.nodes.viewButtons.forEach((button) => {
                button.addEventListener('click', () => this.switchView(button.getAttribute('data-hw-view-btn')));
            });

            if (this.nodes.searchInput) {
                this.nodes.searchInput.addEventListener('input', (event) => {
                    this.searchQuery = String(event.target.value || '').toLowerCase();
                    this.renderAssignments();
                    this.renderSubmissions();
                });
            }

            if (this.nodes.createCta) {
                this.nodes.createCta.addEventListener('click', () => this.openComposer());
            }

            if (this.nodes.composerModal) {
                Array.from(this.nodes.composerModal.querySelectorAll('[data-hw-close-composer]')).forEach((el) => {
                    el.addEventListener('click', () => this.closeComposer());
                });
            }

            if (this.nodes.gradeForm) {
                this.nodes.gradeForm.addEventListener('submit', (event) => this.handleGradeSubmit(event));
            }

            if (this.nodes.gradeModal) {
                Array.from(this.nodes.gradeModal.querySelectorAll('[data-hw-close-grade]')).forEach((el) => {
                    el.addEventListener('click', () => this.closeGradeModal());
                });
            }

            document.addEventListener('keydown', (event) => {
                if (event.key !== 'Escape') return;
                if (this.nodes.composerModal && !this.nodes.composerModal.hidden) this.closeComposer();
                if (this.nodes.gradeModal && !this.nodes.gradeModal.hidden) this.closeGradeModal();
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

        populateFormOptions() {
            const includeAll = true;
            const classList = global.academicEntities?.getAllClasses?.({ includeAll }) || [];
            const subjectsByLevel = global.academicEntities?.getSubjectsByLevel?.() || {};
            const uniqueSubjects = [...new Set(Object.values(subjectsByLevel).flat())];

            if (this.nodes.classSelect) {
                this.nodes.classSelect.innerHTML = '<option value="">Select class</option>'
                    + classList.map((item) => `<option value="${this.escape(item.value)}">${this.escape(item.text)}</option>`).join('');
            }
            if (this.nodes.subjectSelect) {
                this.nodes.subjectSelect.innerHTML = '<option value="">Select subject</option>'
                    + uniqueSubjects.map((item) => `<option value="${this.escape(item)}">${this.escape(item)}</option>`).join('');
            }
        },

        async refresh() {
            try {
                this.assignments = await global.dataService.getTeacherHomeworkAssignments();
                this.submissionSummary = await global.dataService.getHomeworkSubmissionSummary(this.assignments);
            } catch (error) {
                console.error('[Homework] refresh failed:', error);
                this.setStatus(this.friendlyError(error, 'Could not load homework data.'), 'error');
                this.assignments = [];
                this.submissionSummary = [];
            }
            this.renderStats();
            this.renderAssignments();
            this.renderSubmissions();
        },

        renderStats() {
            const submissionCount = this.submissionSummary.reduce((sum, item) => sum + item.submissionCount, 0);
            const gradedCount = this.submissionSummary.reduce((sum, item) => sum + (item.gradedCount || 0), 0);
            const pending = Math.max(0, submissionCount - gradedCount);
            const dueSoon = this.assignments.filter((item) => {
                const dueAt = new Date(item.dueDate).getTime();
                const now = Date.now();
                return dueAt >= now && dueAt <= now + (7 * 24 * 60 * 60 * 1000);
            }).length;

            if (this.nodes.statAssignments) this.nodes.statAssignments.textContent = String(this.assignments.length);
            if (this.nodes.statDueSoon) this.nodes.statDueSoon.textContent = String(dueSoon);
            if (this.nodes.statSubmissions) this.nodes.statSubmissions.textContent = String(submissionCount);
            if (this.nodes.statPending) this.nodes.statPending.textContent = String(pending);
        },

        filterAssignments(list) {
            if (!this.searchQuery) return list;
            return list.filter((a) => {
                const haystack = `${a.title} ${a.subject} ${a.targetClass} ${a.instructions}`.toLowerCase();
                return haystack.includes(this.searchQuery);
            });
        },

        renderAssignments() {
            if (!this.nodes.assignmentsList) return;
            const list = this.filterAssignments(this.assignments);
            if (this.nodes.assignmentsMeta) {
                this.nodes.assignmentsMeta.textContent = `${list.length} ${list.length === 1 ? 'assignment' : 'assignments'}`;
            }

            if (!list.length) {
                this.nodes.assignmentsList.innerHTML = `
                    <div class="hw-empty">
                        <div class="hw-empty-title">${this.searchQuery ? 'No matches' : 'No homework yet'}</div>
                        <div>${this.searchQuery
                            ? 'No assignments match your search.'
                            : 'Click <strong>+ New Assignment</strong> to publish your first one.'}</div>
                    </div>`;
                return;
            }

            const isAdmin = this.userRole === 'admin';

            this.nodes.assignmentsList.innerHTML = list.map((assignment) => {
                const summary = this.submissionSummary.find((item) => item.assignmentId === assignment.id);
                const dueState = this.getDueState(assignment.dueDate);
                const submissionCount = summary?.submissionCount || 0;
                const gradedCount = summary?.gradedCount || 0;
                return `
                    <article class="hw-row" data-hw-assignment-id="${this.escape(assignment.id)}">
                        <div class="hw-row-main">
                            <h3 class="hw-row-title">${this.escape(assignment.title)}</h3>
                            <div class="hw-row-meta">${this.escape(assignment.subject)} &middot; ${this.escape(assignment.targetClass)} &middot; Due ${this.formatDate(assignment.dueDate)}</div>
                            ${assignment.instructions ? `<div class="hw-row-copy">${this.escape(this.stripHtml(assignment.instructions))}</div>` : ''}
                            <div class="hw-row-chips">
                                <span class="hw-chip ${dueState.className}">${dueState.label}</span>
                                <span class="hw-chip primary">${assignment.points || 0} pts</span>
                                <span class="hw-chip muted">${submissionCount} submission${submissionCount === 1 ? '' : 's'}</span>
                                ${submissionCount > 0
                                    ? `<span class="hw-chip ${gradedCount === submissionCount ? 'success' : 'warn'}">${gradedCount}/${submissionCount} graded</span>`
                                    : ''}
                                ${isAdmin ? `<span class="hw-chip muted">By ${this.escape(assignment.createdByName || 'Teacher')}</span>` : ''}
                            </div>
                        </div>
                        <div class="hw-row-aside">
                            <button type="button" class="hw-icon-btn" data-hw-action="edit" title="Edit" aria-label="Edit assignment">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                            </button>
                            <button type="button" class="hw-icon-btn danger" data-hw-action="delete" title="Delete" aria-label="Delete assignment">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                            </button>
                        </div>
                    </article>
                `;
            }).join('');

            Array.from(this.nodes.assignmentsList.querySelectorAll('[data-hw-assignment-id]')).forEach((card) => {
                const id = card.getAttribute('data-hw-assignment-id');
                card.querySelector('[data-hw-action="edit"]').addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.openComposer(id);
                });
                card.querySelector('[data-hw-action="delete"]').addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.handleDelete(id);
                });
                // Clicking the row also opens edit (deliberate path)
                card.addEventListener('click', () => this.openComposer(id));
            });
        },

        renderSubmissions() {
            if (!this.nodes.submissionsList) return;
            const rows = [];
            this.submissionSummary.forEach((summary) => {
                const assignment = this.assignments.find((item) => item.id === summary.assignmentId);
                if (!assignment || !summary.submissionCount) return;

                summary.submissions.forEach((submission) => {
                    if (this.searchQuery) {
                        const haystack = `${submission.studentName} ${assignment.title} ${assignment.subject} ${submission.content}`.toLowerCase();
                        if (!haystack.includes(this.searchQuery)) return;
                    }
                    const statusClass = submission.status === 'graded' ? 'success'
                        : submission.status === 'returned' ? 'warn' : 'primary';
                    const scoreLabel = submission.status !== 'submitted' && submission.score != null
                        ? `${submission.score} / ${assignment.points || 0}`
                        : 'Awaiting grade';

                    rows.push(`
                        <article class="hw-row" data-hw-submission-id="${this.escape(submission.id)}" data-hw-assignment-id="${this.escape(assignment.id)}">
                            <div class="hw-row-main">
                                <h3 class="hw-row-title">${this.escape(submission.studentName || 'Student')}</h3>
                                <div class="hw-row-meta">${this.escape(assignment.title)} &middot; ${this.escape(submission.classLevel || assignment.targetClass || '')} &middot; ${this.formatDateTime(submission.submittedAt)}</div>
                                <div class="hw-row-copy">${this.escape(submission.content)}</div>
                                <div class="hw-row-chips">
                                    <span class="hw-chip ${statusClass}">${this.statusLabel(submission.status)}</span>
                                    <span class="hw-chip muted">${this.escape(scoreLabel)}</span>
                                    ${submission.feedback ? `<span class="hw-chip muted">Feedback sent</span>` : ''}
                                </div>
                            </div>
                            <div class="hw-row-aside">
                                <button type="button" class="hw-icon-btn success" data-hw-action="grade" title="Grade" aria-label="Grade submission">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>
                                </button>
                            </div>
                        </article>
                    `);
                });
            });

            if (this.nodes.submissionsMeta) {
                this.nodes.submissionsMeta.textContent = `${rows.length} ${rows.length === 1 ? 'submission' : 'submissions'}`;
            }

            this.nodes.submissionsList.innerHTML = rows.length
                ? rows.join('')
                : `<div class="hw-empty">
                        <div class="hw-empty-title">${this.searchQuery ? 'No matches' : 'Nothing here yet'}</div>
                        <div>${this.searchQuery
                            ? 'No submissions match your search.'
                            : 'Submissions will appear here as students turn in their work.'}</div>
                    </div>`;

            Array.from(this.nodes.submissionsList.querySelectorAll('[data-hw-submission-id]')).forEach((row) => {
                const submissionId = row.getAttribute('data-hw-submission-id');
                const assignmentId = row.getAttribute('data-hw-assignment-id');
                const trigger = () => this.openGradeModal(assignmentId, submissionId);
                row.querySelector('[data-hw-action="grade"]').addEventListener('click', (event) => {
                    event.stopPropagation();
                    trigger();
                });
                row.addEventListener('click', trigger);
            });
        },

        openComposer(assignmentId) {
            if (assignmentId) {
                const assignment = this.assignments.find((a) => a.id === assignmentId);
                if (!assignment) return;
                this.editingId = assignmentId;
                if (this.nodes.editIdInput) this.nodes.editIdInput.value = assignmentId;
                if (this.nodes.titleInput) this.nodes.titleInput.value = assignment.title || '';
                if (this.nodes.subjectSelect) this.nodes.subjectSelect.value = assignment.subject || '';
                if (this.nodes.classSelect) this.nodes.classSelect.value = assignment.targetClass || '';
                if (this.nodes.dueDateInput) this.nodes.dueDateInput.value = this.toDateInputValue(assignment.dueDate);
                if (this.nodes.pointsInput) this.nodes.pointsInput.value = String(assignment.points || 0);
                if (this.nodes.instructionsInput) this.nodes.instructionsInput.value = this.stripHtml(assignment.instructions || '');
                if (this.nodes.composerEyebrow) this.nodes.composerEyebrow.textContent = 'Edit Assignment';
                if (this.nodes.composerTitle) this.nodes.composerTitle.textContent = 'Update Homework';
                if (this.nodes.submitBtn) this.nodes.submitBtn.textContent = 'Save changes';
            } else {
                this.editingId = null;
                if (this.nodes.createForm) this.nodes.createForm.reset();
                if (this.nodes.editIdInput) this.nodes.editIdInput.value = '';
                if (this.nodes.composerEyebrow) this.nodes.composerEyebrow.textContent = 'New Assignment';
                if (this.nodes.composerTitle) this.nodes.composerTitle.textContent = 'Create Homework';
                if (this.nodes.submitBtn) this.nodes.submitBtn.textContent = 'Publish Homework';
            }
            this.setStatus('', '');
            if (this.nodes.composerModal) {
                this.nodes.composerModal.hidden = false;
                setTimeout(() => this.nodes.titleInput?.focus(), 80);
            }
        },

        closeComposer() {
            if (this.nodes.composerModal) this.nodes.composerModal.hidden = true;
            this.editingId = null;
            if (this.nodes.editIdInput) this.nodes.editIdInput.value = '';
        },

        async handleCreate(event) {
            event.preventDefault();
            const payload = {
                title: this.nodes.titleInput.value,
                subject: this.nodes.subjectSelect.value,
                targetClass: this.nodes.classSelect.value,
                dueDate: this.nodes.dueDateInput.value,
                points: this.nodes.pointsInput.value,
                instructions: this.nodes.instructionsInput.value
            };

            try {
                if (this.editingId) {
                    await global.dataService.updateHomeworkAssignment(this.editingId, payload);
                } else {
                    await global.dataService.createHomeworkAssignment(payload);
                }
                this.closeComposer();
                await this.refresh();
                this.switchView('assignments');
            } catch (error) {
                this.setStatus(this.friendlyError(error, 'Could not save assignment.'), 'error');
            }
        },

        async handleDelete(assignmentId) {
            const assignment = this.assignments.find((a) => a.id === assignmentId);
            if (!assignment) return;
            const ok = global.confirm(`Delete "${assignment.title}"? Students will no longer see it, and any submissions for it will be removed.`);
            if (!ok) return;
            try {
                await global.dataService.deleteHomeworkAssignment(assignmentId);
                if (this.editingId === assignmentId) this.closeComposer();
                await this.refresh();
            } catch (error) {
                this.setStatus(this.friendlyError(error, 'Could not delete assignment.'), 'error');
            }
        },

        openGradeModal(assignmentId, submissionId) {
            const summary = this.submissionSummary.find((s) => s.assignmentId === assignmentId);
            const submission = summary?.submissions.find((s) => s.id === submissionId);
            const assignment = this.assignments.find((a) => a.id === assignmentId);
            if (!submission || !assignment || !this.nodes.gradeModal) return;

            this.gradingSubmission = submission;
            this.gradingAssignment = assignment;

            this.nodes.gradeStudent.textContent = submission.studentName || 'Student';
            this.nodes.gradeAssignment.textContent = `${assignment.title} (${assignment.points || 0} pts)`;
            this.nodes.gradeWhen.textContent = this.formatDateTime(submission.submittedAt);
            this.nodes.gradeContent.textContent = submission.content || '';
            this.nodes.gradeScore.value = submission.score != null ? String(submission.score) : '';
            this.nodes.gradeFeedback.value = submission.feedback || '';
            this.nodes.gradeStatus.value = submission.status === 'returned' ? 'returned' : 'graded';
            if (this.nodes.gradeStatusMsg) {
                this.nodes.gradeStatusMsg.textContent = '';
                this.nodes.gradeStatusMsg.className = 'hw-status';
            }

            this.nodes.gradeModal.hidden = false;
        },

        closeGradeModal() {
            if (this.nodes.gradeModal) this.nodes.gradeModal.hidden = true;
            this.gradingSubmission = null;
            this.gradingAssignment = null;
        },

        async handleGradeSubmit(event) {
            event.preventDefault();
            if (!this.gradingSubmission) return;
            const score = this.nodes.gradeScore.value;
            const max = Number(this.gradingAssignment?.points || 0);
            const numericScore = score === '' ? null : Number(score);
            if (numericScore !== null && (Number.isNaN(numericScore) || numericScore < 0 || (max > 0 && numericScore > max))) {
                this.setGradeStatus(`Score must be between 0 and ${max || 'the assignment max'}.`, 'error');
                return;
            }

            try {
                await global.dataService.gradeHomeworkSubmission(this.gradingSubmission.id, {
                    score: numericScore,
                    feedback: this.nodes.gradeFeedback.value,
                    status: this.nodes.gradeStatus.value
                });
                this.setGradeStatus('Grade saved.', 'success');
                await this.refresh();
                setTimeout(() => this.closeGradeModal(), 600);
            } catch (error) {
                this.setGradeStatus(this.friendlyError(error, 'Could not save grade.'), 'error');
            }
        },

        setGradeStatus(message, type) {
            if (!this.nodes.gradeStatusMsg) return;
            this.nodes.gradeStatusMsg.textContent = message;
            this.nodes.gradeStatusMsg.className = `hw-status ${type || ''}`;
        },

        setStatus(message, type) {
            if (!this.nodes.createStatus) return;
            this.nodes.createStatus.textContent = message;
            this.nodes.createStatus.className = `hw-status ${type || ''}`;
        },

        switchView(view) {
            this.currentView = view;
            this.nodes.viewButtons.forEach((button) => {
                button.classList.toggle('active', button.getAttribute('data-hw-view-btn') === view);
            });
            this.nodes.viewSections.forEach((section) => {
                section.style.display = section.getAttribute('data-hw-view') === view ? '' : 'none';
            });
        },

        getDueState(dueDate) {
            const dueAt = new Date(dueDate).getTime();
            if (Number.isNaN(dueAt)) return { label: 'No due date', className: 'muted' };
            const now = Date.now();
            if (dueAt < now) return { label: 'Closed', className: 'danger' };
            if (dueAt <= now + (7 * 24 * 60 * 60 * 1000)) return { label: 'Due soon', className: 'warn' };
            return { label: 'Active', className: 'primary' };
        },

        statusLabel(status) {
            if (status === 'graded') return 'Graded';
            if (status === 'returned') return 'Returned';
            return 'Submitted';
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

        toDateInputValue(value) {
            if (!value) return '';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return '';
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
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

        friendlyError(error, fallback) {
            const message = error?.message || error?.data?.message || '';
            if (!message) return fallback;
            if (/auth|login|unauthor|forbid/i.test(message)) return 'You need to be signed in with the right role to do that.';
            if (/network|fetch|connect/i.test(message)) return 'Network error. Check your internet connection and try again.';
            if (/collection.*homework_(assignments|submissions)/i.test(message) || /not\s*found.*collection/i.test(message)) {
                return 'Homework collections are missing on the server. Run the homework migrations on PocketBase.';
            }
            return message || fallback;
        }
    };

    global.homeworkDashboard = dashboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
