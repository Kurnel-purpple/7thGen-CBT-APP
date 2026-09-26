/**
 * Fees Data Service
 * Extends window.dataService with fee-payment functionality.
 * Persists to the PocketBase collection: fee_payments.
 * Must be loaded AFTER dataService.js (and after imageUpload.js for submits).
 *
 * TWO THINGS WORTH KNOWING BEFORE EDITING THIS FILE
 *
 * 1. Receipts go up as real files in a multipart FormData body, NOT as base64
 *    data URLs. This is the first place in the app that does that; everywhere
 *    else (exam images, report-card logo) still inlines base64 into text
 *    columns, which is what made the bandwidth bill. Keep it that way here.
 *
 * 2. The `receipts` field is `protected: true` on the collection, so its URLs
 *    are not world-readable — each one needs a short-lived file token. That
 *    token is fetched once and cached (see _fileToken below) instead of being
 *    requested per image, which would mean 40 extra round trips to render a
 *    queue of 40 receipts.
 */

(function (ds) {
    if (!ds) {
        console.error('[feesDataService] window.dataService not found — load dataService.js first');
        return;
    }

    const FEES = 'fee_payments';

    // Max receipt images per submission. Mirrored in the collection schema
    // (maxSelect: 5) — the server is the one that actually enforces it.
    const MAX_RECEIPTS = 5;

    const PURPOSE_LABELS = {
        school_fees: 'School Fees',
        pta: 'PTA Levy',
        uniform: 'Uniform',
        exam_fee: 'Exam Fee',
        books: 'Books',
        transport: 'Transport',
        other: 'Other'
    };

    function ownerId(user) {
        return user?.id || user?.user || null;
    }

    function isNotFound(error) {
        const status = error?.status ?? error?.statusCode;
        const message = String(error?.message || '').toLowerCase();
        return status === 404 || message.includes('404') || message.includes('not found');
    }

    ds.FEES_MAX_RECEIPTS = MAX_RECEIPTS;
    ds.FEES_PURPOSE_LABELS = PURPOSE_LABELS;

    ds._mapFeePayment = function (record) {
        if (!record) return null;
        const files = Array.isArray(record.receipts)
            ? record.receipts
            : (record.receipts ? [record.receipts] : []);
        return {
            id: record.id,
            studentId: record.student || '',
            studentName: record.student_name || '',
            classLevel: record.class_level || '',
            purpose: record.purpose || 'other',
            purposeLabel: PURPOSE_LABELS[record.purpose] || 'Other',
            caption: record.caption || '',
            amount: record.amount === null || record.amount === undefined || record.amount === ''
                ? null
                : Number(record.amount),
            term: record.term || '',
            session: record.session || '',
            receipts: files,
            status: record.status || 'pending',
            adminNote: record.admin_note || '',
            reviewedBy: record.reviewed_by || '',
            reviewedByName: record.reviewed_by_name || '',
            reviewedAt: record.reviewed_at || null,
            schoolVersion: record.school_version || '',
            clientId: record.client_id || '',
            createdAt: record.created,
            updatedAt: record.updated,
            // Kept so file URLs can be rebuilt without re-fetching the record.
            _fileRef: {
                id: record.id,
                collectionId: record.collectionId,
                collectionName: record.collectionName || FEES
            }
        };
    };

    // ================================================================
    // Protected-file access
    // ================================================================

    ds._feeFileToken = null;
    ds._feeFileTokenAt = 0;

    /**
     * PocketBase file tokens are short-lived (a couple of minutes). Cache one
     * for 90s so a queue render costs a single token request rather than one
     * per thumbnail.
     */
    ds.getFeeFileToken = async function () {
        const age = Date.now() - (this._feeFileTokenAt || 0);
        if (this._feeFileToken && age < 90 * 1000) return this._feeFileToken;
        try {
            const token = await this.pb.files.getToken();
            this._feeFileToken = token;
            this._feeFileTokenAt = Date.now();
            return token;
        } catch (error) {
            console.warn('[Fees] could not mint a file token:', error?.message || error);
            return null;
        }
    };

    /**
     * Build a viewable URL for one receipt image.
     * Always pass a `thumb` in list views — the originals are full-size phone
     * photos and pulling 40 of them to draw a queue is exactly the mistake this
     * module exists to avoid.
     */
    ds.getFeeReceiptUrl = function (payment, filename, { thumb = '', token = '' } = {}) {
        if (!payment || !filename) return '';
        const ref = payment._fileRef || payment;
        const options = {};
        if (thumb) options.thumb = thumb;
        if (token) options.token = token;
        try {
            return this.pb.files.getUrl(ref, filename, options);
        } catch (error) {
            if (typeof this.pb.getFileUrl === 'function') {
                return this.pb.getFileUrl(ref, filename, options);
            }
            return '';
        }
    };

    // ================================================================
    // Submitting
    // ================================================================

    /**
     * Submit a payment receipt.
     *
     * `files` must already be prepared (downscaled/re-encoded) by
     * window.imageUpload.prepareMany — this method does not compress, it only
     * validates the count and posts.
     *
     * `student` and `status` ARE sent, even though fees_guard.pb.js overwrites
     * both. PocketBase validates the submitted form BEFORE the before-create
     * hook runs, so a `required: true` field the client omits fails validation
     * with a 400 and the hook never executes. Both are required on the
     * collection, so both must be in the payload.
     *
     * This costs nothing in safety: the hook pins `student` to the authenticated
     * caller and forces `status` back to "pending", so a client that sends
     * someone else's id or status="confirmed" gets neither. The values below are
     * there to satisfy the validator, not to be trusted.
     *
     * student_name, class_level and school_version are optional on the
     * collection, so those really are left to the hook.
     */
    ds.submitFeePayment = async function (payload = {}) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to submit a receipt.');

        const purpose = String(payload.purpose || '').trim();
        const caption = String(payload.caption || '').trim();
        const files = Array.isArray(payload.files) ? payload.files : [];

        if (!purpose || !PURPOSE_LABELS[purpose]) throw new Error('Choose what the payment was for.');
        if (!caption) throw new Error('Add a short note telling the school what this payment covers.');
        if (!files.length) throw new Error('Attach at least one photo of the receipt.');
        if (files.length > MAX_RECEIPTS) {
            throw new Error('You can attach at most ' + MAX_RECEIPTS + ' receipt images.');
        }

        const school = this.getSchoolContext();
        const form = new FormData();
        form.append('purpose', purpose);
        form.append('caption', caption);
        // Required on the collection — see the note above. Both are replaced by
        // the hook with server-resolved values.
        form.append('student', ownerId(user) || '');
        form.append('status', 'pending');
        if (payload.amount !== undefined && payload.amount !== null && payload.amount !== '') {
            form.append('amount', String(Number(payload.amount)));
        }
        form.append('term', String(payload.term || ''));
        form.append('session', String(payload.session || ''));
        form.append('client_id', school.clientId || '');
        files.forEach((file) => form.append('receipts', file));

        const created = await this.pb.collection(FEES).create(form);
        return ds._mapFeePayment(created);
    };

    // ================================================================
    // Reading
    // ================================================================

    /**
     * The signed-in user's own submissions, newest first.
     * The collection rules already restrict a student to their own rows; the
     * explicit filter keeps the intent visible at the call site and keeps the
     * query cheap on the index.
     */
    ds.getOwnFeePayments = async function () {
        const user = this.getCurrentUser();
        if (!user) return [];
        try {
            const filter = this.pb.filter('student = {:uid}', { uid: ownerId(user) });
            const records = await this.pb.collection(FEES).getFullList({
                filter,
                sort: '-created'
            });
            return records.map(ds._mapFeePayment);
        } catch (error) {
            if (isNotFound(error)) return [];
            console.error('[Fees] getOwnFeePayments error:', error);
            throw error;
        }
    };

    /**
     * The admin review queue for the caller's school.
     *
     * Paged rather than getFullList: a school running this for a few terms will
     * accumulate thousands of receipts, and the queue only ever shows a screenful.
     * Returns { items, page, totalPages, totalItems }.
     */
    ds.getSchoolFeePayments = async function ({
        status = '',
        classLevel = '',
        term = '',
        search = '',
        page = 1,
        perPage = 30
    } = {}) {
        const school = this.getSchoolContext();
        const clauses = [];
        const params = {};

        if (school.schoolVersion) {
            clauses.push('school_version = {:sv}');
            params.sv = school.schoolVersion;
        }
        if (status) {
            clauses.push('status = {:st}');
            params.st = status;
        }
        if (classLevel) {
            clauses.push('class_level = {:cls}');
            params.cls = classLevel;
        }
        if (term) {
            clauses.push('term = {:trm}');
            params.trm = term;
        }
        if (search) {
            clauses.push('(student_name ~ {:q} || caption ~ {:q})');
            params.q = search;
        }

        const filter = clauses.length ? this.pb.filter(clauses.join(' && '), params) : '';
        try {
            const result = await this.pb.collection(FEES).getList(page, perPage, {
                filter,
                // Newest first within whichever status tab is selected — the
                // queue opens on Pending, so "work to do" is already the default
                // view without needing a status term in the sort.
                sort: '-created'
            });
            return {
                items: result.items.map(ds._mapFeePayment),
                page: result.page,
                perPage: result.perPage,
                totalPages: result.totalPages,
                totalItems: result.totalItems
            };
        } catch (error) {
            if (isNotFound(error)) {
                return { items: [], page: 1, perPage, totalPages: 0, totalItems: 0 };
            }
            console.error('[Fees] getSchoolFeePayments error:', error);
            throw error;
        }
    };

    /**
     * Counts per status for the caller's school, for the queue's filter tabs.
     * Uses perPage:1 and reads totalItems — PocketBase has no count endpoint,
     * and this asks the server for one row instead of pulling the collection
     * down to length it client-side.
     */
    ds.getFeePaymentCounts = async function () {
        const school = this.getSchoolContext();
        const statuses = ['pending', 'confirmed', 'rejected'];
        const counts = { pending: 0, confirmed: 0, rejected: 0, total: 0 };

        await Promise.all(statuses.map(async (status) => {
            const clauses = ['status = {:st}'];
            const params = { st: status };
            if (school.schoolVersion) {
                clauses.push('school_version = {:sv}');
                params.sv = school.schoolVersion;
            }
            try {
                const result = await this.pb.collection(FEES).getList(1, 1, {
                    filter: this.pb.filter(clauses.join(' && '), params)
                });
                counts[status] = result.totalItems;
            } catch (error) {
                if (!isNotFound(error)) {
                    console.warn('[Fees] count for ' + status + ' failed:', error?.message || error);
                }
            }
        }));

        counts.total = counts.pending + counts.confirmed + counts.rejected;
        return counts;
    };

    // ================================================================
    // Reviewing (admin only — enforced by the collection rule AND the hook)
    // ================================================================

    /**
     * Confirm or reject a submission.
     * Only `status` and `admin_note` are sent because only those two are
     * writable: fees_guard.pb.js restores every other field from the stored row
     * on update, and stamps reviewed_by / reviewed_at from the server.
     */
    ds.reviewFeePayment = async function (paymentId, { status, adminNote = '' } = {}) {
        if (!paymentId) throw new Error('Payment id is required.');
        if (!['pending', 'confirmed', 'rejected'].includes(status)) {
            throw new Error('Unknown payment status.');
        }
        if (status === 'rejected' && !String(adminNote || '').trim()) {
            // A rejection with no reason leaves the parent with nothing to act
            // on, which is the failure mode this module is meant to prevent.
            throw new Error('Give a reason when rejecting a payment.');
        }

        const updated = await this.pb.collection(FEES).update(paymentId, {
            status,
            admin_note: String(adminNote || '').trim()
        });
        return ds._mapFeePayment(updated);
    };

    /**
     * Delete a submission.
     * The rule allows an admin to delete anything in their school, and a student
     * to delete only their own row while it is still pending.
     */
    ds.deleteFeePayment = async function (paymentId) {
        if (!paymentId) throw new Error('Payment id is required.');
        await this.pb.collection(FEES).delete(paymentId);
        return true;
    };

})(window.dataService);
