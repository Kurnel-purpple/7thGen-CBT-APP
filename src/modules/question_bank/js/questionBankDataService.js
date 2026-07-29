/**
 * Question Bank Data Service
 * Extends window.dataService with question-bank-specific functionality.
 * Uses PocketBase when the collection exists, with localStorage fallback while the backend catches up.
 */

(function(ds) {
    if (!ds) {
        console.error('[questionBankDataService] window.dataService not found - load dataService.js first');
        return;
    }

    const COLLECTION = 'question_bank_questions';
    const STORAGE_KEY = 'question_bank.local_questions';

    function isMissingCollection(error) {
        const statusCode = error?.status ?? error?.statusCode;
        const message = String(error?.message || '').toLowerCase();
        return statusCode === 404 || message.includes('404') || message.includes('not found') || message.includes('missing');
    }

    function readLocalQuestions() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (error) {
            console.warn('[QuestionBank] Failed to read local fallback store:', error);
            return [];
        }
    }

    function writeLocalQuestions(items) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        } catch (e) {
            console.error('[QuestionBank] Failed to write local questions — storage may be full:', e);
            throw e;
        }
    }

    function mapQuestion(record) {
        if (!record) return null;
        return {
            id: record.id,
            text: record.text || '',
            type: record.type || 'mcq',
            subject: record.subject || '',
            schoolLevel: record.school_level || '',
            targetClass: record.target_class || 'All',
            term: record.term || '',
            difficulty: record.difficulty || 'medium',
            points: Number(record.points || 1),
            options: Array.isArray(record.options) ? record.options : [],
            answer: record.answer || '',
            correctAnswer: record.correct_answer || '',
            pairs: Array.isArray(record.pairs) ? record.pairs : [],
            subQuestions: Array.isArray(record.sub_questions) ? record.sub_questions : [],
            children: Array.isArray(record.children) ? record.children : [],
            topInstruction: record.top_instruction || '',
            image: record.image || null,
            mediaAttachments: Array.isArray(record.media_attachments) ? record.media_attachments : [],
            explanation: record.explanation || '',
            tags: Array.isArray(record.tags) ? record.tags : [],
            schoolVersion: record.school_version || '',
            createdBy: record.created_by || '',
            source: record.source || 'question_bank',
            createdAt: record.created || record.createdAt || null,
            updatedAt: record.updated || record.updatedAt || null
        };
    }

    function serializeQuestion(question, schoolVersion, userId) {
        var data = {
            text: question.text || '',
            type: question.type || 'mcq',
            subject: question.subject || '',
            school_level: question.schoolLevel || '',
            target_class: question.targetClass || 'All',
            term: question.term || '',
            difficulty: question.difficulty || 'medium',
            points: Number(question.points || 1),
            options: Array.isArray(question.options) ? question.options : [],
            answer: question.answer || '',
            correct_answer: question.correctAnswer || '',
            pairs: Array.isArray(question.pairs) ? question.pairs : [],
            sub_questions: Array.isArray(question.subQuestions) ? question.subQuestions : [],
            children: Array.isArray(question.children) ? question.children : [],
            top_instruction: question.topInstruction || '',
            image: question.image || null,
            media_attachments: Array.isArray(question.mediaAttachments) ? question.mediaAttachments : [],
            explanation: question.explanation || '',
            tags: Array.isArray(question.tags) ? question.tags : [],
            school_version: schoolVersion || '',
            created_by: userId || '',
            source: question.source || 'question_bank'
        };
        return data;
    }

    ds.getQuestionBankQuestions = async function(filters = {}) {
        const school = this.getSchoolContext();
        const effectiveSchoolVersion = filters.schoolVersion || school.schoolVersion || '';
        const clauses = [];
        const params = {};

        if (effectiveSchoolVersion) {
            clauses.push('school_version = {:schoolVersion}');
            params.schoolVersion = effectiveSchoolVersion;
        }
        if (filters.createdBy) {
            clauses.push('created_by = {:createdBy}');
            params.createdBy = filters.createdBy;
        }
        if (filters.subject) {
            clauses.push('subject = {:subject}');
            params.subject = filters.subject;
        }
        if (filters.schoolLevel) {
            clauses.push('school_level = {:schoolLevel}');
            params.schoolLevel = filters.schoolLevel;
        }
        if (filters.targetClass) {
            clauses.push('target_class = {:targetClass}');
            params.targetClass = filters.targetClass;
        }
        if (filters.term) {
            clauses.push('term ~ {:term}');
            params.term = filters.term;
        }
        if (filters.difficulty) {
            clauses.push('difficulty = {:difficulty}');
            params.difficulty = filters.difficulty;
        }

        const filter = clauses.length > 0
            ? this.pb.filter(clauses.join(' && '), params)
            : '';

        try {
            const records = await this.pb.collection(COLLECTION).getFullList({
                filter,
                sort: '-created'
            });
            return records.map(mapQuestion);
        } catch (error) {
            if (!isMissingCollection(error)) {
                console.error('[QuestionBank] getQuestionBankQuestions error:', error);
                throw error;
            }

            return readLocalQuestions()
                .map(mapQuestion)
                .filter((item) => !effectiveSchoolVersion || item.schoolVersion === effectiveSchoolVersion)
                .filter((item) => !filters.createdBy || item.createdBy === filters.createdBy)
                .filter((item) => !filters.subject || item.subject === filters.subject)
                .filter((item) => !filters.schoolLevel || item.schoolLevel === filters.schoolLevel)
                .filter((item) => !filters.targetClass || item.targetClass === filters.targetClass)
                .filter((item) => !filters.term || (item.term || '').toLowerCase().includes(filters.term.toLowerCase()))
                .filter((item) => !filters.difficulty || item.difficulty === filters.difficulty)
                .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        }
    };

    ds.createQuestionBankQuestion = async function(question, options) {
        var skipDuplicateCheck = options && options.skipDuplicateCheck;
        var school = this.getSchoolContext();
        var payload = serializeQuestion(question, school.schoolVersion, school.userId);

        // Deduplication: check if a question with the same text+subject+type already exists
        if (!skipDuplicateCheck) {
            try {
                var existing = await this.findDuplicateQuestion(question);
                if (existing) {
                    console.log('[QuestionBank] Duplicate found (id=' + existing.id + '), skipping create');
                    // Flagged rather than returned bare: callers used to get the
                    // existing record back and report a successful save, so the
                    // teacher was told a question was added when nothing was.
                    var duplicate = mapQuestion(existing);
                    duplicate.wasDuplicate = true;
                    return duplicate;
                }
            } catch (dupErr) {
                // Don't block creation if duplicate check fails
                console.warn('[QuestionBank] Duplicate check failed, proceeding with create:', dupErr);
            }
        }

        try {
            var created = await this.pb.collection(COLLECTION).create(payload);
            return mapQuestion(created);
        } catch (error) {
            if (!isMissingCollection(error)) {
                console.error('[QuestionBank] createQuestionBankQuestion error:', error);
                throw error;
            }

            const localQuestions = readLocalQuestions();
            const now = new Date().toISOString();
            const localRecord = {
                id: `qb-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                ...payload,
                created: now,
                updated: now
            };
            localQuestions.unshift(localRecord);
            try {
                writeLocalQuestions(localQuestions);
            } catch (storageErr) {
                throw new Error('Failed to save question locally — storage may be full.');
            }
            return mapQuestion(localRecord);
        }
    };
    // ================================================================
    // DUPLICATE / NEAR-DUPLICATE DETECTION
    // ================================================================

    var SESSION_TERMS = ['1st Term', '2nd Term', '3rd Term'];

    function similarityEngine() {
        var engine = (typeof window !== 'undefined' && window.QuestionSimilarity) || null;
        if (!engine) {
            throw new Error('Question similarity engine not loaded — include questionSimilarity.js before questionBankDataService.js.');
        }
        return engine;
    }

    /**
     * An exam carries its term in its title ("2nd Term"), so the value handed
     * to us is only usable for scoping when it is one of the three real terms.
     * Anything else — "Mock Exam", "Revision Test", blank — yields '' and the
     * search widens to the whole subject rather than scoping to nonsense.
     */
    function termScope(term) {
        var value = String(term || '').trim();
        return SESSION_TERMS.indexOf(value) >= 0 ? value : '';
    }

    /**
     * The pool of bank questions a new question could duplicate.
     *
     * Scoped to the same school and subject, and to the same term when there
     * is a real one — an exam belongs to one term and one subject, so nothing
     * outside that can be the same question. Questions saved with no term are
     * always included: they were added by hand without a term and would
     * otherwise be invisible to every term-scoped search.
     *
     * Fetch this ONCE per (subject, term) and reuse it across a whole import
     * rather than querying per question.
     *
     * @param {Object} scope - { subject, term }
     * @returns {Promise<Array>} mapped question objects
     */
    ds.getSimilarityPool = async function(scope) {
        scope = scope || {};
        var subject = scope.subject || '';
        var term = termScope(scope.term);
        var school = this.getSchoolContext();
        var schoolVersion = school.schoolVersion || '';

        var clauses = [];
        var params = {};
        if (schoolVersion) {
            clauses.push('school_version = {:schoolVersion}');
            params.schoolVersion = schoolVersion;
        }
        if (subject) {
            clauses.push('subject = {:subject}');
            params.subject = subject;
        }
        if (term) {
            // Blank-term questions stay in scope — see the note above.
            clauses.push('(term = {:term} || term = "")');
            params.term = term;
        }

        try {
            var records = await this.pb.collection(COLLECTION).getFullList({
                filter: clauses.length ? this.pb.filter(clauses.join(' && '), params) : '',
                sort: '-created'
            });
            return records.map(mapQuestion);
        } catch (error) {
            if (!isMissingCollection(error)) throw error;

            return readLocalQuestions()
                .map(mapQuestion)
                .filter(function(item) {
                    if (schoolVersion && item.schoolVersion !== schoolVersion) return false;
                    if (subject && item.subject !== subject) return false;
                    if (term && item.term !== term && item.term !== '') return false;
                    return true;
                });
        }
    };

    /**
     * Near-duplicates of one question already in the bank.
     * @param {Object} question
     * @param {Object} [opts] - { pool, threshold, limit, excludeId }
     */
    ds.findSimilarQuestions = async function(question, opts) {
        opts = opts || {};
        var engine = similarityEngine();
        var pool = opts.pool || await this.getSimilarityPool({
            subject: question.subject,
            term: question.term
        });
        return engine.findMatches(question, pool, {
            threshold: opts.threshold,
            limit: opts.limit,
            excludeId: opts.excludeId || question.id
        });
    };

    /**
     * Groups of near-duplicate questions already sitting in the bank.
     *
     * Comparison is O(n²) within a group, so questions are bucketed by
     * subject+term first and only compared inside a bucket — which is also
     * the only place a duplicate can be.
     *
     * @param {Object} [filters] - passed to getQuestionBankQuestions
     * @returns {Promise<Array>} [{ subject, term, score, questions: [...] }]
     */
    ds.findDuplicateClusters = async function(filters) {
        var engine = similarityEngine();
        var questions = await this.getQuestionBankQuestions(filters || {});

        var buckets = Object.create(null);
        questions.forEach(function(question) {
            var key = (question.subject || '(no subject)') + ' ' + (question.term || '');
            (buckets[key] = buckets[key] || []).push(question);
        });

        var clusters = [];
        Object.keys(buckets).forEach(function(key) {
            var parts = key.split(' ');
            engine.clusterDuplicates(buckets[key]).forEach(function(cluster) {
                clusters.push({
                    subject: parts[0],
                    term: parts[1] || '',
                    score: cluster.score,
                    questions: cluster.questions
                });
            });
        });

        return clusters.sort(function(a, b) {
            return b.questions.length - a.questions.length || b.score - a.score;
        });
    };

    /**
     * Check if a question with the same text, subject, and type already exists.
     * Exact-match backstop for the create path; the near-duplicate check above
     * is what the UI uses. Returns the existing question, or null.
     */
    ds.findDuplicateQuestion = async function(question) {
        var text = (question.text || '').trim().toLowerCase();
        var subject = (question.subject || '').trim().toLowerCase();
        var type = question.type || 'mcq';
        if (!text) return null;

        var school = this.getSchoolContext();
        var schoolVersion = school.schoolVersion || '';

        try {
            var clauses = ['text ~ {:text}', 'subject = {:subject}', 'type = {:type}'];
            var params = {
                text: text.substring(0, 80),
                subject: question.subject || '',
                type: type
            };
            // Every other read path scopes to the school; this one used to
            // compute the context and throw it away, so one school's question
            // could suppress another school's save.
            if (schoolVersion) {
                clauses.push('school_version = {:schoolVersion}');
                params.schoolVersion = schoolVersion;
            }

            var records = await this.pb.collection(COLLECTION).getFullList({
                filter: this.pb.filter(clauses.join(' && '), params),
                fields: 'id,text,subject,type'
            });
            return records.find(function(r) {
                return (r.text || '').trim().toLowerCase() === text;
            }) || null;
        } catch (error) {
            if (!isMissingCollection(error)) throw error;

            // Fallback: check local store
            var local = readLocalQuestions();
            return local.find(function(r) {
                return (r.text || '').trim().toLowerCase() === text
                    && (r.subject || '').trim().toLowerCase() === subject
                    && (r.type || 'mcq') === type
                    && (!schoolVersion || (r.school_version || '') === schoolVersion);
            }) || null;
        }
    };

    ds.deleteQuestionBankQuestion = async function(questionId) {
        if (!questionId) return false;

        try {
            await this.pb.collection(COLLECTION).delete(questionId);
            return true;
        } catch (error) {
            if (!isMissingCollection(error)) {
                console.error('[QuestionBank] deleteQuestionBankQuestion error:', error);
                throw error;
            }

            // Fallback: delete from local store
            var localQuestions = readLocalQuestions();
            var filtered = localQuestions.filter(function(q) { return q.id !== questionId; });
            if (filtered.length === localQuestions.length) return false;
            writeLocalQuestions(filtered);
            return true;
        }
    };

    ds.deleteQuestionBankQuestions = async function(questionIds) {
        if (!Array.isArray(questionIds) || questionIds.length === 0) return { deleted: 0, failed: 0 };

        var deleted = 0;
        var failed = 0;

        for (var i = 0; i < questionIds.length; i++) {
            try {
                await this.deleteQuestionBankQuestion(questionIds[i]);
                deleted++;
            } catch (err) {
                console.warn('[QuestionBank] Failed to delete question ' + questionIds[i] + ':', err);
                failed++;
            }
        }

        return { deleted: deleted, failed: failed };
    };

    /**
     * Convert one CBT exam question into a Question Bank record.
     * Returns null when the question carries too little to be useful
     * (no text, and not a theory question that may legitimately be terse).
     */
    function buildBankQuestion(examMeta, q) {
        var text = typeof q.text === 'string' ? q.text.trim() : '';
        var type = q.type || 'mcq';
        if (!text && type !== 'theory') return null;

        var bankQuestion = {
            text: text,
            type: type,
            subject: examMeta.subject || '',
            schoolLevel: examMeta.schoolLevel || '',
            targetClass: examMeta.targetClass || 'All',
            term: examMeta.term || examMeta.title || '',
            difficulty: q.difficulty || 'medium',
            points: q.points || q.marks || 1,
            explanation: q.explanation || '',
            tags: Array.isArray(q.tags) ? q.tags : [],
            source: 'exam_import',
            topInstruction: q.topInstruction || '',
            image: q.image || null,
            mediaAttachments: Array.isArray(q.mediaAttachments) ? q.mediaAttachments : []
        };

        // Map type-specific fields
        if ((type === 'mcq' || type === 'image_mcq') && Array.isArray(q.options)) {
            bankQuestion.options = q.options.map(function(opt, idx) {
                return {
                    id: opt.id || String.fromCharCode(97 + idx),
                    text: opt.text || '',
                    image: opt.image || null
                };
            });
            var correct = q.options.find(function(opt) { return opt.isCorrect; });
            bankQuestion.answer = correct ? (correct.id || '') : (q.correctAnswer || q.answer || '');
        } else if (type === 'true_false') {
            bankQuestion.options = [];
            bankQuestion.correctAnswer = q.correctAnswer || q.answer || '';
            bankQuestion.answer = bankQuestion.correctAnswer;
        } else if (type === 'fill_blank') {
            bankQuestion.options = [];
            bankQuestion.correctAnswer = q.correctAnswer || q.answer || '';
            bankQuestion.answer = bankQuestion.correctAnswer;
        } else if (type === 'theory') {
            bankQuestion.options = [];
            bankQuestion.answer = q.correctAnswer || q.answer || '';
        } else if (type === 'match') {
            bankQuestion.options = [];
            bankQuestion.pairs = Array.isArray(q.pairs) ? q.pairs.map(function(p) { return { left: p.left || '', right: p.right || '' }; }) : [];
        } else if (type === 'image_multi') {
            bankQuestion.options = [];
            bankQuestion.subQuestions = Array.isArray(q.subQuestions) ? q.subQuestions.map(function(sq) {
                return { id: sq.id || '', text: sq.text || '', correctAnswer: sq.correctAnswer || '' };
            }) : [];
            bankQuestion.children = Array.isArray(q.children) ? q.children.map(function(c) { return { ...c }; }) : [];
        }

        return bankQuestion;
    }

    /**
     * Dry run of an exam → bank import: what would land, and what already
     * looks like it is in there.
     *
     * The candidate pool is fetched ONCE for the exam's subject+term and
     * reused for every question, so a 40-question exam costs one query rather
     * than forty. Incoming questions are also compared against each other, so
     * an exam that repeats a question internally is caught too.
     *
     * Nothing is written. Feed the result to importExamQuestionsToBank as
     * `decisions` once the user has chosen.
     *
     * @param {Object} examMeta - { examId, subject, schoolLevel, targetClass, title, term }
     * @param {Array}  questions - array of exam question objects
     * @returns {Promise<Object>} { clean, conflicts, unusable, total, pool }
     */
    ds.analyzeExamQuestionsForBank = async function(examMeta, questions) {
        var engine = similarityEngine();
        var list = Array.isArray(questions) ? questions : [];
        var result = { clean: [], conflicts: [], unusable: 0, total: list.length, pool: [] };
        if (list.length === 0) return result;

        var pool = await this.getSimilarityPool({
            subject: examMeta.subject || '',
            term: examMeta.term || examMeta.title || ''
        });
        result.pool = pool;

        // Questions accepted so far this run, so duplicates *within* the exam
        // are caught as well as duplicates against the bank.
        var acceptedSoFar = [];

        list.forEach(function(q, index) {
            var bankQuestion = buildBankQuestion(examMeta, q);
            if (!bankQuestion) { result.unusable++; return; }

            var matches = engine.findMatches(bankQuestion, pool, { limit: 5 });
            var internal = engine.findMatches(bankQuestion, acceptedSoFar, { limit: 3 });
            internal.forEach(function(match) {
                match.isFromSameExam = true;
                matches.push(match);
            });
            matches.sort(function(a, b) { return b.score - a.score; });

            var entry = { index: index, question: bankQuestion, matches: matches };
            if (matches.length > 0) result.conflicts.push(entry);
            else result.clean.push(entry);

            acceptedSoFar.push(bankQuestion);
        });

        return result;
    };

    /**
     * Import questions from a published/saved exam into the Question Bank.
     * Converts CBT exam question format into QB question records.
     * Skips questions that don't have enough data to be useful (e.g. theory-only with no text).
     *
     * @param {Object} examMeta - { examId, subject, schoolLevel, targetClass, title, term }
     * @param {Array}  questions - array of exam question objects
     * @param {Object} [options] - { decisions } maps a question index to
     *        { action, replaceId }:
     *          'skip'    — leave the bank alone
     *          'add'     — save it even though it looks like a duplicate
     *          'replace' — delete bank question `replaceId`, then save this one
     *        Anything not listed imports normally, exact-duplicate backstop
     *        still applying.
     * @returns {Object} { imported, skipped, replaced, duplicates }
     */
    ds.importExamQuestionsToBank = async function(examMeta, questions, options) {
        if (!Array.isArray(questions) || questions.length === 0) {
            return { imported: 0, skipped: 0, replaced: 0, duplicates: 0 };
        }

        options = options || {};
        var decisions = options.decisions || {};

        var imported = 0;
        var skipped = 0;
        var replaced = 0;
        var duplicates = 0;

        for (var i = 0; i < questions.length; i++) {
            var bankQuestion = buildBankQuestion(examMeta, questions[i]);
            if (!bankQuestion) { skipped++; continue; }

            var decision = decisions[i] || {};
            var action = decision.action || '';
            if (action === 'skip') { skipped++; continue; }

            try {
                if (action === 'replace' && decision.replaceId) {
                    await this.deleteQuestionBankQuestion(decision.replaceId);
                    await this.createQuestionBankQuestion(bankQuestion, { skipDuplicateCheck: true });
                    replaced++;
                    continue;
                }

                // 'add' means the user looked at the near-duplicate and chose to
                // keep both, so the exact-match backstop must not veto it.
                var created = await this.createQuestionBankQuestion(
                    bankQuestion,
                    action === 'add' ? { skipDuplicateCheck: true } : undefined
                );
                if (created && created.wasDuplicate) duplicates++;
                else imported++;
            } catch (err) {
                console.warn('[QuestionBank] Failed to import question ' + (i + 1) + ':', err);
                skipped++;
            }
        }

        return { imported: imported, skipped: skipped, replaced: replaced, duplicates: duplicates };
    };
})(window.dataService);
