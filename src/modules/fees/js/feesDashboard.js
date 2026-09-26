/**
 * Admin fee-payment review queue.
 * Backed by window.dataService (PocketBase) via feesDataService.
 *
 * Flow:
 *   - Queue opens on Pending, because that is the work
 *   - Filter by status tab, class, term, or a name/caption search
 *   - Click a row -> detail page: full receipt gallery, submitter history, and
 *     the Confirm / Reject panel
 *   - Rejecting requires a reason; confirming may carry an optional remark
 *
 * The queue is PAGED, not getFullList. A school running this for a few terms
 * accumulates thousands of receipts and the screen only ever shows thirty.
 *
 * What an admin can change here is narrow on purpose: status and admin_note.
 * fees_guard.pb.js restores every other field from the stored row on update, so
 * nobody — not even an admin — can edit the amount or swap the receipt images
 * after the parent submitted them.
 */

(function (global) {
    'use strict';

    const PER_PAGE = 30;

    const feesDashboard = {
        items: [],
        counts: { pending: 0, confirmed: 0, rejected: 0, total: 0 },
        filters: { status: 'pending', classLevel: '', term: '', search: '' },
        page: 1,
        totalPages: 0,
        totalItems: 0,
        viewMode: 'list',
        currentId: null,
        fileToken: '',
        lightbox: { files: [], index: 0 },
        reviewing: false,
        searchTimer: null,

        async init() {
            const user = global.dataService?.getCurrentUser?.();
            if (!user) {
                global.location.href = '../index.html';
                return;
            }
            if (user.role !== 'admin' && user.role !== 'super_admin') {
                global.location.href = 'student-fees.html';
                return;
            }

            this.cache();
            this.bind();
            this.populateClassFilter();
            await this.refresh();
        },

        cache() {
            this.nodes = {
                userName: document.getElementById('user-name'),
                userAvatar: document.getElementById('sidebar-avatar'),
                statPending: document.getElementById('fee-stat-pending'),
                statConfirmed: document.getElementById('fee-stat-confirmed'),
                statRejected: document.getElementById('fee-stat-rejected'),

                listView: document.getElementById('fee-list-view'),
                detailView: document.getElementById('fee-detail-view'),
                list: document.getElementById('fee-queue-list'),
                listMeta: document.getElementById('fee-list-meta'),
                detail: document.getElementById('fee-queue-detail'),
                backBtn: document.getElementById('fee-back-to-list'),

                tabs: document.getElementById('fee-tabs'),
                classFilter: document.getElementById('fee-class-filter'),
                termFilter: document.getElementById('fee-term-filter'),
                search: document.getElementById('fee-search'),

                pager: document.getElementById('fee-pager'),
                pagerInfo: document.getElementById('fee-pager-info'),
                prevPage: document.getElementById('fee-prev-page'),
                nextPage: document.getElementById('fee-next-page'),

                lightbox: document.getElementById('fee-lightbox'),
                lightboxImg: document.getElementById('fee-lightbox-img'),
                lightboxClose: document.getElementById('fee-lightbox-close'),
                lightboxPrev: document.getElementById('fee-lightbox-prev'),
                lightboxNext: document.getElementById('fee-lightbox-next'),
                lightboxCounter: document.getElementById('fee-lightbox-counter'),

                rejectModal: document.getElementById('fee-reject-modal'),
                rejectClose: document.getElementById('fee-reject-close'),
                rejectCancel: document.getElementById('fee-reject-cancel'),
                rejectForm: document.getElementById('fee-reject-form'),
                rejectReason: document.getElementById('fee-reject-reason'),
                rejectStatus: document.getElementById('fee-reject-status'),
                rejectSubmit: document.getElementById('fee-reject-submit')
            };
        },

        bind() {
            const user = global.dataService.getCurrentUser();
            if (this.nodes.userName) this.nodes.userName.textContent = user.name || user.username || 'Admin';
            if (this.nodes.userAvatar) {
                this.nodes.userAvatar.textContent = (user.name || user.username || 'A').trim().charAt(0).toUpperCase();
            }

            if (this.nodes.tabs) {
                this.nodes.tabs.addEventListener('click', (event) => {
                    const tab = event.target.closest('[data-status]');
                    if (!tab) return;
                    this.filters.status = tab.getAttribute('data-status');
                    this.page = 1;
                    this.syncTabs();
                    this.refresh();
                });
            }

            if (this.nodes.classFilter) {
                this.nodes.classFilter.addEventListener('change', () => {
                    this.filters.classLevel = this.nodes.classFilter.value;
                    this.page = 1;
                    this.refresh();
                });
            }

            if (this.nodes.termFilter) {
                this.nodes.termFilter.addEventListener('change', () => {
                    this.filters.term = this.nodes.termFilter.value;
                    this.page = 1;
                    this.refresh();
                });
            }

            if (this.nodes.search) {
                // Debounced: every keystroke is a server round trip otherwise,
                // and this list is filtered server-side by design.
                this.nodes.search.addEventListener('input', () => {
                    clearTimeout(this.searchTimer);
                    this.searchTimer = setTimeout(() => {
                        this.filters.search = this.nodes.search.value.trim();
                        this.page = 1;
                        this.refresh();
                    }, 350);
                });
            }

            if (this.nodes.backBtn) this.nodes.backBtn.addEventListener('click', () => this.showList());

            if (this.nodes.prevPage) {
                this.nodes.prevPage.addEventListener('click', () => {
                    if (this.page > 1) { this.page--; this.refresh(); }
                });
            }
            if (this.nodes.nextPage) {
                this.nodes.nextPage.addEventListener('click', () => {
                    if (this.page < this.totalPages) { this.page++; this.refresh(); }
                });
            }

            // Reject modal
            if (this.nodes.rejectClose) this.nodes.rejectClose.addEventListener('click', () => this.closeRejectModal());
            if (this.nodes.rejectCancel) this.nodes.rejectCancel.addEventListener('click', () => this.closeRejectModal());
            if (this.nodes.rejectModal) {
                this.nodes.rejectModal.addEventListener('click', (event) => {
                    if (event.target === this.nodes.rejectModal) this.closeRejectModal();
                });
            }
            if (this.nodes.rejectForm) {
                this.nodes.rejectForm.addEventListener('submit', (event) => this.handleReject(event));
            }

            // Lightbox
            if (this.nodes.lightboxClose) this.nodes.lightboxClose.addEventListener('click', () => this.closeLightbox());
            if (this.nodes.lightboxPrev) this.nodes.lightboxPrev.addEventListener('click', () => this.stepLightbox(-1));
            if (this.nodes.lightboxNext) this.nodes.lightboxNext.addEventListener('click', () => this.stepLightbox(1));
            if (this.nodes.lightbox) {
                this.nodes.lightbox.addEventListener('click', (event) => {
                    if (event.target === this.nodes.lightbox) this.closeLightbox();
                });
            }
            document.addEventListener('keydown', (event) => {
                if (!this.nodes.lightbox?.classList.contains('open')) return;
                if (event.key === 'Escape') this.closeLightbox();
                if (event.key === 'ArrowLeft') this.stepLightbox(-1);
                if (event.key === 'ArrowRight') this.stepLightbox(1);
            });

            const logout = document.getElementById('fee-logout-btn');
            if (logout) {
                logout.addEventListener('click', () => {
                    if (global.auth?.logout) global.auth.logout();
                    else global.location.href = '../index.html';
                });
            }
        },

        populateClassFilter() {
            const select = this.nodes.classFilter;
            if (!select) return;
            let classes = [];
            try {
                classes = global.academicEntities?.getAllClasses?.() || [];
            } catch (error) { /* catalog not loaded — leave the filter at All */ }
            classes.forEach((item) => {
                const option = document.createElement('option');
                option.value = item.value;
                option.textContent = item.label || item.value;
                select.appendChild(option);
            });
        },

        // ============================================================
        // Data
        // ============================================================

        async refresh() {
            try {
                const [result, counts, token] = await Promise.all([
                    global.dataService.getSchoolFeePayments({
                        status: this.filters.status === 'all' ? '' : this.filters.status,
                        classLevel: this.filters.classLevel,
                        term: this.filters.term,
                        search: this.filters.search,
                        page: this.page,
                        perPage: PER_PAGE
                    }),
                    global.dataService.getFeePaymentCounts(),
                    global.dataService.getFeeFileToken()
                ]);

                this.items = result.items;
                this.page = result.page;
                this.totalPages = result.totalPages;
                this.totalItems = result.totalItems;
                this.counts = counts;
                this.fileToken = token || '';
            } catch (error) {
                console.error('[feesDashboard] refresh failed:', error);
                this.items = [];
                this.renderError(this.friendlyError(error, 'Could not load the payment queue.'));
                return;
            }

            this.renderStats();
            this.syncTabs();
            if (this.viewMode === 'detail' && this.currentId) {
                this.renderDetail();
            } else {
                this.renderList();
            }
            this.renderPager();
        },

        /**
         * Re-read the two places a pending-payment count is shown outside this
         * page: the topbar bell and the sidebar's Fee Payments badge. Both are
         * painted once at page load, so without this they keep showing the old
         * number until the next navigation.
         *
         * Called only from the four actions that actually move a payment in or
         * out of "pending" — not from refresh(), which also runs on every filter
         * and tab change and would turn each of those into wasted requests.
         * Both are no-ops on a page where they never mounted.
         */
        syncBell() {
            global.__notificationBell?.refresh();
            global.__sidebarChrome?.refreshFeesBadge();
        },

        renderStats() {
            if (this.nodes.statPending) this.nodes.statPending.textContent = String(this.counts.pending);
            if (this.nodes.statConfirmed) this.nodes.statConfirmed.textContent = String(this.counts.confirmed);
            if (this.nodes.statRejected) this.nodes.statRejected.textContent = String(this.counts.rejected);
        },

        syncTabs() {
            if (!this.nodes.tabs) return;
            this.nodes.tabs.querySelectorAll('[data-status]').forEach((tab) => {
                const status = tab.getAttribute('data-status');
                tab.classList.toggle('active', status === this.filters.status);
                const badge = tab.querySelector('.fee-tab-count');
                if (badge) {
                    badge.textContent = status === 'all'
                        ? String(this.counts.total)
                        : String(this.counts[status] ?? 0);
                }
            });
        },

        // ============================================================
        // List
        // ============================================================

        renderList() {
            const list = this.nodes.list;
            if (!list) return;

            if (this.nodes.listMeta) {
                this.nodes.listMeta.textContent = this.totalItems +
                    (this.totalItems === 1 ? ' submission' : ' submissions');
            }

            if (!this.items.length) {
                list.innerHTML = this.emptyState();
                return;
            }

            list.innerHTML = this.items.map((payment) => this.rowHtml(payment)).join('');
            list.querySelectorAll('[data-payment-id]').forEach((row) => {
                row.addEventListener('click', () => this.showDetail(row.getAttribute('data-payment-id')));
            });
        },

        rowHtml(payment) {
            const amount = payment.amount !== null
                ? '<span class="fee-row-amount">' + this.formatAmount(payment.amount) + '</span>'
                : '';

            return '' +
                '<div class="fee-row" data-payment-id="' + this.escape(payment.id) + '" role="button" tabindex="0">' +
                    this.thumbHtml(payment) +
                    '<div class="fee-row-body">' +
                        '<div class="fee-row-top">' +
                            '<p class="fee-row-name">' + this.escape(payment.studentName || 'Unknown student') + '</p>' +
                            this.statusPill(payment.status) +
                        '</div>' +
                        '<p class="fee-row-caption">' +
                            '<strong>' + this.escape(payment.purposeLabel) + '</strong> &middot; ' +
                            this.escape(payment.caption) +
                        '</p>' +
                        '<div class="fee-row-meta">' +
                            (payment.classLevel ? '<span>' + this.escape(payment.classLevel) + '</span><span class="fee-row-meta-dot">&middot;</span>' : '') +
                            '<span>' + this.formatDate(payment.createdAt) + '</span>' +
                            (amount ? '<span class="fee-row-meta-dot">&middot;</span>' + amount : '') +
                        '</div>' +
                    '</div>' +
                '</div>';
        },

        thumbHtml(payment) {
            const first = payment.receipts[0];
            if (!first) return '<div class="fee-row-thumb"></div>';
            const url = global.dataService.getFeeReceiptUrl(payment, first, {
                thumb: '120x120',
                token: this.fileToken
            });
            const extra = payment.receipts.length > 1
                ? '<span class="fee-row-thumb-more">+' + (payment.receipts.length - 1) + '</span>'
                : '';
            return '' +
                '<div class="fee-row-thumb-stack">' +
                    '<img class="fee-row-thumb" src="' + this.escape(url) + '" alt="Receipt" loading="lazy">' +
                    extra +
                '</div>';
        },

        emptyState() {
            const label = this.filters.status === 'pending'
                ? 'Nothing waiting for review'
                : 'No submissions match these filters';
            const text = this.filters.status === 'pending'
                ? 'Every receipt submitted so far has been reviewed.'
                : 'Try a different status tab, class, or search term.';
            return '' +
                '<div class="fee-empty">' +
                    '<span class="fee-empty-icon">' +
                        '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
                    '</span>' +
                    '<p class="fee-empty-title">' + label + '</p>' +
                    '<p class="fee-empty-text">' + text + '</p>' +
                '</div>';
        },

        renderError(message) {
            if (!this.nodes.list) return;
            this.nodes.list.innerHTML = '' +
                '<div class="fee-empty">' +
                    '<p class="fee-empty-title">Could not load the queue</p>' +
                    '<p class="fee-empty-text">' + this.escape(message) + '</p>' +
                '</div>';
        },

        renderPager() {
            if (!this.nodes.pager) return;
            const show = this.totalPages > 1;
            this.nodes.pager.style.display = show ? '' : 'none';
            if (!show) return;
            if (this.nodes.pagerInfo) {
                this.nodes.pagerInfo.textContent = 'Page ' + this.page + ' of ' + this.totalPages;
            }
            if (this.nodes.prevPage) this.nodes.prevPage.disabled = this.page <= 1;
            if (this.nodes.nextPage) this.nodes.nextPage.disabled = this.page >= this.totalPages;
        },

        // ============================================================
        // Detail + review
        // ============================================================

        showDetail(paymentId) {
            this.currentId = paymentId;
            this.viewMode = 'detail';
            this.renderDetail();
            if (this.nodes.listView) this.nodes.listView.classList.add('hidden');
            if (this.nodes.detailView) this.nodes.detailView.classList.add('active');
            global.scrollTo({ top: 0, behavior: 'smooth' });
        },

        showList() {
            this.viewMode = 'list';
            this.currentId = null;
            if (this.nodes.detailView) this.nodes.detailView.classList.remove('active');
            if (this.nodes.listView) this.nodes.listView.classList.remove('hidden');
            this.renderList();
        },

        renderDetail() {
            const payment = this.items.find((p) => p.id === this.currentId);
            const host = this.nodes.detail;
            if (!host) return;
            if (!payment) {
                this.showList();
                return;
            }

            const receipts = payment.receipts.map((filename, index) => {
                const url = global.dataService.getFeeReceiptUrl(payment, filename, {
                    thumb: '400x0',
                    token: this.fileToken
                });
                return '<button type="button" class="fee-receipt" data-receipt-index="' + index + '">' +
                    '<img src="' + this.escape(url) + '" alt="Receipt ' + (index + 1) + '" loading="lazy">' +
                '</button>';
            }).join('');

            const reviewed = payment.status !== 'pending';

            host.innerHTML = '' +
                '<div class="fee-detail-head">' +
                    '<div>' +
                        '<h2 class="fee-detail-title">' + this.escape(payment.studentName || 'Unknown student') + '</h2>' +
                        '<p class="fee-detail-sub">' +
                            this.escape(payment.purposeLabel) +
                            (payment.classLevel ? ' &middot; ' + this.escape(payment.classLevel) : '') +
                            ' &middot; submitted ' + this.formatDateTime(payment.createdAt) +
                        '</p>' +
                    '</div>' +
                    this.statusPill(payment.status) +
                '</div>' +

                '<div class="fee-detail-grid">' +
                    this.field('Amount stated', payment.amount !== null ? this.formatAmount(payment.amount) : 'Not stated') +
                    this.field('Purpose', payment.purposeLabel) +
                    this.field('Term', payment.term || 'Not stated') +
                    this.field('Session', payment.session || 'Not stated') +
                '</div>' +

                '<p class="fee-detail-caption">' + this.escape(payment.caption) + '</p>' +

                '<section class="fee-section">' +
                    '<div class="fee-section-head">' +
                        '<div>' +
                            '<span class="fee-section-eyebrow">Evidence</span>' +
                            '<h3 class="fee-section-title">Receipt images</h3>' +
                        '</div>' +
                        '<span class="fee-section-meta">' + payment.receipts.length +
                            (payment.receipts.length === 1 ? ' image' : ' images') + ' &middot; click to enlarge</span>' +
                    '</div>' +
                    '<div class="fee-receipts">' + receipts + '</div>' +
                '</section>' +

                '<div class="fee-review">' +
                    '<p class="fee-review-title">' + (reviewed ? 'Review decision' : 'Confirm this payment?') + '</p>' +
                    '<p class="fee-review-hint">' +
                        (reviewed
                            ? this.escape(
                                (payment.status === 'confirmed' ? 'Confirmed' : 'Rejected') +
                                ' by ' + (payment.reviewedByName || 'an admin') +
                                (payment.reviewedAt ? ' on ' + this.formatDateTime(payment.reviewedAt) : '') + '.'
                              ) + (payment.adminNote ? '<br>Note: ' + this.escape(payment.adminNote) : '')
                            : 'Check the receipt against your records. The submitter sees this decision on their own page.') +
                    '</p>' +

                    (reviewed
                        ? '<div class="fee-review-actions">' +
                            '<button type="button" class="fee-btn secondary" id="fee-reopen-btn">Reopen for review</button>' +
                            '<button type="button" class="ghost-cta danger" id="fee-delete-btn">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                                'Delete record' +
                            '</button>' +
                          '</div>'
                        : '<div class="fee-field" style="margin-top:14px;">' +
                            '<label class="fee-label" for="fee-confirm-note">Remark <span class="fee-label-hint">(optional — the submitter sees this)</span></label>' +
                            '<input type="text" class="fee-input" id="fee-confirm-note" maxlength="500" placeholder="e.g. Receipted. Balance outstanding: 12,000">' +
                          '</div>' +
                          '<div class="fee-review-actions">' +
                            '<button type="button" class="fee-btn confirm" id="fee-confirm-btn">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>' +
                                'Confirm payment' +
                            '</button>' +
                            '<button type="button" class="fee-btn danger" id="fee-reject-btn">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                                'Reject' +
                            '</button>' +
                            '<button type="button" class="ghost-cta danger" id="fee-delete-btn" style="margin-left:auto;">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                                'Delete' +
                            '</button>' +
                          '</div>') +
                '</div>';

            host.querySelectorAll('[data-receipt-index]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.openLightbox(payment, Number(btn.getAttribute('data-receipt-index')));
                });
            });

            const confirmBtn = document.getElementById('fee-confirm-btn');
            if (confirmBtn) confirmBtn.addEventListener('click', () => this.handleConfirm(payment));

            const rejectBtn = document.getElementById('fee-reject-btn');
            if (rejectBtn) rejectBtn.addEventListener('click', () => this.openRejectModal(payment));

            const reopenBtn = document.getElementById('fee-reopen-btn');
            if (reopenBtn) reopenBtn.addEventListener('click', () => this.handleReopen(payment));

            const deleteBtn = document.getElementById('fee-delete-btn');
            if (deleteBtn) deleteBtn.addEventListener('click', () => this.handleDelete(payment));
        },

        field(label, value) {
            return '' +
                '<div class="fee-detail-field">' +
                    '<span class="fee-detail-label">' + this.escape(label) + '</span>' +
                    '<span class="fee-detail-value">' + this.escape(value) + '</span>' +
                '</div>';
        },

        async handleConfirm(payment) {
            if (this.reviewing) return;
            const note = document.getElementById('fee-confirm-note')?.value || '';
            this.reviewing = true;
            try {
                await global.dataService.reviewFeePayment(payment.id, {
                    status: 'confirmed',
                    adminNote: note
                });
                await this.refresh();
                this.syncBell();
                this.notify('Payment confirmed', 'The submitter now sees this as confirmed on their page.');
            } catch (error) {
                this.notify('Could not confirm', this.escape(this.friendlyError(error, 'The payment could not be confirmed.')));
            } finally {
                this.reviewing = false;
            }
        },

        openRejectModal(payment) {
            this.rejectTarget = payment;
            if (this.nodes.rejectReason) this.nodes.rejectReason.value = '';
            this.setRejectStatus('', '');
            if (this.nodes.rejectModal) this.nodes.rejectModal.classList.add('open');
            if (this.nodes.rejectReason) this.nodes.rejectReason.focus();
        },

        closeRejectModal() {
            if (this.nodes.rejectModal) this.nodes.rejectModal.classList.remove('open');
            this.rejectTarget = null;
        },

        async handleReject(event) {
            event.preventDefault();
            if (this.reviewing || !this.rejectTarget) return;

            const reason = (this.nodes.rejectReason?.value || '').trim();
            if (!reason) {
                // Enforced here and again in the data service. A rejection with
                // no reason leaves the parent with nothing to act on.
                this.setRejectStatus('Give a reason — the submitter sees it and needs to know what to fix.', 'error');
                return;
            }

            this.reviewing = true;
            if (this.nodes.rejectSubmit) this.nodes.rejectSubmit.disabled = true;
            try {
                await global.dataService.reviewFeePayment(this.rejectTarget.id, {
                    status: 'rejected',
                    adminNote: reason
                });
                this.closeRejectModal();
                await this.refresh();
                this.syncBell();
            } catch (error) {
                this.setRejectStatus(this.friendlyError(error, 'The payment could not be rejected.'), 'error');
            } finally {
                this.reviewing = false;
                if (this.nodes.rejectSubmit) this.nodes.rejectSubmit.disabled = false;
            }
        },

        async handleReopen(payment) {
            const ok = await this.askConfirm(
                'Reopen for review?',
                'This puts the submission back in the pending queue and clears the previous decision.'
            );
            if (!ok) return;
            try {
                await global.dataService.reviewFeePayment(payment.id, { status: 'pending', adminNote: '' });
                await this.refresh();
                // Reopening puts a payment BACK into pending, so this one raises
                // the bell count rather than lowering it.
                this.syncBell();
            } catch (error) {
                this.notify('Could not reopen', this.escape(this.friendlyError(error, 'The submission could not be reopened.')));
            }
        },

        async handleDelete(payment) {
            const ok = await this.askConfirm(
                'Delete this record?',
                'This permanently removes the submission and its receipt images for ' +
                this.escape(payment.studentName || 'this student') + '. This cannot be undone.'
            );
            if (!ok) return;
            try {
                await global.dataService.deleteFeePayment(payment.id);
                this.showList();
                await this.refresh();
                this.syncBell();
            } catch (error) {
                this.notify('Could not delete', this.escape(this.friendlyError(error, 'The record could not be deleted.')));
            }
        },

        setRejectStatus(message, kind) {
            const node = this.nodes.rejectStatus;
            if (!node) return;
            node.textContent = message || '';
            node.className = 'fee-status-msg' + (kind ? ' ' + kind : '');
        },

        // ============================================================
        // Lightbox
        // ============================================================

        openLightbox(payment, index) {
            this.lightbox = { payment, files: payment.receipts, index: index || 0 };
            this.renderLightbox();
            if (this.nodes.lightbox) this.nodes.lightbox.classList.add('open');
        },

        closeLightbox() {
            if (this.nodes.lightbox) this.nodes.lightbox.classList.remove('open');
        },

        stepLightbox(delta) {
            const total = this.lightbox.files?.length || 0;
            if (!total) return;
            this.lightbox.index = (this.lightbox.index + delta + total) % total;
            this.renderLightbox();
        },

        renderLightbox() {
            const { payment, files, index } = this.lightbox;
            if (!files?.length || !this.nodes.lightboxImg) return;
            // Full resolution — an admin has to be able to read the teller's
            // handwriting and the stamp.
            this.nodes.lightboxImg.src = global.dataService.getFeeReceiptUrl(payment, files[index], {
                token: this.fileToken
            });
            if (this.nodes.lightboxCounter) {
                this.nodes.lightboxCounter.textContent = (index + 1) + ' of ' + files.length;
            }
            const many = files.length > 1;
            if (this.nodes.lightboxPrev) this.nodes.lightboxPrev.style.display = many ? '' : 'none';
            if (this.nodes.lightboxNext) this.nodes.lightboxNext.style.display = many ? '' : 'none';
        },

        // ============================================================
        // Helpers
        // ============================================================

        statusPill(status) {
            const map = {
                pending: {
                    label: 'Pending',
                    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
                },
                confirmed: {
                    label: 'Confirmed',
                    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="20 6 9 17 4 12"/></svg>'
                },
                rejected: {
                    label: 'Rejected',
                    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
                }
            };
            const item = map[status] || map.pending;
            // `plain` strips the pill chrome — see the note in fees.css. The
            // student view deliberately keeps the bordered pill.
            return '<span class="fee-pill plain ' + status + '">' + item.icon + item.label + '</span>';
        },

        formatAmount(value) {
            const n = Number(value);
            if (!isFinite(n)) return '';
            try {
                return '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
            } catch (error) {
                return '₦' + n;
            }
        },

        formatDate(value) {
            if (!value) return '';
            const date = new Date(value);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        },

        formatDateTime(value) {
            if (!value) return '';
            const date = new Date(value);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
                ' at ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        },

        escape(value) {
            const div = document.createElement('div');
            div.textContent = String(value == null ? '' : value);
            return div.innerHTML;
        },

        askConfirm(title, message) {
            if (global.Utils && typeof global.Utils.showConfirm === 'function') {
                return global.Utils.showConfirm(title, message);
            }
            return Promise.resolve(global.confirm(String(message).replace(/<[^>]*>/g, '')));
        },

        notify(title, message) {
            if (global.Utils && typeof global.Utils.showAlert === 'function') {
                return global.Utils.showAlert(title, message);
            }
            global.alert(String(message).replace(/<[^>]*>/g, ''));
            return Promise.resolve();
        },

        friendlyError(error, fallback) {
            // PocketBase reports per-field validation failures as
            // data.data = { fieldName: { code, message } }. Surface the field
            // name — a bare 400 gives you nothing to act on.
            const fields = error?.data?.data;
            if (fields && typeof fields === 'object') {
                const names = Object.keys(fields);
                if (names.length) {
                    const first = fields[names[0]] || {};
                    return 'The server rejected "' + names[0] + '": ' + (first.message || 'invalid value');
                }
            }

            const message = error?.message || error?.data?.message || '';
            if (!message) return fallback;
            if (/only a school admin/i.test(message)) {
                return 'Only a school admin can review a payment.';
            }
            if (/auth|login|unauthor|forbid/i.test(message)) {
                return 'You need to be signed in as an admin to do that.';
            }
            if (/network|fetch|connect|offline/i.test(message)) {
                return 'Network error. Check your internet connection and try again.';
            }
            if (/collection.*fee_payments/i.test(message) || /not\s*found.*collection/i.test(message)) {
                return 'The fees collection is missing on the server. Run the fees migration on PocketBase.';
            }
            return message || fallback;
        }
    };

    global.feesDashboard = feesDashboard;
})(typeof globalThis !== 'undefined' ? globalThis : window);
