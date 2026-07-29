(function() {
    'use strict';

    const state = {
        academic: null,
        questions: [],
        filteredQuestions: [],
        selectedIds: new Set(),
        lastGeneratedPick: [],
        lastGeneratedCriteria: null,
        isAdmin: false,          // admin sees every teacher's questions, not just their own
        openSubjects: {},        // subject -> expanded? (admin grouped view)
        genMode: 'single',       // 'single' | 'multi' (random mix across subjects)
        allSubjects: [],
        filters: {
            subject: '',
            targetClass: '',
            difficulty: '',
            term: ''
        }
    };

    /* ================================================================
       CONTEXTUAL BOTTOM NAV
       The bottom nav is not a fixed view switcher: the slot for the view
       you are already on is swapped for that view's own action(s), which
       is why "Add" becomes "Save" once you are on the Add Question page.
       ================================================================ */
    const ICONS = {
        back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
        saved: '<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
        add: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
        generate: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
        save: '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
        preview: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
        seed: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>'
    };

    const NAV_SLOTS = [
        { view: 'saved', label: 'Saved', icon: ICONS.saved },
        { view: 'add', label: 'Add', icon: ICONS.add },
        { view: 'generate', label: 'Auto Generate', icon: ICONS.generate }
    ];

    // An action item that proxies one of the page's desktop buttons, so the
    // busy/disabled handling stays in a single place.
    function proxyAction(sourceId, label, icon, opts) {
        opts = opts || {};
        return {
            key: 'action:' + sourceId,
            label: label,
            icon: icon,
            danger: !!opts.danger,
            sourceId: sourceId,
            onClick: function() {
                var btn = document.getElementById(sourceId);
                if (btn && !btn.disabled) btn.click();
            }
        };
    }

    // Actions that take over the current view's nav slot. The slot never shows
    // a link to the page you are already on — with no actions it just drops.
    function viewActions(view) {
        if (view === 'add') {
            return [proxyAction('save-question-btn', 'Save', ICONS.save)];
        }
        if (view === 'generate') {
            // "Create", not "Generate" — the Generate nav item is what opened
            // this page; this one hands the picked questions to the exam
            // builder, the same job the Seed Exam action does.
            return [
                proxyAction('qb-gen-preview-btn', 'Preview', ICONS.preview),
                proxyAction('qb-gen-btn', 'Create', ICONS.seed)
            ];
        }
        if (view === 'preview') {
            return [proxyAction('qb-preview-create-btn', 'Create', ICONS.seed)];
        }
        if (view === 'saved' && state.selectedIds.size > 0) {
            return [
                proxyAction('seed-exam-btn', 'Seed Exam', ICONS.seed),
                proxyAction('qb-delete-selected-btn', 'Delete (' + state.selectedIds.size + ')', ICONS.trash, { danger: true })
            ];
        }
        return [];
    }

    // Slots dropped entirely for the current view. Hand-picking questions is
    // the opposite of auto-generating, so once a selection is under way the
    // Auto Generate entry gets out of the way.
    function hiddenSlots(view) {
        if (view === 'saved' && state.selectedIds.size > 0) return ['generate'];
        return [];
    }

    // The one highlighted item is where you are most likely headed NEXT, not
    // the item that got you here — so the Generate page points at Preview, and
    // the bank itself points at Generate.
    function nextStepKey(current) {
        if (current === 'add') {
            return 'action:save-question-btn';
        }
        if (current === 'generate') {
            // Check the picked questions before committing to the exam.
            return 'action:qb-gen-preview-btn';
        }
        if (current === 'preview') {
            return 'action:qb-preview-create-btn';
        }
        // Saved Questions. Ticking questions makes seeding an exam the obvious
        // next move; an empty bank makes generating pointless, so point at Add.
        if (state.selectedIds.size > 0) return 'action:seed-exam-btn';
        return state.questions.length ? 'view:generate' : 'view:add';
    }

    function buildNavButton(item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bottom-nav-item'
            + (item.suggested ? ' active nav-action-primary' : '')
            + (item.danger ? ' nav-action-danger' : '');
        if (item.view) btn.setAttribute('data-qb-nav', item.view);

        var source = item.sourceId ? document.getElementById(item.sourceId) : null;
        if (source && source.disabled) btn.disabled = true;

        btn.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            + 'stroke-width="2" width="22" height="22">' + item.icon + '</svg></span>'
            + '<span>' + escapeHtml(item.label) + '</span>';
        btn.addEventListener('click', item.onClick);
        return btn;
    }

    function renderBottomNav() {
        var nav = document.getElementById('qb-bottom-nav');
        if (!nav) return;

        var current = window.qbCurrentView || 'saved';
        var items = [{
            key: 'back',
            label: 'Back',
            icon: ICONS.back,
            onClick: function() { window.qbGoBack(); }
        }];

        // A view can borrow another's slot (Preview sits in Generate's).
        var currentSlot = (window.QB_VIEW_SLOT || {})[current] || current;
        var dropped = hiddenSlots(current);

        NAV_SLOTS.forEach(function(slot) {
            if (dropped.indexOf(slot.view) !== -1) return;

            if (slot.view === currentSlot) {
                // You are here — offer this page's actions, or nothing at all.
                items = items.concat(viewActions(current));
                return;
            }
            items.push({
                key: 'view:' + slot.view,
                view: slot.view,
                label: slot.label,
                icon: slot.icon,
                onClick: function() { window.switchQbView(slot.view); }
            });
        });

        // Exactly one item carries the highlight. Fall back to the first
        // enabled item so the bar is never left without a suggestion.
        var wanted = nextStepKey(current);
        var suggested = items.filter(function(it) { return it.key === wanted; })[0];
        if (suggested) suggested.suggested = true;

        nav.innerHTML = '';
        items.forEach(function(item) { nav.appendChild(buildNavButton(item)); });
    }

    window.qbRenderBottomNav = renderBottomNav;

    /* ================================================================
       DIALOGS
       Utils.showAlert / showConfirm are the app's own dialogs — a bottom
       sheet that slides up on mobile — so nothing here uses the browser's
       native alert/confirm. Both fall back to the native ones only if
       utils.js somehow failed to load.
       ================================================================ */
    function notify(title, message) {
        if (window.Utils && typeof window.Utils.showAlert === 'function') {
            return window.Utils.showAlert(title, escapeHtml(message));
        }
        window.alert(message);
        return Promise.resolve();
    }

    function askConfirm(title, message) {
        if (window.Utils && typeof window.Utils.showConfirm === 'function') {
            return window.Utils.showConfirm(title, escapeHtml(message));
        }
        return Promise.resolve(window.confirm(message));
    }

    /**
     * Before saving a hand-written question, check whether the bank already
     * has one that says the same thing and let the teacher decide.
     *
     * @returns {Promise<Object|null>} { action, replaceId } — action is
     *   'save' when nothing similar was found, otherwise the teacher's choice.
     *   null means they cancelled and the form should stay as it is.
     */
    async function reviewBeforeSave(question) {
        var proceed = { action: 'save', replaceId: null };
        if (typeof window.dataService.findSimilarQuestions !== 'function') return proceed;

        var matches;
        try {
            matches = await window.dataService.findSimilarQuestions(question);
        } catch (err) {
            // A failed lookup must never block saving — the exact-match
            // backstop inside createQuestionBankQuestion still applies.
            console.warn('[QuestionBank] similarity check failed, saving anyway:', err);
            return proceed;
        }
        if (!matches || matches.length === 0) return proceed;

        if (!window.DuplicateReview) {
            var keep = await askConfirm(
                'Possible Duplicate',
                'A very similar question is already in the bank. Save this one anyway?'
            );
            return keep ? { action: 'add', replaceId: null } : null;
        }

        var decisions = await window.DuplicateReview.open(
            [{ index: 0, question: question, matches: matches }],
            {
                title: 'This looks like a question you already have',
                subtitle: 'Found in the same subject and term. Choose what to keep.',
                cleanCount: 0
            }
        );
        return decisions === null ? null : (decisions[0] || proceed);
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function difficultyLabel(d) {
        if (d === 'easy') return 'Easy';
        if (d === 'hard') return 'Hard';
        return 'Medium';
    }

    function renderBadges(question) {
        let html = '';
        if (question.difficulty) {
            html += `<span class="qb-badge qb-badge-difficulty" data-difficulty="${escapeHtml(question.difficulty)}">${escapeHtml(difficultyLabel(question.difficulty))}</span>`;
        }
        if (question.term) {
            html += `<span class="qb-badge qb-badge-term">${escapeHtml(question.term)}</span>`;
        }
        if (Array.isArray(question.tags) && question.tags.length > 0) {
            question.tags.forEach(function(tag) {
                if (tag) html += `<span class="qb-badge qb-badge-tag">${escapeHtml(tag)}</span>`;
            });
        }
        return html;
    }

    function updateQuestionCount() {
        const el = document.getElementById('qb-question-count');
        if (!el) return;
        const total = state.questions.length;
        const shown = state.filteredQuestions.length;
        if (total === 0) {
            el.textContent = '';
        } else if (shown === total) {
            el.textContent = `${total} question${total !== 1 ? 's' : ''}`;
        } else {
            el.textContent = `${shown} of ${total}`;
        }
    }

    // Has the user actively narrowed the list? The term filter auto-defaults to
    // the current term, so that alone does NOT count as a user-applied filter.
    function hasActiveFilters() {
        const f = state.filters;
        return !!(f.subject || f.targetClass || f.difficulty || (f.term && f.term !== state.defaultTerm));
    }

    function renderQuestionCard(question) {
        var typeLine = [
            (question.type || 'mcq').toUpperCase(),
            question.subject || 'No subject',
            question.targetClass || 'All'
        ].join(' | ');
        return `
            <article class="qb-question-card">
                <label class="qb-question-index" style="cursor:pointer;">
                    <input type="checkbox" data-question-id="${escapeHtml(question.id)}" ${state.selectedIds.has(question.id) ? 'checked' : ''} />
                </label>
                <div class="qb-question-body" style="flex:1; min-width:0;">
                    <div class="qb-question-type">${escapeHtml(typeLine)}</div>
                    <p class="qb-question-text">${escapeHtml(question.text)}</p>
                    <div class="qb-meta-row">${renderBadges(question)}</div>
                </div>
                <button class="ghost-cta ghost-cta-danger qb-delete-btn" data-delete-id="${escapeHtml(question.id)}" title="Delete question">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </article>`;
    }

    // Admin view: collapsible subject groups, each subgrouped by term.
    function renderGroupedQuestions(list, questions) {
        var TERM_ORDER = ['1st Term', '2nd Term', '3rd Term'];
        var termRank = function(t) { var i = TERM_ORDER.indexOf(t); return i < 0 ? 99 : i; };

        var bySubject = {};
        questions.forEach(function(q) {
            var subj = q.subject || 'No subject';
            (bySubject[subj] = bySubject[subj] || []).push(q);
        });

        var chevron = '<svg class="qb-subject-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>';

        list.innerHTML = Object.keys(bySubject).sort().map(function(subj) {
            var qs = bySubject[subj];
            var open = !!state.openSubjects[subj];

            var byTerm = {};
            qs.forEach(function(q) { var t = q.term || 'No term'; (byTerm[t] = byTerm[t] || []).push(q); });
            var body = Object.keys(byTerm)
                .sort(function(a, b) { return termRank(a) - termRank(b) || a.localeCompare(b); })
                .map(function(t) {
                    return '<div class="qb-term-group">'
                        + '<div class="qb-term-subheader">' + escapeHtml(t) + ' <span class="qb-term-count">(' + byTerm[t].length + ')</span></div>'
                        + byTerm[t].map(renderQuestionCard).join('')
                        + '</div>';
                }).join('');

            return '<div class="qb-subject-group">'
                + '<button type="button" class="qb-subject-header" data-subject="' + escapeHtml(subj) + '" title="' + (open ? 'Collapse ' : 'Expand ') + escapeHtml(subj) + '">'
                + chevron
                + '<span class="qb-subject-name">' + escapeHtml(subj) + '</span>'
                + '<span class="qb-subject-count">' + qs.length + '</span>'
                + '</button>'
                + '<div class="qb-subject-body" style="display:' + (open ? 'block' : 'none') + ';">' + body + '</div>'
                + '</div>';
        }).join('');

        // Reflect the open state on chevrons, then wire toggles
        list.querySelectorAll('.qb-subject-header').forEach(function(h) {
            var subj = h.getAttribute('data-subject');
            var chev = h.querySelector('.qb-subject-chevron');
            if (chev && state.openSubjects[subj]) chev.style.transform = 'rotate(90deg)';
            h.addEventListener('click', function() {
                var willOpen = !state.openSubjects[subj];
                state.openSubjects[subj] = willOpen;
                var bodyEl = h.parentElement.querySelector('.qb-subject-body');
                if (bodyEl) bodyEl.style.display = willOpen ? 'block' : 'none';
                if (chev) chev.style.transform = willOpen ? 'rotate(90deg)' : '';
                h.title = (willOpen ? 'Collapse ' : 'Expand ') + subj;
            });
        });
    }

    function renderQuestions(questions) {
        const list = document.getElementById('question-bank-sample-list');
        if (!list) return;

        if (!questions.length) {
            var msg;
            if (state.questions.length === 0) {
                // Bank is genuinely empty
                msg = 'No questions saved yet. Add your first question from the “Add” tab.';
            } else if (hasActiveFilters()) {
                // Only blame the filters when the user actually set some
                msg = 'No questions match your filters. Try adjusting the filters above or add a new question.';
            } else {
                msg = 'No questions to show yet.';
            }
            list.innerHTML = '<p style="margin:0; color:var(--light-text);">' + msg + '</p>';
            updateQuestionCount();
            return;
        }

        // Everyone gets subject groups, collapsed until opened. Admins are
        // looking at the whole school's bank and teachers at their own, but
        // the shape of the list is the same either way.
        renderGroupedQuestions(list, questions);

        list.querySelectorAll('input[type="checkbox"][data-question-id]').forEach(function(input) {
            input.addEventListener('change', function() {
                var id = input.getAttribute('data-question-id');
                if (!id) return;
                if (input.checked) state.selectedIds.add(id);
                else state.selectedIds.delete(id);
                updateDeleteSelectedVisibility();
            });
        });

        list.querySelectorAll('.qb-delete-btn[data-delete-id]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = btn.getAttribute('data-delete-id');
                if (!id) return;
                deleteQuestion(id);
            });
        });

        updateQuestionCount();
    }

    function updateDeleteSelectedVisibility() {
        var count = state.selectedIds.size;
        var btn = document.getElementById('qb-delete-selected-btn');
        if (btn) {
            if (count > 0) {
                btn.style.display = 'inline-flex';
                btn.querySelector('.qb-delete-count').textContent = count;
            } else {
                btn.style.display = 'none';
            }
        }
        // Selecting questions gives the Saved view actions of its own, so its
        // bottom-nav slot swaps to Seed Exam + Delete.
        renderBottomNav();
    }

    async function deleteQuestion(id) {
        var ok = await askConfirm('Delete Question', 'Delete this question from the bank?');
        if (!ok) return;
        try {
            await window.dataService.deleteQuestionBankQuestion(id);
            state.selectedIds.delete(id);
            await refreshQuestions();
            updateDeleteSelectedVisibility();
        } catch (err) {
            console.error('[QuestionBank] delete failed:', err);
            notify('Delete Failed', 'That question could not be deleted. Please try again.');
        }
    }

    async function deleteSelectedQuestions() {
        var ids = Array.from(state.selectedIds);
        if (ids.length === 0) return;

        var ok = await askConfirm(
            'Delete Questions',
            'Delete ' + ids.length + ' selected question' + (ids.length !== 1 ? 's' : '') + '?'
        );
        if (!ok) return;

        try {
            var result = await window.dataService.deleteQuestionBankQuestions(ids);
            state.selectedIds.clear();
            await refreshQuestions();
            updateDeleteSelectedVisibility();
            if (result.failed > 0) {
                notify('Partly Deleted', 'Deleted ' + result.deleted + ', but ' + result.failed + ' could not be removed.');
            }
        } catch (err) {
            console.error('[QuestionBank] bulk delete failed:', err);
            notify('Delete Failed', 'Those questions could not be deleted. Please try again.');
        }
    }

    /**
     * Sweep the bank for questions that already say the same thing and let the
     * teacher delete the extra copies.
     *
     * Respects whatever filters are active, so a teacher can clean up one
     * subject at a time rather than facing the whole bank at once.
     */
    async function findDuplicates() {
        var button = document.getElementById('qb-find-duplicates-btn');
        var original = button ? button.innerHTML : '';
        if (button) { button.disabled = true; button.textContent = 'Scanning…'; }

        try {
            var ctx = window.dataService.getSchoolContext() || {};
            var filters = Object.assign(
                {},
                state.filters.subject ? { subject: state.filters.subject } : {},
                state.filters.term ? { term: state.filters.term } : {},
                state.isAdmin ? {} : { createdBy: ctx.userId }
            );

            var clusters = await window.dataService.findDuplicateClusters(filters);
            if (clusters.length === 0) {
                await notify('No Duplicates Found', 'Nothing in the bank looks like a repeat of anything else.');
                return;
            }

            var ids = await window.DuplicateReview.openClusters(clusters);
            if (ids === null || ids.length === 0) return;

            var result = await window.dataService.deleteQuestionBankQuestions(ids);
            ids.forEach(function(id) { state.selectedIds.delete(id); });
            await refreshQuestions();
            updateDeleteSelectedVisibility();

            await notify(
                'Duplicates Removed',
                'Deleted ' + result.deleted + ' question' + (result.deleted === 1 ? '' : 's') + '.'
                    + (result.failed > 0 ? ' ' + result.failed + ' could not be removed.' : '')
            );
        } catch (err) {
            console.error('[QuestionBank] duplicate scan failed:', err);
            notify('Scan Failed', err.message || 'The duplicate scan could not be completed.');
        } finally {
            if (button) { button.disabled = false; button.innerHTML = original; }
        }
    }

    function applyFilters() {
        var f = state.filters;
        state.filteredQuestions = state.questions.filter(function(q) {
            if (f.subject && q.subject !== f.subject) return false;
            if (f.targetClass && q.targetClass !== f.targetClass) return false;
            if (f.difficulty && q.difficulty !== f.difficulty) return false;
            if (f.term && (q.term || '') !== f.term) return false;
            return true;
        });
        renderQuestions(state.filteredQuestions);
        // An empty bank makes Generate pointless, so the suggested next step
        // has to be re-checked whenever the list changes.
        renderBottomNav();
    }

    function populateFilterDropdowns(academic) {
        var filterSubject = document.getElementById('qb-filter-subject');
        var filterClass = document.getElementById('qb-filter-class');

        if (filterSubject && academic) {
            var allSubjects = [];
            Object.values(academic.subjectsByLevel || {}).forEach(function(list) {
                list.forEach(function(s) {
                    if (allSubjects.indexOf(s) === -1) allSubjects.push(s);
                });
            });
            allSubjects.sort();
            filterSubject.innerHTML = '<option value="">All</option>' + allSubjects.map(function(s) {
                return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
            }).join('');
        }

        if (filterClass && academic) {
            var allClasses = [];
            Object.values(academic.classesByLevel || {}).forEach(function(list) {
                list.forEach(function(c) { allClasses.push(c); });
            });
            filterClass.innerHTML = '<option value="">All</option>' + allClasses.map(function(c) {
                return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>';
            }).join('');
        }
    }

    function bindFilterControls() {
        var ids = {
            'qb-filter-subject': 'subject',
            'qb-filter-class': 'targetClass',
            'qb-filter-difficulty': 'difficulty',
            'qb-filter-term': 'term'
        };

        Object.keys(ids).forEach(function(elId) {
            var el = document.getElementById(elId);
            if (!el) return;
            var key = ids[elId];
            var eventName = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(eventName, function() {
                state.filters[key] = el.value;
                applyFilters();
            });
        });
    }

    function populateAcademicFields(academic) {
        var subjectSelect = document.getElementById('qb-subject');
        var classSelect = document.getElementById('qb-target-class');
        var levelSelect = document.getElementById('qb-school-level');

        if (levelSelect) {
            levelSelect.innerHTML = '<option value="secondary">Secondary</option><option value="primary">Primary</option>';
        }

        function updateDependentFields(level) {
            var subjects = academic.subjectsByLevel?.[level] || [];
            var classes = academic.classesByLevel?.[level] || [];

            if (subjectSelect) {
                subjectSelect.innerHTML = '<option value="">Select subject</option>' + subjects.map(function(subject) {
                    return '<option value="' + escapeHtml(subject) + '">' + escapeHtml(subject) + '</option>';
                }).join('');
            }

            if (classSelect) {
                classSelect.innerHTML = '<option value="All">All Classes</option>' + classes.map(function(item) {
                    return '<option value="' + escapeHtml(item.value) + '">' + escapeHtml(item.text) + '</option>';
                }).join('');
            }
        }

        if (levelSelect) {
            levelSelect.addEventListener('change', function() { updateDependentFields(levelSelect.value); });
            updateDependentFields(levelSelect.value || 'secondary');
        }
    }

    function parseTags(raw) {
        if (!raw) return [];
        return raw.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    }

    function isAdminRole(role) {
        return role === 'admin' || role === 'super_admin';
    }

    async function refreshQuestions() {
        var ctx = window.dataService.getSchoolContext() || {};
        state.isAdmin = isAdminRole(ctx.role);
        // Admin sees the whole school's bank (every teacher's questions);
        // a teacher sees only the questions they created.
        state.questions = await window.dataService.getQuestionBankQuestions(
            state.isAdmin ? {} : { createdBy: ctx.userId }
        );
        applyFilters();
    }

    function getSelectedQuestions() {
        var source = state.filteredQuestions.length ? state.filteredQuestions : state.questions;
        if (state.selectedIds.size === 0) {
            return source;
        }
        return source.filter(function(question) { return state.selectedIds.has(question.id); });
    }

    // Seeds a CBT draft from questions that are already in the bank. It only
    // reads — nothing here writes back to the bank.
    async function seedExam(questions, title) {
        var questionBankService = window.__moduleLoader?.getModuleService('question_bank');
        if (!questionBankService) {
            throw new Error('Question Bank service is unavailable.');
        }
        if (!questions.length) {
            throw new Error('There are no questions to seed. Save some questions first, or widen your filters.');
        }

        var defaultLevel = document.getElementById('qb-school-level')?.value || 'secondary';
        var defaultClass = document.getElementById('qb-target-class')?.value || 'All';
        var defaultSubject = document.getElementById('qb-subject')?.value || '';
        var defaultTerm = document.getElementById('qb-term')?.value || '';

        await questionBankService.seedExamFromQuestions({
            title: defaultTerm || title || '',
            subject: defaultSubject,
            schoolLevel: defaultLevel,
            targetClass: defaultClass,
            questions: questions
        });
    }

    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
    }

    function collectAllSubjects(academic) {
        var allSubjects = [];
        Object.values(academic?.subjectsByLevel || {}).forEach(function(list) {
            list.forEach(function(s) {
                if (allSubjects.indexOf(s) === -1) allSubjects.push(s);
            });
        });
        return allSubjects.sort();
    }

    function classOptionsHtml(academic) {
        var allClasses = [];
        Object.values(academic?.classesByLevel || {}).forEach(function(list) {
            list.forEach(function(c) { allClasses.push(c); });
        });
        return '<option value="All">All Classes</option>' + allClasses.map(function(c) {
            return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>';
        }).join('');
    }

    function populateGeneratorDropdowns(academic) {
        var genSubject = document.getElementById('qb-gen-subject');
        var genClass = document.getElementById('qb-gen-class');
        var genMultiClass = document.getElementById('qb-gen-multi-class');

        state.allSubjects = collectAllSubjects(academic);

        if (genSubject) {
            genSubject.innerHTML = '<option value="">Select subject</option>' + state.allSubjects.map(function(s) {
                return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
            }).join('');
        }

        if (genClass) genClass.innerHTML = classOptionsHtml(academic);
        if (genMultiClass) genMultiClass.innerHTML = classOptionsHtml(academic);

        renderSubjectQuotaList();
    }

    /* ================================================================
       MULTI-SUBJECT GENERATION
       Pick a total number of questions drawn at random across several
       subjects. A per-subject count is optional: subjects left blank
       share whatever is left of the total, evenly and at random.
       ================================================================ */
    function renderSubjectQuotaList() {
        var list = document.getElementById('qb-gen-subject-list');
        if (!list) return;

        if (!state.allSubjects.length) {
            list.innerHTML = '<p class="qb-gen-subject-empty">No subjects are configured for this school yet.</p>';
            return;
        }

        list.innerHTML = state.allSubjects.map(function(subject, i) {
            return '<div class="qb-gen-type-row qb-gen-subject-row">'
                + '<label class="qb-check-label">'
                + '<input type="checkbox" name="qb-gen-subject-pick" data-subject-index="' + i + '" value="' + escapeHtml(subject) + '"> '
                + '<span>' + escapeHtml(subject) + '</span>'
                + '</label>'
                + '<input type="number" class="qb-gen-subject-count" data-subject-index="' + i + '" min="0" max="200" '
                + 'placeholder="auto" aria-label="' + escapeHtml(subject) + ' question count" disabled />'
                + '</div>';
        }).join('');

        list.querySelectorAll('input[name="qb-gen-subject-pick"]').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var countInput = list.querySelector('input.qb-gen-subject-count[data-subject-index="' + cb.getAttribute('data-subject-index') + '"]');
                if (countInput) {
                    countInput.disabled = !cb.checked;
                    if (!cb.checked) countInput.value = '';
                }
                updateSubjectAllocation();
            });
        });

        list.querySelectorAll('input.qb-gen-subject-count').forEach(function(input) {
            input.addEventListener('input', function() {
                var cb = list.querySelector('input[name="qb-gen-subject-pick"][data-subject-index="' + input.getAttribute('data-subject-index') + '"]');
                var n = parseInt(input.value, 10);
                if (cb && !cb.checked && !isNaN(n) && n > 0) cb.checked = true;
                updateSubjectAllocation();
            });
        });

        updateSubjectAllocation();
    }

    // Reads the subject checkboxes into { name, count } pairs. count === null
    // means "let the app decide" (the input was left blank).
    function readSubjectPicks() {
        var picks = [];
        var list = document.getElementById('qb-gen-subject-list');
        if (!list) return picks;

        list.querySelectorAll('input[name="qb-gen-subject-pick"]:checked').forEach(function(cb) {
            var countInput = list.querySelector('input.qb-gen-subject-count[data-subject-index="' + cb.getAttribute('data-subject-index') + '"]');
            var raw = countInput ? countInput.value.trim() : '';
            var n = raw === '' ? NaN : parseInt(raw, 10);
            picks.push({
                name: cb.value,
                count: (!isNaN(n) && n > 0) ? n : null
            });
        });
        return picks;
    }

    function updateSubjectAllocation() {
        var totalInput = document.getElementById('qb-gen-multi-total');
        var allocatedEl = document.getElementById('qb-gen-subject-allocated');
        var totalEchoEl = document.getElementById('qb-gen-multi-total-echo');
        var remainderEl = document.getElementById('qb-gen-subject-remainder');
        var hintEl = document.getElementById('qb-gen-subject-hint');
        if (!allocatedEl || !remainderEl) return;

        var picks = readSubjectPicks();
        var explicit = picks.filter(function(p) { return p.count !== null; });
        var auto = picks.filter(function(p) { return p.count === null; });
        var allocated = explicit.reduce(function(sum, p) { return sum + p.count; }, 0);
        var total = parseInt(totalInput?.value, 10);
        if (isNaN(total) || total < 0) total = 0;

        // Every subject pinned to a count? Then the counts are the exam, and
        // the total simply follows them.
        var effectiveTotal = (auto.length || !picks.length) ? total : allocated;

        allocatedEl.textContent = String(allocated);
        if (totalEchoEl) totalEchoEl.textContent = String(effectiveTotal);

        var over = auto.length > 0 && allocated > total;
        if (hintEl) hintEl.classList.toggle('is-over', over);

        if (!picks.length) {
            remainderEl.textContent = 'pick at least one subject';
        } else if (over) {
            remainderEl.textContent = 'per-subject counts exceed the total';
        } else if (!auto.length) {
            remainderEl.textContent = 'total set by the per-subject counts';
        } else {
            var remaining = total - allocated;
            remainderEl.textContent = remaining + ' shared at random across '
                + auto.length + ' subject' + (auto.length !== 1 ? 's' : '');
        }
    }

    function setGenMode(mode) {
        state.genMode = mode === 'multi' ? 'multi' : 'single';
        var isMulti = state.genMode === 'multi';

        document.querySelectorAll('#qb-gen-mode .qb-mode-btn').forEach(function(btn) {
            var on = btn.getAttribute('data-gen-mode') === state.genMode;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });

        var single = document.getElementById('qb-gen-single-block');
        var multi = document.getElementById('qb-gen-multi-block');
        if (single) single.style.display = isMulti ? 'none' : '';
        if (multi) multi.style.display = isMulti ? 'grid' : 'none';

        // Across several subjects the counts come from the subject quotas, so
        // the type list drops to a plain include/exclude filter.
        var types = document.getElementById('qb-gen-types');
        if (types) types.classList.toggle('types-as-filter', isMulti);

        var typesLabel = document.getElementById('qb-gen-types-label');
        if (typesLabel) typesLabel.textContent = isMulti ? 'Question Types to Include' : 'Question Types & Quantities';

        var typesHint = document.getElementById('qb-gen-types-hint');
        if (typesHint) {
            typesHint.textContent = isMulti
                ? 'Only these types are eligible to be picked. Quantities come from the subject counts above.'
                : 'Tick a type and set how many of it you want. Eg: 4 MCQ + 2 Theory.';
        }

        var typeTotalHint = document.getElementById('qb-gen-type-total-hint');
        if (typeTotalHint) typeTotalHint.style.display = isMulti ? 'none' : '';

        if (isMulti) updateSubjectAllocation();
    }

    function bindGenModeControls() {
        document.querySelectorAll('#qb-gen-mode .qb-mode-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                setGenMode(btn.getAttribute('data-gen-mode'));
            });
        });

        var totalInput = document.getElementById('qb-gen-multi-total');
        if (totalInput) totalInput.addEventListener('input', updateSubjectAllocation);

        setGenMode('single');
    }

    // Subject a multi-subject paper is filed under. Must match an entry in
    // create-exam.html's subjectsByLevel or the builder cannot preselect it.
    var COMBINED_SUBJECT = 'General Knowledge';

    var TYPE_LABELS = {
        mcq: 'Multiple Choice',
        true_false: 'True / False',
        fill_blank: 'Fill in the Blank',
        theory: 'Theory',
        image_mcq: 'Image MCQ',
        image_multi: 'Picture Comprehension',
        match: 'Matching'
    };

    function updateGenTotal() {
        var total = 0;
        document.querySelectorAll('input[name="qb-gen-type"]').forEach(function(cb) {
            if (!cb.checked) return;
            var countInput = document.querySelector('input[data-gen-type-count="' + cb.value + '"]');
            var n = countInput ? parseInt(countInput.value, 10) : 0;
            if (!isNaN(n) && n > 0) total += n;
        });
        var totalEl = document.getElementById('qb-gen-total-count');
        var pluralEl = document.getElementById('qb-gen-total-plural');
        if (totalEl) totalEl.textContent = String(total);
        if (pluralEl) pluralEl.textContent = total === 1 ? '' : 's';
    }

    function bindGenTypeQuotaControls() {
        document.querySelectorAll('input[name="qb-gen-type"]').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var countInput = document.querySelector('input[data-gen-type-count="' + cb.value + '"]');
                if (!countInput) return;
                if (cb.checked) {
                    countInput.disabled = false;
                    var current = parseInt(countInput.value, 10);
                    if (isNaN(current) || current < 1) {
                        countInput.value = '5';
                    }
                    countInput.focus();
                    countInput.select();
                } else {
                    countInput.disabled = true;
                    countInput.value = '0';
                }
                updateGenTotal();
            });
        });

        document.querySelectorAll('input.qb-gen-type-count').forEach(function(input) {
            input.addEventListener('input', function() {
                var type = input.getAttribute('data-gen-type-count');
                var cb = document.querySelector('input[name="qb-gen-type"][value="' + type + '"]');
                var n = parseInt(input.value, 10);
                if (cb) {
                    if (!isNaN(n) && n > 0 && !cb.checked) {
                        cb.checked = true;
                        input.disabled = false;
                    } else if ((isNaN(n) || n <= 0) && cb.checked) {
                        cb.checked = false;
                        input.disabled = true;
                    }
                }
                updateGenTotal();
            });
        });

        updateGenTotal();
    }

    function getSelectedTerms() {
        var selectedTerms = [];
        document.querySelectorAll('input[name="qb-gen-term"]:checked').forEach(function(cb) {
            selectedTerms.push(cb.value);
        });
        return selectedTerms;
    }

    function getGenCriteria() {
        var selectedTerms = getSelectedTerms();

        if (state.genMode === 'multi') {
            var subjects = readSubjectPicks();
            var allowedTypes = [];
            document.querySelectorAll('input[name="qb-gen-type"]:checked').forEach(function(cb) {
                allowedTypes.push(cb.value);
            });

            var allocated = subjects.reduce(function(sum, s) { return sum + (s.count || 0); }, 0);
            var autoCount = subjects.filter(function(s) { return s.count === null; }).length;
            var typedTotal = parseInt(document.getElementById('qb-gen-multi-total')?.value, 10);
            if (isNaN(typedTotal) || typedTotal < 0) typedTotal = 0;

            return {
                mode: 'multi',
                subjects: subjects,
                allocated: allocated,
                autoCount: autoCount,
                targetClass: document.getElementById('qb-gen-multi-class')?.value || 'All',
                selectedTerms: selectedTerms,
                allowedTypes: allowedTypes,
                // With every subject pinned to a count, those counts are the exam.
                count: autoCount ? typedTotal : allocated
            };
        }

        var typeQuotas = [];
        document.querySelectorAll('input[name="qb-gen-type"]:checked').forEach(function(cb) {
            var type = cb.value;
            var countInput = document.querySelector('input[data-gen-type-count="' + type + '"]');
            var count = countInput ? parseInt(countInput.value, 10) : 0;
            if (isNaN(count) || count < 1) return;
            typeQuotas.push({ type: type, count: count });
        });

        return {
            mode: 'single',
            subject: document.getElementById('qb-gen-subject')?.value || '',
            targetClass: document.getElementById('qb-gen-class')?.value || 'All',
            selectedTerms: selectedTerms,
            typeQuotas: typeQuotas,
            count: typeQuotas.reduce(function(sum, q) { return sum + q.count; }, 0)
        };
    }

    // Returns null when the criteria can be run, otherwise the reason why not.
    // Reporting is left to the caller so this stays pure.
    function criteriaProblem(c) {
        if (c.selectedTerms.length === 0) return 'Please select at least one term.';

        if (c.mode === 'multi') {
            if (c.subjects.length === 0) return 'Tick at least one subject to draw questions from.';
            if (c.allowedTypes.length === 0) return 'Tick at least one question type to include.';
            if (c.autoCount > 0 && c.allocated > c.count) {
                return 'Your per-subject counts (' + c.allocated + ') add up to more than the total (' + c.count + ').';
            }
            if (c.count < 1 || c.count > 200) return 'Total questions must be between 1 and 200.';
            return null;
        }

        if (!c.subject) return 'Please select a subject.';
        if (c.typeQuotas.length === 0) return 'Tick at least one question type and set how many of it you want.';
        if (c.count < 1 || c.count > 200) return 'Total questions must be between 1 and 200.';
        return null;
    }

    async function loadBankForGeneration() {
        var ctx = window.dataService.getSchoolContext() || {};
        // Admin generates from the whole school bank; teacher from their own.
        return window.dataService.getQuestionBankQuestions(
            isAdminRole(ctx.role) ? {} : { createdBy: ctx.userId }
        );
    }

    function matchesClassAndTerm(q, criteria) {
        if (criteria.targetClass !== 'All' && q.targetClass !== 'All' && q.targetClass !== criteria.targetClass) {
            return false;
        }
        var qTerm = (q.term || '').trim();
        if (!qTerm) return true;
        return criteria.selectedTerms.some(function(t) { return qTerm.toLowerCase() === t.toLowerCase(); });
    }

    async function pickQuestionsSingle(criteria) {
        var allQuestions = await loadBankForGeneration();

        var base = allQuestions.filter(function(q) {
            return q.subject === criteria.subject && matchesClassAndTerm(q, criteria);
        });

        var picked = [];
        var perType = criteria.typeQuotas.map(function(quota) {
            var typePool = base.filter(function(q) { return (q.type || 'mcq') === quota.type; });
            var chosen = shuffle(typePool).slice(0, quota.count);
            picked = picked.concat(chosen);
            return {
                type: quota.type,
                requested: quota.count,
                available: typePool.length,
                picked: chosen.length
            };
        });

        return { pool: base, picked: picked, perType: perType };
    }

    async function pickQuestionsMulti(criteria) {
        var allQuestions = await loadBankForGeneration();
        var wanted = {};
        criteria.subjects.forEach(function(s) { wanted[s.name] = true; });

        var base = allQuestions.filter(function(q) {
            return wanted[q.subject]
                && criteria.allowedTypes.indexOf(q.type || 'mcq') !== -1
                && matchesClassAndTerm(q, criteria);
        });

        // Shuffle each subject's pool once; drawing is then just taking from
        // the front of it.
        var pools = {};
        criteria.subjects.forEach(function(s) {
            pools[s.name] = shuffle(base.filter(function(q) { return q.subject === s.name; }));
        });

        var drawn = {};
        criteria.subjects.forEach(function(s) { drawn[s.name] = []; });

        // 1. Honour the subjects the user pinned to an explicit count.
        criteria.subjects.forEach(function(s) {
            if (s.count === null) return;
            drawn[s.name] = pools[s.name].splice(0, s.count);
        });

        // 2. Share what is left of the total across the subjects left on auto,
        //    one question at a time so an under-stocked subject spills its
        //    shortfall over to the others instead of leaving the exam short.
        var autoSubjects = criteria.subjects.filter(function(s) { return s.count === null; });
        var remaining = criteria.count - criteria.subjects.reduce(function(sum, s) {
            return sum + (s.count === null ? 0 : drawn[s.name].length);
        }, 0);

        while (remaining > 0) {
            var tookOne = false;
            for (var i = 0; i < autoSubjects.length && remaining > 0; i++) {
                var pool = pools[autoSubjects[i].name];
                if (!pool.length) continue;
                drawn[autoSubjects[i].name].push(pool.shift());
                remaining--;
                tookOne = true;
            }
            if (!tookOne) break;   // every auto pool is exhausted
        }

        // Keep the paper grouped by subject, in the order they were ticked.
        var picked = [];
        var perSubject = criteria.subjects.map(function(s) {
            picked = picked.concat(drawn[s.name]);
            return {
                subject: s.name,
                requested: s.count,           // null = auto-shared
                available: drawn[s.name].length + pools[s.name].length,
                picked: drawn[s.name].length
            };
        });

        return { pool: base, picked: picked, perSubject: perSubject };
    }

    function pickQuestions(criteria) {
        return criteria.mode === 'multi' ? pickQuestionsMulti(criteria) : pickQuestionsSingle(criteria);
    }

    // The summary is mirrored onto every status box — the criteria form keeps
    // one for runs that find nothing, the Preview view has its own.
    function writeGenStatus(html) {
        document.querySelectorAll('.qb-gen-status').forEach(function(el) {
            el.style.display = '';
            el.innerHTML = html;
        });
    }

    function showGenStatus(result, criteria) {
        var pickedTotal = result.picked.length;
        var poolTotal = result.pool.length;
        var requestedTotal = criteria.count;

        if (poolTotal === 0) {
            writeGenStatus('<strong style="color:var(--accent-color);">No matching questions found.</strong> Try broadening your criteria or add more questions to the bank first.');
            return;
        }

        var rows, shortfallNote;
        if (criteria.mode === 'multi') {
            rows = result.perSubject.map(function(s) {
                var auto = s.requested === null;
                var short = auto ? false : s.picked < s.requested;
                var color = short ? 'var(--warning-color)' : 'var(--text-color)';
                return '<li style="color:' + color + ';">' +
                            '<strong>' + s.picked + '</strong>' +
                            (auto ? '' : ' / ' + s.requested) + ' ' + escapeHtml(s.subject) +
                            (auto ? ' <span style="font-size:0.82rem;">(shared)</span>' : '') +
                            (short ? ' <span style="font-size:0.82rem;">(only ' + s.available + ' available)</span>' : '') +
                        '</li>';
            }).join('');
            shortfallNote = 'Some subjects are short on questions — add more to the bank or lower the total.';
        } else {
            rows = result.perType.map(function(t) {
                var label = TYPE_LABELS[t.type] || t.type;
                var short = t.picked < t.requested;
                var color = short ? 'var(--warning-color)' : 'var(--text-color)';
                return '<li style="color:' + color + ';">' +
                            '<strong>' + t.picked + '</strong> / ' + t.requested + ' ' + escapeHtml(label) +
                            (short ? ' <span style="font-size:0.82rem;">(only ' + t.available + ' available)</span>' : '') +
                        '</li>';
            }).join('');
            shortfallNote = 'Some types are short — add more questions or lower their quotas.';
        }

        var msg = '<strong>' + pickedTotal + ' of ' + requestedTotal + ' question' + (requestedTotal !== 1 ? 's' : '') + '</strong> picked:' +
                  '<ul style="margin:6px 0 0; padding-left:20px; list-style:disc;">' + rows + '</ul>';

        if (pickedTotal < requestedTotal) {
            msg += '<div style="margin-top:6px; color:var(--warning-color); font-size:0.85rem;">' + shortfallNote + '</div>';
        }

        if (criteria.mode === 'multi') {
            msg += '<div style="margin-top:6px; font-size:0.85rem; color:var(--light-text);">'
                 + 'Spanning several subjects, this paper will be filed under '
                 + escapeHtml(COMBINED_SUBJECT) + '.'
                 + '</div>';
        }

        writeGenStatus(msg);
    }

    function renderPreviewList(questions) {
        var list = document.getElementById('qb-gen-preview-list');
        var countEl = document.getElementById('qb-gen-preview-count');
        if (!list) return;

        if (countEl) countEl.textContent = questions.length + ' question' + (questions.length !== 1 ? 's' : '');

        list.innerHTML = questions.map(function(q, i) {
            var typeLine = [(q.type || 'mcq').toUpperCase(), q.subject || '', q.term || '', q.difficulty || ''].filter(Boolean).join(' | ');
            return '<article class="qb-question-card">' +
                '<div class="qb-question-index">' + (i + 1) + '</div>' +
                '<div style="flex:1; min-width:0;">' +
                    '<div class="qb-question-type">' + escapeHtml(typeLine) + '</div>' +
                    '<p class="qb-question-text">' + escapeHtml(q.text) + '</p>' +
                    '<div class="qb-meta-row">' + renderBadges(q) + '</div>' +
                '</div>' +
            '</article>';
        }).join('');
    }

    async function previewExam() {
        var criteria = getGenCriteria();
        var problem = criteriaProblem(criteria);
        if (problem) { await notify('Check Your Criteria', problem); return; }

        var result = await pickQuestions(criteria);
        showGenStatus(result, criteria);

        if (result.picked.length > 0) {
            state.lastGeneratedPick = result.picked;
            state.lastGeneratedCriteria = criteria;
            renderPreviewList(result.picked);
            // The picked questions get a page of their own; a run that found
            // nothing stays put so the reason sits next to the criteria.
            if (typeof window.switchQbView === 'function') window.switchQbView('preview');
        }
    }

    async function generateExam() {
        var criteria = getGenCriteria();
        var problem = criteriaProblem(criteria);
        if (problem) { await notify('Check Your Criteria', problem); return; }

        var result = await pickQuestions(criteria);
        showGenStatus(result, criteria);

        if (result.picked.length === 0) return;

        state.lastGeneratedPick = result.picked;
        state.lastGeneratedCriteria = criteria;
        renderPreviewList(result.picked);

        // Seed the exam via the QB service
        var questionBankService = window.__moduleLoader?.getModuleService('question_bank');
        if (!questionBankService) {
            await notify('Unable to Create Exam', 'The Question Bank service is unavailable.');
            return;
        }

        var termLabel = criteria.selectedTerms.map(function(t) {
            return t.charAt(0).toUpperCase() + t.slice(1);
        }).join(' & ');

        var genSchoolLevel = document.getElementById('qb-school-level')?.value || 'secondary';
        var isMulti = criteria.mode === 'multi';

        // A combined paper spans several subjects, so it is filed under the
        // catch-all subject the exam builder keeps for exactly this case.
        await questionBankService.seedExamFromQuestions({
            title: [termLabel, isMulti ? 'Combined Paper' : ''].filter(Boolean).join(' ') || 'Auto-Generated',
            subject: isMulti ? COMBINED_SUBJECT : criteria.subject,
            schoolLevel: genSchoolLevel,
            targetClass: criteria.targetClass,
            questions: result.picked
        });
    }

    async function init() {
        var user = window.dataService?.getCurrentUser?.();
        if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
            window.location.href = '../index.html';
            return;
        }

        var nameEl = document.getElementById('user-name');
        var avatarEl = document.getElementById('sidebar-avatar');
        var roleEl = document.querySelector('.sidebar-profile-role');
        if (nameEl) nameEl.textContent = user.name || user.full_name || 'Teacher';
        if (avatarEl) avatarEl.textContent = (user.name || user.full_name || 'T').charAt(0).toUpperCase();
        if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Admin' : 'Teacher';

        var academic = await window.dataService.getAcademicEntities({ includeAllClasses: true });
        state.academic = academic;

        populateAcademicFields(academic);
        populateFilterDropdowns(academic);
        populateGeneratorDropdowns(academic);
        bindGenTypeQuotaControls();
        bindGenModeControls();
        bindFilterControls();
        renderBottomNav();

        // Default the term filter to the current school term (Utils.getCurrentTerm).
        var termFilter = document.getElementById('qb-filter-term');
        if (termFilter && window.Utils && typeof Utils.applyDefaultTerm === 'function') {
            Utils.applyDefaultTerm(termFilter);
            state.filters.term = termFilter.value || '';
            // Remember the auto-selected term so it doesn't count as a filter
            // the user actively applied (used for the empty-state message).
            state.defaultTerm = termFilter.value || '';
        }

        await refreshQuestions();

        var deleteSelectedBtn = document.getElementById('qb-delete-selected-btn');
        if (deleteSelectedBtn) {
            deleteSelectedBtn.onclick = async function() {
                await deleteSelectedQuestions();
            };
        }

        var findDuplicatesBtn = document.getElementById('qb-find-duplicates-btn');
        if (findDuplicatesBtn) {
            findDuplicatesBtn.onclick = findDuplicates;
        }

        var seedButton = document.getElementById('seed-exam-btn');
        if (seedButton) {
            seedButton.onclick = async function() {
                try {
                    var selected = getSelectedQuestions();
                    await seedExam(selected, 'Question Bank Starter Draft');
                } catch (error) {
                    console.error('[QuestionBank] seed exam failed:', error);
                    notify('Unable to Seed Exam', error.message || 'The exam draft could not be created.');
                }
            };
        }

        // Auto-Generate Exam — Preview button
        var previewBtn = document.getElementById('qb-gen-preview-btn');
        if (previewBtn) {
            previewBtn.onclick = async function() {
                previewBtn.disabled = true;
                previewBtn.textContent = 'Loading...';
                renderBottomNav();
                try {
                    await previewExam();
                } catch (error) {
                    console.error('[QuestionBank] preview failed:', error);
                    notify('Preview Failed', error.message || 'The questions could not be previewed.');
                } finally {
                    previewBtn.disabled = false;
                    previewBtn.textContent = 'Preview Questions';
                    renderBottomNav();
                }
            };
        }

        // Creating the exam is reachable from the criteria form and from the
        // Preview view, so both drive the same run.
        var CREATE_BUTTONS = [
            { id: 'qb-gen-btn', label: 'Generate & Create Exam' },
            { id: 'qb-preview-create-btn', label: 'Create Exam' }
        ];

        async function runGenerate() {
            var btns = CREATE_BUTTONS
                .map(function(b) { return { el: document.getElementById(b.id), label: b.label }; })
                .filter(function(b) { return b.el; });

            btns.forEach(function(b) { b.el.disabled = true; b.el.textContent = 'Generating...'; });
            renderBottomNav();
            try {
                await generateExam();
            } catch (error) {
                console.error('[QuestionBank] generate exam failed:', error);
                notify('Unable to Create Exam', error.message || 'The exam could not be created.');
            } finally {
                btns.forEach(function(b) { b.el.disabled = false; b.el.textContent = b.label; });
                renderBottomNav();
            }
        }

        var genForm = document.getElementById('qb-generate-form');
        if (genForm) {
            genForm.addEventListener('submit', function(event) {
                event.preventDefault();
                runGenerate();
            });
        }

        var previewCreateBtn = document.getElementById('qb-preview-create-btn');
        if (previewCreateBtn) previewCreateBtn.onclick = runGenerate;

        var previewBackBtn = document.getElementById('qb-preview-back-btn');
        if (previewBackBtn) previewBackBtn.onclick = function() { window.qbGoBack(); };

        var form = document.getElementById('question-bank-form');
        if (form) {
            form.addEventListener('submit', async function(event) {
                event.preventDefault();
                var submitButton = document.getElementById('save-question-btn');
                if (submitButton) submitButton.disabled = true;
                renderBottomNav();

                try {
                    var question = {
                        text: document.getElementById('qb-question-text')?.value || '',
                        type: 'mcq',
                        subject: document.getElementById('qb-subject')?.value || '',
                        schoolLevel: document.getElementById('qb-school-level')?.value || '',
                        targetClass: document.getElementById('qb-target-class')?.value || 'All',
                        term: document.getElementById('qb-term')?.value || '',
                        difficulty: document.getElementById('qb-difficulty')?.value || 'medium',
                        points: Number(document.getElementById('qb-points')?.value || 1),
                        options: ['A', 'B', 'C', 'D'].map(function(label) {
                            return {
                                id: label.toLowerCase(),
                                text: document.getElementById('qb-option-' + label.toLowerCase())?.value || ''
                            };
                        }),
                        answer: (document.getElementById('qb-correct-answer')?.value || '').toLowerCase(),
                        explanation: document.getElementById('qb-explanation')?.value || '',
                        tags: parseTags(document.getElementById('qb-tags')?.value)
                    };

                    // Look for questions already in the bank that say the same
                    // thing, scoped to this subject+term. The teacher decides;
                    // nothing is silently dropped.
                    var decision = await reviewBeforeSave(question);
                    if (decision === null) return;   // cancelled — leave the form filled in
                    if (decision.action === 'skip') {
                        await notify('Nothing Added', 'The question already in the bank was kept.');
                        return;
                    }

                    var overriding = decision.action === 'add' || decision.action === 'replace';
                    var saved = await window.dataService.createQuestionBankQuestion(
                        question,
                        overriding ? { skipDuplicateCheck: true } : undefined
                    );

                    // Save first, then remove the old one, so a failed save
                    // never leaves the teacher with neither copy.
                    if (decision.action === 'replace' && decision.replaceId) {
                        await window.dataService.deleteQuestionBankQuestion(decision.replaceId);
                    }
                    if (saved && saved.wasDuplicate) {
                        await notify(
                            'Already in the Bank',
                            'That exact question is already saved, so nothing was added.'
                        );
                    }
                    form.reset();
                    populateAcademicFields(state.academic);
                    await refreshQuestions();
                    // Switch to Saved Questions view so the user sees the new
                    // question. The add step is done, so it is not somewhere
                    // Back should return to.
                    var savedNav = document.querySelector('[data-qb-nav="saved"]');
                    if (typeof window.switchQbView === 'function') {
                        window.switchQbView('saved', savedNav, { replace: true });
                    }
                } catch (error) {
                    console.error('[QuestionBank] save failed:', error);
                    notify('Unable to Save Question', error.message || 'The question could not be saved.');
                } finally {
                    if (submitButton) submitButton.disabled = false;
                    renderBottomNav();
                }
            });
        }
    }

    window.questionBank = {
        init: init
    };
})();
