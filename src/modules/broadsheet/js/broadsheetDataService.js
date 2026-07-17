/**
 * Broadsheet Data Service
 * Extends window.dataService with broadsheet aggregation.
 *
 * A broadsheet is a computed, class-wide view — it is NOT persisted.
 * It reuses the report card aggregate engine (generateReportCardData in
 * reportCardDataService.js) so both modules grade from identical logic:
 * same term filtering, deleted-exam exclusion, and result de-duplication.
 *
 * Term broadsheet:    students × subjects, each cell CA | Exam | Total,
 *                     plus grand total, percentage, and class position.
 * Session broadsheet: students × (1st, 2nd, 3rd term totals), summed into
 *                     a session total, percentage, and session position.
 */

(function(ds) {
    if (!ds) {
        console.error('[broadsheetDataService] window.dataService not found — load dataService.js first');
        return;
    }
    if (typeof ds.generateReportCardData !== 'function') {
        console.error('[broadsheetDataService] generateReportCardData missing — load reportCardDataService.js first');
        return;
    }

    var SESSION_TERMS = ['1st Term', '2nd Term', '3rd Term'];

    function round1(n) {
        return Math.round((n || 0) * 10) / 10;
    }

    /**
     * Rank rows by a numeric key (descending). Ties share the same position,
     * matching the report card module's ranking behaviour.
     */
    function assignPositions(rows, key) {
        var sorted = rows.slice().sort(function(a, b) { return b[key] - a[key]; });
        sorted.forEach(function(row, index) {
            if (index > 0 && row[key] === sorted[index - 1][key]) {
                row.position = sorted[index - 1].position;
            } else {
                row.position = index + 1;
            }
        });
    }

    /**
     * Pivot an array of report cards (one per student) into a broadsheet:
     * a subject-column matrix with grand totals, percentages, and positions.
     */
    function buildSheetFromCards(cards, meta) {
        // Union of all subjects that appear on any student's card
        var subjectSet = {};
        (cards || []).forEach(function(card) {
            (card.subjects || []).forEach(function(s) { subjectSet[s.name] = true; });
        });
        var subjects = Object.keys(subjectSet).sort();

        var rows = (cards || []).map(function(card) {
            var cells = {};
            var grandTotal = 0;
            var grandPossible = 0;
            var grandCa = 0;
            var grandExam = 0;

            (card.subjects || []).forEach(function(s) {
                var exam = (s.examScore !== undefined && s.examScore !== null) ? s.examScore : s.score;
                cells[s.name] = {
                    ca: (s.caScore !== undefined && s.caScore !== null) ? s.caScore : 0,
                    exam: exam,
                    total: s.score,
                    totalPossible: s.totalPossible,
                    percentage: s.percentage,
                    grade: s.grade
                };
                grandTotal += s.score || 0;
                grandPossible += s.totalPossible || 0;
                grandCa += s.caScore || 0;
                grandExam += exam || 0;
            });

            var percentage = grandPossible > 0 ? round1((grandTotal / grandPossible) * 100) : 0;

            return {
                studentId: card.studentId,
                studentName: card.studentName,
                cells: cells,
                subjectCount: (card.subjects || []).length,
                grandCa: round1(grandCa),
                grandExam: round1(grandExam),
                grandTotal: round1(grandTotal),
                grandPossible: round1(grandPossible),
                percentage: percentage,
                position: null
            };
        });

        assignPositions(rows, 'percentage');
        rows.sort(function(a, b) {
            return (a.position - b.position) || (a.studentName || '').localeCompare(b.studentName || '');
        });

        // Class average per subject (mean of subject percentages across the
        // students who actually sat that subject) — the broadsheet footer row
        var subjectAverages = {};
        subjects.forEach(function(name) {
            var scored = rows.filter(function(r) { return r.cells[name]; });
            if (scored.length === 0) {
                subjectAverages[name] = null;
                return;
            }
            var sumPct = scored.reduce(function(acc, r) { return acc + (r.cells[name].percentage || 0); }, 0);
            subjectAverages[name] = round1(sumPct / scored.length);
        });

        var overallAverage = 0;
        if (rows.length > 0) {
            overallAverage = round1(rows.reduce(function(acc, r) { return acc + r.percentage; }, 0) / rows.length);
        }

        return {
            classLevel: meta.classLevel,
            term: meta.term || '',
            session: meta.session || '',
            subjects: subjects,
            students: rows,
            subjectAverages: subjectAverages,
            overallAverage: overallAverage,
            classSize: rows.length,
            generatedAt: new Date().toISOString()
        };
    }

    /**
     * Build the term broadsheet for a class.
     * @param {Object} opts - { classLevel, term, session }
     * @returns {Promise<Object>} broadsheet data (see buildSheetFromCards)
     */
    ds.generateBroadsheetData = async function(opts) {
        var cards = await ds.generateReportCardData({
            classLevel: opts.classLevel,
            term: opts.term,
            session: opts.session || ''
        });
        return buildSheetFromCards(cards, opts);
    };

    /**
     * Build the end-of-session broadsheet for a class: each student's term
     * totals across all three terms, summed into a session total + position.
     *
     * Note: exams whose titles carry no term signature are included in every
     * term by the report card engine (include-by-default), so they contribute
     * to each term column here too — title exams "1st Term ..." etc. to keep
     * session totals exact.
     *
     * @param {Object} opts - { classLevel, session }
     * @returns {Promise<Object>} session broadsheet data
     */
    ds.generateSessionBroadsheetData = async function(opts) {
        var termSheets = {};
        for (var i = 0; i < SESSION_TERMS.length; i++) {
            var term = SESSION_TERMS[i];
            var cards = await ds.generateReportCardData({
                classLevel: opts.classLevel,
                term: term,
                session: opts.session || ''
            });
            termSheets[term] = buildSheetFromCards(cards, {
                classLevel: opts.classLevel,
                term: term,
                session: opts.session || ''
            });
        }

        // Merge per student across terms
        var byStudent = {};
        SESSION_TERMS.forEach(function(term) {
            termSheets[term].students.forEach(function(row) {
                if (!byStudent[row.studentId]) {
                    byStudent[row.studentId] = {
                        studentId: row.studentId,
                        studentName: row.studentName,
                        terms: {},
                        sessionTotal: 0,
                        sessionPossible: 0,
                        percentage: 0,
                        position: null
                    };
                }
                var entry = byStudent[row.studentId];
                entry.terms[term] = {
                    total: row.grandTotal,
                    possible: row.grandPossible,
                    percentage: row.percentage,
                    subjectCount: row.subjectCount
                };
                entry.sessionTotal = round1(entry.sessionTotal + row.grandTotal);
                entry.sessionPossible = round1(entry.sessionPossible + row.grandPossible);
            });
        });

        var rows = Object.keys(byStudent).map(function(id) { return byStudent[id]; });
        rows.forEach(function(r) {
            r.percentage = r.sessionPossible > 0 ? round1((r.sessionTotal / r.sessionPossible) * 100) : 0;
        });
        assignPositions(rows, 'percentage');
        rows.sort(function(a, b) {
            return (a.position - b.position) || (a.studentName || '').localeCompare(b.studentName || '');
        });

        var overallAverage = 0;
        if (rows.length > 0) {
            overallAverage = round1(rows.reduce(function(acc, r) { return acc + r.percentage; }, 0) / rows.length);
        }

        return {
            classLevel: opts.classLevel,
            session: opts.session || '',
            terms: SESSION_TERMS.slice(),
            students: rows,
            overallAverage: overallAverage,
            classSize: rows.length,
            generatedAt: new Date().toISOString()
        };
    };

})(window.dataService);
