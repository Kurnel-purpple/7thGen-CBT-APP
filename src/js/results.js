/**
 * Result Detail Controller
 */

const resultsController = {
    init: async () => {
        const params = new URLSearchParams(window.location.search);
        const resultId = params.get('id');

        if (!resultId) {
            alert('No result ID specified');
            window.history.back();
            return;
        }

        const user = dataService.getCurrentUser();
        // Allow student (own result) or teacher (any result)

        try {
            // In a real API we would fetch result by ID.
            // Since our getResults filters, we get all and find.
            // Optimization: Add getResultById to DataService if needed, but filter is fine for MVP local.
            const allResults = await dataService.getResults();
            const result = allResults.find(r => r.id === resultId);

            if (!result) throw new Error('Result not found');

            // Access Check
            if (user.role === 'student' && result.studentId !== user.id) {
                alert('Unauthorized Access');
                window.location.href = '../index.html';
                return;
            }

            // Get Exam for questions text
            const exam = await dataService.getExamById(result.examId);

            resultsController.render(result, exam);

        } catch (err) {
            console.error(err);
            alert('Error loading result');
            window.history.back();
        }
    },

    render: (result, exam) => {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('result-content').style.display = 'block';

        const title = exam ? exam.title : 'Unknown Exam';
        document.getElementById('exam-title').textContent = title;
        document.getElementById('student-name').textContent = result.studentName || 'Student'; // Fallback if name not joined

        // 1. Use stored score and totalPoints if available (for updated results)
        // Otherwise recalculate for backward compatibility
        let actualPoints = 0;
        let totalPossible = 0;

        // Prefer stored totalPoints (updated when flags are resolved)
        if (result.totalPoints) {
            totalPossible = result.totalPoints;
            // Calculate actual points from percentage
            actualPoints = Math.round((result.score / 100) * totalPossible);
        } else {
            // Fallback: Recalculate from exam questions (for old results)
            if (exam) {
                exam.questions.forEach(q => {
                    const qPoints = parseFloat(q.points) || 0.5;
                    totalPossible += qPoints;

                    const answer = result.answers[q.id];

                    // Scoring Logic (Match takeExam.js)
                    if (q.type === 'fill_blank') {
                        if (answer && q.correctAnswer && answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                            actualPoints += qPoints;
                        }
                    } else if (q.type === 'match') {
                        if (answer) {
                            let allCorrect = true;
                            q.pairs.forEach((pair, idx) => {
                                if (answer[idx] !== pair.right) allCorrect = false;
                            });
                            if (allCorrect) actualPoints += qPoints;
                        }
                    } else {
                        // MCQ / TrueFalse
                        const correctOpt = q.options.find(o => o.isCorrect);
                        if (answer && correctOpt && correctOpt.id === answer) {
                            actualPoints += qPoints;
                        }
                    }
                });
            }
        }

        // Use saved score (percentage) - this is the source of truth
        const percentage = result.score;

        // Determine Pass/Fail - prefer stored values, fallback to calculation
        let passScore, isPassed;
        if (result.passScore !== undefined && result.passed !== undefined) {
            // Use stored values (updated when flags are resolved)
            passScore = result.passScore;
            isPassed = result.passed;
        } else {
            // Fallback: Calculate from exam
            passScore = exam ? (exam.passScore || 50) : 50;
            isPassed = percentage >= passScore;
        }

        // Score UI
        const circle = document.getElementById('score-circle');
        circle.textContent = `${actualPoints}/${totalPossible}`;
        circle.style.fontSize = '2rem'; // Adjust for longer text
        if (isPassed) {
            circle.classList.remove('fail'); // Ensure no conflict
            circle.classList.add('pass');
            document.getElementById('pass-status').textContent = 'PASSED';
            document.getElementById('pass-status').style.color = 'var(--success-color)';
        } else {
            circle.classList.remove('pass');
            circle.classList.add('fail');
            document.getElementById('pass-status').textContent = 'FAILED';
            document.getElementById('pass-status').style.color = 'var(--accent-color)';
        }

        document.getElementById('points-summary').textContent = `${actualPoints} / ${totalPossible} Points`;

        // Questions Render
        const container = document.getElementById('questions-list');
        if (!exam) {
            container.innerHTML = '<p>Exam data missing, cannot show breakdown.</p>';
            return;
        }

        container.innerHTML = exam.questions.map((q, i) => {
            const selectedOptId = result.answers[q.id];

            // Determine Correctness for Display
            let isCorrect = false;
            let optionsHtml = '';

            // Render Logic Per Type
            if (q.type === 'fill_blank') {
                isCorrect = (selectedOptId && q.correctAnswer && selectedOptId.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase());
                optionsHtml = `
                    <div style="margin-bottom:5px;"><strong>Student Answer:</strong> ${selectedOptId || '(No Answer)'}</div>
                    <div style="color:var(--success-color);"><strong>Correct Answer:</strong> ${q.correctAnswer}</div>
                `;
            } else if (q.type === 'match') {
                // Complex Logic for match display... simplified for now
                // Just show raw data
                isCorrect = false; // Need deep check
                if (selectedOptId) {
                    let allC = true;
                    q.pairs.forEach((pair, idx) => { if (selectedOptId[idx] !== pair.right) allC = false; });
                    isCorrect = allC;
                }
                optionsHtml = `<div style="font-style:italic; color:gray;">(Matching Question Detail - See Dashboard)</div>`;
            } else {
                // MCQ / Image / TF
                const correctOpt = q.options.find(o => o.isCorrect);
                isCorrect = (selectedOptId === correctOpt.id);

                optionsHtml = q.options.map(opt => {
                    let className = 'opt-row';
                    if (opt.id === selectedOptId) {
                        className += ' selected';
                        if (!isCorrect) className += ' wrong-answer';
                        else className += ' correct-answer';
                    }
                    if (opt.id === correctOpt.id && !isCorrect) {
                        className += ' correct-answer';
                    }
                    return `<div class="${className}">
                        <span style="margin-right:10px;">${opt.id === selectedOptId ? '●' : '○'}</span>
                        ${opt.text}
                    </div>`;
                }).join('');
            }

            const isFlagged = result.flags && result.flags[q.id];

            return `
            <div class="result-item ${isCorrect ? 'correct' : 'incorrect'}">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; gap:10px;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <strong>Q${i + 1}. ${q.text}</strong>
                        ${isFlagged ? '<span title="Flagged by student" style="font-size:1.2rem;">🚩</span>' : ''}
                    </div>
                    <span class="status-badge ${isCorrect ? 'correct' : 'incorrect'}" style="flex-shrink:0;">
                        ${isCorrect ? `+${parseFloat(q.points) || 0.5} pts` : '0 pts'}
                    </span>
                </div>
                <div>${optionsHtml}</div>
            </div>
            `;
        }).join('');
    }
};

document.addEventListener('DOMContentLoaded', resultsController.init);
