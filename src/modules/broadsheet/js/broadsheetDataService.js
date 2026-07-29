/**
 * Broadsheet Data Service
 * Extends window.dataService with broadsheet aggregation.
 *
 * A broadsheet is a computed, class-wide view — it is NOT persisted.
 * It reuses the report card aggregate engine (generateReportCardData in
 * reportCardDataService.js) so both modules grade from identical logic:
 * same term filtering, deleted-exam exclusion, and result de-duplication.
 *
 * Term broadsheet: students × subjects, each cell CA | Exam | Total, plus
 *                  grand total, percentage, and class position.
 *
 * On the 3rd term — the last term of the session — that same sheet gains a
 * SESSION PERFORMANCE block of columns on the right: the 1st, 2nd and 3rd
 * term totals, their section total, the section average, and the student's
 * percentage and position for the session as a whole.
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

    var FINAL_TERM = '3rd Term';

    /**
     * Attach each student's whole-session performance to an already-built
     * 3rd term sheet, as extra columns on the right of that sheet.
     *
     * The 3rd term totals are already on the sheet, so only the 1st and 2nd
     * term sheets are fetched. Per student:
     *
     *   sectionTotal = sum of the term totals
     *   average      = sectionTotal ÷ the number of terms actually sat
     *   percentage   = mean of the term percentages over that same divisor
     *   position     = class rank on that percentage
     *
     * A term with no results contributes nothing and is left out of the
     * divisor, so a student who missed a term is neither rewarded for the
     * missing marks nor penalised by a divisor they could not fill.
     *
     * Note: exams whose titles carry no term signature are included in every
     * term by the report card engine (include-by-default), so they contribute
     * to each term column here too — title exams "1st Term ..." etc. to keep
     * section totals exact.
     *
     * @param {Object} sheet - the built 3rd term sheet, mutated in place
     * @param {Object} opts  - { classLevel, term, session }
     */
    async function attachSessionColumns(sheet, opts) {
        var earlierTerms = SESSION_TERMS.filter(function(t) { return t !== FINAL_TERM; });
        var byStudent = {};

        // Seed from the 3rd term sheet we already have — no refetch
        sheet.students.forEach(function(row) {
            byStudent[row.studentId] = {};
            byStudent[row.studentId][FINAL_TERM] = {
                total: row.grandTotal,
                possible: row.grandPossible,
                percentage: row.percentage,
                subjectCount: row.subjectCount
            };
        });

        for (var i = 0; i < earlierTerms.length; i++) {
            var term = earlierTerms[i];
            var cards = await ds.generateReportCardData({
                classLevel: opts.classLevel,
                term: term,
                session: opts.session || ''
            });
            var termSheet = buildSheetFromCards(cards, {
                classLevel: opts.classLevel,
                term: term,
                session: opts.session || ''
            });
            termSheet.students.forEach(function(row) {
                // Roster is the 3rd term class: ignore students no longer in it
                if (!byStudent[row.studentId]) return;
                byStudent[row.studentId][term] = {
                    total: row.grandTotal,
                    possible: row.grandPossible,
                    percentage: row.percentage,
                    subjectCount: row.subjectCount
                };
            });
        }

        sheet.students.forEach(function(row) {
            var terms = byStudent[row.studentId] || {};
            var termsSat = 0, pctSum = 0, sectionTotal = 0, sectionPossible = 0;

            SESSION_TERMS.forEach(function(term) {
                var t = terms[term];
                if (!t || t.subjectCount === 0) return;
                termsSat += 1;
                pctSum += t.percentage || 0;
                sectionTotal = round1(sectionTotal + (t.total || 0));
                sectionPossible = round1(sectionPossible + (t.possible || 0));
            });

            row.session = {
                terms: terms,
                termsSat: termsSat,
                sectionTotal: sectionTotal,
                sectionPossible: sectionPossible,
                average: termsSat > 0 ? round1(sectionTotal / termsSat) : 0,
                percentage: termsSat > 0 ? round1(pctSum / termsSat) : 0,
                position: null
            };
        });

        // Rank on the section percentage, independently of the term position
        var ranking = sheet.students.map(function(row) {
            return { pct: row.session.percentage, ref: row };
        });
        assignPositions(ranking, 'pct');
        ranking.forEach(function(entry) { entry.ref.session.position = entry.position; });

        // Class average per term — the session half of the footer row
        var termAverages = {};
        SESSION_TERMS.forEach(function(term) {
            var sat = sheet.students.filter(function(r) {
                var t = r.session.terms[term];
                return t && t.subjectCount > 0;
            });
            termAverages[term] = sat.length === 0 ? null : round1(
                sat.reduce(function(acc, r) { return acc + (r.session.terms[term].percentage || 0); }, 0) / sat.length
            );
        });

        sheet.hasSession = true;
        sheet.sessionTerms = SESSION_TERMS.slice();
        sheet.sessionTermAverages = termAverages;
        sheet.sessionOverallAverage = sheet.students.length === 0 ? 0 : round1(
            sheet.students.reduce(function(acc, r) { return acc + r.session.percentage; }, 0) / sheet.students.length
        );
    }

    /**
     * Build the term broadsheet for a class.
     *
     * On the 3rd term — the final term of the session — the sheet also carries
     * each student's session performance in extra columns on the right
     * (see attachSessionColumns).
     *
     * @param {Object} opts - { classLevel, term, session }
     * @returns {Promise<Object>} broadsheet data (see buildSheetFromCards)
     */
    ds.generateBroadsheetData = async function(opts) {
        var cards = await ds.generateReportCardData({
            classLevel: opts.classLevel,
            term: opts.term,
            session: opts.session || ''
        });
        var sheet = buildSheetFromCards(cards, opts);

        if (opts.term === FINAL_TERM && sheet.students.length > 0) {
            await attachSessionColumns(sheet, opts);
        }
        return sheet;
    };

})(window.dataService);
