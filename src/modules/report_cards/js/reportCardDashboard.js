/**
 * Report Card Dashboard Controller
 * Teacher/admin view for generating, reviewing, and publishing report cards.
 */

(function() {
    'use strict';

    var state = {
        academic: null,
        currentView: 'generate',
        reportCards: [],
        selectedCardIds: new Set(),
        editingCardId: null
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function gradeColor(grade) {
        var colors = { A: '#2e7d32', B: '#388e3c', C: '#f57f17', D: '#ef6c00', E: '#d84315', F: '#c62828' };
        return colors[grade] || 'var(--text-secondary)';
    }

    function ordinalSuffix(n) {
        var s = ['th', 'st', 'nd', 'rd'];
        var v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    // ================================================================
    // VIEW SWITCHING
    // ================================================================

    function switchView(view) {
        state.currentView = view;
        document.querySelectorAll('.rc-view').forEach(function(el) {
            el.classList.toggle('active', el.id === 'rc-view-' + view);
        });
        document.querySelectorAll('[data-rc-nav]').forEach(function(el) {
            el.classList.toggle('active', el.getAttribute('data-rc-nav') === view);
        });
        var subtitle = document.getElementById('topbar-subtitle');
        if (subtitle) {
            var labels = { generate: 'Generate Report Cards', review: 'Review & Publish', view: 'View Published', 'access-codes': 'Manage Access Codes' };
            subtitle.textContent = labels[view] || 'Report Cards';
        }
    }

    // ================================================================
    // GENERATE FORM
    // ================================================================

    function populateFormDropdowns(academic) {
        var classSelect = document.getElementById('rc-class');
        if (classSelect && academic) {
            var allClasses = [];
            Object.values(academic.classesByLevel || {}).forEach(function(list) {
                list.forEach(function(c) { allClasses.push(c); });
            });
            classSelect.innerHTML = '<option value="">Select Class</option>' + allClasses.map(function(c) {
                return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>';
            }).join('');
        }
    }

    async function handleGenerate(event) {
        event.preventDefault();

        var classLevel = document.getElementById('rc-class')?.value;
        var term = document.getElementById('rc-term')?.value;
        var session = document.getElementById('rc-session')?.value || '';
        var startDate = document.getElementById('rc-date-start')?.value || '';
        var endDate = document.getElementById('rc-date-end')?.value || '';

        if (!classLevel || !term) {
            alert('Please select a class and term.');
            return;
        }

        var genBtn = document.getElementById('rc-generate-btn');
        var statusEl = document.getElementById('rc-gen-status');
        if (genBtn) { genBtn.disabled = true; genBtn.textContent = 'Generating...'; }
        if (statusEl) statusEl.textContent = 'Fetching results and attendance data...';

        try {
            var cards = await window.dataService.generateReportCardData({
                classLevel: classLevel,
                term: term,
                session: session,
                dateRange: { start: startDate, end: endDate }
            });

            if (cards.length === 0) {
                if (statusEl) statusEl.textContent = 'No students found in ' + classLevel + ', or no exam results match "' + term + '".';
                return;
            }

            // Save all generated cards
            var saveResult = await window.dataService.saveReportCards(cards);
            state.reportCards = saveResult.results;

            if (statusEl) {
                statusEl.textContent = 'Generated ' + saveResult.saved + ' report card' + (saveResult.saved !== 1 ? 's' : '') +
                    (saveResult.failed > 0 ? ' (' + saveResult.failed + ' failed)' : '') + '. Switch to "Review" to add remarks and publish.';
            }

            // Auto-switch to review view
            switchView('review');
            renderReviewList(state.reportCards);
        } catch (err) {
            console.error('[ReportCards] generate failed:', err);
            if (statusEl) statusEl.textContent = 'Error: ' + (err.message || 'Generation failed');
        } finally {
            if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Generate Report Cards'; }
        }
    }

    // ================================================================
    // REVIEW VIEW — list of draft cards, remarks editor, publish
    // ================================================================

    async function loadReviewCards() {
        var classLevel = document.getElementById('rc-review-class-filter')?.value || '';
        var term = document.getElementById('rc-review-term-filter')?.value || '';

        try {
            var filters = {};
            if (classLevel) filters.classLevel = classLevel;
            if (term) filters.term = term;

            state.reportCards = await window.dataService.getReportCards(filters);
            renderReviewList(state.reportCards);
        } catch (err) {
            console.error('[ReportCards] load review cards failed:', err);
        }
    }

    function renderReviewList(cards) {
        var list = document.getElementById('rc-review-list');
        if (!list) return;

        if (!cards || cards.length === 0) {
            list.innerHTML = '<p style="color:var(--light-text); padding:20px 0;">No report cards found. Generate them first using the "Generate" tab.</p>';
            updateBulkActions();
            return;
        }

        list.innerHTML = cards.map(function(card) {
            var statusBadge = card.status === 'published'
                ? '<span class="rc-badge rc-badge-published">Published</span>'
                : '<span class="rc-badge rc-badge-draft">Draft</span>';

            var subjects = Array.isArray(card.subjects) ? card.subjects : [];
            var subjectSummary = subjects.length > 0
                ? subjects.length + ' subject' + (subjects.length !== 1 ? 's' : '') + ' | Avg: ' + card.averageScore + '%'
                : 'No subjects';

            var position = card.classPosition
                ? ordinalSuffix(card.classPosition) + ' of ' + card.classSize
                : '—';

            var cardIdStr = String(card.id);
            return '<article class="rc-card" data-card-id="' + escapeHtml(cardIdStr) + '">' +
                '<label class="rc-card-check"><input type="checkbox" data-select-card="' + escapeHtml(cardIdStr) + '" ' + (state.selectedCardIds.has(cardIdStr) ? 'checked' : '') + ' /></label>' +
                '<div class="rc-card-body">' +
                    '<div class="rc-card-header">' +
                        '<strong>' + escapeHtml(card.studentName) + '</strong>' +
                        statusBadge +
                    '</div>' +
                    '<div class="rc-card-meta">' + escapeHtml(card.classLevel) + ' | ' + escapeHtml(card.term) + (card.session ? ' | ' + escapeHtml(card.session) : '') + '</div>' +
                    '<div class="rc-card-meta">' + subjectSummary + ' | Position: ' + position + '</div>' +
                '</div>' +
                '<div class="rc-card-actions">' +
                    '<button class="ghost-cta" data-view-card="' + escapeHtml(cardIdStr) + '" title="View / Edit">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                    '</button>' +
                    '<button class="ghost-cta ghost-cta-danger" data-delete-card="' + escapeHtml(cardIdStr) + '" title="Delete">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                    '</button>' +
                '</div>' +
            '</article>';
        }).join('');

        // Bind event listeners
        list.querySelectorAll('input[data-select-card]').forEach(function(input) {
            input.addEventListener('change', function() {
                var id = input.getAttribute('data-select-card');
                if (input.checked) state.selectedCardIds.add(id);
                else state.selectedCardIds.delete(id);
                updateBulkActions();
            });
        });

        list.querySelectorAll('[data-view-card]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                openCardDetail(btn.getAttribute('data-view-card'));
            });
        });

        list.querySelectorAll('[data-delete-card]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                deleteCard(btn.getAttribute('data-delete-card'));
            });
        });

        updateBulkActions();
    }

    function updateBulkActions() {
        var publishBtn = document.getElementById('rc-publish-selected-btn');
        var deleteBtn = document.getElementById('rc-delete-selected-btn');
        var count = state.selectedCardIds.size;
        if (publishBtn) {
            publishBtn.style.display = count > 0 ? 'inline-flex' : 'none';
            var countEl = publishBtn.querySelector('.rc-sel-count');
            if (countEl) countEl.textContent = count;
        }
        if (deleteBtn) {
            deleteBtn.style.display = count > 0 ? 'inline-flex' : 'none';
            var countEl2 = deleteBtn.querySelector('.rc-sel-count');
            if (countEl2) countEl2.textContent = count;
        }
    }

    async function publishSelected() {
        var ids = Array.from(state.selectedCardIds);
        if (ids.length === 0) return;
        if (!confirm('Publish ' + ids.length + ' report card' + (ids.length !== 1 ? 's' : '') + '? Students will be able to view them.')) return;

        try {
            var result = await window.dataService.publishReportCards(ids);
            state.selectedCardIds.clear();
            await loadReviewCards();
            alert('Published ' + result.published + ' report card' + (result.published !== 1 ? 's' : '') +
                (result.failed > 0 ? '. ' + result.failed + ' failed.' : '.'));
        } catch (err) {
            console.error('[ReportCards] publish failed:', err);
            alert('Publish failed: ' + (err.message || 'Unknown error'));
        }
    }

    async function deleteCard(id) {
        if (!confirm('Delete this report card?')) return;
        try {
            await window.dataService.deleteReportCard(id);
            state.selectedCardIds.delete(id);
            await loadReviewCards();
        } catch (err) {
            console.error('[ReportCards] delete failed:', err);
            alert('Delete failed.');
        }
    }

    // ================================================================
    // CARD DETAIL — view full report card, edit remarks
    // ================================================================

    function openCardDetail(cardId) {
        var card = state.reportCards.find(function(c) { return String(c.id) === String(cardId); });
        if (!card) return;

        state.editingCardId = cardId;
        var modal = document.getElementById('rc-detail-modal');
        if (!modal) return;

        // Header
        var titleEl = modal.querySelector('.rc-detail-name');
        var metaEl = modal.querySelector('.rc-detail-meta');
        if (titleEl) titleEl.textContent = card.studentName;
        if (metaEl) metaEl.textContent = card.classLevel + ' | ' + card.term + (card.session ? ' | ' + card.session : '') +
            (card.classPosition ? ' | Position: ' + ordinalSuffix(card.classPosition) + ' of ' + card.classSize : '');

        // Subject table
        var cardSubjects = Array.isArray(card.subjects) ? card.subjects : [];
        var tbody = modal.querySelector('.rc-detail-subjects tbody');
        if (tbody) {
            if (cardSubjects.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--light-text);">No exam results found for this term.</td></tr>';
            } else {
                tbody.innerHTML = cardSubjects.map(function(s) {
                    return '<tr>' +
                        '<td>' + escapeHtml(s.name) + '</td>' +
                        '<td style="text-align:center;">' + s.score + ' / ' + s.totalPossible + '</td>' +
                        '<td style="text-align:center;">' + s.percentage + '%</td>' +
                        '<td style="text-align:center; font-weight:700; color:' + gradeColor(s.grade) + ';">' + escapeHtml(s.grade) + '</td>' +
                        '<td>' + escapeHtml(s.gradeLabel) + '</td>' +
                    '</tr>';
                }).join('');
            }
        }

        // Summary row
        var avgEl = modal.querySelector('.rc-detail-average');
        if (avgEl) avgEl.textContent = 'Average: ' + card.averageScore + '%';

        // Attendance
        var attEl = modal.querySelector('.rc-detail-attendance');
        if (attEl) {
            var att = card.attendance || {};
            if (att.totalDays > 0) {
                attEl.innerHTML =
                    '<div class="rc-att-row"><span>Days Present:</span><strong>' + att.present + '</strong></div>' +
                    '<div class="rc-att-row"><span>Days Absent:</span><strong>' + att.absent + '</strong></div>' +
                    '<div class="rc-att-row"><span>Days Late:</span><strong>' + att.late + '</strong></div>' +
                    '<div class="rc-att-row"><span>Total School Days:</span><strong>' + att.totalDays + '</strong></div>' +
                    '<div class="rc-att-row"><span>Attendance Rate:</span><strong>' + att.attendanceRate + '%</strong></div>';
            } else {
                attEl.innerHTML = '<p style="color:var(--light-text);">No attendance data available for this period.</p>';
            }
        }

        // Remarks fields
        var teacherRemarksEl = modal.querySelector('#rc-teacher-remarks');
        var principalRemarksEl = modal.querySelector('#rc-principal-remarks');
        if (teacherRemarksEl) teacherRemarksEl.value = card.teacherRemarks || '';
        if (principalRemarksEl) principalRemarksEl.value = card.principalRemarks || '';

        // Status
        var statusEl = modal.querySelector('.rc-detail-status');
        if (statusEl) {
            statusEl.className = 'rc-badge ' + (card.status === 'published' ? 'rc-badge-published' : 'rc-badge-draft');
            statusEl.textContent = card.status === 'published' ? 'Published' : 'Draft';
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeCardDetail() {
        var modal = document.getElementById('rc-detail-modal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
        state.editingCardId = null;
    }

    async function saveRemarks() {
        if (!state.editingCardId) return;

        var teacherRemarks = document.getElementById('rc-teacher-remarks')?.value || '';
        var principalRemarks = document.getElementById('rc-principal-remarks')?.value || '';

        try {
            await window.dataService.saveReportCard({
                id: state.editingCardId,
                teacherRemarks: teacherRemarks,
                principalRemarks: principalRemarks
            });
            // Update in local state
            var card = state.reportCards.find(function(c) { return String(c.id) === String(state.editingCardId); });
            if (card) {
                card.teacherRemarks = teacherRemarks;
                card.principalRemarks = principalRemarks;
            }
            alert('Remarks saved.');
        } catch (err) {
            console.error('[ReportCards] save remarks failed:', err);
            alert('Failed to save remarks.');
        }
    }

    // ================================================================
    // VIEW PUBLISHED — read-only list for teachers to review what's published
    // ================================================================

    async function loadPublished() {
        try {
            var filters = { status: 'published' };
            // Teachers with access code can only see their verified class
            var verifiedClass = sessionStorage.getItem('rc_verified_class');
            if (verifiedClass) filters.classLevel = verifiedClass;
            var cards = await window.dataService.getReportCards(filters);
            renderPublishedList(cards);
        } catch (err) {
            console.error('[ReportCards] load published failed:', err);
        }
    }

    function renderPublishedList(cards) {
        var list = document.getElementById('rc-published-list');
        if (!list) return;

        if (!cards || cards.length === 0) {
            list.innerHTML = '<p style="color:var(--light-text); padding:20px 0;">No published report cards yet.</p>';
            return;
        }

        list.innerHTML = cards.map(function(card) {
            var position = card.classPosition ? ordinalSuffix(card.classPosition) + ' of ' + card.classSize : '—';
            return '<article class="rc-card">' +
                '<div class="rc-card-body">' +
                    '<div class="rc-card-header"><strong>' + escapeHtml(card.studentName) + '</strong><span class="rc-badge rc-badge-published">Published</span></div>' +
                    '<div class="rc-card-meta">' + escapeHtml(card.classLevel) + ' | ' + escapeHtml(card.term) + ' | Avg: ' + card.averageScore + '% | Position: ' + position + '</div>' +
                '</div>' +
                '<div class="rc-card-actions">' +
                    '<button class="ghost-cta" data-view-pub-card="' + escapeHtml(card.id) + '" title="View">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> View' +
                    '</button>' +
                '</div>' +
            '</article>';
        }).join('');

        list.querySelectorAll('[data-view-pub-card]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                // Temporarily set into state.reportCards for the detail modal
                var card = cards.find(function(c) { return String(c.id) === btn.getAttribute('data-view-pub-card'); });
                if (card && !state.reportCards.find(function(c) { return String(c.id) === String(card.id); })) {
                    state.reportCards.push(card);
                }
                openCardDetail(btn.getAttribute('data-view-pub-card'));
            });
        });
    }

    // ================================================================
    // ACCESS GATE (Teacher must enter 6-digit code)
    // ================================================================

    function showAccessGate() {
        var modal = document.getElementById('rc-access-modal');
        if (modal) modal.classList.add('active');

        var input = document.getElementById('rc-access-code-input');
        if (input) {
            input.value = '';
            input.focus();
        }

        var errorEl = document.getElementById('rc-access-error');
        if (errorEl) errorEl.style.display = 'none';
    }

    function hideAccessGate() {
        var modal = document.getElementById('rc-access-modal');
        if (modal) modal.classList.remove('active');
    }

    function bindAccessGate(onSuccess) {
        var submitBtn = document.getElementById('rc-access-submit-btn');
        var input = document.getElementById('rc-access-code-input');
        var errorEl = document.getElementById('rc-access-error');
        var closeBtn = document.getElementById('rc-access-close-btn');

        if (closeBtn) closeBtn.addEventListener('click', function() {
            window.location.href = 'teacher-dashboard.html';
        });

        function attempt() {
            var code = (input ? input.value : '').trim();
            if (!code || code.length !== 6) {
                if (errorEl) {
                    errorEl.textContent = 'Access is restricted to admin and class teachers only. Please enter a valid 6-digit access code from your school admin.';
                    errorEl.style.display = 'block';
                }
                return;
            }

            // Check the code against all classes
            var codes = window.dataService.getReportCardAccessCodes();
            var matchedClass = null;
            Object.keys(codes).forEach(function(cl) {
                if (codes[cl] === code) matchedClass = cl;
            });

            if (!matchedClass) {
                if (errorEl) {
                    errorEl.textContent = 'Invalid access code. Please contact your school admin for the correct code.';
                    errorEl.style.display = 'block';
                }
                if (input) { input.value = ''; input.focus(); }
                return;
            }

            // Store verified class in session so they don't have to re-enter
            sessionStorage.setItem('rc_verified_class', matchedClass);
            hideAccessGate();
            onSuccess(matchedClass);
        }

        if (submitBtn) submitBtn.addEventListener('click', attempt);
        if (input) input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); attempt(); }
        });
    }

    // ================================================================
    // ACCESS CODES MANAGEMENT (Admin only)
    // ================================================================

    function renderAccessCodesTable(academic) {
        var list = document.getElementById('rc-access-codes-list');
        if (!list) return;

        var allClasses = [];
        Object.values((academic && academic.classesByLevel) || {}).forEach(function(classes) {
            classes.forEach(function(c) { allClasses.push(c); });
        });

        var codes = window.dataService.getReportCardAccessCodes();

        var html = '<table class="rc-access-table">' +
            '<thead><tr><th>Class</th><th>Access Code</th><th>Actions</th></tr></thead>' +
            '<tbody>' + allClasses.map(function(c) {
                var code = codes[c.value];
                return '<tr>' +
                    '<td style="font-weight:600;">' + escapeHtml(c.text) + '</td>' +
                    '<td>' + (code
                        ? '<span class="rc-code-display">' + escapeHtml(code) + '</span>'
                        : '<span class="rc-code-none">No code set</span>') +
                    '</td>' +
                    '<td>' +
                        '<div class="rc-code-actions">' +
                            '<button class="rc-gen-code-btn" data-class="' + escapeHtml(c.value) + '">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>' +
                                (code ? 'Regenerate' : 'Generate') +
                            '</button>' +
                            (code ? '<button class="rc-remove-code-btn" data-class="' + escapeHtml(c.value) + '">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                                'Remove</button>' : '') +
                        '</div>' +
                    '</td>' +
                '</tr>';
            }).join('') + '</tbody></table>';

        list.innerHTML = html;

        // Bind generate buttons
        list.querySelectorAll('.rc-gen-code-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var classLevel = btn.getAttribute('data-class');
                window.dataService.generateReportCardAccessCode(classLevel);
                renderAccessCodesTable(academic);
            });
        });

        // Bind remove buttons
        list.querySelectorAll('.rc-remove-code-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var classLevel = btn.getAttribute('data-class');
                window.dataService.removeReportCardAccessCode(classLevel);
                renderAccessCodesTable(academic);
            });
        });
    }

    // ================================================================
    // INIT
    // ================================================================

    async function init() {
        var user = window.dataService?.getCurrentUser?.();
        if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
            window.location.href = '../index.html';
            return;
        }

        var isAdmin = user.role === 'admin';

        // Populate user info in sidebar
        var nameEl = document.getElementById('user-name');
        var avatarEl = document.getElementById('sidebar-avatar');
        var roleEl = document.querySelector('.sidebar-profile-role');
        if (nameEl) nameEl.textContent = user.name || user.full_name || 'Teacher';
        if (avatarEl) avatarEl.textContent = (user.name || user.full_name || 'T').charAt(0).toUpperCase();
        if (roleEl) roleEl.textContent = isAdmin ? 'Admin' : 'Teacher';

        // Load academic entities for class dropdown
        var academic = null;
        try {
            academic = await window.dataService.getAcademicEntities({ includeAllClasses: false });
        } catch (err) {
            console.error('[ReportCards] Failed to load academic entities:', err);
        }
        state.academic = academic;

        // --- Access Code Gate (teachers only) ---
        if (!isAdmin) {
            // Check if already verified this session
            var verifiedClass = sessionStorage.getItem('rc_verified_class');
            if (!verifiedClass) {
                showAccessGate();
                bindAccessGate(function(matchedClass) {
                    // Access granted — continue initializing the dashboard
                    initDashboard(user, academic, isAdmin);
                });
                return; // Don't init dashboard yet — wait for access code
            }
        }

        // Admin bypasses gate; teacher with session verification proceeds
        initDashboard(user, academic, isAdmin);
    }

    function initDashboard(user, academic, isAdmin) {
        if (academic) {
            populateFormDropdowns(academic);
        }

        // Show access codes nav for admin
        var accessCodesNav = document.getElementById('rc-nav-access-codes');
        if (accessCodesNav && isAdmin) {
            accessCodesNav.style.display = '';
        }

        // Lock class to verified class for teachers
        var verifiedClass = !isAdmin ? sessionStorage.getItem('rc_verified_class') : null;

        if (verifiedClass) {
            var classSelect = document.getElementById('rc-class');
            if (classSelect) {
                classSelect.value = verifiedClass;
                classSelect.disabled = true;
            }
        }

        // Also populate review filters
        var reviewClassFilter = document.getElementById('rc-review-class-filter');
        if (reviewClassFilter && academic) {
            var allClasses = [];
            Object.values(academic.classesByLevel || {}).forEach(function(list) {
                list.forEach(function(c) { allClasses.push(c); });
            });
            reviewClassFilter.innerHTML = '<option value="">All Classes</option>' + allClasses.map(function(c) {
                return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>';
            }).join('');

            // Lock review filter to verified class for teachers
            if (verifiedClass) {
                reviewClassFilter.value = verifiedClass;
                reviewClassFilter.disabled = true;
            }
        }

        // Bind generate form
        var genForm = document.getElementById('rc-generate-form');
        if (genForm) genForm.addEventListener('submit', handleGenerate);

        // Bind review filters
        if (reviewClassFilter) reviewClassFilter.addEventListener('change', loadReviewCards);
        var reviewTermFilter = document.getElementById('rc-review-term-filter');
        if (reviewTermFilter) reviewTermFilter.addEventListener('change', loadReviewCards);

        // Bind bulk actions
        var publishBtn = document.getElementById('rc-publish-selected-btn');
        if (publishBtn) publishBtn.addEventListener('click', publishSelected);

        var deleteSelBtn = document.getElementById('rc-delete-selected-btn');
        if (deleteSelBtn) deleteSelBtn.addEventListener('click', async function() {
            var ids = Array.from(state.selectedCardIds);
            if (ids.length === 0) return;
            if (!confirm('Delete ' + ids.length + ' report card' + (ids.length !== 1 ? 's' : '') + '?')) return;
            for (var i = 0; i < ids.length; i++) {
                try { await window.dataService.deleteReportCard(ids[i]); } catch (e) { /* logged in service */ }
            }
            state.selectedCardIds.clear();
            await loadReviewCards();
        });

        // Bind detail modal
        var closeBtn = document.getElementById('rc-detail-close');
        if (closeBtn) closeBtn.addEventListener('click', closeCardDetail);
        var saveRemarksBtn = document.getElementById('rc-save-remarks-btn');
        if (saveRemarksBtn) saveRemarksBtn.addEventListener('click', saveRemarks);

        // Bind sidebar nav switching
        document.querySelectorAll('[data-rc-nav]').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.preventDefault();
                var view = el.getAttribute('data-rc-nav');
                switchView(view);
                if (view === 'review') loadReviewCards();
                if (view === 'view') loadPublished();
                if (view === 'access-codes' && isAdmin) renderAccessCodesTable(academic);
            });
        });

        // Load initial review data
        loadReviewCards();
    }

    window.reportCardDashboard = { init: init };
})();
