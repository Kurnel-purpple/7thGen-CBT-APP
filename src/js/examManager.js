/**
 * Exam Manager Module
 * Handles creation and editing of exams
 */

const examManager = {
    questions: [],
    uploadedMedia: [], // Store uploaded images/diagrams

    currentExamId: null,

    // ========== MEDIA MANAGEMENT ==========

    openMediaModal: () => {
        document.getElementById('media-modal').style.display = 'block';
        examManager.renderMediaGallery();
        examManager.initMediaUploadHandlers();
    },

    // Open media modal with a specific question pre-selected for quick assignment
    openMediaModalForQuestion: (questionId) => {
        examManager._pendingQuestionId = questionId; // Store the question ID
        document.getElementById('media-modal').style.display = 'block';
        examManager.renderMediaGallery();
        examManager.initMediaUploadHandlers();
    },

    closeMediaModal: () => {
        document.getElementById('media-modal').style.display = 'none';
        // Clear pending question ID
        examManager._pendingQuestionId = null;
        // Re-render questions to show any newly attached media
        examManager.renderQuestions();
    },

    // Auto-expand textarea based on content
    autoExpand: (textarea) => {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight) + 'px';
    },

    initMediaUploadHandlers: () => {
        const uploadArea = document.getElementById('media-upload-area');
        const fileInput = document.getElementById('media-file-input');

        if (!uploadArea || !fileInput) return;

        // Click to upload
        uploadArea.onclick = () => fileInput.click();

        // File input change
        fileInput.onchange = (e) => {
            examManager.handleMediaFiles(e.target.files);
            fileInput.value = ''; // Reset so same file can be uploaded again
        };

        // Drag and drop
        uploadArea.ondragover = (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--primary-color)';
            uploadArea.style.background = 'rgba(99, 102, 241, 0.1)';
        };

        uploadArea.ondragleave = (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--border-color)';
            uploadArea.style.background = 'var(--inner-bg)';
        };

        uploadArea.ondrop = (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--border-color)';
            uploadArea.style.background = 'var(--inner-bg)';

            if (e.dataTransfer.files.length > 0) {
                examManager.handleMediaFiles(e.dataTransfer.files);
            }
        };

        // Paste from clipboard (listen on modal)
        const modal = document.getElementById('media-modal');
        modal.onpaste = (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        examManager.handleMediaFiles([file]);
                    }
                }
            }
        };
    },

    handleMediaFiles: (files) => {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) {
                Utils.showAlert('Invalid File', `${file.name} is not an image file.`);
                return;
            }

            const reader = new FileReader();
            reader.onload = (evt) => {
                const mediaId = Utils.generateId();
                const pendingQuestionId = examManager._pendingQuestionId || null;

                const mediaItem = {
                    id: mediaId,
                    name: file.name,
                    dataUrl: evt.target.result,
                    assignedToQuestion: pendingQuestionId, // Auto-assign if question was selected
                    uploadedAt: new Date().toISOString()
                };
                examManager.uploadedMedia.push(mediaItem);

                // If auto-assigning, also add to question's attachedMedia array
                if (pendingQuestionId) {
                    const question = examManager.questions.find(q => q.id === pendingQuestionId);
                    if (question) {
                        if (!question.attachedMedia) question.attachedMedia = [];
                        question.attachedMedia.push(mediaId);
                    }
                }

                examManager.renderMediaGallery();
            };
            reader.readAsDataURL(file);
        });
    },

    renderMediaGallery: () => {
        const gallery = document.getElementById('media-gallery');
        const container = document.getElementById('uploaded-media-container');
        const noMediaMsg = document.getElementById('no-media-msg');
        const countBadge = document.getElementById('media-count');
        const statusSpan = document.getElementById('media-assignment-status');

        if (!gallery) return;

        // Show auto-assign notice if a question is pending
        if (examManager._pendingQuestionId) {
            const questionIndex = examManager.questions.findIndex(q => q.id === examManager._pendingQuestionId);
            if (questionIndex >= 0) {
                noMediaMsg.innerHTML = `
                    <div style="background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1)); padding: 15px; border-radius: 8px; border-left: 4px solid var(--primary-color);">
                        <p style="margin: 0; font-weight: 600;">📷 Upload media for Question #${questionIndex + 1}</p>
                        <p style="margin: 5px 0 0; font-size: 0.85rem; color: var(--light-text);">Media you upload will be automatically assigned to this question.</p>
                    </div>
                `;
            }
        } else {
            noMediaMsg.innerHTML = '<p>No media uploaded yet. Upload some images to get started.</p>';
        }

        if (examManager.uploadedMedia.length === 0) {
            container.style.display = 'none';
            noMediaMsg.style.display = 'block';
            return;
        }

        container.style.display = 'block';
        noMediaMsg.style.display = 'none';
        countBadge.textContent = examManager.uploadedMedia.length;

        // Count assigned media
        const assignedCount = examManager.uploadedMedia.filter(m => m.assignedToQuestion).length;
        statusSpan.textContent = `${assignedCount} of ${examManager.uploadedMedia.length} media assigned to questions`;

        gallery.innerHTML = '';

        examManager.uploadedMedia.forEach(media => {
            const mediaCard = document.createElement('div');
            mediaCard.style.cssText = `
                background: var(--card-bg);
                border: 2px solid ${media.assignedToQuestion ? 'var(--primary-color)' : 'var(--border-color)'};
                border-radius: 10px;
                overflow: hidden;
                position: relative;
                transition: all 0.2s ease;
            `;

            // Build question options for dropdown
            let questionOptions = '<option value="">-- Assign to Question --</option>';
            examManager.questions.forEach((q, idx) => {
                const selected = media.assignedToQuestion === q.id ? 'selected' : '';
                const preview = q.text ? q.text.substring(0, 30) + (q.text.length > 30 ? '...' : '') : 'Untitled';
                questionOptions += `<option value="${q.id}" ${selected}>Q${idx + 1}: ${preview}</option>`;
            });

            mediaCard.innerHTML = `
                <div style="position: relative;">
                    <img src="${media.dataUrl}" alt="${media.name}" style="width: 100%; height: 120px; object-fit: cover;">
                    <button type="button" onclick="examManager.removeMedia('${media.id}')" 
                        style="position: absolute; top: 5px; right: 5px; background: rgba(239, 68, 68, 0.9); color: white; border: none; border-radius: 50%; width: 24px; height: 24px; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center;">
                        ×
                    </button>
                    ${media.assignedToQuestion ? `<span style="position: absolute; top: 5px; left: 5px; background: var(--primary-color); color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">Assigned</span>` : ''}
                </div>
                <div style="padding: 10px;">
                    <p style="font-size: 0.8rem; color: var(--light-text); margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${media.name}">
                        ${media.name}
                    </p>
                    <select onchange="examManager.assignMediaToQuestion('${media.id}', this.value)" 
                        style="width: 100%; padding: 6px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--inner-bg); color: var(--text-color); font-size: 0.8rem;">
                        ${questionOptions}
                    </select>
                </div>
            `;

            gallery.appendChild(mediaCard);
        });
    },

    assignMediaToQuestion: (mediaId, questionId) => {
        const media = examManager.uploadedMedia.find(m => m.id === mediaId);
        if (media) {
            // If previously assigned to another question, clear that assignment
            if (media.assignedToQuestion) {
                const prevQuestion = examManager.questions.find(q => q.id === media.assignedToQuestion);
                if (prevQuestion && prevQuestion.attachedMedia) {
                    prevQuestion.attachedMedia = prevQuestion.attachedMedia.filter(id => id !== mediaId);
                }
            }

            // Assign to new question (or unassign if questionId is empty)
            media.assignedToQuestion = questionId || null;

            if (questionId) {
                const question = examManager.questions.find(q => q.id === questionId);
                if (question) {
                    if (!question.attachedMedia) question.attachedMedia = [];
                    if (!question.attachedMedia.includes(mediaId)) {
                        question.attachedMedia.push(mediaId);
                    }
                }
            }

            examManager.renderMediaGallery();
        }
    },

    removeMedia: async (mediaId) => {
        if (await Utils.showConfirm('Remove Media', 'Remove this media?')) {
            // Remove from any question it was attached to
            const media = examManager.uploadedMedia.find(m => m.id === mediaId);
            if (media && media.assignedToQuestion) {
                const question = examManager.questions.find(q => q.id === media.assignedToQuestion);
                if (question && question.attachedMedia) {
                    question.attachedMedia = question.attachedMedia.filter(id => id !== mediaId);
                }
            }

            examManager.uploadedMedia = examManager.uploadedMedia.filter(m => m.id !== mediaId);
            examManager.renderMediaGallery();
        }
    },

    getMediaForQuestion: (questionId) => {
        return examManager.uploadedMedia.filter(m => m.assignedToQuestion === questionId);
    },

    previewMedia: (mediaId) => {
        const media = examManager.uploadedMedia.find(m => m.id === mediaId);
        if (!media) return;

        // Create lightbox overlay
        const overlay = document.createElement('div');
        overlay.id = 'media-lightbox';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            cursor: pointer;
        `;
        overlay.onclick = () => overlay.remove();

        overlay.innerHTML = `
            <div style="position: relative; max-width: 90%; max-height: 90%;">
                <img src="${media.dataUrl}" alt="${media.name}" style="max-width: 100%; max-height: 90vh; border-radius: 8px; box-shadow: 0 10px 50px rgba(0,0,0,0.5);">
                <button onclick="this.parentElement.parentElement.remove(); event.stopPropagation();" 
                    style="position: absolute; top: -15px; right: -15px; background: white; color: black; border: none; border-radius: 50%; width: 36px; height: 36px; cursor: pointer; font-size: 20px; font-weight: bold; box-shadow: 0 2px 10px rgba(0,0,0,0.3);">×</button>
                <p style="text-align: center; color: white; margin-top: 15px; font-size: 0.9rem;">${media.name}</p>
            </div>
        `;

        document.body.appendChild(overlay);
    },

    unassignMedia: (mediaId, questionId) => {
        const media = examManager.uploadedMedia.find(m => m.id === mediaId);
        if (media) {
            media.assignedToQuestion = null;

            // Also remove from question's attachedMedia array
            const question = examManager.questions.find(q => q.id === questionId);
            if (question && question.attachedMedia) {
                question.attachedMedia = question.attachedMedia.filter(id => id !== mediaId);
            }

            examManager.renderQuestions();
        }
    },

    // ========== END MEDIA MANAGEMENT ==========


    init: async () => {
        const params = new URLSearchParams(window.location.search);
        const examId = params.get('id');
        if (examId) {
            document.querySelector('h1').textContent = 'Edit Exam';
            document.title = 'Edit Exam - CBT Exam';
            await examManager.loadExam(examId);
        }
    },

    // Fabric.js canvas instance for bulk import
    importCanvasInstance: null,

    loadExam: async (id) => {
        try {
            const exam = await dataService.getExamById(id);
            if (!exam) {
                await Utils.showAlert('Error', 'Exam not found');
                window.location.href = 'teacher-dashboard.html';
                return;
            }

            examManager.currentExamId = exam.id;
            examManager.questions = (exam.questions && Array.isArray(exam.questions)) ? exam.questions : [];

            // Populate Form
            document.getElementById('exam-title').value = exam.title;

            // Handle school level and subject (cascading dropdown)
            const schoolLevelSelect = document.getElementById('exam-school-level');
            const subjectSelect = document.getElementById('exam-subject');
            const targetClassSelect = document.getElementById('exam-target-class');

            if (schoolLevelSelect && exam.schoolLevel) {
                // Wait slightly for DOMContentLoaded cascading event listeners in create-exam to attach
                setTimeout(() => {
                    schoolLevelSelect.value = exam.schoolLevel;
                    // Trigger change event to populate subjects and target classes
                    schoolLevelSelect.dispatchEvent(new Event('change'));

                    // Wait for options to render, then set the subject and target class
                    setTimeout(() => {
                        if (subjectSelect) {
                            subjectSelect.value = exam.subject;
                        }
                        if (targetClassSelect) {
                            targetClassSelect.value = exam.targetClass || 'All';
                        }
                    }, 50);
                }, 100);
            } else {
                if (subjectSelect) {
                    subjectSelect.value = exam.subject;
                }
                if (targetClassSelect) {
                    targetClassSelect.value = exam.targetClass || 'All';
                }
            }
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

            // Restore uploaded media from questions (for editing existing exams)
            examManager.uploadedMedia = [];
            examManager.questions.forEach(q => {
                if (q.mediaAttachments && Array.isArray(q.mediaAttachments)) {
                    q.mediaAttachments.forEach(media => {
                        // Add to uploadedMedia array with assignment info
                        examManager.uploadedMedia.push({
                            id: media.id,
                            name: media.name,
                            dataUrl: media.dataUrl,
                            assignedToQuestion: q.id,
                            uploadedAt: new Date().toISOString()
                        });
                    });
                }
            });

            examManager.renderQuestions();
        } catch (err) {
            console.error(err);
            await Utils.showAlert('Error', 'Error loading exam');
        }
    },

    addQuestion: () => {
        const id = Utils.generateId();
        examManager.questions.push({
            id: id,
            type: 'mcq',
            text: '',
            canvasJSON: null,
            canvasImage: null,
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

    removeQuestion: async (id) => {
        // Ensure String comparison
        const targetId = String(id);
        if (await Utils.showConfirm('Remove Question', 'Are you sure you want to remove this question?')) {
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
                delete q.subQuestions;
                q.points = 0;
            } else if (newType === 'image_multi') {
                // Picture Comprehension: One image with multiple questions (A-E options each)
                q.subQuestions = [
                    { id: Utils.generateId(), number: 1, correctAnswer: '' },
                    { id: Utils.generateId(), number: 2, correctAnswer: '' },
                    { id: Utils.generateId(), number: 3, correctAnswer: '' }
                ];
                q.numSubQuestions = 3;
                delete q.options;
                delete q.correctAnswer;
                delete q.pairs;
            } else {
                // mcq or image_mcq
                q.options = [
                    { id: Utils.generateId(), text: '', isCorrect: false },
                    { id: Utils.generateId(), text: '', isCorrect: false }
                ];
                if (newType !== 'image_mcq') delete q.image;
                delete q.subQuestions;
                delete q.numSubQuestions;
            }
            examManager.renderQuestions();
        }
    },

    openImportModal: () => {
        document.getElementById('import-modal').style.display = 'block';
        // Initialize Fabric.js canvas for import modal with auto-text and taller height
        const mountEl = document.getElementById('import-canvas-mount');
        if (mountEl && typeof FabricWordProcessor !== 'undefined') {
            setTimeout(() => {
                examManager.importCanvasInstance = FabricWordProcessor.create(mountEl, 'bulk-import', {
                    height: 450,
                    autoText: true  // Auto-create a Textbox ready for typing/pasting
                });
            }, 100);
        }
    },

    closeImportModal: () => {
        document.getElementById('import-modal').style.display = 'none';
        // Destroy canvas instance
        if (examManager.importCanvasInstance) {
            FabricWordProcessor.destroyInstance('bulk-import');
            examManager.importCanvasInstance = null;
        }
        // Clear the mount point
        const mountEl = document.getElementById('import-canvas-mount');
        if (mountEl) mountEl.innerHTML = '';
        // Reset import points to default
        const importPointsInput = document.getElementById('import-points');
        if (importPointsInput) importPointsInput.value = '0.5';
    },

    processBulkImport: async () => {
        // Get text content from Fabric.js canvas text objects
        const wp = examManager.importCanvasInstance;
        if (!wp || wp.isEmpty()) {
            await Utils.showAlert('Empty Canvas', 'Please add some content to the canvas. Use the Text tool (T) to type or paste your questions.');
            return;
        }

        // Extract plain text from all text objects on the canvas
        const text = wp.getPlainText();
        if (!text.trim()) {
            await Utils.showAlert('No Text Found', 'No text content found on the canvas. Use the Text tool (T) to add question text.');
            return;
        }

        // Get points value from import modal (default to 0.5)
        const importPointsInput = document.getElementById('import-points');
        const importPoints = importPointsInput ? parseFloat(importPointsInput.value) || 0.5 : 0.5;

        // ===== Enhanced text-parsing logic =====
        // First try splitting by double newlines (standard format)
        let blocks = text.split(/\n\s*\n/);

        // If only 1 block found, try splitting by numbered lines (e.g., "1.", "2)", "3.")
        // This handles pasted text where questions are separated by single newlines with numbers
        if (blocks.length <= 1) {
            const numberedSplit = text.split(/\n(?=\s*\d+[\.\)]\s)/);
            if (numberedSplit.length > 1) {
                blocks = numberedSplit;
            }
        }
        let addedCount = 0;
        let forceTheoryMode = false;

        blocks.forEach(block => {
            block = block.trim();
            if (!block) return;

            // Check if this block is the THEORY marker
            if (/^\s*[-=]*\s*THEORY\s*[-=:]*\s*$/i.test(block) && block.toUpperCase().includes('THEORY')) {
                const theoryLine = block.replace(/[-=:\s]/g, '');
                if (theoryLine === 'THEORY') {
                    forceTheoryMode = true;
                    console.log('📝 THEORY marker detected - subsequent questions will be theory type');
                    return;
                }
            }

            const lines = block.split('\n');
            let qText = '';
            let options = [];

            // STRATEGY 1: Inline Options
            const inlineMarkerRegex = /(\([a-dA-D]\))\s/g;
            const joined = lines.join(' ');
            const markersFound = joined.match(inlineMarkerRegex);

            if (markersFound && markersFound.length >= 2) {
                const parts = joined.split(/(\([a-dA-D]\)\s)/);
                qText = parts[0].trim();

                for (let i = 1; i < parts.length; i += 2) {
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
                // STRATEGY 2: Multiline Parsing
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
                            const clean = line.replace(/^\d+[\.)\]]\s+/, '');
                            qLines.push(clean.trim());
                        }
                    }
                });
                qText = qLines.join(' ');
            }

            // Create question based on whether options were found
            if (qText) {
                if (forceTheoryMode) {
                    examManager.questions.push({
                        id: Utils.generateId(),
                        type: 'theory',
                        text: qText,
                        canvasJSON: null,
                        canvasImage: null,
                        points: 0
                    });
                    addedCount++;
                } else if (options.length > 0) {
                    examManager.questions.push({
                        id: Utils.generateId(),
                        type: 'mcq',
                        text: qText,
                        canvasJSON: null,
                        canvasImage: null,
                        options: options,
                        points: importPoints
                    });
                    addedCount++;
                } else {
                    examManager.questions.push({
                        id: Utils.generateId(),
                        type: 'theory',
                        text: qText,
                        canvasJSON: null,
                        canvasImage: null,
                        points: 0
                    });
                    addedCount++;
                }
            }
        });

        if (addedCount > 0) {
            examManager.renderQuestions();
            examManager.closeImportModal();
            await Utils.showAlert('Success', `Successfully imported ${addedCount} questions.`);
        } else {
            await Utils.showAlert('Import Error', 'Could not detect any valid questions from the text on the canvas.\n\nSupported formats:\n1. Objective Questions (with options):\n   Question text\n   (a) Option 1\n   (b) Option 2\n\n2. Theory Questions (without options):\n   Question text only\n\n3. Inline format:\n   Question... (A) Opt1 (B) Opt2');
        }
    },

    renderQuestions: () => {
        // Preserve canvas state from all active Fabric.js instances before destroying DOM
        if (typeof FabricWordProcessor !== 'undefined') {
            examManager.questions.forEach(q => {
                const wpInstance = FabricWordProcessor.getInstance(q.id);
                if (wpInstance && !wpInstance.isEmpty()) {
                    q.canvasJSON = wpInstance.getJSON();
                    q.canvasImage = wpInstance.getImage();
                    // Extract plain text for backward compat
                    q.text = wpInstance.getPlainText() || '[Canvas Content]';
                }
                // Destroy the old instance before re-render
                FabricWordProcessor.destroyInstance(q.id);
            });
        }
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

            let displayNumber = 1;
            if (q.type === 'theory') {
                displayNumber = (index - objectiveQuestions.length) + 1;
            } else {
                displayNumber = index + 1;
            }

            let html = template
                .replace(/{id}/g, q.id)
                .replace(/{n}/g, displayNumber);

            const div = document.createElement('div');
            div.innerHTML = html;

            // Set values
            const qEl = div.firstElementChild;
            // Mount Fabric.js Word Processor canvas
            const wpMount = qEl.querySelector('.wp-mount-point');
            if (wpMount && typeof FabricWordProcessor !== 'undefined') {
                // Defer canvas init until element is fully in DOM and rendered
                setTimeout(() => {
                    // Default height is 150px, auto-expands with content
                    const wpInstance = FabricWordProcessor.create(wpMount, q.id);
                    if (q.canvasJSON) {
                        // Load saved canvas state (preserves formatting)
                        wpInstance.loadJSON(q.canvasJSON);
                    } else if (q.text && q.text.trim() && q.text !== '[Canvas Content]') {
                        // Auto-populate canvas with plain text (e.g., from bulk import)
                        wpInstance.addTextbox(q.text, false);
                    }
                }, 200);
            }

            const typeSelect = qEl.querySelector('.q-type');
            typeSelect.value = q.type;

            qEl.querySelector('.q-points').value = q.points;
            qEl.querySelector('.q-points').onchange = (e) => {
                const val = parseFloat(e.target.value);
                q.points = isNaN(val) ? 0 : val;
            };

            // Render Attached Media (from Media Upload Modal)
            const attachedMedia = examManager.getMediaForQuestion(q.id);
            if (attachedMedia.length > 0) {
                const mediaSection = document.createElement('div');
                mediaSection.style.cssText = 'margin: 15px 0; padding: 15px; background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(139, 92, 246, 0.05)); border-radius: 10px; border: 1px solid var(--border-color);';

                let mediaHtml = `
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <span style="font-weight: 600; font-size: 0.9rem; display: flex; align-items: center; gap: 6px;">
                            📷 Attached Media <span style="background: var(--primary-color); color: white; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem;">${attachedMedia.length}</span>
                        </span>
                        <button type="button" onclick="examManager.openMediaModalForQuestion('${q.id}')" class="btn" style="font-size: 0.8rem; padding: 4px 10px;">
                            + Add More
                        </button>
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 10px;">
                `;

                attachedMedia.forEach(media => {
                    mediaHtml += `
                        <div style="position: relative; border-radius: 8px; overflow: hidden; border: 2px solid var(--border-color); background: var(--card-bg);">
                            <img src="${media.dataUrl}" alt="${media.name}" style="width: 150px; height: 100px; object-fit: cover; display: block; cursor: pointer;" 
                                onclick="examManager.previewMedia('${media.id}')" title="Click to preview">
                            <button type="button" onclick="examManager.unassignMedia('${media.id}', '${q.id}')" 
                                style="position: absolute; top: 4px; right: 4px; background: rgba(239, 68, 68, 0.9); color: white; border: none; border-radius: 50%; width: 20px; height: 20px; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;" 
                                title="Remove from question">×</button>
                        </div>
                    `;
                });

                mediaHtml += `</div>`;
                mediaSection.innerHTML = mediaHtml;

                // Insert before question content container
                const wpMountForMedia = qEl.querySelector('.wp-mount-point');
                if (wpMountForMedia && wpMountForMedia.parentNode) {
                    wpMountForMedia.parentNode.insertBefore(mediaSection, wpMountForMedia);
                }
            } else if (q.type !== 'image_multi') {
                // No media attached - show "Add Media" button (except for Picture Comprehension which has its own image upload)
                const addMediaSection = document.createElement('div');
                addMediaSection.style.cssText = 'margin: 10px 0;';
                addMediaSection.innerHTML = `
                    <button type="button" class="add-media-btn" onclick="examManager.openMediaModalForQuestion('${q.id}')">
                        📷 Add Media (Image/Diagram)
                    </button>
                `;

                // Insert before question content container
                const wpMountEl = qEl.querySelector('.wp-mount-point');
                if (wpMountEl && wpMountEl.parentNode) {
                    wpMountEl.parentNode.insertBefore(addMediaSection, wpMountEl);
                }
            }

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
                        <input type="radio" name="correct_${q.id}" ${opt.isCorrect ? 'checked' : ''} title="Mark as correct">
                        <textarea class="form-control auto-expand" placeholder="Option ${optIndex + 1}" rows="1">${opt.text}</textarea>
                        ${q.options.length > 2 ? '<button type="button" class="btn" style="color:var(--accent-color); padding: 5px 10px; min-width: auto;" title="Remove option">✕</button>' : ''}
                    `;

                    const radio = optDiv.querySelector('input[type="radio"]');
                    radio.onchange = () => {
                        q.options.forEach(o => o.isCorrect = false);
                        opt.isCorrect = true;
                    };

                    const textarea = optDiv.querySelector('textarea');
                    textarea.oninput = (e) => {
                        opt.text = e.target.value;
                        examManager.autoExpand(e.target);
                    };

                    // Initial expand
                    setTimeout(() => examManager.autoExpand(textarea), 0);

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
                        <textarea class="form-control auto-expand" placeholder="e.g. Paris" rows="1">${q.correctAnswer || ''}</textarea>
                    </div>
                `;
                const textarea = fbDiv.querySelector('textarea');
                textarea.oninput = (e) => {
                    q.correctAnswer = e.target.value;
                    examManager.autoExpand(e.target);
                };
                setTimeout(() => examManager.autoExpand(textarea), 0);
                optsContainer.appendChild(fbDiv);

            } else if (q.type === 'match') {
                const headDiv = document.createElement('div');
                headDiv.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:5px; font-weight:bold;"><span style="flex:1">Left Item</span><span style="width:20px"></span><span style="flex:1">Matching Right Item</span></div>`;
                optsContainer.appendChild(headDiv);

                q.pairs = q.pairs || [];
                q.pairs.forEach((pair, pIdx) => {
                    const pairDiv = document.createElement('div');
                    pairDiv.className = 'answer-option';
                    pairDiv.style.alignItems = 'center';
                    pairDiv.innerHTML = `
                        <textarea class="form-control auto-expand left-item" placeholder="Left Item" rows="1" style="flex:1;">${pair.left}</textarea>
                        <span style="font-weight: bold;">=</span>
                        <textarea class="form-control auto-expand right-item" placeholder="Matching Right Item" rows="1" style="flex:1;">${pair.right}</textarea>
                        <button type="button" class="btn" style="color:var(--accent-color); padding: 5px 10px; min-width: auto;">✕</button>
                    `;

                    const leftArea = pairDiv.querySelector('.left-item');
                    const rightArea = pairDiv.querySelector('.right-item');

                    leftArea.oninput = (e) => {
                        pair.left = e.target.value;
                        examManager.autoExpand(e.target);
                    };
                    rightArea.oninput = (e) => {
                        pair.right = e.target.value;
                        examManager.autoExpand(e.target);
                    };
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
            } else if (q.type === 'image_multi') {
                // Picture Comprehension: One image with multiple sub-questions (A-E options each)

                // Image Upload
                const imgDiv = document.createElement('div');
                imgDiv.style.marginBottom = '15px';
                imgDiv.innerHTML = `
                    <label style="font-weight: 600; display: block; margin-bottom: 8px;">📷 Upload Comprehension Image</label>
                    <input type="file" accept="image/*" class="form-control file-upload-btn" style="margin-bottom: 10px; padding: 10px 16px; cursor: pointer; border: 2px dashed var(--primary-color); background: rgba(99, 102, 241, 0.05); color: var(--primary-color); border-radius: 8px; font-size: 0.9rem; transition: all 0.2s ease;">
                    ${q.image ? `<img src="${q.image}" style="max-width: 100%; max-height: 300px; margin-top: 10px; border-radius: 4px; border: 1px solid var(--border-color);">` : ''}
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

                // Number of Questions Selector
                const numQDiv = document.createElement('div');
                numQDiv.style.marginBottom = '15px';
                numQDiv.innerHTML = `
                    <label style="font-weight: 600; display: block; margin-bottom: 8px;">Number of Questions</label>
                    <select class="form-control" style="width: 80px;">
                        ${Array.from({ length: 100 }, (_, i) => i + 1).map(n => `<option value="${n}" ${q.numSubQuestions === n ? 'selected' : ''}>${n}</option>`).join('')}
                    </select>
                `;
                numQDiv.querySelector('select').onchange = (e) => {
                    const newCount = parseInt(e.target.value);
                    q.numSubQuestions = newCount;
                    // Adjust subQuestions array
                    if (newCount > q.subQuestions.length) {
                        // Add more questions
                        for (let i = q.subQuestions.length + 1; i <= newCount; i++) {
                            q.subQuestions.push({ id: Utils.generateId(), number: i, correctAnswer: '' });
                        }
                    } else {
                        // Remove excess questions
                        q.subQuestions = q.subQuestions.slice(0, newCount);
                    }
                    examManager.renderQuestions();
                };
                optsContainer.appendChild(numQDiv);

                // Sub-questions with correct answers
                const subQContainer = document.createElement('div');
                subQContainer.style.cssText = 'background: var(--inner-bg); padding: 15px; border-radius: 8px; margin-top: 15px;';
                subQContainer.innerHTML = '<label style="font-weight: 600; display: block; margin-bottom: 10px;">Set Correct Answers</label>';

                q.subQuestions = q.subQuestions || [];
                q.subQuestions.forEach((subQ, idx) => {
                    const subQDiv = document.createElement('div');
                    subQDiv.className = 'sub-question-row';
                    subQDiv.innerHTML = `
                        <span class="sub-question-label">Question ${subQ.number}:</span>
                        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                            ${['A', 'B', 'C', 'D', 'E'].map(opt => `
                                <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-color); ${subQ.correctAnswer === opt ? 'background: var(--success-color); color: white; border-color: var(--success-color);' : 'background: var(--card-bg);'}">
                                    <input type="radio" name="subq_${subQ.id}" value="${opt}" ${subQ.correctAnswer === opt ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
                                    <span style="font-weight: 600;">${opt}</span>
                                </label>
                            `).join('')}
                        </div>
                    `;
                    subQDiv.querySelectorAll('input[type="radio"]').forEach(radio => {
                        radio.onchange = () => {
                            subQ.correctAnswer = radio.value;
                            examManager.renderQuestions();
                        };
                    });
                    subQContainer.appendChild(subQDiv);
                });

                optsContainer.appendChild(subQContainer);

            } else if (q.type === 'theory') {
                // Theory questions don't need options
                // Just show a note that students will write their answers
                const theoryDiv = document.createElement('div');
                theoryDiv.innerHTML = `
                    <div class="form-group">
                        <p style="color: var(--light-text); font-size: 0.9rem; font-style: italic;">
                            Students will provide a written answer for this question. This question requires manual grading.
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

        // Prevent duplicate submissions
        if (examManager._isPublishing) {
            console.log('Already publishing, ignoring duplicate click');
            return;
        }

        // Validation
        if (examManager.questions.length === 0) {
            await Utils.showAlert('Missing Questions', 'Please add at least one question.');
            return;
        }

        const title = document.getElementById('exam-title').value;
        const schoolLevel = document.getElementById('exam-school-level').value;
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

        // Harvest canvas data from all Fabric.js word processor instances
        for (const q of examManager.questions) {
            const wpInstance = typeof FabricWordProcessor !== 'undefined' ? FabricWordProcessor.getInstance(q.id) : null;
            if (wpInstance) {
                if (!wpInstance.isEmpty()) {
                    q.canvasImage = wpInstance.getImage();
                    q.canvasJSON = wpInstance.getJSON();
                    // Extract plain text from canvas text objects for backward compat
                    q.text = wpInstance.getPlainText() || '[Canvas Content]';
                } else {
                    q.canvasImage = null;
                    q.canvasJSON = null;
                    q.text = '';
                }
            }
        }

        // Validate Questions
        let valid = true;
        for (let i = 0; i < examManager.questions.length; i++) {
            const q = examManager.questions[i];
            if (!q.canvasImage && !q.text.trim()) {
                await Utils.showAlert('Validation Error', `Question ${i + 1} is missing content. Please add text or drawings to the canvas.`);
                valid = false;
                break;
            }
            if (q.type === 'mcq' || q.type === 'image_mcq') {
                if (q.options.some(o => !o.text.trim())) {
                    await Utils.showAlert('Validation Error', `Question ${i + 1} has empty options.`);
                    valid = false;
                    break;
                }
                if (!q.options.some(o => o.isCorrect)) {
                    await Utils.showAlert('Validation Error', `Question ${i + 1} has no correct answer selected.`);
                    valid = false;
                    break;
                }
            } else if (q.type === 'fill_blank') {
                if (!q.correctAnswer || !q.correctAnswer.trim()) {
                    await Utils.showAlert('Validation Error', `Question ${i + 1} is missing a correct answer.`);
                    valid = false;
                    break;
                }
            } else if (q.type === 'match') {
                if (!q.pairs || q.pairs.length < 2) {
                    await Utils.showAlert('Validation Error', `Question ${i + 1} needs at least 2 pairs.`);
                    valid = false;
                    break;
                }
                if (q.pairs.some(p => !p.left.trim() || !p.right.trim())) {
                    await Utils.showAlert('Validation Error', `Question ${i + 1} has empty matching items.`);
                    valid = false;
                    break;
                }
            } else if (q.type === 'theory') {
                // Theory questions only need text, no validation for options/answers
                // They will be manually graded
            } else if (q.type === 'image_multi') {
                // Picture Comprehension validation
                if (!q.image) {
                    await Utils.showAlert('Validation Error', `Question ${i + 1} (Picture Comprehension) needs an image.`);
                    valid = false;
                    break;
                }
                if (!q.subQuestions || q.subQuestions.length === 0) {
                    await Utils.showAlert('Validation Error', `Question ${i + 1} (Picture Comprehension) needs at least one sub-question.`);
                    valid = false;
                    break;
                }
                // Check that all sub-questions have correct answers selected
                const missingAnswers = q.subQuestions.filter(sq => !sq.correctAnswer);
                if (missingAnswers.length > 0) {
                    const qNumbers = missingAnswers.map(sq => sq.number).join(', ');
                    await Utils.showAlert('Validation Error', `Question ${i + 1} (Picture Comprehension) is missing correct answers for sub-question(s): ${qNumbers}`);
                    valid = false;
                    break;
                }
            }
        }

        if (!valid) return;

        // Set publishing state AFTER validation passes
        examManager._isPublishing = true;

        // Disable submit button and show loading state
        const submitBtn = document.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn ? submitBtn.textContent : 'Publish Exam';
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = '⏳ Publishing...';
            submitBtn.style.opacity = '0.7';
        }

        // Process uploaded media - embed media data into questions for persistence
        const questionsWithMedia = examManager.questions.map(q => {
            const questionCopy = { ...q };
            const attachedMedia = examManager.getMediaForQuestion(q.id);
            if (attachedMedia.length > 0) {
                // Embed the actual media data into the question for storage
                questionCopy.mediaAttachments = attachedMedia.map(m => ({
                    id: m.id,
                    name: m.name,
                    dataUrl: m.dataUrl
                }));
            }
            return questionCopy;
        });

        const user = dataService.getCurrentUser();
        const examData = {
            id: examManager.currentExamId || undefined, // undefined lets createExam gen new ID
            title,
            schoolLevel,
            subject,
            targetClass,
            duration,
            passScore,
            instructions,
            theoryInstructions,
            questions: questionsWithMedia,
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
            // Re-enable button on error
            examManager._isPublishing = false;
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
                submitBtn.style.opacity = '1';
            }
            await Utils.showAlert('Error', 'Failed to save exam: ' + err.message);
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
