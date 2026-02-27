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

    /**
     * Calculate points for a single result based on exam questions.
     * Separates objective and theory (app-graded) points.
     */
    _calculatePoints(r, exam) {
        let objectivePoints = 0;
        let theoryPoints = 0;
        let totalPossible = 0;

        exam.questions.forEach(q => {
            const qPoints = parseFloat(q.points) || 0.5;
            totalPossible += qPoints;

            if (q.type === 'theory') {
                // Theory questions - use saved theory scores if available (graded via detail view)
                const theoryScore = r.theoryScores && r.theoryScores[q.id] ? parseFloat(r.theoryScores[q.id]) : 0;
                theoryPoints += theoryScore;
            } else if (q.type === 'fill_blank') {
                const answer = r.answers[q.id];
                if (answer && q.correctAnswer && answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                    objectivePoints += qPoints;
                }
            } else if (q.type === 'match') {
                const answer = r.answers[q.id];
                if (answer) {
                    let allCorrect = true;
                    q.pairs.forEach((pair, idx) => {
                        if (answer[idx] !== pair.right) allCorrect = false;
                    });
                    if (allCorrect) objectivePoints += qPoints;
                }
            } else if (q.type === 'image_multi') {
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

        return { objectivePoints, theoryPoints, totalPossible };
    },

    init: async () => {
        const params = new URLSearchParams(window.location.search);
        const examId = params.get('examId');

        if (!examId) {
            await Utils.showAlert('Error', 'No Exam ID');
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

            document.getElementById('exam-title').textContent = exam.title + ' - Results';

            // Enhance Results with Calculations
            examResults.results = rawResults.map(r => {
                const { objectivePoints, theoryPoints, totalPossible } = examResults._calculatePoints(r, exam);
                const calculatedPoints = objectivePoints + theoryPoints;
                const passScore = exam.passScore || 50;
                const isPassed = r.score >= passScore;

                // Initialize manual theory score from saved data if available
                // The manualTheoryScore is stored in flags._manualTheoryScore
                const savedManual = (r.flags && r.flags._manualTheoryScore !== undefined)
                    ? parseFloat(r.flags._manualTheoryScore) : null;
                if (savedManual !== null) {
                    examResults.manualTheoryScores[r.id] = savedManual;
                }

                return {
                    ...r,
                    objectivePoints,
                    theoryPoints,
                    points: calculatedPoints,
                    totalPoints: totalPossible,
                    passed: isPassed,
                    manualTheoryScore: savedManual
                };
            });

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

                        examResults.currentExam = freshExam;
                        examResults.hasTheoryQuestions = freshExam.questions.some(q => q.type === 'theory');

                        examResults.results = freshResults.map(r => {
                            const { objectivePoints, theoryPoints, totalPossible } = examResults._calculatePoints(r, freshExam);
                            const calculatedPoints = objectivePoints + theoryPoints;
                            const passScore = freshExam.passScore || 50;
                            const isPassed = r.score >= passScore;

                            const savedManual = (r.flags && r.flags._manualTheoryScore !== undefined)
                                ? parseFloat(r.flags._manualTheoryScore) : null;
                            if (savedManual !== null) {
                                examResults.manualTheoryScores[r.id] = savedManual;
                            }

                            return {
                                ...r,
                                objectivePoints,
                                theoryPoints,
                                points: calculatedPoints,
                                totalPoints: totalPossible,
                                passed: isPassed,
                                manualTheoryScore: savedManual
                            };
                        });

                        examResults.renderStats();
                        examResults.renderTable();
                        examResults.renderCards();

                    } catch (e) { console.warn('Background refresh failed', e); }
                }, 1000);
            }

        } catch (err) {
            console.error(err);
            await Utils.showAlert('Error', 'Error loading data');
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

        // If there's a manual theory score entered in this view
        if (manualScore !== undefined && manualScore !== null && manualScore > 0) {
            // If theory was already graded in-app (theoryPoints > 0), the manual score replaces it
            // because the teacher is overriding with pen-and-paper score
            const basePoints = r.objectivePoints; // Always start from objective
            const effectivePoints = basePoints + manualScore;
            const percentage = r.totalPoints > 0 ? Math.round((effectivePoints / r.totalPoints) * 100) : 0;
            return { effectivePoints, percentage };
        }

        // No manual override — use the existing calculated total (objective + app-graded theory)
        return { effectivePoints: r.points, percentage: r.score };
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
        const tbody = document.getElementById('results-body');
        const hasTheory = examResults.hasTheoryQuestions;

        if (examResults.results.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${hasTheory ? 7 : 5}" style="text-align:center; padding: 30px;">No submissions yet.</td></tr>`;
            return;
        }

        // Update table header if theory questions exist
        const thead = tbody.parentElement.querySelector('thead tr');
        if (thead && hasTheory) {
            thead.innerHTML = `
                <th>Student</th>
                <th>Date</th>
                <th>Obj. Score</th>
                <th>Theory Score (Manual)</th>
                <th>Total Score</th>
                <th>Status</th>
                <th>Actions</th>
            `;
        }

        tbody.innerHTML = examResults.results.map(r => {
            const { effectivePoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;

            if (hasTheory) {
                // Calculate max possible theory points
                let maxTheoryPoints = 0;
                examResults.currentExam.questions.forEach(q => {
                    if (q.type === 'theory') maxTheoryPoints += parseFloat(q.points) || 0;
                });

                const currentManual = examResults.manualTheoryScores[r.id] !== undefined
                    ? examResults.manualTheoryScores[r.id] : '';
                const hasAppTheory = r.theoryPoints > 0;

                return `
                <tr>
                    <td>${r.studentName}</td>
                    <td>${Utils.formatDate(r.submittedAt)}</td>
                    <td style="font-weight:bold;">${r.objectivePoints.toFixed(1)}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <input type="number" 
                                id="manual-theory-${r.id}"
                                value="${currentManual}" 
                                min="0" max="${maxTheoryPoints}" step="0.5"
                                placeholder="${hasAppTheory ? r.theoryPoints.toFixed(1) : '0'}"
                                style="width:70px; padding:5px 8px; border:1px solid var(--border-color); border-radius:6px; background:var(--inner-bg); color:var(--text-color); font-size:0.85rem;"
                                onchange="examResults.onManualTheoryChange('${r.id}', this.value)"
                                title="${hasAppTheory ? 'App-graded theory: ' + r.theoryPoints.toFixed(1) + ' pts. Enter here to override with pen-and-paper score.' : 'Enter theory score from pen-and-paper'}"
                            />
                            <span style="font-size:0.8rem; color:var(--light-text);">/ ${maxTheoryPoints}</span>
                            ${hasAppTheory ? '<span title="Theory already graded in app" style="font-size:0.75rem; color:var(--success-color);">✓ App</span>' : ''}
                        </div>
                    </td>
                    <td style="font-weight:bold; color:var(--primary-color);">${percentage}% (${effectivePoints.toFixed(1)}/${r.totalPoints.toFixed(1)})</td>
                    <td>
                        <span class="score-pill ${isPassed ? 'pass' : 'fail'}">
                            ${isPassed ? 'PASS' : 'FAIL'}
                        </span>
                    </td>
                    <td>
                        <div style="display:flex; gap:4px; flex-wrap:wrap;">
                            <button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="location.href='results.html?id=${r.id}'">View Detail</button>
                            ${currentManual !== '' ? `<button class="btn" style="padding: 4px 10px; font-size: 0.75rem; background:var(--success-color); color:white; border:none;" onclick="examResults.saveManualTheoryScore('${r.id}')">💾 Save</button>` : ''}
                        </div>
                    </td>
                </tr>
            `;
            } else {
                return `
                <tr>
                    <td>${r.studentName}</td>
                    <td>${Utils.formatDate(r.submittedAt)}</td>
                    <td style="font-weight:bold;">${percentage}% (${effectivePoints.toFixed(1)}/${r.totalPoints.toFixed(1)})</td>
                    <td>
                        <span class="score-pill ${isPassed ? 'pass' : 'fail'}">
                            ${isPassed ? 'PASS' : 'FAIL'}
                        </span>
                    </td>
                    <td>
                        <button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="location.href='results.html?id=${r.id}'">View Detail</button>
                    </td>
                </tr>
            `;
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
            const { effectivePoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;

            let theoryInputHtml = '';
            if (hasTheory) {
                let maxTheoryPoints = 0;
                examResults.currentExam.questions.forEach(q => {
                    if (q.type === 'theory') maxTheoryPoints += parseFloat(q.points) || 0;
                });

                const currentManual = examResults.manualTheoryScores[r.id] !== undefined
                    ? examResults.manualTheoryScores[r.id] : '';
                const hasAppTheory = r.theoryPoints > 0;

                theoryInputHtml = `
                    <div class="result-card-row" style="flex-direction:column; align-items:stretch; gap:6px; padding:10px; background:var(--inner-bg); border-radius:8px; margin-top:4px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="result-card-label">📝 Theory Score (Manual)</span>
                            ${hasAppTheory ? '<span style="font-size:0.7rem; padding:2px 6px; background:rgba(46,204,113,0.15); color:var(--success-color); border-radius:4px;">App: ' + r.theoryPoints.toFixed(1) + '</span>' : ''}
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <input type="number" 
                                id="mobile-manual-theory-${r.id}"
                                value="${currentManual}" 
                                min="0" max="${maxTheoryPoints}" step="0.5"
                                placeholder="${hasAppTheory ? r.theoryPoints.toFixed(1) : '0'}"
                                style="flex:1; padding:8px 10px; border:1px solid var(--border-color); border-radius:8px; background:var(--card-bg); color:var(--text-color); font-size:0.9rem;"
                                onchange="examResults.onManualTheoryChange('${r.id}', this.value, true)"
                            />
                            <span style="font-size:0.85rem; color:var(--light-text);">/ ${maxTheoryPoints}</span>
                            <button class="btn btn-primary" style="padding:6px 12px; font-size:0.8rem;" onclick="examResults.saveManualTheoryScore('${r.id}')">💾</button>
                        </div>
                    </div>
                `;
            }

            return `
            <div class="result-card">
                <div class="result-card-header">
                    <div class="result-card-student">${r.studentName}</div>
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
                        <span class="result-card-value" style="font-weight: bold;">${percentage}%</span>
                    </div>
                    <div class="result-card-row">
                        <span class="result-card-label">Points</span>
                        <span class="result-card-value">${effectivePoints.toFixed(1)} / ${r.totalPoints.toFixed(1)}</span>
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

    /**
     * Save the manual theory score for a specific student result.
     * This persists the score to the database and recalculates the total.
     */
    saveManualTheoryScore: async (resultId) => {
        const manualScore = examResults.manualTheoryScores[resultId];
        if (manualScore === undefined || manualScore === null) {
            await Utils.showAlert('No Score', 'Please enter a theory score first.');
            return;
        }

        const result = examResults.results.find(r => r.id === resultId);
        if (!result) return;

        const exam = examResults.currentExam;
        if (!exam) return;

        try {
            // Calculate new total: objective + manual theory
            const effectivePoints = result.objectivePoints + manualScore;
            const percentage = result.totalPoints > 0 ? Math.round((effectivePoints / result.totalPoints) * 100) : 0;
            const passScore = exam.passScore || 50;
            const passed = percentage >= passScore;

            // Save to database
            await dataService.updateResult(resultId, {
                score: percentage,
                totalPoints: Math.round(result.totalPoints),
                passed: passed,
                flags: {
                    _manualTheoryScore: manualScore
                }
            });

            // Update local state
            result.score = percentage;
            result.passed = passed;
            result.manualTheoryScore = manualScore;

            examResults.renderStats();
            examResults.renderTable();
            examResults.renderCards();

            if (window.Utils && window.Utils.showToast) {
                Utils.showToast(`Theory score saved for ${result.studentName}: ${manualScore} pts → Total: ${percentage}%`, 'success');
            } else {
                await Utils.showAlert('Saved', `Theory score saved!\n${result.studentName}: ${effectivePoints.toFixed(1)}/${result.totalPoints.toFixed(1)} (${percentage}%)\nStatus: ${passed ? 'PASSED' : 'FAILED'}`);
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
        const entries = Object.entries(examResults.manualTheoryScores);
        if (entries.length === 0) {
            await Utils.showAlert('No Scores', 'No manual theory scores have been entered.');
            return;
        }

        let savedCount = 0;
        let failedCount = 0;

        for (const [resultId, score] of entries) {
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
            ? ['Student Name', 'Date', 'Objective Points', 'Theory Points (App)', 'Theory Points (Manual)', 'Total Points', 'Max Points', 'Score (%)', 'Status']
            : ['Student Name', 'Date', 'Score (%)', 'Points', 'Total Points', 'Status'];

        const rows = examResults.results.map(r => {
            const { effectivePoints, percentage } = examResults._getEffectiveScore(r);
            const passScore = examResults.currentExam ? (examResults.currentExam.passScore || 50) : 50;
            const isPassed = percentage >= passScore;
            const manualScore = examResults.manualTheoryScores[r.id] || '';

            if (hasTheory) {
                return [
                    r.studentName,
                    new Date(r.submittedAt).toLocaleDateString(),
                    r.objectivePoints.toFixed(1),
                    r.theoryPoints.toFixed(1),
                    manualScore !== '' ? manualScore : '',
                    effectivePoints.toFixed(1),
                    r.totalPoints.toFixed(1),
                    percentage,
                    isPassed ? 'PASS' : 'FAIL'
                ];
            } else {
                return [
                    r.studentName,
                    new Date(r.submittedAt).toLocaleDateString(),
                    percentage,
                    effectivePoints.toFixed(1),
                    r.totalPoints.toFixed(1),
                    isPassed ? 'PASS' : 'FAIL'
                ];
            }
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.join(','))
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
