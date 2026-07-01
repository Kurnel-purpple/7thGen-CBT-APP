(function() {
    'use strict';

    const state = {
        academic: null,
        questions: [],
        filteredQuestions: [],
        selectedIds: new Set(),
        fallbackQuestions: [],
        lastGeneratedPick: [],
        lastGeneratedCriteria: null,
        filters: {
            subject: '',
            targetClass: '',
            difficulty: '',
            term: ''
        }
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function difficultyLabel(d) {
        if (d === 'easy') return 'Easy';
        if (d === 'hard') return 'Hard';
        return 'Medium';
    }

    function renderBadges(question) {
        let html = '';
        if (question.difficulty) {
            html += `<span class="qb-badge qb-badge-difficulty" data-difficulty="${escapeHtml(question.difficulty)}">${escapeHtml(difficultyLabel(question.difficulty))}</span>`;
        }
        if (question.term) {
            html += `<span class="qb-badge qb-badge-term">${escapeHtml(question.term)}</span>`;
        }
        if (Array.isArray(question.tags) && question.tags.length > 0) {
            question.tags.forEach(function(tag) {
                if (tag) html += `<span class="qb-badge qb-badge-tag">${escapeHtml(tag)}</span>`;
            });
        }
        return html;
    }

    function updateQuestionCount() {
        const el = document.getElementById('qb-question-count');
        if (!el) return;
        const total = state.questions.length;
        const shown = state.filteredQuestions.length;
        if (total === 0) {
            el.textContent = '';
        } else if (shown === total) {
            el.textContent = `${total} question${total !== 1 ? 's' : ''}`;
        } else {
            el.textContent = `${shown} of ${total}`;
        }
    }

    function renderQuestions(questions) {
        const list = document.getElementById('question-bank-sample-list');
        if (!list) return;

        if (!questions.length) {
            list.innerHTML = '<p style="margin:0; color:var(--light-text);">No questions match your filters. Try adjusting the filters above or add a new question.</p>';
            updateQuestionCount();
            return;
        }

        list.innerHTML = questions.map(function(question) {
            const typeLine = [
                (question.type || 'mcq').toUpperCase(),
                question.subject || 'No subject',
                question.targetClass || 'All'
            ].join(' | ');

            return `
            <article class="qb-question-card">
                <label class="qb-question-index" style="cursor:pointer;">
                    <input type="checkbox" data-question-id="${escapeHtml(question.id)}" ${state.selectedIds.has(question.id) ? 'checked' : ''} />
                </label>
                <div class="qb-question-body" style="flex:1; min-width:0;">
                    <div class="qb-question-type">${escapeHtml(typeLine)}</div>
                    <p class="qb-question-text">${escapeHtml(question.text)}</p>
                    <div class="qb-meta-row">${renderBadges(question)}</div>
                </div>
                <button class="ghost-cta ghost-cta-danger qb-delete-btn" data-delete-id="${escapeHtml(question.id)}" title="Delete question">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                </button>
            </article>`;
        }).join('');

        list.querySelectorAll('input[type="checkbox"][data-question-id]').forEach(function(input) {
            input.addEventListener('change', function() {
                var id = input.getAttribute('data-question-id');
                if (!id) return;
                if (input.checked) state.selectedIds.add(id);
                else state.selectedIds.delete(id);
                updateDeleteSelectedVisibility();
            });
        });

        list.querySelectorAll('.qb-delete-btn[data-delete-id]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var id = btn.getAttribute('data-delete-id');
                if (!id) return;
                deleteQuestion(id);
            });
        });

        updateQuestionCount();
    }

    function updateDeleteSelectedVisibility() {
        var btn = document.getElementById('qb-delete-selected-btn');
        if (!btn) return;
        if (state.selectedIds.size > 0) {
            btn.style.display = 'inline-flex';
            btn.querySelector('.qb-delete-count').textContent = state.selectedIds.size;
        } else {
            btn.style.display = 'none';
        }
    }

    async function deleteQuestion(id) {
        if (!confirm('Delete this question from the bank?')) return;
        try {
            await window.dataService.deleteQuestionBankQuestion(id);
            state.selectedIds.delete(id);
            await refreshQuestions();
            updateDeleteSelectedVisibility();
        } catch (err) {
            console.error('[QuestionBank] delete failed:', err);
            alert('Failed to delete question.');
        }
    }

    async function deleteSelectedQuestions() {
        var ids = Array.from(state.selectedIds);
        if (ids.length === 0) return;
        if (!confirm('Delete ' + ids.length + ' selected question' + (ids.length !== 1 ? 's' : '') + '?')) return;

        try {
            var result = await window.dataService.deleteQuestionBankQuestions(ids);
            state.selectedIds.clear();
            await refreshQuestions();
            updateDeleteSelectedVisibility();
            if (result.failed > 0) {
                alert('Deleted ' + result.deleted + ', but ' + result.failed + ' failed.');
            }
        } catch (err) {
            console.error('[QuestionBank] bulk delete failed:', err);
            alert('Failed to delete questions.');
        }
    }

    function applyFilters() {
        var f = state.filters;
        state.filteredQuestions = state.questions.filter(function(q) {
            if (f.subject && q.subject !== f.subject) return false;
            if (f.targetClass && q.targetClass !== f.targetClass) return false;
            if (f.difficulty && q.difficulty !== f.difficulty) return false;
            if (f.term && (q.term || '') !== f.term) return false;
            return true;
        });
        renderQuestions(state.filteredQuestions);
    }

    function populateFilterDropdowns(academic) {
        var filterSubject = document.getElementById('qb-filter-subject');
        var filterClass = document.getElementById('qb-filter-class');

        if (filterSubject && academic) {
            var allSubjects = [];
            Object.values(academic.subjectsByLevel || {}).forEach(function(list) {
                list.forEach(function(s) {
                    if (allSubjects.indexOf(s) === -1) allSubjects.push(s);
                });
            });
            allSubjects.sort();
            filterSubject.innerHTML = '<option value="">All</option>' + allSubjects.map(function(s) {
                return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
            }).join('');
        }

        if (filterClass && academic) {
            var allClasses = [];
            Object.values(academic.classesByLevel || {}).forEach(function(list) {
                list.forEach(function(c) { allClasses.push(c); });
            });
            filterClass.innerHTML = '<option value="">All</option>' + allClasses.map(function(c) {
                return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>';
            }).join('');
        }
    }

    function bindFilterControls() {
        var ids = {
            'qb-filter-subject': 'subject',
            'qb-filter-class': 'targetClass',
            'qb-filter-difficulty': 'difficulty',
            'qb-filter-term': 'term'
        };

        Object.keys(ids).forEach(function(elId) {
            var el = document.getElementById(elId);
            if (!el) return;
            var key = ids[elId];
            var eventName = el.tagName === 'SELECT' ? 'change' : 'input';
            el.addEventListener(eventName, function() {
                state.filters[key] = el.value;
                applyFilters();
            });
        });
    }

    function populateAcademicFields(academic) {
        var subjectSelect = document.getElementById('qb-subject');
        var classSelect = document.getElementById('qb-target-class');
        var levelSelect = document.getElementById('qb-school-level');

        if (levelSelect) {
            levelSelect.innerHTML = '<option value="secondary">Secondary</option><option value="primary">Primary</option>';
        }

        function updateDependentFields(level) {
            var subjects = academic.subjectsByLevel?.[level] || [];
            var classes = academic.classesByLevel?.[level] || [];

            if (subjectSelect) {
                subjectSelect.innerHTML = '<option value="">Select subject</option>' + subjects.map(function(subject) {
                    return '<option value="' + escapeHtml(subject) + '">' + escapeHtml(subject) + '</option>';
                }).join('');
            }

            if (classSelect) {
                classSelect.innerHTML = '<option value="All">All Classes</option>' + classes.map(function(item) {
                    return '<option value="' + escapeHtml(item.value) + '">' + escapeHtml(item.text) + '</option>';
                }).join('');
            }
        }

        if (levelSelect) {
            levelSelect.addEventListener('change', function() { updateDependentFields(levelSelect.value); });
            updateDependentFields(levelSelect.value || 'secondary');
        }
    }

    function parseTags(raw) {
        if (!raw) return [];
        return raw.split(',').map(function(t) { return t.trim(); }).filter(Boolean);
    }

    async function refreshQuestions() {
        var ctx = window.dataService.getSchoolContext() || {};
        state.questions = await window.dataService.getQuestionBankQuestions({
            createdBy: ctx.userId
        });
        applyFilters();
    }

    function getSelectedQuestions() {
        var source = state.filteredQuestions.length ? state.filteredQuestions : (state.questions.length ? state.questions : state.fallbackQuestions);
        if (state.selectedIds.size === 0) {
            return source;
        }
        return source.filter(function(question) { return state.selectedIds.has(question.id); });
    }

    async function seedExam(questions, title) {
        var questionBankService = window.__moduleLoader?.getModuleService('question_bank');
        if (!questionBankService) {
            throw new Error('Question Bank service is unavailable.');
        }

        var defaultLevel = document.getElementById('qb-school-level')?.value || 'secondary';
        var defaultClass = document.getElementById('qb-target-class')?.value || 'All';
        var defaultSubject = document.getElementById('qb-subject')?.value || '';
        var defaultTerm = document.getElementById('qb-term')?.value || '';

        // Save questions to QB store so they appear in the Saved Questions list
        if (window.dataService?.createQuestionBankQuestion) {
            for (var i = 0; i < questions.length; i++) {
                var q = questions[i];
                // Skip questions that are already persisted QB records (have a real/local id)
                if (q.id && !String(q.id).startsWith('sample-')) continue;
                try {
                    await window.dataService.createQuestionBankQuestion({
                        text: q.text || '',
                        type: q.type || 'mcq',
                        subject: q.subject || defaultSubject,
                        schoolLevel: q.schoolLevel || defaultLevel,
                        targetClass: q.targetClass || defaultClass,
                        term: q.term || defaultTerm,
                        difficulty: q.difficulty || 'medium',
                        points: q.points || 1,
                        options: Array.isArray(q.options) ? q.options : [],
                        answer: q.answer || '',
                        explanation: q.explanation || '',
                        tags: Array.isArray(q.tags) ? q.tags : [],
                        source: 'seed_import'
                    });
                } catch (err) {
                    console.warn('[QuestionBank] Failed to save seeded question ' + (i + 1) + ' to QB:', err);
                }
            }
        }

        await questionBankService.seedExamFromQuestions({
            title: defaultTerm || title || '',
            subject: defaultSubject,
            schoolLevel: defaultLevel,
            targetClass: defaultClass,
            questions: questions
        });
    }

    function shuffle(arr) {
        var a = arr.slice();
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
        }
        return a;
    }

    function populateGeneratorDropdowns(academic) {
        var genSubject = document.getElementById('qb-gen-subject');
        var genClass = document.getElementById('qb-gen-class');

        if (genSubject && academic) {
            var allSubjects = [];
            Object.values(academic.subjectsByLevel || {}).forEach(function(list) {
                list.forEach(function(s) {
                    if (allSubjects.indexOf(s) === -1) allSubjects.push(s);
                });
            });
            allSubjects.sort();
            genSubject.innerHTML = '<option value="">Select subject</option>' + allSubjects.map(function(s) {
                return '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>';
            }).join('');
        }

        if (genClass && academic) {
            var allClasses = [];
            Object.values(academic.classesByLevel || {}).forEach(function(list) {
                list.forEach(function(c) { allClasses.push(c); });
            });
            genClass.innerHTML = '<option value="All">All Classes</option>' + allClasses.map(function(c) {
                return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>';
            }).join('');
        }
    }

    var TYPE_LABELS = {
        mcq: 'Multiple Choice',
        true_false: 'True / False',
        fill_blank: 'Fill in the Blank',
        theory: 'Theory',
        image_mcq: 'Image MCQ',
        image_multi: 'Picture Comprehension',
        match: 'Matching'
    };

    function updateGenTotal() {
        var total = 0;
        document.querySelectorAll('input[name="qb-gen-type"]').forEach(function(cb) {
            if (!cb.checked) return;
            var countInput = document.querySelector('input[data-gen-type-count="' + cb.value + '"]');
            var n = countInput ? parseInt(countInput.value, 10) : 0;
            if (!isNaN(n) && n > 0) total += n;
        });
        var totalEl = document.getElementById('qb-gen-total-count');
        var pluralEl = document.getElementById('qb-gen-total-plural');
        if (totalEl) totalEl.textContent = String(total);
        if (pluralEl) pluralEl.textContent = total === 1 ? '' : 's';
    }

    function bindGenTypeQuotaControls() {
        document.querySelectorAll('input[name="qb-gen-type"]').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var countInput = document.querySelector('input[data-gen-type-count="' + cb.value + '"]');
                if (!countInput) return;
                if (cb.checked) {
                    countInput.disabled = false;
                    var current = parseInt(countInput.value, 10);
                    if (isNaN(current) || current < 1) {
                        countInput.value = '5';
                    }
                    countInput.focus();
                    countInput.select();
                } else {
                    countInput.disabled = true;
                    countInput.value = '0';
                }
                updateGenTotal();
            });
        });

        document.querySelectorAll('input.qb-gen-type-count').forEach(function(input) {
            input.addEventListener('input', function() {
                var type = input.getAttribute('data-gen-type-count');
                var cb = document.querySelector('input[name="qb-gen-type"][value="' + type + '"]');
                var n = parseInt(input.value, 10);
                if (cb) {
                    if (!isNaN(n) && n > 0 && !cb.checked) {
                        cb.checked = true;
                        input.disabled = false;
                    } else if ((isNaN(n) || n <= 0) && cb.checked) {
                        cb.checked = false;
                        input.disabled = true;
                    }
                }
                updateGenTotal();
            });
        });

        updateGenTotal();
    }

    function getGenCriteria() {
        var subject = document.getElementById('qb-gen-subject')?.value || '';
        var targetClass = document.getElementById('qb-gen-class')?.value || 'All';

        var selectedTerms = [];
        document.querySelectorAll('input[name="qb-gen-term"]:checked').forEach(function(cb) {
            selectedTerms.push(cb.value);
        });

        var typeQuotas = [];
        document.querySelectorAll('input[name="qb-gen-type"]:checked').forEach(function(cb) {
            var type = cb.value;
            var countInput = document.querySelector('input[data-gen-type-count="' + type + '"]');
            var count = countInput ? parseInt(countInput.value, 10) : 0;
            if (isNaN(count) || count < 1) return;
            typeQuotas.push({ type: type, count: count });
        });

        var total = typeQuotas.reduce(function(sum, q) { return sum + q.count; }, 0);
        return {
            subject: subject,
            targetClass: targetClass,
            selectedTerms: selectedTerms,
            typeQuotas: typeQuotas,
            count: total
        };
    }

    function validateCriteria(c) {
        if (!c.subject) { alert('Please select a subject.'); return false; }
        if (c.selectedTerms.length === 0) { alert('Please select at least one term.'); return false; }
        if (c.typeQuotas.length === 0) {
            alert('Tick at least one question type and set how many of it you want.');
            return false;
        }
        if (c.count < 1 || c.count > 200) {
            alert('Total questions must be between 1 and 200.');
            return false;
        }
        return true;
    }

    async function pickQuestions(criteria) {
        var ctx = window.dataService.getSchoolContext() || {};
        var allQuestions = await window.dataService.getQuestionBankQuestions({
            createdBy: ctx.userId
        });

        var base = allQuestions.filter(function(q) { return q.subject === criteria.subject; });

        if (criteria.targetClass !== 'All') {
            base = base.filter(function(q) {
                return q.targetClass === 'All' || q.targetClass === criteria.targetClass;
            });
        }

        base = base.filter(function(q) {
            var qTerm = (q.term || '').trim();
            if (!qTerm) return true;
            return criteria.selectedTerms.some(function(t) { return qTerm.toLowerCase() === t.toLowerCase(); });
        });

        var picked = [];
        var perType = criteria.typeQuotas.map(function(quota) {
            var typePool = base.filter(function(q) { return (q.type || 'mcq') === quota.type; });
            var chosen = shuffle(typePool).slice(0, quota.count);
            picked = picked.concat(chosen);
            return {
                type: quota.type,
                requested: quota.count,
                available: typePool.length,
                picked: chosen.length
            };
        });

        return { pool: base, picked: picked, perType: perType };
    }

    function showGenStatus(result, criteria) {
        var preview = document.getElementById('qb-gen-preview');
        if (!preview) return;
        preview.style.display = '';

        var pickedTotal = result.picked.length;
        var poolTotal = result.pool.length;
        var requestedTotal = criteria.count;

        if (poolTotal === 0) {
            preview.innerHTML = '<strong style="color:var(--accent-color);">No matching questions found.</strong> Try broadening your criteria or add more questions to the bank first.';
            return;
        }

        var rows = result.perType.map(function(t) {
            var label = TYPE_LABELS[t.type] || t.type;
            var short = t.picked < t.requested;
            var color = short ? 'var(--warning-color)' : 'var(--text-color)';
            return '<li style="color:' + color + ';">' +
                        '<strong>' + t.picked + '</strong> / ' + t.requested + ' ' + escapeHtml(label) +
                        (short ? ' <span style="font-size:0.82rem;">(only ' + t.available + ' available)</span>' : '') +
                    '</li>';
        }).join('');

        var msg = '<strong>' + pickedTotal + ' of ' + requestedTotal + ' question' + (requestedTotal !== 1 ? 's' : '') + '</strong> picked:' +
                  '<ul style="margin:6px 0 0; padding-left:20px; list-style:disc;">' + rows + '</ul>';

        if (pickedTotal < requestedTotal) {
            msg += '<div style="margin-top:6px; color:var(--warning-color); font-size:0.85rem;">Some types are short — add more questions or lower their quotas.</div>';
        }

        preview.innerHTML = msg;
    }

    function renderPreviewList(questions) {
        var panel = document.getElementById('qb-gen-exam-preview-panel');
        var list = document.getElementById('qb-gen-preview-list');
        var countEl = document.getElementById('qb-gen-preview-count');
        if (!panel || !list) return;

        panel.style.display = '';
        if (countEl) countEl.textContent = questions.length + ' question' + (questions.length !== 1 ? 's' : '');

        list.innerHTML = questions.map(function(q, i) {
            var typeLine = [(q.type || 'mcq').toUpperCase(), q.term || '', q.difficulty || ''].filter(Boolean).join(' | ');
            return '<article class="qb-question-card">' +
                '<div class="qb-question-index">' + (i + 1) + '</div>' +
                '<div style="flex:1; min-width:0;">' +
                    '<div class="qb-question-type">' + escapeHtml(typeLine) + '</div>' +
                    '<p class="qb-question-text">' + escapeHtml(q.text) + '</p>' +
                    '<div class="qb-meta-row">' + renderBadges(q) + '</div>' +
                '</div>' +
            '</article>';
        }).join('');
    }

    async function previewExam() {
        var criteria = getGenCriteria();
        if (!validateCriteria(criteria)) return;

        var result = await pickQuestions(criteria);
        showGenStatus(result, criteria);

        if (result.picked.length > 0) {
            state.lastGeneratedPick = result.picked;
            state.lastGeneratedCriteria = criteria;
            renderPreviewList(result.picked);
        }
    }

    async function generateExam() {
        var criteria = getGenCriteria();
        if (!validateCriteria(criteria)) return;

        var result = await pickQuestions(criteria);
        showGenStatus(result, criteria);

        if (result.picked.length === 0) return;

        state.lastGeneratedPick = result.picked;
        state.lastGeneratedCriteria = criteria;
        renderPreviewList(result.picked);

        // Seed the exam via the QB service
        var questionBankService = window.__moduleLoader?.getModuleService('question_bank');
        if (!questionBankService) {
            alert('Question Bank service is unavailable.');
            return;
        }

        var termLabel = criteria.selectedTerms.map(function(t) {
            return t.charAt(0).toUpperCase() + t.slice(1);
        }).join(' & ');

        var genSchoolLevel = document.getElementById('qb-school-level')?.value || 'secondary';

        await questionBankService.seedExamFromQuestions({
            title: termLabel || 'Auto-Generated',
            subject: criteria.subject,
            schoolLevel: genSchoolLevel,
            targetClass: criteria.targetClass,
            questions: result.picked
        });
    }

    async function init() {
        var user = window.dataService?.getCurrentUser?.();
        if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
            window.location.href = '../index.html';
            return;
        }

        var nameEl = document.getElementById('user-name');
        var avatarEl = document.getElementById('sidebar-avatar');
        var roleEl = document.querySelector('.sidebar-profile-role');
        if (nameEl) nameEl.textContent = user.name || user.full_name || 'Teacher';
        if (avatarEl) avatarEl.textContent = (user.name || user.full_name || 'T').charAt(0).toUpperCase();
        if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Admin' : 'Teacher';

        var academic = await window.dataService.getAcademicEntities({ includeAllClasses: true });
        state.academic = academic;
        var schoolMeta = document.getElementById('question-bank-school-meta');
        if (schoolMeta) {
            var schoolScope = academic?.school?.schoolVersion || 'No school scope';
            schoolMeta.textContent = 'School scope: ' + schoolScope;
        }

        populateAcademicFields(academic);
        populateFilterDropdowns(academic);
        populateGeneratorDropdowns(academic);
        bindGenTypeQuotaControls();
        bindFilterControls();

        var questionBankService = window.__moduleLoader?.getModuleService('question_bank');
        state.fallbackQuestions = questionBankService?.getSampleQuestions?.() || [];
        await refreshQuestions();

        var deleteSelectedBtn = document.getElementById('qb-delete-selected-btn');
        if (deleteSelectedBtn) {
            deleteSelectedBtn.onclick = async function() {
                await deleteSelectedQuestions();
            };
        }

        var seedButton = document.getElementById('seed-exam-btn');
        if (seedButton) {
            seedButton.onclick = async function() {
                try {
                    var selected = getSelectedQuestions();
                    await seedExam(selected, 'Question Bank Starter Draft');
                } catch (error) {
                    console.error('[QuestionBank] seed exam failed:', error);
                    alert(error.message || 'Unable to seed exam draft.');
                }
            };
        }

        var sampleButton = document.getElementById('seed-sample-btn');
        if (sampleButton) {
            sampleButton.onclick = async function() {
                try {
                    await seedExam(state.fallbackQuestions, 'Question Bank Sample Draft');
                } catch (error) {
                    console.error('[QuestionBank] sample seed failed:', error);
                    alert(error.message || 'Unable to seed sample exam draft.');
                }
            };
        }

        // Auto-Generate Exam — Preview button
        var previewBtn = document.getElementById('qb-gen-preview-btn');
        if (previewBtn) {
            previewBtn.onclick = async function() {
                previewBtn.disabled = true;
                previewBtn.textContent = 'Loading...';
                try {
                    await previewExam();
                } catch (error) {
                    console.error('[QuestionBank] preview failed:', error);
                    alert(error.message || 'Unable to preview questions.');
                } finally {
                    previewBtn.disabled = false;
                    previewBtn.textContent = 'Preview Questions';
                }
            };
        }

        // Auto-Generate Exam — Generate & Create Exam (form submit)
        var genForm = document.getElementById('qb-generate-form');
        if (genForm) {
            genForm.addEventListener('submit', async function(event) {
                event.preventDefault();
                var genBtn = document.getElementById('qb-gen-btn');
                if (genBtn) { genBtn.disabled = true; genBtn.textContent = 'Generating...'; }
                try {
                    await generateExam();
                } catch (error) {
                    console.error('[QuestionBank] generate exam failed:', error);
                    alert(error.message || 'Unable to generate exam.');
                } finally {
                    if (genBtn) { genBtn.disabled = false; genBtn.textContent = 'Generate & Create Exam'; }
                }
            });
        }

        var form = document.getElementById('question-bank-form');
        if (form) {
            form.addEventListener('submit', async function(event) {
                event.preventDefault();
                var submitButton = document.getElementById('save-question-btn');
                if (submitButton) submitButton.disabled = true;

                try {
                    var question = {
                        text: document.getElementById('qb-question-text')?.value || '',
                        type: 'mcq',
                        subject: document.getElementById('qb-subject')?.value || '',
                        schoolLevel: document.getElementById('qb-school-level')?.value || '',
                        targetClass: document.getElementById('qb-target-class')?.value || 'All',
                        term: document.getElementById('qb-term')?.value || '',
                        difficulty: document.getElementById('qb-difficulty')?.value || 'medium',
                        points: Number(document.getElementById('qb-points')?.value || 1),
                        options: ['A', 'B', 'C', 'D'].map(function(label) {
                            return {
                                id: label.toLowerCase(),
                                text: document.getElementById('qb-option-' + label.toLowerCase())?.value || ''
                            };
                        }),
                        answer: (document.getElementById('qb-correct-answer')?.value || '').toLowerCase(),
                        explanation: document.getElementById('qb-explanation')?.value || '',
                        tags: parseTags(document.getElementById('qb-tags')?.value)
                    };

                    await window.dataService.createQuestionBankQuestion(question);
                    form.reset();
                    populateAcademicFields(state.academic);
                    await refreshQuestions();
                    // Switch to Saved Questions view so the user sees the new question
                    var savedNav = document.querySelector('[data-qb-nav="saved"]');
                    if (typeof window.switchQbView === 'function') {
                        window.switchQbView('saved', savedNav);
                    }
                } catch (error) {
                    console.error('[QuestionBank] save failed:', error);
                    alert(error.message || 'Unable to save question.');
                } finally {
                    if (submitButton) submitButton.disabled = false;
                }
            });
        }
    }

    window.questionBank = {
        init: init
    };
})();
