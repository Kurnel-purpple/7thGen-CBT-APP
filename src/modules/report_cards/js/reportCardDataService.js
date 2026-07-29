/**
 * Report Card Data Service
 * Extends window.dataService with report-card-specific functionality.
 * Aggregates exam results, attendance, and rankings into per-student term reports.
 * Uses PocketBase when the collection exists, with localStorage fallback.
 */

(function(ds) {
    if (!ds) {
        console.error('[reportCardDataService] window.dataService not found — load dataService.js first');
        return;
    }

    var COLLECTION = 'report_cards';
    var STORAGE_KEY = 'report_cards.local_store';
    var _collectionMissing = false; // Cache the 404 state to avoid spamming PocketBase

    function isMissingCollection(error) {
        var statusCode = error?.status ?? error?.statusCode;
        var message = String(error?.message || '').toLowerCase();
        return statusCode === 404 || message.includes('404') || message.includes('not found') || message.includes('missing');
    }

    function markCollectionMissing() {
        if (!_collectionMissing) {
            _collectionMissing = true;
            console.warn('[ReportCards] Collection "' + COLLECTION + '" not found on server — using localStorage for this session.');
        }
    }

    function readLocalReportCards() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            console.warn('[ReportCards] Failed to read local store:', e);
            return [];
        }
    }

    function writeLocalReportCards(items) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        } catch (e) {
            console.error('[ReportCards] Failed to write local store:', e);
            throw e;
        }
    }

    function mapReportCard(record) {
        if (!record) return null;
        return {
            id: record.id,
            studentId: record.student_id || '',
            studentName: record.student_name || '',
            classLevel: record.class_level || '',
            term: record.term || '',
            session: record.session || '',
            schoolVersion: record.school_version || '',
            subjects: record.subjects || [],
            totalScore: record.total_score ?? 0,
            averageScore: record.average_score ?? 0,
            classPosition: record.class_position ?? null,
            classSize: record.class_size ?? null,
            attendance: record.attendance || {},
            teacherRemarks: record.teacher_remarks || '',
            principalRemarks: record.principal_remarks || '',
            status: record.status || 'draft',
            generatedBy: record.generated_by || '',
            generatedAt: record.generated_at || record.created || null,
            publishedAt: record.published_at || null,
            createdAt: record.created || record.createdAt || null,
            updatedAt: record.updated || record.updatedAt || null
        };
    }

    function serializeReportCard(card) {
        return {
            student_id: card.studentId || '',
            student_name: card.studentName || '',
            class_level: card.classLevel || '',
            term: card.term || '',
            session: card.session || '',
            school_version: card.schoolVersion || '',
            subjects: card.subjects || [],
            total_score: card.totalScore ?? 0,
            average_score: card.averageScore ?? 0,
            class_position: card.classPosition ?? null,
            class_size: card.classSize ?? null,
            attendance: card.attendance || {},
            teacher_remarks: card.teacherRemarks || '',
            principal_remarks: card.principalRemarks || '',
            status: card.status || 'draft',
            generated_by: card.generatedBy || '',
            generated_at: card.generatedAt || new Date().toISOString(),
            published_at: card.publishedAt || null
        };
    }

    // ================================================================
    // GRADING SNAPSHOT
    // Both bulk reads a generation needs, fetched once and shared.
    //
    // Report cards must grade from complete, live data — generating from a
    // partial result set, or without knowing which exams were deleted, quietly
    // writes wrong cards over good drafts. So both reads bypass the IndexedDB
    // caches (forceRefresh) and a failure aborts the whole run rather than
    // grading on what happened to arrive.
    //
    // That made every run re-download the entire school, including runs that
    // repeat a filter the user just generated. The snapshot below keeps the
    // fail-closed guarantee for the first run and then reuses it briefly, so
    // working down a list of classes — or re-running the same one — is instant.
    // The window is short enough that a freshly marked exam still lands.
    // ================================================================

    var SNAPSHOT_TTL_MS = 60 * 1000;
    var snapshotCache = null;   // { at, data }
    var snapshotInFlight = null;

    /** Drop the cache so the next generation refetches. */
    ds.invalidateReportCardSnapshot = function() {
        snapshotCache = null;
        snapshotInFlight = null;
    };

    async function fetchGradingSnapshot() {
        // Independent reads — no reason to wait for one before starting the other.
        var settled = await Promise.allSettled([
            ds.getResults({ forceRefresh: true }),
            ds.getExamSummaries({ includeDeleted: true, forceRefresh: true })
        ]);

        if (settled[0].status === 'rejected') {
            console.error('[ReportCards] Failed to fetch results:', settled[0].reason);
            throw new Error('Could not load exam results — report cards were NOT generated. Check your connection and try again.');
        }
        if (settled[1].status === 'rejected') {
            console.error('[ReportCards] Could not resolve deleted exams:', settled[1].reason);
            throw new Error('Could not verify which exams are deleted — report cards were NOT generated. Check your connection and try again.');
        }

        var results = settled[0].value || [];
        var exams = settled[1].value || [];

        // Results belonging to soft-deleted exams stay in the database for
        // record-keeping, but they must NOT grade report cards — a scrapped
        // exam's results were inflating subject totals (e.g. ICT at 42.6/60
        // when the only real ICT exam totals 30).
        var deletedExamIds = new Set();
        var examTitles = {};
        exams.forEach(function(ex) {
            if (!ex) return;
            if (ex.extensions && ex.extensions._deleted) deletedExamIds.add(ex.id);
            if (ex.id) examTitles[ex.id] = ex.title || '';
        });

        return { results: results, deletedExamIds: deletedExamIds, examTitles: examTitles };
    }

    function loadGradingSnapshot() {
        var fresh = snapshotCache && (Date.now() - snapshotCache.at) < SNAPSHOT_TTL_MS;
        if (fresh) return Promise.resolve(snapshotCache.data);

        // Concurrent generations share one round trip instead of racing.
        if (snapshotInFlight) return snapshotInFlight;

        snapshotInFlight = fetchGradingSnapshot().then(function(data) {
            snapshotCache = { at: Date.now(), data: data };
            snapshotInFlight = null;
            return data;
        }).catch(function(err) {
            snapshotInFlight = null;
            throw err;
        });

        return snapshotInFlight;
    }

    // ================================================================
    // AGGREGATE ENGINE — builds report card data from existing records
    // ================================================================

    /**
     * Build report card data for all students in a class for a given term.
     * Pulls exam results + attendance, computes per-subject scores and rankings.
     *
     * @param {Object} opts - { classLevel, term, session, dateRange: { start, end } }
     * @returns {Promise<Array>} Array of report card data objects (one per student)
     */
    ds.generateReportCardData = async function(opts) {
        var classLevel = opts.classLevel;
        var term = opts.term;
        var session = opts.session || '';
        var dateRange = opts.dateRange || {};

        // The grading snapshot does not depend on the roster, so start it now
        // and let it download while the class list resolves. The extra catch
        // keeps an early return below from surfacing as an unhandled rejection;
        // the real error is still raised where the snapshot is awaited.
        var snapshotPromise = loadGradingSnapshot();
        snapshotPromise.catch(function() { /* handled at the await */ });

        // 1. Get all students in this class
        var students = [];
        if (typeof ds.getClassStudents === 'function') {
            students = await ds.getClassStudents(classLevel);
        } else {
            var allUsers = await ds.getUsers({ role: 'student' });
            students = allUsers
                .filter(function(s) { return s.class_level === classLevel; })
                .map(function(s) {
                    return { id: s.user || s.id, name: s.full_name || s.username || 'Unknown', classLevel: s.class_level };
                });
        }

        if (students.length === 0) return [];

        // 2. The two bulk reads every generation needs: every result, and every
        //    exam (including soft-deleted ones). Fetched together — they do not
        //    depend on each other — and served from a short-lived cache so that
        //    generating class after class, or re-running the same filter, does
        //    not re-download the whole school each time.
        var snapshot = await snapshotPromise;
        var allResults = snapshot.results;
        var deletedExamIds = snapshot.deletedExamIds;

        // Exam titles for results whose snapshot is missing one. The exam list
        // above already carries every title, so this is a lookup rather than
        // the per-exam fetch it used to be — that loop pulled whole exams,
        // questions and embedded images included, one request at a time.
        var examTitleCache = snapshot.examTitles;

        // Term-signature detection — matches "1st term", "first term", "term 1", etc.
        // Returns which term (1, 2, 3) a text mentions, or null if it has no term signature.
        function detectTerm(text) {
            if (!text) return null;
            // Canonical mapping first (Utils.CBT_TERMS) — also catches bare
            // titles like "SECOND" or "2nd" that lack the word "term", which
            // otherwise leak into every term's report via include-by-default
            if (window.Utils && typeof Utils.normalizeTerm === 'function') {
                var canon = Utils.normalizeTerm(text);
                if (canon === '1st Term') return 1;
                if (canon === '2nd Term') return 2;
                if (canon === '3rd Term') return 3;
            }
            var t = String(text).toLowerCase();
            if (/\b(1st|first|one)\s*term\b|\bterm\s*(1|one)\b/.test(t)) return 1;
            if (/\b(2nd|second|two)\s*term\b|\bterm\s*(2|two)\b/.test(t)) return 2;
            if (/\b(3rd|third|three)\s*term\b|\bterm\s*(3|three)\b/.test(t)) return 3;
            return null;
        }
        var requestedTerm = detectTerm(term);

        // Filter to completed results for students in this class
        var studentIdSet = new Set(students.map(function(s) { return s.id; }));
        var classResults = allResults.filter(function(r) {
            if (!studentIdSet.has(r.studentId)) return false;
            if (r.status !== 'completed') return false;
            if (r.examId && deletedExamIds.has(r.examId)) return false;
            if (!term) return true;

            // 1. Explicit term field on result — exact match required
            if (r.term) {
                var rt = detectTerm(r.term);
                if (rt !== null && requestedTerm !== null) return rt === requestedTerm;
                return r.term.toLowerCase() === term.toLowerCase();
            }

            // 2. Check snapshot title; backfill from lookup if needed
            var title = r.examTitle || '';
            if (!title && r.examId && examTitleCache[r.examId]) {
                title = examTitleCache[r.examId];
                r.examTitle = title; // backfill for subject grouping
            }

            // 3. If the exam title carries a term signature, require it to match
            var examTermNum = detectTerm(title);
            if (examTermNum !== null) {
                return examTermNum === requestedTerm;
            }

            // 4. No term signature anywhere — include by default
            //    (exam titles often don't encode term; filtering them all out would empty the report)
            return true;
        });

        // De-duplicate: one result per (student, exam), keeping the most
        // recent submission. Offline-sync retries and retake flows can leave
        // duplicate records for the same exam, which double the subject's
        // score AND total (e.g. a 30-point ICT exam showing as /60).
        var dedupedByKey = {};
        classResults.forEach(function(r) {
            var key = r.studentId + '::' + (r.examId || (r.examSubject + '|' + r.examTitle));
            var prev = dedupedByKey[key];
            var rTime = new Date(r.submittedAt || 0).getTime() || 0;
            var pTime = prev ? (new Date(prev.submittedAt || 0).getTime() || 0) : -1;
            if (!prev || rTime >= pTime) dedupedByKey[key] = r;
        });
        classResults = Object.keys(dedupedByKey).map(function(k) { return dedupedByKey[k]; });

        // Diagnostic: which exams grade each subject (check DevTools console
        // when a subject total looks doubled — every contributing exam is listed)
        var subjectBreakdown = {};
        classResults.forEach(function(r) {
            var subj = r.examSubject || 'Unknown';
            var label = (r.examTitle || 'untitled') + ' [' + (r.examId || 'no-id') + '] /' + (r.totalPoints || 0) + 'pts';
            if (!subjectBreakdown[subj]) subjectBreakdown[subj] = {};
            subjectBreakdown[subj][label] = (subjectBreakdown[subj][label] || 0) + 1;
        });
        console.log('[ReportCards] Exams grading each subject:', subjectBreakdown);

        // 3. Group results by student, then by subject
        var studentSubjectScores = {};
        students.forEach(function(s) { studentSubjectScores[s.id] = {}; });

        // CA (continuous assessment) component of a result. Prefer the
        // dedicated CA field entered on the exam results page; fall back to
        // the legacy convention (manual theory score counted as CA) for
        // results saved before the CA input existed.
        function extractCaPoints(r) {
            var flags = (r && r.flags) || {};
            var ca = parseFloat(flags._caScore);
            if (isFinite(ca)) return ca;
            var manual = parseFloat(flags._manualTheoryScore);
            if (isFinite(manual)) return manual;
            var theoryScores = flags._theoryScores;
            if (theoryScores && typeof theoryScores === 'object') {
                var sum = 0;
                Object.keys(theoryScores).forEach(function(k) {
                    var v = parseFloat(theoryScores[k]);
                    if (isFinite(v)) sum += v;
                });
                return sum;
            }
            return 0;
        }

        // The CA component's maximum (the "40" in "CA / 40"). Stored alongside
        // the CA score when the exam was marked; results predating the CA
        // input have neither, and contribute 0 to both.
        function extractCaTotal(r) {
            var flags = (r && r.flags) || {};
            var caTotal = parseFloat(flags._caTotal);
            return isFinite(caTotal) ? caTotal : 0;
        }

        classResults.forEach(function(r) {
            var sid = r.studentId;
            var subject = r.examSubject || 'Unknown';
            if (!studentSubjectScores[sid]) studentSubjectScores[sid] = {};
            if (!studentSubjectScores[sid][subject]) {
                studentSubjectScores[sid][subject] = { scores: [], caScores: [], caTotals: [], totalPoints: [] };
            }
            // result.score is stored as a PERCENTAGE (0–100), not raw marks —
            // convert to raw points against the exam's total so subject sums
            // like "13.5 / 30" stay dimensionally sane (was producing 63/15).
            var rawPoints = ((r.score || 0) / 100) * (r.totalPoints || 0);
            rawPoints = Math.round(rawPoints * 10) / 10;
            // CA can never exceed what was actually scored on the result
            var caPoints = Math.min(extractCaPoints(r), rawPoints);
            studentSubjectScores[sid][subject].scores.push(rawPoints);
            studentSubjectScores[sid][subject].caScores.push(Math.round(caPoints * 10) / 10);
            studentSubjectScores[sid][subject].caTotals.push(extractCaTotal(r));
            studentSubjectScores[sid][subject].totalPoints.push(r.totalPoints || 0);
        });

        // 4. Get attendance stats if available
        var attendanceByStudent = {};
        if (dateRange.start && dateRange.end && typeof ds.getAttendanceStats === 'function') {
            try {
                var attendanceStats = await ds.getAttendanceStats(classLevel, dateRange.start, dateRange.end);
                if (attendanceStats && attendanceStats.students) {
                    attendanceStats.students.forEach(function(s) {
                        attendanceByStudent[s.studentId] = {
                            present: s.present || 0,
                            absent: s.absent || 0,
                            late: s.late || 0,
                            excused: s.excused || 0,
                            totalDays: s.totalDays || 0,
                            attendanceRate: s.attendanceRate || 0
                        };
                    });
                }
            } catch (e) {
                console.warn('[ReportCards] Attendance fetch failed (non-fatal):', e);
            }
        }

        // 5. Build per-student report card data
        var school = ds.getSchoolContext() || {};
        var reportCards = students.map(function(student) {
            var subjectMap = studentSubjectScores[student.id] || {};
            var subjects = Object.keys(subjectMap).map(function(subject) {
                var data = subjectMap[subject];
                var totalScore = data.scores.reduce(function(a, b) { return a + b; }, 0);
                totalScore = Math.round(totalScore * 10) / 10;
                var totalPossible = data.totalPoints.reduce(function(a, b) { return a + b; }, 0);
                var percentage = totalPossible > 0 ? Math.round((totalScore / totalPossible) * 100) : 0;
                var grade = computeGrade(percentage);
                var caScore = (data.caScores || []).reduce(function(a, b) { return a + b; }, 0);
                caScore = Math.round(caScore * 10) / 10;
                var examScore = Math.max(0, Math.round((totalScore - caScore) * 10) / 10);
                // Maxima for the report card's "CA / 40 | Exam / 60" columns.
                // result.totalPoints already includes the CA component, so the
                // exam's own maximum is whatever is left over.
                var caTotal = (data.caTotals || []).reduce(function(a, b) { return a + b; }, 0);
                caTotal = Math.round(caTotal * 10) / 10;
                var examTotal = Math.max(0, Math.round((totalPossible - caTotal) * 10) / 10);
                return {
                    name: subject,
                    score: totalScore,
                    caScore: caScore,
                    caTotal: caTotal,
                    examScore: examScore,
                    examTotal: examTotal,
                    totalPossible: totalPossible,
                    percentage: percentage,
                    grade: grade.letter,
                    gradeLabel: grade.label,
                    examCount: data.scores.length
                };
            });

            // Sort subjects alphabetically
            subjects.sort(function(a, b) { return a.name.localeCompare(b.name); });

            var totalPercentage = 0;
            if (subjects.length > 0) {
                var sumPct = subjects.reduce(function(acc, s) { return acc + s.percentage; }, 0);
                totalPercentage = Math.round(sumPct / subjects.length);
            }

            return {
                studentId: student.id,
                studentName: student.name,
                classLevel: classLevel,
                term: term,
                session: session,
                schoolVersion: school.schoolVersion || '',
                subjects: subjects,
                totalScore: subjects.reduce(function(acc, s) { return acc + s.score; }, 0),
                averageScore: totalPercentage,
                attendance: attendanceByStudent[student.id] || {},
                teacherRemarks: '',
                principalRemarks: '',
                status: 'draft',
                generatedBy: school.userId || '',
                generatedAt: new Date().toISOString()
            };
        });

        // 6. Compute class positions (rank by average score, highest first)
        var sorted = reportCards.slice().sort(function(a, b) { return b.averageScore - a.averageScore; });
        var classSize = reportCards.length;
        sorted.forEach(function(card, index) {
            // Handle ties — students with the same average get the same position
            if (index > 0 && card.averageScore === sorted[index - 1].averageScore) {
                card.classPosition = sorted[index - 1].classPosition;
            } else {
                card.classPosition = index + 1;
            }
            card.classSize = classSize;
        });

        return reportCards;
    };

    /**
     * Compute letter grade from percentage.
     */
    /**
     * The school's configured grading scale decides this — see
     * reportCardTemplate.js. The letter is stored on the card at generation
     * time, but the renderers ask again from the percentage, so editing the
     * scale corrects cards that are already out.
     *
     * The fallback only applies if the template module failed to load; it
     * mirrors the shipped default scale rather than inventing a second one.
     */
    function computeGrade(percentage) {
        if (typeof ds.gradeForPercentage === 'function') {
            return ds.gradeForPercentage(percentage);
        }
        if (percentage >= 96) return { letter: 'A++', label: 'Outstanding' };
        if (percentage >= 91) return { letter: 'A+', label: 'Excellent' };
        if (percentage >= 80) return { letter: 'A', label: 'Very Good' };
        if (percentage >= 70) return { letter: 'B+', label: 'Good' };
        if (percentage >= 60) return { letter: 'B', label: 'Credit' };
        if (percentage >= 50) return { letter: 'C+', label: 'Pass' };
        return { letter: 'C', label: 'Weak' };
    }

    // ================================================================
    // CRUD — save/load/publish report cards
    // ================================================================

    // Find previously saved card(s) for the same student/class/term/session,
    // newest first — regeneration must update in place, not stack duplicates.
    async function findExistingCards(payload) {
        if (_collectionMissing) return null;
        try {
            var f = 'student_id="' + payload.student_id + '" && class_level="' + payload.class_level + '" && term="' + payload.term + '"';
            if (payload.session) f += ' && session="' + payload.session + '"';
            if (payload.school_version) f += ' && school_version="' + payload.school_version + '"';
            var rows = await ds.pb.collection(COLLECTION).getFullList({ filter: f, sort: '-updated' });
            if (!rows || rows.length === 0) return null;
            return { keep: rows[0], extraIds: rows.slice(1).map(function(r) { return r.id; }) };
        } catch (error) {
            if (isMissingCollection(error)) markCollectionMissing();
            else console.warn('[ReportCards] Existing-card lookup failed:', error);
            return null;
        }
    }

    ds.saveReportCard = async function(cardData) {
        var school = ds.getSchoolContext() || {};
        var payload = serializeReportCard(cardData);
        payload.school_version = payload.school_version || school.schoolVersion || '';

        // Skip PocketBase if we already know the collection is missing
        if (!_collectionMissing) {
            try {
                // Upsert: a regenerated card has no id — adopt the stored
                // card's id (and its human-entered remarks) instead of
                // creating a duplicate draft
                if (!cardData.id) {
                    var existing = await findExistingCards(payload);
                    if (existing) {
                        cardData.id = existing.keep.id;
                        if (!payload.teacher_remarks) payload.teacher_remarks = existing.keep.teacher_remarks || '';
                        if (!payload.principal_remarks) payload.principal_remarks = existing.keep.principal_remarks || '';
                        // Sweep older duplicates left by previous generates
                        for (var d = 0; d < existing.extraIds.length; d++) {
                            try { await ds.pb.collection(COLLECTION).delete(existing.extraIds[d]); } catch (e) { /* best effort */ }
                        }
                    }
                }

                if (cardData.id) {
                    var updated = await ds.pb.collection(COLLECTION).update(cardData.id, payload);
                    return mapReportCard(updated);
                }
                var created = await ds.pb.collection(COLLECTION).create(payload);
                return mapReportCard(created);
            } catch (error) {
                if (!isMissingCollection(error)) throw error;
                markCollectionMissing();
            }
        }

        // localStorage fallback
        var localCards = readLocalReportCards();
        var now = new Date().toISOString();

        // Local upsert: match by id, or by student/class/term/session
        var idx = -1;
        if (cardData.id) {
            idx = localCards.findIndex(function(c) { return c.id === cardData.id; });
        }
        if (idx === -1) {
            idx = localCards.findIndex(function(c) {
                return c.student_id === payload.student_id &&
                    c.class_level === payload.class_level &&
                    c.term === payload.term &&
                    (c.session || '') === (payload.session || '');
            });
        }
        if (idx !== -1) {
            if (!payload.teacher_remarks) payload.teacher_remarks = localCards[idx].teacher_remarks || '';
            if (!payload.principal_remarks) payload.principal_remarks = localCards[idx].principal_remarks || '';
            localCards[idx] = { ...localCards[idx], ...payload, updated: now };
            writeLocalReportCards(localCards);
            return mapReportCard(localCards[idx]);
        }

        var localRecord = {
            id: 'rc-local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            ...payload,
            created: now,
            updated: now
        };
        localCards.unshift(localRecord);
        writeLocalReportCards(localCards);
        return mapReportCard(localRecord);
    };

    ds.saveReportCards = async function(cardsArray) {
        var saved = 0;
        var failed = 0;
        var results = [];

        for (var i = 0; i < cardsArray.length; i++) {
            try {
                var result = await ds.saveReportCard(cardsArray[i]);
                results.push(result);
                saved++;
            } catch (err) {
                console.warn('[ReportCards] Failed to save card for student ' + (cardsArray[i].studentName || i) + ':', err);
                failed++;
            }
        }

        return { saved: saved, failed: failed, results: results };
    };

    ds.getReportCards = async function(filters) {
        filters = filters || {};
        var school = ds.getSchoolContext() || {};
        var clauses = [];
        var params = {};

        var sv = filters.schoolVersion || school.schoolVersion || '';
        if (sv) {
            clauses.push('school_version = {:sv}');
            params.sv = sv;
        }
        if (filters.classLevel) {
            clauses.push('class_level = {:classLevel}');
            params.classLevel = filters.classLevel;
        }
        if (filters.term) {
            clauses.push('term = {:term}');
            params.term = filters.term;
        }
        if (filters.session) {
            clauses.push('session = {:session}');
            params.session = filters.session;
        }
        if (filters.studentId) {
            clauses.push('student_id = {:studentId}');
            params.studentId = filters.studentId;
        }
        if (filters.status) {
            clauses.push('status = {:status}');
            params.status = filters.status;
        }

        if (!_collectionMissing) {
            try {
                var filter = clauses.length > 0 ? ds.pb.filter(clauses.join(' && '), params) : '';
                var records = await ds.pb.collection(COLLECTION).getFullList({
                    filter: filter,
                    sort: 'student_name'
                });
                return records.map(mapReportCard);
            } catch (error) {
                if (!isMissingCollection(error)) throw error;
                markCollectionMissing();
            }
        }

        // localStorage fallback
        return readLocalReportCards()
            .map(mapReportCard)
            .filter(function(c) { return !sv || c.schoolVersion === sv; })
            .filter(function(c) { return !filters.classLevel || c.classLevel === filters.classLevel; })
            .filter(function(c) { return !filters.term || c.term === filters.term; })
            .filter(function(c) { return !filters.session || c.session === filters.session; })
            .filter(function(c) { return !filters.studentId || c.studentId === filters.studentId; })
            .filter(function(c) { return !filters.status || c.status === filters.status; })
            .sort(function(a, b) { return (a.studentName || '').localeCompare(b.studentName || ''); });
    };

    /**
     * One card by record id — what the printable document page loads from its
     * ?id= parameter. Returns null when the card does not exist.
     */
    ds.getReportCardById = async function(cardId) {
        if (!cardId) return null;

        if (!_collectionMissing) {
            try {
                var record = await ds.pb.collection(COLLECTION).getOne(String(cardId));
                return mapReportCard(record);
            } catch (error) {
                if (error && (error.status === 404 || error.status === 403)) return null;
                if (!isMissingCollection(error)) throw error;
                markCollectionMissing();
            }
        }

        var local = readLocalReportCards()
            .map(mapReportCard)
            .filter(function(c) { return String(c.id) === String(cardId); });
        return local[0] || null;
    };

    ds.publishReportCards = async function(cardIds) {
        var published = 0;
        var failed = 0;
        var now = new Date().toISOString();
        var updatePayload = { status: 'published', published_at: now };

        for (var i = 0; i < cardIds.length; i++) {
            if (!_collectionMissing) {
                try {
                    await ds.pb.collection(COLLECTION).update(cardIds[i], updatePayload);
                    published++;
                    continue;
                } catch (error) {
                    if (isMissingCollection(error)) {
                        markCollectionMissing();
                    } else {
                        console.warn('[ReportCards] Failed to publish card ' + cardIds[i] + ':', error);
                        failed++;
                        continue;
                    }
                }
            }

            // localStorage fallback
            var localCards = readLocalReportCards();
            var idx = localCards.findIndex(function(c) { return c.id === cardIds[i]; });
            if (idx !== -1) {
                localCards[idx].status = 'published';
                localCards[idx].published_at = now;
                localCards[idx].updated = now;
                writeLocalReportCards(localCards);
                published++;
            } else {
                console.warn('[ReportCards] Card not found in local store: ' + cardIds[i]);
                failed++;
            }
        }
        return { published: published, failed: failed };
    };

    ds.deleteReportCard = async function(cardId) {
        if (!cardId) return false;

        if (!_collectionMissing) {
            try {
                await ds.pb.collection(COLLECTION).delete(cardId);
                return true;
            } catch (error) {
                if (!isMissingCollection(error)) throw error;
                markCollectionMissing();
            }
        }

        // localStorage fallback
        var localCards = readLocalReportCards();
        var filtered = localCards.filter(function(c) { return c.id !== cardId; });
        if (filtered.length === localCards.length) return false;
        writeLocalReportCards(filtered);
        return true;
    };

    // ================================================================
    // ACCESS CODES — per-class 6-digit codes for report card access
    // ================================================================

    var ACCESS_CODE_KEY = 'report_cards.access_codes';

    function readAccessCodes() {
        try {
            var raw = localStorage.getItem(ACCESS_CODE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    function writeAccessCodes(codes) {
        localStorage.setItem(ACCESS_CODE_KEY, JSON.stringify(codes));
    }

    function generateCode() {
        var code = '';
        for (var i = 0; i < 6; i++) {
            code += Math.floor(Math.random() * 10);
        }
        return code;
    }

    /**
     * Get all access codes for the current school.
     * Returns { classLevel: code, ... }
     */
    ds.getReportCardAccessCodes = function() {
        var school = ds.getSchoolContext() || {};
        var sv = school.schoolVersion || 'default';
        var all = readAccessCodes();
        return all[sv] || {};
    };

    /**
     * Generate a new 6-digit code for a specific class.
     * @param {string} classLevel
     * @returns {string} the generated code
     */
    ds.generateReportCardAccessCode = function(classLevel) {
        var school = ds.getSchoolContext() || {};
        var sv = school.schoolVersion || 'default';
        var all = readAccessCodes();
        if (!all[sv]) all[sv] = {};
        var code = generateCode();
        all[sv][classLevel] = code;
        writeAccessCodes(all);
        return code;
    };

    /**
     * Remove an access code for a specific class.
     * @param {string} classLevel
     */
    ds.removeReportCardAccessCode = function(classLevel) {
        var school = ds.getSchoolContext() || {};
        var sv = school.schoolVersion || 'default';
        var all = readAccessCodes();
        if (all[sv]) {
            delete all[sv][classLevel];
            writeAccessCodes(all);
        }
    };

    /**
     * Verify an access code for a specific class.
     * @param {string} classLevel
     * @param {string} code
     * @returns {boolean}
     */
    ds.verifyReportCardAccessCode = function(classLevel, code) {
        var codes = ds.getReportCardAccessCodes();
        // If no code is set for this class, deny access
        if (!codes[classLevel]) return false;
        return codes[classLevel] === code;
    };

    /**
     * Check if a class has an access code set.
     * @param {string} classLevel
     * @returns {boolean}
     */
    ds.hasReportCardAccessCode = function(classLevel) {
        var codes = ds.getReportCardAccessCodes();
        return !!codes[classLevel];
    };

})(window.dataService);
