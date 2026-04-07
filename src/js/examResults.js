/**
 * Exam Results Controller (Teacher View)
 * Supports:
 * - Auto-graded objective scores
 * - Theory scores saved via the detail view (results.js) 
 * - Manual theory score input directly in the results list (for pen-and-paper theory answers)
 * - Auto-summing of manual theory + objective scores
 */

const examResults = {
    results: [],
    currentExam: null,
    hasTheoryQuestions: false,
    manualTheoryScores: {}, // { resultId: manualScore }
    manualTheoryTotals: {}, // { resultId: manualTheoryTotal }

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
                manualTheoryTotal: savedManualTotal
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

            // Show manual theory save button if theory questions exist
            const saveAllBtn = document.getElementById('save-all-theory-btn');
            if (saveAllBtn && examResults.hasTheoryQuestions) {
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
     * Get the effective total score for a result, including manual theory if applicable.
     * Priority:
     * 1. If theory was graded in the app (theoryPoints > 0), that score is already included in r.points
     * 2. If a manual theory score was entered here (for pen-and-paper), it adds to objective points
     * 3. The manual theory score does NOT double-count with app-graded theory
     */
    _getEffectiveScore(r) {
        const manualScore = examResults.manualTheoryScores[r.id];
        const manualTheoryTotal = examResults.manualTheoryTotals[r.id];
        const effectiveTheoryTotal = (manualTheoryTotal !== undefined && manualTheoryTotal !== null && manualTheoryTotal >= 0)
            ? manualTheoryTotal
            : r.theoryPossible;
        const effectiveTotalPoints = r.objectivePossible + effectiveTheoryTotal;

        // If there's a manual theory score entered in this view
        if (manualScore !== undefined && manualScore !== null && manualScore >= 0) {
            // If theory was already graded in-app (theoryPoints > 0), the manual score replaces it
            // because the teacher is overriding with pen-and-paper score
            const basePoints = r.objectivePoints; // Always start from objective
            const effectivePoints = basePoints + manualScore;
            const percentage = effectiveTotalPoints > 0 ? Math.round((effectivePoints / effectiveTotalPoints) * 100) : 0;
            return { effectivePoints, effectiveTotalPoints, percentage };
        }

        // No manual override — use the existing calculated total (objective + app-graded theory)
        const percentage = effectiveTotalPoints > 0 ? Math.round((r.points / effectiveTotalPoints) * 100) : 0;
        return { effectivePoints: r.points, effectiveTotalPoints, percentage };
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
        const hasTheory = examResults.hasTheoryQuestions;

        if (examResults.results.length === 0) {
            container.innerHTML = '<div class="result-boxes-empty">No submissions yet.</div>';
            return;
        }

        container.innerHTML = examResults.results.map(r => {
            const { effectivePoints, effectiveTotalPoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;

            if (hasTheory) {
                const maxTheoryPoints = examResults._getTheoryPossible(examResults.currentExam);

                const currentManual = examResults.manualTheoryScores[r.id] !== undefined
                    ? examResults.manualTheoryScores[r.id] : '';
                const currentManualTotal = examResults.manualTheoryTotals[r.id] !== undefined
                    ? examResults.manualTheoryTotals[r.id] : '';
                const hasAppTheory = r.theoryPoints > 0;

                return `
                <div class="result-box">
                    <div class="result-box-row1">
                        <span class="result-box-name">${examResults._escapeHtml(r.studentName)}</span>
                        <div class="result-box-row1-right">
                            <span class="score-pill ${isPassed ? 'pass' : 'fail'}">${isPassed ? 'PASS' : 'FAIL'}</span>
                            <button class="btn-view-detail" onclick="location.href='results.html?id=${r.id}'">
                                <i class="fas fa-eye"></i> View
                            </button>
                        </div>
                    </div>
                    <div class="result-box-data-row" style="display:flex; justify-content:space-between; align-items:flex-start; padding-top:10px; border-top:1px solid var(--border-color); margin-top:8px;">
                        <div style="display:flex; flex-direction:column; gap:4px; flex: 1.5;">
                            <span style="font-size:0.65rem; color:var(--light-text); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Date</span>
                            <span class="result-box-cell">${Utils.formatDate(r.submittedAt)}</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:center; flex: 1;">
                            <span style="font-size:0.65rem; color:var(--light-text); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Obj. Score</span>
                            <span class="result-box-cell result-box-bold">${r.objectivePoints.toFixed(1)}</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:center; flex: 2.5;">
                            <span style="font-size:0.65rem; color:var(--light-text); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Theory (Manual)</span>
                            <div class="result-box-cell result-box-theory-inputs">
                                <input type="number"
                                    id="manual-theory-${r.id}"
                                    value="${currentManual}"
                                    min="0" step="0.5"
                                    placeholder="${hasAppTheory ? r.theoryPoints.toFixed(1) : '0'}"
                                    onchange="examResults.onManualTheoryChange('${r.id}', this.value)"
                                    title="${hasAppTheory ? 'App-graded: ' + r.theoryPoints.toFixed(1) + ' pts' : 'Enter theory score'}"
                                />
                                <span class="result-box-divider">/</span>
                                <input type="number"
                                    id="manual-theory-total-${r.id}"
                                    value="${currentManualTotal}"
                                    min="0" step="0.5"
                                    placeholder="${maxTheoryPoints.toFixed(1)}"
                                    onchange="examResults.onManualTheoryTotalChange('${r.id}', this.value)"
                                    title="Custom total. Leave blank for default."
                                />
                                ${hasAppTheory ? '<span class="result-box-app-badge" title="App-graded">App</span>' : ''}
                            </div>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:center; flex: 1;">
                            <span style="font-size:0.65rem; color:var(--light-text); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Total</span>
                            <span class="result-box-cell result-box-bold result-box-primary">${effectivePoints.toFixed(1)}/${effectiveTotalPoints.toFixed(1)}</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end; width: 40px; margin-top:14px;">
                            ${(currentManual !== '' || currentManualTotal !== '') ? `<button class="result-box-save-btn" onclick="examResults.saveManualTheoryScore('${r.id}')" title="Save theory score"><i class="fas fa-save"></i></button>` : '<span class="result-box-cell result-box-save-placeholder"></span>'}
                        </div>
                    </div>
                </div>`;
            } else {
                return `
                <div class="result-box">
                    <div class="result-box-row1">
                        <span class="result-box-name">${examResults._escapeHtml(r.studentName)}</span>
                        <div class="result-box-row1-right">
                            <span class="score-pill ${isPassed ? 'pass' : 'fail'}">${isPassed ? 'PASS' : 'FAIL'}</span>
                            <button class="btn-view-detail" onclick="location.href='results.html?id=${r.id}'">
                                <i class="fas fa-eye"></i> View
                            </button>
                        </div>
                    </div>
                    <div class="result-box-data-row" style="display:flex; justify-content:space-between; align-items:flex-start; padding-top:10px; border-top:1px solid var(--border-color); margin-top:8px;">
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <span style="font-size:0.65rem; color:var(--light-text); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Date</span>
                            <span class="result-box-cell">${Utils.formatDate(r.submittedAt)}</span>
                        </div>
                        <div style="display:flex; flex-direction:column; gap:4px; align-items:flex-end;">
                            <span style="font-size:0.65rem; color:var(--light-text); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Score</span>
                            <span class="result-box-cell result-box-bold result-box-primary">${effectivePoints.toFixed(1)}/${effectiveTotalPoints.toFixed(1)}</span>
                        </div>
                    </div>
                </div>`;
            }
        }).join('');
    },

    renderCards: () => {
        const cardsContainer = document.getElementById('results-cards');
        const hasTheory = examResults.hasTheoryQuestions;

        if (examResults.results.length === 0) {
            cardsContainer.innerHTML = '<p style="text-align: center; padding: 30px;">No submissions yet.</p>';
            return;
        }

        cardsContainer.innerHTML = examResults.results.map(r => {
            const { effectivePoints, effectiveTotalPoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;

            let theoryInputHtml = '';
            if (hasTheory) {
                const maxTheoryPoints = examResults._getTheoryPossible(examResults.currentExam);

                const currentManual = examResults.manualTheoryScores[r.id] !== undefined
                    ? examResults.manualTheoryScores[r.id] : '';
                const currentManualTotal = examResults.manualTheoryTotals[r.id] !== undefined
                    ? examResults.manualTheoryTotals[r.id] : '';
                const hasAppTheory = r.theoryPoints > 0;

                theoryInputHtml = `
                    <div class="result-card-row" style="flex-direction:column; align-items:stretch; gap:6px; padding:10px; background:var(--inner-bg); border-radius:8px; margin-top:4px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:4px;">
                            <span class="result-card-label">📝 Theory Score (Manual)</span>
                            ${hasAppTheory ? '<span style="font-size:0.7rem; padding:2px 6px; background:rgba(46,204,113,0.15); color:var(--success-color); border-radius:4px;">App: ' + r.theoryPoints.toFixed(1) + '</span>' : ''}
                        </div>
                        <div style="display:flex; flex-direction:column; gap:8px;">
                            <div style="display:flex; align-items:center; gap:8px; width: 100%;">
                                <input type="number" 
                                    id="mobile-manual-theory-${r.id}"
                                    value="${currentManual}" 
                                    min="0" step="0.5"
                                    placeholder="${hasAppTheory ? r.theoryPoints.toFixed(1) : '0'}"
                                    style="flex:1; width:0; min-width:50px; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; background:var(--card-bg); color:var(--text-color); font-size:0.9rem;"
                                    onchange="examResults.onManualTheoryChange('${r.id}', this.value, true)"
                                />
                                <span style="font-size:0.85rem; color:var(--light-text); flex-shrink:0;">/</span>
                                <input type="number"
                                    id="mobile-manual-theory-total-${r.id}"
                                    value="${currentManualTotal}"
                                    min="0" step="0.5"
                                    placeholder="${maxTheoryPoints.toFixed(1)}"
                                    style="flex:1; width:0; min-width:50px; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; background:var(--card-bg); color:var(--text-color); font-size:0.9rem;"
                                    onchange="examResults.onManualTheoryTotalChange('${r.id}', this.value, true)"
                                />
                            </div>
                            <button class="btn btn-primary" style="padding:10px 16px; font-size:0.85rem; width: 100%; border-radius: 8px; font-weight: 600;" onclick="examResults.saveManualTheoryScore('${r.id}')">💾 Save Score</button>
                        </div>
                        <div style="font-size:0.8rem; color:var(--light-text);">Leave theory total blank to keep the exam default of ${maxTheoryPoints.toFixed(1)}.</div>
                    </div>
                `;
            }

            return `
            <div class="result-card">
                <div class="result-card-header">
                    <div class="result-card-student">${examResults._escapeHtml(r.studentName)}</div>
                    <span class="score-pill ${isPassed ? 'pass' : 'fail'}">
                        ${isPassed ? 'PASS' : 'FAIL'}
                    </span>
                </div>
                <div class="result-card-body">
                    <div class="result-card-row">
                        <span class="result-card-label">Date</span>
                        <span class="result-card-value">${Utils.formatDate(r.submittedAt)}</span>
                    </div>
                    ${hasTheory ? `
                    <div class="result-card-row">
                        <span class="result-card-label">Objective</span>
                        <span class="result-card-value" style="font-weight: bold;">${r.objectivePoints.toFixed(1)} pts</span>
                    </div>
                    ` : ''}
                    <div class="result-card-row">
                        <span class="result-card-label">${hasTheory ? 'Total Score' : 'Score'}</span>
                        <span class="result-card-value" style="font-weight: bold;">${effectivePoints.toFixed(1)} / ${effectiveTotalPoints.toFixed(1)}</span>
                    </div>
                    ${theoryInputHtml}
                </div>
                <div class="result-card-actions">
                    <button class="btn btn-primary" style="flex: 1; padding: 8px;" onclick="location.href='results.html?id=${r.id}'">View Details</button>
                </div>
            </div>
        `;
        }).join('');
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

    onManualTheoryTotalChange: (resultId, value, isMobile = false) => {
        const numValue = parseFloat(value);
        if (value === '' || isNaN(numValue) || numValue < 0) {
            delete examResults.manualTheoryTotals[resultId];
        } else {
            examResults.manualTheoryTotals[resultId] = numValue;
        }

        const desktopInput = document.getElementById(`manual-theory-total-${resultId}`);
        const mobileInput = document.getElementById(`mobile-manual-theory-total-${resultId}`);
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
     * Save the manual theory score for a specific student result.
     * This persists the score to the database and recalculates the total.
     */
    saveManualTheoryScore: async (resultId) => {
        const manualScore = examResults.manualTheoryScores[resultId];
        const manualTheoryTotal = examResults.manualTheoryTotals[resultId];
        const hasManualScore = manualScore !== undefined && manualScore !== null;
        const hasManualTotal = manualTheoryTotal !== undefined && manualTheoryTotal !== null;

        if (!hasManualScore && !hasManualTotal) {
            await Utils.showAlert('No Changes', 'Please enter a theory score or theory total first.');
            return;
        }

        const result = examResults.results.find(r => r.id === resultId);
        if (!result) return;

        const exam = examResults.currentExam;
        if (!exam) return;

        try {
            const theoryPointsToUse = hasManualScore ? manualScore : result.theoryPoints;
            const effectiveTheoryTotal = (manualTheoryTotal !== undefined && manualTheoryTotal !== null && manualTheoryTotal >= 0)
                ? manualTheoryTotal
                : result.theoryPossible;

            if (manualTheoryTotal !== undefined && manualTheoryTotal !== null && manualTheoryTotal < theoryPointsToUse) {
                await Utils.showAlert('Invalid Theory Total', 'The theory total cannot be less than the theory score you entered.');
                return;
            }

            // Calculate new total: objective + manual theory
            const effectivePoints = result.objectivePoints + theoryPointsToUse;
            const effectiveTotalPoints = result.objectivePossible + effectiveTheoryTotal;
            const percentage = effectiveTotalPoints > 0 ? Math.round((effectivePoints / effectiveTotalPoints) * 100) : 0;
            const passScore = exam.passScore || 50;
            const passed = percentage >= passScore;

            const flags = {
                _manualTheoryScore: hasManualScore ? manualScore : null
            };
            if (manualTheoryTotal !== undefined) {
                flags._manualTheoryTotal = manualTheoryTotal;
            }

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

            examResults.renderStats();
            examResults.renderTable();
            examResults.renderCards();

            if (window.Utils && window.Utils.showToast) {
                Utils.showToast(`Theory update saved for ${result.studentName}: ${percentage}%`, 'success');
            } else {
                await Utils.showAlert('Saved', `Theory score saved!\n${result.studentName}: ${effectivePoints.toFixed(1)}/${effectiveTotalPoints.toFixed(1)} (${percentage}%)\nStatus: ${passed ? 'PASSED' : 'FAILED'}`);
            }

        } catch (err) {
            console.error('Failed to save manual theory score:', err);
            await Utils.showAlert('Error', 'Failed to save: ' + err.message);
        }
    },

    /**
     * Save ALL manual theory scores at once
     */
    saveAllManualTheoryScores: async () => {
        const resultIds = Array.from(new Set([
            ...Object.keys(examResults.manualTheoryScores),
            ...Object.keys(examResults.manualTheoryTotals)
        ]));
        if (resultIds.length === 0) {
            await Utils.showAlert('No Changes', 'No manual theory scores or totals have been entered.');
            return;
        }

        let savedCount = 0;
        let failedCount = 0;

        for (const resultId of resultIds) {
            try {
                await examResults.saveManualTheoryScore(resultId);
                savedCount++;
            } catch (err) {
                failedCount++;
            }
        }

        if (failedCount === 0) {
            await Utils.showAlert('Success', `Saved ${savedCount} theory score(s) successfully!`);
        } else {
            await Utils.showAlert('Partial Success', `Saved ${savedCount}, failed ${failedCount}.`);
        }
    },

    exportCSV: async () => {
        if (examResults.results.length === 0) {
            await Utils.showAlert('No Data', 'No data to export');
            return;
        }

        const hasTheory = examResults.hasTheoryQuestions;
        const headers = hasTheory
            ? ['Student Name', 'Date', 'Objective Points', 'Theory Points (App)', 'Theory Points (Manual)', 'Theory Total (Manual)', 'Total Points', 'Max Points', 'Score (%)', 'Status']
            : ['Student Name', 'Date', 'Score (%)', 'Points', 'Total Points', 'Status'];

        const rows = examResults.results.map(r => {
            const { effectivePoints, effectiveTotalPoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;
            const manualScore = examResults.manualTheoryScores[r.id] || '';
            const manualTotal = examResults.manualTheoryTotals[r.id] || '';

            if (hasTheory) {
                return [
                    r.studentName,
                    new Date(r.submittedAt).toLocaleDateString(),
                    r.objectivePoints.toFixed(1),
                    r.theoryPoints.toFixed(1),
                    manualScore !== '' ? manualScore : '',
                    manualTotal !== '' ? manualTotal : '',
                    effectivePoints.toFixed(1),
                    effectiveTotalPoints.toFixed(1),
                    percentage,
                    isPassed ? 'PASS' : 'FAIL'
                ];
            } else {
                return [
                    r.studentName,
                    new Date(r.submittedAt).toLocaleDateString(),
                    percentage,
                    effectivePoints.toFixed(1),
                    effectiveTotalPoints.toFixed(1),
                    isPassed ? 'PASS' : 'FAIL'
                ];
            }
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

document.addEventListener('DOMContentLoaded', examResults.init);
