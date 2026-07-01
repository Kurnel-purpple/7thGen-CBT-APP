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
                fields: 'id,title,subject,target_class,duration,pass_score,status,created_by,created,updated,scheduled_date,scramble_questions,question_count,has_theory,theory_count,extensions,global_extension,school_level,theory_instructions',
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

    ds.getExamById = async function(id, summaryUpdatedAt) {
        const _p = _perf.start('getExamById');
        // 1. Try IDB first with freshness check
        if (window.idb) {
            try {
                const cachedExam = await window.idb.getExam(id);
                if (cachedExam) {
                    // Reject summaries that leaked into the exams store (questions is null/missing)
                    if (!Array.isArray(cachedExam.questions) || cachedExam.questions.length === 0) {
                        console.warn(`⚠️ Exam ${id} in IDB has no questions (likely a summary), skipping cache`);
                        // Clean up the polluted entry
                        try { await window.idb.deleteExam(id); } catch (_) { /* best effort cleanup */ }
                    } else if (summaryUpdatedAt && cachedExam.updatedAt === summaryUpdatedAt) {
                        // If we have a summary timestamp, check freshness
                        console.log(`📦 Serving exam ${id} from IDB (fresh)`);
                        _perf.end(_p, { source: 'cache-fresh' });
                        return cachedExam;
                    } else if (!summaryUpdatedAt) {
                        // No summary to compare — serve cached as before
                        console.log(`📦 Serving exam ${id} from IDB`);
                        _perf.end(_p, { source: 'cache' });
                        return cachedExam;
                    } else {
                        // Summary is newer — fall through to network fetch
                        console.log(`🔄 Exam ${id} stale in IDB, fetching fresh...`);
                    }
                }
            } catch (e) { console.warn(e); }
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
            theoryCount: dbExam.theory_count ?? questions.filter(q => q.type === 'theory').length
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
            theoryCount: dbExam.theory_count || 0
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
            const totalPoints = Number(objectiveTotalPoints) + Number(theoryTotalPoints);
            const pointsScored = Number(objectivePoints) + Number(theoryPoints);
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
        const data = {
            exam_id: resultData.examId,
            student_id: resultData.studentId,
            score: resultData.score,
            total_points: resultData.totalPoints,
            answers: resultData.answers,
            flags,
            submitted_at: new Date().toISOString(),
            ...examSnapshot
        };

        try {
            // Try to find existing result first
            let result;
            try {
                const existing = await this.pb.collection('results').getFirstListItem(
                    `exam_id="${resultData.examId}" && student_id="${resultData.studentId}"`
                );
                // Update existing
                const updated = await this.pb.collection('results').update(existing.id, data);
                result = this._mapResult(updated);
            } catch (notFoundErr) {
                // Create new
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
            if (!navigator.onLine || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
                data._local_id = Date.now();
                pending.push(data);
                localStorage.setItem('cbt_pending_submissions', JSON.stringify(pending));

                // Also save to IDB Pending
                if (window.idb) {
                    await window.idb.queuePendingSubmission(data);
                }

                throw new Error('Saved Offline');
            }
            throw err;
        }
    };

    ds.startExamSession = async function(examId, studentId, studentName) {
        try {
            // Check if exists
            try {
                const existing = await this.pb.collection('results').getFirstListItem(
                    `exam_id="${examId}" && student_id="${studentId}"`
                );
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
            } catch (notFoundErr) {
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
            }
        } catch (error) {
            console.error('Failed to start session', error);
        }
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
                        return cached.data;
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
            if (window.idb && mappedResults.length > 0) {
                await window.idb.saveDashboardCache(cacheKey, mappedResults);
                await window.idb.saveResults(mappedResults);
            }

            return mappedResults;
        } catch (error) {
            // Fallback
            if (window.idb) {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached) return cached.data;
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
                        return cached.data;
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

            const results = await this._rawList('results', options);
            const mappedResults = results.map(r => this._mapResultSummary(r));

            if (window.idb && mappedResults.length > 0) {
                await window.idb.saveDashboardCache(cacheKey, mappedResults);
            }

            _perf.end(_p, { source: 'network', count: mappedResults.length, size: JSON.stringify(mappedResults).length });
            return mappedResults;
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

    ds.syncPendingResults = async function() {
        if (!navigator.onLine) return { synced: 0, pending: 0 };

        const useIndexedDB = window.idb && window.idb.isIndexedDBAvailable();
        let pending = [];

        // Get pending submissions
        if (useIndexedDB) {
            try {
                pending = await window.idb.getPendingSubmissions();
            } catch (err) {
                console.warn('Could not read from IndexedDB, trying localStorage:', err);
                pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
            }
        } else {
            pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
        }

        if (pending.length === 0) return { synced: 0, pending: 0 };

        console.log(`📤 Syncing ${pending.length} pending submissions...`);
        const failed = [];
        let syncedCount = 0;

        for (const submission of pending) {
            try {
                const { _local_id, localId, timestamp, synced, cachedAt, ...cleanPayload } = submission;

                const data = {
                    exam_id: cleanPayload.exam_id || cleanPayload.examId,
                    student_id: cleanPayload.student_id || cleanPayload.studentId,
                    score: cleanPayload.score,
                    total_points: cleanPayload.total_points || cleanPayload.totalPoints,
                    pass_score: cleanPayload.pass_score || cleanPayload.passScore,
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

                try {
                    // Check if already exists
                    const existing = await this.pb.collection('results').getFirstListItem(
                        `exam_id="${data.exam_id}" && student_id="${data.student_id}"`
                    );
                    // Update existing
                    await this.pb.collection('results').update(existing.id, data);
                    syncedCount++;
                } catch (notFoundErr) {
                    // Create new
                    await this.pb.collection('results').create(data);
                    syncedCount++;
                }

                // Remove from IndexedDB if using it
                if (useIndexedDB && submission.localId) {
                    try {
                        await window.idb.removePendingSubmission(submission.localId);
                    } catch (e) {
                        console.warn('Could not remove synced submission from IndexedDB:', e);
                    }
                }
            } catch (err) {
                console.error('Failed to sync submission:', submission, err);
                failed.push(submission);
            }
        }

        // Update storage with failed submissions only
        localStorage.setItem('cbt_pending_submissions', JSON.stringify(failed));

        console.log(`✅ Sync complete: ${syncedCount} sent, ${failed.length} pending`);
        return { synced: syncedCount, pending: failed.length };
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
