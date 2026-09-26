/**
 * Student / parent fee-payment view.
 * Backed by window.dataService (PocketBase) via feesDataService.
 *
 * Flow:
 *   - Primary view: the submitter's own payment history, newest first
 *   - "Submit a payment" opens a modal: purpose, amount, caption, up to 5 photos
 *   - Clicking a row opens a detail page (receipt gallery + the admin's decision)
 *   - A pending submission can be withdrawn; a reviewed one cannot
 *
 * The confirmation half of the loop lives here: a confirmed payment shows a green
 * banner and a reviewer name, a rejected one shows the admin's reason. Without the
 * rejection path a blurry photo would sit "pending" forever with nobody able to
 * say why, which is the failure this module is meant to prevent.
 *
 * Images are prepared by window.imageUpload before they are handed to the data
 * service — they leave the device as downscaled JPEGs, never as base64.
 */

(function (global) {
    'use strict';

    const MAX_CAPTION = 500;

    const studentFees = {
        payments: [],
        viewMode: 'list',          // 'list' | 'detail'
        currentId: null,
        pendingFiles: [],          // prepared File objects awaiting submit
        previewUrls: [],           // object URLs to revoke
        fileToken: '',
        lightbox: { files: [], index: 0 },
        submitting: false,

        async init() {
            const user = global.dataService?.getCurrentUser?.();
            if (!user) {
                global.location.href = '../index.html';
                return;
            }
            if (user.role === 'admin' || user.role === 'super_admin') {
                global.location.href = 'fees.html';
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
                classText: document.getElementById('fee-student-class'),
                statPending: document.getElementById('fee-stat-pending'),
                statConfirmed: document.getElementById('fee-stat-confirmed'),
                statTotal: document.getElementById('fee-stat-total'),

                listView: document.getElementById('fee-list-view'),
                detailView: document.getElementById('fee-detail-view'),
                list: document.getElementById('fee-student-list'),
                listMeta: document.getElementById('fee-list-meta'),
                detail: document.getElementById('fee-student-detail'),
                backBtn: document.getElementById('fee-back-to-list'),

                openComposer: document.getElementById('fee-open-composer'),
                openComposerEmpty: document.getElementById('fee-open-composer-empty'),

                modal: document.getElementById('fee-compose-modal'),
                modalClose: document.getElementById('fee-compose-close'),
                modalCancel: document.getElementById('fee-compose-cancel'),
                form: document.getElementById('fee-compose-form'),
                purpose: document.getElementById('fee-purpose'),
                amount: document.getElementById('fee-amount'),
                caption: document.getElementById('fee-caption'),
                captionCount: document.getElementById('fee-caption-count'),
                dropzone: document.getElementById('fee-dropzone'),
                fileInput: document.getElementById('fee-file-input'),
                previews: document.getElementById('fee-previews'),
                submitBtn: document.getElementById('fee-submit-btn'),
                statusMsg: document.getElementById('fee-compose-status'),

                lightbox: document.getElementById('fee-lightbox'),
                lightboxImg: document.getElementById('fee-lightbox-img'),
                lightboxClose: document.getElementById('fee-lightbox-close'),
                lightboxPrev: document.getElementById('fee-lightbox-prev'),
                lightboxNext: document.getElementById('fee-lightbox-next'),
                lightboxCounter: document.getElementById('fee-lightbox-counter')
            };
        },

        bind() {
            const user = global.dataService.getCurrentUser();
            if (this.nodes.userName) this.nodes.userName.textContent = user.name || user.username || 'Student';
            if (this.nodes.userAvatar) {
                this.nodes.userAvatar.textContent = (user.name || user.username || 'S').trim().charAt(0).toUpperCase();
            }
            if (this.nodes.classText) this.nodes.classText.textContent = user.classLevel || user.class_level || 'Student';

            const openers = [this.nodes.openComposer, this.nodes.openComposerEmpty];
            openers.forEach((btn) => {
                if (btn) btn.addEventListener('click', () => this.openComposer());
            });

            if (this.nodes.modalClose) this.nodes.modalClose.addEventListener('click', () => this.closeComposer());
            if (this.nodes.modalCancel) this.nodes.modalCancel.addEventListener('click', () => this.closeComposer());
            if (this.nodes.modal) {
                this.nodes.modal.addEventListener('click', (event) => {
                    if (event.target === this.nodes.modal) this.closeComposer();
                });
            }

            if (this.nodes.form) {
                this.nodes.form.addEventListener('submit', (event) => this.handleSubmit(event));
            }

            if (this.nodes.caption) {
                this.nodes.caption.addEventListener('input', () => this.updateCaptionCount());
            }

            if (this.nodes.dropzone && this.nodes.fileInput) {
                this.nodes.dropzone.addEventListener('click', () => this.nodes.fileInput.click());
                this.nodes.dropzone.addEventListener('dragover', (event) => {
                    event.preventDefault();
                    this.nodes.dropzone.classList.add('dragover');
                });
                this.nodes.dropzone.addEventListener('dragleave', () => {
                    this.nodes.dropzone.classList.remove('dragover');
                });
                this.nodes.dropzone.addEventListener('drop', (event) => {
                    event.preventDefault();
                    this.nodes.dropzone.classList.remove('dragover');
                    this.addFiles(event.dataTransfer?.files);
                });
                this.nodes.fileInput.addEventListener('change', () => {
                    this.addFiles(this.nodes.fileInput.files);
                    this.nodes.fileInput.value = ''; // allow re-picking the same file
                });
            }

            if (this.nodes.backBtn) {
                this.nodes.backBtn.addEventListener('click', () => this.showList());
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

        // ============================================================
        // Data
        // ============================================================

        async refresh() {
            try {
                this.payments = await global.dataService.getOwnFeePayments();
                // One token covers every thumbnail on the page — receipts are
                // protected files, and minting a token per image would mean a
                // round trip per thumbnail.
                this.fileToken = await global.dataService.getFeeFileToken() || '';
            } catch (error) {
                console.error('[studentFees] refresh failed:', error);
                this.payments = [];
                this.renderError(this.friendlyError(error, 'Could not load your payments.'));
                return;
            }

            this.renderStats();
            if (this.viewMode === 'detail' && this.currentId) {
                this.renderDetail();
            } else {
                this.renderList();
            }
        },

        renderStats() {
            const pending = this.payments.filter((p) => p.status === 'pending').length;
            const confirmed = this.payments.filter((p) => p.status === 'confirmed').length;
            if (this.nodes.statPending) this.nodes.statPending.textContent = String(pending);
            if (this.nodes.statConfirmed) this.nodes.statConfirmed.textContent = String(confirmed);
            if (this.nodes.statTotal) this.nodes.statTotal.textContent = String(this.payments.length);
        },

        // ============================================================
        // List
        // ============================================================

        renderList() {
            const list = this.nodes.list;
            if (!list) return;

            if (this.nodes.listMeta) {
                const n = this.payments.length;
                this.nodes.listMeta.textContent = n + (n === 1 ? ' submission' : ' submissions');
            }

            if (!this.payments.length) {
                list.innerHTML = this.emptyState();
                const btn = document.getElementById('fee-open-composer-empty');
                if (btn) btn.addEventListener('click', () => this.openComposer());
                return;
            }

            list.innerHTML = this.payments.map((payment) => this.rowHtml(payment)).join('');
            list.querySelectorAll('[data-payment-id]').forEach((row) => {
                row.addEventListener('click', () => this.showDetail(row.getAttribute('data-payment-id')));
            });
        },

        rowHtml(payment) {
            const thumb = this.thumbHtml(payment);
            const amount = payment.amount !== null
                ? '<span class="fee-row-amount">' + this.formatAmount(payment.amount) + '</span>'
                : '';

            return '' +
                '<div class="fee-row" data-payment-id="' + this.escape(payment.id) + '" role="button" tabindex="0">' +
                    thumb +
                    '<div class="fee-row-body">' +
                        '<div class="fee-row-top">' +
                            '<p class="fee-row-name">' + this.escape(payment.purposeLabel) + '</p>' +
                            this.statusPill(payment.status) +
                        '</div>' +
                        '<p class="fee-row-caption">' + this.escape(payment.caption) + '</p>' +
                        '<div class="fee-row-meta">' +
                            '<span>' + this.formatDate(payment.createdAt) + '</span>' +
                            (amount ? '<span class="fee-row-meta-dot">&middot;</span>' + amount : '') +
                            (payment.term ? '<span class="fee-row-meta-dot">&middot;</span><span>' + this.escape(payment.term) + '</span>' : '') +
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
            return '' +
                '<div class="fee-empty">' +
                    '<span class="fee-empty-icon">' +
                        '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>' +
                    '</span>' +
                    '<p class="fee-empty-title">No payments submitted yet</p>' +
                    '<p class="fee-empty-text">When you pay school fees, upload a photo of the receipt here and the school will confirm it.</p>' +
                    '<button type="button" class="fee-btn primary" id="fee-open-composer-empty" style="margin-top:18px;">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
                        'Submit a payment' +
                    '</button>' +
                '</div>';
        },

        renderError(message) {
            if (!this.nodes.list) return;
            this.nodes.list.innerHTML = '' +
                '<div class="fee-empty">' +
                    '<p class="fee-empty-title">Could not load your payments</p>' +
                    '<p class="fee-empty-text">' + this.escape(message) + '</p>' +
                '</div>';
        },

        // ============================================================
        // Detail
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
            const payment = this.payments.find((p) => p.id === this.currentId);
            const host = this.nodes.detail;
            if (!host) return;
            if (!payment) {
                this.showList();
                return;
            }

            const notice = this.noticeHtml(payment);
            const receipts = payment.receipts.map((filename, index) => {
                const url = global.dataService.getFeeReceiptUrl(payment, filename, {
                    thumb: '400x0',
                    token: this.fileToken
                });
                return '<button type="button" class="fee-receipt" data-receipt-index="' + index + '">' +
                    '<img src="' + this.escape(url) + '" alt="Receipt ' + (index + 1) + '" loading="lazy">' +
                '</button>';
            }).join('');

            const canWithdraw = payment.status === 'pending';

            host.innerHTML = '' +
                notice +
                '<div class="fee-detail-head">' +
                    '<div>' +
                        '<h2 class="fee-detail-title">' + this.escape(payment.purposeLabel) + '</h2>' +
                        '<p class="fee-detail-sub">Submitted ' + this.formatDateTime(payment.createdAt) + '</p>' +
                    '</div>' +
                    this.statusPill(payment.status) +
                '</div>' +

                '<div class="fee-detail-grid">' +
                    this.field('Amount', payment.amount !== null ? this.formatAmount(payment.amount) : 'Not stated') +
                    this.field('Term', payment.term || 'Not stated') +
                    this.field('Session', payment.session || 'Not stated') +
                    this.field('Receipts', String(payment.receipts.length)) +
                '</div>' +

                '<p class="fee-detail-caption">' + this.escape(payment.caption) + '</p>' +

                '<section class="fee-section">' +
                    '<div class="fee-section-head">' +
                        '<div>' +
                            '<span class="fee-section-eyebrow">Evidence</span>' +
                            '<h3 class="fee-section-title">Receipt images</h3>' +
                        '</div>' +
                        '<span class="fee-section-meta">Tap to enlarge</span>' +
                    '</div>' +
                    '<div class="fee-receipts">' + receipts + '</div>' +
                '</section>' +

                (canWithdraw
                    ? '<div style="margin-top:28px;">' +
                        '<button type="button" class="ghost-cta danger" id="fee-withdraw-btn">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                            'Withdraw this submission' +
                        '</button>' +
                        '<p class="fee-empty-text" style="margin:6px 0 0; text-align:left; max-width:460px; font-size:0.8rem;">' +
                            'You can only withdraw while the school has not reviewed it yet.' +
                        '</p>' +
                    '</div>'
                    : '');

            host.querySelectorAll('[data-receipt-index]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.openLightbox(payment, Number(btn.getAttribute('data-receipt-index')));
                });
            });

            const withdraw = document.getElementById('fee-withdraw-btn');
            if (withdraw) withdraw.addEventListener('click', () => this.handleWithdraw(payment));
        },

        noticeHtml(payment) {
            if (payment.status === 'confirmed') {
                return '' +
                    '<div class="fee-notice confirmed">' +
                        '<span class="fee-notice-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></span>' +
                        '<div>' +
                            '<p class="fee-notice-title">Payment confirmed</p>' +
                            '<p class="fee-notice-text">' +
                                'Confirmed by ' + this.escape(payment.reviewedByName || 'the school') +
                                (payment.reviewedAt ? ' on ' + this.formatDateTime(payment.reviewedAt) : '') + '.' +
                                (payment.adminNote ? '<br>' + this.escape(payment.adminNote) : '') +
                            '</p>' +
                        '</div>' +
                    '</div>';
            }
            if (payment.status === 'rejected') {
                return '' +
                    '<div class="fee-notice rejected">' +
                        '<span class="fee-notice-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span>' +
                        '<div>' +
                            '<p class="fee-notice-title">Not accepted</p>' +
                            '<p class="fee-notice-text">' +
                                (payment.adminNote
                                    ? this.escape(payment.adminNote)
                                    : 'The school could not accept this receipt.') +
                                ' Please submit a clearer receipt or speak to the school office.' +
                            '</p>' +
                        '</div>' +
                    '</div>';
            }
            return '' +
                '<div class="fee-notice">' +
                    '<span class="fee-notice-icon" style="color:var(--text-secondary);"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>' +
                    '<div>' +
                        '<p class="fee-notice-title">Waiting for the school to confirm</p>' +
                        '<p class="fee-notice-text">The school office will review this receipt. You will see the result on this page.</p>' +
                    '</div>' +
                '</div>';
        },

        field(label, value) {
            return '' +
                '<div class="fee-detail-field">' +
                    '<span class="fee-detail-label">' + this.escape(label) + '</span>' +
                    '<span class="fee-detail-value">' + this.escape(value) + '</span>' +
                '</div>';
        },

        async handleWithdraw(payment) {
            const ok = await this.askConfirm(
                'Withdraw submission?',
                'This removes the receipt you sent for ' + this.escape(payment.purposeLabel) + '. You can submit it again afterwards.'
            );
            if (!ok) return;

            try {
                await global.dataService.deleteFeePayment(payment.id);
                this.showList();
                await this.refresh();
            } catch (error) {
                this.notify('Could not withdraw', this.escape(this.friendlyError(error, 'The submission could not be withdrawn.')));
            }
        },

        // ============================================================
        // Composer
        // ============================================================

        openComposer() {
            this.clearFiles();
            if (this.nodes.form) this.nodes.form.reset();
            this.updateCaptionCount();
            this.setStatus('', '');
            if (this.nodes.modal) this.nodes.modal.classList.add('open');
            if (this.nodes.purpose) this.nodes.purpose.focus();
        },

        closeComposer() {
            if (this.nodes.modal) this.nodes.modal.classList.remove('open');
            this.clearFiles();
        },

        updateCaptionCount() {
            const value = this.nodes.caption?.value || '';
            if (!this.nodes.captionCount) return;
            this.nodes.captionCount.textContent = value.length + ' / ' + MAX_CAPTION;
            this.nodes.captionCount.classList.toggle('over', value.length > MAX_CAPTION);
        },

        async addFiles(fileList) {
            const incoming = Array.from(fileList || []);
            if (!incoming.length) return;

            const max = global.dataService.FEES_MAX_RECEIPTS || 5;
            const room = max - this.pendingFiles.length;
            if (room <= 0) {
                this.setStatus('You can attach at most ' + max + ' images.', 'error');
                return;
            }
            if (incoming.length > room) {
                this.setStatus('Only ' + room + ' more image' + (room === 1 ? '' : 's') + ' can be added.', 'error');
                return;
            }

            this.setStatus('Preparing images…', 'info');
            try {
                for (const file of incoming) {
                    // Downscale + re-encode on the device. A 4MB phone photo
                    // leaves as roughly 250KB.
                    const prepared = await global.imageUpload.prepare(file);
                    this.pendingFiles.push(prepared);
                }
                this.setStatus('', '');
            } catch (error) {
                this.setStatus(error.message || 'That image could not be used.', 'error');
            }
            this.renderPreviews();
        },

        renderPreviews() {
            const host = this.nodes.previews;
            if (!host) return;

            this.previewUrls.forEach((url) => URL.revokeObjectURL(url));
            this.previewUrls = [];

            host.innerHTML = this.pendingFiles.map((file, index) => {
                const url = URL.createObjectURL(file);
                this.previewUrls.push(url);
                return '' +
                    '<div class="fee-preview">' +
                        '<img src="' + url + '" alt="Receipt preview ' + (index + 1) + '">' +
                        '<button type="button" class="fee-preview-remove" data-remove-index="' + index + '" aria-label="Remove image">&times;</button>' +
                        '<span class="fee-preview-size">' + global.imageUpload.formatBytes(file.size) + '</span>' +
                    '</div>';
            }).join('');

            host.querySelectorAll('[data-remove-index]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    this.pendingFiles.splice(Number(btn.getAttribute('data-remove-index')), 1);
                    this.renderPreviews();
                });
            });
        },

        clearFiles() {
            this.previewUrls.forEach((url) => URL.revokeObjectURL(url));
            this.previewUrls = [];
            this.pendingFiles = [];
            if (this.nodes.previews) this.nodes.previews.innerHTML = '';
        },

        async handleSubmit(event) {
            event.preventDefault();
            if (this.submitting) return;

            const caption = (this.nodes.caption?.value || '').trim();
            if (caption.length > MAX_CAPTION) {
                this.setStatus('Your note is too long. Keep it under ' + MAX_CAPTION + ' characters.', 'error');
                return;
            }
            if (!this.pendingFiles.length) {
                this.setStatus('Attach at least one photo of the receipt.', 'error');
                return;
            }

            this.submitting = true;
            if (this.nodes.submitBtn) this.nodes.submitBtn.disabled = true;
            this.setStatus('Uploading…', 'info');

            try {
                await global.dataService.submitFeePayment({
                    purpose: this.nodes.purpose?.value || '',
                    caption,
                    amount: this.nodes.amount?.value || '',
                    term: global.Utils?.getCurrentTerm?.() || '',
                    session: global.Utils?.getCurrentSession?.() || '',
                    files: this.pendingFiles
                });
                this.closeComposer();
                await this.refresh();
                this.notify('Receipt submitted', 'The school office will review it and you will see the result on this page.');
            } catch (error) {
                this.setStatus(this.friendlyError(error, 'The receipt could not be submitted.'), 'error');
            } finally {
                this.submitting = false;
                if (this.nodes.submitBtn) this.nodes.submitBtn.disabled = false;
            }
        },

        setStatus(message, kind) {
            const node = this.nodes.statusMsg;
            if (!node) return;
            node.textContent = message || '';
            node.className = 'fee-status-msg' + (kind ? ' ' + kind : '');
        },

        // ============================================================
        // Lightbox
        // ============================================================

        openLightbox(payment, index) {
            this.lightbox = {
                payment,
                files: payment.receipts,
                index: index || 0
            };
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
            // Full size here — this is the one place the original is warranted,
            // because an admin (or parent) may need to read the teller's writing.
            const url = global.dataService.getFeeReceiptUrl(payment, files[index], { token: this.fileToken });
            this.nodes.lightboxImg.src = url;
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
                    label: 'Not accepted',
                    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
                }
            };
            const item = map[status] || map.pending;
            return '<span class="fee-pill ' + status + '">' + item.icon + item.label + '</span>';
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
            if (/no school assigned/i.test(message)) {
                return 'Your account has no school assigned yet. Ask the school office to set your School ID.';
            }
            if (/auth|login|unauthor|forbid/i.test(message)) {
                return 'You need to be signed in to do that.';
            }
            if (/network|fetch|connect|offline/i.test(message)) {
                return 'Network error. Receipt uploads need an internet connection — try again when you are back online.';
            }
            if (/collection.*fee_payments/i.test(message) || /not\s*found.*collection/i.test(message)) {
                return 'The fees collection is missing on the server. Run the fees migration on PocketBase.';
            }
            return message || fallback;
        }
    };

    global.studentFees = studentFees;
})(typeof globalThis !== 'undefined' ? globalThis : window);
