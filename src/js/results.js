/**
 * Result Detail Controller
 */

const resultsController = {
    currentResult: null,
    currentExam: null,
    theoryScores: {}, // { questionId: points }

    init: async () => {
        const params = new URLSearchParams(window.location.search);
        const resultId = params.get('id');

        if (!resultId) {
            await Utils.showAlert('Error', 'No result ID specified');
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
                await Utils.showAlert('Unauthorized', 'Unauthorized Access');
                window.location.href = '../index.html';
                return;
            }

            // Get Exam for questions text
            const exam = await dataService.getExamById(result.examId);

            // Store for later use
            resultsController.currentResult = result;
            resultsController.currentExam = exam;

            // Load existing theory scores if any
            if (result.theoryScores) {
                resultsController.theoryScores = { ...result.theoryScores };
            }

            resultsController.render(result, exam, user);

        } catch (err) {
            console.error(err);
            await Utils.showAlert('Error', 'Error loading result');
            window.history.back();
        }
    },

    showMediaLightbox: (questionId, mediaIndex) => {
        const exam = resultsController.currentExam;
        if (!exam) return;

        const question = exam.questions.find(q => q.id === questionId);
        if (!question || !question.mediaAttachments || !question.mediaAttachments[mediaIndex]) {
            return;
        }

        const media = question.mediaAttachments[mediaIndex];

        // Create lightbox overlay
        const overlay = document.createElement('div');
        overlay.id = 'results-media-lightbox';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.95);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            cursor: pointer;
            padding: 20px;
        `;
        overlay.onclick = () => overlay.remove();

        overlay.innerHTML = `
            <div style="position: relative; max-width: 95%; max-height: 95%; display: flex; flex-direction: column; align-items: center;" onclick="event.stopPropagation();">
                <img src="${media.dataUrl}" alt="${media.name || 'Question Image'}" 
                    style="max-width: 100%; max-height: 85vh; border-radius: 8px; box-shadow: 0 10px 50px rgba(0,0,0,0.5); object-fit: contain;">
                <button onclick="this.parentElement.parentElement.remove()" 
                    style="position: absolute; top: -15px; right: -15px; background: white; color: black; border: none; border-radius: 50%; width: 40px; height: 40px; cursor: pointer; font-size: 22px; font-weight: bold; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">×</button>
                <p style="text-align: center; color: white; margin-top: 15px; font-size: 0.9rem; opacity: 0.8;">
                    ${media.name || 'Question Image'} • Click anywhere outside to close
                </p>
            </div>
        `;

        document.body.appendChild(overlay);

        // Also allow ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                overlay.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    },

    saveTheoryScores: async () => {
        const user = dataService.getCurrentUser();
        if (user.role !== 'teacher') {
            await Utils.showAlert('Access Denied', 'Only teachers can grade theory questions');
            return;
        }

        try {
            // Calculate new total score
            const result = resultsController.currentResult;
            const exam = resultsController.currentExam;

            // Recalculate total points and score
            let objectivePoints = 0;
            let objectiveTotalPoints = 0;
            let theoryPoints = 0;
            let theoryTotalPoints = 0;

            exam.questions.forEach(q => {
                const qPoints = parseFloat(q.points) || 0;

                if (q.type === 'theory') {
                    // Theory questions - use manual scores
                    const manualScore = parseFloat(resultsController.theoryScores[q.id]) || 0;
                    theoryPoints += manualScore;
                    theoryTotalPoints += qPoints;
                } else {
                    // Objective questions - use existing auto-grading
                    objectiveTotalPoints += qPoints;
                    const answer = result.answers[q.id];

                    if (q.type === 'fill_blank') {
                        if (answer && q.correctAnswer && answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                            objectivePoints += qPoints;
                        }
                    } else if (q.type === 'match') {
                        if (answer) {
                            let allCorrect = true;
                            q.pairs.forEach((pair, idx) => {
                                if (answer[idx] !== pair.right) allCorrect = false;
                            });
                            if (allCorrect) objectivePoints += qPoints;
                        }
                    } else if (q.options) {
                        const correctOpt = q.options.find(o => o.isCorrect);
                        if (answer && correctOpt && correctOpt.id === answer) {
                            objectivePoints += qPoints;
                        }
                    }
                }
            });

            const totalPoints = objectivePoints + theoryPoints;
            const totalPossible = objectiveTotalPoints + theoryTotalPoints;
            const percentage = totalPossible > 0 ? Math.round((totalPoints / totalPossible) * 100) : 0;
            const passScore = exam.passScore || 50;
            const passed = percentage >= passScore;

            // Update result with theory scores
            await dataService.updateResult(result.id, {
                theoryScores: resultsController.theoryScores,
                score: percentage,
                totalPoints: Math.round(totalPossible),
                passed: passed
            });

            await Utils.showAlert('Success', `Theory scores saved!\nNew Total: ${totalPoints.toFixed(1)}/${totalPossible.toFixed(1)} (${percentage}%)\nStatus: ${passed ? 'PASSED' : 'FAILED'}`);

            // Reload to show updated scores
            location.reload();

        } catch (err) {
            console.error(err);
            await Utils.showAlert('Error', 'Failed to save theory scores: ' + err.message);
        }
    },

    render: (result, exam, user) => {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('result-content').style.display = 'block';

        const title = exam ? exam.title : 'Unknown Exam';
        document.getElementById('exam-title').textContent = title;
        document.getElementById('student-name').textContent = result.studentName || 'Student'; // Fallback if name not joined

        // Calculate scores including theory questions
        let objectivePoints = 0;
        let objectiveTotalPoints = 0;
        let theoryPoints = 0;
        let theoryTotalPoints = 0;

        if (exam) {
            exam.questions.forEach(q => {
                const qPoints = parseFloat(q.points) || 0;

                if (q.type === 'theory') {
                    // Theory questions - use manual scores if available
                    const manualScore = parseFloat(resultsController.theoryScores[q.id]) || 0;
                    theoryPoints += manualScore;
                    theoryTotalPoints += qPoints;
                } else {
                    // Objective questions - auto-grading
                    objectiveTotalPoints += qPoints;
                    const answer = result.answers[q.id];

                    if (q.type === 'fill_blank') {
                        if (answer && q.correctAnswer && answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                            objectivePoints += qPoints;
                        }
                    } else if (q.type === 'match') {
                        if (answer) {
                            let allCorrect = true;
                            q.pairs.forEach((pair, idx) => {
                                if (answer[idx] !== pair.right) allCorrect = false;
                            });
                            if (allCorrect) objectivePoints += qPoints;
                        }
                    } else if (q.type === 'image_multi') {
                        // Picture Comprehension: Score based on correct sub-answers
                        if (answer && q.subQuestions) {
                            let correctCount = 0;
                            q.subQuestions.forEach(subQ => {
                                if (answer[subQ.id] === subQ.correctAnswer) {
                                    correctCount++;
                                }
                            });
                            // Score proportionally
                            const pointsPerSubQ = qPoints / q.subQuestions.length;
                            objectivePoints += correctCount * pointsPerSubQ;
                        }
                    } else if (q.options) {
                        const correctOpt = q.options.find(o => o.isCorrect);
                        if (answer && correctOpt && correctOpt.id === answer) {
                            objectivePoints += qPoints;
                        }
                    }
                }
            });
        }

        const actualPoints = objectivePoints + theoryPoints;
        const totalPossible = objectiveTotalPoints + theoryTotalPoints;

        // Use saved score (percentage) - this is the source of truth
        const percentage = result.score;

        // Determine Pass/Fail - ALWAYS recalculate to ensure accuracy
        // (Database 'passed' column might be stale if not updated during resolve mode)
        const passScore = exam ? (exam.passScore || 50) : 50;
        const isPassed = percentage >= passScore;

        // Score UI
        const circle = document.getElementById('score-circle');
        circle.textContent = `${actualPoints.toFixed(1)}/${totalPossible.toFixed(1)}`;
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

        document.getElementById('points-summary').textContent = `${actualPoints.toFixed(1)} / ${totalPossible.toFixed(1)} Points`;

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
            if (q.type === 'theory') {
                // Theory questions - show student's written answer
                isCorrect = null; // Not auto-graded
                const studentAnswer = selectedOptId || '(No Answer Provided)';
                const currentScore = resultsController.theoryScores[q.id] || 0;
                const maxPoints = parseFloat(q.points) || 0;

                // Check if this theory question has already been graded
                const hasBeenGraded = currentScore > 0 || (result.theoryScores && result.theoryScores[q.id] !== undefined);

                // Show grading input only for teachers
                const gradingHtml = user && user.role === 'teacher' ? `
                    <div style="margin-top:15px; padding:12px; background:var(--card-bg); border:1px solid ${hasBeenGraded ? 'var(--success-color)' : 'var(--accent-color)'}; border-radius:6px;">
                        <div style="display:flex; align-items:center; gap:15px; flex-wrap:wrap;">
                            <label style="font-weight:600; color:${hasBeenGraded ? 'var(--success-color)' : 'var(--accent-color)'};">
                                ${hasBeenGraded ? '✏️ Edit grade:' : '📊 Grade this answer:'}
                            </label>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <input 
                                    type="number" 
                                    id="theory-score-${q.id}"
                                    value="${currentScore}"
                                    min="0"
                                    max="${maxPoints}"
                                    step="0.5"
                                    style="width:80px; padding:6px; border:1px solid var(--border-color); border-radius:4px; background:var(--inner-bg); color:var(--text-color);"
                                    onchange="resultsController.theoryScores['${q.id}'] = parseFloat(this.value) || 0"
                                />
                                <span style="color:var(--light-text);">/ ${maxPoints} points</span>
                            </div>
                        </div>
                        <div style="margin-top:8px; font-size:0.85rem; color:var(--light-text);">
                            ${hasBeenGraded ? '✓ This question has been graded. You can edit the score above.' : '💡 Enter the points earned for this answer. Click "Save Theory Grades" at the bottom when done.'}
                        </div>
                    </div>
                ` : `
                    <div style="margin-top:10px; padding:10px; background:var(--inner-bg); border-radius:4px; border-left:3px solid var(--accent-color);">
                        <strong style="color:var(--accent-color);">Score:</strong> 
                        <span style="font-size:1.1rem; font-weight:600;">${currentScore} / ${maxPoints} points</span>
                        ${currentScore === 0 ? '<div style="margin-top:5px; font-size:0.85rem; color:var(--light-text); font-style:italic;">⏳ Awaiting teacher grading</div>' : ''}
                    </div>
                `;

                optionsHtml = `
                    <div style="margin-bottom:10px; padding:10px; background:var(--inner-bg); border-radius:4px;">
                        <strong style="color:var(--accent-color);">Student's Answer:</strong>
                        <div style="margin-top:8px; white-space:pre-wrap; line-height:1.6;">${studentAnswer}</div>
                    </div>
                    ${gradingHtml}
                `;
            } else if (q.type === 'fill_blank') {
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
            } else if (q.type === 'image_multi') {
                // Picture Comprehension: Check each sub-question answer
                const userAnswers = selectedOptId || {};
                let allCorrect = true;
                let correctCount = 0;

                // Build sub-questions display
                let subQHtml = '';
                if (q.image) {
                    subQHtml += `<div style="margin-bottom: 15px; text-align: center;"><img src="${q.image}" style="max-width: 100%; max-height: 300px; border-radius: 8px;"></div>`;
                }

                subQHtml += '<div style="display: grid; gap: 10px;">';
                q.subQuestions.forEach(subQ => {
                    const userAnswer = userAnswers[subQ.id] || '(No Answer)';
                    const isSubCorrect = userAnswer === subQ.correctAnswer;
                    if (isSubCorrect) correctCount++;
                    else allCorrect = false;

                    const statusColor = isSubCorrect ? 'var(--success-color)' : 'var(--accent-color)';
                    const statusIcon = isSubCorrect ? '✓' : '✗';

                    subQHtml += `
                        <div style="padding: 10px; background: var(--inner-bg); border-radius: 6px; border-left: 4px solid ${statusColor};">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="font-weight: 600;">Question ${subQ.number}</span>
                                <span style="color: ${statusColor}; font-weight: bold;">${statusIcon}</span>
                            </div>
                            <div style="margin-top: 5px; display: flex; gap: 15px; font-size: 0.9rem;">
                                <span><strong>Student:</strong> ${userAnswer}</span>
                                <span style="color: var(--success-color);"><strong>Correct:</strong> ${subQ.correctAnswer}</span>
                            </div>
                        </div>
                    `;
                });
                subQHtml += '</div>';

                // For scoring: Each sub-question is worth (q.points / numSubQuestions)
                const pointsPerSubQ = (parseFloat(q.points) || 0.5) / q.subQuestions.length;
                const earnedPoints = correctCount * pointsPerSubQ;

                isCorrect = allCorrect;
                optionsHtml = `
                    <div style="margin-bottom: 10px; padding: 8px; background: var(--card-bg); border-radius: 4px;">
                        <strong>Score:</strong> ${correctCount}/${q.subQuestions.length} correct (${earnedPoints.toFixed(2)} points)
                    </div>
                    ${subQHtml}
                `;
            } else {
                // MCQ / Image / TF - check if options exist
                if (q.options) {
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
            }

            const isFlagged = result.flags && result.flags[q.id];

            // Build media HTML if question has attachments
            let mediaHtml = '';
            if (q.mediaAttachments && q.mediaAttachments.length > 0) {
                mediaHtml = `
                    <div style="margin-bottom: 15px; padding: 12px; background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.05)); border-radius: 8px; border: 1px solid var(--border-color);">
                        <div style="display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-start;">
                            ${q.mediaAttachments.map((media, mediaIdx) => `
                                <div style="position: relative; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: pointer;" 
                                    onclick="resultsController.showMediaLightbox('${q.id}', ${mediaIdx})">
                                    <img src="${media.dataUrl}" alt="${media.name || 'Question Image'}" 
                                        style="max-width: 150px; max-height: 100px; display: block; object-fit: contain;">
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            return `
            <div class="result-item ${isCorrect === null ? 'theory' : (isCorrect ? 'correct' : 'incorrect')}">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; gap:10px;">
                    <div style="display:flex; align-items:center; gap:10px; flex:1;">
                        <strong>Q${i + 1}. ${q.text}</strong>
                        ${isFlagged ? '<span title="Flagged by student" style="font-size:1.2rem;">🚩</span>' : ''}
                        ${q.type === 'theory' ? '<span style="font-size:0.75rem; color:var(--accent-color); margin-left:8px;">(THEORY)</span>' : ''}
                        ${q.type === 'image_multi' ? '<span style="font-size:0.75rem; color:var(--primary-color); margin-left:8px;">(PICTURE COMPREHENSION)</span>' : ''}
                    </div>
                    <span class="status-badge ${isCorrect === null ? 'theory' : (isCorrect ? 'correct' : 'incorrect')}" style="flex-shrink:0;">
                        ${isCorrect === null ? 'Manual Grading' : (isCorrect ? `+${parseFloat(q.points) || 0.5} pts` : '0 pts')}
                    </span>
                </div>
                ${mediaHtml}
                <div>${optionsHtml}</div>
            </div>
            `;
        }).join('');

        // Show save button if user is teacher and there are theory questions
        const hasTheoryQuestions = exam.questions.some(q => q.type === 'theory');
        const saveButtonContainer = document.getElementById('theory-grading-actions');
        if (saveButtonContainer && user && user.role === 'teacher' && hasTheoryQuestions) {
            saveButtonContainer.style.display = 'block';
        }
    }
};

document.addEventListener('DOMContentLoaded', resultsController.init);
