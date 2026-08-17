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
        editingCardId: null,
        isAdmin: false,
        // Review list only shows its checkboxes once you ask for them.
        selectMode: false,
        // Card design view
        templateLoaded: false,
        templateLogo: '',
        // How many history entries in the stack are ours (views + open modal).
        navDepth: 0
    };

    var VIEW_LABELS = {
        generate: 'Generate Report Cards',
        review: 'Review & Publish',
        view: 'Published Report Cards',
        template: 'Report Card Design',
        'access-codes': 'Class Access Codes'
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Utils.showAlert / showConfirm are the app's own dialogs — a bottom sheet
    // on mobile — so these fall back to the native ones only if utils.js
    // somehow failed to load. Messages may contain safe inline markup.
    function notify(title, message) {
        if (window.Utils && typeof Utils.showAlert === 'function') {
            return Utils.showAlert(title, message);
        }
        window.alert(String(message).replace(/<[^>]*>/g, ''));
        return Promise.resolve();
    }

    function askConfirm(title, message) {
        if (window.Utils && typeof Utils.showConfirm === 'function') {
            return Utils.showConfirm(title, message);
        }
        return Promise.resolve(window.confirm(String(message).replace(/<[^>]*>/g, '')));
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
        hideSelectAllPopup(); // never outlives the list it was raised from
        state.currentView = view;
        document.querySelectorAll('.rc-view').forEach(function(el) {
            el.classList.toggle('active', el.id === 'rc-view-' + view);
        });
        document.querySelectorAll('[data-rc-nav]').forEach(function(el) {
            el.classList.toggle('active', el.getAttribute('data-rc-nav') === view);
        });
        // The mobile topbar carries the view name (the hero is hidden there).
        var title = document.getElementById('rc-topbar-title');
        if (title) title.textContent = VIEW_LABELS[view] || 'Report Cards';
        renderBottomNav();
    }

    // ================================================================
    // MOBILE BOTTOM NAV — contextual
    // The slot for the view you are already on is replaced by that view's
    // own actions, so the bar never links to the page you are looking at.
    // ================================================================

    var NAV_ICONS = {
        back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
        generate: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>',
        review: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
        published: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>',
        codes: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
        design: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>',
        save: '<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
        trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>'
    };

    var NAV_SLOTS = [
        { view: 'generate', label: 'Generate', icon: NAV_ICONS.generate },
        { view: 'review', label: 'Review', icon: NAV_ICONS.review },
        { view: 'view', label: 'Published', icon: NAV_ICONS.published },
        { view: 'template', label: 'Design', icon: NAV_ICONS.design, adminOnly: true },
        { view: 'access-codes', label: 'Codes', icon: NAV_ICONS.codes, adminOnly: true }
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

    // Actions that take over the current view's nav slot. With no actions the
    // slot simply drops.
    function viewActions(view) {
        if (view === 'generate') {
            return [proxyAction('rc-generate-btn', 'Generate', NAV_ICONS.generate)];
        }
        if (view === 'review' && state.selectedCardIds.size > 0) {
            var n = state.selectedCardIds.size;
            return [
                proxyAction('rc-publish-selected-btn', 'Publish (' + n + ')', NAV_ICONS.published),
                proxyAction('rc-delete-selected-btn', 'Delete (' + n + ')', NAV_ICONS.trash, { danger: true })
            ];
        }
        if (view === 'template') {
            return [proxyAction('rc-tpl-save', 'Save', NAV_ICONS.save)];
        }
        return [];
    }

    // Slots dropped entirely for the current view.
    function hiddenSlots(view) {
        // Design and Codes are settings you visit once, not steps in the
        // termly workflow, so they stay in the sidebar rather than spending a
        // slot on every screen. The bar carries one only while you are on it,
        // where the slot becomes that screen's own action.
        var dropped = ['template', 'access-codes'].filter(function(slot) {
            return slot !== view;
        });

        if (view === 'review') {
            // By the time you are reviewing, the cards have already been
            // generated — Generate has nothing left to offer here.
            dropped.push('generate');
            // A live selection turns the bar into Publish/Delete, so the
            // remaining destination steps aside rather than compete with them.
            if (state.selectedCardIds.size > 0) dropped.push('view');
        }

        return dropped;
    }

    // The one highlighted item is where you are most likely headed NEXT.
    function nextStepKey(view) {
        if (view === 'generate') return 'action:rc-generate-btn';
        if (view === 'review') {
            // Ticking cards makes publishing the obvious next move; with
            // nothing ticked, seeing what is already out is the next stop.
            return state.selectedCardIds.size > 0 ? 'action:rc-publish-selected-btn' : 'view:view';
        }
        if (view === 'view') return 'view:review';
        if (view === 'template') return 'action:rc-tpl-save';
        return 'view:generate';
    }

    function buildNavButton(item) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bottom-nav-item'
            + (item.suggested ? ' active nav-action-primary' : '')
            + (item.danger ? ' nav-action-danger' : '');
        if (item.view) btn.setAttribute('data-rc-nav-item', item.view);

        var source = item.sourceId ? document.getElementById(item.sourceId) : null;
        if (source && source.disabled) btn.disabled = true;

        btn.innerHTML = '<span class="nav-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            + 'stroke-width="2" width="22" height="22">' + item.icon + '</svg></span>'
            + '<span>' + escapeHtml(item.label) + '</span>';
        btn.addEventListener('click', item.onClick);
        return btn;
    }

    function renderBottomNav() {
        var nav = document.getElementById('rc-bottom-nav');
        if (!nav) return;

        var current = state.currentView;
        var items = [{
            key: 'back',
            label: 'Back',
            icon: NAV_ICONS.back,
            onClick: goBack
        }];

        var dropped = hiddenSlots(current);

        NAV_SLOTS.forEach(function(slot) {
            if (slot.adminOnly && !state.isAdmin) return;
            if (dropped.indexOf(slot.view) !== -1) return;

            if (slot.view === current) {
                // You are here — offer this view's actions, or nothing at all.
                items = items.concat(viewActions(current));
                return;
            }
            items.push({
                key: 'view:' + slot.view,
                view: slot.view,
                label: slot.label,
                icon: slot.icon,
                onClick: function() { navigateToView(slot.view); }
            });
        });

        // Exactly one item carries the highlight.
        var wanted = nextStepKey(current);
        var suggested = items.filter(function(it) { return it.key === wanted; })[0];
        if (suggested) suggested.suggested = true;

        nav.innerHTML = '';
        items.forEach(function(item) { nav.appendChild(buildNavButton(item)); });
    }

    // ================================================================
    // IN-MODULE HISTORY
    // The four views are pages in their own right, so Back has to walk them
    // in reverse before leaving the module — going straight out to the admin
    // dashboard from "Review & Publish" skips the page you actually came from.
    // Every view change gets a real history entry, which also makes Android's
    // hardware back button and the browser's own Back do the right thing for
    // free. navDepth counts how many entries on the stack are ours, so the
    // root view knows to hand Back back to whatever opened the module.
    // ================================================================

    // Captured before we push anything of our own: was there a page before us?
    var hadEntryHistory = window.history.length > 1;

    function pushNavState(view, isModal) {
        state.navDepth += 1;
        window.history.pushState({
            rcView: view,
            rcModal: !!isModal,
            rcDepth: state.navDepth
        }, '');
    }

    function loadViewData(view) {
        if (view === 'review') loadReviewCards();
        if (view === 'view') loadPublished();
        if (view === 'template' && state.isAdmin) loadTemplateView();
        if (view === 'access-codes' && state.isAdmin) renderAccessCodesTable(state.academic);
    }

    /**
     * Switch view, load its data, and record it in history. The sidebar links,
     * the bottom nav and the post-generate hand-off all go through here so the
     * three stay in step.
     * @param {string} view
     * @param {{load?: boolean}} [opts] load:false when the caller renders the
     *        view's data itself (generate already holds the fresh cards).
     */
    function navigateToView(view, opts) {
        opts = opts || {};
        var isSameView = view === state.currentView;
        switchView(view);
        if (opts.load !== false) loadViewData(view);
        // Re-clicking the view you are on must not stack a duplicate entry.
        if (!isSameView) pushNavState(view, false);
    }

    function goBack() {
        // Still inside the module — pop our own entry (a view, or the detail
        // modal) rather than leaving the page.
        if (state.navDepth > 0) {
            window.history.back();
            return;
        }
        // At the module's entry view: leave for whatever opened it. Checking
        // history.length here would be wrong — our own pushes inflate it and
        // it never shrinks as you go back.
        if (hadEntryHistory) {
            window.history.back();
            return;
        }
        window.location.href = (window.Utils && typeof Utils.getDashboardUrl === 'function')
            ? Utils.getDashboardUrl()
            : '../index.html';
    }

    // The topbar arrow and the bottom-nav Back item share this.
    window.rcGoBack = goBack;

    window.addEventListener('popstate', function(event) {
        var st = event.state || {};
        if (!st.rcView) return; // not one of ours — the browser is leaving

        state.navDepth = st.rcDepth || 0;

        // Anything popped that is not the modal state means the modals are gone.
        if (!st.rcModal) {
            closeCardDetailUI();
            closeSendCodeUI();
        }

        if (st.rcView !== state.currentView) {
            switchView(st.rcView);
            loadViewData(st.rcView);
        } else {
            renderBottomNav();
        }
    });

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

    /**
     * Generate + save, shared by the Generate form and the "Generate" link in
     * the review view's empty state.
     * @param {Object} params classLevel / term / session / dateRange
     * @param {{setStatus?: Function, setBusy?: Function}} [ui]
     * @returns {Promise<boolean>} true when cards were saved
     */
    async function runGeneration(params, ui) {
        ui = ui || {};
        var setStatus = ui.setStatus || function() {};
        var setBusy = ui.setBusy || function() {};

        setBusy(true);
        setStatus('Fetching results and attendance data...');

        try {
            var cards = await window.dataService.generateReportCardData(params);

            if (cards.length === 0) {
                setStatus('No students found in ' + params.classLevel + ', or no exam results match "' + params.term + '".');
                return false;
            }

            var saveResult = await window.dataService.saveReportCards(cards);
            state.reportCards = saveResult.results;
            setStatus('Generated ' + saveResult.saved + ' report card' + (saveResult.saved !== 1 ? 's' : '') +
                (saveResult.failed > 0 ? ' (' + saveResult.failed + ' failed)' : '') + '.');
            return true;
        } catch (err) {
            console.error('[ReportCards] generate failed:', err);
            setStatus('Error: ' + (err.message || 'Generation failed'));
            return false;
        } finally {
            setBusy(false);
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
            notify('Pick a class and term', 'Select both a class and a term before generating.');
            return;
        }

        var genBtn = document.getElementById('rc-generate-btn');
        var statusEl = document.getElementById('rc-gen-status');

        var saved = await runGeneration({
            classLevel: classLevel,
            term: term,
            session: session,
            dateRange: { start: startDate, end: endDate }
        }, {
            setStatus: function(text) { if (statusEl) statusEl.textContent = text; },
            setBusy: function(busy) {
                if (genBtn) {
                    genBtn.disabled = busy;
                    genBtn.textContent = busy ? 'Generating...' : 'Generate Report Cards';
                }
                renderBottomNav(); // mirrors the button's disabled state on mobile
            }
        });

        if (!saved) return;

        // Point the review filters at what was just generated, so the list you
        // land on and any later refresh agree with each other.
        syncReviewFilters(classLevel, term);

        // Auto-switch to review — recorded in history so Back returns to the
        // generate form. The freshly saved cards are rendered here, so there
        // is nothing to re-fetch.
        navigateToView('review', { load: false });
        renderReviewList(state.reportCards);
    }

    function syncReviewFilters(classLevel, term) {
        var classFilter = document.getElementById('rc-review-class-filter');
        var termFilter = document.getElementById('rc-review-term-filter');
        if (classFilter && !classFilter.disabled) classFilter.value = classLevel;
        if (termFilter) termFilter.value = term;
    }

    /**
     * The review view's empty state offers to generate for the filters that
     * came up empty, so you never have to retype them on the Generate tab.
     */
    async function generateFromReviewFilters() {
        var classLevel = document.getElementById('rc-review-class-filter')?.value || '';
        var term = document.getElementById('rc-review-term-filter')?.value || '';

        if (!classLevel || !term) {
            notify('Pick a class and term',
                'Choose a specific class <em>and</em> term in the filters above first — ' +
                '&ldquo;All Classes&rdquo; and &ldquo;All Terms&rdquo; are too broad to generate from.');
            return;
        }

        var list = document.getElementById('rc-review-list');
        var saved = await runGeneration({
            classLevel: classLevel,
            term: term,
            session: '',
            dateRange: {}
        }, {
            setStatus: function(text) {
                if (list) list.innerHTML = '<p class="rc-empty">' + escapeHtml(text) + '</p>';
            }
        });

        if (saved) await loadReviewCards();
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

        // Re-rendering pulls the row the popup was anchored to out from under it.
        hideSelectAllPopup();

        if (!cards || cards.length === 0) {
            // "Generate" is a live action, not a pointer at another tab — it
            // runs for the very filters that just came up empty.
            list.innerHTML = '<p class="rc-empty">No report cards found. ' +
                '<button type="button" class="rc-inline-link" id="rc-empty-generate">Generate</button>' +
                ' them for the selected class and term.</p>';
            var genLink = document.getElementById('rc-empty-generate');
            if (genLink) genLink.addEventListener('click', generateFromReviewFilters);
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

            // Checkbox + name + status share the top row with the actions,
            // which sit hard right; the meta lines then run the full width
            // underneath instead of being squeezed between the two.
            var cardIdStr = String(card.id);
            return '<article class="rc-card" data-card-id="' + escapeHtml(cardIdStr) + '">' +
                '<div class="rc-card-body">' +
                    '<div class="rc-card-top">' +
                        '<div class="rc-card-ident">' +
                            '<label class="rc-card-check"><input type="checkbox" data-select-card="' + escapeHtml(cardIdStr) + '" ' + (state.selectedCardIds.has(cardIdStr) ? 'checked' : '') + ' /></label>' +
                            '<div>' +
                                '<div class="rc-card-header">' +
                                    '<strong>' + escapeHtml(card.studentName) + '</strong>' +
                                    statusBadge +
                                '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="rc-card-actions">' +
                            '<button class="ghost-cta" data-view-card="' + escapeHtml(cardIdStr) + '" title="View / Edit">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                            '</button>' +
                            // Drafts get the full page too — a card is worth
                            // proof-reading at print size before it is published,
                            // not only after.
                            '<button class="ghost-cta" data-print-card="' + escapeHtml(cardIdStr) + '" title="Open the printable report card">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                            '</button>' +
                            '<button class="ghost-cta ghost-cta-danger" data-delete-card="' + escapeHtml(cardIdStr) + '" title="Delete">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="rc-card-meta">' + escapeHtml(card.classLevel) + ' | ' + escapeHtml(card.term) + (card.session ? ' | ' + escapeHtml(card.session) : '') + '</div>' +
                    '<div class="rc-card-meta">' + subjectSummary + ' | Position: ' + position + '</div>' +
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

        list.querySelectorAll('[data-print-card]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                openPrintablePage(btn.getAttribute('data-print-card'));
            });
        });

        list.querySelectorAll('[data-delete-card]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                deleteCard(btn.getAttribute('data-delete-card'));
            });
        });

        list.querySelectorAll('.rc-card').forEach(function(article) {
            bindSelectionGestures(article, article.getAttribute('data-card-id'));
        });

        updateBulkActions();
    }

    // ================================================================
    // SELECTION MODE (Review list)
    // Checkboxes stay out of the way until you ask for them: long-press on a
    // touch screen, double-click with a mouse. The pressed card is selected
    // straight away, and a small popup offers to extend that to the whole list.
    // Emptying the selection drops you back out again.
    // ================================================================

    var LONG_PRESS_MS = 500;
    var LONG_PRESS_DRIFT = 10; // px of finger movement before it counts as a scroll

    // Long-press and double-click both land on the row itself, never on the
    // controls sitting inside it.
    function isRowControl(target) {
        return !!(target && target.closest && target.closest('button, input, label, a, svg'));
    }

    function checkboxFor(cardId) {
        var list = document.getElementById('rc-review-list');
        if (!list) return null;
        var boxes = list.querySelectorAll('input[data-select-card]');
        for (var i = 0; i < boxes.length; i++) {
            if (boxes[i].getAttribute('data-select-card') === String(cardId)) return boxes[i];
        }
        return null;
    }

    function beginSelection(cardId, anchorEl) {
        state.selectMode = true;
        if (cardId) {
            state.selectedCardIds.add(String(cardId));
            var box = checkboxFor(cardId);
            if (box) box.checked = true;
        }
        updateBulkActions();
        showSelectAllPopup(anchorEl);
    }

    // Every card the filters are currently showing — nothing off-screen.
    function visibleCheckboxes() {
        var list = document.getElementById('rc-review-list');
        return list ? Array.prototype.slice.call(list.querySelectorAll('input[data-select-card]')) : [];
    }

    function allVisibleSelected() {
        var boxes = visibleCheckboxes();
        return boxes.length > 0 && boxes.every(function(box) {
            return state.selectedCardIds.has(box.getAttribute('data-select-card'));
        });
    }

    function setAllCards(selected) {
        visibleCheckboxes().forEach(function(box) {
            var id = box.getAttribute('data-select-card');
            box.checked = selected;
            if (selected) state.selectedCardIds.add(id);
            else state.selectedCardIds.delete(id);
        });
        hideSelectAllPopup();
        updateBulkActions();
    }

    function bindSelectionGestures(article, cardId) {
        var timer = null;
        var startX = 0;
        var startY = 0;
        var pressed = false;

        function cancel() {
            if (timer) { clearTimeout(timer); timer = null; }
        }

        // The gesture still works once selection mode is on — that is the only
        // way back to the Select All popup after dismissing it.
        article.addEventListener('touchstart', function(e) {
            if (isRowControl(e.target)) return;
            var touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
            pressed = true;
            cancel();
            timer = setTimeout(function() {
                timer = null;
                beginSelection(cardId, article);
            }, LONG_PRESS_MS);
        }, { passive: true });

        article.addEventListener('touchmove', function(e) {
            if (!timer) return;
            var touch = e.touches[0];
            if (Math.abs(touch.clientX - startX) > LONG_PRESS_DRIFT ||
                Math.abs(touch.clientY - startY) > LONG_PRESS_DRIFT) {
                cancel();
                pressed = false;
            }
        }, { passive: true });

        article.addEventListener('touchend', function() { cancel(); pressed = false; }, { passive: true });
        article.addEventListener('touchcancel', function() { cancel(); pressed = false; }, { passive: true });

        // Suppress the browser's own long-press menu while ours is coming.
        article.addEventListener('contextmenu', function(e) {
            if (pressed) e.preventDefault();
        });

        article.addEventListener('dblclick', function(e) {
            if (isRowControl(e.target)) return;
            beginSelection(cardId, article);
        });
    }

    // ---- "Select All" popup ----------------------------------------

    var selectPopupCleanup = null;

    function hideSelectAllPopup() {
        var pop = document.getElementById('rc-select-popup');
        if (pop) pop.remove();
        if (selectPopupCleanup) {
            selectPopupCleanup();
            selectPopupCleanup = null;
        }
    }

    function positionSelectPopup(pop, anchorEl) {
        var margin = 8;
        var rect = anchorEl
            ? anchorEl.getBoundingClientRect()
            : { top: window.innerHeight / 2, bottom: window.innerHeight / 2, left: 16, width: 0 };
        var w = pop.offsetWidth;
        var h = pop.offsetHeight;

        // Above the row by default; below it when there is no room up there.
        var top = rect.top - h - margin;
        if (top < margin) top = Math.min(rect.bottom + margin, window.innerHeight - h - margin);

        var left = rect.left + (rect.width / 2) - (w / 2);
        left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

        pop.style.top = Math.max(margin, top) + 'px';
        pop.style.left = left + 'px';
    }

    function showSelectAllPopup(anchorEl) {
        hideSelectAllPopup();

        // With everything already ticked, the only useful offer is the reverse.
        var everything = allVisibleSelected();
        var icon = everything
            ? '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/>'
            : '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>';

        var pop = document.createElement('div');
        pop.className = 'rc-select-popup';
        pop.id = 'rc-select-popup';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Selection');
        pop.innerHTML = '<button type="button" class="rc-select-popup-btn">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">' +
            icon + '</svg>' +
            (everything ? 'Un-select All' : 'Select All') + '</button>';
        document.body.appendChild(pop);
        positionSelectPopup(pop, anchorEl);

        pop.querySelector('.rc-select-popup-btn').addEventListener('click', function() {
            setAllCards(!everything);
        });

        // Anything that moves the page out from under the popup dismisses it.
        function onOutside(e) { if (!pop.contains(e.target)) hideSelectAllPopup(); }
        function onKey(e) { if (e.key === 'Escape') hideSelectAllPopup(); }
        var scroller = document.querySelector('.main-content');

        // Deferred so the pointerup ending the long-press doesn't close it.
        var arm = setTimeout(function() {
            document.addEventListener('pointerdown', onOutside, true);
        }, 0);
        document.addEventListener('keydown', onKey);
        if (scroller) scroller.addEventListener('scroll', hideSelectAllPopup, { passive: true });
        window.addEventListener('resize', hideSelectAllPopup);

        selectPopupCleanup = function() {
            clearTimeout(arm);
            document.removeEventListener('pointerdown', onOutside, true);
            document.removeEventListener('keydown', onKey);
            if (scroller) scroller.removeEventListener('scroll', hideSelectAllPopup);
            window.removeEventListener('resize', hideSelectAllPopup);
        };
    }

    function updateBulkActions() {
        var publishBtn = document.getElementById('rc-publish-selected-btn');
        var deleteBtn = document.getElementById('rc-delete-selected-btn');
        var count = state.selectedCardIds.size;

        // Clearing the last tick drops you back out of selection mode, the same
        // way the long-press got you into it.
        if (state.selectMode && count === 0) {
            state.selectMode = false;
            hideSelectAllPopup();
        }
        var list = document.getElementById('rc-review-list');
        if (list) list.classList.toggle('rc-selecting', state.selectMode);

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
        // On mobile the same two actions live in the bottom nav, which only
        // offers them while something is selected.
        renderBottomNav();
    }

    function hasRemarks(card) {
        return String(card && card.teacherRemarks || '').trim() !== '' ||
               String(card && card.principalRemarks || '').trim() !== '';
    }

    /**
     * Names of the selected cards that would go out with no remarks at all.
     * Publishing is one-way — there is no post-publish edit — so this is the
     * last chance to catch a card nobody wrote on.
     */
    function selectedMissingRemarks(ids) {
        return ids.map(function(id) {
            return state.reportCards.find(function(c) { return String(c.id) === String(id); });
        }).filter(function(card) {
            return card && !hasRemarks(card);
        }).map(function(card) {
            return card.studentName || 'Unnamed student';
        });
    }

    async function publishSelected() {
        var ids = Array.from(state.selectedCardIds);
        if (ids.length === 0) return;

        var blank = selectedMissingRemarks(ids);
        if (blank.length > 0) {
            var shown = blank.slice(0, 8).map(escapeHtml).join('<br>');
            var more = blank.length > 8 ? '<br>&hellip; and ' + (blank.length - 8) + ' more' : '';
            var proceed = await askConfirm(
                blank.length === 1 ? 'This card has no remarks' : blank.length + ' cards have no remarks',
                '<p>No teacher\'s or principal\'s remarks were written for:</p>' +
                '<p style="font-weight:700; line-height:1.6;">' + shown + more + '</p>' +
                '<p><strong>A report card cannot be edited once published.</strong> ' +
                'Go back and add remarks, or publish without them?</p>'
            );
            if (!proceed) return;
        }

        var proceedAll = await askConfirm(
            'Publish ' + ids.length + ' report card' + (ids.length !== 1 ? 's' : '') + '?',
            'Students will be able to view them, and they can no longer be edited.'
        );
        if (!proceedAll) return;

        try {
            var result = await window.dataService.publishReportCards(ids);
            state.selectedCardIds.clear();
            await loadReviewCards();
            notify('Published', 'Published ' + result.published + ' report card' + (result.published !== 1 ? 's' : '') +
                (result.failed > 0 ? '. ' + result.failed + ' failed.' : '.'));
        } catch (err) {
            console.error('[ReportCards] publish failed:', err);
            notify('Publish failed', escapeHtml(err.message || 'Unknown error'));
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

    // Paints the finished document into the detail modal. One renderer for the
    // review modal, the printable page and the student's view, so a card can
    // never be approved here in a layout nobody else ever sees.
    function renderDetailDocument(card) {
        var host = document.getElementById('rc-detail-doc');
        if (!host) return;

        if (!window.reportCardDocument) {
            host.innerHTML = '<p class="rc-doc-fallback">This report card could not be displayed.</p>';
            return;
        }
        host.innerHTML = window.reportCardDocument.render(
            card,
            window.dataService.getReportCardTemplateSync()
        );
    }

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

        // The card itself — marks, attendance and remarks all come off the
        // sheet, so there is nothing here to keep in step with the document.
        renderDetailDocument(card);

        // Remarks. A published card is finished — the sheet above already
        // carries the comments as written, so the editor and its Save button
        // both step aside rather than offering to rewrite them.
        var isPublished = card.status === 'published';

        var teacherRemarksEl = modal.querySelector('#rc-teacher-remarks');
        var principalRemarksEl = modal.querySelector('#rc-principal-remarks');
        if (teacherRemarksEl) teacherRemarksEl.value = card.teacherRemarks || '';
        if (principalRemarksEl) principalRemarksEl.value = card.principalRemarks || '';

        var editWrap = modal.querySelector('#rc-remarks-edit');
        if (editWrap) editWrap.style.display = isPublished ? 'none' : '';

        var saveBtn = modal.querySelector('#rc-save-remarks-btn');
        if (saveBtn) saveBtn.style.display = isPublished ? 'none' : '';

        // Status
        var statusEl = modal.querySelector('.rc-detail-status');
        if (statusEl) {
            statusEl.className = 'rc-badge rc-detail-status ' + (isPublished ? 'rc-badge-published' : 'rc-badge-draft');
            statusEl.textContent = isPublished ? 'Published' : 'Draft';
        }

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        // The sheet was painted while the overlay was still display:none, so it
        // measured zero and skipped its own scaling — now that it is on screen,
        // ask for the fit explicitly rather than waiting for a mutation that
        // is not coming.
        if (window.reportCardDocument) window.reportCardDocument.fitSheets(modal);
        // The modal is a page of its own as far as Back is concerned — without
        // its own entry, Back would step to the previous view and leave the
        // modal floating over the wrong one.
        pushNavState(state.currentView, true);
    }

    // Tears down the modal without touching history — used by the popstate
    // handler, which is already unwinding the stack.
    function closeCardDetailUI() {
        var modal = document.getElementById('rc-detail-modal');
        if (modal) modal.classList.remove('active');
        document.body.style.overflow = '';
        state.editingCardId = null;
    }

    // The finished document lives on its own page so it can print cleanly and
    // be linked to from anywhere (admin results, a student's dashboard).
    function openPrintablePage(cardId) {
        if (!cardId) return;
        window.location.href = 'report-card-print.html?id=' + encodeURIComponent(cardId);
    }

    function closeCardDetail() {
        // If the modal owns the top history entry, pop it so the stack stays
        // honest; popstate then does the actual teardown.
        var st = window.history.state;
        if (st && st.rcModal) {
            window.history.back();
            return;
        }
        closeCardDetailUI();
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
                // Repaint so the comments appear on the sheet above, where the
                // reviewer can check them in place before publishing.
                renderDetailDocument(card);
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
                    '<div class="rc-card-top">' +
                        '<div class="rc-card-ident">' +
                            '<div>' +
                                '<div class="rc-card-header"><strong>' + escapeHtml(card.studentName) + '</strong><span class="rc-badge rc-badge-published">Published</span></div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="rc-card-actions">' +
                            '<button class="ghost-cta" data-view-pub-card="' + escapeHtml(card.id) + '" title="View details">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
                            '</button>' +
                            '<button class="ghost-cta" data-print-card="' + escapeHtml(card.id) + '" title="Open the printable report card">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="rc-card-meta">' + escapeHtml(card.classLevel) + ' | ' + escapeHtml(card.term) + ' | Avg: ' + card.averageScore + '% | Position: ' + position + '</div>' +
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

        list.querySelectorAll('[data-print-card]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                openPrintablePage(btn.getAttribute('data-print-card'));
            });
        });
    }

    // ================================================================
    // CARD DESIGN (Admin only)
    // The letterhead and marking scheme printed on every card. Edits are
    // previewed with the very renderer the printed document uses, so there is
    // no second template to drift out of sync.
    // ================================================================

    var TPL_TEXT_FIELDS = [
        'schoolName', 'schoolTagline', 'address', 'phone', 'email', 'website',
        'documentTitle', 'accentColor', 'signatureLabel'
    ];
    var TPL_NUMBER_FIELDS = ['caMax', 'examMax'];
    var TPL_BOOL_FIELDS = ['showPosition', 'showAttendance', 'showRemarks'];

    // A logo goes into a JSON settings blob, so it has to stay small. 240px
    // is more than the letterhead ever renders at.
    var LOGO_MAX_PX = 240;

    function tplEl(field) {
        return document.getElementById('rc-tpl-' + field);
    }

    // ---- Grading scale rows ----------------------------------------
    // Only the lower bound is entered; the upper one is shown but derived
    // from the band above, so gaps and overlaps cannot be typed in.

    function readGradingScale() {
        var host = document.getElementById('rc-grade-rows');
        if (!host) return null;
        return Array.prototype.map.call(host.querySelectorAll('.rc-grade-row'), function(row) {
            return {
                min: parseFloat(row.querySelector('[data-grade-min]').value),
                letter: row.querySelector('[data-grade-letter]').value,
                label: row.querySelector('[data-grade-label]').value
            };
        });
    }

    function gradeRowHtml(band) {
        return '<div class="rc-grade-row">' +
            '<input type="number" min="0" max="100" step="1" data-grade-min value="' + escapeHtml(band.min) + '" aria-label="From percentage">' +
            '<span class="rc-grade-range" data-grade-range>&ndash;</span>' +
            '<input type="text" maxlength="4" data-grade-letter value="' + escapeHtml(band.letter) + '" aria-label="Grade" placeholder="A">' +
            '<input type="text" maxlength="24" data-grade-label value="' + escapeHtml(band.label) + '" aria-label="Remark" placeholder="Excellent">' +
            '<button type="button" class="ghost-cta ghost-cta-danger" data-grade-remove aria-label="Remove band" title="Remove band">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
            '</button>' +
        '</div>';
    }

    function renderGradingScale(bands) {
        var host = document.getElementById('rc-grade-rows');
        if (!host) return;
        host.innerHTML = bands.map(gradeRowHtml).join('');
        refreshGradeRanges();
    }

    /**
     * Repaint each row's derived range and the legend preview. Rows are NOT
     * re-sorted while typing — reordering the DOM under the cursor would
     * throw focus out mid-keystroke. Sorting happens on save and on reload.
     */
    function refreshGradeRanges() {
        var host = document.getElementById('rc-grade-rows');
        if (!host) return;
        var rows = Array.prototype.slice.call(host.querySelectorAll('.rc-grade-row'));

        // Ranges follow the sorted order, whatever order the rows sit in.
        var sorted = rows.slice().sort(function(a, b) {
            return (parseFloat(b.querySelector('[data-grade-min]').value) || 0) -
                   (parseFloat(a.querySelector('[data-grade-min]').value) || 0);
        });

        sorted.forEach(function(row, i) {
            var min = parseFloat(row.querySelector('[data-grade-min]').value);
            var above = i === 0 ? null : parseFloat(sorted[i - 1].querySelector('[data-grade-min]').value);
            var max = i === 0 ? 100 : Math.max(min, (above || 0) - 1);
            var out = row.querySelector('[data-grade-range]');
            if (out) out.textContent = isFinite(min) ? '– ' + max : '–';
            row.classList.toggle('rc-grade-row-lowest', i === sorted.length - 1);
        });

        var preview = document.getElementById('rc-grade-preview');
        if (preview && window.dataService.gradingLegendText) {
            preview.textContent = 'Prints as: ' +
                window.dataService.gradingLegendText(readTemplateForm());
        }
    }

    function bindGradingScale() {
        var host = document.getElementById('rc-grade-rows');
        if (!host) return;

        host.addEventListener('input', refreshGradeRanges);
        host.addEventListener('click', function(e) {
            var remove = e.target.closest && e.target.closest('[data-grade-remove]');
            if (!remove) return;
            var rows = host.querySelectorAll('.rc-grade-row');
            if (rows.length <= 1) {
                notify('At least one band', 'A grading scale needs one band to fall back on. Edit this one instead of removing it.');
                return;
            }
            remove.closest('.rc-grade-row').remove();
            refreshGradeRanges();
            renderTemplatePreview();
        });

        var add = document.getElementById('rc-grade-add');
        if (add) add.addEventListener('click', function() {
            host.insertAdjacentHTML('beforeend', gradeRowHtml({ min: '', letter: '', label: '' }));
            refreshGradeRanges();
            var last = host.querySelector('.rc-grade-row:last-child [data-grade-min]');
            if (last) last.focus();
        });
    }

    function readTemplateForm() {
        var tpl = { logo: state.templateLogo || '' };
        var scale = readGradingScale();
        if (scale) tpl.gradingScale = scale;
        TPL_TEXT_FIELDS.forEach(function(f) {
            var el = tplEl(f);
            tpl[f] = el ? String(el.value || '').trim() : '';
        });
        TPL_NUMBER_FIELDS.forEach(function(f) {
            var el = tplEl(f);
            var n = el ? parseFloat(el.value) : NaN;
            if (isFinite(n) && n > 0) tpl[f] = n;
        });
        TPL_BOOL_FIELDS.forEach(function(f) {
            var el = tplEl(f);
            if (el) tpl[f] = !!el.checked;
        });
        return tpl;
    }

    function fillTemplateForm(tpl) {
        TPL_TEXT_FIELDS.concat(TPL_NUMBER_FIELDS).forEach(function(f) {
            var el = tplEl(f);
            if (el) el.value = tpl[f] === null || tpl[f] === undefined ? '' : tpl[f];
        });
        TPL_BOOL_FIELDS.forEach(function(f) {
            var el = tplEl(f);
            if (el) el.checked = tpl[f] !== false;
        });
        state.templateLogo = tpl.logo || '';
        renderLogoPreview();
        renderGradingScale(window.dataService.gradingScaleRows
            ? window.dataService.gradingScaleRows(tpl)
            : (tpl.gradingScale || []));
    }

    function renderLogoPreview() {
        var box = document.getElementById('rc-tpl-logo-preview');
        var clear = document.getElementById('rc-tpl-logo-clear');
        if (clear) clear.style.display = state.templateLogo ? 'inline-flex' : 'none';
        if (!box) return;
        box.innerHTML = state.templateLogo
            ? '<img src="' + escapeHtml(state.templateLogo) + '" alt="School logo">'
            : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
    }

    /**
     * Downscale to LOGO_MAX_PX and re-encode before it ever reaches the
     * settings record — an untouched phone photo would be megabytes of base64
     * on every page that renders a card.
     */
    function readLogoFile(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function() { reject(new Error('Could not read that file.')); };
            reader.onload = function() {
                var img = new Image();
                img.onerror = function() { reject(new Error('That file is not an image we can read.')); };
                img.onload = function() {
                    var scale = Math.min(1, LOGO_MAX_PX / Math.max(img.width, img.height));
                    var w = Math.max(1, Math.round(img.width * scale));
                    var h = Math.max(1, Math.round(img.height * scale));
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                    // PNG keeps logo transparency; JPEG would paint it black.
                    resolve(canvas.toDataURL('image/png'));
                };
                img.src = reader.result;
            };
            reader.readAsDataURL(file);
        });
    }

    // A stand-in card so the preview shows a full document before any real
    // card exists — the design view has to be usable on day one.
    function sampleCard() {
        function subject(name, ca, exam, grade) {
            return { name: name, caScore: ca, examScore: exam, score: ca + exam, grade: grade };
        }
        return {
            studentName: 'Adaeze Okonkwo',
            classLevel: 'JSS One',
            term: '2nd Term',
            session: '2025/2026',
            classPosition: 3,
            classSize: 41,
            averageScore: 79,
            subjects: [
                subject('Mathematics', 35, 40, 'B+'),
                subject('English Language', 33, 51, 'A'),
                subject('Basic Science', 36, 53, 'A'),
                subject('Social Studies', 34, 52, 'A'),
                subject('Civic Education', 39, 41, 'A')
            ],
            attendance: { present: 58, absent: 2, late: 1, totalDays: 60, attendanceRate: 97 },
            teacherRemarks: 'She is brilliant and participates well in class.',
            principalRemarks: 'A very good performance, do not relent.',
            status: 'published'
        };
    }

    function renderTemplatePreview() {
        var host = document.getElementById('rc-tpl-preview');
        if (!host || !window.reportCardDocument) return;
        host.innerHTML = window.reportCardDocument.render(sampleCard(), readTemplateForm());
    }

    async function saveTemplate(event) {
        if (event) event.preventDefault();
        var statusEl = document.getElementById('rc-tpl-status');
        var saveBtn = document.getElementById('rc-tpl-save');

        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }
        if (statusEl) statusEl.textContent = '';

        try {
            var saved = await window.dataService.saveReportCardTemplate(readTemplateForm());
            // Refill from what was actually stored: the scale comes back
            // sorted, de-duplicated and floored at 0, and the admin should see
            // the bands as they will be applied rather than as they typed them.
            fillTemplateForm(saved);
            renderTemplatePreview();
            if (statusEl) {
                statusEl.textContent = 'Saved. Every report card now uses this design, including ones already published.';
            }
        } catch (err) {
            console.error('[ReportCards] template save failed:', err);
            if (statusEl) {
                statusEl.textContent = 'Could not save: ' + (err && err.message || 'unknown error') +
                    '. Check your connection and try again.';
            }
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Design'; }
        }
    }

    async function resetTemplate() {
        var proceed = await askConfirm('Reset the design?',
            'The letterhead, colours and marking scheme go back to their defaults. Nothing is saved until you press Save Design.');
        if (!proceed) return;
        fillTemplateForm(window.dataService.reportCardTemplateDefaults());
        renderTemplatePreview();
    }

    async function loadTemplateView() {
        if (state.templateLoaded) {
            renderTemplatePreview();
            return;
        }
        var tpl = await window.dataService.loadReportCardTemplate();
        state.templateLoaded = true;
        fillTemplateForm(tpl);
        renderTemplatePreview();
    }

    function bindTemplateView() {
        var form = document.getElementById('rc-template-form');
        if (!form) return;

        form.addEventListener('submit', saveTemplate);
        // Any edit repaints the preview — it is the same renderer as the
        // printed card, so this is a true what-you-see-is-what-prints.
        form.addEventListener('input', renderTemplatePreview);
        form.addEventListener('change', renderTemplatePreview);

        bindGradingScale();

        var reset = document.getElementById('rc-tpl-reset');
        if (reset) reset.addEventListener('click', resetTemplate);

        var logoInput = document.getElementById('rc-tpl-logo-input');
        if (logoInput) {
            logoInput.addEventListener('change', async function() {
                var file = logoInput.files && logoInput.files[0];
                if (!file) return;
                try {
                    state.templateLogo = await readLogoFile(file);
                    renderLogoPreview();
                    renderTemplatePreview();
                } catch (err) {
                    notify('Could not use that image', escapeHtml(err.message || 'Unknown error'));
                } finally {
                    logoInput.value = ''; // allow re-picking the same file
                }
            });
        }

        var logoClear = document.getElementById('rc-tpl-logo-clear');
        if (logoClear) {
            logoClear.addEventListener('click', function() {
                state.templateLogo = '';
                renderLogoPreview();
                renderTemplatePreview();
            });
        }
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

        async function attempt() {
            var code = (input ? input.value : '').trim();
            if (!code || code.length !== 6) {
                if (errorEl) {
                    errorEl.textContent = 'Access is restricted to admin and class teachers only. Please enter a valid 6-digit access code from your school admin.';
                    errorEl.style.display = 'block';
                }
                return;
            }

            // Check the code against all classes
            var codes;
            try {
                codes = await window.dataService.getReportCardAccessCodes();
            } catch (error) {
                if (errorEl) {
                    errorEl.textContent = 'Could not verify the access code. Please check your connection and try again.';
                    errorEl.style.display = 'block';
                }
                return;
            }
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

    var ICON_REGENERATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>';
    var ICON_SEND_MESSAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="17" height="17"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';

    function allClassesOf(academic) {
        var out = [];
        Object.values((academic && academic.classesByLevel) || {}).forEach(function(classes) {
            classes.forEach(function(c) { out.push(c); });
        });
        return out;
    }

    async function renderAccessCodesTable(academic) {
        var list = document.getElementById('rc-access-codes-list');
        if (!list) return;

        var allClasses = allClassesOf(academic);
        var codes;
        try {
            codes = await window.dataService.getReportCardAccessCodes();
        } catch (error) {
            list.innerHTML = '<p class="rc-empty">Could not load access codes. Please check your connection and try again.</p>';
            return;
        }

        // Generate lives in the Access Code cell and is replaced by the code
        // once there is one; Actions keeps only Regenerate so the send column
        // has room of its own.
        var html = '<table class="rc-access-table">' +
            '<thead><tr>' +
                '<th>Class</th>' +
                '<th>Access Code</th>' +
                '<th class="rc-col-send">Send</th>' +
                '<th class="rc-col-actions">Actions</th>' +
            '</tr></thead>' +
            '<tbody>' + allClasses.map(function(c) {
                var code = codes[c.value];
                var cls = escapeHtml(c.value);
                return '<tr>' +
                    '<td style="font-weight:600;">' + escapeHtml(c.text) + '</td>' +
                    '<td>' + (code
                        ? '<span class="rc-code-display">' + escapeHtml(code) + '</span>'
                        : '<button type="button" class="rc-code-generate" data-class="' + cls + '">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>' +
                            'Generate</button>') +
                    '</td>' +
                    '<td class="rc-col-send">' +
                        '<button type="button" class="rc-code-icon-btn rc-send-code-btn" data-class="' + cls + '"' +
                            (code ? ' title="Send this code to a teacher" aria-label="Send code to a teacher"'
                                  : ' disabled title="Generate a code first" aria-label="Send code to a teacher"') + '>' +
                            ICON_SEND_MESSAGE +
                        '</button>' +
                    '</td>' +
                    '<td class="rc-col-actions">' +
                        '<div class="rc-code-actions">' +
                            '<button type="button" class="rc-code-icon-btn rc-regen-code-btn" data-class="' + cls + '"' +
                                (code ? ' title="Regenerate code" aria-label="Regenerate code"'
                                      : ' disabled title="No code to regenerate yet" aria-label="Regenerate code"') + '>' +
                                ICON_REGENERATE +
                            '</button>' +
                        '</div>' +
                    '</td>' +
                '</tr>';
            }).join('') + '</tbody></table>';

        list.innerHTML = html;

        function classTextOf(classLevel) {
            var match = allClasses.filter(function(c) { return c.value === classLevel; })[0];
            return match ? match.text : classLevel;
        }

        list.querySelectorAll('.rc-code-generate').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                try {
                    await window.dataService.generateReportCardAccessCode(btn.getAttribute('data-class'));
                    await renderAccessCodesTable(academic);
                } catch (error) {
                    notify('Could not generate code', 'Please check your connection and try again.');
                }
            });
        });

        // Regenerating invalidates a code teachers may already be using, so it
        // asks first — unlike the first Generate, which can't break anything.
        list.querySelectorAll('.rc-regen-code-btn').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                var classLevel = btn.getAttribute('data-class');
                var ok = await askConfirm(
                    'Regenerate code',
                    'Generate a new access code for ' + escapeHtml(classTextOf(classLevel)) +
                    '? The current code will stop working immediately.'
                );
                if (!ok) return;
                try {
                    await window.dataService.generateReportCardAccessCode(classLevel);
                    await renderAccessCodesTable(academic);
                } catch (error) {
                    notify('Could not regenerate code', 'Please check your connection and try again.');
                }
            });
        });

        list.querySelectorAll('.rc-send-code-btn').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                var classLevel = btn.getAttribute('data-class');
                var codes;
                try {
                    codes = await window.dataService.getReportCardAccessCodes();
                } catch (error) {
                    notify('Could not load code', 'Please check your connection and try again.');
                    return;
                }
                var code = codes[classLevel];
                if (!code) return;
                openSendCodeModal(classLevel, classTextOf(classLevel), code);
            });
        });
    }

    // ================================================================
    // SEND ACCESS CODE TO A TEACHER (Admin only)
    // The code is delivered through the same admin/teacher chat the admin
    // dashboard uses, so it lands in the teacher's Messages panel.
    // ================================================================

    var sendState = {
        classLevel: '',
        classText: '',
        code: '',
        teachers: null,       // cached profile list for the school
        selectedId: '',       // profiles.id of the chosen teacher
        loading: false
    };

    // Class spellings differ between the dropdown values and what an admin
    // typed onto a profile ("JSS 1" vs "JSS1"), so match on a squashed form.
    function normClass(value) {
        return String(value || '').replace(/\s+/g, '').toUpperCase();
    }

    function teacherName(t) {
        return t.full_name || t.username || 'Teacher';
    }

    function initials(name) {
        return String(name || '?').trim().split(/\s+/).slice(0, 2)
            .map(function(part) { return part.charAt(0).toUpperCase(); }).join('') || '?';
    }

    function defaultCodeMessage(classText, code) {
        return 'Report card access code for ' + classText + ': ' + code + '\n\n' +
            'Enter this code on the Report Cards page to open your class. Please keep it confidential.';
    }

    function renderSendTeacherList() {
        var listEl = document.getElementById('rc-send-teacher-list');
        if (!listEl) return;

        if (sendState.loading) {
            listEl.innerHTML = '<div class="rc-send-empty">Loading teachers…</div>';
            return;
        }
        if (!sendState.teachers) {
            listEl.innerHTML = '<div class="rc-send-empty">Could not load teachers. Please try again.</div>';
            return;
        }

        var searchEl = document.getElementById('rc-send-teacher-search');
        var q = (searchEl ? searchEl.value : '').trim().toLowerCase();
        var target = normClass(sendState.classLevel);

        var matches = sendState.teachers.filter(function(t) {
            return !q || teacherName(t).toLowerCase().indexOf(q) !== -1;
        });

        // The class's own form teacher is what the admin almost always wants,
        // so it sorts to the top and is flagged.
        matches.sort(function(a, b) {
            var af = normClass(a.class_level) === target ? 0 : 1;
            var bf = normClass(b.class_level) === target ? 0 : 1;
            if (af !== bf) return af - bf;
            return teacherName(a).localeCompare(teacherName(b));
        });

        if (!matches.length) {
            listEl.innerHTML = '<div class="rc-send-empty">' +
                (q ? 'No teachers match “' + escapeHtml(q) + '”' : 'No teachers found for this school.') +
                '</div>';
            return;
        }

        listEl.innerHTML = matches.map(function(t) {
            var name = teacherName(t);
            var isForm = target && normClass(t.class_level) === target;
            return '<button type="button" class="rc-send-teacher' +
                    (sendState.selectedId === t.id ? ' selected' : '') + '" data-id="' + escapeHtml(t.id) + '">' +
                '<span class="rc-send-avatar">' + escapeHtml(initials(name)) + '</span>' +
                '<span class="rc-send-teacher-info">' +
                    '<span class="rc-send-teacher-name">' + escapeHtml(name) + '</span>' +
                    (t.class_level ? '<span class="rc-send-teacher-sub">' + escapeHtml(t.class_level) + '</span>' : '') +
                '</span>' +
                (isForm ? '<span class="rc-send-form-badge">Form teacher</span>' : '') +
            '</button>';
        }).join('');

        listEl.querySelectorAll('.rc-send-teacher').forEach(function(row) {
            row.addEventListener('click', function() {
                sendState.selectedId = row.getAttribute('data-id');
                renderSendTeacherList();
                updateSendButton();
            });
        });
    }

    function updateSendButton() {
        var btn = document.getElementById('rc-send-submit-btn');
        if (btn) btn.disabled = !sendState.selectedId || !sendState.code;
    }

    async function loadSendTeachers() {
        if (sendState.teachers) return;
        sendState.loading = true;
        renderSendTeacherList();
        try {
            var school = window.dataService.getSchoolContext() || {};
            sendState.teachers = await window.dataService.getUsers({
                role: 'teacher',
                schoolVersion: school.schoolVersion || undefined
            });
        } catch (err) {
            console.error('[ReportCards] Failed to load teachers:', err);
            sendState.teachers = null;
        }
        sendState.loading = false;
        renderSendTeacherList();
    }

    function openSendCodeModal(classLevel, classText, code) {
        var modal = document.getElementById('rc-send-code-modal');
        if (!modal) return;

        sendState.classLevel = classLevel;
        sendState.classText = classText;
        sendState.code = code;
        sendState.selectedId = '';

        var classLabel = document.getElementById('rc-send-class-label');
        if (classLabel) classLabel.textContent = classText;
        var chip = document.getElementById('rc-send-code-chip');
        if (chip) chip.textContent = code;
        var search = document.getElementById('rc-send-teacher-search');
        if (search) search.value = '';
        var message = document.getElementById('rc-send-message');
        if (message) message.value = defaultCodeMessage(classText, code);
        var error = document.getElementById('rc-send-error');
        if (error) { error.style.display = 'none'; error.textContent = ''; }

        renderSendTeacherList();
        updateSendButton();

        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        pushNavState(state.currentView, true);

        loadSendTeachers().then(function() {
            // Pre-select the class's form teacher when there is exactly one.
            var target = normClass(classLevel);
            var forms = (sendState.teachers || []).filter(function(t) {
                return target && normClass(t.class_level) === target;
            });
            if (forms.length === 1 && !sendState.selectedId) {
                sendState.selectedId = forms[0].id;
                renderSendTeacherList();
                updateSendButton();
            }
        });
    }

    // Teardown without touching history — the popstate handler is already
    // unwinding the stack when it calls this.
    function closeSendCodeUI() {
        var modal = document.getElementById('rc-send-code-modal');
        if (!modal || !modal.classList.contains('active')) return;
        modal.classList.remove('active');
        document.body.style.overflow = '';
        sendState.selectedId = '';
    }

    function closeSendCodeModal() {
        var st = window.history.state;
        if (st && st.rcModal) {
            window.history.back();
            return;
        }
        closeSendCodeUI();
    }

    async function submitSendCode() {
        var btn = document.getElementById('rc-send-submit-btn');
        var error = document.getElementById('rc-send-error');
        var messageEl = document.getElementById('rc-send-message');
        var text = messageEl ? messageEl.value.trim() : '';

        function fail(msg) {
            if (error) { error.textContent = msg; error.style.display = ''; }
        }
        if (error) { error.style.display = 'none'; error.textContent = ''; }

        var teacher = (sendState.teachers || []).filter(function(t) {
            return t.id === sendState.selectedId;
        })[0];
        if (!teacher) return fail('Select a teacher to send the code to.');
        if (!text) return fail('The message can\'t be empty.');

        var user = window.dataService.getCurrentUser();
        if (!user || !user.id) return fail('Your session has expired. Please sign in again.');

        var school = window.dataService.getSchoolContext() || {};

        if (btn) btn.disabled = true;
        try {
            await window.dataService.sendMessage({
                fromId: user.id,
                // profiles.user is the auth record the chat threads are keyed on.
                toId: teacher.user || teacher.id,
                message: text,
                schoolVersion: school.schoolVersion || undefined
            });
            closeSendCodeModal();
            if (window.Utils && typeof Utils.showToast === 'function') {
                Utils.showToast('Access code sent to ' + teacherName(teacher), 'success');
            } else {
                notify('Code sent', 'Access code sent to ' + escapeHtml(teacherName(teacher)) + '.');
            }
        } catch (err) {
            console.error('[ReportCards] Failed to send access code:', err);
            fail('Could not send the message: ' + (err && err.message ? err.message : 'unknown error'));
        } finally {
            if (btn) btn.disabled = false;
            updateSendButton();
        }
    }

    function bindSendCodeModal() {
        var closeBtn = document.getElementById('rc-send-close');
        if (closeBtn) closeBtn.addEventListener('click', closeSendCodeModal);

        var overlay = document.getElementById('rc-send-code-modal');
        if (overlay) overlay.addEventListener('click', function(e) {
            if (e.target === overlay) closeSendCodeModal();
        });

        var search = document.getElementById('rc-send-teacher-search');
        if (search) search.addEventListener('input', renderSendTeacherList);

        var submit = document.getElementById('rc-send-submit-btn');
        if (submit) submit.addEventListener('click', submitSendCode);
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
        state.isAdmin = isAdmin;
        state.academic = academic;

        if (academic) {
            populateFormDropdowns(academic);
        }

        // Show access codes nav for admin
        // Admin-only views
        if (isAdmin) {
            ['rc-nav-access-codes', 'rc-nav-template'].forEach(function(id) {
                var el = document.getElementById(id);
                if (el) el.style.display = '';
            });
            bindTemplateView();
            bindSendCodeModal();
        }

        // The letterhead is needed wherever a card is drawn, not just in the
        // design view — warm it now so the first PDF opens already branded.
        window.dataService.loadReportCardTemplate().catch(function() { /* fails soft to defaults */ });

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
        // Default the review term filter to the current school term before the
        // initial loadReviewCards() call below reads its value.
        if (reviewTermFilter && window.Utils && typeof Utils.applyDefaultTerm === 'function') {
            Utils.applyDefaultTerm(reviewTermFilter);
        }

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
        var openPrintBtn = document.getElementById('rc-open-print-btn');
        if (openPrintBtn) openPrintBtn.addEventListener('click', function() {
            openPrintablePage(state.editingCardId);
        });

        // Bind sidebar nav switching
        document.querySelectorAll('[data-rc-nav]').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.preventDefault();
                navigateToView(el.getAttribute('data-rc-nav'));
            });
        });

        // Settings deep-links straight to a view (?view=template). Unknown or
        // admin-only views for a teacher fall back to the default.
        var requested = new URLSearchParams(window.location.search).get('view');
        var adminOnlyViews = ['template', 'access-codes'];
        if (requested && VIEW_LABELS[requested] &&
            (isAdmin || adminOnlyViews.indexOf(requested) === -1)) {
            state.currentView = requested;
        }

        // Title + bottom nav for the view the page opens on, and the history
        // entry it sits at (depth 0 — Back from here leaves the module).
        switchView(state.currentView);
        state.navDepth = 0;
        window.history.replaceState({ rcView: state.currentView, rcModal: false, rcDepth: 0 }, '');

        // Data for whichever view we opened on. The review list is warmed even
        // when we start elsewhere, because generating hands straight off to it.
        loadViewData(state.currentView);
        if (state.currentView !== 'review') loadReviewCards();
    }

    window.reportCardDashboard = { init: init };
})();
