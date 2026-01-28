/**
 * Exam Manager Module
 * Handles creation and editing of exams
 */

const examManager = {
    questions: [],

    currentExamId: null,

    init: async () => {
        const params = new URLSearchParams(window.location.search);
        const examId = params.get('id');
        if (examId) {
            document.querySelector('h1').textContent = 'Edit Exam';
            document.title = 'Edit Exam - CBT Exam';
            await examManager.loadExam(examId);
        }
    },

    loadExam: async (id) => {
        try {
            const exam = await dataService.getExamById(id);
            if (!exam) {
                alert('Exam not found');
                window.location.href = 'teacher-dashboard.html';
                return;
            }

            examManager.currentExamId = exam.id;
            examManager.questions = (exam.questions && Array.isArray(exam.questions)) ? exam.questions : [];

            // Populate Form
            document.getElementById('exam-title').value = exam.title;
            document.getElementById('exam-subject').value = exam.subject;
            document.getElementById('exam-target-class').value = exam.targetClass || 'All';
            document.getElementById('exam-duration').value = exam.duration;
            document.getElementById('exam-pass-score').value = exam.passScore;
            document.getElementById('exam-instructions').value = exam.instructions;

            // New fields: Scheduling and Scrambling
            const scheduledDateInput = document.getElementById('exam-scheduled-date');
            if (scheduledDateInput && exam.scheduledDate) {
                // Convert ISO date to datetime-local format
                const date = new Date(exam.scheduledDate);
                scheduledDateInput.value = date.toISOString().slice(0, 16);
            }

            const scrambleCheckbox = document.getElementById('exam-scramble');
            if (scrambleCheckbox) {
                scrambleCheckbox.checked = exam.scrambleQuestions || false;
            }

            // Theory section instructions
            const theoryInstructionsInput = document.getElementById('exam-theory-instructions');
            if (theoryInstructionsInput && exam.theoryInstructions) {
                theoryInstructionsInput.value = exam.theoryInstructions;
            }

            examManager.renderQuestions();
        } catch (err) {
            console.error(err);
            alert('Error loading exam');
        }
    },

    addQuestion: () => {
        const id = Utils.generateId();
        examManager.questions.push({
            id: id,
            type: 'mcq',
            text: '',
            options: [
                { id: Utils.generateId(), text: '', isCorrect: false },
                { id: Utils.generateId(), text: '', isCorrect: false }
            ],
            points: 0.5
        });
        examManager.renderQuestions();

        // UX: Scroll to new question
        setTimeout(() => {
            const el = document.querySelector(`div[data-id="${id}"]`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    },

    removeQuestion: (id) => {
        // Ensure String comparison
        const targetId = String(id);
        if (confirm('Are you sure you want to remove this question?')) {
            examManager.questions = examManager.questions.filter(q => String(q.id) !== targetId);
            examManager.renderQuestions();
        }
    },

    changeQuestionType: (id, newType) => {
        const q = examManager.questions.find(q => q.id === id);
        if (q) {
            q.type = newType;
            // Reset options based on type
            if (newType === 'true_false') {
                q.options = [
                    { id: 'opt_true', text: 'True', isCorrect: true },
                    { id: 'opt_false', text: 'False', isCorrect: false }
                ];
            } else if (newType === 'fill_blank') {
                q.correctAnswer = '';
                delete q.options;
            } else if (newType === 'match') {
                q.pairs = [{ left: '', right: '' }, { left: '', right: '' }];
                delete q.options;
            } else if (newType === 'theory') {
                // Theory questions don't have options or correct answers
                // They require manual grading
                // Set points to 0 so they don't affect automatic scoring
                delete q.options;
                delete q.correctAnswer;
                delete q.pairs;
                q.points = 0;
            } else {
                // mcq or image_mcq
                q.options = [
                    { id: Utils.generateId(), text: '', isCorrect: false },
                    { id: Utils.generateId(), text: '', isCorrect: false }
                ];
                if (newType !== 'image_mcq') delete q.image;
            }
            examManager.renderQuestions();
        }
    },

    openImportModal: () => {
        document.getElementById('import-modal').style.display = 'block';
    },

    closeImportModal: () => {
        document.getElementById('import-modal').style.display = 'none';
        document.getElementById('import-text').value = '';
        // Reset import points to default
        const importPointsInput = document.getElementById('import-points');
        if (importPointsInput) importPointsInput.value = '0.5';
    },

    processBulkImport: () => {
        const text = document.getElementById('import-text').value;
        if (!text.trim()) {
            alert('Please paste some text.');
            return;
        }

        // Get points value from import modal (default to 0.5)
        const importPointsInput = document.getElementById('import-points');
        const importPoints = importPointsInput ? parseFloat(importPointsInput.value) || 0.5 : 0.5;

        // Clean text and split into blocks
        // We handle both "Double Newline" blocks AND "Single Line" blocks if they look like questions
        const blocks = text.split(/\n\s*\n/);
        let addedCount = 0;

        blocks.forEach(block => {
            block = block.trim();
            if (!block) return;

            const lines = block.split('\n');
            let qText = '';
            let options = [];

            // STRATEGY 1: Inline Options (Single Line or Wrap)
            // Pattern: Look for (A)... (B)... on the same line or strictly formatted
            // We use a regex to split: spaces + (Letter) + spaces
            const inlineMarkerRegex = /(\([a-dA-D]\))\s/g;

            // Check if the block (joined) has multiple option markers
            const joined = lines.join(' ');
            const markersFound = joined.match(inlineMarkerRegex);

            if (markersFound && markersFound.length >= 2) {
                // Parse as Inline
                // Split by capturing regex to keep delimiters
                const parts = joined.split(/(\([a-dA-D]\)\s)/);
                /* 
                   Example: "Q... (A) Opt1 (B) Opt2"
                   Split: ["Q... ", "(A) ", "Opt1 ", "(B) ", "Opt2"]
                   Parts[0] = Question Text
                   Parts[1,3,5...] = Marker
                   Parts[2,4,6...] = Content
                */
                qText = parts[0].trim();

                for (let i = 1; i < parts.length; i += 2) {
                    const marker = parts[i].trim(); // "(A)"
                    let content = parts[i + 1];
                    if (content) {
                        content = content.trim();
                        options.push({
                            id: Utils.generateId(),
                            text: content,
                            isCorrect: false
                        });
                    }
                }

            } else {
                // STRATEGY 2: Multiline Parsing (Legacy/Previous Logic)
                // Lines starting with (A) are options. Top lines are Q text.
                const strictOptRegex = /^\s*\(?([a-zA-Z])[\)\.]\s+(.+)$/;
                let qLines = [];

                lines.forEach(line => {
                    const match = line.match(strictOptRegex);
                    if (match) {
                        options.push({
                            id: Utils.generateId(),
                            text: match[2].trim(),
                            isCorrect: false
                        });
                    } else {
                        if (options.length === 0) {
                            // Remove leading numbering like "1. "
                            const clean = line.replace(/^\d+[\.\)]\s+/, '');
                            qLines.push(clean.trim());
                        }
                    }
                });
                qText = qLines.join(' ');
            }

            // Create question based on whether options were found
            if (qText) {
                if (options.length > 0) {
                    // Objective question (MCQ) - has options
                    examManager.questions.push({
                        id: Utils.generateId(),
                        type: 'mcq',
                        text: qText,
                        options: options,
                        points: importPoints
                    });
                    addedCount++;
                } else {
                    // Theory question - no options detected
                    // Set to 0 points since they require manual grading
                    examManager.questions.push({
                        id: Utils.generateId(),
                        type: 'theory',
                        text: qText,
                        points: 0
                    });
                    addedCount++;
                }
            }
        });

        if (addedCount > 0) {
            examManager.renderQuestions();
            examManager.closeImportModal();
            alert(`Successfully imported ${addedCount} questions.`);
        } else {
            alert('Could not detect any valid questions. Please check the format.\n\nSupported formats:\n1. Objective Questions (with options):\n   Question text\n   (a) Option 1\n   (b) Option 2\n\n2. Theory Questions (without options):\n   Question text only\n\n3. Inline format:\n   Question... (A) Opt1 (B) Opt2');
        }
    },

    renderQuestions: () => {
        const container = document.getElementById('questions-container');
        const template = document.getElementById('question-template').innerHTML;
        const noQuestionsMsg = document.getElementById('no-questions-msg');

        if (examManager.questions.length === 0) {
            if (noQuestionsMsg) noQuestionsMsg.style.display = 'block';
            container.innerHTML = '';
            return;
        }

        if (noQuestionsMsg) noQuestionsMsg.style.display = 'none';

        // Separate objective and theory questions
        const objectiveQuestions = examManager.questions.filter(q => q.type !== 'theory');
        const theoryQuestions = examManager.questions.filter(q => q.type === 'theory');

        // Combine them with objective questions first, then theory questions
        const sortedQuestions = [...objectiveQuestions, ...theoryQuestions];

        // Re-render all (inefficient but simple for MVP)
        // In a real app we would use a VDOM framework like React/Vue
        container.innerHTML = '';

        // Add section header for objective questions if there are theory questions
        if (objectiveQuestions.length > 0 && theoryQuestions.length > 0) {
            const objectiveHeader = document.createElement('div');
            objectiveHeader.style.cssText = 'margin: 20px 0 15px 0; padding: 10px; background: var(--inner-bg); border-left: 4px solid var(--primary-color); border-radius: 4px;';
            objectiveHeader.innerHTML = '<h3 style="margin: 0; font-size: 1.1rem; color: var(--primary-color);">Section A: Objective Questions</h3>';
            container.appendChild(objectiveHeader);
        }

        sortedQuestions.forEach((q, index) => {
            // Add theory section header before first theory question
            if (index === objectiveQuestions.length && theoryQuestions.length > 0) {
                const theoryHeader = document.createElement('div');
                theoryHeader.style.cssText = 'margin: 30px 0 15px 0; padding: 10px; background: var(--inner-bg); border-left: 4px solid var(--accent-color); border-radius: 4px;';
                theoryHeader.innerHTML = '<h3 style="margin: 0; font-size: 1.1rem; color: var(--accent-color);">Section B: Theory Questions</h3>';
                container.appendChild(theoryHeader);
            }

            let html = template
                .replace(/{id}/g, q.id)
                .replace(/{n}/g, index + 1);

            const div = document.createElement('div');
            div.innerHTML = html;

            // Set values
            const qEl = div.firstElementChild;
            qEl.querySelector('.q-text').value = q.text;
            qEl.querySelector('.q-text').oninput = (e) => q.text = e.target.value;

            const typeSelect = qEl.querySelector('.q-type');
            typeSelect.value = q.type;

            qEl.querySelector('.q-points').value = q.points;
            qEl.querySelector('.q-points').onchange = (e) => {
                const val = parseFloat(e.target.value);
                q.points = isNaN(val) ? 0 : val;
            };

            // Render Options based on Type
            const optsContainer = qEl.querySelector('.q-options-container');
            optsContainer.innerHTML = ''; // Clear previous

            if (q.type === 'mcq' || q.type === 'image_mcq') {
                // Image Upload for Image MCQ
                if (q.type === 'image_mcq') {
                    const imgDiv = document.createElement('div');
                    imgDiv.style.marginBottom = '10px';
                    imgDiv.innerHTML = `
                        <label>Upload Image</label>
                        <input type="file" accept="image/*" class="form-control">
                        ${q.image ? `<img src="${q.image}" style="max-width: 100%; max-height: 200px; margin-top: 10px; border-radius: 4px;">` : ''}
                    `;
                    const fileInput = imgDiv.querySelector('input');
                    fileInput.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = (evt) => {
                                q.image = evt.target.result;
                                examManager.renderQuestions();
                            };
                            reader.readAsDataURL(file);
                        }
                    };
                    optsContainer.appendChild(imgDiv);
                }

                q.options.forEach((opt, optIndex) => {
                    const optDiv = document.createElement('div');
                    optDiv.className = 'answer-option';
                    optDiv.innerHTML = `
                        <input type="radio" name="correct_${q.id}" ${opt.isCorrect ? 'checked' : ''}>
                        <input type="text" class="form-control" value="${opt.text}" placeholder="Option ${optIndex + 1}">
                        ${q.options.length > 2 ? '<button type="button" class="btn" style="color:red">x</button>' : ''}
                    `;

                    const radio = optDiv.querySelector('input[type="radio"]');
                    radio.onchange = () => {
                        q.options.forEach(o => o.isCorrect = false);
                        opt.isCorrect = true;
                    };

                    const textParams = optDiv.querySelector('input[type="text"]');
                    textParams.oninput = (e) => opt.text = e.target.value;

                    if (q.options.length > 2) {
                        optDiv.querySelector('button').onclick = () => {
                            q.options = q.options.filter(o => o.id !== opt.id);
                            examManager.renderQuestions();
                        };
                    }
                    optsContainer.appendChild(optDiv);
                });

                const addOptBtn = document.createElement('button');
                addOptBtn.type = 'button';
                addOptBtn.className = 'btn';
                addOptBtn.style.fontSize = '0.8rem';
                addOptBtn.style.marginTop = '5px';
                addOptBtn.textContent = '+ Add Option';
                addOptBtn.onclick = () => {
                    q.options.push({ id: Utils.generateId(), text: '', isCorrect: false });
                    examManager.renderQuestions();
                };
                optsContainer.appendChild(addOptBtn);

            } else if (q.type === 'true_false') {
                q.options.forEach(opt => {
                    const optDiv = document.createElement('div');
                    optDiv.className = 'answer-option';
                    optDiv.innerHTML = `
                        <input type="radio" name="correct_${q.id}" ${opt.isCorrect ? 'checked' : ''}>
                        <span>${opt.text}</span>
                    `;
                    optDiv.querySelector('input').onchange = () => {
                        q.options.forEach(o => o.isCorrect = false);
                        opt.isCorrect = true;
                    };
                    optsContainer.appendChild(optDiv);
                });

            } else if (q.type === 'fill_blank') {
                const fbDiv = document.createElement('div');
                fbDiv.innerHTML = `
                    <div class="form-group">
                        <label>Correct Answer (Word or Phrase)</label>
                        <input type="text" class="form-control correct-ans" value="${q.correctAnswer || ''}" placeholder="e.g. Paris">
                    </div>
                `;
                fbDiv.querySelector('.correct-ans').oninput = (e) => q.correctAnswer = e.target.value;
                optsContainer.appendChild(fbDiv);

            } else if (q.type === 'match') {
                const headDiv = document.createElement('div');
                headDiv.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:5px; font-weight:bold;"><span style="flex:1">Left Item</span><span style="width:20px"></span><span style="flex:1">Matching Right Item</span></div>`;
                optsContainer.appendChild(headDiv);

                q.pairs = q.pairs || [];
                q.pairs.forEach((pair, pIdx) => {
                    const pairDiv = document.createElement('div');
                    pairDiv.style.display = 'flex';
                    pairDiv.style.gap = '10px';
                    pairDiv.style.marginBottom = '5px';
                    pairDiv.innerHTML = `
                        <input type="text" class="form-control left-item" value="${pair.left}" placeholder="Item A">
                        <span style="align-self:center;">=</span>
                        <input type="text" class="form-control right-item" value="${pair.right}" placeholder="Match A">
                        <button type="button" class="btn" style="color:red">x</button>
                    `;

                    pairDiv.querySelector('.left-item').oninput = (e) => pair.left = e.target.value;
                    pairDiv.querySelector('.right-item').oninput = (e) => pair.right = e.target.value;
                    pairDiv.querySelector('button').onclick = () => {
                        q.pairs = q.pairs.filter((_, idx) => idx !== pIdx);
                        examManager.renderQuestions();
                    };
                    optsContainer.appendChild(pairDiv);
                });

                const addPairBtn = document.createElement('button');
                addPairBtn.type = 'button';
                addPairBtn.className = 'btn';
                addPairBtn.textContent = '+ Add Pair';
                addPairBtn.onclick = () => {
                    q.pairs.push({ left: '', right: '' });
                    examManager.renderQuestions();
                };
                optsContainer.appendChild(addPairBtn);
            } else if (q.type === 'theory') {
                // Theory questions don't need options
                // Just show a note that students will write their answers
                const theoryDiv = document.createElement('div');
                theoryDiv.innerHTML = `
                    <div class="form-group">
                        <p style="color: var(--light-text); font-size: 0.9rem; font-style: italic;">
                            📝 Students will provide a written answer for this question. This question requires manual grading.
                        </p>
                    </div>
                `;
                optsContainer.appendChild(theoryDiv);
            }

            container.appendChild(qEl);
        });
    },

    saveExam: async (e) => {
        e.preventDefault();

        // Validation
        if (examManager.questions.length === 0) {
            alert("Please add at least one question.");
            return;
        }

        const title = document.getElementById('exam-title').value;
        const subject = document.getElementById('exam-subject').value;
        const targetClass = document.getElementById('exam-target-class').value;
        const duration = parseInt(document.getElementById('exam-duration').value);
        const passScore = parseInt(document.getElementById('exam-pass-score').value);
        const instructions = document.getElementById('exam-instructions').value;

        // New fields
        const scheduledDateInput = document.getElementById('exam-scheduled-date');
        const scheduledDate = scheduledDateInput && scheduledDateInput.value
            ? new Date(scheduledDateInput.value).toISOString()
            : null;

        const scrambleCheckbox = document.getElementById('exam-scramble');
        const scrambleQuestions = scrambleCheckbox ? scrambleCheckbox.checked : false;

        // Theory section instructions
        const theoryInstructionsInput = document.getElementById('exam-theory-instructions');
        const theoryInstructions = theoryInstructionsInput ? theoryInstructionsInput.value : '';

        // Validate Questions
        let valid = true;
        examManager.questions.forEach((q, i) => {
            if (!q.text.trim()) {
                alert(`Question ${i + 1} is missing text.`);
                valid = false;
                return;
            }
            if (q.type === 'mcq' || q.type === 'image_mcq') {
                if (q.options.some(o => !o.text.trim())) {
                    alert(`Question ${i + 1} has empty options.`);
                    valid = false;
                    return;
                }
                if (!q.options.some(o => o.isCorrect)) {
                    alert(`Question ${i + 1} has no correct answer selected.`);
                    valid = false;
                    return;
                }
            } else if (q.type === 'fill_blank') {
                if (!q.correctAnswer || !q.correctAnswer.trim()) {
                    alert(`Question ${i + 1} is missing a correct answer.`);
                    valid = false;
                    return;
                }
            } else if (q.type === 'match') {
                if (!q.pairs || q.pairs.length < 2) {
                    alert(`Question ${i + 1} needs at least 2 pairs.`);
                    valid = false;
                    return;
                }
                if (q.pairs.some(p => !p.left.trim() || !p.right.trim())) {
                    alert(`Question ${i + 1} has empty matching items.`);
                    valid = false;
                    return;
                }
            } else if (q.type === 'theory') {
                // Theory questions only need text, no validation for options/answers
                // They will be manually graded
            }
        });

        if (!valid) return;

        const user = dataService.getCurrentUser();
        const examData = {
            id: examManager.currentExamId || undefined, // undefined lets createExam gen new ID
            title,
            subject,
            targetClass,
            duration,
            passScore,
            instructions,
            theoryInstructions,
            questions: examManager.questions,
            createdBy: user.id,
            updatedAt: new Date().toISOString(),
            status: 'active',
            scheduledDate,
            scrambleQuestions
        };

        try {
            if (examManager.currentExamId) {
                await dataService.updateExam(examManager.currentExamId, examData);
            } else {
                await dataService.createExam(examData);
            }
            window.onbeforeunload = null; // Disable warning
            window.location.href = 'teacher-dashboard.html';
        } catch (err) {
            alert('Failed to save exam: ' + err.message);
        }
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
    examManager.init();

    // Attach event listeners
    const addQuestionBtn = document.getElementById('add-question-btn');
    if (addQuestionBtn) {
        addQuestionBtn.addEventListener('click', examManager.addQuestion);
    }

    const form = document.getElementById('create-exam-form');
    if (form) {
        form.addEventListener('submit', examManager.saveExam);
    }
});
