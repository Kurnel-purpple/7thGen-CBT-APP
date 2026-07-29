/**
 * Exam Results Controller (Teacher View)
 * Supports:
 * - Auto-graded objective scores
 * - Theory scores saved via the detail view (results.js)
 * - Manual theory score input directly in the results list (for pen-and-paper theory answers)
 * - Manual continuous assessment (CA) score input per result
 * - Auto-summing of manual theory + CA + objective scores
 */

const examResults = {
    results: [],
    currentExam: null,
    hasTheoryQuestions: false,
    manualTheoryScores: {}, // { resultId: manualScore }
    manualTheoryTotals: {}, // { resultId: manualTheoryTotal } — legacy per-result, still read on load for seeding
    caScores: {},           // { resultId: caScore }
    caTotals: {},           // { resultId: caTotal } — legacy per-result, still read on load for seeding
    // Expected (out-of) totals now live at the page level: the teacher sets them
    // once at the top and every student card is scored against them. null = unset.
    globalTheoryTotal: null,
    globalCaTotal: null,
    _globalsInitialized: false,

    /**
     * Calculate points for a single result based on exam questions.
     * Separates objective and theory (app-graded) points.
     */
    _calculatePoints(r, exam) {
        let objectivePoints = 0;
        let theoryPoints = 0;
        let objectivePossible = 0;
        let theoryPossible = 0;

        exam.questions.forEach(q => {
            const qPoints = parseFloat(q.points) || 0.5;

            if (q.type === 'theory') {
                theoryPossible += qPoints;
                // Theory questions - use saved theory scores if available (graded via detail view)
                const theoryScore = r.theoryScores && r.theoryScores[q.id] ? parseFloat(r.theoryScores[q.id]) : 0;
                theoryPoints += theoryScore;
            } else if (q.type === 'fill_blank') {
                objectivePossible += qPoints;
                const answer = r.answers[q.id];
                if (answer && q.correctAnswer && answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                    objectivePoints += qPoints;
                }
            } else if (q.type === 'match') {
                objectivePossible += qPoints;
                const answer = r.answers[q.id];
                if (answer) {
                    let allCorrect = true;
                    q.pairs.forEach((pair, idx) => {
                        if (answer[idx] !== pair.right) allCorrect = false;
                    });
                    if (allCorrect) objectivePoints += qPoints;
                }
            } else if (q.type === 'image_multi') {
                objectivePossible += qPoints;
                const answer = r.answers[q.id];
                if (answer && q.subQuestions) {
                    let correctCount = 0;
                    q.subQuestions.forEach(subQ => {
                        if (answer[subQ.id] === subQ.correctAnswer) {
                            correctCount++;
                        }
                    });
                    const pointsPerSubQ = qPoints / q.subQuestions.length;
                    objectivePoints += correctCount * pointsPerSubQ;
                }
            } else {
                objectivePossible += qPoints;
                // MCQ, True/False, Image MCQ
                const answer = r.answers[q.id];
                if (q.options) {
                    const correctOpt = q.options.find(o => o.isCorrect);
                    if (answer && correctOpt && correctOpt.id === answer) {
                        objectivePoints += qPoints;
                    }
                }
            }
        });

        return {
            objectivePoints,
            theoryPoints,
            objectivePossible,
            theoryPossible,
            totalPossible: objectivePossible + theoryPossible
        };
    },

    _getTheoryPossible(exam) {
        if (!exam || !Array.isArray(exam.questions)) return 0;
        return exam.questions.reduce((sum, q) => {
            if (q.type !== 'theory') return sum;
            return sum + (parseFloat(q.points) || 0.5);
        }, 0);
    },

    _escapeHtml(str) {
        if (typeof str !== 'string') return str;
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // Compact number formatting: whole numbers stay whole, otherwise one decimal.
    _fmt(n) {
        if (n === null || n === undefined || n === '') return '0';
        const x = Number(n);
        if (!isFinite(x)) return '0';
        return Number.isInteger(x) ? String(x) : x.toFixed(1);
    },

    // Seed the page-level expected totals once per load from any previously
    // saved per-result totals (use the max so no student's score exceeds the
    // total), falling back to the exam's own theory total for theory and blank
    // for CA. Never overwrites values the teacher has already typed this session.
    _initGlobalTotals(exam) {
        if (examResults._globalsInitialized) return;
        const savedTheory = examResults.results
            .map(r => r.manualTheoryTotal)
            .filter(v => v !== null && v !== undefined && !isNaN(v));
        const savedCa = examResults.results
            .map(r => r.caTotal)
            .filter(v => v !== null && v !== undefined && !isNaN(v));

        const theoryPossible = examResults._getTheoryPossible(exam);
        examResults.globalTheoryTotal = savedTheory.length
            ? Math.max(...savedTheory)
            : (theoryPossible > 0 ? theoryPossible : null);
        examResults.globalCaTotal = savedCa.length ? Math.max(...savedCa) : null;
        examResults._globalsInitialized = true;
    },

    // Reflect the current global totals into the expected-scores bar inputs.
    renderExpectedBar() {
        const theoryInput = document.getElementById('global-theory-total');
        const caInput = document.getElementById('global-ca-total');
        if (theoryInput) theoryInput.value = examResults.globalTheoryTotal ?? '';
        if (caInput) caInput.value = examResults.globalCaTotal ?? '';
    },

    _csvCell(value) {
        let str = String(value == null ? '' : value);
        if (/^[=+\-@]/.test(str)) {
            str = "'" + str;
        }
        str = str.replace(/"/g, '""');
        return '"' + str + '"';
    },

    _sortResultsByStudentName(results = []) {
        return [...results].sort((a, b) => {
            const nameA = (a.studentName || '').trim();
            const nameB = (b.studentName || '').trim();
            return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
        });
    },

    _processResults(rawResults, exam) {
        const completedResults = rawResults.filter(r => r.status !== 'in-progress');
        return examResults._sortResultsByStudentName(completedResults.map(r => {
            const { objectivePoints, theoryPoints, objectivePossible, theoryPossible, totalPossible } = examResults._calculatePoints(r, exam);
            const calculatedPoints = objectivePoints + theoryPoints;
            const passScore = exam.passScore || 50;
            const isPassed = r.score >= passScore;

            const manualScoreRaw = r.flags ? r.flags._manualTheoryScore : undefined;
            const savedManual = (manualScoreRaw !== undefined && manualScoreRaw !== null && manualScoreRaw !== '')
                ? parseFloat(manualScoreRaw) : null;
            if (savedManual !== null && !isNaN(savedManual)) {
                examResults.manualTheoryScores[r.id] = savedManual;
            }
            const manualTotalRaw = r.flags ? r.flags._manualTheoryTotal : undefined;
            const savedManualTotal = (manualTotalRaw !== undefined && manualTotalRaw !== null && manualTotalRaw !== '')
                ? parseFloat(manualTotalRaw) : null;
            if (savedManualTotal !== null && !isNaN(savedManualTotal)) {
                examResults.manualTheoryTotals[r.id] = savedManualTotal;
            }

            const caScoreRaw = r.flags ? r.flags._caScore : undefined;
            const savedCaScore = (caScoreRaw !== undefined && caScoreRaw !== null && caScoreRaw !== '')
                ? parseFloat(caScoreRaw) : null;
            if (savedCaScore !== null && !isNaN(savedCaScore)) {
                examResults.caScores[r.id] = savedCaScore;
            }
            const caTotalRaw = r.flags ? r.flags._caTotal : undefined;
            const savedCaTotal = (caTotalRaw !== undefined && caTotalRaw !== null && caTotalRaw !== '')
                ? parseFloat(caTotalRaw) : null;
            if (savedCaTotal !== null && !isNaN(savedCaTotal)) {
                examResults.caTotals[r.id] = savedCaTotal;
            }

            return {
                ...r,
                objectivePoints,
                theoryPoints,
                objectivePossible,
                theoryPossible,
                points: calculatedPoints,
                totalPoints: totalPossible,
                passed: isPassed,
                manualTheoryScore: savedManual,
                manualTheoryTotal: savedManualTotal,
                caScore: savedCaScore,
                caTotal: savedCaTotal
            };
        }));
    },

    init: async () => {
        const params = new URLSearchParams(window.location.search);
        const examId = params.get('examId');

        if (!examId) {
            await Utils.showAlert('Missing Exam', 'No exam was selected. Please go back and choose an exam to view results for.');
            window.location.href = 'teacher-dashboard.html';
            return;
        }

        const user = dataService.getCurrentUser();
        if (user.role !== 'teacher') {
            window.location.href = '../index.html';
            return;
        }

        try {
            const [exam, rawResults] = await Promise.all([
                dataService.getExamById(examId),
                dataService.getResults({ examId: examId })
            ]);

            examResults.currentExam = exam;
            examResults.hasTheoryQuestions = exam.questions.some(q => q.type === 'theory');

            // Manual theory + CA inputs are always available, so the bulk-save
            // button always shows
            const saveAllBtn = document.getElementById('save-all-theory-btn');
            if (saveAllBtn) {
                saveAllBtn.style.display = 'inline-block';
            }

            // Title: show subject name + "Results", subtitle: class + term
            document.getElementById('exam-title').textContent = (exam.subject || exam.title) + ' Results';
            const subtitleEl = document.getElementById('exam-subtitle');
            if (subtitleEl) {
                const parts = [exam.targetClass, exam.title].filter(Boolean);
                subtitleEl.textContent = parts.join(' \u00B7 ');
            }

            examResults.results = examResults._processResults(rawResults, exam);
            examResults._initGlobalTotals(exam);

            examResults.renderExpectedBar();
            examResults.renderStats();
            examResults.renderTable();
            examResults.renderCards();

            // Background Refresh (stale-while-revalidate)
            if (navigator.onLine) {
                setTimeout(async () => {
                    try {
                        console.log('🔄 Checking for fresh results...');
                        const [freshExam, freshResults] = await Promise.all([
                            dataService.getExamById(examId),
                            dataService.getResults({ examId: examId, forceRefresh: true })
                        ]);

                        // Guard: don't overwrite good data with empty response
                        if (!freshExam || (freshResults.length === 0 && examResults.results.length > 0)) {
                            console.warn('⚠️ Background refresh returned empty — keeping existing data');
                            return;
                        }

                        examResults.currentExam = freshExam;
                        examResults.hasTheoryQuestions = freshExam.questions.some(q => q.type === 'theory');

                        examResults.results = examResults._processResults(freshResults, freshExam);
                        examResults._initGlobalTotals(freshExam);

                        examResults.renderExpectedBar();
                        examResults.renderStats();
                        examResults.renderTable();
                        examResults.renderCards();

                    } catch (e) { console.warn('Background refresh failed', e); }
                }, 1000);
            }

        } catch (err) {
            console.error(err);
            await Utils.showAlert('Load Error', 'Unable to load exam results. Please check your internet connection and try again.');
        }
    },

    /**
     * Get the effective total score for a result, including manual theory and CA.
     * Priority:
     * 1. If theory was graded in the app (theoryPoints > 0), that score is already included in r.points
     * 2. If a manual theory score was entered here (for pen-and-paper), it replaces the app-graded theory
     * 3. CA (continuous assessment) is separate from the exam — it adds to BOTH
     *    the points scored and the total possible
     */
    _getEffectiveScore(r) {
        const manualScore = examResults.manualTheoryScores[r.id];
        const globalTheoryTotal = examResults.globalTheoryTotal;
        const hasManualScore = manualScore !== undefined && manualScore !== null && manualScore >= 0;
        // Expected theory total is now page-level; fall back to the exam's own
        // theory total when the teacher hasn't set one.
        let effectiveTheoryTotal = (globalTheoryTotal !== null && globalTheoryTotal !== undefined && globalTheoryTotal >= 0)
            ? globalTheoryTotal
            : r.theoryPossible;
        // Preview safety: never show a theory total below the theory score being
        // applied (matters on exams with no theory questions, where the default
        // theory total is 0)
        const appliedTheory = hasManualScore ? manualScore : r.theoryPoints;
        if (appliedTheory > effectiveTheoryTotal) effectiveTheoryTotal = appliedTheory;

        // CA component — expected total is page-level.
        const caScoreRaw = examResults.caScores[r.id];
        const globalCaTotal = examResults.globalCaTotal;
        const caScore = (caScoreRaw !== undefined && caScoreRaw !== null && caScoreRaw >= 0) ? caScoreRaw : 0;
        let caTotal = (globalCaTotal !== null && globalCaTotal !== undefined && globalCaTotal >= 0) ? globalCaTotal : 0;
        if (caScore > caTotal) caTotal = caScore;

        const effectiveTotalPoints = r.objectivePossible + effectiveTheoryTotal + caTotal;
        // Manual theory replaces app-graded theory (teacher override); otherwise
        // r.points already holds objective + app-graded theory
        const basePoints = hasManualScore ? (r.objectivePoints + manualScore) : r.points;
        const effectivePoints = basePoints + caScore;
        const percentage = effectiveTotalPoints > 0 ? Math.round((effectivePoints / effectiveTotalPoints) * 100) : 0;
        return { effectivePoints, effectiveTotalPoints, percentage, caScore, caTotal };
    },

    renderStats: () => {
        if (examResults.results.length === 0) {
            return;
        }

        const total = examResults.results.length;
        const sumScore = examResults.results.reduce((acc, r) => {
            const { percentage } = examResults._getEffectiveScore(r);
            return acc + percentage;
        }, 0);
        const avg = Math.round(sumScore / total);

        const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
        const passCount = examResults.results.filter(r => {
            const { percentage } = examResults._getEffectiveScore(r);
            return percentage >= passScore;
        }).length;
        const passRate = Math.round((passCount / total) * 100);

        document.getElementById('stats-total').textContent = total;
        document.getElementById('stats-avg').textContent = avg + '%';
        document.getElementById('stats-pass-rate').textContent = passRate + '%';
    },

    renderTable: () => {
        const container = document.getElementById('results-body');

        if (examResults.results.length === 0) {
            container.innerHTML = '<div class="result-boxes-empty">No submissions yet.</div>';
            return;
        }

        const gTheoryDisp = examResults.globalTheoryTotal !== null
            ? examResults._fmt(examResults.globalTheoryTotal)
            : (examResults._getTheoryPossible(examResults.currentExam) > 0
                ? examResults._fmt(examResults._getTheoryPossible(examResults.currentExam)) : '—');
        const gCaDisp = examResults.globalCaTotal !== null ? examResults._fmt(examResults.globalCaTotal) : '—';

        container.innerHTML = examResults.results.map(r => {
            const { effectivePoints, effectiveTotalPoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;

            const currentManual = examResults.manualTheoryScores[r.id] !== undefined
                ? examResults.manualTheoryScores[r.id] : '';
            const currentCa = examResults.caScores[r.id] !== undefined
                ? examResults.caScores[r.id] : '';
            const hasAppTheory = r.theoryPoints > 0;
            const hasAnyEntry = currentManual !== '' || currentCa !== '';

            return `
                <div class="result-box">
                    <div class="result-box-row1">
                        <div class="result-box-identity">
                            <span class="result-box-name">${examResults._escapeHtml(r.studentName)}</span>
                            <span class="result-box-date">${Utils.formatDate(r.submittedAt)}</span>
                        </div>
                        <div class="result-box-row1-right">
                            <span class="score-pill ${isPassed ? 'pass' : 'fail'}">${isPassed ? 'PASS' : 'FAIL'}</span>
                            <button class="btn-view-detail" onclick="location.href='results.html?id=${r.id}'">
                                <i class="fas fa-eye"></i> View
                            </button>
                        </div>
                    </div>
                    <div class="result-box-data-row">
                        <div class="result-box-metric">
                            <span class="result-box-metric-label">Obj</span>
                            <span class="result-box-cell result-box-bold">${r.objectivePoints.toFixed(1)}</span>
                        </div>
                        <div class="result-box-metric result-box-metric--input">
                            <span class="result-box-metric-label">Theory</span>
                            <div class="result-box-theory-inputs">
                                <input type="number"
                                    id="manual-theory-${r.id}"
                                    class="${examResults._isOverLimit('theory', currentManual) ? 'score-over' : ''}"
                                    value="${currentManual}"
                                    min="0" step="0.5"
                                    placeholder="${hasAppTheory ? r.theoryPoints.toFixed(1) : '0'}"
                                    oninput="examResults.onScoreInput(this, '${r.id}', 'theory')"
                                    onchange="examResults.onManualTheoryChange('${r.id}', this.value)"
                                    title="${hasAppTheory ? 'App-graded: ' + r.theoryPoints.toFixed(1) + ' pts' : 'Enter theory score'}"
                                />
                                <span class="result-box-divider">/ ${gTheoryDisp}</span>
                                ${hasAppTheory ? '<span class="result-box-app-badge" title="App-graded">App</span>' : ''}
                            </div>
                        </div>
                        <div class="result-box-metric result-box-metric--input">
                            <span class="result-box-metric-label">CA</span>
                            <div class="result-box-theory-inputs">
                                <input type="number"
                                    id="ca-score-${r.id}"
                                    class="${examResults._isOverLimit('ca', currentCa) ? 'score-over' : ''}"
                                    value="${currentCa}"
                                    min="0" step="0.5"
                                    placeholder="0"
                                    oninput="examResults.onScoreInput(this, '${r.id}', 'ca')"
                                    onchange="examResults.onCaScoreChange('${r.id}', this.value)"
                                    title="Continuous assessment score"
                                />
                                <span class="result-box-divider">/ ${gCaDisp}</span>
                            </div>
                        </div>
                        <div class="result-box-metric">
                            <span class="result-box-metric-label">Total</span>
                            <span class="result-box-cell result-box-bold result-box-primary">${effectivePoints.toFixed(1)}/${effectiveTotalPoints.toFixed(1)}</span>
                        </div>
                        <div class="result-box-metric result-box-metric--save">
                            ${hasAnyEntry ? `<button class="result-box-save-btn" onclick="examResults.saveManualTheoryScore('${r.id}')" title="Save theory/CA scores"><i class="fas fa-save"></i></button>` : '<span class="result-box-save-placeholder"></span>'}
                        </div>
                    </div>
                </div>`;
        }).join('');
    },

    renderCards: () => {
        const cardsContainer = document.getElementById('results-cards');

        if (examResults.results.length === 0) {
            cardsContainer.innerHTML = '<p style="text-align: center; padding: 30px;">No submissions yet.</p>';
            return;
        }

        const gTheoryDisp = examResults.globalTheoryTotal !== null
            ? examResults._fmt(examResults.globalTheoryTotal)
            : (examResults._getTheoryPossible(examResults.currentExam) > 0
                ? examResults._fmt(examResults._getTheoryPossible(examResults.currentExam)) : '—');
        const gCaDisp = examResults.globalCaTotal !== null ? examResults._fmt(examResults.globalCaTotal) : '—';

        cardsContainer.innerHTML = examResults.results.map(r => {
            const { effectivePoints, effectiveTotalPoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;

            const currentManual = examResults.manualTheoryScores[r.id] !== undefined
                ? examResults.manualTheoryScores[r.id] : '';
            const currentCa = examResults.caScores[r.id] !== undefined
                ? examResults.caScores[r.id] : '';
            const hasAppTheory = r.theoryPoints > 0;
            const hasAnyEntry = currentManual !== '' || currentCa !== '';

            const gradeInputHtml = `
                    <div class="grade-inputs">
                        <div class="grade-input-group">
                            <div class="grade-input-head">
                                <span class="result-card-label">Theory</span>
                                ${hasAppTheory ? '<span class="grade-app-badge">App: ' + r.theoryPoints.toFixed(1) + '</span>' : ''}
                            </div>
                            <div class="grade-input-line">
                                <input type="number"
                                    id="mobile-manual-theory-${r.id}"
                                    class="${examResults._isOverLimit('theory', currentManual) ? 'score-over' : ''}"
                                    value="${currentManual}"
                                    min="0" step="0.5"
                                    placeholder="${hasAppTheory ? r.theoryPoints.toFixed(1) : '0'}"
                                    oninput="examResults.onScoreInput(this, '${r.id}', 'theory', true)"
                                    onchange="examResults.onManualTheoryChange('${r.id}', this.value, true)"
                                />
                                <span class="grade-input-total">/ ${gTheoryDisp}</span>
                            </div>
                        </div>
                        <div class="grade-input-group">
                            <div class="grade-input-head">
                                <span class="result-card-label">CA</span>
                            </div>
                            <div class="grade-input-line">
                                <input type="number"
                                    id="mobile-ca-score-${r.id}"
                                    class="${examResults._isOverLimit('ca', currentCa) ? 'score-over' : ''}"
                                    value="${currentCa}"
                                    min="0" step="0.5"
                                    placeholder="0"
                                    oninput="examResults.onScoreInput(this, '${r.id}', 'ca', true)"
                                    onchange="examResults.onCaScoreChange('${r.id}', this.value, true)"
                                />
                                <span class="grade-input-total">/ ${gCaDisp}</span>
                            </div>
                        </div>
                    </div>
                `;

            return `
            <div class="result-card">
                <div class="result-card-header">
                    <div class="result-card-identity">
                        <div class="result-card-student">${examResults._escapeHtml(r.studentName)}</div>
                        <div class="result-card-date">${Utils.formatDate(r.submittedAt)}</div>
                    </div>
                    <div class="result-card-header-actions">
                        <span class="score-pill ${isPassed ? 'pass' : 'fail'}">${isPassed ? 'PASS' : 'FAIL'}</span>
                        ${hasAnyEntry ? `<button class="card-icon-btn save" onclick="examResults.saveManualTheoryScore('${r.id}')" title="Save scores" aria-label="Save scores"><i class="fas fa-save"></i></button>` : ''}
                        <button class="card-icon-btn" onclick="location.href='results.html?id=${r.id}'" title="View details" aria-label="View details"><i class="fas fa-eye"></i></button>
                    </div>
                </div>
                <div class="result-card-body">
                    <div class="result-card-row">
                        <span class="result-card-label">Obj</span>
                        <span class="result-card-value" style="font-weight: bold;">${r.objectivePoints.toFixed(1)} pts</span>
                    </div>
                    <div class="result-card-row">
                        <span class="result-card-label">Total Score</span>
                        <span class="result-card-value" style="font-weight: bold;">${effectivePoints.toFixed(1)} / ${effectiveTotalPoints.toFixed(1)}</span>
                    </div>
                    ${gradeInputHtml}
                </div>
            </div>
        `;
        }).join('');
    },

    /**
     * Rapid-entry auto-advance for the theory/CA score inputs.
     *
     * Fires on every keystroke. The moment the box holds exactly two digits
     * (scores are marked out of two-digit totals, so a third digit is never
     * meaningful) the value is committed and focus jumps on:
     *   theory → the same student's CA box → the NEXT student's theory box → …
     * letting a teacher key a whole class's scores without touching the mouse.
     *
     * Two things this must respect:
     *  - decimals: "12" jumps, but anything containing "." never auto-jumps
     *    (half marks like 12.5 are entered as "12.5" + Tab, or "1." first);
     *  - the change handlers below re-render the entire table AND the card
     *    list, destroying the input mid-keystroke — so commit through them
     *    FIRST, then find the target by id in the fresh DOM and focus it.
     */
    /**
     * The maximum a theory/CA entry can sensibly be: the page-level expected
     * total if the teacher set one, else (for theory) what the exam's theory
     * questions are actually worth. Null = no known limit, never flag.
     */
    _scoreLimit: (kind) => {
        if (kind === 'theory') {
            if (examResults.globalTheoryTotal !== null) return examResults.globalTheoryTotal;
            const possible = examResults._getTheoryPossible(examResults.currentExam);
            return possible > 0 ? possible : null;
        }
        return examResults.globalCaTotal;
    },

    _isOverLimit: (kind, value) => {
        if (value === '' || value === undefined || value === null) return false;
        const limit = examResults._scoreLimit(kind);
        const num = parseFloat(value);
        return limit !== null && !isNaN(num) && num > limit;
    },

    onScoreInput: (inputEl, resultId, kind, isMobile = false) => {
        const raw = String(inputEl.value || '');

        // Live over-limit indicator: a score above the expected total (57/30)
        // is greyed out the moment it's typed, so the slip is visible while
        // the teacher is still on that box.
        const limit = examResults._scoreLimit(kind);
        const num = parseFloat(raw);
        const over = limit !== null && !isNaN(num) && num > limit;
        inputEl.classList.toggle('score-over', over);
        inputEl.title = over ? `Higher than the expected total of ${examResults._fmt(limit)} — check this score` : '';

        if (!/^\d{2}$/.test(raw)) return;
        // Never auto-jump away from a problem entry — leaving focus on the
        // greyed value is what makes the teacher stop and look at it.
        if (over) return;

        if (kind === 'theory') {
            examResults.onManualTheoryChange(resultId, raw, isMobile);
        } else {
            examResults.onCaScoreChange(resultId, raw, isMobile);
        }

        let nextId = null;
        if (kind === 'theory') {
            nextId = (isMobile ? 'mobile-ca-score-' : 'ca-score-') + resultId;
        } else {
            const idx = examResults.results.findIndex(r => r.id === resultId);
            const next = idx >= 0 ? examResults.results[idx + 1] : null;
            if (next) nextId = (isMobile ? 'mobile-manual-theory-' : 'manual-theory-') + next.id;
        }
        if (!nextId) return;

        requestAnimationFrame(() => {
            const el = document.getElementById(nextId);
            if (!el) return;
            el.focus();
            if (typeof el.select === 'function') el.select();
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    },

    /**
     * Called when a manual theory score input changes
     */
    onManualTheoryChange: (resultId, value, isMobile = false) => {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < 0) {
            delete examResults.manualTheoryScores[resultId];
        } else {
            examResults.manualTheoryScores[resultId] = numValue;
        }

        // Sync the desktop/mobile input
        const desktopInput = document.getElementById(`manual-theory-${resultId}`);
        const mobileInput = document.getElementById(`mobile-manual-theory-${resultId}`);
        if (isMobile && desktopInput) desktopInput.value = value;
        if (!isMobile && mobileInput) mobileInput.value = value;

        // Re-render stats (live update)
        examResults.renderStats();

        // Update the total score display in the same row
        const result = examResults.results.find(r => r.id === resultId);
        if (result) {
            examResults.renderTable();
            examResults.renderCards();
        }
    },

    // Page-level expected totals — one value applied to every student card.
    onGlobalTheoryTotalChange: (value) => {
        const numValue = parseFloat(value);
        examResults.globalTheoryTotal = (value === '' || isNaN(numValue) || numValue < 0) ? null : numValue;
        examResults._globalsInitialized = true;
        examResults.renderStats();
        examResults.renderTable();
        examResults.renderCards();
    },

    onGlobalCaTotalChange: (value) => {
        const numValue = parseFloat(value);
        examResults.globalCaTotal = (value === '' || isNaN(numValue) || numValue < 0) ? null : numValue;
        examResults._globalsInitialized = true;
        examResults.renderStats();
        examResults.renderTable();
        examResults.renderCards();
    },

    /**
     * Called when a CA (continuous assessment) score input changes
     */
    onCaScoreChange: (resultId, value, isMobile = false) => {
        const numValue = parseFloat(value);
        if (value === '' || isNaN(numValue) || numValue < 0) {
            delete examResults.caScores[resultId];
        } else {
            examResults.caScores[resultId] = numValue;
        }

        const desktopInput = document.getElementById(`ca-score-${resultId}`);
        const mobileInput = document.getElementById(`mobile-ca-score-${resultId}`);
        if (isMobile && desktopInput) desktopInput.value = value;
        if (!isMobile && mobileInput) mobileInput.value = value;

        examResults.renderStats();

        const result = examResults.results.find(r => r.id === resultId);
        if (result) {
            examResults.renderTable();
            examResults.renderCards();
        }
    },

    /**
     * Save the manual theory and CA scores for a specific student result.
     * This persists the scores to the database and recalculates the total.
     * CA is separate from the exam: it adds to both points scored and total possible.
     */
    saveManualTheoryScore: async (resultId) => {
        const manualScore = examResults.manualTheoryScores[resultId];
        const caScore = examResults.caScores[resultId];
        // Totals come from the page-level expected inputs, shared by every card.
        const manualTheoryTotal = examResults.globalTheoryTotal;
        const caTotal = examResults.globalCaTotal;
        const hasManualScore = manualScore !== undefined && manualScore !== null;
        const hasManualTotal = manualTheoryTotal !== undefined && manualTheoryTotal !== null;
        const hasCaScore = caScore !== undefined && caScore !== null;
        const hasCaTotal = caTotal !== undefined && caTotal !== null;

        if (!hasManualScore && !hasCaScore) {
            await Utils.showAlert('No Changes', 'Please enter a theory or CA score first.');
            return false;
        }

        const result = examResults.results.find(r => r.id === resultId);
        if (!result) return false;

        const exam = examResults.currentExam;
        if (!exam) return false;

        try {
            const theoryPointsToUse = hasManualScore ? manualScore : result.theoryPoints;
            const effectiveTheoryTotal = (hasManualTotal && manualTheoryTotal >= 0)
                ? manualTheoryTotal
                : result.theoryPossible;

            if (theoryPointsToUse > effectiveTheoryTotal) {
                await Utils.showAlert('Invalid Theory Score',
                    effectiveTheoryTotal === 0
                        ? 'Set the expected Theory total at the top of the page (what theory is marked out of) before entering theory scores.'
                        : `The theory score can't be more than the expected total of ${examResults._fmt(effectiveTheoryTotal)}.`);
                return false;
            }

            const caPointsToUse = hasCaScore ? caScore : 0;
            const effectiveCaTotal = hasCaTotal ? caTotal : 0;
            if (caPointsToUse > effectiveCaTotal) {
                await Utils.showAlert('Invalid CA Score',
                    effectiveCaTotal === 0
                        ? 'Set the expected CA total at the top of the page (what CA is marked out of, e.g. 30) before entering CA scores.'
                        : `The CA score can't be more than the expected total of ${examResults._fmt(effectiveCaTotal)}.`);
                return false;
            }

            // Calculate new total: objective + manual theory + CA
            const effectivePoints = result.objectivePoints + theoryPointsToUse + caPointsToUse;
            const effectiveTotalPoints = result.objectivePossible + effectiveTheoryTotal + effectiveCaTotal;
            const percentage = effectiveTotalPoints > 0 ? Math.round((effectivePoints / effectiveTotalPoints) * 100) : 0;
            const passScore = exam.passScore || 50;
            const passed = percentage >= passScore;

            const flags = {
                _manualTheoryScore: hasManualScore ? manualScore : null,
                _manualTheoryTotal: hasManualTotal ? manualTheoryTotal : null,
                _caScore: hasCaScore ? caScore : null,
                _caTotal: hasCaTotal ? caTotal : null,
                // Keep the "real" totals in sync so regrades and auto-submits
                // merge manual additions correctly instead of reading stale values
                _objective_total_points: result.objectivePossible,
                _objective_points_scored: result.objectivePoints,
                _real_total_points: effectiveTotalPoints,
                _real_points_scored: effectivePoints
            };

            // Save to database
            await dataService.updateResult(resultId, {
                score: percentage,
                totalPoints: effectiveTotalPoints,
                passed: passed,
                flags
            });

            // Update local state
            result.score = percentage;
            result.passed = passed;
            result.manualTheoryScore = hasManualScore ? manualScore : null;
            result.manualTheoryTotal = manualTheoryTotal;
            result.caScore = hasCaScore ? caScore : null;
            result.caTotal = hasCaTotal ? caTotal : null;

            examResults.renderStats();
            examResults.renderTable();
            examResults.renderCards();

            if (window.Utils && window.Utils.showToast) {
                Utils.showToast(`Scores saved for ${result.studentName}: ${percentage}%`, 'success');
            } else {
                await Utils.showAlert('Saved', `Scores saved!\n${result.studentName}: ${effectivePoints.toFixed(1)}/${effectiveTotalPoints.toFixed(1)} (${percentage}%)\nStatus: ${passed ? 'PASSED' : 'FAILED'}`);
            }

            return true;
        } catch (err) {
            console.error('Failed to save manual scores:', err);
            await Utils.showAlert('Error', 'Failed to save: ' + err.message);
            return false;
        }
    },

    /**
     * Save ALL manual theory + CA scores at once
     */
    saveAllManualTheoryScores: async () => {
        const resultIds = Array.from(new Set([
            ...Object.keys(examResults.manualTheoryScores),
            ...Object.keys(examResults.caScores)
        ]));
        if (resultIds.length === 0) {
            await Utils.showAlert('No Changes', 'No manual theory or CA scores have been entered.');
            return;
        }

        let savedCount = 0;
        let failedCount = 0;

        for (const resultId of resultIds) {
            try {
                const success = await examResults.saveManualTheoryScore(resultId);
                if (success) savedCount++;
                else failedCount++;
            } catch (err) {
                failedCount++;
            }
        }

        if (failedCount === 0) {
            await Utils.showAlert('Success', `Saved ${savedCount} score update(s) successfully!`);
        } else {
            await Utils.showAlert('Partial Success', `Saved ${savedCount}, failed ${failedCount}.`);
        }
    },

    exportCSV: async () => {
        if (examResults.results.length === 0) {
            await Utils.showAlert('No Data', 'No data to export');
            return;
        }

        const headers = ['Student Name', 'Date', 'Objective Points', 'Theory Points (App)', 'Theory Points (Manual)', 'Theory Total (Manual)', 'CA Score', 'CA Total', 'Total Points', 'Max Points', 'Score (%)', 'Status'];

        const rows = examResults.results.map(r => {
            const { effectivePoints, effectiveTotalPoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;
            const manualScore = examResults.manualTheoryScores[r.id];
            const manualTotal = examResults.globalTheoryTotal;
            const caScore = examResults.caScores[r.id];
            const caTotal = examResults.globalCaTotal;

            return [
                r.studentName,
                new Date(r.submittedAt).toLocaleDateString(),
                r.objectivePoints.toFixed(1),
                r.theoryPoints.toFixed(1),
                manualScore !== undefined && manualScore !== null ? manualScore : '',
                manualTotal !== undefined && manualTotal !== null ? manualTotal : '',
                caScore !== undefined && caScore !== null ? caScore : '',
                caTotal !== undefined && caTotal !== null ? caTotal : '',
                effectivePoints.toFixed(1),
                effectiveTotalPoints.toFixed(1),
                percentage,
                isPassed ? 'PASS' : 'FAIL'
            ];
        });

        const csvContent = [
            headers.map(h => examResults._csvCell(h)).join(','),
            ...rows.map(row => row.map(cell => examResults._csvCell(cell)).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `results_export_${Date.now()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', examResults.init);
} else {
    examResults.init();
}
