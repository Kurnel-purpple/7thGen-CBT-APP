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
                    return mapQuestion(existing);
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
    /**
     * Check if a question with the same text, subject, and type already exists.
     * Returns the existing question if found, null otherwise.
     */
    ds.findDuplicateQuestion = async function(question) {
        var text = (question.text || '').trim().toLowerCase();
        var subject = (question.subject || '').trim().toLowerCase();
        var type = question.type || 'mcq';
        if (!text) return null;

        var school = this.getSchoolContext();

        try {
            var records = await this.pb.collection(COLLECTION).getFullList({
                filter: this.pb.filter('text ~ {:text} && subject = {:subject} && type = {:type}', {
                    text: text.substring(0, 80),
                    subject: question.subject || '',
                    type: type
                }),
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
                    && (r.type || 'mcq') === type;
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
     * Import questions from a published/saved exam into the Question Bank.
     * Converts CBT exam question format into QB question records.
     * Skips questions that don't have enough data to be useful (e.g. theory-only with no text).
     *
     * @param {Object} examMeta - { examId, subject, schoolLevel, targetClass, title, term }
     * @param {Array}  questions - array of exam question objects
     * @returns {Object} { imported: number, skipped: number }
     */
    ds.importExamQuestionsToBank = async function(examMeta, questions) {
        if (!Array.isArray(questions) || questions.length === 0) {
            return { imported: 0, skipped: 0 };
        }

        var imported = 0;
        var skipped = 0;

        for (var i = 0; i < questions.length; i++) {
            var q = questions[i];
            var text = typeof q.text === 'string' ? q.text.trim() : '';

            // Skip questions without text (but allow theory which may have minimal text)
            var type = q.type || 'mcq';
            if (!text && type !== 'theory') { skipped++; continue; }

            // Build the QB record from exam question data
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

            try {
                await this.createQuestionBankQuestion(bankQuestion);
                imported++;
            } catch (err) {
                console.warn('[QuestionBank] Failed to import question ' + (i + 1) + ':', err);
                skipped++;
            }
        }

        return { imported: imported, skipped: skipped };
    };
})(window.dataService);
