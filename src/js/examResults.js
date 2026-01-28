/**
 * Exam Results Controller (Teacher View)
 */

const examResults = {
    results: [],

    init: async () => {
        const params = new URLSearchParams(window.location.search);
        const examId = params.get('examId');

        if (!examId) {
            alert('No Exam ID');
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

            document.getElementById('exam-title').textContent = exam.title + ' - Results';

            // Enhance Results with Calculations (Client-side Fix)
            examResults.results = rawResults.map(r => {
                let calculatedPoints = 0;
                let totalPossible = 0;

                exam.questions.forEach(q => {
                    const qPoints = parseFloat(q.points) || 0.5;

                    // Skip theory questions - they require manual grading
                    if (q.type === 'theory') {
                        // Don't add to totalPossible since theory questions have 0 points
                        return;
                    }

                    totalPossible += qPoints;
                    const answer = r.answers[q.id];

                    if (q.type === 'fill_blank') {
                        if (answer && q.correctAnswer && answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                            calculatedPoints += qPoints;
                        }
                    } else if (q.type === 'match') {
                        if (answer) {
                            let allCorrect = true;
                            q.pairs.forEach((pair, idx) => {
                                if (answer[idx] !== pair.right) allCorrect = false;
                            });
                            if (allCorrect) calculatedPoints += qPoints;
                        }
                    } else {
                        // MCQ, True/False, Image MCQ - check if options exist
                        if (q.options) {
                            const correctOpt = q.options.find(o => o.isCorrect);
                            if (answer && correctOpt && correctOpt.id === answer) {
                                calculatedPoints += qPoints;
                            }
                        }
                    }
                });

                const passScore = exam.passScore || 50;
                const isPassed = r.score >= passScore;

                return {
                    ...r,
                    points: calculatedPoints,
                    totalPoints: totalPossible,
                    passed: isPassed
                };
            });

            examResults.renderStats();
            examResults.renderTable();
            examResults.renderCards(); // Add card rendering for mobile

        } catch (err) {
            console.error(err);
            alert('Error loading data');
        }
    },

    renderStats: () => {
        if (examResults.results.length === 0) {
            return;
        }

        const total = examResults.results.length;
        const sumScore = examResults.results.reduce((acc, r) => acc + r.score, 0);
        const avg = Math.round(sumScore / total);
        const passCount = examResults.results.filter(r => r.passed).length;
        const passRate = Math.round((passCount / total) * 100);

        document.getElementById('stats-total').textContent = total;
        document.getElementById('stats-avg').textContent = avg + '%';
        document.getElementById('stats-pass-rate').textContent = passRate + '%';
    },

    renderTable: () => {
        const tbody = document.getElementById('results-body');

        if (examResults.results.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 30px;">No submissions yet.</td></tr>';
            return;
        }

        tbody.innerHTML = examResults.results.map(r => `
            <tr>
                <td>${r.studentName}</td>
                <td>${Utils.formatDate(r.submittedAt)}</td>
                <td style="font-weight:bold;">${r.score}% (${r.points}/${r.totalPoints})</td>
                <td>
                    <span class="score-pill ${r.passed ? 'pass' : 'fail'}">
                        ${r.passed ? 'PASS' : 'FAIL'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="location.href='results.html?id=${r.id}'">View Detail</button>
                </td>
            </tr>
        `).join('');
    },

    renderCards: () => {
        const cardsContainer = document.getElementById('results-cards');

        if (examResults.results.length === 0) {
            cardsContainer.innerHTML = '<p style="text-align: center; padding: 30px;">No submissions yet.</p>';
            return;
        }

        cardsContainer.innerHTML = examResults.results.map(r => `
            <div class="result-card">
                <div class="result-card-header">
                    <div class="result-card-student">${r.studentName}</div>
                    <span class="score-pill ${r.passed ? 'pass' : 'fail'}">
                        ${r.passed ? 'PASS' : 'FAIL'}
                    </span>
                </div>
                <div class="result-card-body">
                    <div class="result-card-row">
                        <span class="result-card-label">Date</span>
                        <span class="result-card-value">${Utils.formatDate(r.submittedAt)}</span>
                    </div>
                    <div class="result-card-row">
                        <span class="result-card-label">Score</span>
                        <span class="result-card-value" style="font-weight: bold;">${r.score}%</span>
                    </div>
                    <div class="result-card-row">
                        <span class="result-card-label">Points</span>
                        <span class="result-card-value">${r.points} / ${r.totalPoints}</span>
                    </div>
                </div>
                <div class="result-card-actions">
                    <button class="btn btn-primary" style="flex: 1; padding: 8px;" onclick="location.href='results.html?id=${r.id}'">View Details</button>
                </div>
            </div>
        `).join('');
    },

    exportCSV: () => {
        if (examResults.results.length === 0) {
            alert('No data to export');
            return;
        }

        const headers = ['Student Name', 'Date', 'Score (%)', 'Points', 'Total Points', 'Status'];
        const rows = examResults.results.map(r => [
            r.studentName,
            new Date(r.submittedAt).toLocaleDateString(),
            r.score,
            r.points,
            r.totalPoints,
            r.passed ? 'PASS' : 'FAIL'
        ]);

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
