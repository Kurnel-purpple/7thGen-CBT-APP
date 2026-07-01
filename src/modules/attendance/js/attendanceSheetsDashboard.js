/**
 * Attendance Sheets Dashboard
 * Teacher/admin view for creating and managing grid-based attendance sheets.
 * Depends on attendanceSheetsDataService (sheets, marks, subject_registrations).
 */

(function() {
    'use strict';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function todayIso() {
        var d = new Date();
        return d.toISOString().slice(0, 10);
    }

    function cmpDate(a, b) { return String(a || '').localeCompare(String(b || '')); }

    var state = {
        user: null,
        academic: null,
        sheets: [],
        classStudentsCache: {},   // classLevel -> [{id, name, ...}]
        editingSheetId: null,
        manualRoster: new Set(),  // student IDs currently ticked in the builder
        grid: null,               // { sheet, roster, marks:{studId->{colKey->mark}}, progress }
        _initialized: false
    };

    // Stable key helpers for the mark index
    function markKey(studentId, columnKey) { return studentId + '|' + columnKey; }

    // Statuses that count as "marked" (fill the progress ring)
    var MARKED_STATUSES = { present: true, ph: true, mtb: true };
    function isMarked(status) { return !!MARKED_STATUSES[status]; }

    // Short label shown inside the cell per status
    function cellBadge(status) {
        if (status === 'present') return '<span class="mg-check">&#10003;</span>';
        if (status === 'ph') return '<span class="mg-status-label">PH</span>';
        if (status === 'mtb') return '<span class="mg-status-label">MTB</span>';
        if (status === 'absent') return '<span class="mg-status-label">A</span>';
        return '';
    }

    // Click-vs-dblclick debouncer (per cell element)
    var _clickTimer = null;
    var CLICK_DELAY_MS = 230;

    // ================================================================
    // ACADEMIC HELPERS
    // ================================================================

    function allClasses() {
        var a = state.academic;
        if (!a || !a.classesByLevel) return [];
        var out = [];
        Object.values(a.classesByLevel).forEach(function(list) {
            list.forEach(function(c) { out.push(c); });
        });
        return out;
    }

    function classTextFor(value) {
        var match = allClasses().find(function(c) { return c.value === value; });
        return match ? match.text : value;
    }

    async function loadClassStudents(classLevel) {
        if (!classLevel) return [];
        if (state.classStudentsCache[classLevel]) return state.classStudentsCache[classLevel];
        try {
            var students = await window.dataService.getClassStudents(classLevel);
            state.classStudentsCache[classLevel] = students;
            return students;
        } catch (e) {
            console.warn('[AttendanceSheets] Failed to load class students:', e);
            return [];
        }
    }

    // ================================================================
    // INIT
    // ================================================================

    async function init() {
        if (state._initialized) return;
        state._initialized = true;

        var user = window.dataService?.getCurrentUser?.();
        if (!user || (user.role !== 'teacher' && user.role !== 'admin')) return;
        state.user = user;

        try {
            state.academic = await window.dataService.getAcademicEntities({ includeAllClasses: false });
        } catch (e) {
            console.warn('[AttendanceSheets] getAcademicEntities failed:', e);
        }

        populateClassDropdown();
        bindEvents();
        await refresh();
    }

    async function refresh() {
        var list = document.getElementById('sheets-list');
        if (!list) return;
        list.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Loading sheets…</p></div>';
        try {
            var filters = {};
            if (state.user && state.user.role !== 'admin') filters.teacherId = state.user.id;
            state.sheets = await window.dataService.listAttendanceSheets(filters);
            renderSheetsList();
        } catch (e) {
            console.error('[AttendanceSheets] refresh failed:', e);
            list.innerHTML = '<div class="attendance-empty"><p style="color:#e74c3c; font-weight:700;">Failed to load sheets.</p></div>';
        }
    }

    // ================================================================
    // SHEETS LIST
    // ================================================================

    function renderSheetsList() {
        var list = document.getElementById('sheets-list');
        if (!list) return;

        if (!state.sheets.length) {
            list.innerHTML =
                '<div class="attendance-empty">' +
                    '<div class="attendance-empty-icon">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">' +
                            '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/>' +
                        '</svg>' +
                    '</div>' +
                    '<p style="font-weight:700; font-size:1rem; color:var(--text-color);">No sheets yet</p>' +
                    '<p style="font-size:0.88rem;">Click <strong>+ New Sheet</strong> to create your first attendance sheet.</p>' +
                '</div>';
            return;
        }

        var html = '<div class="sheet-grid">';
        state.sheets.forEach(function(s) {
            var kindBadge = s.kind === 'form'
                ? '<span class="sheet-badge sheet-badge-form">Form Master</span>'
                : '<span class="sheet-badge sheet-badge-subject">Subject</span>';
            var cols = Array.isArray(s.columns) ? s.columns.length : 0;
            var firstDate = cols ? (s.columns[0].date || '—') : '—';
            var lastDate = cols ? (s.columns[cols - 1].date || '—') : '—';
            html +=
                '<article class="sheet-card" data-sheet-id="' + escapeHtml(s.id) + '">' +
                    '<div class="sheet-card-head">' +
                        kindBadge +
                        '<div class="sheet-card-actions">' +
                            '<button class="ghost-cta" data-edit-sheet="' + escapeHtml(s.id) + '" title="Edit">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' +
                            '</button>' +
                            '<button class="ghost-cta ghost-cta-danger" data-delete-sheet="' + escapeHtml(s.id) + '" title="Delete">' +
                                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="15" height="15"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>' +
                            '</button>' +
                        '</div>' +
                    '</div>' +
                    '<h4 class="sheet-card-title">' +
                        escapeHtml(s.subject || (s.kind === 'form' ? 'Form register' : '(no subject)')) +
                    '</h4>' +
                    '<div class="sheet-card-meta">' +
                        escapeHtml(classTextFor(s.classLevel)) +
                        (s.term ? ' · ' + escapeHtml(s.term) : '') +
                        (s.session ? ' · ' + escapeHtml(s.session) : '') +
                    '</div>' +
                    '<div class="sheet-card-meta">' +
                        cols + ' column' + (cols !== 1 ? 's' : '') +
                        (cols ? ' · ' + escapeHtml(firstDate) + ' → ' + escapeHtml(lastDate) : '') +
                    '</div>' +
                    '<button class="sheet-card-mark-btn" data-open-sheet="' + escapeHtml(s.id) + '" title="Open marking grid">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>' +
                        '<span>Mark attendance</span>' +
                    '</button>' +
                '</article>';
        });
        html += '</div>';

        list.innerHTML = html;

        list.querySelectorAll('[data-edit-sheet]').forEach(function(btn) {
            btn.addEventListener('click', function() { openBuilder(btn.getAttribute('data-edit-sheet')); });
        });
        list.querySelectorAll('[data-delete-sheet]').forEach(function(btn) {
            btn.addEventListener('click', function() { deleteSheet(btn.getAttribute('data-delete-sheet')); });
        });
        list.querySelectorAll('[data-open-sheet]').forEach(function(btn) {
            btn.addEventListener('click', function() { openSheetGrid(btn.getAttribute('data-open-sheet')); });
        });
    }

    async function deleteSheet(sheetId) {
        if (!confirm('Delete this attendance sheet? All marks on it will be removed.')) return;
        try {
            await window.dataService.deleteAttendanceSheet(sheetId);
            await refresh();
        } catch (e) {
            alert('Delete failed: ' + (e.message || 'unknown error'));
        }
    }

    // ================================================================
    // BUILDER MODAL
    // ================================================================

    function populateClassDropdown() {
        var select = document.getElementById('sb-class');
        if (!select) return;
        var classes = allClasses();
        select.innerHTML = '<option value="">Select class…</option>' +
            classes.map(function(c) { return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>'; }).join('');
    }

    function bindEvents() {
        var newBtn = document.getElementById('sheets-new-btn');
        if (newBtn) newBtn.addEventListener('click', function() { openBuilder(null); });

        var form = document.getElementById('sheet-builder-form');
        if (form) form.addEventListener('submit', handleSubmit);

        // Live preview triggers
        var previewInputs = ['sb-start', 'sb-end', 'sb-class'];
        previewInputs.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.addEventListener('change', onBuilderChange);
        });
        document.querySelectorAll('input[name="sb-kind"]').forEach(function(r) {
            r.addEventListener('change', onKindChange);
        });
        document.querySelectorAll('.sb-weekday input[type="checkbox"]').forEach(function(cb) {
            cb.addEventListener('change', updatePreview);
        });

        var classEl = document.getElementById('sb-class');
        if (classEl) classEl.addEventListener('change', function() {
            // Reset manual roster when the user switches classes — IDs from a
            // different class would be invalid for the new one.
            state.manualRoster = new Set();
            renderRosterPanel();
        });
    }

    function openBuilder(sheetId) {
        state.editingSheetId = sheetId || null;
        state.manualRoster = new Set();

        var modal = document.getElementById('sheet-builder-modal');
        var titleEl = document.getElementById('sheet-builder-title');
        if (!modal) return;

        if (sheetId) {
            var sheet = state.sheets.find(function(s) { return s.id === sheetId; });
            if (!sheet) { alert('Sheet not found.'); return; }
            titleEl.textContent = 'Edit Attendance Sheet';
            fillBuilder(sheet);
        } else {
            titleEl.textContent = 'New Attendance Sheet';
            resetBuilder();
        }

        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
        onKindChange();
        updatePreview();
        renderRosterPanel();
    }

    function closeBuilder() {
        var modal = document.getElementById('sheet-builder-modal');
        if (modal) modal.style.display = 'none';
        document.body.style.overflow = '';
        state.editingSheetId = null;
    }

    function resetBuilder() {
        document.querySelector('input[name="sb-kind"][value="subject"]').checked = true;
        document.getElementById('sb-class').value = '';
        document.getElementById('sb-subject').value = '';
        document.getElementById('sb-term').value = '';
        document.getElementById('sb-session').value = '';
        document.getElementById('sb-start').value = '';
        document.getElementById('sb-end').value = '';
        document.querySelectorAll('.sb-weekday input[type="checkbox"]').forEach(function(cb) {
            cb.checked = ['1', '2', '3', '4', '5'].indexOf(cb.getAttribute('data-wd')) !== -1;
        });
        state.manualRoster = new Set();
    }

    function fillBuilder(sheet) {
        document.querySelector('input[name="sb-kind"][value="' + (sheet.kind || 'subject') + '"]').checked = true;
        document.getElementById('sb-class').value = sheet.classLevel || '';
        document.getElementById('sb-subject').value = sheet.subject || '';
        document.getElementById('sb-term').value = sheet.term || '';
        document.getElementById('sb-session').value = sheet.session || '';

        var dates = (sheet.columns || []).map(function(c) { return c.date; }).filter(Boolean).sort(cmpDate);
        document.getElementById('sb-start').value = dates[0] || '';
        document.getElementById('sb-end').value = dates[dates.length - 1] || '';

        // Infer weekdays from existing columns
        var weekdaySet = new Set();
        (sheet.columns || []).forEach(function(c) {
            if (!c.date) return;
            var d = new Date(c.date + 'T00:00:00');
            weekdaySet.add(String(d.getDay()));
        });
        document.querySelectorAll('.sb-weekday input[type="checkbox"]').forEach(function(cb) {
            cb.checked = weekdaySet.size ? weekdaySet.has(cb.getAttribute('data-wd'))
                                         : ['1', '2', '3', '4', '5'].indexOf(cb.getAttribute('data-wd')) !== -1;
        });

        state.manualRoster = new Set(Array.isArray(sheet.manualRoster) ? sheet.manualRoster : []);
    }

    function onKindChange() {
        var kind = document.querySelector('input[name="sb-kind"]:checked').value;
        var subjectWrap = document.getElementById('sb-subject-wrap');
        var weekdaysRow = document.getElementById('sb-weekdays-row');
        if (subjectWrap) subjectWrap.style.display = kind === 'form' ? 'none' : '';
        if (weekdaysRow) weekdaysRow.style.display = kind === 'form' ? 'none' : '';
        updatePreview();
    }

    function onBuilderChange() {
        updatePreview();
    }

    function selectedWeekdays() {
        var set = new Set();
        document.querySelectorAll('.sb-weekday input[type="checkbox"]').forEach(function(cb) {
            if (cb.checked) set.add(parseInt(cb.getAttribute('data-wd'), 10));
        });
        return set;
    }

    function computeColumns() {
        var kind = document.querySelector('input[name="sb-kind"]:checked').value;
        var start = document.getElementById('sb-start').value;
        var end = document.getElementById('sb-end').value;
        if (!start || !end) return [];

        if (kind === 'form') {
            return window.dataService.buildFormColumns(start, end, { skipWeekends: true });
        }

        var wd = selectedWeekdays();
        if (!wd.size) return [];
        var sessions = [];
        var d = new Date(start);
        var endD = new Date(end);
        var safety = 0;
        while (d <= endD && safety < 400) {
            if (wd.has(d.getDay())) {
                sessions.push({ date: d.toISOString().slice(0, 10) });
            }
            d.setDate(d.getDate() + 1);
            safety++;
        }
        return window.dataService.buildSubjectColumns(sessions);
    }

    function updatePreview() {
        var preview = document.getElementById('sb-preview');
        if (!preview) return;
        var cols = computeColumns();
        if (!cols.length) {
            preview.textContent = 'Set dates (and meeting days for subject sheets) to preview columns.';
            return;
        }
        var first = cols[0].date;
        var last = cols[cols.length - 1].date;
        preview.innerHTML =
            '<strong>' + cols.length + '</strong> column' + (cols.length !== 1 ? 's' : '') +
            ' · ' + escapeHtml(first) + ' → ' + escapeHtml(last);
    }

    async function renderRosterPanel() {
        var panel = document.getElementById('sb-roster-panel');
        if (!panel) return;
        var classLevel = document.getElementById('sb-class').value;
        if (!classLevel) {
            panel.innerHTML = '<div style="color:var(--light-text); font-size:0.85rem;">Select a class to load students.</div>';
            return;
        }
        panel.innerHTML = '<div style="color:var(--light-text); font-size:0.85rem;">Loading students…</div>';
        var students = await loadClassStudents(classLevel);
        if (!students.length) {
            panel.innerHTML = '<div style="color:var(--light-text); font-size:0.85rem;">No students found in this class.</div>';
            return;
        }
        var html = '<div class="sb-roster-grid">';
        students.forEach(function(s) {
            var checked = state.manualRoster.has(s.id) ? 'checked' : '';
            html +=
                '<label class="sb-roster-item">' +
                    '<input type="checkbox" data-roster-id="' + escapeHtml(s.id) + '" ' + checked + '> ' +
                    '<span>' + escapeHtml(s.name) + '</span>' +
                '</label>';
        });
        html += '</div>';
        panel.innerHTML = html;
        panel.querySelectorAll('input[data-roster-id]').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var id = cb.getAttribute('data-roster-id');
                if (cb.checked) state.manualRoster.add(id);
                else state.manualRoster.delete(id);
            });
        });
    }

    async function handleSubmit(e) {
        e.preventDefault();

        var kind = document.querySelector('input[name="sb-kind"]:checked').value;
        var classLevel = document.getElementById('sb-class').value;
        var subject = document.getElementById('sb-subject').value.trim();
        var term = document.getElementById('sb-term').value;
        var session = document.getElementById('sb-session').value.trim();

        if (!classLevel) { alert('Please select a class.'); return; }
        if (!term) { alert('Please select a term.'); return; }
        if (kind === 'subject' && !subject) { alert('Please enter a subject name for a subject-period sheet.'); return; }

        var columns = computeColumns();
        if (!columns.length) {
            alert('No columns generated — please check the date range' + (kind === 'subject' ? ' and meeting days.' : '.'));
            return;
        }

        var school = window.dataService.getSchoolContext ? window.dataService.getSchoolContext() : {};
        var payload = {
            kind: kind,
            teacherId: state.user.id,
            teacherName: state.user.name || state.user.full_name || state.user.username || '',
            classLevel: classLevel,
            subject: kind === 'form' ? '' : subject,
            term: term,
            session: session,
            schoolVersion: (school && school.schoolVersion) || '',
            columns: columns,
            manualRoster: Array.from(state.manualRoster)
        };

        var submitBtn = e.target.querySelector('button[type="submit"]');
        var originalText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving…'; }

        try {
            if (state.editingSheetId) {
                await window.dataService.updateAttendanceSheet(state.editingSheetId, payload);
            } else {
                await window.dataService.createAttendanceSheet(payload);
            }
            closeBuilder();
            await refresh();
        } catch (err) {
            console.error('[AttendanceSheets] save failed:', err);
            alert('Save failed: ' + (err.message || 'unknown error'));
        } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
        }
    }

    // ================================================================
    // MARKING GRID
    // ================================================================

    function setGridStatus(text, tone) {
        var el = document.getElementById('sheet-grid-status');
        if (!el) return;
        el.textContent = text || '';
        el.style.color = tone === 'error' ? '#e74c3c'
                       : tone === 'success' ? '#1a9a5b'
                       : 'var(--light-text)';
    }

    async function openSheetGrid(sheetId) {
        var sheet = state.sheets.find(function(s) { return s.id === sheetId; });
        if (!sheet) { alert('Sheet not found.'); return; }

        var listWrap = document.getElementById('sheets-list-wrap');
        var gridWrap = document.getElementById('sheet-grid-wrap');
        var titleEl = document.getElementById('sheet-grid-title');
        var subtitleEl = document.getElementById('sheet-grid-subtitle');
        var container = document.getElementById('sheet-grid-container');
        if (!listWrap || !gridWrap || !container) return;

        listWrap.style.display = 'none';
        gridWrap.style.display = 'flex';

        titleEl.textContent = sheet.kind === 'form'
            ? (classTextFor(sheet.classLevel) + ' — Form register')
            : (sheet.subject || 'Subject') + ' — ' + classTextFor(sheet.classLevel);
        subtitleEl.textContent =
            (sheet.term ? sheet.term : '') +
            (sheet.session ? ' · ' + sheet.session : '') +
            (sheet.kind === 'form' ? ' · Fills from subject sheets' : '');

        container.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Loading sheet…</p></div>';
        setGridStatus('Loading…');

        try {
            var ds = window.dataService;
            var rosterPromise = ds.getSheetRoster(sheet);
            var marksPromise = ds.getSheetMarks(sheet.id);
            var progressPromise = sheet.kind === 'form' ? ds.getFormSheetProgress(sheet) : Promise.resolve(null);

            var results = await Promise.all([rosterPromise, marksPromise, progressPromise]);
            var roster = results[0] || [];
            var marks = results[1] || [];
            var progress = results[2] || null;

            // Index marks by (studentId, columnKey)
            var marksIndex = {};
            marks.forEach(function(m) {
                if (!m.studentId || !m.columnKey) return;
                marksIndex[markKey(m.studentId, m.columnKey)] = m;
            });

            state.grid = {
                sheet: sheet,
                roster: roster,
                marks: marksIndex,
                progress: progress
            };

            renderGridTable();
            setGridStatus(roster.length + ' student' + (roster.length !== 1 ? 's' : '') +
                          ' · ' + (sheet.columns || []).length + ' column' +
                          (((sheet.columns || []).length) !== 1 ? 's' : ''));
        } catch (e) {
            console.error('[AttendanceSheets] load grid failed:', e);
            container.innerHTML = '<div class="attendance-empty"><p style="color:#e74c3c; font-weight:700;">Failed to load sheet.</p></div>';
            setGridStatus('Error', 'error');
        }
    }

    function closeGrid() {
        closeStatusPicker();
        var listWrap = document.getElementById('sheets-list-wrap');
        var gridWrap = document.getElementById('sheet-grid-wrap');
        if (gridWrap) gridWrap.style.display = 'none';
        if (listWrap) listWrap.style.display = 'flex';
        state.grid = null;
        // Refresh list in case marks changed anything visible (counts etc.)
        refresh();
    }

    function renderGridTable() {
        var container = document.getElementById('sheet-grid-container');
        if (!container || !state.grid) return;
        var g = state.grid;
        var cols = Array.isArray(g.sheet.columns) ? g.sheet.columns : [];

        if (!g.roster.length) {
            container.innerHTML =
                '<div class="attendance-empty">' +
                    '<p style="font-weight:700; color:var(--text-color);">No students on this sheet yet</p>' +
                    '<p style="font-size:0.88rem;">' +
                        (g.sheet.kind === 'subject'
                            ? 'Students will appear here once they register for this subject, or add them manually via edit.'
                            : 'No students found in this class.') +
                    '</p>' +
                '</div>';
            return;
        }
        if (!cols.length) {
            container.innerHTML = '<div class="attendance-empty"><p>This sheet has no columns. Edit the sheet to set a date range.</p></div>';
            return;
        }

        var isForm = g.sheet.kind === 'form';
        var html = '<div class="grid-scroll"><table class="mark-grid"><thead><tr>';
        html += '<th class="mg-sticky-col mg-head-corner">Student</th>';
        cols.forEach(function(c) {
            html += '<th class="mg-col-head" data-col-head="1"' +
                        ' data-col="' + escapeHtml(c.key) + '"' +
                        ' data-date="' + escapeHtml(c.date || '') + '"' +
                        ' title="Double-click to mark all students">' +
                        '<div class="mg-col-head-label">' + escapeHtml(c.label || c.key) + '</div>' +
                        (c.date ? '<div class="mg-col-head-date">' + escapeHtml(c.date) + '</div>' : '') +
                    '</th>';
        });
        html += '</tr></thead><tbody>';

        g.roster.forEach(function(student) {
            html += '<tr>';
            html += '<td class="mg-sticky-col mg-row-label">' + escapeHtml(student.name) + '</td>';
            cols.forEach(function(c) {
                html += renderCell(student, c, isForm);
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;

        // Wire up cell clicks: single-click toggles present; double-click opens picker
        container.querySelectorAll('[data-cell]').forEach(function(td) {
            td.addEventListener('click', function() {
                if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
                _clickTimer = setTimeout(function() {
                    _clickTimer = null;
                    onCellClick(td.getAttribute('data-student'), td.getAttribute('data-col'), td.getAttribute('data-date'));
                }, CLICK_DELAY_MS);
            });
            td.addEventListener('dblclick', function(ev) {
                if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
                ev.preventDefault();
                showStatusPicker(td, td.getAttribute('data-student'), td.getAttribute('data-col'), td.getAttribute('data-date'));
            });
        });

        // Column header double-click → bulk mark picker
        container.querySelectorAll('[data-col-head]').forEach(function(th) {
            th.addEventListener('dblclick', function(ev) {
                ev.preventDefault();
                showBulkPicker(th, th.getAttribute('data-col'), th.getAttribute('data-date'));
            });
        });
    }

    function renderCell(student, col, isForm) {
        var g = state.grid;
        var key = markKey(student.id, col.key);
        var mark = g.marks[key];
        var markedStatus = mark && isMarked(mark.status) ? mark.status : null;

        var baseAttrs =
            ' data-cell="1"' +
            ' data-student="' + escapeHtml(student.id) + '"' +
            ' data-col="' + escapeHtml(col.key) + '"' +
            ' data-date="' + escapeHtml(col.date || '') + '"';

        if (isForm) {
            var p = g.progress && g.progress[student.id] && g.progress[student.id][col.date];
            var marked = p ? p.marked : 0;
            var total = p ? p.total : 0;
            var manual = !!(p && p.manual) || !!markedStatus;
            var title = manual
                ? (markedStatus === 'ph' ? 'Public holiday'
                 : markedStatus === 'mtb' ? 'Mid-term break'
                 : 'Marked present manually')
                : (marked + '/' + total + ' subject sheets marked present');
            return '<td class="mg-cell mg-cell-form' + (manual ? ' mg-cell-manual' : '') + '"' +
                   baseAttrs + ' title="' + title + '">' +
                       (markedStatus === 'ph' || markedStatus === 'mtb'
                           ? cellBadge(markedStatus)
                           : renderProgressRing(marked, total, manual)) +
                   '</td>';
        }

        // Explicit absent mark OR auto-absent (past date with no mark)
        var displayStatus = markedStatus;
        var isAutoAbsent = false;
        if (!markedStatus && mark && mark.status === 'absent') {
            displayStatus = 'absent';
        } else if (!mark && isPastDate(col.date)) {
            displayStatus = 'absent';
            isAutoAbsent = true;
        }

        var statusClass = displayStatus === 'ph' ? ' mg-cell-ph'
                        : displayStatus === 'mtb' ? ' mg-cell-mtb'
                        : displayStatus === 'present' ? ' mg-cell-present'
                        : displayStatus === 'absent' ? ' mg-cell-absent' + (isAutoAbsent ? ' mg-cell-auto-absent' : '')
                        : '';
        var tip = displayStatus === 'ph' ? 'Public holiday — double-click to change'
                : displayStatus === 'mtb' ? 'Mid-term break — double-click to change'
                : displayStatus === 'present' ? 'Present — click to clear, double-click for more'
                : displayStatus === 'absent' ? (isAutoAbsent
                    ? 'No mark — automatically treated as absent. Click to mark present.'
                    : 'Absent — click to clear, double-click for more')
                : 'Click to mark present, double-click for more';
        return '<td class="mg-cell mg-cell-subject' + statusClass + '"' +
               baseAttrs + ' title="' + tip + '">' +
                   cellBadge(displayStatus) +
               '</td>';
    }

    function renderProgressRing(marked, total, manual) {
        if (manual) {
            return '<span class="mg-ring mg-ring-full"><span class="mg-ring-check">&#10003;</span></span>';
        }
        if (!total) {
            return '<span class="mg-ring mg-ring-empty"></span>';
        }
        var pct = Math.round((marked / total) * 100);
        // Use conic-gradient for the ring fill
        return '<span class="mg-ring" style="background: conic-gradient(var(--primary-color, #1A73E8) ' + pct + '%, #e0e0e0 ' + pct + '%);">' +
                   '<span class="mg-ring-inner">' + marked + '/' + total + '</span>' +
               '</span>';
    }

    async function onCellClick(studentId, columnKey, date) {
        // Single-click: if any real mark exists (present/absent/PH/MTB), clear it.
        // Otherwise (truly empty, including auto-absent past cells), mark present.
        var g = state.grid;
        if (!g || !studentId || !columnKey) return;
        var existing = g.marks[markKey(studentId, columnKey)];
        if (existing) {
            await applyCellStatus(studentId, columnKey, date, null);
        } else {
            await applyCellStatus(studentId, columnKey, date, 'present');
        }
    }

    /** Apply a specific status (or clear if newStatus is null). */
    async function applyCellStatus(studentId, columnKey, date, newStatus) {
        var g = state.grid;
        if (!g || !studentId || !columnKey) return;

        var key = markKey(studentId, columnKey);
        var existing = g.marks[key];
        var isForm = g.sheet.kind === 'form';
        var prev = existing ? Object.assign({}, existing) : null;

        try {
            if (newStatus == null) {
                await window.dataService.clearSheetCell(g.sheet.id, studentId, columnKey);
                delete g.marks[key];
            } else {
                var cell = {
                    sheetId: g.sheet.id,
                    studentId: studentId,
                    columnKey: columnKey,
                    date: date || '',
                    status: newStatus,
                    markedBy: state.user && state.user.id,
                    markedByName: state.user && (state.user.name || state.user.full_name || state.user.username)
                };
                var saved = await window.dataService.markSheetCell(cell);
                g.marks[key] = saved || cell;
            }
            if (isForm && g.progress) {
                if (!g.progress[studentId]) g.progress[studentId] = {};
                if (!g.progress[studentId][date]) g.progress[studentId][date] = { marked: 0, total: 0, manual: false };
                g.progress[studentId][date].manual = isMarked(newStatus);
            }
            renderGridTable();
        } catch (e) {
            console.error('[AttendanceSheets] cell update failed:', e);
            alert('Could not save mark: ' + (e.message || 'unknown error'));
            if (prev) g.marks[key] = prev;
            else delete g.marks[key];
            renderGridTable();
        }
    }

    // ----- Status picker (double-click mini dropdown) -----

    var _openPicker = null;

    function closeStatusPicker() {
        if (_openPicker && _openPicker.parentNode) {
            _openPicker.parentNode.removeChild(_openPicker);
        }
        _openPicker = null;
        document.removeEventListener('click', _outsidePickerHandler, true);
        document.removeEventListener('keydown', _escPickerHandler, true);
    }

    function _outsidePickerHandler(ev) {
        if (!_openPicker) return;
        if (_openPicker.contains(ev.target)) return;
        closeStatusPicker();
    }

    function _escPickerHandler(ev) {
        if (ev.key === 'Escape') closeStatusPicker();
    }

    function showStatusPicker(cellEl, studentId, columnKey, date) {
        closeStatusPicker();

        var picker = document.createElement('div');
        picker.className = 'mg-status-picker';
        picker.innerHTML =
            '<button class="mg-sp-item" data-status="present">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Present' +
            '</button>' +
            '<button class="mg-sp-item" data-status="ph">' +
                '<span class="mg-sp-badge">PH</span> Public holiday' +
            '</button>' +
            '<button class="mg-sp-item" data-status="mtb">' +
                '<span class="mg-sp-badge">MTB</span> Mid-term break' +
            '</button>' +
            '<button class="mg-sp-item mg-sp-clear" data-status="">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Clear' +
            '</button>';

        // Position near the cell
        var rect = cellEl.getBoundingClientRect();
        picker.style.position = 'fixed';
        picker.style.top = (rect.bottom + 4) + 'px';
        picker.style.left = rect.left + 'px';
        picker.style.zIndex = '2000';
        document.body.appendChild(picker);

        // Flip to above if near bottom edge
        var pickerRect = picker.getBoundingClientRect();
        if (pickerRect.bottom > window.innerHeight - 8) {
            picker.style.top = (rect.top - pickerRect.height - 4) + 'px';
        }
        if (pickerRect.right > window.innerWidth - 8) {
            picker.style.left = Math.max(8, window.innerWidth - pickerRect.width - 8) + 'px';
        }

        picker.querySelectorAll('[data-status]').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                var next = btn.getAttribute('data-status') || null;
                closeStatusPicker();
                await applyCellStatus(studentId, columnKey, date, next || null);
            });
        });

        _openPicker = picker;
        // Defer binding outside-click to next tick so the dblclick that opened
        // the picker doesn't immediately close it
        setTimeout(function() {
            document.addEventListener('click', _outsidePickerHandler, true);
            document.addEventListener('keydown', _escPickerHandler, true);
        }, 0);
    }

    /** Bulk picker for a column header — marks all roster students at once. */
    function showBulkPicker(headEl, columnKey, date) {
        closeStatusPicker();
        var picker = document.createElement('div');
        picker.className = 'mg-status-picker mg-bulk-picker';
        picker.innerHTML =
            '<div class="mg-sp-title">Mark all as:</div>' +
            '<button class="mg-sp-item" data-status="present">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Present' +
            '</button>' +
            '<button class="mg-sp-item" data-status="absent">' +
                '<span class="mg-sp-badge mg-sp-badge-absent">A</span> Absent' +
            '</button>' +
            '<button class="mg-sp-item" data-status="ph">' +
                '<span class="mg-sp-badge">PH</span> Public holiday' +
            '</button>' +
            '<button class="mg-sp-item" data-status="mtb">' +
                '<span class="mg-sp-badge mg-sp-badge-mtb">MTB</span> Mid-term break' +
            '</button>' +
            '<button class="mg-sp-item mg-sp-clear" data-status="">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Clear column' +
            '</button>';

        var rect = headEl.getBoundingClientRect();
        picker.style.position = 'fixed';
        picker.style.top = (rect.bottom + 4) + 'px';
        picker.style.left = rect.left + 'px';
        picker.style.zIndex = '2000';
        document.body.appendChild(picker);

        var pickerRect = picker.getBoundingClientRect();
        if (pickerRect.right > window.innerWidth - 8) {
            picker.style.left = Math.max(8, window.innerWidth - pickerRect.width - 8) + 'px';
        }
        if (pickerRect.bottom > window.innerHeight - 8) {
            picker.style.top = (rect.top - pickerRect.height - 4) + 'px';
        }

        picker.querySelectorAll('[data-status]').forEach(function(btn) {
            btn.addEventListener('click', async function() {
                var next = btn.getAttribute('data-status') || null;
                closeStatusPicker();
                await applyBulkStatus(columnKey, date, next);
            });
        });

        _openPicker = picker;
        setTimeout(function() {
            document.addEventListener('click', _outsidePickerHandler, true);
            document.addEventListener('keydown', _escPickerHandler, true);
        }, 0);
    }

    async function applyBulkStatus(columnKey, date, newStatus) {
        var g = state.grid;
        if (!g || !g.roster) return;
        setGridStatus('Updating column…');
        try {
            // Snapshot for rollback
            var prevMarks = {};
            g.roster.forEach(function(s) {
                var k = markKey(s.id, columnKey);
                if (g.marks[k]) prevMarks[k] = Object.assign({}, g.marks[k]);
            });

            var user = state.user || {};
            var markedByName = user.name || user.full_name || user.username;

            var tasks = g.roster.map(function(s) {
                var k = markKey(s.id, columnKey);
                if (newStatus == null) {
                    if (!g.marks[k]) return null;
                    return window.dataService.clearSheetCell(g.sheet.id, s.id, columnKey)
                        .then(function() { delete g.marks[k]; });
                }
                var cell = {
                    sheetId: g.sheet.id,
                    studentId: s.id,
                    columnKey: columnKey,
                    date: date || '',
                    status: newStatus,
                    markedBy: user.id,
                    markedByName: markedByName
                };
                return window.dataService.markSheetCell(cell).then(function(saved) {
                    g.marks[k] = saved || cell;
                });
            }).filter(Boolean);

            await Promise.all(tasks);

            if (g.sheet.kind === 'form' && g.progress) {
                g.roster.forEach(function(s) {
                    if (!g.progress[s.id]) g.progress[s.id] = {};
                    if (!g.progress[s.id][date]) g.progress[s.id][date] = { marked: 0, total: 0, manual: false };
                    g.progress[s.id][date].manual = isMarked(newStatus);
                });
            }
            renderGridTable();
            setGridStatus('Column updated', 'success');
            setTimeout(function() { setGridStatus(''); }, 1500);
        } catch (e) {
            console.error('[AttendanceSheets] bulk update failed:', e);
            alert('Bulk update failed: ' + (e.message || 'unknown error'));
            setGridStatus('Update failed', 'error');
        }
    }

    // Today as YYYY-MM-DD in local time (columns use local-date keys)
    function todayLocalIso() {
        var d = new Date();
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var dd = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + dd;
    }

    function isPastDate(iso) {
        if (!iso) return false;
        return iso < todayLocalIso();
    }

    // ================================================================
    // EXPORT
    // ================================================================

    window.attendanceSheetsDashboard = {
        init: init,
        refresh: refresh,
        openBuilder: openBuilder,
        closeBuilder: closeBuilder,
        openSheetGrid: openSheetGrid,
        closeGrid: closeGrid
    };

    if (document.readyState !== 'loading') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
