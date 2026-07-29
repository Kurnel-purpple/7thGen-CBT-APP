/**
 * Question Picker Page
 *
 * A full page — not a modal — for pulling questions out of the Question Bank
 * into the exam currently being built. The builder parks its whole state in an
 * ExamSnapshot before navigating here, and picks up again when we send the
 * teacher back, so nothing typed so far is lost either way.
 *
 * Leaving via Cancel restores the exam exactly as it was; leaving via Add
 * restores it with the chosen questions appended.
 */

(function() {
    'use strict';

    var state = {
        all: [],
        selected: Object.create(null),
        snapshot: null,
        examId: null
    };

    var TYPE_LABELS = {
        mcq: 'Multiple choice', image_mcq: 'Image choice', true_false: 'True / False',
        fill_blank: 'Fill in the blank', theory: 'Theory', match: 'Matching',
        image_multi: 'Image (multi-part)'
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function plainText(value) {
        return String(value == null ? '' : value)
            .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    }

    function truncate(value, max) {
        var text = plainText(value);
        return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }

    function el(id) { return document.getElementById(id); }

    function uniqueValues(list, key) {
        var seen = Object.create(null);
        list.forEach(function(item) { if (item[key]) seen[item[key]] = true; });
        return Object.keys(seen).sort();
    }

    /**
     * @param {Array} values - plain strings, or { value, label } pairs where
     *        the stored value differs from what the teacher should read (a
     *        question's type is 'true_false' on the record but "True / False"
     *        on screen).
     */
    function fillSelect(select, values, allLabel, preset) {
        if (!select) return;
        var options = values.map(function(v) {
            return (v && typeof v === 'object') ? v : { value: v, label: v };
        });
        select.innerHTML = '<option value="">' + escapeHtml(allLabel) + '</option>'
            + options.map(function(option) {
                return '<option value="' + escapeHtml(option.value) + '">'
                    + escapeHtml(option.label) + '</option>';
            }).join('');
        var canPreset = options.some(function(option) { return option.value === preset; });
        if (preset && canPreset) select.value = preset;
    }

    /**
     * A select still sitting on its "All …" option has no value chosen, so it
     * should read quieter than one the teacher has actually set. CSS alone
     * cannot see which option is selected on a closed select, so the state is
     * mirrored onto a class.
     */
    function markPlaceholderSelects() {
        ['qp-filter-subject', 'qp-filter-term', 'qp-filter-class', 'qp-filter-type']
            .forEach(function(id) {
                var select = el(id);
                if (select) select.classList.toggle('is-placeholder', select.value === '');
            });
    }

    /** The question types actually present in the bank, labelled for reading. */
    function typeOptions(list) {
        return uniqueValues(list, 'type')
            .map(function(type) { return { value: type, label: TYPE_LABELS[type] || type }; })
            .sort(function(a, b) { return a.label.localeCompare(b.label); });
    }

    // ================================================================
    // FILTERING
    // ================================================================

    function visibleQuestions() {
        var search = plainText(el('qp-search').value).toLowerCase();
        var subject = el('qp-filter-subject').value;
        var term = el('qp-filter-term').value;
        var targetClass = el('qp-filter-class').value;
        var type = el('qp-filter-type').value;
        var hideUsed = el('qp-hide-used').checked;

        return state.all.filter(function(question) {
            if (subject && question.subject !== subject) return false;
            if (term && (question.term || '') !== term) return false;
            if (targetClass && (question.targetClass || '') !== targetClass) return false;
            if (type && (question.type || 'mcq') !== type) return false;
            if (hideUsed && question.__inExam) return false;
            if (search && plainText(question.text).toLowerCase().indexOf(search) < 0) return false;
            return true;
        });
    }

    // ================================================================
    // RENDER
    // ================================================================

    function renderList() {
        var list = visibleQuestions();
        var body = el('qp-list');

        el('qp-shown').textContent = list.length + ' of ' + state.all.length + ' shown';
        // The random pick draws from the filtered pool, so its availability
        // has to move with the filters.
        refreshRandomAvailability();
        markPlaceholderSelects();

        if (state.all.length === 0) {
            body.innerHTML = '<div class="qp-empty">'
                + '<p>There are no saved questions in the Question Bank yet.</p>'
                + '<p class="qp-empty-hint">Add some on the Question Bank page first.</p></div>';
            return;
        }
        if (list.length === 0) {
            body.innerHTML = '<div class="qp-empty">'
                + '<p>No saved questions match these filters.</p>'
                + '<p class="qp-empty-hint">Try clearing the search or widening the subject and term.</p></div>';
            return;
        }

        body.innerHTML = list.map(function(question) {
            var meta = ['<span class="qp-chip">'
                + escapeHtml(TYPE_LABELS[question.type] || question.type) + '</span>'];
            if (question.subject) meta.push(escapeHtml(question.subject));
            if (question.term) meta.push(escapeHtml(question.term));
            if (question.targetClass) meta.push(escapeHtml(question.targetClass));
            if (question.difficulty) meta.push(escapeHtml(question.difficulty));
            var points = Number(question.points || 1);
            meta.push(points + ' pt' + (points === 1 ? '' : 's'));
            if (question.__inExam) meta.push('<span class="qp-chip is-warn">Already in this exam</span>');

            return ''
                + '<label class="qp-row' + (question.__inExam ? ' is-in-exam' : '') + '">'
                + '  <input type="checkbox" value="' + escapeHtml(question.id) + '"'
                +        (state.selected[question.id] ? ' checked' : '') + '>'
                + '  <span class="qp-row-body">'
                + '    <span class="qp-text">' + escapeHtml(truncate(question.text, 300)) + '</span>'
                + '    <span class="qp-meta">' + meta.join(' · ') + '</span>'
                + '  </span>'
                + '</label>';
        }).join('');
    }

    function refreshCount() {
        var count = Object.keys(state.selected).length;
        var label = count === 0
            ? 'Nothing selected'
            : count + ' question' + (count === 1 ? '' : 's') + ' selected';

        el('qp-summary').textContent = label;
        var mobileCount = el('qp-mab-count');
        if (mobileCount) mobileCount.textContent = count ? String(count) : '';

        ['qp-add-btn', 'qp-mab-add'].forEach(function(id) {
            var button = el(id);
            if (!button) return;
            button.disabled = count === 0;
        });
        var addBtn = el('qp-add-btn');
        if (addBtn) addBtn.textContent = count === 0 ? 'Add to exam' : 'Add ' + count + ' to exam';
    }

    // ================================================================
    // RANDOM AUTO-SELECT
    // ================================================================

    /** Questions the random pick may draw from: on-filter, not already used. */
    function randomPool() {
        return visibleQuestions().filter(function(question) { return !question.__inExam; });
    }

    /** Keeps the "N available to draw from" label and the button in step. */
    function refreshRandomAvailability() {
        var available = randomPool().length;
        var label = el('qp-random-avail');
        var button = el('qp-random-btn');
        if (label) {
            label.textContent = available === 0
                ? 'Nothing available with these filters'
                : available + ' question' + (available === 1 ? '' : 's') + ' available to draw from';
        }
        if (button) button.disabled = available === 0;
    }

    // ---------------- number wheel ----------------

    var ROW_HEIGHT = 40;
    var wheelValue = 0;
    var wheelMax = 0;
    var wheelScrollTimer = null;

    function openWheel() {
        wheelMax = randomPool().length;
        if (wheelMax === 0) {
            flashRandomHint('No questions available to pick from with these filters.');
            return;
        }

        var track = el('qp-wheel-track');
        var rows = [];
        for (var n = 1; n <= wheelMax; n++) {
            rows.push('<button type="button" class="qp-wheel-num" role="option" data-value="' + n + '">' + n + '</button>');
        }
        // Padding rows let the first and last numbers reach the centre band
        track.innerHTML = '<div class="qp-wheel-pad"></div>' + rows.join('') + '<div class="qp-wheel-pad"></div>';

        el('qp-wheel-avail').textContent = wheelMax + ' available with your current filters';
        el('qp-wheel').hidden = false;

        // Open on a sensible default rather than at 1: usually a whole exam's
        // worth, capped by what is actually there.
        setWheelValue(Math.min(10, wheelMax), true);
        track.focus();
    }

    function closeWheel() {
        el('qp-wheel').hidden = true;
    }

    /** Scroll the wheel so `value` sits under the band, and mark it active. */
    function setWheelValue(value, jump) {
        wheelValue = Math.max(1, Math.min(wheelMax, value));
        var track = el('qp-wheel-track');
        track.scrollTo({ top: (wheelValue - 1) * ROW_HEIGHT, behavior: jump ? 'auto' : 'smooth' });
        markWheelActive();
    }

    function markWheelActive() {
        var display = el('qp-wheel-value');
        if (display) display.textContent = String(wheelValue);
        var track = el('qp-wheel-track');
        Array.prototype.forEach.call(track.querySelectorAll('.qp-wheel-num'), function(button) {
            var isActive = Number(button.getAttribute('data-value')) === wheelValue;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    /** Whatever row has come to rest under the band is the value. */
    function onWheelScroll() {
        clearTimeout(wheelScrollTimer);
        wheelScrollTimer = setTimeout(function() {
            var track = el('qp-wheel-track');
            var index = Math.round(track.scrollTop / ROW_HEIGHT);
            wheelValue = Math.max(1, Math.min(wheelMax, index + 1));
            markWheelActive();
        }, 60);
    }

    /**
     * Draw `requested` questions at random from whatever the filters show.
     *
     * Questions the exam already has are never drawn — the point is to add
     * questions, not re-add ones that are in there. Anything already
     * hand-picked is kept and counts toward the target, so asking for 10 after
     * ticking 3 draws 7 more rather than starting over.
     */
    function autoSelectRandom(requested) {
        var pool = randomPool();
        if (pool.length === 0) {
            flashRandomHint('No questions available to pick from with these filters.');
            return;
        }

        var alreadyPicked = pool.filter(function(question) { return state.selected[question.id]; });
        var remaining = requested - alreadyPicked.length;

        if (remaining <= 0) {
            flashRandomHint('You already have ' + alreadyPicked.length + ' selected.');
            return;
        }

        var candidates = pool.filter(function(question) { return !state.selected[question.id]; });
        var take = Math.min(remaining, candidates.length);

        // Fisher–Yates over a copy: an unbiased shuffle, and taking the first
        // `take` of it is a uniform sample without repeats.
        for (var i = candidates.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
        }
        candidates.slice(0, take).forEach(function(question) { state.selected[question.id] = true; });

        renderList();
        refreshCount();

        flashRandomHint(take < remaining
            ? 'Only ' + take + ' more were available — selected all of them.'
            : 'Randomly selected ' + take + ' question' + (take === 1 ? '' : 's') + '.');
    }

    var hintTimer = null;
    function flashRandomHint(message) {
        var hint = el('qp-random-hint');
        if (!hint) return;
        hint.textContent = message;
        hint.classList.add('is-visible');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(function() { hint.classList.remove('is-visible'); }, 4000);
    }

    // ================================================================
    // LEAVING THE PAGE
    // ================================================================

    function builderUrl() {
        return 'create-exam.html?restore=1' + (state.examId ? '&id=' + encodeURIComponent(state.examId) : '');
    }

    /** Hand the exam back untouched. */
    async function cancel() {
        window.location.href = builderUrl();
    }

    /** Hand the exam back with the chosen questions appended. */
    async function addToExam() {
        var picked = state.all.filter(function(question) { return state.selected[question.id]; });
        if (picked.length === 0) return;

        var snapshot = state.snapshot || {};
        snapshot.pickedQuestions = picked.map(function(question) {
            var copy = Object.assign({}, question);
            delete copy.__inExam;
            return copy;
        });

        var stored = await window.ExamSnapshot.save(snapshot);
        if (!stored) {
            await Utils.showAlert(
                'Could Not Add Questions',
                'There was not enough room to carry the exam back. Try adding fewer questions at a time.'
            );
            return;
        }
        window.location.href = builderUrl();
    }

    // ================================================================
    // INIT
    // ================================================================

    async function init() {
        var user = window.dataService?.getCurrentUser?.();
        if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
            window.location.href = '../index.html';
            return;
        }

        var snapshot = await window.ExamSnapshot.peek();
        if (!snapshot) {
            // Nothing parked — the teacher landed here directly, so there is no
            // exam to add to. Send them where they can start one.
            await Utils.showAlert(
                'No Exam in Progress',
                'Open this from the Create Exam page so there is an exam to add questions to.'
            );
            window.location.href = 'create-exam.html';
            return;
        }
        state.snapshot = snapshot;
        state.examId = snapshot.examId || null;

        var context = snapshot.context || {};
        var contextBits = [];
        if (context.subject) contextBits.push(context.subject);
        if (context.targetClass) contextBits.push(context.targetClass);
        if (context.term) contextBits.push(context.term);
        el('qp-context').textContent = contextBits.length
            ? 'Adding to: ' + contextBits.join(' · ')
            : 'Adding to the exam you are building';

        var existingCount = (snapshot.questions || []).length;
        el('qp-existing-count').textContent = existingCount
            ? existingCount + ' question' + (existingCount === 1 ? '' : 's') + ' already in this exam'
            : 'This exam has no questions yet';

        // Non-admins only ever see their own questions, matching the
        // Question Bank page's own rule.
        var ctx = (window.dataService.getSchoolContext && window.dataService.getSchoolContext()) || {};
        var isAdmin = ['admin', 'super_admin', 'master_admin'].indexOf(ctx.role) >= 0;

        try {
            state.all = await window.dataService.getQuestionBankQuestions(
                isAdmin ? {} : { createdBy: ctx.userId }
            );
        } catch (err) {
            console.error('[QuestionPicker] Could not read the Question Bank:', err);
            await Utils.showAlert('Could Not Load Questions', err.message || 'The Question Bank could not be read.');
            state.all = [];
        }

        // Flag anything the exam already holds, so the same question is not
        // pulled in twice. Uses the similarity engine, so a reworded copy is
        // caught too, not just a character-for-character match.
        var engine = window.QuestionSimilarity;
        var existing = snapshot.questions || [];
        state.all.forEach(function(question) {
            question.__inExam = engine
                ? existing.some(function(q) { return engine.isMatch(question, q); })
                : existing.some(function(q) { return plainText(q.text) === plainText(question.text); });
        });

        fillSelect(el('qp-filter-subject'), uniqueValues(state.all, 'subject'), 'All subjects', context.subject);
        fillSelect(el('qp-filter-term'), uniqueValues(state.all, 'term'), 'All terms', context.term);
        fillSelect(el('qp-filter-class'), uniqueValues(state.all, 'targetClass'), 'All classes', context.targetClass);
        fillSelect(el('qp-filter-type'), typeOptions(state.all), 'All question types', '');

        renderList();
        refreshCount();
        wireEvents();
    }

    function wireEvents() {
        ['qp-search', 'qp-filter-subject', 'qp-filter-term', 'qp-filter-class',
         'qp-filter-type', 'qp-hide-used'].forEach(function(id) {
            var control = el(id);
            if (!control) return;
            control.addEventListener('input', renderList);
            control.addEventListener('change', renderList);
        });

        // Selection is tracked on a map rather than read off the checkboxes, so
        // it survives filter changes — pick some Maths, switch to English, pick
        // more, and add the lot.
        el('qp-list').addEventListener('change', function(event) {
            var input = event.target;
            if (!input || input.type !== 'checkbox') return;
            if (input.checked) state.selected[input.value] = true;
            else delete state.selected[input.value];
            refreshCount();
        });

        el('qp-select-all').addEventListener('click', function() {
            visibleQuestions().forEach(function(question) {
                if (!question.__inExam) state.selected[question.id] = true;
            });
            renderList();
            refreshCount();
        });

        el('qp-clear').addEventListener('click', function() {
            state.selected = Object.create(null);
            renderList();
            refreshCount();
        });

        el('qp-random-btn').addEventListener('click', openWheel);
        el('qp-wheel-cancel').addEventListener('click', closeWheel);
        el('qp-wheel-confirm').addEventListener('click', function() {
            var value = wheelValue;
            closeWheel();
            autoSelectRandom(value);
        });

        var track = el('qp-wheel-track');
        track.addEventListener('scroll', onWheelScroll);
        // Tapping a number brings it to the band rather than making the user
        // scroll it there by hand.
        track.addEventListener('click', function(event) {
            var button = event.target.closest('.qp-wheel-num');
            if (button) setWheelValue(Number(button.getAttribute('data-value')));
        });
        track.addEventListener('keydown', function(event) {
            if (event.key === 'ArrowUp') { event.preventDefault(); setWheelValue(wheelValue - 1); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); setWheelValue(wheelValue + 1); }
            else if (event.key === 'Enter') { event.preventDefault(); el('qp-wheel-confirm').click(); }
        });

        el('qp-wheel').addEventListener('click', function(event) {
            if (event.target === el('qp-wheel')) closeWheel();
        });
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' && !el('qp-wheel').hidden) closeWheel();
        });

        ['qp-add-btn', 'qp-mab-add'].forEach(function(id) {
            var button = el(id);
            if (button) button.addEventListener('click', addToExam);
        });
        ['qp-cancel-btn', 'qp-back-btn', 'qp-mab-cancel'].forEach(function(id) {
            var button = el(id);
            if (button) button.addEventListener('click', cancel);
        });

        var mobileRandom = el('qp-mab-random');
        if (mobileRandom) mobileRandom.addEventListener('click', openWheel);
    }

    window.questionPicker = { init: init };
})();
