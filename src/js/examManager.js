/**
 * Exam Manager Module
 * Handles creation and editing of exams
 */

// HTML escape helper (Utils has no escapeHtml method)
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
        const pendingQId = examManager._pendingQuestionId;
        document.getElementById('media-modal').style.display = 'none';
        // Clear pending question ID
        examManager._pendingQuestionId = null;
        // Re-render questions to show any newly attached media
        examManager.renderQuestions();
        // Update media preview inside the Add Question modal if it's open
        examManager._updateModalMediaPreview(pendingQId);
    },

    _updateModalMediaPreview: (questionId) => {
        const preview = document.getElementById('modal-media-preview');
        if (!preview) return;
        const qId = questionId || examManager._editingQuestionId;
        if (!qId) { preview.innerHTML = ''; examManager._toggleEditorForImageType(false); return; }
        const media = examManager.getMediaForQuestion(qId);
        const isImageType = examManager._modalType === 'image_mcq' || examManager._modalType === 'image_multi';

        if (media.length === 0) {
            preview.innerHTML = '';
            examManager._toggleEditorForImageType(false);
            return;
        }

        if (isImageType) {
            // Large preview for image-based question types
            preview.innerHTML = media.map(m => `
                <div style="position:relative; border-radius:12px; overflow:hidden; border:1px solid var(--border-color); max-width:100%;">
                    <img src="${m.dataUrl}" alt="${m.name || 'media'}" style="width:100%; max-height:280px; object-fit:contain; display:block; background:var(--inner-bg);">
                    <button type="button" onclick="examManager.unassignMedia('${m.id}','${qId}')" style="position:absolute; top:8px; right:8px; width:28px; height:28px; border-radius:50%; border:none; background:rgba(0,0,0,0.6); color:#fff; font-size:14px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1;">&times;</button>
                </div>
            `).join('');
            examManager._toggleEditorForImageType(true);
        } else {
            // Thumbnail preview for other question types
            preview.innerHTML = media.map(m => `
                <div style="position:relative; width:64px; height:64px; border-radius:8px; overflow:hidden; border:1px solid var(--border-color);">
                    <img src="${m.dataUrl}" alt="${m.name || 'media'}" style="width:100%; height:100%; object-fit:cover;">
                    <button type="button" onclick="examManager.unassignMedia('${m.id}','${qId}')" style="position:absolute; top:2px; right:2px; width:18px; height:18px; border-radius:50%; border:none; background:rgba(0,0,0,0.6); color:#fff; font-size:11px; cursor:pointer; display:flex; align-items:center; justify-content:center; line-height:1;">&times;</button>
                </div>
            `).join('');
            examManager._toggleEditorForImageType(false);
        }
    },

    _toggleEditorForImageType: (collapse) => {
        const editorContainer = document.querySelector('#add-question-modal .modal-editor-container');
        if (!editorContainer) return;
        if (collapse) {
            editorContainer.style.maxHeight = '60px';
            editorContainer.style.overflow = 'hidden';
            editorContainer.style.opacity = '0.5';
            editorContainer.style.cursor = 'pointer';
            editorContainer.title = 'Click to expand editor';
            editorContainer.onclick = () => examManager._toggleEditorForImageType(false);
        } else {
            editorContainer.style.maxHeight = '';
            editorContainer.style.overflow = '';
            editorContainer.style.opacity = '';
            editorContainer.style.cursor = '';
            editorContainer.title = '';
            editorContainer.onclick = null;
        }
    },

    unassignMedia: (mediaId, questionId) => {
        const m = examManager.uploadedMedia.find(x => x.id === mediaId);
        if (m) m.assignedToQuestion = null;
        examManager._updateModalMediaPreview(questionId);
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
                        // Sync steps chain UI
                        if (typeof populateChainDropdowns === 'function') populateChainDropdowns(exam.schoolLevel);
                        if (typeof updateStepsChainState === 'function') updateStepsChainState();
                    }, 50);
                }, 100);
            } else {
                if (subjectSelect) {
                    subjectSelect.value = exam.subject;
                }
                if (targetClassSelect) {
                    targetClassSelect.value = exam.targetClass || 'All';
                }
                // Sync steps chain UI
                if (typeof populateChainDropdowns === 'function') populateChainDropdowns(exam.schoolLevel);
                if (typeof updateStepsChainState === 'function') updateStepsChainState();
            }
            document.getElementById('exam-duration').value = exam.duration;
            document.getElementById('exam-pass-score').value = exam.passScore;
            document.getElementById('exam-instructions').value = exam.instructions;

            // New fields: Scheduling and Scrambling
            const scheduledDateInput = document.getElementById('exam-scheduled-date');
            if (scheduledDateInput && exam.scheduledDate) {
                const date = new Date(exam.scheduledDate);
                scheduledDateInput.value = date.toISOString().slice(0, 16);
            }

            if (exam.scrambleQuestions) {
                const scrambleYes = document.getElementById('exam-scramble-yes');
                if (scrambleYes) scrambleYes.checked = true;
            } else {
                const scrambleNo = document.getElementById('exam-scramble-no');
                if (scrambleNo) scrambleNo.checked = true;
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

            examManager.renderInstructionsList();
            examManager.renderQuestions();
        } catch (err) {
            console.error(err);
            await Utils.showAlert('Error', 'Error loading exam');
        }
    },

    addQuestion: () => {
        // Open the Add Question modal instead of inline append
        examManager.openAddQuestionModal();
    },

    // ========== ADD / EDIT QUESTION MODAL ==========

    _editingQuestionId: null, // null = adding new, string = editing existing
    _modalOptions: [],        // Temporary options state for the modal
    _modalPairs: [],          // Temporary pairs state for match type
    _modalSubQuestions: [],   // Temporary sub-questions for image_multi
    _modalType: 'mcq',       // Current type selected in modal

    _typeLabels: {
        mcq: 'Multiple Choice',
        true_false: 'True / False',
        fill_blank: 'Fill in Blank',
        match: 'Matching',
        image_mcq: 'Image MCQ',
        image_multi: 'Picture Comp.',
        theory: 'Theory'
    },

    openAddQuestionModal: (questionId) => {
        const modal = document.getElementById('add-question-modal');
        if (!modal) return;

        const isEdit = questionId && typeof questionId === 'string' && questionId !== 'undefined';
        let q = null;

        if (isEdit) {
            q = examManager.questions.find(x => String(x.id) === String(questionId));
            if (!q) return;
        }

        examManager._editingQuestionId = isEdit ? q.id : null;

        // Set modal title and button text
        const titleEl = document.getElementById('add-question-modal-title');
        const saveBtnText = document.getElementById('modal-save-btn-text');
        if (titleEl) titleEl.textContent = isEdit ? 'Edit Question' : 'Add Question';
        if (saveBtnText) saveBtnText.textContent = isEdit ? 'Save Changes' : 'Add Question';

        // Set type
        examManager._modalType = isEdit ? q.type : 'mcq';

        // Set options / pairs / sub-questions (deep copy)
        if (isEdit) {
            if (q.options) examManager._modalOptions = JSON.parse(JSON.stringify(q.options));
            else examManager._modalOptions = [{ id: Utils.generateId(), text: '', isCorrect: false }, { id: Utils.generateId(), text: '', isCorrect: false }];

            if (q.pairs) examManager._modalPairs = JSON.parse(JSON.stringify(q.pairs));
            else examManager._modalPairs = [{ left: '', right: '' }, { left: '', right: '' }];

            if (q.subQuestions) examManager._modalSubQuestions = JSON.parse(JSON.stringify(q.subQuestions));
            else examManager._modalSubQuestions = [];
        } else {
            examManager._modalOptions = [
                { id: Utils.generateId(), text: '', isCorrect: false },
                { id: Utils.generateId(), text: '', isCorrect: false }
            ];
            examManager._modalPairs = [{ left: '', right: '' }, { left: '', right: '' }];
            examManager._modalSubQuestions = [];
        }

        // Set points
        const pointsInput = document.getElementById('modal-points');
        if (pointsInput) pointsInput.value = isEdit ? q.points : 0.5;

        // Update type selector buttons
        examManager._updateModalTypeButtons();

        // Render options for current type
        examManager._renderModalOptions();

        // Show media preview for this question
        examManager._updateModalMediaPreview(isEdit ? q.id : null);

        // Show modal
        modal.style.display = 'flex';
        modal.style.alignItems = 'flex-start';
        modal.style.justifyContent = 'center';

        // Mount Tiptap editor in modal
        setTimeout(() => {
            const wpMount = document.getElementById('modal-wp-mount');
            if (wpMount && window.TiptapEditor) {
                // Destroy any existing instance
                window.TiptapEditor.destroyInstance('modal-q');
                const wpInstance = window.TiptapEditor.create(wpMount, 'modal-q');
                if (isEdit && q.canvasJSON) {
                    wpInstance.loadJSON(q.canvasJSON);
                } else if (isEdit && q.text && q.text.trim() && q.text !== '[Canvas Content]') {
                    wpInstance.addTextbox(q.text, false);
                }
            }
        }, 150);
    },

    closeAddQuestionModal: () => {
        const modal = document.getElementById('add-question-modal');
        if (modal) modal.style.display = 'none';

        // Destroy Tiptap editor
        if (window.TiptapEditor) {
            window.TiptapEditor.destroyInstance('modal-q');
        }

        examManager._editingQuestionId = null;
        examManager._modalOptions = [];
        examManager._modalPairs = [];
        examManager._modalSubQuestions = [];
    },

    saveQuestionFromModal: () => {
        const type = examManager._modalType;
        const pointsInput = document.getElementById('modal-points');
        const points = pointsInput ? parseFloat(pointsInput.value) || 0 : 0.5;

        // Harvest Tiptap content
        let text = '';
        let canvasJSON = null;
        let canvasImage = null;
        const wpInstance = window.TiptapEditor ? window.TiptapEditor.getInstance('modal-q') : null;
        if (wpInstance) {
            if (!wpInstance.isEmpty()) {
                canvasJSON = wpInstance.getJSON();
                canvasImage = wpInstance.getImage();
                text = wpInstance.getPlainText() || '[Canvas Content]';
            }
        }

        // Read current option values from DOM
        examManager._harvestModalOptions();

        const isEdit = !!examManager._editingQuestionId;

        if (isEdit) {
            // Update existing question
            const q = examManager.questions.find(x => String(x.id) === String(examManager._editingQuestionId));
            if (q) {
                q.type = type;
                q.text = text;
                q.canvasJSON = canvasJSON;
                q.canvasImage = canvasImage;
                q.points = points;
                if (type === 'mcq' || type === 'true_false' || type === 'image_mcq') {
                    q.options = examManager._modalOptions;
                    delete q.correctAnswer;
                    delete q.pairs;
                    delete q.subQuestions;
                } else if (type === 'fill_blank') {
                    q.correctAnswer = examManager._modalOptions[0]?.text || '';
                    delete q.options;
                    delete q.pairs;
                    delete q.subQuestions;
                } else if (type === 'match') {
                    q.pairs = examManager._modalPairs;
                    delete q.options;
                    delete q.correctAnswer;
                    delete q.subQuestions;
                } else if (type === 'image_multi') {
                    q.subQuestions = examManager._modalSubQuestions;
                    delete q.options;
                    delete q.correctAnswer;
                    delete q.pairs;
                } else if (type === 'theory') {
                    delete q.options;
                    delete q.correctAnswer;
                    delete q.pairs;
                    delete q.subQuestions;
                    q.points = 0;
                }
            }
        } else {
            // Create new question
            const id = Utils.generateId();
            const newQ = {
                id: id,
                type: type,
                text: text,
                canvasJSON: canvasJSON,
                canvasImage: canvasImage,
                points: type === 'theory' ? 0 : points
            };
            if (type === 'mcq' || type === 'true_false' || type === 'image_mcq') {
                newQ.options = examManager._modalOptions;
            } else if (type === 'fill_blank') {
                newQ.correctAnswer = examManager._modalOptions[0]?.text || '';
            } else if (type === 'match') {
                newQ.pairs = examManager._modalPairs;
            } else if (type === 'image_multi') {
                newQ.subQuestions = examManager._modalSubQuestions;
                newQ.numSubQuestions = examManager._modalSubQuestions.length || 5;
                newQ.image = null;
            }
            examManager.questions.push(newQ);
        }

        examManager.closeAddQuestionModal();
        examManager.renderQuestions();

        // Scroll to the new/edited card
        if (!isEdit) {
            setTimeout(() => {
                const cards = document.querySelectorAll('.question-summary-card');
                if (cards.length > 0) {
                    cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
        }
    },

    _updateModalTypeButtons: () => {
        const selector = document.getElementById('modal-type-selector');
        if (!selector) return;
        selector.querySelectorAll('.type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === examManager._modalType);
        });

        // Show/hide options container based on type
        const optsContainer = document.getElementById('modal-options-container');
        const addOptBtn = document.getElementById('modal-add-option-btn');
        if (optsContainer) {
            if (examManager._modalType === 'theory') {
                optsContainer.style.display = 'none';
            } else {
                optsContainer.style.display = 'block';
            }
        }
        if (addOptBtn) {
            addOptBtn.style.display = (examManager._modalType === 'mcq' || examManager._modalType === 'image_mcq') ? 'inline-flex' : 'none';
        }
    },

    _harvestModalOptions: () => {
        const type = examManager._modalType;
        const container = document.getElementById('modal-options-list');
        if (!container) return;

        if (type === 'mcq' || type === 'image_mcq') {
            const optionEls = container.querySelectorAll('.answer-option');
            optionEls.forEach((el, i) => {
                if (examManager._modalOptions[i]) {
                    const textarea = el.querySelector('textarea');
                    const radio = el.querySelector('input[type="radio"]');
                    if (textarea) examManager._modalOptions[i].text = textarea.value;
                    if (radio) examManager._modalOptions[i].isCorrect = radio.checked;
                }
            });
        } else if (type === 'fill_blank') {
            const textarea = container.querySelector('textarea');
            if (textarea) {
                if (!examManager._modalOptions[0]) examManager._modalOptions[0] = { text: '' };
                examManager._modalOptions[0].text = textarea.value;
            }
        } else if (type === 'match') {
            const pairEls = container.querySelectorAll('.answer-option');
            pairEls.forEach((el, i) => {
                if (examManager._modalPairs[i]) {
                    const left = el.querySelector('.left-item');
                    const right = el.querySelector('.right-item');
                    if (left) examManager._modalPairs[i].left = left.value;
                    if (right) examManager._modalPairs[i].right = right.value;
                }
            });
        }
    },

    _renderModalOptions: () => {
        const type = examManager._modalType;
        const container = document.getElementById('modal-options-list');
        const addOptBtn = document.getElementById('modal-add-option-btn');
        const optsContainer = document.getElementById('modal-options-container');
        if (!container) return;
        container.innerHTML = '';

        // Update label
        const label = optsContainer?.querySelector('label');

        if (type === 'mcq' || type === 'image_mcq') {
            if (label) label.textContent = 'ANSWER OPTIONS';
            if (addOptBtn) addOptBtn.style.display = 'inline-flex';
            examManager._modalOptions.forEach((opt, idx) => {
                const div = document.createElement('div');
                div.className = 'answer-option';
                div.innerHTML = `
                    <input type="radio" name="modal_correct" ${opt.isCorrect ? 'checked' : ''} title="Mark as correct">
                    <textarea class="form-control auto-expand" placeholder="Option ${idx + 1}" rows="1">${opt.text}</textarea>
                    ${examManager._modalOptions.length > 2 ? '<button type="button" class="ghost-cta ghost-cta-danger" title="Remove option" style="--cta-color: #EA4335;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>' : ''}
                `;
                const radio = div.querySelector('input[type="radio"]');
                radio.onchange = () => {
                    examManager._modalOptions.forEach(o => o.isCorrect = false);
                    opt.isCorrect = true;
                };
                const textarea = div.querySelector('textarea');
                textarea.oninput = (e) => {
                    opt.text = e.target.value;
                    examManager.autoExpand(e.target);
                };
                setTimeout(() => examManager.autoExpand(textarea), 0);
                if (examManager._modalOptions.length > 2) {
                    div.querySelector('button').onclick = () => {
                        examManager._modalOptions = examManager._modalOptions.filter(o => o.id !== opt.id);
                        examManager._renderModalOptions();
                    };
                }
                container.appendChild(div);
            });
        } else if (type === 'true_false') {
            if (label) label.textContent = 'ANSWER OPTIONS';
            if (addOptBtn) addOptBtn.style.display = 'none';
            // Ensure we have True/False options
            if (examManager._modalOptions.length !== 2 || examManager._modalOptions[0].text !== 'True') {
                examManager._modalOptions = [
                    { id: 'opt_true', text: 'True', isCorrect: true },
                    { id: 'opt_false', text: 'False', isCorrect: false }
                ];
            }
            examManager._modalOptions.forEach(opt => {
                const div = document.createElement('div');
                div.className = 'answer-option';
                div.innerHTML = `
                    <input type="radio" name="modal_correct" ${opt.isCorrect ? 'checked' : ''}>
                    <span style="font-weight:600;">${opt.text}</span>
                `;
                div.querySelector('input').onchange = () => {
                    examManager._modalOptions.forEach(o => o.isCorrect = false);
                    opt.isCorrect = true;
                };
                container.appendChild(div);
            });
        } else if (type === 'fill_blank') {
            if (label) label.textContent = 'CORRECT ANSWER';
            if (addOptBtn) addOptBtn.style.display = 'none';
            const val = (examManager._modalOptions[0]?.text) ||
                        (examManager._editingQuestionId ? (examManager.questions.find(q => q.id === examManager._editingQuestionId)?.correctAnswer || '') : '');
            const div = document.createElement('div');
            div.innerHTML = `
                <textarea class="form-control auto-expand" placeholder="e.g. Paris" rows="1">${val}</textarea>
            `;
            const textarea = div.querySelector('textarea');
            textarea.oninput = (e) => {
                if (!examManager._modalOptions[0]) examManager._modalOptions[0] = { text: '' };
                examManager._modalOptions[0].text = e.target.value;
                examManager.autoExpand(e.target);
            };
            setTimeout(() => examManager.autoExpand(textarea), 0);
            container.appendChild(div);
        } else if (type === 'match') {
            if (label) label.textContent = 'MATCHING PAIRS';
            if (addOptBtn) {
                addOptBtn.style.display = 'inline-flex';
                addOptBtn.textContent = '+ Add Pair';
                addOptBtn.onclick = () => {
                    examManager._modalPairs.push({ left: '', right: '' });
                    examManager._renderModalOptions();
                };
            }
            const headDiv = document.createElement('div');
            headDiv.innerHTML = `<div style="display:flex; justify-content:space-between; margin-bottom:5px; font-weight:bold; font-size:0.85rem; color:var(--light-text);"><span style="flex:1">Left Item</span><span style="width:20px"></span><span style="flex:1">Right Item</span></div>`;
            container.appendChild(headDiv);

            examManager._modalPairs.forEach((pair, pIdx) => {
                const pairDiv = document.createElement('div');
                pairDiv.className = 'answer-option';
                pairDiv.style.alignItems = 'center';
                pairDiv.innerHTML = `
                    <textarea class="form-control auto-expand left-item" placeholder="Left Item" rows="1" style="flex:1;">${pair.left}</textarea>
                    <span style="font-weight: bold;">=</span>
                    <textarea class="form-control auto-expand right-item" placeholder="Right Item" rows="1" style="flex:1;">${pair.right}</textarea>
                    <button type="button" class="btn" style="color:var(--accent-color); padding: 5px 10px; min-width: auto;">&#10005;</button>
                `;
                pairDiv.querySelector('.left-item').oninput = (e) => { pair.left = e.target.value; examManager.autoExpand(e.target); };
                pairDiv.querySelector('.right-item').oninput = (e) => { pair.right = e.target.value; examManager.autoExpand(e.target); };
                pairDiv.querySelector('button').onclick = () => {
                    examManager._modalPairs = examManager._modalPairs.filter((_, i) => i !== pIdx);
                    examManager._renderModalOptions();
                };
                container.appendChild(pairDiv);
            });
        } else if (type === 'image_multi') {
            if (label) label.textContent = 'SUB-QUESTIONS';
            if (addOptBtn) addOptBtn.style.display = 'none';

            // Number selector
            const numDiv = document.createElement('div');
            numDiv.style.marginBottom = '12px';
            const currentCount = examManager._modalSubQuestions.length || 5;
            numDiv.innerHTML = `
                <label style="font-size:0.85rem; font-weight:600; display:block; margin-bottom:4px;">Number of Questions</label>
                <select class="form-control" style="width: 80px;">${Array.from({length:100}, (_, i) => i+1).map(n => `<option value="${n}" ${currentCount === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
            `;
            numDiv.querySelector('select').onchange = (e) => {
                const newCount = parseInt(e.target.value);
                while (examManager._modalSubQuestions.length < newCount) {
                    examManager._modalSubQuestions.push({ id: Utils.generateId(), number: examManager._modalSubQuestions.length + 1, correctAnswer: '' });
                }
                if (newCount < examManager._modalSubQuestions.length) {
                    examManager._modalSubQuestions = examManager._modalSubQuestions.slice(0, newCount);
                }
                examManager._renderModalOptions();
            };
            container.appendChild(numDiv);

            // Initialize sub-questions if empty
            if (examManager._modalSubQuestions.length === 0) {
                for (let i = 1; i <= 5; i++) {
                    examManager._modalSubQuestions.push({ id: Utils.generateId(), number: i, correctAnswer: '' });
                }
            }

            examManager._modalSubQuestions.forEach(subQ => {
                const subDiv = document.createElement('div');
                subDiv.className = 'sub-question-row';
                subDiv.innerHTML = `
                    <span class="sub-question-label">Q ${subQ.number}:</span>
                    <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                        ${['A','B','C','D','E'].map(opt => `
                            <label style="display:flex; align-items:center; gap:4px; cursor:pointer; padding:5px 10px; border-radius:6px; border:1px solid var(--border-color); ${subQ.correctAnswer === opt ? 'background:var(--success-color); color:white; border-color:var(--success-color);' : 'background:var(--card-bg);'}">
                                <input type="radio" name="modal_subq_${subQ.id}" value="${opt}" ${subQ.correctAnswer === opt ? 'checked' : ''} style="cursor:pointer; width:14px; height:14px;">
                                <span style="font-weight:600; font-size:0.85rem;">${opt}</span>
                            </label>
                        `).join('')}
                    </div>
                `;
                subDiv.querySelectorAll('input[type="radio"]').forEach(radio => {
                    radio.onchange = () => {
                        subQ.correctAnswer = radio.value;
                        examManager._renderModalOptions();
                    };
                });
                container.appendChild(subDiv);
            });
        } else if (type === 'theory') {
            if (optsContainer) optsContainer.style.display = 'none';
        }

        // Reset add option btn for mcq — preserve ghost CTA icon
        if (addOptBtn && (type === 'mcq' || type === 'image_mcq')) {
            addOptBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add Option';
            addOptBtn.onclick = () => { examManager.addModalOption(); };
        }
    },

    addModalOption: () => {
        examManager._modalOptions.push({ id: Utils.generateId(), text: '', isCorrect: false });
        examManager._renderModalOptions();
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

    openImportModal: async () => {
        // Warn teacher if they're editing an already-saved exam
        if (examManager.currentExamId) {
            const examTitle = document.getElementById('exam-title')?.value || 'this exam';
            const proceed = await Utils.showConfirm(
                'Adding to Existing Exam',
                `You are in edit mode for "${examTitle}".\n\nImported questions will be added to this exam. Do you want to continue?`
            );
            if (!proceed) return;
        }
        document.getElementById('import-modal').style.display = 'block';
        document.body.classList.add('import-modal-open');
        // Reset both editor and fallback textarea to a clean state
        const mountEl = document.getElementById('import-canvas-mount');
        const ta = document.getElementById('import-textarea');
        if (mountEl) { mountEl.style.display = ''; mountEl.innerHTML = ''; }
        if (ta) { ta.style.display = 'none'; ta.value = ''; }
        // Retry until TiptapEditor is ready — CDN module may still be loading on first open.
        // If all retries fail, reveal the textarea as a fallback.
        function tryInitEditor(attemptsLeft) {
            if (mountEl && window.TiptapEditor) {
                examManager.importCanvasInstance = window.TiptapEditor.create(mountEl, 'bulk-import');
            } else if (attemptsLeft > 0) {
                setTimeout(() => tryInitEditor(attemptsLeft - 1), 300);
            } else {
                // Tiptap failed to load — show plain textarea fallback
                if (mountEl) mountEl.style.display = 'none';
                if (ta) { ta.style.display = 'block'; ta.focus(); }
            }
        }
        setTimeout(() => tryInitEditor(10), 100); // retries every 300ms, up to ~3s
    },

    closeImportModal: () => {
        document.getElementById('import-modal').style.display = 'none';
        document.body.classList.remove('import-modal-open');
        if (examManager.importCanvasInstance) {
            window.TiptapEditor.destroyInstance('bulk-import');
            examManager.importCanvasInstance = null;
        }
        const mountEl = document.getElementById('import-canvas-mount');
        if (mountEl) { mountEl.innerHTML = ''; mountEl.style.display = ''; }
        const ta = document.getElementById('import-textarea');
        if (ta) { ta.value = ''; ta.style.display = 'none'; }
        const importPointsInput = document.getElementById('import-points');
        if (importPointsInput) importPointsInput.value = '0.5';
    },

    // ========== INSTRUCTION MANAGEMENT ==========
    // Instructions are stored as q.topInstruction on the question object itself,
    // so they travel with the questions array through PocketBase without needing
    // a separate DB field.

    // Helper: returns sorted questions array (objective first, then theory)
    _getSortedQuestions: () => {
        const obj = examManager.questions.filter(q => q.type !== 'theory');
        const th = examManager.questions.filter(q => q.type === 'theory');
        return [...obj, ...th];
    },

    addInstruction: async () => {
        const textEl = document.getElementById('instruction-text-input');
        const fromEl = document.getElementById('instruction-from-input');
        const toEl   = document.getElementById('instruction-to-input');
        const text   = textEl?.value.trim();
        const fromQ  = parseInt(fromEl?.value, 10);
        const toRaw  = toEl?.value.trim();
        const toQ    = toRaw ? parseInt(toRaw, 10) : fromQ;

        const sortedQs = examManager._getSortedQuestions();
        const totalQ   = sortedQs.length;

        if (!text) {
            await Utils.showAlert('Missing Text', 'Please enter an instruction text.');
            return;
        }
        if (!fromQ || fromQ < 1 || fromQ > totalQ) {
            await Utils.showAlert('Invalid Question #', `"From" must be between 1 and ${totalQ || '?'}.`);
            return;
        }
        if (toQ < fromQ || toQ > totalQ) {
            await Utils.showAlert('Invalid Range', `"To" must be between ${fromQ} and ${totalQ}.`);
            return;
        }

        // Apply instruction to each question in the range
        for (let n = fromQ; n <= toQ; n++) {
            sortedQs[n - 1].topInstruction = text;
        }

        if (textEl) textEl.value = '';
        if (fromEl) fromEl.value = '';
        if (toEl)   toEl.value   = '';
        examManager.renderInstructionsList();
        examManager.renderQuestions();
    },

    removeInstruction: (qId) => {
        const q = examManager.questions.find(q => q.id === qId);
        if (q) delete q.topInstruction;
        examManager.renderInstructionsList();
        examManager.renderQuestions();
    },

    renderInstructionsList: () => {
        const container = document.getElementById('instructions-list');
        if (!container) return;
        const sortedQs = examManager._getSortedQuestions();
        const withInstr = sortedQs.map((q, i) => ({ q, n: i + 1 })).filter(({ q }) => q.topInstruction);
        if (withInstr.length === 0) { container.innerHTML = ''; return; }
        container.innerHTML = withInstr.map(({ q, n }) => `
            <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--card-bg);border-radius:6px;font-size:0.85rem;border:1px solid var(--border-color);">
                <span style="font-weight:600;white-space:nowrap;color:var(--primary-color);">Q${n}:</span>
                <span style="flex:1;font-style:italic;">${escHtml(q.topInstruction)}</span>
                <button type="button" class="btn" style="padding:2px 10px;font-size:0.78rem;flex-shrink:0;"
                    onclick="examManager.removeInstruction('${q.id}')">Remove</button>
            </div>
        `).join('');
    },

    // ========== BULK IMPORT ==========

    processBulkImport: async () => {
        // Get text from Tiptap editor if available, otherwise fallback textarea
        let text = '';
        const wp = examManager.importCanvasInstance;
        if (wp && !wp.isEmpty()) {
            text = wp.getPlainText();
        } else {
            const ta = document.getElementById('import-textarea');
            if (ta && ta.style.display !== 'none') text = ta.value;
        }
        if (!text || !text.trim()) {
            await Utils.showAlert('Empty Editor', 'Please type or paste your questions into the editor above.');
            return;
        }

        // Get points value from import modal (default to 0.5)
        const importPointsInput = document.getElementById('import-points');
        const importPoints = importPointsInput ? parseFloat(importPointsInput.value) || 0.5 : 0.5;

        // ===== BulkImportParser-based parsing =====
        if (!window.BulkImportParser) {
            await Utils.showAlert('Parser Error', 'Bulk import parser not loaded. Please refresh the page.');
            return;
        }

        const parsed = window.BulkImportParser.parse(text);
        let addedCount = 0;

        parsed.forEach(q => {
            if (q.type === 'objective' && q.options && q.options.length > 0) {
                // Convert parser options (no id/isCorrect) to app format
                const appOptions = q.options.map(opt => ({
                    id: Utils.generateId(),
                    text: opt.text,
                    isCorrect: false
                }));
                examManager.questions.push({
                    id: Utils.generateId(),
                    type: 'mcq',
                    text: q.text,
                    canvasJSON: null,
                    canvasImage: null,
                    options: appOptions,
                    points: importPoints
                });
                addedCount++;
            } else if (q.type === 'theory' && q.text.trim()) {
                examManager.questions.push({
                    id: Utils.generateId(),
                    type: 'theory',
                    text: q.text,
                    canvasJSON: null,
                    canvasImage: null,
                    points: importPoints
                });
                addedCount++;
            }
        });

        if (addedCount > 0) {
            examManager.renderQuestions();
            examManager.closeImportModal();
            await Utils.showAlert('Success', `Successfully imported ${addedCount} questions.`);
        } else {
            await Utils.showAlert('Import Error', 'Could not detect any valid questions.\n\nSupported formats:\n\nObjective (with options):\n1. Question text\n   (a) Option 1\n   (b) Option 2\n\n   or inline: 1. Question (a) opt1 (b) opt2\n\nTheory (no options):\n1. Question text\n   a. Sub-question\n   b. Sub-question\n      i. Detail\n      ii. Detail');
        }
    },

    renderQuestions: () => {
        const container = document.getElementById('questions-container');
        const noQuestionsMsg = document.getElementById('no-questions-msg');
        const instructionPanel = document.getElementById('instruction-panel');

        if (examManager.questions.length === 0) {
            if (noQuestionsMsg) noQuestionsMsg.style.display = 'block';
            if (instructionPanel) instructionPanel.style.display = 'none';
            container.innerHTML = '';
            return;
        }

        if (noQuestionsMsg) noQuestionsMsg.style.display = 'none';
        if (instructionPanel) instructionPanel.style.display = 'block';

        // Separate objective and theory questions
        const objectiveQuestions = examManager.questions.filter(q => q.type !== 'theory');
        const theoryQuestions = examManager.questions.filter(q => q.type === 'theory');
        const sortedQuestions = [...objectiveQuestions, ...theoryQuestions];

        container.innerHTML = '';

        // Section headers
        if (objectiveQuestions.length > 0 && theoryQuestions.length > 0) {
            const objHeader = document.createElement('div');
            objHeader.className = 'question-section-divider';
            objHeader.innerHTML = '<h3>Section A: Objective Questions</h3>';
            container.appendChild(objHeader);
        }

        sortedQuestions.forEach((q, index) => {
            // Theory section header
            if (index === objectiveQuestions.length && theoryQuestions.length > 0) {
                const thHeader = document.createElement('div');
                thHeader.className = 'question-section-divider theory';
                thHeader.innerHTML = '<h3>Section B: Theory Questions</h3>';
                container.appendChild(thHeader);
            }

            // Instruction banner
            if (q.topInstruction) {
                const bannerEl = document.createElement('div');
                bannerEl.className = 'question-instruction-banner';
                bannerEl.innerHTML = `<span style="flex:1;">${escHtml(q.topInstruction)}</span>`;
                container.appendChild(bannerEl);
            }

            // Display number
            let displayNumber = q.type === 'theory'
                ? (index - objectiveQuestions.length) + 1
                : index + 1;

            // Get question preview text
            let previewText = q.text || '';
            if (previewText === '[Canvas Content]' && q.canvasJSON) {
                // Try to extract text from Tiptap JSON
                try {
                    const extractText = (node) => {
                        if (!node) return '';
                        if (node.text) return node.text;
                        if (node.content) return node.content.map(extractText).join(' ');
                        return '';
                    };
                    previewText = extractText(q.canvasJSON).trim() || '[Rich Content]';
                } catch (e) {
                    previewText = '[Rich Content]';
                }
            }
            if (!previewText) previewText = '(No content yet)';
            if (previewText.length > 80) previewText = previewText.substring(0, 80) + '...';

            // Type label
            const typeLabel = examManager._typeLabels[q.type] || q.type;

            // Options info
            let optionsInfo = '';
            if (q.type === 'mcq' || q.type === 'image_mcq') {
                const count = q.options ? q.options.length : 0;
                const hasCorrect = q.options ? q.options.some(o => o.isCorrect) : false;
                optionsInfo = `${count} options${hasCorrect ? '' : ' (no correct answer)'}`;
            } else if (q.type === 'true_false') {
                optionsInfo = 'True/False';
            } else if (q.type === 'fill_blank') {
                optionsInfo = q.correctAnswer ? 'Answer set' : 'No answer set';
            } else if (q.type === 'match') {
                optionsInfo = `${(q.pairs || []).length} pairs`;
            } else if (q.type === 'image_multi') {
                optionsInfo = `${(q.subQuestions || []).length} sub-questions`;
            } else if (q.type === 'theory') {
                optionsInfo = 'Manual grading';
            }

            // Attached media count
            const mediaCount = examManager.getMediaForQuestion(q.id).length;
            const mediaInfo = mediaCount > 0 ? ` | ${mediaCount} media` : '';

            // Build summary card
            const card = document.createElement('div');
            card.className = 'question-summary-card';
            card.dataset.id = q.id;
            card.onclick = () => examManager.openAddQuestionModal(q.id);
            card.innerHTML = `
                <div class="question-number-badge">${displayNumber}</div>
                <div class="question-summary-text">
                    <span class="question-type-pill">${escHtml(typeLabel)}</span>
                    <span class="q-preview">${escHtml(previewText)}</span>
                    <span class="q-meta">
                        <span class="points-badge">${q.points} pts</span>
                        <span>${escHtml(optionsInfo)}${mediaInfo}</span>
                    </span>
                </div>
                <div class="question-summary-actions" onclick="event.stopPropagation();">
                    <button type="button" class="ghost-cta" style="--cta-color: var(--primary-color);" title="Edit" onclick="examManager.openAddQuestionModal('${q.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button type="button" class="ghost-cta ghost-cta-danger" title="Remove" onclick="examManager.removeQuestion('${q.id}')">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                        Remove
                    </button>
                </div>
            `;
            container.appendChild(card);
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

        const scrambleYesRadio = document.getElementById('exam-scramble-yes');
        const scrambleQuestions = scrambleYesRadio ? scrambleYesRadio.checked : false;

        // Theory section instructions
        const theoryInstructionsInput = document.getElementById('exam-theory-instructions');
        const theoryInstructions = theoryInstructionsInput ? theoryInstructionsInput.value : '';

        // Editor data is now harvested when saving from the Add/Edit Question modal
        // No active inline Tiptap editors to harvest here

        // Validate Questions
        let valid = true;
        for (let i = 0; i < examManager.questions.length; i++) {
            const q = examManager.questions[i];
            if (!q.canvasJSON && !q.canvasImage && !q.text.trim()) {
                await Utils.showAlert('Validation Error', `Question ${i + 1} is missing content. Please add text or shapes to the editor.`);
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
        const submitBtn = document.getElementById('publish-exam-btn') || document.querySelector('.create-exam-card-footer .btn-primary') || document.querySelector('button[type="submit"]');
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
        addQuestionBtn.addEventListener('click', () => examManager.openAddQuestionModal());
    }

    const form = document.getElementById('create-exam-form');
    if (form) {
        form.addEventListener('submit', examManager.saveExam);
    }

    // Modal type selector buttons
    const typeSelector = document.getElementById('modal-type-selector');
    if (typeSelector) {
        typeSelector.addEventListener('click', (e) => {
            const btn = e.target.closest('.type-btn');
            if (!btn) return;
            // Harvest current options before switching
            examManager._harvestModalOptions();
            examManager._modalType = btn.dataset.type;
            examManager._updateModalTypeButtons();
            examManager._renderModalOptions();
        });
    }
});
