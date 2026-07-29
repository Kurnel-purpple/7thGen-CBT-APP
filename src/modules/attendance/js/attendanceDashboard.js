/**
 * Attendance Dashboard Controller
 * Powers the teacher/admin attendance marking and history views.
 */

(function() {
    'use strict';

    // ---------- helpers ----------
    function _escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function _todayISO() {
        const d = new Date();
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function _formatDate(iso) {
        if (!iso) return '';
        const d = new Date(iso + 'T00:00:00');
        return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }

    const classesByLevel = window.academicEntities?.getClassesByLevel() || {};

    // Flatten for dropdowns (no "All" option for attendance — must pick a class)
    function _allClasses() {
        const out = [];
        Object.values(classesByLevel).forEach(arr => arr.forEach(c => out.push(c)));
        return out;
    }

    // Statuses supported by the sheet-based marking flow.
    const SUPPORTED_STATUSES = ['present', 'absent', 'ph', 'mtb'];

    // ---------- state ----------
    const state = {
        students: [],       // { id, name, classLevel } — resolved from sheet roster
        attendance: {},     // studentId → { status }
        currentClass: '',
        sheets: [],         // attendance sheets for the current class
        selectedSheet: null,
        currentColumnKey: '',
        currentDate: '',
        saving: false,
        controlsOpen: false // when true, keep selection dropdowns visible even with a full selection
    };

    // ---------- DOM refs (resolved once on init) ----------
    let $classSelect, $sheetSelect, $dateSelect, $studentList, $actionBar, $loadingState, $markView, $historyView;
    let $statPresent, $statAbsent, $statPh, $statMtb, $statUnmarked;
    let $historyClassSelect, $historyStartDate, $historyEndDate, $historyContent;

    function _cacheDom() {
        $classSelect = document.getElementById('class-select');
        $sheetSelect = document.getElementById('sheet-select');
        $dateSelect = document.getElementById('date-select');
        $studentList = document.getElementById('student-list');
        $actionBar = document.getElementById('action-bar');
        $loadingState = document.getElementById('loading-state');
        $markView = document.getElementById('mark-view');
        $historyView = document.getElementById('history-view');
        $statPresent = document.getElementById('stat-present');
        $statAbsent = document.getElementById('stat-absent');
        $statPh = document.getElementById('stat-ph');
        $statMtb = document.getElementById('stat-mtb');
        $statUnmarked = document.getElementById('stat-unmarked');
        $historyClassSelect = document.getElementById('history-class-select');
        $historyStartDate = document.getElementById('history-start-date');
        $historyEndDate = document.getElementById('history-end-date');
        $historyContent = document.getElementById('history-content');
    }

    // ---------- populate dropdowns ----------
    function _populateClassDropdowns() {
        const classes = _allClasses();
        const optionsHtml = '<option value="">Select a class...</option>' +
            classes.map(c => `<option value="${_escapeHtml(c.value)}">${_escapeHtml(c.text)}</option>`).join('');
        if ($classSelect) $classSelect.innerHTML = optionsHtml;
        if ($historyClassSelect) $historyClassSelect.innerHTML = optionsHtml;
    }

    // ---------- init ----------
    async function init() {
        _cacheDom();

        // Auth gate — must be teacher or admin
        const user = dataService.getCurrentUser();
        if (!user || (user.role !== 'teacher' && user.role !== 'admin')) {
            window.location.href = '../index.html';
            return;
        }

        // Show user info in sidebar
        const nameEl = document.getElementById('user-name');
        if (nameEl) nameEl.textContent = user.full_name || user.username || 'Teacher';
        const avatarEl = document.getElementById('sidebar-avatar');
        if (avatarEl) avatarEl.textContent = (user.full_name || user.username || 'T').charAt(0).toUpperCase();
        const roleEl = document.querySelector('.sidebar-profile-role');
        if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Admin' : 'Teacher';

        // Populate dropdowns
        _populateClassDropdowns();

        // Default history date range: current month
        const today = _todayISO();
        if ($historyStartDate) $historyStartDate.value = today.slice(0, 8) + '01';
        if ($historyEndDate) $historyEndDate.value = today;

        // Hide loading, show mark view
        if ($loadingState) $loadingState.style.display = 'none';
        if ($markView) {
            $markView.style.display = 'flex';
        }
    }

    // ---------- sheets dropdown (populated after class pick) ----------
    async function _loadSheetsForClass() {
        if (!$sheetSelect) return;
        state.sheets = [];
        state.selectedSheet = null;
        state.currentColumnKey = '';
        state.currentDate = '';

        if (!state.currentClass) {
            $sheetSelect.innerHTML = '<option value="">Pick a class first</option>';
            $sheetSelect.disabled = true;
            _populateDateSelect();
            _resetRoster();
            return;
        }

        $sheetSelect.innerHTML = '<option value="">Loading sheets…</option>';
        $sheetSelect.disabled = true;

        try {
            const user = dataService.getCurrentUser();
            const filters = { classLevel: state.currentClass };
            // Teachers see only their own sheets; admins see all.
            if (user && user.role === 'teacher') filters.teacherId = user.id;
            const sheets = await dataService.listAttendanceSheets(filters);
            state.sheets = sheets || [];

            if (!state.sheets.length) {
                $sheetSelect.innerHTML = '<option value="">No sheets for this class — create one in the Sheets tab</option>';
                $sheetSelect.disabled = true;
                _populateDateSelect();
                _resetRoster();
                return;
            }

            const opts = ['<option value="">Select a sheet…</option>'];
            state.sheets.forEach(function(s) {
                const label = _sheetLabel(s);
                opts.push('<option value="' + _escapeHtml(s.id) + '">' + _escapeHtml(label) + '</option>');
            });
            $sheetSelect.innerHTML = opts.join('');
            $sheetSelect.disabled = false;
            _populateDateSelect();
            _resetRoster();
        } catch (error) {
            console.error('[AttendanceDashboard] Sheet load error:', error);
            $sheetSelect.innerHTML = '<option value="">Failed to load sheets</option>';
            $sheetSelect.disabled = true;
        }
    }

    function _sheetLabel(s) {
        if (!s) return '';
        const head = s.kind === 'form'
            ? 'Daily Register'
            : (s.subject || 'Subject');
        const parts = [head];
        if (s.term) parts.push(s.term);
        if (s.session) parts.push(s.session);
        return parts.join(' · ');
    }

    function _populateDateSelect() {
        if (!$dateSelect) return;
        if (!state.selectedSheet) {
            $dateSelect.innerHTML = '<option value="">Pick a sheet first</option>';
            $dateSelect.disabled = true;
            return;
        }
        const cols = Array.isArray(state.selectedSheet.columns) ? state.selectedSheet.columns : [];
        if (!cols.length) {
            $dateSelect.innerHTML = '<option value="">Sheet has no columns</option>';
            $dateSelect.disabled = true;
            return;
        }
        const today = _todayISO();
        let defaultKey = '';
        // Prefer today if it's a column, else the latest column on or before today, else first column.
        const pastOrToday = cols.filter(function(c) { return c.date && c.date <= today; });
        if (pastOrToday.length) defaultKey = pastOrToday[pastOrToday.length - 1].key;
        else defaultKey = cols[0].key;

        const opts = cols.map(function(c) {
            const label = c.date
                ? (_formatDate(c.date) + (c.label && c.label !== c.date ? ' — ' + c.label : ''))
                : (c.label || c.key);
            return '<option value="' + _escapeHtml(c.key) + '" data-date="' + _escapeHtml(c.date || '') + '"' +
                   (c.key === defaultKey ? ' selected' : '') + '>' + _escapeHtml(label) + '</option>';
        });
        $dateSelect.innerHTML = opts.join('');
        $dateSelect.disabled = false;

        // Sync state with the default selection.
        const selectedCol = cols.find(function(c) { return c.key === defaultKey; });
        state.currentColumnKey = defaultKey;
        state.currentDate = selectedCol ? (selectedCol.date || '') : '';
    }

    function _resetRoster() {
        state.students = [];
        state.attendance = {};
        _renderStudentList();
        _renderStats();
    }

    // ---------- load roster + existing marks from the selected sheet ----------
    async function _loadSheetRoster() {
        const sheet = state.selectedSheet;
        const columnKey = state.currentColumnKey;

        if (!sheet || !columnKey) {
            _resetRoster();
            return;
        }

        if ($studentList) {
            $studentList.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Loading students…</p></div>';
        }

        try {
            const [roster, marks] = await Promise.all([
                dataService.getSheetRoster(sheet),
                dataService.getSheetMarks(sheet.id)
            ]);

            state.students = roster || [];

            state.attendance = {};
            (marks || []).forEach(function(m) {
                if (m.columnKey !== columnKey) return;
                state.attendance[m.studentId] = { status: m.status || '' };
            });
            state.students.forEach(function(s) {
                if (!state.attendance[s.id]) state.attendance[s.id] = { status: '' };
            });

            _renderStudentList();
            _renderStats();
        } catch (error) {
            console.error('[AttendanceDashboard] Sheet roster load error:', error);
            if ($studentList) {
                $studentList.innerHTML = '<div class="attendance-empty"><p style="font-weight:700; color:#e74c3c;">Failed to load students. Please try again.</p></div>';
            }
        }
    }

    // ---------- render student list ----------
    function _renderStudentList() {
        _renderStudentListImpl();
        _applyControlsVisibility();
    }

    function _renderStudentListImpl() {
        if (!$studentList) return;

        if (!state.currentClass) {
            $studentList.innerHTML = `
                <div class="attendance-empty">
                    <div class="attendance-empty-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
                    </div>
                    <p style="font-weight:700; font-size:1rem; color:var(--text-color);">Select a class to begin</p>
                    <p style="font-size:0.88rem;">Choose a class from the dropdown above to load the sheets you've created for it.</p>
                </div>`;
            if ($actionBar) $actionBar.style.display = 'none';
            return;
        }

        if (!state.selectedSheet) {
            $studentList.innerHTML = `
                <div class="attendance-empty">
                    <div class="attendance-empty-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
                    </div>
                    <p style="font-weight:700; font-size:1rem; color:var(--text-color);">Choose a sheet</p>
                    <p style="font-size:0.88rem;">Pick one of the sheets you've created for this class — marks saved here will populate that sheet's grid.</p>
                </div>`;
            if ($actionBar) $actionBar.style.display = 'none';
            return;
        }

        if (state.students.length === 0) {
            $studentList.innerHTML = `
                <div class="attendance-empty">
                    <div class="attendance-empty-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
                    </div>
                    <p style="font-weight:700; font-size:1rem; color:var(--text-color);">No students on this sheet</p>
                    <p style="font-size:0.88rem;">${state.selectedSheet.kind === 'form' ? 'No students are enrolled in this class yet.' : 'No students are registered for this subject. Add students to the sheet or have them register.'}</p>
                </div>`;
            if ($actionBar) $actionBar.style.display = 'none';
            return;
        }

        let html = '';
        state.students.forEach((student, i) => {
            const att = state.attendance[student.id] || { status: '' };

            html += `<div class="attendance-row" data-student-id="${_escapeHtml(student.id)}">
                <span class="attendance-student-index">${i + 1}</span>
                <span class="attendance-student-name">${_escapeHtml(student.name)}</span>
                <div class="status-toggle-group">
                    <button class="status-toggle status-toggle-present${att.status === 'present' ? ' active-present' : ''}" onclick="attendanceDashboard.toggleStatus('${_escapeHtml(student.id)}','present')"><span class="st-full">Present</span><span class="st-short">P</span></button>
                    <button class="status-toggle status-toggle-absent${att.status === 'absent' ? ' active-absent' : ''}" onclick="attendanceDashboard.toggleStatus('${_escapeHtml(student.id)}','absent')"><span class="st-full">Absent</span><span class="st-short">A</span></button>
                    <button class="status-toggle status-toggle-ph${att.status === 'ph' ? ' active-ph' : ''}" onclick="attendanceDashboard.toggleStatus('${_escapeHtml(student.id)}','ph')" title="Public Holiday">PH</button>
                    <button class="status-toggle status-toggle-mtb${att.status === 'mtb' ? ' active-mtb' : ''}" onclick="attendanceDashboard.toggleStatus('${_escapeHtml(student.id)}','mtb')" title="Mid-Term Break">MTB</button>
                </div>
            </div>`;
        });

        $studentList.innerHTML = html;
        if ($actionBar) $actionBar.style.display = 'flex';
    }

    // ---------- controls collapse (declutter once a roster is showing) ----------
    // Once class + sheet + date are all chosen, the selection dropdowns fold
    // away into a slim summary strip so the roster gets the whole screen.
    // Tapping "Change" on the strip re-opens the dropdowns.
    function _applyControlsVisibility() {
        const controls = $markView ? $markView.querySelector('.attendance-controls') : null;
        const summary = document.getElementById('selection-summary');
        if (!controls || !summary) return;

        const fullSelection = !!(state.currentClass && state.selectedSheet && state.currentColumnKey);
        const collapse = fullSelection && !state.controlsOpen;

        controls.style.display = collapse ? 'none' : '';
        summary.style.display = collapse ? 'flex' : 'none';

        if (collapse) {
            const classText = ($classSelect && $classSelect.selectedOptions[0])
                ? $classSelect.selectedOptions[0].text : state.currentClass;
            const sheetText = state.selectedSheet
                ? (state.selectedSheet.subject || (state.selectedSheet.kind === 'form' ? 'Form register' : 'Sheet'))
                : '';
            const dateOpt = ($dateSelect && $dateSelect.options[$dateSelect.selectedIndex]) || null;
            const dateText = dateOpt ? dateOpt.text : (state.currentDate || '');
            const titleEl = document.getElementById('sel-summary-title');
            const dateEl = document.getElementById('sel-summary-date');
            if (titleEl) titleEl.textContent = sheetText ? (classText + ' · ' + sheetText) : classText;
            if (dateEl) dateEl.textContent = dateText;
        }
    }

    // Re-open the selection dropdowns from the summary strip
    function showControls() {
        state.controlsOpen = true;
        _applyControlsVisibility();
    }

    // ---------- stats ----------
    function _renderStats() {
        let present = 0, absent = 0, ph = 0, mtb = 0, unmarked = 0;
        state.students.forEach(s => {
            const att = state.attendance[s.id];
            if (!att || !att.status) unmarked++;
            else if (att.status === 'present') present++;
            else if (att.status === 'absent') absent++;
            else if (att.status === 'ph') ph++;
            else if (att.status === 'mtb') mtb++;
        });
        if ($statPresent) $statPresent.textContent = present;
        if ($statAbsent) $statAbsent.textContent = absent;
        if ($statPh) $statPh.textContent = ph;
        if ($statMtb) $statMtb.textContent = mtb;
        if ($statUnmarked) $statUnmarked.textContent = unmarked;
    }

    // ---------- actions ----------
    function toggleStatus(studentId, status) {
        if (SUPPORTED_STATUSES.indexOf(status) === -1) return;
        if (!state.attendance[studentId]) {
            state.attendance[studentId] = { status: '' };
        }
        // Toggle off if same status clicked again
        if (state.attendance[studentId].status === status) {
            state.attendance[studentId].status = '';
        } else {
            state.attendance[studentId].status = status;
        }
        _renderStudentList();
        _renderStats();
    }

    function markAllAs(status) {
        if (SUPPORTED_STATUSES.indexOf(status) === -1) return;
        state.students.forEach(s => {
            if (!state.attendance[s.id]) {
                state.attendance[s.id] = { status: '' };
            }
            state.attendance[s.id].status = status;
        });
        _renderStudentList();
        _renderStats();
    }

    async function saveAttendance() {
        if (state.saving) return;
        if (!state.selectedSheet || !state.currentColumnKey || state.students.length === 0) {
            _showToast('Pick a class, sheet, and date before saving.', 'warning');
            return;
        }

        const user = dataService.getCurrentUser();
        if (!user) return;

        const sheet = state.selectedSheet;
        const columnKey = state.currentColumnKey;
        const date = state.currentDate;
        const markedByName = user.name || user.full_name || user.username || '';

        // Split students into writes (have a status) and clears (unmarked — only need clearing if they previously had a saved mark).
        const toMark = [];
        const toClear = [];
        state.students.forEach(s => {
            const att = state.attendance[s.id];
            if (att && att.status) {
                toMark.push({ studentId: s.id, status: att.status });
            } else {
                // Clear is only needed if there was a saved mark we know about; we'll send clears regardless — the API is a no-op on missing rows.
                toClear.push(s.id);
            }
        });

        if (toMark.length === 0) {
            _showToast('No students have been marked yet.', 'warning');
            return;
        }

        state.saving = true;
        const saveBtn = document.getElementById('save-attendance-btn') ||
            ($actionBar ? $actionBar.querySelector('.btn:last-child') : null);
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
        }
        const saveIconBtn = document.getElementById('save-attendance-topbar');
        if (saveIconBtn) {
            saveIconBtn.disabled = true;
            saveIconBtn.classList.add('saving');
        }

        let saved = 0;
        let failed = 0;
        const errors = [];

        try {
            const markResults = await Promise.all(toMark.map(function(item) {
                return dataService.markSheetCell({
                    sheetId: sheet.id,
                    studentId: item.studentId,
                    columnKey: columnKey,
                    date: date,
                    status: item.status,
                    markedBy: user.id,
                    markedByName: markedByName
                }).then(function() { saved++; })
                  .catch(function(err) { failed++; errors.push(err); });
            }));

            // Clears are best-effort; don't block save success on them.
            await Promise.all(toClear.map(function(sid) {
                return dataService.clearSheetCell(sheet.id, sid, columnKey).catch(function() {});
            }));

            if (failed > 0) {
                console.warn('[Attendance] Partial save failures:', errors);
                _showToast(`Saved ${saved}, failed ${failed}. Check console.`, 'warning');
            } else {
                _showToast(`Attendance saved for ${saved} student${saved !== 1 ? 's' : ''}.`, 'success');
            }
        } catch (error) {
            console.error('[Attendance] Save error:', error);
            _showToast('Failed to save attendance. Please try again.', 'error');
        } finally {
            state.saving = false;
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Attendance';
            }
            if (saveIconBtn) {
                saveIconBtn.disabled = false;
                saveIconBtn.classList.remove('saving');
            }
        }
    }

    // ---------- view switching ----------
    function switchView(view) {
        // Update tab active states across both views
        document.querySelectorAll('.attendance-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });

        var $sheetsView = document.getElementById('sheets-view');

        // Topbar save icon (mobile) only makes sense while marking
        var $topbarSave = document.getElementById('save-attendance-topbar');
        if ($topbarSave) $topbarSave.style.display = (view === 'mark') ? '' : 'none';

        if (view === 'mark') {
            if ($markView) $markView.style.display = 'flex';
            if ($historyView) $historyView.style.display = 'none';
            if ($sheetsView) $sheetsView.style.display = 'none';
        } else if (view === 'history') {
            if ($markView) $markView.style.display = 'none';
            if ($historyView) $historyView.style.display = 'flex';
            if ($sheetsView) $sheetsView.style.display = 'none';
            // Sync class selection
            if ($historyClassSelect && state.currentClass) {
                $historyClassSelect.value = state.currentClass;
            }
        } else if (view === 'sheets') {
            if ($markView) $markView.style.display = 'none';
            if ($historyView) $historyView.style.display = 'none';
            if ($sheetsView) $sheetsView.style.display = 'flex';
            if (window.attendanceSheetsDashboard?.refresh) {
                window.attendanceSheetsDashboard.refresh();
            }
        }

        // Update sidebar nav active state
        const sidebarItems = document.querySelectorAll('.sidebar-nav .sidebar-nav-item');
        sidebarItems.forEach(item => {
            const label = item.querySelector('.sidebar-nav-label');
            if (!label) return;
            const text = label.textContent.trim().toLowerCase();
            if (view === 'mark' && text === 'mark attendance') {
                item.classList.add('active');
            } else if (view === 'history' && text === 'history') {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });

        // Update bottom nav
        const bottomItems = document.querySelectorAll('.bottom-nav .bottom-nav-item');
        bottomItems.forEach(item => {
            const label = item.querySelector('span:last-child');
            if (!label) return;
            const text = label.textContent.trim().toLowerCase();
            if (view === 'mark' && text === 'mark') {
                item.classList.add('active');
            } else if (view === 'history' && text === 'history') {
                item.classList.add('active');
            } else if (view === 'sheets' && text === 'sheets') {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
    }

    // ---------- event handlers ----------
    function onClassChange() {
        if ($classSelect) {
            state.currentClass = $classSelect.value;
        }
        state.controlsOpen = false;
        _loadSheetsForClass();
    }

    function onSheetChange() {
        if (!$sheetSelect) return;
        const sheetId = $sheetSelect.value;
        state.selectedSheet = state.sheets.find(function(s) { return s.id === sheetId; }) || null;
        state.controlsOpen = false;
        _populateDateSelect();
        _loadSheetRoster();
    }

    function onDateChange() {
        if (!$dateSelect) return;
        state.currentColumnKey = $dateSelect.value;
        const opt = $dateSelect.options[$dateSelect.selectedIndex];
        state.currentDate = opt ? (opt.getAttribute('data-date') || '') : '';
        state.controlsOpen = false;
        _loadSheetRoster();
    }

    function onHistoryClassChange() {
        loadHistory();
    }

    // ---------- history ----------
    async function loadHistory() {
        const classLevel = $historyClassSelect ? $historyClassSelect.value : '';
        const startDate = $historyStartDate ? $historyStartDate.value : '';
        const endDate = $historyEndDate ? $historyEndDate.value : '';

        if (!classLevel || !startDate || !endDate) {
            if ($historyContent) {
                $historyContent.innerHTML = `
                    <div class="attendance-empty">
                        <div class="attendance-empty-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        </div>
                        <p style="font-weight:700; font-size:1rem; color:var(--text-color);">Select a class and date range</p>
                        <p style="font-size:0.88rem;">Choose a class and date range to view attendance history.</p>
                    </div>`;
            }
            return;
        }

        if ($historyContent) {
            $historyContent.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Loading history...</p></div>';
        }

        try {
            const stats = await dataService.getAttendanceStats(classLevel, startDate, endDate);
            _renderHistoryTable(stats);
        } catch (error) {
            console.error('[AttendanceDashboard] History load error:', error);
            if ($historyContent) {
                $historyContent.innerHTML = '<div class="attendance-empty"><p style="font-weight:700; color:#e74c3c;">Failed to load history. Please try again.</p></div>';
            }
        }
    }

    function _renderHistoryTable(stats) {
        if (!$historyContent) return;

        if (!stats.students || stats.students.length === 0) {
            $historyContent.innerHTML = `
                <div class="attendance-empty">
                    <div class="attendance-empty-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </div>
                    <p style="font-weight:700; font-size:1rem; color:var(--text-color);">No attendance records found</p>
                    <p style="font-size:0.88rem;">No attendance has been recorded for this class in the selected date range.</p>
                </div>`;
            return;
        }

        // Sort students alphabetically
        const students = Array.from(stats.students).sort((a, b) => a.studentName.localeCompare(b.studentName));

        let html = `<table class="attendance-history-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>Student</th>
                    <th>Present</th>
                    <th>Absent</th>
                    <th>Late</th>
                    <th>Excused</th>
                    <th>Rate</th>
                </tr>
            </thead>
            <tbody>`;

        students.forEach((s, i) => {
            const rateColor = s.attendanceRate >= 80 ? '#27ae60' : s.attendanceRate >= 60 ? '#f39c12' : '#e74c3c';
            html += `<tr>
                <td>${i + 1}</td>
                <td style="font-weight:700;">${_escapeHtml(s.studentName)}</td>
                <td><span class="status-indicator present"></span> ${s.present}</td>
                <td><span class="status-indicator absent"></span> ${s.absent}</td>
                <td><span class="status-indicator late"></span> ${s.late}</td>
                <td><span class="status-indicator excused"></span> ${s.excused}</td>
                <td>
                    <span style="font-weight:700; color:${rateColor};">${s.attendanceRate}%</span>
                    <span class="attendance-rate-bar"><span class="attendance-rate-fill" style="width:${s.attendanceRate}%; background:${rateColor};"></span></span>
                </td>
            </tr>`;
        });

        html += '</tbody></table>';

        // Summary row
        const totalStudents = students.length;
        const avgRate = totalStudents > 0
            ? Math.round(students.reduce((sum, s) => sum + s.attendanceRate, 0) / totalStudents)
            : 0;

        html = `<div style="margin-bottom:16px; display:flex; gap:16px; flex-wrap:wrap; align-items:center;">
            <span style="font-weight:700; font-size:0.95rem; color:var(--text-color);">${stats.totalDays} day${stats.totalDays !== 1 ? 's' : ''} recorded</span>
            <span style="font-size:0.88rem; color:var(--light-text);">${totalStudents} student${totalStudents !== 1 ? 's' : ''}</span>
            <span style="font-size:0.88rem; color:var(--light-text);">Avg. attendance: <strong>${avgRate}%</strong></span>
        </div>` + html;

        $historyContent.innerHTML = html;
    }

    // ---------- toast notification ----------
    function _showToast(message, type) {
        // Remove existing toast
        const existing = document.getElementById('attendance-toast');
        if (existing) existing.remove();

        const colors = {
            success: '#27ae60',
            warning: '#f39c12',
            error: '#e74c3c'
        };

        const toast = document.createElement('div');
        toast.id = 'attendance-toast';
        toast.style.cssText = `
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            padding: 12px 24px; border-radius: 10px; font-weight: 700; font-size: 0.88rem;
            color: white; background: ${colors[type] || '#333'};
            box-shadow: 0 4px 16px rgba(0,0,0,0.2); z-index: 9999;
            animation: toast-in 0.3s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        // Add animation keyframes if not already added
        if (!document.getElementById('toast-keyframes')) {
            const style = document.createElement('style');
            style.id = 'toast-keyframes';
            style.textContent = `@keyframes toast-in { from { opacity:0; transform:translateX(-50%) translateY(10px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
            document.head.appendChild(style);
        }

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ---------- public API ----------
    var _initialized = false;
    function guardedInit() {
        if (_initialized) return;
        _initialized = true;
        init();
    }

    window.attendanceDashboard = {
        init: guardedInit,
        onClassChange,
        onSheetChange,
        onDateChange,
        onHistoryClassChange,
        toggleStatus,
        markAllAs,
        saveAttendance,
        switchView,
        showControls,
        loadHistory
    };

    // Auto-init: handles both dynamic loading (readyState complete) and static loading
    if (document.readyState !== 'loading') {
        guardedInit();
    } else {
        document.addEventListener('DOMContentLoaded', guardedInit);
    }

})();
