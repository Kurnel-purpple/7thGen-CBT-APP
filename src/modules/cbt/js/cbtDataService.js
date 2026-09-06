/**
 * CBT Data Service — Exam & Result methods
 * Extends window.dataService with CBT-specific functionality.
 * Must be loaded AFTER dataService.js
 */

(function(ds) {
    if (!ds) { console.error('[cbtDataService] window.dataService not found — load dataService.js first'); return; }

    // Perf instrumentation (mirrors core)
    const _perf = {
        enabled: () => localStorage.getItem('debug_perf') === '1',
        start: (label) => {
            if (!_perf.enabled()) return null;
            return { label, t0: performance.now() };
        },
        end: (ctx, extra = {}) => {
            if (!ctx) return;
            const ms = (performance.now() - ctx.t0).toFixed(1);
            const parts = [`[PERF] ${ctx.label}: ${ms}ms`];
            if (extra.source) parts.push(`source=${extra.source}`);
            if (extra.count !== undefined) parts.push(`count=${extra.count}`);
            if (extra.size !== undefined) parts.push(`size=${(extra.size / 1024).toFixed(1)}KB`);
            console.log(parts.join(' | '));
        }
    };

    // --- Exam Availability ---

    ds.resolveExamAvailability = function(exam) {
        // A. Invalid exam
        if (!exam || !exam.id) {
            return { available: false, reason: 'invalid', trustedNow: null, scheduledAt: null };
        }

        // B. Inactive exam (archived/draft)
        if (exam.status === 'archived' || exam.status === 'draft') {
            return { available: false, reason: 'inactive', trustedNow: this.getTrustedNow(), scheduledAt: null };
        }

        // B2. Admin-locked exam (still 'active' in PB but locked by admin)
        if (exam.extensions && exam.extensions._adminLocked) {
            return { available: false, reason: 'admin_locked', trustedNow: this.getTrustedNow(), scheduledAt: null };
        }

        // C. No schedule — always available immediately
        if (!exam.scheduledDate) {
            return { available: true, reason: 'unscheduled', trustedNow: this.getTrustedNow(), scheduledAt: null };
        }

        // D/E. Has scheduled date — need trusted time
        const scheduledAt = new Date(exam.scheduledDate);
        if (isNaN(scheduledAt.getTime())) {
            // Malformed date — treat as unscheduled (available)
            return { available: true, reason: 'unscheduled', trustedNow: this.getTrustedNow(), scheduledAt: null };
        }

        const trustedNow = this.getTrustedNow();

        // D. Trusted time available — compare
        if (trustedNow) {
            if (trustedNow >= scheduledAt) {
                return { available: true, reason: 'scheduled_reached', trustedNow, scheduledAt };
            }
            return { available: false, reason: 'scheduled_future', trustedNow, scheduledAt };
        }

        // E. No trusted time — LOCK scheduled exams (prevent device-clock spoofing)
        console.warn('[Schedule] Exam locked: no trusted time for scheduled exam', exam.id);
        return { available: false, reason: 'no_trusted_time_future_locked', trustedNow: null, scheduledAt };
    };

    // --- Exam Subscriptions ---

    ds.subscribeToExams = async function(callback) {
        try {
            return await this.pb.collection('exams').subscribe('*', (e) => {
                callback(e);
            });
        } catch (error) {
            console.error('Exam subscription error:', error);
            throw error;
        }
    };

    ds.unsubscribeFromExams = async function() {
        try {
            await this.pb.collection('exams').unsubscribe('*');
        } catch (error) {
            console.error('Exam unsubscribe error:', error);
        }
    };

    // --- Exams ---

    ds.getExams = async function(filters = {}) {
        // Exclude forceRefresh from cache key so we update the same cache entry
        const { forceRefresh, ...cacheFilters } = filters;
        const cacheKey = `exams_${JSON.stringify(cacheFilters)}`;

        // 1. Try IDB Cache first (max 3 minutes before refetching)
        const CACHE_MAX_AGE = 3 * 60 * 1000; // 3 minutes
        if (window.idb && !forceRefresh) {
            try {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached && cached.data && cached.data.length > 0) {
                    const age = Date.now() - (cached.cachedAt || 0);
                    if (age < CACHE_MAX_AGE && this._examDataComplete(cached.data)) {
                        console.log(`📦 Serving exams from IDB cache (${Math.round(age / 1000)}s old)`);
                        return cached.data;
                    }
                    console.log(`🔄 Cache expired (${Math.round(age / 1000)}s old), fetching fresh data...`);
                }
            } catch (e) {
                console.warn('IDB Cache read error:', e);
            }
        }

        try {
            let filterString = '';

            if (filters.status) {
                filterString += `status="${filters.status}"`;
            }

            // Always exclude soft-deleted exams (archived with _deleted flag)
            if (!filters.includeDeleted) {
                if (filterString) filterString += ' && ';
                filterString += 'status!="archived"';
            }

            if (filters.teacherId) {
                if (filterString) filterString += ' && ';

                // For better compatibility with migrated data:
                // Search by User ID (preferred), or try to match current username/email
                // as some legacy records might use them instead of the UUID.
                let teacherFilter = `created_by="${filters.teacherId}"`;

                const currentUser = this.getCurrentUser();
                if (currentUser && currentUser.id === filters.teacherId) {
                    teacherFilter = `(created_by="${filters.teacherId}" || created_by="${currentUser.username}" || created_by="${currentUser.email}")`;
                }

                filterString += teacherFilter;
            }

            if (filters.targetClass) {
                if (filterString) filterString += ' && ';
                filterString += `(target_class="${filters.targetClass}" || target_class="All")`;
            }

            const options = {
                filter: filterString,
                sort: '-created'
            };

            if (filters.studentDashboard) {
                options.perPage = 50;
            }

            const exams = await this.pb.collection('exams').getFullList(options);
            const mappedData = exams.map(e => this._mapExam(e));

            // 2. Save to IDB (only if we got data — never overwrite good cache with empty)
            if (window.idb && mappedData.length > 0) {
                await window.idb.saveDashboardCache(cacheKey, mappedData);
                await window.idb.saveExams(mappedData);
            }

            return mappedData;
        } catch (error) {
            // Fallback to cache even if empty/old on network error
            if (window.idb) {
                try {
                    const cached = await window.idb.getDashboardCache(cacheKey);
                    if (cached) return cached.data;
                } catch (e) { /* ignore */ }
            }
            throw error;
        }
    };

    ds.getExamSummaries = async function(filters = {}) {
        const _p = _perf.start('getExamSummaries');
        const { forceRefresh, ...cacheFilters } = filters;
        const cacheKey = `examSummaries_${JSON.stringify(cacheFilters)}`;

        const CACHE_MAX_AGE = 2 * 60 * 1000; // 2 minutes — short TTL so schedule changes propagate quickly
        if (window.idb && !forceRefresh) {
            try {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached && cached.data && cached.data.length > 0) {
                    const age = Date.now() - (cached.cachedAt || 0);
                    if (age < CACHE_MAX_AGE) {
                        console.log(`📦 Serving exam summaries from cache (${Math.round(age / 1000)}s old)`);
                        _perf.end(_p, { source: 'cache', count: cached.data.length });
                        return cached.data;
                    }
                }
            } catch (e) {
                console.warn('IDB Cache read error:', e);
            }
        }

        try {
            let filterString = '';

            if (filters.status) {
                filterString += `status="${filters.status}"`;
            }

            if (!filters.includeDeleted) {
                if (filterString) filterString += ' && ';
                filterString += 'status!="archived"';
            }

            if (filters.teacherId) {
                if (filterString) filterString += ' && ';
                let teacherFilter = `created_by="${filters.teacherId}"`;
                const currentUser = this.getCurrentUser();
                if (currentUser && currentUser.id === filters.teacherId) {
                    teacherFilter = `(created_by="${filters.teacherId}" || created_by="${currentUser.username}" || created_by="${currentUser.email}")`;
                }
                filterString += teacherFilter;
            }

            if (filters.targetClass) {
                if (filterString) filterString += ' && ';
                filterString += `(target_class="${filters.targetClass}" || target_class="All")`;
            }

            const options = {
                filter: filterString,
                sort: '-created',
                fields: 'id,title,subject,target_class,duration,pass_score,status,created_by,created,updated,scheduled_date,scramble_questions,question_count,has_theory,theory_count,extensions,global_extension,school_level,theory_instructions,content_updated',
                fullList: true
            };

            if (filters.studentDashboard) {
                options.perPage = 50;
            }

            const exams = await this._rawList('exams', options);
            const mappedData = exams.map(e => this._mapExamSummary(e));

            if (window.idb && mappedData.length > 0) {
                await window.idb.saveDashboardCache(cacheKey, mappedData);
            }

            _perf.end(_p, { source: 'network', count: mappedData.length, size: JSON.stringify(mappedData).length });
            return mappedData;
        } catch (error) {
            if (window.idb) {
                try {
                    const cached = await window.idb.getDashboardCache(cacheKey);
                    if (cached) return cached.data;
                } catch (e) { /* ignore */ }
            }
            throw error;
        }
    };

    // Every exam field EXCEPT the heavy `questions` JSON (which embeds base64
    // images and dominates the record size). Used to refresh metadata
    // (extensions, status, schedule) without re-downloading the content.
    const EXAM_LIGHT_FIELDS = 'id,title,subject,target_class,duration,pass_score,instructions,status,created_by,created,updated,scheduled_date,scramble_questions,question_count,has_theory,theory_count,extensions,global_extension,school_level,theory_instructions,content_updated';

    ds.getExamById = async function(id, summaryUpdatedAt) {
        const _p = _perf.start('getExamById');
        // 1. Try IDB first with freshness check
        let cachedExam = null;
        if (window.idb) {
            try {
                cachedExam = await window.idb.getExam(id);
                if (cachedExam && (!Array.isArray(cachedExam.questions) || cachedExam.questions.length === 0)) {
                    // Reject summaries that leaked into the exams store (questions is null/missing)
                    console.warn(`⚠️ Exam ${id} in IDB has no questions (likely a summary), skipping cache`);
                    // Clean up the polluted entry
                    try { await window.idb.deleteExam(id); } catch (_) { /* best effort cleanup */ }
                    cachedExam = null;
                }
            } catch (e) { console.warn(e); }
        }

        if (cachedExam) {
            if (summaryUpdatedAt && cachedExam.updatedAt === summaryUpdatedAt) {
                // Record unchanged since the summary was fetched
                console.log(`📦 Serving exam ${id} from IDB (fresh)`);
                _perf.end(_p, { source: 'cache-fresh' });
                return cachedExam;
            }
            if (!summaryUpdatedAt) {
                // No summary to compare — serve cached as before
                console.log(`📦 Serving exam ${id} from IDB`);
                _perf.end(_p, { source: 'cache' });
                return cachedExam;
            }

            // Record changed since our copy — but "changed" is usually an
            // extension grant / status toggle, not a question edit. Fetch the
            // light metadata (a few KB) and keep the cached questions when the
            // content marker proves them still valid.
            try {
                const meta = await this.pb.collection('exams').getOne(id, { fields: EXAM_LIGHT_FIELDS });
                if (meta.content_updated && cachedExam.contentUpdated &&
                    meta.content_updated === cachedExam.contentUpdated) {
                    // _mapExam (not _mapExamSummary) so light fields like
                    // `instructions` survive the merge; questions come from cache
                    const merged = { ...this._mapExam(meta), questions: cachedExam.questions };
                    if (window.idb) {
                        await window.idb.saveExam(merged);
                    }
                    console.log(`📦 Exam ${id}: metadata refreshed, questions served from IDB`);
                    _perf.end(_p, { source: 'cache+meta' });
                    return merged;
                }
                console.log(`🔄 Exam ${id} content changed, fetching full exam...`);
            } catch (e) {
                console.warn(`Light exam fetch failed for ${id}:`, e.message);
                if (!navigator.onLine) {
                    // Offline: a slightly stale cached exam beats an error
                    _perf.end(_p, { source: 'cache-offline' });
                    return cachedExam;
                }
                // Online but light fetch failed (e.g. older server without the
                // fields support) — fall through to the full fetch as before
            }
        }

        try {
            const exam = await this.pb.collection('exams').getOne(id);
            const mappedExam = this._mapExam(exam);

            // 2. Save to IDB
            if (window.idb) {
                await window.idb.saveExam(mappedExam);
            }

            _perf.end(_p, { source: 'network', size: JSON.stringify(mappedExam).length });
            return mappedExam;
        } catch (err) {
            throw err;
        }
    };

    ds.createExam = async function(examData) {
        const clientGeneratedId = examData._clientId || `exam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Check for existing exam
        try {
            const existing = await this.pb.collection('exams').getFirstListItem(`client_id="${clientGeneratedId}"`);
            if (existing) {
                console.log('Exam already exists (duplicate prevented), returning existing:', existing.id);
                return await this.getExamById(existing.id);
            }
        } catch (checkErr) {
            // No existing exam found, continue
        }

        try {
            const questions = examData.questions || [];
            const theoryQs = questions.filter(q => q.type === 'theory');
            const data = {
                title: examData.title,
                school_level: examData.schoolLevel || null,
                subject: examData.subject,
                target_class: examData.targetClass,
                duration: examData.duration,
                pass_score: examData.passScore,
                instructions: examData.instructions,
                theory_instructions: examData.theoryInstructions || null,
                questions: questions,
                status: examData.status || 'draft',
                created_by: examData.createdBy,
                scheduled_date: examData.scheduledDate || null,
                scramble_questions: examData.scrambleQuestions || false,
                client_id: clientGeneratedId,
                question_count: questions.length,
                has_theory: theoryQs.length > 0,
                theory_count: theoryQs.length
            };

            const created = await this.pb.collection('exams').create(data);
            const mappedExam = this._mapExam(created);

            // 3. Update Cache Manually
            if (window.idb) {
                await window.idb.saveExam(mappedExam);
                // Smart Update: Add to teacher's dashboard list
                await this._updateDashboardCacheList(mappedExam, 'add');
            }

            // V2B+V2D: Bump dashboard version — awaited so failures are visible
            try {
                await this._bumpDashboardVersion(examData.targetClass);
            } catch (e) {
                console.error('[VersionBump] Failed during createExam:', e.message || e);
            }

            return mappedExam;
        } catch (error) {
            console.error('createExam error:', error, 'data:', error.data);
            const parsed = this._parseExamError(error);
            if (parsed) {
                throw new Error(parsed);
            }
            throw new Error('Unable to save the exam. Please check all fields are filled in correctly and try again.');
        }
    };

    ds.updateExam = async function(id, updates) {
        try {
            const existingExamRow = await this.pb.collection('exams').getOne(id);
            const existingExam = this._mapExam(existingExamRow);
            const resolvedTargetClass = updates.targetClass !== undefined
                ? updates.targetClass
                : existingExam.targetClass;
            const data = {};
            if (updates.title !== undefined) data.title = updates.title;
            if (updates.subject !== undefined) data.subject = updates.subject;
            if (updates.targetClass !== undefined) data.target_class = updates.targetClass;
            if (updates.duration !== undefined) data.duration = updates.duration;
            if (updates.passScore !== undefined) data.pass_score = updates.passScore;
            if (updates.instructions !== undefined) data.instructions = updates.instructions;
            if (updates.questions !== undefined) {
                data.questions = updates.questions;
                const theoryQs = updates.questions.filter(q => q.type === 'theory');
                data.question_count = updates.questions.length;
                data.has_theory = theoryQs.length > 0;
                data.theory_count = theoryQs.length;
            }
            if (updates.status !== undefined) data.status = updates.status;
            if (updates.extensions !== undefined) data.extensions = updates.extensions;
            if (updates.globalExtension !== undefined) data.global_extension = updates.globalExtension;
            if (updates.scheduledDate !== undefined) data.scheduled_date = updates.scheduledDate;
            if (updates.scrambleQuestions !== undefined) data.scramble_questions = updates.scrambleQuestions;
            if (updates.schoolLevel !== undefined) data.school_level = updates.schoolLevel;
            if (updates.theoryInstructions !== undefined) data.theory_instructions = updates.theoryInstructions;

            const mergedExamForRegrade = {
                ...existingExam,
                ...updates,
                passScore: updates.passScore !== undefined ? updates.passScore : existingExam.passScore,
                questions: updates.questions !== undefined ? updates.questions : existingExam.questions
            };
            const shouldRegradeResults =
                this._getExamRegradeFingerprint(existingExam) !== this._getExamRegradeFingerprint(mergedExamForRegrade);

            const updated = await this.pb.collection('exams').update(id, data);
            const mappedExam = this._mapExam(updated);

            // Update Cache Manually
            if (window.idb) {
                await window.idb.saveExam(mappedExam);
                await this._updateDashboardCacheList(mappedExam, 'update');
            }

            // V2B+V2D: Bump dashboard version — awaited so failures are visible
            try {
                await this._bumpDashboardVersion(resolvedTargetClass);
                if (existingExam.targetClass && existingExam.targetClass !== resolvedTargetClass) {
                    await this._bumpDashboardVersion(existingExam.targetClass);
                }
            } catch (e) {
                console.error('[VersionBump] Failed during updateExam:', e.message || e);
            }

            if (shouldRegradeResults) {
                try {
                    await this._regradeSubmittedResultsForExam(mappedExam);
                } catch (regradeError) {
                    console.error('Exam updated but result regrade failed:', regradeError);
                    throw new Error('Exam updated, but submitted results could not be recalculated automatically.');
                }
            }

            return mappedExam;
        } catch (error) {
            console.error('updateExam error:', error, 'data:', error.data);
            const parsed = this._parseExamError(error);
            if (parsed) {
                throw new Error(parsed);
            }
            throw new Error('Unable to update the exam. Please check all fields are filled in correctly and try again.');
        }
    };

    ds.deleteExam = async function(id) {
        try {
            // Hard-delete: remove the exam record and ALL associated results
            // so no traces remain in the student portal.
            const existing = await this.pb.collection('exams').getOne(id);

            // 1. Delete all results for this exam
            try {
                const results = await this.pb.collection('results').getFullList({
                    filter: `exam_id="${id}"`,
                    fields: 'id'
                });
                for (const result of results) {
                    await this.pb.collection('results').delete(result.id);
                }
                if (results.length > 0) {
                    console.log(`[DeleteExam] Removed ${results.length} result(s) for exam ${id}`);
                }
            } catch (e) {
                console.warn('[DeleteExam] Failed to clean up results:', e.message || e);
            }

            // 2. Delete the exam record itself
            await this.pb.collection('exams').delete(id);

            // 3. Remove from teacher's dashboard cache
            if (window.idb) {
                await window.idb.deleteExam(id);
                await this._updateDashboardCacheList({ id, createdBy: this.getCurrentUser()?.id }, 'delete');
            }

            // 4. Bump dashboard version so students refresh
            try {
                await this._bumpDashboardVersion(existing.target_class);
            } catch (e) {
                console.error('[VersionBump] Failed during deleteExam:', e.message || e);
            }

            return true;
        } catch (error) {
            throw error;
        }
    };

    // --- Dashboard Versions (V2B) ---

    ds._bumpDashboardVersion = async function(targetClass) {
        const keys = [];
        if (targetClass && targetClass !== 'All') {
            keys.push(`student_exam_feed:${targetClass}`);
        }
        keys.push('student_exam_feed:_global');

        let bumped = 0;
        for (const feedKey of keys) {
            for (let attempt = 1; attempt <= 2; attempt++) {
                try {
                    const existing = await this.pb.collection('dashboard_versions').getFirstListItem(`feed_key="${feedKey}"`);
                    await this.pb.collection('dashboard_versions').update(existing.id, {
                        version: (existing.version || 0) + 1
                    });
                    console.log(`[VersionBump] Bumped ${feedKey} to ${(existing.version || 0) + 1}`);
                    bumped++;
                    break; // success, no retry needed
                } catch (e) {
                    if (attempt === 1 && e.status !== 404) {
                        console.warn(`[VersionBump] Attempt 1 failed for ${feedKey}, retrying...`, e.message || e);
                        continue; // retry
                    }
                    // Record doesn't exist yet — create it with version 1
                    try {
                        await this.pb.collection('dashboard_versions').create({
                            feed_key: feedKey,
                            version: 1
                        });
                        console.log(`[VersionBump] Created ${feedKey} at version 1`);
                        bumped++;
                        break;
                    } catch (createErr) {
                        console.error(`[VersionBump] FAILED to bump ${feedKey} after ${attempt} attempts:`, createErr.message || createErr);
                    }
                }
            }
        }
        if (bumped === 0) {
            console.error('[VersionBump] WARNING: No feed keys were bumped! Students may not see this change.');
        }
        return bumped;
    };

    ds.getDashboardVersion = async function(feedKey) {
        const _p = _perf.start('getDashboardVersion');
        try {
            const record = await this.pb.collection('dashboard_versions').getFirstListItem(`feed_key="${feedKey}"`);
            _perf.end(_p, { source: 'network' });
            return record.version || 0;
        } catch (e) {
            _perf.end(_p, { source: 'miss' });
            console.warn('[DashboardVersion] Version unavailable, using cache-first fallback');
            return null;
        }
    };

    ds._updateDashboardCacheList = async function(exam, action) {
        if (!window.idb) return;

        // Update all dashboard cache keys that might hold this exam

        // 1. Teacher Cache: { teacherId: ... }
        if (exam.createdBy) {
            const teacherKey = `exams_${JSON.stringify({ teacherId: exam.createdBy })}`;
            await this._performCacheListUpdate(teacherKey, exam, action);

            // Summary cache for teacher
            const teacherSummaryKey = `examSummaries_${JSON.stringify({ teacherId: exam.createdBy })}`;
            await this._performCacheListUpdate(teacherSummaryKey, this._toSummaryExam(exam), action);
        }

        // 2. Student Dashboard: { status: 'active', studentDashboard: true }
        const studentKey = `exams_${JSON.stringify({ status: 'active', studentDashboard: true })}`;
        await this._performCacheListUpdate(studentKey, exam, action, true);

        // Summary cache for student
        const studentSummaryKey = `examSummaries_${JSON.stringify({ status: 'active', studentDashboard: true })}`;
        await this._performCacheListUpdate(studentSummaryKey, this._toSummaryExam(exam), action, true);

        // 3. Student offline fallback key
        await this._performCacheListUpdate('exams_list', exam, action, true);

        // 4. Admin Dashboard: {} (no filters except forceRefresh which is stripped)
        const adminKey = `exams_${JSON.stringify({})}`;
        await this._performCacheListUpdate(adminKey, exam, action);

        // Summary cache for admin
        const adminSummaryKey = `examSummaries_${JSON.stringify({})}`;
        await this._performCacheListUpdate(adminSummaryKey, this._toSummaryExam(exam), action);
    };

    ds._toSummaryExam = function(exam) {
        if (!exam) return exam;
        const { questions, instructions, ...summary } = exam;
        return { ...summary, questions: null };
    };

    ds._performCacheListUpdate = async function(key, exam, action, isStudentView = false) {
        try {
            const cached = await window.idb.getDashboardCache(key);
            if (cached && cached.data) {
                let list = cached.data;
                const index = list.findIndex(e => e.id === exam.id);

                if (action === 'add') {
                    if (isStudentView && exam.status !== 'active') return; // Don't add drafts to student
                    if (index === -1) {
                        list.unshift(exam); // Add to top
                    }
                } else if (action === 'update') {
                    if (index !== -1) {
                        if (isStudentView && exam.status !== 'active') {
                            list.splice(index, 1); // Remove if no longer active
                        } else {
                            list[index] = exam; // Update
                        }
                    } else if (isStudentView && exam.status === 'active') {
                        list.unshift(exam); // Add if now active
                    }
                } else if (action === 'delete') {
                    if (index !== -1) list.splice(index, 1);
                }

                await window.idb.saveDashboardCache(key, list);
                console.log(`🔄 Smart-updated cache for ${key}`);
            }
        } catch (e) {
            console.warn('Cache manual update failed', e);
        }
    };

    ds._parseExamError = function(error) {
        const msg = (error.message || '').toLowerCase();
        const fieldErrors = error.data?.data || error.response?.data?.data || {};
        const fieldLabels = {
            title: 'Exam Title',
            subject: 'Subject',
            target_class: 'Target Class',
            school_level: 'School Level',
            duration: 'Duration',
            pass_score: 'Passing Score',
            instructions: 'Instructions',
            questions: 'Questions',
            created_by: 'Creator',
            scheduled_date: 'Scheduled Date',
            status: 'Status'
        };

        // Check for field-level validation errors from PocketBase
        const missingFields = [];
        const invalidFields = [];
        for (const [field, err] of Object.entries(fieldErrors)) {
            const label = fieldLabels[field] || field;
            if (err.code === 'validation_required' || err.code === 'validation_not_blank') {
                missingFields.push(label);
            } else if (err.code) {
                invalidFields.push(label);
            }
        }

        if (missingFields.length > 0) {
            return `The following required fields are missing: ${missingFields.join(', ')}. Please fill them in and try again.`;
        }
        if (invalidFields.length > 0) {
            return `There's a problem with: ${invalidFields.join(', ')}. Please check these fields and try again.`;
        }

        // Network errors
        if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('failed to fetch')) {
            return 'NETWORK_ERROR';
        }
        // Auth errors
        if (msg.includes('not authenticated') || msg.includes('not valid') || msg.includes('token') || error.status === 401 || error.status === 403) {
            return 'AUTH_ERROR';
        }
        // Payload too large
        if (msg.includes('too large') || msg.includes('payload') || msg.includes('size') || error.status === 413) {
            return 'SIZE_ERROR';
        }

        // If PocketBase gave a message but no field details, use it
        if (error.data?.message && error.data.message !== error.message) {
            return error.data.message;
        }

        return null;
    };

    // --- Exam Mapping ---

    ds._mapExam = function(dbExam) {
        if (!dbExam) return null;
        const questions = dbExam.questions || [];
        return {
            id: dbExam.id,
            title: dbExam.title,
            subject: dbExam.subject,
            targetClass: dbExam.target_class,
            duration: dbExam.duration,
            passScore: dbExam.pass_score,
            instructions: dbExam.instructions,
            questions: questions,
            status: dbExam.status,
            createdBy: dbExam.created_by,
            createdAt: dbExam.created,
            updatedAt: dbExam.updated,
            extensions: dbExam.extensions || {},
            globalExtension: dbExam.global_extension || null,
            scheduledDate: dbExam.scheduled_date || null,
            scrambleQuestions: dbExam.scramble_questions || false,
            schoolLevel: dbExam.school_level ?? null,
            theoryInstructions: dbExam.theory_instructions ?? null,
            questionCount: dbExam.question_count ?? questions.length,
            hasTheory: dbExam.has_theory ?? questions.some(q => q.type === 'theory'),
            theoryCount: dbExam.theory_count ?? questions.filter(q => q.type === 'theory').length,
            contentUpdated: dbExam.content_updated || null
        };
    };

    ds._mapExamSummary = function(dbExam) {
        if (!dbExam) return null;
        return {
            id: dbExam.id,
            title: dbExam.title,
            subject: dbExam.subject,
            targetClass: dbExam.target_class,
            duration: dbExam.duration,
            passScore: dbExam.pass_score,
            questions: null,
            status: dbExam.status,
            createdBy: dbExam.created_by,
            createdAt: dbExam.created,
            updatedAt: dbExam.updated,
            extensions: dbExam.extensions || {},
            globalExtension: dbExam.global_extension || null,
            scheduledDate: dbExam.scheduled_date || null,
            scrambleQuestions: dbExam.scramble_questions || false,
            schoolLevel: dbExam.school_level ?? null,
            theoryInstructions: dbExam.theory_instructions ?? null,
            questionCount: dbExam.question_count || 0,
            hasTheory: dbExam.has_theory || false,
            theoryCount: dbExam.theory_count || 0,
            contentUpdated: dbExam.content_updated || null
        };
    };

    // --- Result/Exam Snapshot Helpers ---

    ds._buildResultExamSnapshot = function(exam) {
        if (!exam) return {};
        return {
            exam_title: exam.title || '',
            exam_subject: exam.subject || '',
            exam_target_class: exam.targetClass || exam.target_class || '',
            exam_duration: exam.duration ?? null,
            exam_has_theory: !!(exam.hasTheory ?? exam.has_theory),
            exam_theory_count: exam.theoryCount ?? exam.theory_count ?? 0
        };
    };

    ds._mapResultExamSnapshot = function(dbResult) {
        return {
            examTitle: dbResult.exam_title || '',
            examSubject: dbResult.exam_subject || '',
            examTargetClass: dbResult.exam_target_class || '',
            examDuration: dbResult.exam_duration ?? null,
            examHasTheory: !!dbResult.exam_has_theory,
            examTheoryCount: dbResult.exam_theory_count ?? 0
        };
    };

    ds._resultSnapshotsComplete = function(results = []) {
        return results.every(result => !!(result.examTitle || result.exam_title) && !!(result.examSubject || result.exam_subject));
    };

    ds._examDataComplete = function(exams = []) {
        return exams.every(exam => !!exam && !!exam.id && !!exam.title && !!exam.subject);
    };

    // --- Grading ---

    ds._gradeExamAnswers = function(exam, answers = {}) {
        let score = 0;
        let totalPoints = 0;

        const questions = Array.isArray(exam && exam.questions) ? exam.questions : [];
        questions.forEach(q => {
            const points = parseFloat(q.points) || 0.5;

            if (q.type === 'theory') {
                return;
            }

            totalPoints += points;
            const answer = answers[q.id];

            if (q.type === 'fill_blank') {
                if (answer && q.correctAnswer &&
                    answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                    score += points;
                }
            } else if (q.type === 'match') {
                if (answer) {
                    let allCorrect = true;
                    q.pairs.forEach((pair, idx) => {
                        if (answer[idx] !== pair.right) allCorrect = false;
                    });
                    if (allCorrect) score += points;
                }
            } else if (q.type === 'image_multi') {
                if (answer && q.subQuestions) {
                    let correctCount = 0;
                    q.subQuestions.forEach(subQ => {
                        if (answer[subQ.id] === subQ.correctAnswer) {
                            correctCount++;
                        }
                    });
                    const pointsPerSubQ = points / q.subQuestions.length;
                    score += correctCount * pointsPerSubQ;
                }
            } else if (answer && q.options) {
                const correctOpt = q.options.find(o => o.isCorrect);
                if (correctOpt && correctOpt.id === answer) {
                    score += points;
                }
            }
        });

        return { score, totalPoints };
    };

    ds._getExamRegradeFingerprint = function(examLike = {}) {
        const questions = Array.isArray(examLike.questions) ? examLike.questions : [];
        const normalizedQuestions = questions.map(q => {
            const base = {
                id: q.id || null,
                type: q.type || null,
                points: Number.parseFloat(q.points) || 0
            };

            if (q.type === 'theory') {
                return base;
            }

            if (q.type === 'fill_blank') {
                return {
                    ...base,
                    correctAnswer: q.correctAnswer || ''
                };
            }

            if (q.type === 'match') {
                return {
                    ...base,
                    pairs: Array.isArray(q.pairs)
                        ? q.pairs.map(pair => ({
                            left: pair.left || '',
                            right: pair.right || ''
                        }))
                        : []
                };
            }

            if (q.type === 'image_multi') {
                return {
                    ...base,
                    subQuestions: Array.isArray(q.subQuestions)
                        ? q.subQuestions.map(subQ => ({
                            id: subQ.id || null,
                            correctAnswer: subQ.correctAnswer || ''
                        }))
                        : []
                };
            }

            return {
                ...base,
                options: Array.isArray(q.options)
                    ? q.options.map(opt => ({
                        id: opt && typeof opt === 'object' ? opt.id || null : opt,
                        isCorrect: !!(opt && typeof opt === 'object' && opt.isCorrect)
                    }))
                    : []
            };
        });

        return JSON.stringify({
            passScore: examLike.passScore ?? examLike.pass_score ?? 50,
            questions: normalizedQuestions
        });
    };

    ds._getTheoryScoreSummary = function(exam, flags = {}) {
        const theoryPossible = (Array.isArray(exam && exam.questions) ? exam.questions : []).reduce((sum, q) => {
            if (q.type !== 'theory') return sum;
            return sum + (Number.parseFloat(q.points) || 0.5);
        }, 0);

        const toFiniteNumber = (value) => {
            if (value === undefined || value === null || value === '') return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };
        const manualTheoryScore = toFiniteNumber(flags._manualTheoryScore);
        const manualTheoryTotal = toFiniteNumber(flags._manualTheoryTotal);
        const theoryScores = (flags._theoryScores && typeof flags._theoryScores === 'object') ? flags._theoryScores : {};
        const savedTheoryPoints = Object.values(theoryScores).reduce((sum, value) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? sum + parsed : sum;
        }, 0);

        return {
            theoryPoints: manualTheoryScore !== null ? manualTheoryScore : savedTheoryPoints,
            theoryTotalPoints: manualTheoryTotal !== null ? manualTheoryTotal : theoryPossible
        };
    };

    ds._regradeSubmittedResultsForExam = async function(exam) {
        if (!exam || !exam.id) {
            return { scanned: 0, updated: 0, skipped: 0 };
        }

        const resultRows = await this._rawList('results', {
            filter: `exam_id="${exam.id}"`,
            fullList: true,
            fields: 'id,exam_id,student_id,answers,score,total_points,pass_score,passed,submitted_at,flags,created,updated,exam_title,exam_subject,exam_target_class,exam_duration,exam_has_theory,exam_theory_count'
        });

        if (!Array.isArray(resultRows) || resultRows.length === 0) {
            return { scanned: 0, updated: 0, skipped: 0 };
        }

        const regradedResults = [];
        let updated = 0;
        let skipped = 0;

        for (const row of resultRows) {
            const flags = row.flags || {};
            const status = flags._status || 'completed';

            if (status === 'in-progress') {
                skipped++;
                continue;
            }

            const answers = row.answers || {};
            const { score: objectivePoints, totalPoints: objectiveTotalPoints } = this._gradeExamAnswers(exam, answers);
            const { theoryPoints, theoryTotalPoints } = this._getTheoryScoreSummary(exam, flags);
            // CA (continuous assessment) lives outside the exam questions —
            // carry it through the regrade instead of wiping it
            const caScoreParsed = Number(flags._caScore);
            const caTotalParsed = Number(flags._caTotal);
            const caPoints = Number.isFinite(caScoreParsed) ? caScoreParsed : 0;
            const caTotalPoints = Number.isFinite(caTotalParsed) ? caTotalParsed : 0;
            const totalPoints = Number(objectiveTotalPoints) + Number(theoryTotalPoints) + caTotalPoints;
            const pointsScored = Number(objectivePoints) + Number(theoryPoints) + caPoints;
            const passScore = exam.passScore ?? 50;
            const percentage = totalPoints > 0 ? Math.round((pointsScored / totalPoints) * 100) : 0;

            const updatedFlags = {
                ...flags,
                _objective_total_points: objectiveTotalPoints,
                _objective_points_scored: objectivePoints,
                _real_total_points: totalPoints,
                _real_points_scored: pointsScored,
                _lastRegradedAt: new Date().toISOString()
            };

            const rowUpdated = await this.pb.collection('results').update(row.id, {
                score: percentage,
                total_points: totalPoints,
                pass_score: passScore,
                passed: percentage >= passScore,
                flags: updatedFlags,
                ...this._buildResultExamSnapshot(exam)
            });

            regradedResults.push(this._mapResult(rowUpdated));
            updated++;
        }

        if (window.idb && regradedResults.length > 0) {
            try {
                await window.idb.saveResults(regradedResults);
            } catch (e) {
                console.warn('Could not refresh cached results after regrade:', e);
            }
        }

        return { scanned: resultRows.length, updated, skipped };
    };

    // --- Results ---

    // Looks up the single result row for an exam+student.
    //
    // Returns the record, or null ONLY when the server actually answered "not found".
    // Every other failure (timeout, status 0, 403, 500) is re-thrown.
    //
    // This distinction is the whole point: callers used to wrap getFirstListItem in a
    // bare `catch { create() }`, so a timed-out lookup on a slow connection was read as
    // "no record exists" and a SECOND results row was created for the same student.
    // The duplicate then competed with the real row, which is how students ended up
    // with a score that wasn't the one they were shown.
    ds._findExistingResult = async function(examId, studentId) {
        try {
            return await this.pb.collection('results').getFirstListItem(
                `exam_id="${examId}" && student_id="${studentId}"`
            );
        } catch (err) {
            if (err && err.status === 404) return null;   // genuinely absent
            throw err;                                    // unknown — caller must not create
        }
    };

    ds.saveResult = async function(resultData) {
        const examSnapshot = this._buildResultExamSnapshot(resultData.examSnapshot || {});
        const flags = {
            ...(resultData.flags || {}),
            _status: 'completed',
            _studentName: resultData.studentName ?? (resultData.flags && resultData.flags._studentName) ?? ''
        };
        delete flags._reopenedForExtension;
        delete flags._reopenedAt;
        delete flags._previousScore;
        delete flags._previousSubmittedAt;
        // pass_score and passed were never written here. pass_score therefore sat at 0
        // in the database, and because every consumer reads it as `passScore || 50`,
        // a 0 is falsy and silently becomes a hardcoded 50% pass mark — ignoring
        // whatever the teacher actually set on the exam.
        const passScore = Number.isFinite(Number(resultData.passScore)) ? Number(resultData.passScore) : 50;
        const passed = resultData.passed ?? (Number(resultData.score) >= passScore);

        const data = {
            exam_id: resultData.examId,
            student_id: resultData.studentId,
            score: resultData.score,
            total_points: resultData.totalPoints,
            pass_score: passScore,
            passed,
            answers: resultData.answers,
            flags,
            submitted_at: new Date().toISOString(),
            ...examSnapshot
        };

        try {
            // Find the existing row first. A failed lookup throws out of here into the
            // offline handler below — it must never fall through to create(), or a
            // slow connection silently produces a duplicate result row.
            const existing = await this._findExistingResult(resultData.examId, resultData.studentId);

            let result;
            if (existing) {
                const updated = await this.pb.collection('results').update(existing.id, data);
                result = this._mapResult(updated);
            } else {
                const created = await this.pb.collection('results').create(data);
                result = this._mapResult(created);
            }

            // Ensure studentName is set (PocketBase response has no expand)
            if (result && (!result.studentName || result.studentName === 'Unknown') && resultData.studentName) {
                result.studentName = resultData.studentName;
            }
            console.log(`[ResultIdentity] submission snapshot saved for result ${result.id} — name: "${result.studentName}"`);

            // Update IDB Results Cache
            if (window.idb) {
                await window.idb.saveResults([result]);
            }
            return result;

        } catch (err) {
            if (this.isNetworkError(err)) {
                data._local_id = Date.now();
                const store = await this.queuePendingSubmission(data);
                console.log(`[PendingSync] Submission queued in ${store} for later sync`);
                throw new Error('Saved Offline');
            }
            throw err;
        }
    };

    ds.startExamSession = async function(examId, studentId, studentName) {
        try {
            // Only create the placeholder when the server confirms no row exists.
            // A timed-out lookup here used to create a SECOND score-0 in-progress row
            // on top of a real completed result — the worst version of this bug, since
            // the placeholder can then outrank the student's actual score.
            const existing = await this._findExistingResult(examId, studentId);

            if (existing) {
                // V2E: Backfill _studentName if missing on existing in-progress record
                if (studentName && existing.flags && !existing.flags._studentName) {
                    try {
                        await this.pb.collection('results').update(existing.id, {
                            flags: { ...existing.flags, _studentName: studentName }
                        });
                        console.log(`[ResultIdentity] Backfilled _studentName on existing session ${existing.id}`);
                    } catch (e) { /* best effort */ }
                }
                return; // Already exists
            }

            // Create new session marker with student name snapshot
            await this.pb.collection('results').create({
                exam_id: examId,
                student_id: studentId,
                flags: {
                    _status: 'in-progress',
                    _started_at: new Date().toISOString(),
                    _studentName: studentName || ''
                },
                score: 0,
                total_points: 0,
                answers: {}
            });
            console.log(`[ResultIdentity] Session created with _studentName for exam ${examId}`);
        } catch (error) {
            console.error('Failed to start session', error);
        }
    };

    // --- Duplicate Result Resolution ---
    //
    // Before the offline-sync fixes, a failed lookup was read as "no record exists" and
    // a second (or third) results row was created for the same exam+student. Those rows
    // are still in the database. These helpers let a teacher see and resolve them.
    //
    // Discarding is a SOFT delete: the row is flagged and hidden, never removed, so a
    // wrong choice stays recoverable and the merge keeps an audit trail.

    ds.isSupersededResult = function(r) {
        return !!(r && r.flags && r.flags._superseded);
    };

    // Ranking signals, best-first. Deliberately NOT date-only: the old sync stamped
    // submitted_at at sync time when the payload lacked one, so an empty score-0 row
    // can carry a newer timestamp than the student's genuine submission. Date decides
    // between real submissions; it must not let a placeholder outrank one.
    ds._resultRankSignals = function(r) {
        const flags = r.flags || {};
        const status = r.status || flags._status || 'completed';
        const answers = r.answers;
        const answerCount = (answers && typeof answers === 'object') ? Object.keys(answers).length : 0;
        return {
            completed: status !== 'in-progress' ? 1 : 0,
            hasAnswers: answerCount > 0 ? 1 : 0,
            answerCount,
            submittedAt: Date.parse(r.submittedAt || r.submitted_at || 0) || 0,
            created: Date.parse(r.created || 0) || 0
        };
    };

    ds.rankResultCandidates = function(list) {
        return [...(list || [])].sort((a, b) => {
            const ra = this._resultRankSignals(a);
            const rb = this._resultRankSignals(b);
            if (rb.completed !== ra.completed) return rb.completed - ra.completed;
            if (rb.hasAnswers !== ra.hasAnswers) return rb.hasAnswers - ra.hasAnswers;
            if (rb.submittedAt !== ra.submittedAt) return rb.submittedAt - ra.submittedAt;
            if (rb.created !== ra.created) return rb.created - ra.created;
            return String(a.id || '').localeCompare(String(b.id || '')); // stable
        });
    };

    // Groups results into { primary, duplicates } sets keyed on student+exam.
    ds.groupDuplicateResults = function(results, options = {}) {
        const includeSingles = !!options.includeSingles;
        const buckets = new Map();

        for (const r of results || []) {
            const key = `${r.studentId || ''}::${r.examId || ''}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(r);
        }

        const groups = [];
        for (const [key, list] of buckets) {
            if (!includeSingles && list.length < 2) continue;
            const ranked = this.rankResultCandidates(list);
            groups.push({
                key,
                studentId: ranked[0].studentId,
                examId: ranked[0].examId,
                studentName: ranked[0].studentName,
                examTitle: ranked[0].examTitle,
                examSubject: ranked[0].examSubject,
                primary: ranked[0],
                duplicates: ranked.slice(1),
                all: ranked
            });
        }
        return groups;
    };

    // Classifies a duplicate set by how much human judgement it needs.
    //
    //   'placeholder' — every discard is an empty row (no answers). These are the
    //                   score-0 session markers left by the old startExamSession bug.
    //   'identical'   — every discard carries the same score as the keeper.
    //   'empty'       — the KEEPER itself has no answers. There may be no genuine
    //                   submission here at all; possibly one destroyed before it synced.
    //                   Never auto-resolve: deleting rows would hide the evidence.
    //   'divergent'   — the copies disagree on a real score. Needs a teacher.
    ds.classifyDuplicateGroup = function(group) {
        const keeper = group.primary;
        const ks = this._resultRankSignals(keeper);

        if (ks.answerCount === 0) return 'empty';

        const discards = group.duplicates.map(d => ({ r: d, s: this._resultRankSignals(d) }));

        // An empty discard is a placeholder. A discard that HAS answers but scored 0 is
        // a real attempt and must not be treated as disposable.
        if (discards.every(d => d.s.answerCount === 0)) return 'placeholder';

        if (discards.every(d => Number(d.r.score) === Number(keeper.score))) return 'identical';

        return 'divergent';
    };

    ds.isAutoResolvableGroup = function(group) {
        const kind = this.classifyDuplicateGroup(group);
        return kind === 'placeholder' || kind === 'identical';
    };

    // READ-ONLY. Writes nothing — use it to see the scale before resolving anything.
    ds.auditDuplicateResults = async function(filters = {}) {
        const results = await this.getResults({
            ...filters,
            includeSuperseded: true,
            forceRefresh: true
        });

        const live = results.filter(r => !this.isSupersededResult(r));
        const groups = this.groupDuplicateResults(live).map(g => ({
            ...g,
            kind: this.classifyDuplicateGroup(g)
        }));

        const byKind = { placeholder: [], identical: [], divergent: [], empty: [] };
        groups.forEach(g => byKind[g.kind].push(g));

        return {
            totalResults: results.length,
            supersededResults: results.length - live.length,
            duplicateGroups: groups.length,
            duplicateRows: groups.reduce((n, g) => n + g.duplicates.length, 0),
            worstGroupSize: groups.reduce((n, g) => Math.max(n, g.all.length), 0),
            placeholderGroups: byKind.placeholder.length,
            identicalGroups: byKind.identical.length,
            divergentGroups: byKind.divergent.length,
            emptyGroups: byKind.empty.length,
            autoResolvable: byKind.placeholder.length + byKind.identical.length,
            needsReview: byKind.divergent.length + byKind.empty.length,
            byKind,
            groups
        };
    };

    // Soft-deletes `discardIds` in favour of `keepId`.
    ds.supersedeResults = async function(keepId, discardIds, meta = {}) {
        if (!keepId) throw new Error('supersedeResults: keepId is required');

        const ids = (discardIds || []).filter(id => id && id !== keepId);
        if (ids.length === 0) return { superseded: 0, failed: [] };

        const failed = [];
        let superseded = 0;

        for (const id of ids) {
            try {
                const existing = await this.pb.collection('results').getOne(id);
                const flags = {
                    ...(existing.flags || {}),
                    _superseded: true,
                    _supersededAt: new Date().toISOString(),
                    _supersededBy: keepId,
                    _supersededByUser: meta.userId || '',
                    _supersededByName: meta.userName || ''
                };
                await this.pb.collection('results').update(id, { flags });
                superseded++;
            } catch (err) {
                console.error(`[Duplicates] Could not supersede result ${id}:`, err);
                failed.push({ id, error: err && err.message });
            }
        }

        await this._invalidateResultCaches();
        return { superseded, failed };
    };

    // Bulk-resolves ONLY the mechanically safe classes.
    //
    // 'divergent' and 'empty' groups are refused outright — they are the ones where a
    // wrong pick changes a student's real grade, so they must go through a teacher.
    // Pass dryRun to see exactly what would happen without writing anything.
    ds.autoResolveDuplicates = async function(options = {}) {
        const { dryRun = false, meta = {}, filters = {} } = options;

        const audit = await this.auditDuplicateResults(filters);
        const targets = audit.groups.filter(g => this.isAutoResolvableGroup(g));

        const plan = targets.map(g => ({
            student: g.studentName,
            exam: g.examTitle || g.examId,
            kind: g.kind,
            keep: { id: g.primary.id, score: g.primary.score },
            discard: g.duplicates.map(d => ({ id: d.id, score: d.score }))
        }));

        if (dryRun) {
            return {
                dryRun: true,
                wouldResolve: plan.length,
                wouldHideRows: plan.reduce((n, p) => n + p.discard.length, 0),
                skippedForReview: audit.needsReview,
                plan
            };
        }

        let resolved = 0;
        const failed = [];
        for (const g of targets) {
            try {
                const res = await this.supersedeResults(
                    g.primary.id,
                    g.duplicates.map(d => d.id),
                    meta
                );
                if (res.failed.length) failed.push({ group: g.key, failed: res.failed });
                resolved++;
            } catch (err) {
                failed.push({ group: g.key, error: err && err.message });
            }
        }

        await this._invalidateResultCaches();
        return { dryRun: false, resolved, failed, skippedForReview: audit.needsReview, plan };
    };

    // READ-ONLY. Re-scores every row in the 'divergent' and 'empty' groups against the
    // live exam key, to tell apart the two reasons a discard can carry a stored 0:
    //
    //   sync-bug zero — the answers ARE there and re-score to the keeper's true grade;
    //                   the stored 0 is the offline-sync scoring bug. Safe to hide: the
    //                   keeper already holds that exact grade.
    //   genuine       — the discard re-scores to a DIFFERENT real grade (a separate
    //                   attempt/retake) or honestly re-scores to 0. Needs a teacher.
    //
    // Per-discard disposition:
    //   'redundant'      — re-scores to the keeper's true grade → safe to supersede
    //   'conflict'       — re-scores to a different non-zero grade → manual
    //   'genuine-zero'   — re-scores to 0 with answers present → manual
    //   'no-exam'        — exam key unavailable (deleted exam) → manual
    // Group is auto-resolvable ONLY when the keeper is self-consistent (stored === recalc,
    // so we trust it holds the real grade) AND every discard is 'redundant'.
    // 'keeper-suspect' (keeper stored !== recalc, incl. empty keepers) is never auto-acted —
    // the truth may live in a discard, which is a swap decision only a teacher should make.
    ds.auditDivergentByRescore = async function(filters = {}) {
        const audit = await this.auditDuplicateResults(filters);
        const groups = [...audit.byKind.divergent, ...audit.byKind.empty];

        const examCache = new Map();
        const getExam = async (id) => {
            if (examCache.has(id)) return examCache.get(id);
            let exam = null;
            try { exam = await this.getExamById(id); } catch (_) { exam = null; }
            examCache.set(id, exam);
            return exam;
        };

        const pct = (exam, r) => {
            if (!exam) return null;
            const { score, totalPoints } = this._gradeExamAnswers(exam, (r && r.answers) || {});
            return totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
        };

        const detailed = [];
        for (const g of groups) {
            const exam = await getExam(g.examId);
            const keeper = g.primary;
            const keeperStored = Number(keeper.score);
            const keeperRecalc = pct(exam, keeper);
            const keeperConsistent = exam ? keeperStored === keeperRecalc : false;

            const discards = g.duplicates.map(d => {
                const recalc = pct(exam, d);
                let disposition;
                if (recalc === null) disposition = 'no-exam';
                else if (keeperConsistent && recalc === keeperRecalc) disposition = 'redundant';
                else if (recalc === 0) disposition = 'genuine-zero';
                else disposition = 'conflict';
                return { id: d.id, stored: Number(d.score), recalc, disposition };
            });

            const keeperSuspect = !!exam && !keeperConsistent;
            const autoResolvable = !keeperSuspect && !!exam &&
                discards.length > 0 && discards.every(d => d.disposition === 'redundant');

            detailed.push({
                key: g.key,
                kind: g.kind,
                student: g.studentName,
                exam: g.examTitle || g.examId,
                examId: g.examId,
                examMissing: !exam,
                keeperId: keeper.id,
                keeperStored,
                keeperRecalc,
                keeperSuspect,
                discards,
                autoResolvable
            });
        }

        const redundantOnly = detailed.filter(d => d.autoResolvable);
        return {
            examined: detailed.length,
            autoResolvable: redundantOnly.length,
            keeperSuspect: detailed.filter(d => d.keeperSuspect).length,
            examMissing: detailed.filter(d => d.examMissing).length,
            stillManual: detailed.filter(d => !d.autoResolvable).length,
            groups: detailed
        };
    };

    // Supersedes ONLY the discards proven redundant by re-scoring (see auditDivergentByRescore).
    // Defaults to dryRun — writes nothing until called with { dryRun: false }.
    ds.resolveRescoredDuplicates = async function(options = {}) {
        const { dryRun = true, meta = {}, filters = {} } = options;
        const audit = await this.auditDivergentByRescore(filters);
        const targets = audit.groups.filter(g => g.autoResolvable);

        const plan = targets.map(g => ({
            student: g.student,
            exam: g.exam,
            keep: g.keeperRecalc,
            discardIds: g.discards.map(d => d.id)
        }));

        if (dryRun) {
            return {
                dryRun: true,
                wouldResolve: plan.length,
                wouldHideRows: plan.reduce((n, p) => n + p.discardIds.length, 0),
                keeperSuspect: audit.keeperSuspect,
                examMissing: audit.examMissing,
                stillManual: audit.stillManual,
                plan
            };
        }

        let resolved = 0;
        const failed = [];
        for (const g of targets) {
            try {
                const res = await this.supersedeResults(g.keeperId, g.discards.map(d => d.id), meta);
                if (res.failed.length) failed.push({ group: g.key, failed: res.failed });
                resolved++;
            } catch (err) {
                failed.push({ group: g.key, error: err && err.message });
            }
        }

        await this._invalidateResultCaches();
        return { dryRun: false, resolved, failed, stillManual: audit.stillManual, plan };
    };

    // Policy resolver: keep the single HIGHEST-scoring row per student+exam, soft-hide the rest.
    // Uses stored scores only, so it also covers the deleted-exam duplicates the re-score audit
    // cannot judge. Ties on score fall back to rankResultCandidates (completed, has answers,
    // newest) so the most complete row wins. `changed` flags groups where the highest row is NOT
    // the current keeper — i.e. a student whose visible grade rises. Defaults to dryRun.
    ds.resolveDuplicatesKeepHighest = async function(options = {}) {
        const { dryRun = true, meta = {}, filters = {} } = options;
        const results = await this.getResults({ ...filters, includeSuperseded: true, forceRefresh: true });
        const live = results.filter(r => !this.isSupersededResult(r));
        const groups = this.groupDuplicateResults(live);

        const plan = groups.map(g => {
            const ranked = this.rankResultCandidates(g.all);
            const keeper = [...g.all].sort((a, b) => {
                const sa = Number(a.score) || 0, sb = Number(b.score) || 0;
                if (sb !== sa) return sb - sa;
                return ranked.indexOf(a) - ranked.indexOf(b);
            })[0];
            const discards = g.all.filter(r => r.id !== keeper.id);
            return {
                student: g.studentName,
                exam: g.examTitle || g.examId,
                keepScore: Number(keeper.score) || 0,
                hideScores: discards.map(d => Number(d.score) || 0),
                changed: keeper.id !== g.primary.id,
                keeperId: keeper.id,
                discardIds: discards.map(d => d.id)
            };
        }).filter(p => p.discardIds.length > 0);

        if (dryRun) {
            return {
                dryRun: true,
                wouldResolve: plan.length,
                wouldHideRows: plan.reduce((n, p) => n + p.discardIds.length, 0),
                gradesRaised: plan.filter(p => p.changed).length,
                plan
            };
        }

        let resolved = 0;
        const failed = [];
        for (const p of plan) {
            try {
                const res = await this.supersedeResults(p.keeperId, p.discardIds, meta);
                if (res.failed.length) failed.push({ student: p.student, failed: res.failed });
                resolved++;
            } catch (err) {
                failed.push({ student: p.student, error: err && err.message });
            }
        }
        await this._invalidateResultCaches();
        return { dryRun: false, resolved, failed, gradesRaised: plan.filter(p => p.changed).length, plan };
    };

    // Undo — clears the flag so the row is visible again.
    ds.restoreSupersededResult = async function(resultId) {
        const existing = await this.pb.collection('results').getOne(resultId);
        const flags = { ...(existing.flags || {}) };
        delete flags._superseded;
        delete flags._supersededAt;
        delete flags._supersededBy;
        delete flags._supersededByUser;
        delete flags._supersededByName;
        await this.pb.collection('results').update(resultId, { flags });
        await this._invalidateResultCaches();
        return true;
    };

    ds._invalidateResultCaches = async function() {
        if (!window.idb || !window.idb.isIndexedDBAvailable()) return;
        try {
            const db = await window.idb.openDB();
            const tx = db.transaction('dashboardCache', 'readwrite');
            tx.objectStore('dashboardCache').clear();
            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
        } catch (e) {
            console.warn('[Duplicates] Could not clear result caches:', e);
        }
    };

    // Superseded rows are hidden from every consumer unless explicitly requested.
    ds._applySupersededFilter = function(list, filters) {
        if (filters && filters.includeSuperseded) return list || [];
        return (list || []).filter(r => !this.isSupersededResult(r));
    };

    ds.getResults = async function(filters = {}) {
        // Exclude forceRefresh from cache key
        const { forceRefresh, ...cacheFilters } = filters;
        const cacheKey = `results_${JSON.stringify(cacheFilters)}`;

        // 1. Try IDB Cache (max 3 minutes before refetching)
        const CACHE_MAX_AGE = 3 * 60 * 1000;
        if (window.idb && !forceRefresh) {
            try {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached && cached.data && cached.data.length > 0) {
                    const age = Date.now() - (cached.cachedAt || 0);
                    if (age < CACHE_MAX_AGE && this._resultSnapshotsComplete(cached.data)) {
                        return this._applySupersededFilter(cached.data, filters);
                    }
                }
            } catch (e) { }
        }

        try {
            let filterString = '';

            if (filters.studentId) {
                filterString += `student_id="${filters.studentId}"`;
            }

            if (filters.examId) {
                if (filterString) filterString += ' && ';
                filterString += `exam_id="${filters.examId}"`;
            }

            const options = {
                filter: filterString,
                sort: '-submitted_at'
            };

            if (filters.studentDashboard) {
                options.perPage = 100;
            }

            const results = await this.pb.collection('results').getFullList(options);
            const mappedResults = results.map(r => this._mapResult(r));

            // 2. Save to IDB (only if we got data — never overwrite good cache with empty)
            // The cache stores the UNFILTERED list so the resolution UI can still read
            // superseded rows; filtering happens on the way out.
            if (window.idb && mappedResults.length > 0) {
                await window.idb.saveDashboardCache(cacheKey, mappedResults);
                await window.idb.saveResults(mappedResults);
            }

            return this._applySupersededFilter(mappedResults, filters);
        } catch (error) {
            // Fallback
            if (window.idb) {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached) return this._applySupersededFilter(cached.data, filters);
            }
            throw error;
        }
    };

    ds.getResultSummaries = async function(filters = {}) {
        const _p = _perf.start('getResultSummaries');
        const { forceRefresh, ...cacheFilters } = filters;
        const cacheKey = `resultSummaries_${JSON.stringify(cacheFilters)}`;

        const CACHE_MAX_AGE = 10 * 60 * 1000; // 10 minutes
        if (window.idb && !forceRefresh) {
            try {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached && cached.data && cached.data.length > 0) {
                    const age = Date.now() - (cached.cachedAt || 0);
                    if (age < CACHE_MAX_AGE) {
                        console.log(`📦 Serving result summaries from cache (${Math.round(age / 1000)}s old)`);
                        _perf.end(_p, { source: 'cache', count: cached.data.length });
                        return this._applySupersededFilter(cached.data, filters);
                    }
                }
            } catch (e) { }
        }

        try {
            let filterString = '';

            if (filters.studentId) {
                filterString += `student_id="${filters.studentId}"`;
            }

            if (filters.examId) {
                if (filterString) filterString += ' && ';
                filterString += `exam_id="${filters.examId}"`;
            }

            const options = {
                filter: filterString,
                sort: '-submitted_at',
                fields: 'id,exam_id,student_id,score,total_points,pass_score,passed,submitted_at,flags,created,updated,exam_title,exam_subject,exam_target_class,exam_duration,exam_has_theory,exam_theory_count',
                fullList: true
            };

            if (filters.studentDashboard) {
                options.perPage = 100;
            }

            let results;
            if (Array.isArray(filters.examIds)) {
                // Scope to a known set of exams instead of pulling the whole collection.
                // The teacher dashboard only ever uses results belonging to its own
                // exams (it filters by teacherExamIds immediately after fetching), but
                // it was downloading every result on the server first — 6,375 rows over
                // ~32 paged requests — which is what pushes the backend into 400s.
                const ids = filters.examIds.filter((id) => /^[a-zA-Z0-9_]+$/.test(id || ''));
                if (ids.length === 0) {
                    results = [];
                } else {
                    // Chunked so the filter (and the URL) stays a sane length for a
                    // teacher with many exams. Sequential, not parallel — the point is
                    // to reduce concurrent load, and firing every chunk at once would
                    // defeat that.
                    const CHUNK = 25;
                    results = [];
                    for (let i = 0; i < ids.length; i += CHUNK) {
                        const clause = '(' + ids.slice(i, i + CHUNK)
                            .map((id) => `exam_id="${id}"`).join(' || ') + ')';
                        const rows = await this._rawList('results', {
                            ...options,
                            filter: filterString ? `${filterString} && ${clause}` : clause
                        });
                        results = results.concat(rows);
                    }
                }
            } else {
                results = await this._rawList('results', options);
            }
            const mappedResults = results.map(r => this._mapResultSummary(r));

            if (window.idb && mappedResults.length > 0) {
                await window.idb.saveDashboardCache(cacheKey, mappedResults);
            }

            _perf.end(_p, { source: 'network', count: mappedResults.length, size: JSON.stringify(mappedResults).length });
            return this._applySupersededFilter(mappedResults, filters);
        } catch (error) {
            if (window.idb) {
                try {
                    const cached = await window.idb.getDashboardCache(cacheKey);
                    if (cached) return this._applySupersededFilter(cached.data, filters);
                } catch (e) { /* ignore */ }
            }
            throw error;
        }
    };

    ds._mapResult = function(dbResult) {
        if (!dbResult) return null;

        let status = 'completed';
        if (dbResult.flags && dbResult.flags._status) {
            status = dbResult.flags._status;
        }

        // Get student name from expanded relation (check multiple possible fields)
        let studentName = 'Unknown';
        if (dbResult.expand && dbResult.expand.student_id) {
            const expanded = dbResult.expand.student_id;
            studentName = expanded.full_name || expanded.name || expanded.username || 'Unknown';
        }
        // Fallback: check if the flags contain student name (saved during submission)
        if (studentName === 'Unknown' && dbResult.flags && dbResult.flags._studentName) {
            studentName = dbResult.flags._studentName;
            console.log(`[ResultIdentity] fallback source used: snapshot for result ${dbResult.id}`);
        }

        return {
            id: dbResult.id,
            examId: dbResult.exam_id,
            studentId: dbResult.student_id,
            score: dbResult.score,
            totalPoints: (dbResult.flags && dbResult.flags._real_total_points) ?
                parseFloat(dbResult.flags._real_total_points) : dbResult.total_points,
            passScore: dbResult.pass_score,
            passed: dbResult.passed,
            answers: dbResult.answers,
            submittedAt: dbResult.submitted_at,
            studentName: studentName,
            flags: dbResult.flags || {},
            status: status,
            theoryScores: (dbResult.flags && dbResult.flags._theoryScores) ? dbResult.flags._theoryScores : {},
            ...this._mapResultExamSnapshot(dbResult)
        };
    };

    ds._mapResultSummary = function(dbResult) {
        if (!dbResult) return null;

        let status = 'completed';
        if (dbResult.flags && dbResult.flags._status) {
            status = dbResult.flags._status;
        }

        // V2E: Full fallback chain for student name — same as _mapResult
        let studentName = 'Unknown';
        if (dbResult.expand && dbResult.expand.student_id) {
            const expanded = dbResult.expand.student_id;
            studentName = expanded.full_name || expanded.name || expanded.username || 'Unknown';
        }
        if (studentName === 'Unknown' && dbResult.flags && dbResult.flags._studentName) {
            studentName = dbResult.flags._studentName;
        }
        if (studentName === 'Unknown') {
            console.warn(`[ResultIdentity] fallback source used: unknown for result ${dbResult.id}`);
        }

        return {
            id: dbResult.id,
            examId: dbResult.exam_id,
            studentId: dbResult.student_id,
            score: dbResult.score,
            totalPoints: (dbResult.flags && dbResult.flags._real_total_points) ?
                parseFloat(dbResult.flags._real_total_points) : dbResult.total_points,
            passScore: dbResult.pass_score,
            passed: dbResult.passed,
            answers: null,
            submittedAt: dbResult.submitted_at,
            studentName: studentName,
            flags: dbResult.flags || {},
            status: status,
            theoryScores: (dbResult.flags && dbResult.flags._theoryScores) ? dbResult.flags._theoryScores : {},
            ...this._mapResultExamSnapshot(dbResult)
        };
    };

    ds.getResultById = async function(resultId) {
        try {
            const result = await this.pb.collection('results').getOne(resultId);
            const mappedResult = this._mapResult(result);

            if (window.idb) {
                await window.idb.saveResults([mappedResult]);
            }

            return mappedResult;
        } catch (error) {
            if (window.idb) {
                try {
                    const cached = await window.idb.getResult(resultId);
                    if (cached) return cached;
                } catch (e) { /* ignore */ }
            }
            throw error;
        }
    };

    ds.backfillResultExamSnapshots = async function() {
        const resultRows = await this._rawList('results', {
            fullList: true,
            fields: 'id,exam_id,exam_title,exam_subject,exam_target_class,exam_duration,exam_has_theory,exam_theory_count'
        });

        const needsSnapshot = resultRows.filter(r =>
            !r.exam_title ||
            !r.exam_subject ||
            r.exam_duration === undefined ||
            r.exam_has_theory === undefined ||
            r.exam_theory_count === undefined
        );

        if (needsSnapshot.length === 0) {
            return { scanned: resultRows.length, updated: 0, skipped: 0 };
        }

        const examRows = await this._rawList('exams', {
            fullList: true,
            fields: 'id,title,subject,target_class,duration,has_theory,theory_count'
        });
        const examMap = new Map(examRows.map(exam => [exam.id, exam]));

        let updated = 0;
        let skipped = 0;
        for (const row of needsSnapshot) {
            const exam = examMap.get(row.exam_id);
            if (!exam) {
                skipped++;
                continue;
            }

            await this.pb.collection('results').update(
                row.id,
                this._buildResultExamSnapshot(exam)
            );
            updated++;
        }

        return { scanned: resultRows.length, updated, skipped };
    };

    ds.updateResult = async function(resultId, updates) {
        try {
            const data = {};
            if (updates.score !== undefined) data.score = updates.score;
            if (updates.totalPoints !== undefined) data.total_points = updates.totalPoints;
            if (updates.answers !== undefined) data.answers = updates.answers;
            if (updates.passScore !== undefined) data.pass_score = updates.passScore;
            if (updates.passed !== undefined) data.passed = updates.passed;

            // Handle theoryScores: store inside flags object
            if (updates.theoryScores !== undefined || updates.flags !== undefined) {
                // Fetch current flags to merge
                let currentFlags = {};
                try {
                    const existing = await this.pb.collection('results').getOne(resultId);
                    currentFlags = existing.flags || {};
                } catch (e) {
                    console.warn('Could not fetch current flags for merge:', e);
                }

                if (updates.flags !== undefined) {
                    currentFlags = { ...currentFlags, ...updates.flags };
                }
                if (updates.theoryScores !== undefined) {
                    currentFlags._theoryScores = updates.theoryScores;
                }
                data.flags = currentFlags;
            }

            const updated = await this.pb.collection('results').update(resultId, data);
            return this._mapResult(updated);
        } catch (error) {
            // If no data returned (auth issue), return success indicator
            if (error.status === 403) {
                return { id: resultId, ...updates };
            }
            throw error;
        }
    };

    ds.deleteResult = async function(resultId) {
        try {
            await this.pb.collection('results').delete(resultId);
            return true;
        } catch (error) {
            console.error('Failed to delete result:', error);
            throw error;
        }
    };

    ds.autoSubmitInProgressResult = async function(resultId) {
        try {
            const existing = await this.pb.collection('results').getOne(resultId);
            const currentFlags = existing.flags || {};
            const currentStatus = currentFlags._status || 'completed';

            if (currentStatus !== 'in-progress') {
                throw new Error('This exam is no longer in progress.');
            }

            const exam = await this.getExamById(existing.exam_id);
            if (!exam) {
                throw new Error('Exam details could not be loaded.');
            }

            const answers = existing.answers || {};
            const { score, totalPoints } = this._gradeExamAnswers(exam, answers);
            const objectiveScore = Number(score);
            const objectiveTotalPoints = Number(totalPoints);
            if (!Number.isFinite(objectiveScore) || !Number.isFinite(objectiveTotalPoints)) {
                throw new Error('Auto-submit grading returned an invalid score.');
            }

            const toFiniteNumber = (value) => {
                const parsed = Number(value);
                return Number.isFinite(parsed) ? parsed : null;
            };
            const hasTheoryScores = !!(currentFlags._theoryScores && Object.keys(currentFlags._theoryScores).length);
            const hasManualFlag = Object.keys(currentFlags).some(key => {
                const normalized = String(key || '').toLowerCase();
                return normalized.includes('manual') || normalized.includes('theorygraded');
            });
            const hasRealTotals =
                toFiniteNumber(currentFlags._real_total_points) !== null ||
                toFiniteNumber(currentFlags._real_points_scored) !== null;
            const hasManualOrTheoryMarkers = hasTheoryScores || hasManualFlag || hasRealTotals;

            let effectiveScorePoints = objectiveScore;
            let effectiveTotalPoints = objectiveTotalPoints;
            const existingRealTotalPoints = toFiniteNumber(currentFlags._real_total_points);
            const existingRealScorePoints = toFiniteNumber(currentFlags._real_points_scored);
            const previousObjectiveTotalPoints = toFiniteNumber(currentFlags._objective_total_points);
            const previousObjectiveScorePoints = toFiniteNumber(currentFlags._objective_points_scored);
            const canMergeManualTotals =
                hasManualOrTheoryMarkers &&
                existingRealTotalPoints !== null &&
                existingRealScorePoints !== null &&
                previousObjectiveTotalPoints !== null &&
                previousObjectiveScorePoints !== null;

            if (canMergeManualTotals) {
                effectiveScorePoints = existingRealScorePoints - previousObjectiveScorePoints + objectiveScore;
                effectiveTotalPoints = existingRealTotalPoints - previousObjectiveTotalPoints + objectiveTotalPoints;
            }

            const percentage = effectiveTotalPoints > 0 ? Math.round((effectiveScorePoints / effectiveTotalPoints) * 100) : 0;
            const passScore = exam.passScore ?? 50;

            const updatedFlags = {
                ...currentFlags,
                _status: 'completed',
                _studentName: currentFlags._studentName || '',
                _objective_total_points: objectiveTotalPoints,
                _objective_points_scored: objectiveScore,
                _real_total_points: effectiveTotalPoints,
                _real_points_scored: effectiveScorePoints
            };

            delete updatedFlags._savedProgress;
            delete updatedFlags._reopenedForExtension;
            delete updatedFlags._reopenedAt;
            delete updatedFlags._previousScore;
            delete updatedFlags._previousSubmittedAt;

            const updatePayload = {
                score: percentage,
                total_points: effectiveTotalPoints,
                pass_score: passScore,
                passed: percentage >= passScore,
                submitted_at: new Date().toISOString(),
                flags: updatedFlags,
                ...this._buildResultExamSnapshot(exam)
            };

            const updated = await this.pb.collection('results').update(resultId, updatePayload);

            return this._mapResult(updated);
        } catch (error) {
            console.error('Failed to auto-submit result:', error);
            throw error;
        }
    };

    // V2E: Backfill _studentName on old results that show "Unknown"
    ds.backfillResultStudentNames = async function() {
        let backfilled = 0;
        let skipped = 0;
        try {
            const results = await this.pb.collection('results').getFullList();

            // 1. Identify results that need backfilling
            const needsFix = results.filter(r =>
                !(r.flags && r.flags._studentName && r.flags._studentName !== '' && r.flags._studentName !== 'Unknown')
            );
            skipped = results.length - needsFix.length;

            if (needsFix.length === 0) {
                console.log('[ResultIdentity] All results already have _studentName');
                return { backfilled: 0, skipped };
            }

            console.log(`[ResultIdentity] ${needsFix.length} results need backfilling, ${skipped} already good`);

            // 2. Batch-fetch profiles for all unique student_ids
            const uniqueIds = [...new Set(needsFix.map(r => r.student_id).filter(Boolean))];
            const profileMap = new Map();

            const CHUNK = 50;
            for (let i = 0; i < uniqueIds.length; i += CHUNK) {
                const chunk = uniqueIds.slice(i, i + CHUNK);
                const filter = chunk.map(id => `id="${id}"`).join(' || ');
                try {
                    const profiles = await this.pb.collection('profiles').getFullList({ filter });
                    for (const p of profiles) {
                        const name = p.full_name || p.name || p.username || p.email || '';
                        if (name) profileMap.set(p.id, name);
                    }
                } catch (e) {
                    console.warn('[ResultIdentity] Profile chunk fetch failed:', e.message);
                }
            }

            console.log(`[ResultIdentity] Resolved ${profileMap.size} profiles from ${uniqueIds.length} unique student IDs`);

            // 3. Update each result with the resolved name
            for (const r of needsFix) {
                const name = profileMap.get(r.student_id);
                if (name) {
                    try {
                        const updatedFlags = { ...(r.flags || {}), _studentName: name };
                        await this.pb.collection('results').update(r.id, { flags: updatedFlags });
                        backfilled++;
                    } catch (e) {
                        console.warn(`[ResultIdentity] Failed to update ${r.id}:`, e.message);
                        skipped++;
                    }
                } else {
                    skipped++;
                }
            }
        } catch (e) {
            console.error('[ResultIdentity] Backfill failed:', e);
        }
        console.log(`[ResultIdentity] Backfill complete: ${backfilled} updated, ${skipped} skipped`);
        return { backfilled, skipped };
    };

    ds.reopenResultForExtension = async function(examId, studentId = null) {
        let reopened = 0;
        try {
            let filter = `exam_id="${examId}"`;
            if (studentId) {
                filter += ` && student_id="${studentId}"`;
            }
            const results = await this.pb.collection('results').getFullList({ filter });
            const completed = results.filter(r => r.flags && r.flags._status === 'completed');

            for (const r of completed) {
                try {
                    const updatedFlags = {
                        ...r.flags,
                        _status: 'in-progress',
                        _reopenedForExtension: true,
                        _reopenedAt: new Date().toISOString(),
                        _previousScore: r.score,
                        _previousSubmittedAt: r.submitted_at
                    };
                    await this.pb.collection('results').update(r.id, {
                        flags: updatedFlags,
                        submitted_at: ''
                    });
                    reopened++;
                    console.log(`[Extension] Reopened result ${r.id} for student ${r.student_id}`);
                } catch (e) {
                    console.warn(`[Extension] Failed to reopen result ${r.id}:`, e.message);
                }
            }
        } catch (e) {
            console.error('[Extension] reopenResultForExtension failed:', e);
        }
        return reopened;
    };

    // --- Progress Sync ---

    ds.syncProgressToServer = async function(examId, studentId, answers, flagged, currentQuestionIndex) {
        try {
            const existing = await this.pb.collection('results').getFirstListItem(
                `exam_id="${examId}" && student_id="${studentId}"`
            );
            if (existing && existing.flags && existing.flags._status === 'in-progress') {
                const updatedFlags = {
                    ...existing.flags,
                    _savedProgress: { flagged: flagged || {}, currentQuestionIndex: currentQuestionIndex || 0 }
                };
                await this.pb.collection('results').update(existing.id, {
                    answers: answers,
                    flags: updatedFlags
                });
                return true;
            }
        } catch (e) {
            // Not critical — client-side stores are primary
            console.warn('[Resume] Server progress sync failed:', e.message || e);
        }
        return false;
    };

    ds.loadServerProgress = async function(examId, studentId) {
        try {
            const existing = await this.pb.collection('results').getFirstListItem(
                `exam_id="${examId}" && student_id="${studentId}"`
            );
            if (existing && existing.flags && existing.flags._status === 'in-progress' && existing.answers) {
                const answerCount = Object.keys(existing.answers).length;
                if (answerCount > 0) {
                    console.log(`[Resume] Loaded ${answerCount} answers from server-side result`);
                    const savedProgress = existing.flags._savedProgress || {};
                    return {
                        answers: existing.answers,
                        flagged: savedProgress.flagged || {},
                        currentQuestionIndex: savedProgress.currentQuestionIndex || 0,
                        _reopenedForExtension: !!existing.flags._reopenedForExtension
                    };
                }
            }
        } catch (e) {
            console.warn('[Resume] Server progress load failed:', e.message || e);
        }
        return null;
    };

    // --- Offline Prep ---

    ds.prepareOfflineData = async function(teacherId) {
        if (!navigator.onLine) throw new Error('Must be online to prepare device.');

        try {
            // Fetch students
            const students = await this.pb.collection('profiles').getFullList({
                filter: 'role="student"'
            });

            // Fetch active exams
            const exams = await this.pb.collection('exams').getFullList({
                filter: 'status!="draft"'
            });

            // Cache students
            const offlineUsers = students.map(s => ({
                id: s.id,
                username: s.username || s.full_name,
                full_name: s.full_name,
                role: 'student',
                class_level: s.class_level,
                email: s.email
            }));

            localStorage.setItem('cbt_offline_users', JSON.stringify(offlineUsers));

            // Cache exams
            const examCache = {};
            exams.forEach(e => {
                examCache[e.id] = this._mapExam(e);
            });
            localStorage.setItem('cbt_exam_cache', JSON.stringify(examCache));

            return { students: offlineUsers.length, exams: exams.length };
        } catch (error) {
            throw error;
        }
    };

    // --- Pending Submission Queue ---
    //
    // Queued submissions historically lived in TWO stores that never agreed:
    // saveResult() wrote to both IndexedDB and localStorage, while the takeExam
    // fallback wrote to localStorage only. The sync then read IndexedDB alone and
    // finished by blanket-overwriting localStorage with its own failure list —
    // silently destroying any localStorage-only submission before it was ever sent.
    //
    // These helpers make the two stores one logical queue: reads merge both, writes
    // go to one, and removals clear both.

    const PENDING_LS_KEY = 'cbt_pending_submissions';

    ds._pendingIdentity = function(p) {
        return `${p.exam_id || p.examId || ''}|${p.student_id || p.studentId || ''}`;
    };

    ds._readLocalStoragePending = function() {
        try {
            const raw = JSON.parse(localStorage.getItem(PENDING_LS_KEY) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch (e) {
            console.warn('[PendingSync] localStorage queue unreadable, treating as empty:', e);
            return [];
        }
    };

    // Single write path. Prefers IndexedDB (no 5MB cap — exam answers can be large)
    // and falls back to localStorage, but never writes both.
    ds.queuePendingSubmission = async function(payload) {
        if (window.idb && window.idb.isIndexedDBAvailable()) {
            try {
                await window.idb.queuePendingSubmission(payload);
                return 'idb';
            } catch (e) {
                console.warn('[PendingSync] IndexedDB queue failed, falling back to localStorage:', e);
            }
        }

        const pending = this._readLocalStoragePending();
        pending.push({ ...payload, _local_id: payload._local_id || Date.now() });
        localStorage.setItem(PENDING_LS_KEY, JSON.stringify(pending));
        return 'localStorage';
    };

    // Merges both stores into one list of { source, payload } entries.
    ds._loadPendingQueue = async function() {
        const entries = [];

        if (window.idb && window.idb.isIndexedDBAvailable()) {
            try {
                const idbItems = await window.idb.getPendingSubmissions();
                for (const payload of idbItems) {
                    entries.push({ source: 'idb', storageKey: payload.localId, payload });
                }
            } catch (e) {
                console.warn('[PendingSync] Could not read IndexedDB queue:', e);
            }
        }

        for (const payload of this._readLocalStoragePending()) {
            entries.push({ source: 'ls', storageKey: payload._local_id, payload });
        }

        return entries;
    };

    // Clears an identity from BOTH stores. Only one results row can exist per
    // exam+student, so identity is the correct unit of removal.
    ds._removePendingIdentities = async function(entries) {
        const idbKeys = entries
            .filter(e => e.source === 'idb' && e.storageKey != null)
            .map(e => e.storageKey);

        for (const key of idbKeys) {
            try {
                await window.idb.removePendingSubmission(key);
            } catch (e) {
                console.warn('[PendingSync] Could not remove synced submission from IndexedDB:', e);
            }
        }

        const removedIdentities = new Set(
            entries.filter(e => e.source === 'ls').map(e => this._pendingIdentity(e.payload))
        );

        if (removedIdentities.size === 0) return;

        try {
            // Re-read rather than reusing the snapshot, so a submission queued
            // while this sync was running is not clobbered.
            const current = this._readLocalStoragePending();
            const remaining = current.filter(p => !removedIdentities.has(this._pendingIdentity(p)));
            localStorage.setItem(PENDING_LS_KEY, JSON.stringify(remaining));
        } catch (e) {
            console.warn('[PendingSync] Could not prune localStorage queue:', e);
        }
    };

    ds.syncPendingResults = async function() {
        if (!navigator.onLine) return { synced: 0, pending: 0 };

        // Re-entrancy guard: the driver, the `online` event and the service worker
        // can all fire at once. Two concurrent runs would race on the same rows and
        // double-create results.
        if (ds._syncInFlight) {
            console.log('[PendingSync] Sync already running, skipping duplicate call');
            return ds._syncInFlight;
        }

        ds._syncInFlight = (async () => {
            try {
                return await ds._runPendingSync();
            } finally {
                ds._syncInFlight = null;
            }
        })();

        return ds._syncInFlight;
    };

    ds._runPendingSync = async function() {
        const entries = await this._loadPendingQueue();

        if (entries.length === 0) return { synced: 0, pending: 0 };

        // Group by exam+student. The same submission can legitimately appear in both
        // stores (older builds double-wrote), and only one results row can exist per
        // pair — so sync the newest payload once and clear every copy of it.
        const groups = new Map();
        for (const entry of entries) {
            const identity = this._pendingIdentity(entry.payload);
            if (!groups.has(identity)) {
                groups.set(identity, { payload: entry.payload, entries: [] });
            }
            const group = groups.get(identity);
            group.entries.push(entry);

            const currentAt = Date.parse(group.payload.submitted_at || group.payload.submittedAt || 0) || 0;
            const candidateAt = Date.parse(entry.payload.submitted_at || entry.payload.submittedAt || 0) || 0;
            if (candidateAt > currentAt) group.payload = entry.payload;
        }

        console.log(`📤 Syncing ${groups.size} pending submission(s) from ${entries.length} queued cop${entries.length === 1 ? 'y' : 'ies'}...`);
        let syncedCount = 0;
        let failedCount = 0;

        for (const group of groups.values()) {
            const submission = group.payload;
            try {
                const { _local_id, localId, timestamp, synced, cachedAt, ...cleanPayload } = submission;

                // `??` not `||` — a legitimately low pass mark must not be swallowed,
                // and 50 is the fallback only when nothing was recorded at all.
                const rawPassScore = cleanPayload.pass_score ?? cleanPayload.passScore;
                const passScore = Number.isFinite(Number(rawPassScore)) ? Number(rawPassScore) : 50;
                const passed = cleanPayload.passed ?? (Number(cleanPayload.score) >= passScore);

                const data = {
                    exam_id: cleanPayload.exam_id || cleanPayload.examId,
                    student_id: cleanPayload.student_id || cleanPayload.studentId,
                    score: cleanPayload.score,
                    total_points: cleanPayload.total_points || cleanPayload.totalPoints,
                    pass_score: passScore,
                    passed,
                    answers: cleanPayload.answers,
                    flags: cleanPayload.flags || {},
                    submitted_at: cleanPayload.submitted_at || cleanPayload.submittedAt || new Date().toISOString(),
                    exam_title: cleanPayload.exam_title || cleanPayload.examTitle || '',
                    exam_subject: cleanPayload.exam_subject || cleanPayload.examSubject || '',
                    exam_target_class: cleanPayload.exam_target_class || cleanPayload.examTargetClass || '',
                    exam_duration: cleanPayload.exam_duration ?? cleanPayload.examDuration ?? null,
                    exam_has_theory: cleanPayload.exam_has_theory ?? cleanPayload.examHasTheory ?? false,
                    exam_theory_count: cleanPayload.exam_theory_count ?? cleanPayload.examTheoryCount ?? 0
                };

                {
                    // A lookup failure here throws to the outer catch and the submission
                    // stays queued for the next attempt. Creating on an unknown lookup
                    // result would duplicate the row — and because this runs unattended,
                    // nobody would notice until the scores looked wrong.
                    const existing = await this._findExistingResult(data.exam_id, data.student_id);

                    if (existing) {
                        await this.pb.collection('results').update(existing.id, data);
                    } else {
                        await this.pb.collection('results').create(data);
                    }
                    syncedCount++;
                }

                // Only now that the server has accepted it is it safe to drop the
                // local copies — and every copy goes, across both stores.
                await this._removePendingIdentities(group.entries);
            } catch (err) {
                // Leave the entry exactly where it is. It will be retried on the next
                // driver tick. Nothing is rewritten, so nothing can be lost here.
                console.error('Failed to sync submission:', submission, err);
                failedCount++;
            }
        }

        console.log(`✅ Sync complete: ${syncedCount} sent, ${failedCount} still pending`);
        return { synced: syncedCount, pending: failedCount };
    };

    // --- Pending Sync Driver ---
    //
    // Historically syncPendingResults() was only ever called from a
    // window 'online' listener. On a slow-but-alive connection the browser never
    // goes offline, so that event never fires and a queued submission sat in
    // IndexedDB forever — leaving the score-0 placeholder row that
    // startExamSession() created as the student's permanent result.
    //
    // This driver retries on its own: immediately, on an interval while anything
    // is still queued, when the tab regains focus, and on the 'online' event.
    ds.startPendingSyncDriver = function(options = {}) {
        if (ds._syncDriverStarted) return;
        ds._syncDriverStarted = true;

        const intervalMs = options.intervalMs || 60000;
        const onSynced = typeof options.onSynced === 'function' ? options.onSynced : null;

        const attempt = async (trigger) => {
            if (!navigator.onLine) return;
            // Syncing writes to the results collection — pointless (and noisy) without auth.
            if (!ds.pb || !ds.pb.authStore || !ds.pb.authStore.isValid) return;

            try {
                const { synced, pending } = await ds.syncPendingResults();
                if (synced > 0) {
                    console.log(`[PendingSync] ${synced} submission(s) synced (trigger: ${trigger})`);
                    if (onSynced) {
                        try { onSynced(synced, pending); } catch (e) { console.warn('[PendingSync] onSynced handler failed:', e); }
                    }
                }
            } catch (err) {
                // Never let a sync failure break the page — it retries on the next tick.
                console.warn(`[PendingSync] Attempt failed (trigger: ${trigger}):`, err);
            }
        };

        attempt('startup');

        ds._syncDriverTimer = setInterval(() => attempt('interval'), intervalMs);

        window.addEventListener('online', () => attempt('online'));

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') attempt('visibility');
        });

        return () => {
            if (ds._syncDriverTimer) clearInterval(ds._syncDriverTimer);
            ds._syncDriverTimer = null;
            ds._syncDriverStarted = false;
        };
    };

    // --- One-time IDB Migration ---

    (async function _v2abcMigration() {
        const FLAG = 'v2abc_idb_cleanup_done';
        if (localStorage.getItem(FLAG)) return;
        if (!window.idb || !window.idb.isIndexedDBAvailable()) {
            localStorage.setItem(FLAG, '1');
            return;
        }
        try {
            console.log('[V2ABC] Running one-time IDB cleanup...');
            await window.idb.clearExams();
            const db = await window.idb.openDB();
            const tx = db.transaction('dashboardCache', 'readwrite');
            tx.objectStore('dashboardCache').clear();
            await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
            console.log('[V2ABC] IDB cleanup complete — fresh data will be fetched on next dashboard load');
        } catch (e) {
            console.warn('[V2ABC] IDB cleanup error (non-fatal):', e);
        }
        localStorage.setItem(FLAG, '1');
    })();

    // --- Local Cache Helper ---

    ds._updateLocalCache = async function(type, action, item) {
        try {
            const db = await this.getDB();
            const tx = db.transaction('store', 'readwrite');
            const store = tx.objectStore('store');

            const request = store.openCursor();

            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const { cacheKey, data: rawData } = cursor.value;

                    if (cacheKey.includes('?')) {
                        const isWrapped = rawData && rawData.data;
                        let data = isWrapped ? rawData.data : rawData;

                        if (!Array.isArray(data)) {
                            cursor.continue();
                            return;
                        }

                        let shouldUpdate = false;

                        if (type === 'exam') {
                            if (action === 'update' || action === 'create') {
                                const index = data.findIndex(e => e.id === item.id);
                                if (index !== -1) {
                                    data[index] = { ...data[index], ...item };
                                    shouldUpdate = true;
                                } else if (action === 'create') {
                                    data.unshift(item);
                                    shouldUpdate = true;
                                }
                            } else if (action === 'delete') {
                                const index = data.findIndex(e => e.id === item);
                                if (index !== -1) {
                                    data.splice(index, 1);
                                    shouldUpdate = true;
                                }
                            }
                        } else if (type === 'result') {
                            if (action === 'create' || action === 'update') {
                                const index = data.findIndex(e => e.id === item.id);
                                if (index !== -1) {
                                    data[index] = { ...data[index], ...item };
                                    shouldUpdate = true;
                                } else {
                                    data.unshift(item);
                                    shouldUpdate = true;
                                }
                            }
                        }

                        if (shouldUpdate) {
                            let finalData = isWrapped ? { ...rawData, data: data } : data;

                            cursor.update({
                                cacheKey: cacheKey,
                                data: finalData,
                                cachedAt: Date.now()
                            });
                            console.log(`✅ Cache updated for ${cacheKey}`);
                        }
                    }

                    cursor.continue();
                }
            };
        } catch (err) {
            console.warn('Failed to update local cache:', err);
        }
    };

})(window.dataService);
