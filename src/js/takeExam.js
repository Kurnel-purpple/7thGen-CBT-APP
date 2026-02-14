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
        console.log('🚀 Exam Controller v3.1 Loaded');
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
            takeExam.showAlert('Error', 'No exam specified', () => window.location.href = 'student-dashboard.html');
            return;
        }

        try {
            let exam = null;
            let isUsingCache = false;
            const useIndexedDB = window.idb && window.idb.isIndexedDBAvailable();

            try {
                exam = await dataService.getExamById(examId);

                // Cache successful fetch to IndexedDB
                if (exam && useIndexedDB) {
                    try {
                        await window.idb.saveExam(exam);
                    } catch (e) {
                        console.warn('Could not cache exam to IndexedDB:', e);
                    }
                }
            } catch (fetchErr) {
                console.warn('⚠️ Failed to fetch exam from server:', fetchErr.message);

                // Try IndexedDB cache first (more storage capacity)
                if (useIndexedDB) {
                    try {
                        exam = await window.idb.getExam(examId);
                        if (exam) {
                            isUsingCache = true;
                            console.log('📦 Using exam from IndexedDB cache');
                        }
                    } catch (idbErr) {
                        console.warn('Could not load from IndexedDB:', idbErr);
                    }
                }

                // Fallback to localStorage
                if (!exam) {
                    const cache = JSON.parse(localStorage.getItem('cbt_exam_cache') || '{}');
                    if (cache[examId]) {
                        exam = cache[examId];
                        isUsingCache = true;
                        console.log('📦 Using exam from localStorage cache');
                    }
                }
            }

            if (!exam) throw new Error('Exam not found. Please check your network connection.');
            takeExam.exam = exam;

            // Show notice if using cached data
            if (isUsingCache) {
                takeExam.showNotice('⚠️ Offline mode: Using cached exam data. Your answers will be saved locally and synced when online.', 'warning');
            }

            // Check if exam is accessible (not archived, scheduled time passed)
            if (exam.status === 'archived') {
                takeExam.showAlert('Archived', 'This exam has been archived and is no longer available.', () => window.location.href = 'student-dashboard.html');
                return;
            }

            if (exam.scheduledDate && new Date(exam.scheduledDate) > new Date()) {
                const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                const scheduledStr = new Date(exam.scheduledDate).toLocaleDateString('en-US', options);
                takeExam.showAlert('Not Yet Available', `This exam is not yet available. It will be accessible on ${scheduledStr}.`, () => window.location.href = 'student-dashboard.html');
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
                    takeExam.showAlert('No Issues', 'No active resolved flags to review.', () => window.location.href = 'student-dashboard.html');
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
                await takeExam.loadProgress(); // Restore auto-saves

                // Apply question scrambling if enabled
                // Only scramble objective questions, keep theory questions at the end
                if (exam.scrambleQuestions) {
                    console.log('🔀 Scrambling questions for student:', user.id);
                    const objectiveQuestions = exam.questions.filter(q => q.type !== 'theory');
                    const theoryQuestions = exam.questions.filter(q => q.type === 'theory');

                    const scrambledObjective = takeExam.scrambleArray(
                        [...objectiveQuestions],
                        user.id
                    );

                    // Combine scrambled objective questions with theory questions at the end
                    takeExam.exam.questions = [...scrambledObjective, ...theoryQuestions];
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

            // Setup network monitoring for exam session
            takeExam.setupNetworkMonitoring();

            // Setup periodic auto-save (every 30 seconds)
            takeExam.autoSaveInterval = setInterval(() => {
                takeExam.saveProgress();
                console.log('💾 Auto-saved progress');
            }, 30000);

        } catch (err) {
            console.error(err);
            takeExam.showAlert('Error', 'Error loading exam: ' + err.message, () => window.location.href = 'student-dashboard.html');
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

        // Separate objective and theory questions
        const objectiveQuestions = questions.filter(q => q.type !== 'theory');
        const theoryQuestions = questions.filter(q => q.type === 'theory');
        const sortedQuestions = [...objectiveQuestions, ...theoryQuestions];

        let html = '';

        // Add objective questions section
        if (objectiveQuestions.length > 0) {
            html += sortedQuestions.slice(0, objectiveQuestions.length).map((q, i) => {
                return `
                <button class="palette-btn" id="palette-btn-${i}" onclick="takeExam.scrollToQuestion(${i})">
                    ${i + 1}
                </button>
            `;
            }).join('');
        }

        // Add theory questions section with visual separator
        if (theoryQuestions.length > 0) {
            if (objectiveQuestions.length > 0) {
                html += `<div style="grid-column: 1 / -1; height: 1px; background: var(--border-color); margin: 10px 0;"></div>`;
                html += `<div style="grid-column: 1 / -1; font-size: 0.75rem; color: var(--light-text); margin-bottom: 5px; font-weight: 600;">THEORY</div>`;
            }
            html += sortedQuestions.slice(objectiveQuestions.length).map((q, i) => {
                const actualIndex = objectiveQuestions.length + i;
                return `
                <button class="palette-btn palette-btn-theory" id="palette-btn-${actualIndex}" onclick="takeExam.scrollToQuestion(${actualIndex})" style="background: var(--accent-color); opacity: 0.3;">
                    ${actualIndex + 1}
                </button>
            `;
            }).join('');
        }

        grid.innerHTML = html;
    },

    startTimer: () => {
        if (takeExam.mode === 'resolve') {
            // Timer till deadline
            const now = Date.now();
            const remainMs = takeExam.resolvedDeadline - now;
            const durationMin = remainMs / (1000 * 60);

            if (durationMin <= 0) {
                takeExam.showAlert('Time Expired', 'Review time expired.', () => window.location.href = 'student-dashboard.html');
                return;
            }

            takeExam.timer = new Timer(durationMin, (timeStr, remaining) => {
                const el = document.getElementById('timer');
                el.textContent = '⏱ ' + timeStr;
                el.style.color = 'red';
            }, () => {
                takeExam.showNotice('Time is up for review! Submitting updates.', 'warning');
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
            takeExam.showNotice('Time is up! Submitting your exam automatically.', 'warning');
            takeExam.submit();
        });
        takeExam.timer.start();
    },

    renderAllQuestions: () => {
        const container = document.getElementById('question-area');
        const questions = takeExam.mode === 'resolve' ? takeExam.subsetQuestions : takeExam.exam.questions;

        // Separate objective and theory questions
        const objectiveQuestions = questions.filter(q => q.type !== 'theory');
        const theoryQuestions = questions.filter(q => q.type === 'theory');
        const sortedQuestions = [...objectiveQuestions, ...theoryQuestions];

        let htmlContent = '';

        // Add section header for objective questions if there are theory questions
        if (objectiveQuestions.length > 0 && theoryQuestions.length > 0) {
            htmlContent += `
                <div style="margin: 0 0 20px 0; padding: 15px; background: var(--inner-bg); border-left: 4px solid var(--primary-color); border-radius: 4px;">
                    <h3 style="margin: 0; font-size: 1.2rem; color: var(--primary-color);">Section A: Objective Questions</h3>
                    <p style="margin: 5px 0 0 0; font-size: 0.9rem; color: var(--light-text);">Choose the correct answer for each question</p>
                </div>
            `;
        }

        htmlContent += sortedQuestions.map((q, index) => {
            // Add theory section header before first theory question
            let sectionHeader = '';
            if (index === objectiveQuestions.length && theoryQuestions.length > 0) {
                // Get theory instructions from exam data
                const theoryInstructions = takeExam.exam.theoryInstructions || 'Provide detailed written answers';

                sectionHeader = `
                    <div style="margin: 40px 0 20px 0; padding: 15px; background: var(--inner-bg); border-left: 4px solid var(--accent-color); border-radius: 4px;">
                        <h3 style="margin: 0; font-size: 1.2rem; color: var(--accent-color);">Section B: Theory Questions</h3>
                        <p style="margin: 5px 0 0 0; font-size: 0.9rem; color: var(--light-text);">${theoryInstructions}</p>
                    </div>
                `;
            }

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
            } else if (q.type === 'theory') {
                const val = takeExam.answers[q.id] || '';
                optionsHtml = `
                    <div class="form-group">
                        <textarea class="form-control" rows="8" placeholder="Write your answer here..." oninput="takeExam.selectAnswer('${q.id}', this.value)" style="resize: vertical; min-height: 150px;">${val}</textarea>
                        <p style="margin-top: 8px; font-size: 0.85rem; color: var(--light-text); font-style: italic;">
                            💡 Tip: Provide a detailed and well-structured answer
                        </p>
                    </div>
                `;
            } else if (q.type === 'image_multi') {
                // Picture Comprehension: One image with multiple sub-questions (A-E options each)
                let imgHtml = '';
                if (q.image) {
                    imgHtml = `<div style="margin-bottom: 20px; text-align: center;">
                        <img src="${q.image}" style="max-width: 100%; max-height: 400px; border-radius: 8px; border: 1px solid var(--border-color); box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    </div>`;
                }

                // Get current answers for this question (stored as object: { subQId: 'A', ... })
                const userAnswers = takeExam.answers[q.id] || {};

                const subQuestionsHtml = q.subQuestions.map((subQ) => {
                    const currentAnswer = userAnswers[subQ.id] || '';
                    return `
                    <div style="margin-bottom: 15px; padding: 12px; background: var(--inner-bg); border-radius: 8px;">
                        <div style="font-weight: 600; margin-bottom: 10px; color: var(--primary-color);">Question ${subQ.number}</div>
                        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                            ${['A', 'B', 'C', 'D', 'E'].map(opt => `
                                <label class="option-label ${currentAnswer === opt ? 'selected' : ''}" style="min-width: 50px; justify-content: center;">
                                    <input type="radio" name="subq-${q.id}-${subQ.id}" value="${opt}" ${currentAnswer === opt ? 'checked' : ''} 
                                        onchange="takeExam.selectAnswer('${q.id}', { subQId: '${subQ.id}', value: '${opt}' })" 
                                        class="option-input" style="margin-right: 6px;">
                                    <span style="font-weight: 600;">${opt}</span>
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    `;
                }).join('');

                optionsHtml = imgHtml + subQuestionsHtml;
            }

            return `
            ${sectionHeader}
            <div class="question-card" id="q-card-${index}" style="margin-bottom: 30px; ${takeExam.mode === 'resolve' ? 'border: 2px solid var(--accent-color);' : ''}">
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                    <span style="color: var(--primary-color); font-weight: bold;">Question ${index + 1} / ${sortedQuestions.length}</span>
                    ${takeExam.mode === 'resolve' ? '<span style="color:red; font-weight:bold;">ACTION REQUIRED</span>' :
                    `<label style="cursor: pointer; display: flex; align-items: center; font-size: 0.9rem;">
                        <input type="checkbox" onchange="takeExam.toggleFlag('${q.id}', ${index}, this.checked)" ${isFlagged ? 'checked' : ''} style="margin-right: 5px;"> Flag for review
                    </label>`}
                </div>

                ${q.mediaAttachments && q.mediaAttachments.length > 0 ? `
                    <div style="margin-bottom: 20px; padding: 15px; background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.05)); border-radius: 10px; border: 1px solid var(--border-color);">
                        <div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">
                            ${q.mediaAttachments.map((media, mediaIdx) => `
                                <div style="position: relative; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); cursor: pointer; transition: transform 0.2s ease;" 
                                    onclick="takeExam.showMediaLightbox('${q.id}', ${mediaIdx})"
                                    onmouseover="this.style.transform='scale(1.02)'" 
                                    onmouseout="this.style.transform='scale(1)'">
                                    <img src="${media.dataUrl}" alt="${media.name || 'Question Image'}" 
                                        style="max-width: 100%; max-height: 200px; display: block; object-fit: contain;">
                                    <div style="position: absolute; bottom: 0; left: 0; right: 0; background: linear-gradient(transparent, rgba(0,0,0,0.7)); padding: 8px; text-align: center;">
                                        <span style="color: white; font-size: 0.75rem;">🔍 Click to enlarge</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <div class="q-text-display">
                    ${q.text}
                </div>

                <div class="options-list">
                    ${optionsHtml}
                </div>
            </div>
            `;
        }).join('');

        container.innerHTML = htmlContent;

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

    showMediaLightbox: (questionId, mediaIndex) => {
        const questions = takeExam.mode === 'resolve' ? takeExam.subsetQuestions : takeExam.exam.questions;
        const question = questions.find(q => q.id === questionId);

        if (!question || !question.mediaAttachments || !question.mediaAttachments[mediaIndex]) {
            return;
        }

        const media = question.mediaAttachments[mediaIndex];

        // Create lightbox overlay
        const overlay = document.createElement('div');
        overlay.id = 'exam-media-lightbox';
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
        } else if (q.type === 'image_multi') {
            // Picture Comprehension: Store answers as object with subQId as keys
            const current = takeExam.answers[qId] || {};
            current[val.subQId] = val.value;
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
        } else if (q.type === 'image_multi') {
            // Update visual selection for Picture Comprehension questions
            const card = document.getElementById(`q-card-${qIndex}`);
            if (card) {
                // Find the specific sub-question container and update its labels
                const subQContainers = card.querySelectorAll('[style*="margin-bottom: 15px"]');
                subQContainers.forEach(container => {
                    const radio = container.querySelector(`input[type="radio"][value="${val.value}"]`);
                    if (radio && radio.name.includes(val.subQId)) {
                        const labels = container.querySelectorAll('.option-label');
                        labels.forEach(l => l.classList.remove('selected'));
                        radio.parentElement.classList.add('selected');
                    }
                });
            }
        }

        takeExam.updatePaletteBtn(qIndex);
        if (takeExam.mode !== 'resolve') takeExam.saveProgress();
    },

    updatePaletteBtn: (index) => {
        const qList = takeExam.mode === 'resolve' ? takeExam.subsetQuestions : takeExam.exam.questions;
        const q = qList[index];
        const btn = document.getElementById(`palette-btn-${index}`);

        // Check if question is answered based on type
        let answered = false;
        if (q.type === 'image_multi') {
            // For image_multi, check if at least one sub-question is answered
            const answers = takeExam.answers[q.id] || {};
            answered = Object.keys(answers).length > 0;
        } else {
            answered = !!takeExam.answers[q.id];
        }

        const flagged = !!takeExam.flagged[q.id];

        if (answered) btn.classList.add('answered');
        else btn.classList.remove('answered');

        if (flagged) btn.classList.add('flagged');
        else btn.classList.remove('flagged');
    },

    saveProgress: async () => {
        const data = {
            answers: takeExam.answers,
            flagged: takeExam.flagged,
            currentQuestion: takeExam.currentQuestion,
            savedAt: Date.now()
        };

        // Always save to localStorage as immediate backup
        localStorage.setItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`, JSON.stringify(data));

        // Also save to IndexedDB if available (larger storage)
        if (window.idb && window.idb.isIndexedDBAvailable()) {
            try {
                await window.idb.saveProgress(takeExam.exam.id, takeExam.user.id, data);
            } catch (err) {
                console.warn('Could not save progress to IndexedDB:', err);
            }
        }
    },

    loadProgress: async () => {
        let saved = null;

        // Try IndexedDB first (more reliable)
        if (window.idb && window.idb.isIndexedDBAvailable()) {
            try {
                saved = await window.idb.loadProgress(takeExam.exam.id, takeExam.user.id);
            } catch (err) {
                console.warn('Could not load progress from IndexedDB:', err);
            }
        }

        // Fallback to localStorage
        if (!saved) {
            const localSaved = localStorage.getItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`);
            if (localSaved) {
                saved = JSON.parse(localSaved);
            }
        }

        if (saved) {
            takeExam.answers = saved.answers || {};
            takeExam.flagged = saved.flagged || {};
            takeExam.exam.questions.forEach((q, i) => takeExam.updatePaletteBtn(i));
            console.log('📂 Restored exam progress');
        }
    },

    // Monitor network connectivity during exam
    setupNetworkMonitoring: () => {
        let wasOffline = !navigator.onLine;

        // Create persistent network status indicator
        const createStatusIndicator = () => {
            let indicator = document.getElementById('exam-network-status');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'exam-network-status';
                indicator.style.cssText = `
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 0.8rem;
                    font-weight: bold;
                    z-index: 9999;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                `;
                document.body.appendChild(indicator);
            }
            return indicator;
        };

        const updateNetworkStatus = (isOnline) => {
            const indicator = createStatusIndicator();

            if (isOnline) {
                indicator.textContent = '🟢 Online';
                indicator.style.backgroundColor = '#d4edda';
                indicator.style.color = '#155724';
                indicator.style.border = '1px solid #c3e6cb';

                // Hide after 3 seconds when online
                setTimeout(() => {
                    indicator.style.opacity = '0';
                }, 3000);

                // If was offline, show recovery message
                if (wasOffline) {
                    takeExam.showNotice('✅ Back online! Your answers are safe.', 'success');
                }
            } else {
                indicator.textContent = '🔴 Offline - Answers saving locally';
                indicator.style.backgroundColor = '#fff3cd';
                indicator.style.color = '#856404';
                indicator.style.border = '1px solid #ffc107';
                indicator.style.opacity = '1';

                takeExam.showNotice('📴 You are offline. Don\'t worry - your answers are being saved locally and will sync when you\'re back online.', 'warning');

                // Force save progress
                takeExam.saveProgress();
            }

            wasOffline = !isOnline;
        };

        window.addEventListener('online', () => {
            console.log('📶 Exam: Back online');
            updateNetworkStatus(true);
        });

        window.addEventListener('offline', () => {
            console.log('📴 Exam: Gone offline');
            updateNetworkStatus(false);
        });

        // Initial check
        if (!navigator.onLine) {
            updateNetworkStatus(false);
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
        // Prevent duplicate submissions
        if (takeExam._isSubmitting) {
            console.log('Already submitting, ignoring duplicate call');
            return;
        }
        takeExam._isSubmitting = true;

        // Disable submit button and show loading state
        const submitBtn = document.getElementById('submit-btn');
        const originalBtnText = submitBtn ? submitBtn.textContent : 'Submit Exam';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ Submitting...';
            submitBtn.style.opacity = '0.7';
        }

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
                takeExam.showNotice('Error: Could not find existing result', 'error');
                return;
            }

            // Get existing data
            const existingPercentage = parseFloat(existingResult.score) || 0;
            totalPoints = parseFloat(existingResult.totalPoints) || 100;

            // Convert existing percentage to points
            const existingPoints = (existingPercentage / 100) * totalPoints;

            // Calculate points for flagged questions only
            const flaggedQuestions = takeExam.subsetQuestions;
            let flaggedOldScore = 0;
            let flaggedNewScore = 0;

            flaggedQuestions.forEach(q => {
                // Skip theory questions - they require manual grading
                if (q.type === 'theory') {
                    return;
                }

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
            score = Number(existingPoints) - Number(flaggedOldScore) + Number(flaggedNewScore);

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

                // Skip theory questions - they require manual grading
                if (q.type === 'theory') {
                    // Don't add to totalPoints or score for auto-grading
                    // Teacher will grade these manually
                    return;
                }

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
                } else if (q.type === 'image_multi') {
                    // Picture Comprehension: Score based on correct sub-answers
                    if (answer && q.subQuestions) {
                        let correctCount = 0;
                        q.subQuestions.forEach(subQ => {
                            if (answer[subQ.id] === subQ.correctAnswer) {
                                correctCount++;
                            }
                        });
                        // Score proportionally: (correct / total) * points
                        const pointsPerSubQ = points / q.subQuestions.length;
                        score += correctCount * pointsPerSubQ;
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

        // Store decimals in flags metadata (DB total_points column is Integer)
        finalFlags._real_total_points = totalPoints;
        finalFlags._real_points_scored = score;

        const resultData = {
            examId: takeExam.exam.id,
            studentId: takeExam.user.id,
            studentName: takeExam.user.name,
            answers: takeExam.answers,
            score: percentage,
            totalPoints: Math.round(totalPoints),
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
                // Only sending fields that student is likely allowed to update
                await dataService.updateResult(takeExam.resultId, {
                    answers: takeExam.answers,
                    score: percentage,
                    // totalPoints, passScore, passed might be restricted by RLS
                    flags: finalFlags
                });

                console.log('✅ Result updated successfully, Verifying persistence...');

                // Double check persistence by refetching
                const verifyResults = await dataService.getResults({ studentId: takeExam.user.id });
                const verifiedResult = verifyResults.find(r => r.id === takeExam.resultId);

                let allAccepted = true;
                if (verifiedResult && verifiedResult.flags) {
                    const resolvedIds = takeExam.resolvedFlags.map(f => f[0]);
                    resolvedIds.forEach(id => {
                        const flag = verifiedResult.flags[id];
                        if (!flag || flag.status !== 'accepted') {
                            console.error(`❌ PERSISTENCE CHECK FAILED: Flag ${id} is still '${flag ? flag.status : 'missing'}' in DB!`);
                            allAccepted = false;
                        } else {
                            console.log(`  ✅ Verified flag ${id} is accepted in DB.`);
                        }
                    });
                } else {
                    console.error('❌ Could not refetch result for verification.');
                    allAccepted = false;
                }

                if (!allAccepted) {
                    takeExam.showNotice('Warning: Flag status update verification failed. Please screenshot this and tell your teacher.', 'error');
                } else {
                    takeExam.showResultModal('Answers Updated!', 'Your review answers have been successfully updated.', score, totalPoints, percentage, passed);
                }
            } else {
                await dataService.saveResult(resultData);
                localStorage.removeItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`);
                const passed = percentage >= takeExam.exam.passScore;
                takeExam.showResultModal('Exam Submitted!', 'You have successfully completed the exam.', score, totalPoints, percentage, passed);
            }
            // window.location.href = 'student-dashboard.html'; // REMOVED - Handled by modal button
        } catch (err) {
            console.error('Submission error:', err);

            // Check if it was saved offline
            if (err.message === 'Saved Offline') {
                // Successfully queued for later sync
                localStorage.removeItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`);
                takeExam.showResultModal('Exam Saved Offline!', 'Your answers have been saved locally and will sync automatically when you\'re back online.', score, totalPoints, percentage, undefined, true);
                return;
            }

            // Check if network error - save locally as backup
            if (!navigator.onLine || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                // Queue for later sync
                const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
                const submission = {
                    _local_id: Date.now(),
                    exam_id: resultData.examId,
                    student_id: resultData.studentId,
                    score: resultData.score,
                    total_points: resultData.totalPoints,
                    pass_score: resultData.passScore,
                    answers: resultData.answers,
                    flags: resultData.flags,
                    submitted_at: new Date().toISOString()
                };
                pending.push(submission);
                localStorage.setItem('cbt_pending_submissions', JSON.stringify(pending));
                localStorage.removeItem(`cbt_progress_${takeExam.exam.id}_${takeExam.user.id}`);

                takeExam.showResultModal('Saved Offline', 'Network issue detected. Your answers have been saved locally.', score, totalPoints, percentage, undefined, true);
                return;
            }

            // Re-enable button on error so user can retry
            takeExam._isSubmitting = false;
            const submitBtn = document.getElementById('submit-btn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Submit Exam';
                submitBtn.style.opacity = '1';
            }

            // Show user-friendly error with retry option
            takeExam.showNotice(`⚠️ Submission issue: ${err.message}. Your answers are saved - tap Submit to retry.`, 'error');
        }
    },

    showAlert: (title, message, onOk) => {
        const modal = document.getElementById('alert-modal');
        if (!modal) { window.alert(message); if (onOk) onOk(); return; }

        document.getElementById('alert-title').textContent = title || 'Notice';
        document.getElementById('alert-message').textContent = message;

        const btn = document.getElementById('alert-btn');
        // Clear previous listeners by replacing the node (or just reassign onclick since we don't rely on addEventListener)
        btn.onclick = () => {
            modal.style.display = 'none';
            if (onOk) onOk();
        };

        modal.style.display = 'flex';
    },

    showResultModal: (title, message, score, totalPoints, percentage, passed, isOffline = false) => {
        const modal = document.getElementById('result-modal');
        if (!modal) {
            alert(`${title}\n${message}\nScore: ${score}/${totalPoints} (${percentage}%)`);
            window.location.href = 'student-dashboard.html';
            return;
        }

        document.getElementById('result-title').textContent = title;
        document.getElementById('result-message').innerHTML = message;

        document.getElementById('result-score').textContent = `${percentage}%`;
        document.getElementById('result-points').textContent = `${Math.round(score * 10) / 10} / ${totalPoints} Points`;

        const statusEl = document.getElementById('result-status');
        const iconEl = document.getElementById('result-icon');
        const container = document.getElementById('result-score-container');

        // Reset styles and classes
        container.style.border = 'none';

        if (passed !== undefined && !isOffline) {
            statusEl.textContent = passed ? 'PASSED' : 'FAILED';
            statusEl.style.color = passed ? 'var(--success-color)' : 'var(--accent-color)';
            statusEl.style.backgroundColor = passed ? 'rgba(39, 174, 96, 0.1)' : 'rgba(231, 76, 60, 0.1)';
            statusEl.style.display = 'inline-block';
            iconEl.textContent = passed ? '🎉' : '📝';
        } else if (isOffline) {
            statusEl.textContent = 'SAVED OFFLINE';
            statusEl.style.color = '#e67e22'; // Orange
            statusEl.style.backgroundColor = 'rgba(230, 126, 34, 0.1)';
            statusEl.style.display = 'inline-block';
            iconEl.textContent = '📱';
            container.style.border = '2px dashed #f39c12';
        } else {
            statusEl.style.display = 'none';
            iconEl.textContent = '✅';
        }

        modal.style.display = 'flex';
    },

    // Helper to show notices (offline mode, errors, etc.)
    showNotice: (message, type = 'info') => {
        // Remove any existing notice
        const existing = document.getElementById('exam-notice');
        if (existing) existing.remove();

        const colors = {
            info: { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
            warning: { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
            error: { bg: '#ffebee', color: '#c62828', border: '#ef9a9a' },
            success: { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' }
        };

        const style = colors[type] || colors.info;

        const notice = document.createElement('div');
        notice.id = 'exam-notice';
        notice.style.cssText = `
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            background: ${style.bg};
            color: ${style.color};
            border: 1px solid ${style.border};
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
            z-index: 10000;
            font-size: 0.9rem;
            max-width: 90%;
            text-align: center;
            display: flex;
            align-items: center;
            gap: 10px;
        `;

        notice.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()" style="
                background: none;
                border: none;
                font-size: 1.2rem;
                cursor: pointer;
                color: ${style.color};
                padding: 0 4px;
            ">×</button>
        `;

        document.body.appendChild(notice);

        // Auto-hide success and info after 6 seconds
        if (type === 'success' || type === 'info') {
            setTimeout(() => {
                if (notice.parentElement) {
                    notice.style.opacity = '0';
                    notice.style.transform = 'translateX(-50%) translateY(-20px)';
                    notice.style.transition = 'all 0.3s ease';
                    setTimeout(() => notice.remove(), 300);
                }
            }, 6000);
        }
    }
};

document.addEventListener('DOMContentLoaded', takeExam.init);

