/**
 * Exam Controller Module
 */

const takeExam = {
    exam: null,
    user: null,
    currentQuestionIndex: 0,
    answers: {}, // { questionId: selectedOptionId }
    flagged: {}, // { questionId: boolean }
    timer: null,

    // Seeded random shuffle for consistent scrambling per student
    scrambleArray: (array, seed) => {
        // Simple hash function to convert string seed to number
        const hashSeed = (str) => {
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            return Math.abs(hash);
        };

        // Seeded random number generator (Mulberry32)
        const seededRandom = (seed) => {
            return () => {
                let t = seed += 0x6D2B79F5;
                t = Math.imul(t ^ t >>> 15, t | 1);
                t ^= t + Math.imul(t ^ t >>> 7, t | 61);
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            };
        };

        const random = seededRandom(hashSeed(String(seed)));
        const shuffled = [...array];

        // Fisher-Yates shuffle with seeded random
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        return shuffled;
    },

    init: async () => {
        // Auth Check
        const user = dataService.getCurrentUser();
        if (!user || user.role !== 'student') {
            window.location.href = '../index.html';
            return;
        }
        takeExam.user = user;
        document.getElementById('student-name').textContent = user.name;

        // Get Exam ID
        const params = new URLSearchParams(window.location.search);
        const examId = params.get('id');
        takeExam.mode = params.get('mode') || 'normal'; // 'normal' or 'resolve'
        takeExam.resultId = params.get('resultId');

        if (!examId) {
            alert('No exam specified');
            window.location.href = 'student-dashboard.html';
            return;
        }

        try {
            const exam = await dataService.getExamById(examId);
            if (!exam) throw new Error('Exam not found');
            takeExam.exam = exam;

            // Check if exam is accessible (not archived, scheduled time passed)
            if (exam.status === 'archived') {
                alert('This exam has been archived and is no longer available.');
                window.location.href = 'student-dashboard.html';
                return;
            }

            if (exam.scheduledDate && new Date(exam.scheduledDate) > new Date()) {
                const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                const scheduledStr = new Date(exam.scheduledDate).toLocaleDateString('en-US', options);
                alert(`This exam is not yet available. It will be accessible on ${scheduledStr}.`);
                window.location.href = 'student-dashboard.html';
                return;
            }

            if (takeExam.mode === 'resolve') {
                if (!takeExam.resultId) throw new Error('No Result ID for Resolution Mode');
                // Fetch existing result
                // We use getResults but filter for client side (Optimization: need getResultById)
                const results = await dataService.getResults({ studentId: user.id });
                const result = results.find(r => r.id === takeExam.resultId);
                if (!result) throw new Error('Result not found');

                // Identify Resolved Flags
                const flags = result.flags || {};
                const now = new Date();
                const resolvedFlags = Object.entries(flags)
                    .filter(([k, v]) => v && typeof v === 'object' && v.status === 'resolved' && new Date(v.deadline) > now); // Only active deadlines

                if (resolvedFlags.length === 0) {
                    alert('No active resolved flags to review.');
                    window.location.href = 'student-dashboard.html';
                    return;
                }

                takeExam.resolvedFlags = resolvedFlags; // [[qId, val], ...]
                takeExam.resolvedDeadline = new Date(Math.min(...resolvedFlags.map(f => new Date(f[1].deadline))));

                // Load existing answers
                takeExam.answers = result.answers || {};
                takeExam.flagged = result.flags || {};

                // Limit Questions to only flagged ones
                const qIdsToCheck = new Set(resolvedFlags.map(f => f[0]));
                // We will hide others but keep indexes consistent or just filter? 
                // Better to filter `takeExam.exam.questions` for rendering, 
                // invalidating original indexes. But `selectAnswer` relies on ID mostly.
                // palette relies on index.
                // Let's filter the view but map currentQuestionIndex to the subset.
                takeExam.subsetQuestions = takeExam.exam.questions.filter(q => qIdsToCheck.has(q.id));

                document.getElementById('exam-title').textContent = `Review: ${exam.title}`;
            } else {
                takeExam.loadProgress(); // Restore auto-saves

                // Apply question scrambling if enabled
                if (exam.scrambleQuestions) {
                    console.log('🔀 Scrambling questions for student:', user.id);
                    takeExam.exam.questions = takeExam.scrambleArray(
                        [...takeExam.exam.questions],
                        user.id
                    );
                }
            }

            takeExam.renderHeader();
            takeExam.setupPalette();
            takeExam.renderAllQuestions();
            takeExam.startTimer();

            if (takeExam.mode !== 'resolve') {
                dataService.startExamSession(examId, user.id);
            }

            // Listeners
            document.getElementById('submit-btn').onclick = takeExam.showSubmitModal;

        } catch (err) {
            console.error(err);
            alert('Error loading exam: ' + err.message);
            window.location.href = 'student-dashboard.html';
        }
    },

    renderHeader: () => {
        if (takeExam.mode === 'resolve') {
            document.getElementById('exam-title').textContent = `Resolution Review: ${takeExam.exam.title}`;
        } else {
            document.getElementById('exam-title').textContent = takeExam.exam.title;
        }
        document.getElementById('exam-subject').textContent = takeExam.exam.subject;
    },

    setupPalette: () => {
        const grid = document.getElementById('question-palette');
        const questions = takeExam.mode === 'resolve' ? takeExam.subsetQuestions : takeExam.exam.questions;

        grid.innerHTML = questions.map((q, i) => {
            // Find original index if needed, but here i is loop index
            // If resolve mode, i is 0, 1... of subset.
            return `
            <button class="palette-btn" id="palette-btn-${i}" onclick="takeExam.scrollToQuestion(${i})">
                ${i + 1}
            </button>
        `}).join('');
    },

    startTimer: () => {
        if (takeExam.mode === 'resolve') {
            // Timer till deadline
            const now = Date.now();
            const remainMs = takeExam.resolvedDeadline - now;
            const durationMin = remainMs / (1000 * 60);

            if (durationMin <= 0) {
                alert('Review time expired.');
                window.location.href = 'student-dashboard.html';
                return;
            }

            takeExam.timer = new Timer(durationMin, (timeStr, remaining) => {
                const el = document.getElementById('timer');
                el.textContent = '⏱ ' + timeStr;
                el.style.color = 'red';
            }, () => {
                alert('Time is up for review! Submitting updates.');
                takeExam.submit();
            });
            takeExam.timer.start();
            return;
        }

        let duration = takeExam.exam.duration;
        let extraMinutes = 0;

        // Check for global extension
        if (takeExam.exam.globalExtension) {
            const ext = takeExam.exam.globalExtension;
            if (ext.addedMinutes) {
                extraMinutes = Math.max(extraMinutes, ext.addedMinutes);
            } else if (ext.multiplier) {
                extraMinutes = Math.max(extraMinutes, Math.round(duration * (ext.multiplier - 1)));
            }
        }

        // Check for individual extension
        if (takeExam.exam.extensions && takeExam.exam.extensions[takeExam.user.id]) {
            const ext = takeExam.exam.extensions[takeExam.user.id];
            if (ext.addedMinutes) {
                extraMinutes = Math.max(extraMinutes, ext.addedMinutes);
            } else if (ext.multiplier) {
                extraMinutes = Math.max(extraMinutes, Math.round(duration * (ext.multiplier - 1)));
            }
        }

        duration += extraMinutes;

        takeExam.timer = new Timer(duration, (timeStr, remaining) => {
            const el = document.getElementById('timer');
            el.textContent = timeStr;
            if (remaining < 300) {
                el.classList.add('timer-warning');
            }
        }, () => {
            alert('Time is up! Submitting your exam automatically.');
            takeExam.submit();
        });
        takeExam.timer.start();
    },

    renderAllQuestions: () => {
        const container = document.getElementById('question-area');
        const questions = takeExam.mode === 'resolve' ? takeExam.subsetQuestions : takeExam.exam.questions;

        container.innerHTML = questions.map((q, index) => {
            const isFlagged = takeExam.flagged[q.id];

            // Build options HTML based on Type
            let optionsHtml = '';

            if (!q.type || q.type === 'mcq' || q.type === 'image_mcq') {
                let imgHtml = '';
                if (q.type === 'image_mcq' && q.image) {
                    imgHtml = `<div style="margin-bottom:15px;"><img src="${q.image}" style="max-width:100%; max-height:250px; border-radius:4px;"></div>`;
                }

                optionsHtml = imgHtml + q.options.map((opt) => {
                    const isSelected = takeExam.answers[q.id] === opt.id;
                    return `
                    <label class="option-label ${isSelected ? 'selected' : ''}">
                        <input type="radio" name="option-${q.id}" class="option-input" value="${opt.id}" ${isSelected ? 'checked' : ''} onchange="takeExam.selectAnswer('${q.id}', '${opt.id}')">
                        <span>${opt.text}</span>
                    </label>
                    `;
                }).join('');

            } else if (q.type === 'true_false') {
                optionsHtml = q.options.map((opt) => {
                    const isSelected = takeExam.answers[q.id] === opt.id;
                    return `
                    <label class="option-label ${isSelected ? 'selected' : ''}">
                        <input type="radio" name="option-${q.id}" class="option-input" value="${opt.id}" ${isSelected ? 'checked' : ''} onchange="takeExam.selectAnswer('${q.id}', '${opt.id}')">
                        <span>${opt.text}</span>
                    </label>
                    `;
                }).join('');

            } else if (q.type === 'fill_blank') {
                const val = takeExam.answers[q.id] || '';
                optionsHtml = `
                    <div class="form-group">
                        <input type="text" class="form-control" placeholder="Type your answer here..." value="${val}" oninput="takeExam.selectAnswer('${q.id}', this.value)">
                    </div>
                `;

            } else if (q.type === 'match') {
                const userPairs = takeExam.answers[q.id] || {};

                optionsHtml = q.pairs.map((pair, idx) => {
                    const currentVal = userPairs[idx] || '';
                    const dropdownOpts = q.pairs.map(p => `
                        <option value="${p.right}" ${currentVal === p.right ? 'selected' : ''}>${p.right}</option>
                    `).join('');

                    return `
                    <div style="display:flex; align-items:center; margin-bottom:10px; gap:10px;">
                        <span style="flex:1; font-weight:500;">${pair.left}</span>
                        <span>=</span>
                        <select class="form-control" style="flex:1" onchange="takeExam.selectAnswer('${q.id}', { index: ${idx}, value: this.value })">
                            <option value="">Select...</option>
                            ${dropdownOpts}
                        </select>
                    </div>
                    `;
                }).join('');
            }

            return `
            <div class="question-card" id="q-card-${index}" style="margin-bottom: 30px; ${takeExam.mode === 'resolve' ? 'border: 2px solid var(--accent-color);' : ''}">
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                    <span style="color: var(--primary-color); font-weight: bold;">Question ${index + 1} / ${questions.length}</span>
                    ${takeExam.mode === 'resolve' ? '<span style="color:red; font-weight:bold;">ACTION REQUIRED</span>' :
                    `<label style="cursor: pointer; display: flex; align-items: center; font-size: 0.9rem;">
                        <input type="checkbox" onchange="takeExam.toggleFlag('${q.id}', ${index}, this.checked)" ${isFlagged ? 'checked' : ''} style="margin-right: 5px;"> Flag for review
                    </label>`}
                </div>

                <div class="q-text-display">
                    ${q.text}
                </div>

                <div class="options-list">
                    ${optionsHtml}
                </div>
            </div>
            `;
        }).join('');

        document.getElementById('prev-btn').style.display = 'none';
        document.getElementById('next-btn').style.display = 'none';
        document.getElementById('submit-btn').style.display = 'inline-block';
        if (takeExam.mode === 'resolve') {
            document.getElementById('submit-btn').textContent = 'Update Answers';
        }
    },

    toggleFlag: (qId, index, isChecked) => {
        takeExam.flagged[qId] = isChecked;
        takeExam.updatePaletteBtn(index);
        takeExam.saveProgress();
    },

    scrollToQuestion: (index) => {
        const el = document.getElementById(`q-card-${index}`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(`palette-btn-${index}`).classList.add('active');
        }
    },

    selectAnswer: (qId, val) => {
        // Need to find question in correct set
        const qList = takeExam.mode === 'resolve' ? takeExam.subsetQuestions : takeExam.exam.questions;
        const q = qList.find(q => q.id === qId);

        if (q.type === 'match') {
            const current = takeExam.answers[qId] || {};
            current[val.index] = val.value;
            takeExam.answers[qId] = current;
        } else {
            takeExam.answers[qId] = val;
        }

        const qIndex = qList.findIndex(q => q.id === qId);
        if (qIndex === -1) return;

        if (!q.type || q.type === 'mcq' || q.type === 'image_mcq' || q.type === 'true_false') {
            const card = document.getElementById(`q-card-${qIndex}`);
            if (card) {
                const labels = card.querySelectorAll('.option-label');
                labels.forEach(l => l.classList.remove('selected'));
                const selectedInput = card.querySelector(`input[value="${val}"]`);
                if (selectedInput) selectedInput.parentElement.classList.add('selected');
            }
        }

        takeExam.updatePaletteBtn(qIndex);
        if (takeExam.mode !== 'resolve') takeExam.saveProgress();
    },

    updatePaletteBtn: (index) => {
        const qList = takeExam.mode === 'resolve' ? takeExam.subsetQuestions : takeExam.exam.questions;
        const q = qList[index];
        const btn = document.getElementById(`palette-btn-${index}`);
        const answered = !!takeExam.answers[q.id];
        const flagged = !!takeExam.flagged[q.id];

        if (answered) btn.classList.add('answered');
        else btn.classList.remove('answered');

        if (flagged) btn.classList.add('flagged');
        else btn.classList.remove('flagged');
    },

    saveProgress: () => {
        const data = {
            answers: takeExam.answers,
            flagged: takeExam.flagged,
        };
        localStorage.setItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`, JSON.stringify(data));
    },

    loadProgress: () => {
        const saved = localStorage.getItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`);
        if (saved) {
            const data = JSON.parse(saved);
            takeExam.answers = data.answers || {};
            takeExam.flagged = data.flagged || {};
            takeExam.exam.questions.forEach((q, i) => takeExam.updatePaletteBtn(i));
        }
    },

    showSubmitModal: () => {
        if (takeExam.mode === 'resolve') {
            if (!confirm('Update your answers for the flagged questions?')) return;
            takeExam.submit();
            return;
        }

        const total = takeExam.exam.questions.length;
        const answered = Object.keys(takeExam.answers).length;
        const flagged = Object.keys(takeExam.flagged).filter(k => takeExam.flagged[k]).length;

        document.getElementById('summary-answered').textContent = answered;
        document.getElementById('summary-unanswered').textContent = total - answered;
        document.getElementById('summary-flagged').textContent = flagged;

        document.getElementById('submit-modal').style.display = 'flex';
    },

    confirmSubmit: () => {
        document.getElementById('submit-modal').style.display = 'none';
        takeExam.submit();
    },

    submit: async () => {
        takeExam.timer.stop();

        // Grading Logic
        let score = 0;
        let totalPoints = 0;

        if (takeExam.mode === 'resolve') {
            // In resolve mode, only grade the flagged questions
            // and update the existing score
            const results = await dataService.getResults({ studentId: takeExam.user.id });
            const existingResult = results.find(r => r.id === takeExam.resultId);

            if (!existingResult) {
                alert('Error: Could not find existing result');
                return;
            }

            // Get existing data
            const existingPercentage = parseInt(existingResult.score) || 0;
            totalPoints = parseInt(existingResult.totalPoints) || 100;

            // Convert existing percentage to points
            const existingPoints = Math.round((existingPercentage / 100) * totalPoints);

            // Calculate points for flagged questions only
            const flaggedQuestions = takeExam.subsetQuestions;
            let flaggedOldScore = 0;
            let flaggedNewScore = 0;

            flaggedQuestions.forEach(q => {
                const points = parseFloat(q.points) || 0.5;
                const newAnswer = takeExam.answers[q.id];
                const oldAnswer = existingResult.answers[q.id];

                // Calculate old score for this question
                if (q.type === 'fill_blank') {
                    if (oldAnswer && q.correctAnswer &&
                        oldAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                        flaggedOldScore += points;
                    }
                    if (newAnswer && q.correctAnswer &&
                        newAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                        flaggedNewScore += points;
                    }
                } else if (q.type === 'match') {
                    if (oldAnswer) {
                        let allCorrect = true;
                        q.pairs.forEach((pair, idx) => {
                            if (oldAnswer[idx] !== pair.right) allCorrect = false;
                        });
                        if (allCorrect) flaggedOldScore += points;
                    }
                    if (newAnswer) {
                        let allCorrect = true;
                        q.pairs.forEach((pair, idx) => {
                            if (newAnswer[idx] !== pair.right) allCorrect = false;
                        });
                        if (allCorrect) flaggedNewScore += points;
                    }
                } else {
                    const correctOpt = q.options.find(o => o.isCorrect);
                    if (correctOpt) {
                        if (correctOpt.id === oldAnswer) flaggedOldScore += points;
                        if (correctOpt.id === newAnswer) flaggedNewScore += points;
                    }
                }
            });

            // Update total score: remove old flagged scores, add new flagged scores
            score = existingPoints - flaggedOldScore + flaggedNewScore;

            console.log('🔢 Score Calculation:', {
                existingPercentage,
                existingPoints,
                flaggedOldScore,
                flaggedNewScore,
                newTotalPoints: score,
                totalPoints
            });

        } else {
            // Normal mode: grade all questions
            takeExam.exam.questions.forEach(q => {
                const points = parseFloat(q.points) || 0.5;
                totalPoints += points;
                const answer = takeExam.answers[q.id];

                if (q.type === 'fill_blank') {
                    if (answer && q.correctAnswer &&
                        answer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                        score += points;
                    }
                } else if (q.type === 'match') {
                    if (answer) {
                        let allCorrect = true;
                        q.pairs.forEach((pair, idx) => {
                            if (answer[idx] !== pair.right) allCorrect = false;
                        });
                        if (allCorrect) score += points;
                    }
                } else {
                    if (answer) {
                        const correctOpt = q.options.find(o => o.isCorrect);
                        if (correctOpt && correctOpt.id === answer) {
                            score += points;
                        }
                    }
                }
            });
        }

        const percentage = Math.round((score / totalPoints) * 100);

        // Handle Result Flags
        let finalFlags = JSON.parse(JSON.stringify(takeExam.flagged)); // Deep clone
        if (takeExam.mode === 'resolve') {
            // Update status to 'accepted' instead of deleting, so we keep history
            const resolvedIds = takeExam.resolvedFlags.map(f => f[0]);
            console.log('🏁 Marking flags as accepted:', resolvedIds);
            resolvedIds.forEach(id => {
                if (finalFlags[id] && typeof finalFlags[id] === 'object') {
                    finalFlags[id].status = 'accepted';
                    console.log(`  ✅ Flag ${id} updated to 'accepted':`, finalFlags[id]);
                }
            });
            console.log('📋 Final flags object:', finalFlags);
        }

        const resultData = {
            examId: takeExam.exam.id,
            studentId: takeExam.user.id,
            studentName: takeExam.user.name,
            answers: takeExam.answers,
            score: percentage,
            totalPoints: totalPoints,
            passScore: takeExam.exam.passScore,
            passed: percentage >= takeExam.exam.passScore,
            flags: finalFlags
        };

        try {
            if (takeExam.mode === 'resolve') {
                console.log('📡 Updating result flags:', finalFlags);
                console.log('📊 Updated score:', score, '/', totalPoints, '(', percentage, '%)');

                // Calculate if passed based on updated score
                const passScore = takeExam.exam.passScore || 50;
                const passed = percentage >= passScore;

                // UPDATE existing result using dataService
                await dataService.updateResult(takeExam.resultId, {
                    answers: takeExam.answers,
                    score: percentage,
                    totalPoints: totalPoints,
                    passScore: passScore,
                    passed: passed,
                    flags: finalFlags
                });

                console.log('✅ Result updated successfully');
                console.log('📋 Updated flags:', finalFlags);

                alert(`Answers Updated!\nScore: ${score}/${totalPoints} Points (${percentage}%)\nStatus: ${passed ? 'PASSED' : 'FAILED'}`);
            } else {
                await dataService.saveResult(resultData);
                localStorage.removeItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`);
                alert(`Exam Submitted!\nScore: ${score}/${totalPoints} Points (${percentage}%)`);
            }
            window.location.href = 'student-dashboard.html';
        } catch (err) {
            alert('Submission failed: ' + err.message);
        }
    }
};

document.addEventListener('DOMContentLoaded', takeExam.init);
