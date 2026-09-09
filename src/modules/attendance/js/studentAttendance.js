/**
 * Student Attendance Controller
 * Read-only view of the logged-in student's own attendance record.
 */

(function() {
    'use strict';

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

    // DOM refs
    let $loadingState, $content, $startDate, $endDate, $dayList;
    let $statRate, $statPresent, $statAbsent, $statLate;

    let _userId = '';

    function _cacheDom() {
        $loadingState = document.getElementById('loading-state');
        $content = document.getElementById('student-attendance-content');
        $startDate = document.getElementById('student-start-date');
        $endDate = document.getElementById('student-end-date');
        $dayList = document.getElementById('attendance-day-list');
        $statRate = document.getElementById('stat-rate');
        $statPresent = document.getElementById('stat-present-count');
        $statAbsent = document.getElementById('stat-absent-count');
        $statLate = document.getElementById('stat-late-count');
    }

    async function init() {
        _cacheDom();

        // Auth gate — must be a student
        const user = dataService.getCurrentUser();
        if (!user) {
            window.location.href = '../index.html';
            return;
        }

        _userId = user.id || user.user || '';

        // Show user info in sidebar
        const nameEl = document.getElementById('user-name');
        if (nameEl) nameEl.textContent = user.full_name || user.username || 'Student';
        const avatarEl = document.getElementById('sidebar-avatar');
        if (avatarEl) avatarEl.textContent = (user.full_name || user.username || 'S').charAt(0).toUpperCase();
        const roleEl = document.querySelector('.sidebar-profile-role');
        if (roleEl) roleEl.textContent = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Student';

        // Default date range: start of current term/month → today
        const today = _todayISO();
        if ($startDate) $startDate.value = today.slice(0, 8) + '01'; // first of current month
        if ($endDate) $endDate.value = today;

        // Hide loading, show content
        if ($loadingState) $loadingState.style.display = 'none';
        if ($content) $content.style.display = 'flex';

        await loadAttendance();
    }

    async function loadAttendance() {
        const startDate = $startDate ? $startDate.value : '';
        const endDate = $endDate ? $endDate.value : '';

        if (!_userId || !startDate || !endDate) return;

        if ($dayList) {
            $dayList.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Loading...</p></div>';
        }

        try {
            // Two sources, because attendance moved from the standalone `attendance`
            // collection to sheet marks and the old rows were never migrated. Reading
            // only the legacy one left the stat cards at zero and the list showing
            // "No records found" directly above a grid full of real marks.
            const user = dataService.getCurrentUser?.() || {};
            const classLevel = user.classLevel || user.class_level || '';

            const [legacy, fromSheets] = await Promise.all([
                dataService.getAttendanceByStudent(_userId, startDate, endDate)
                    .catch(() => []),
                (typeof dataService.getStudentAttendanceHistory === 'function'
                    ? dataService.getStudentAttendanceHistory(_userId, {
                        classLevel: classLevel, startDate: startDate, endDate: endDate
                      })
                    : Promise.resolve([])).catch(() => [])
            ]);

            // Sheet marks win on a clash: one date can appear in both stores, and the
            // sheet is where marking actually happens now.
            const byDate = {};
            (legacy || []).forEach(r => { if (r && r.date) byDate[r.date + '|legacy'] = r; });
            (fromSheets || []).forEach(r => { byDate[r.date + '|' + (r.sheetId || '')] = r; });

            const records = Object.keys(byDate).map(k => byDate[k])
                .sort((a, b) => String(b.date).localeCompare(String(a.date)));

            _renderStats(records);
            _renderDayList(records);
        } catch (error) {
            console.error('[StudentAttendance] Load error:', error);
            if ($dayList) {
                $dayList.innerHTML = '<div class="attendance-empty"><p style="font-weight:700; color:#e74c3c;">Failed to load attendance. Please try again.</p></div>';
            }
        }
    }

    function _renderStats(records) {
        // Sheet vocabulary: present | absent | ph (public holiday) | mtb (mid-term
        // break). `late` and `excused` only ever came from the legacy collection and
        // are still counted so old records keep reading correctly.
        let present = 0, absent = 0, late = 0, excused = 0, offDays = 0;
        records.forEach(r => {
            if (r.status === 'present') present++;
            else if (r.status === 'absent') absent++;
            else if (r.status === 'late') late++;
            else if (r.status === 'excused') excused++;
            else if (r.status === 'ph' || r.status === 'mtb') offDays++;
        });

        // Public holidays and mid-term breaks are not school days — counting them in
        // the denominator would quietly drag every student's rate down.
        const total = present + absent + late + excused;
        const attended = present + late + excused; // late and excused still count as attended
        const rate = total > 0 ? Math.round((attended / total) * 100) : 0;

        const rateColor = rate >= 80 ? '#27ae60' : rate >= 60 ? '#f39c12' : '#e74c3c';

        if ($statRate) {
            $statRate.textContent = total > 0 ? rate + '%' : '--%';
            $statRate.style.color = rateColor;
        }
        if ($statPresent) $statPresent.textContent = present;
        if ($statAbsent) $statAbsent.textContent = absent;
        // No "late" status exists in the sheet system, so this card would always read
        // zero for anyone marked on a sheet. It shows non-teaching days instead when
        // that is all there is to report.
        if ($statLate) $statLate.textContent = late || offDays;
        const lateLabel = document.getElementById('stat-late-label');
        if (lateLabel) lateLabel.textContent = (!late && offDays) ? 'Holiday / Break' : 'Late';
    }

    function _renderDayList(records) {
        if (!$dayList) return;

        if (records.length === 0) {
            $dayList.innerHTML = `
                <div class="attendance-empty">
                    <div class="attendance-empty-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
                    </div>
                    <p style="font-weight:700; font-size:1rem; color:var(--text-color);">No records found</p>
                    <p style="font-size:0.88rem;">No attendance has been recorded for you in this date range.</p>
                </div>`;
            return;
        }

        // Sheet statuses are codes, not words — "Ph" and "Mtb" would be meaningless
        // to a student, so they get spelled out.
        const STATUS_LABELS = {
            present: 'Present',
            absent: 'Absent',
            late: 'Late',
            excused: 'Excused',
            ph: 'Public Holiday',
            mtb: 'Mid-Term Break'
        };

        // Records come sorted by -date
        let html = '';
        records.forEach(r => {
            const status = r.status || 'unknown';
            const statusLabel = STATUS_LABELS[status]
                || (status.charAt(0).toUpperCase() + status.slice(1));
            // Subject tells a student which class the mark came from — without it, a
            // day with several subject periods looks like duplicate rows.
            const context = r.subject || r.note || '';
            html += `<div class="student-attendance-day">
                <span class="day-date">${_escapeHtml(_formatDate(r.date))}</span>
                <span class="day-status ${_escapeHtml(status)}">${_escapeHtml(statusLabel)}</span>
                ${context ? `<span style="flex:1; font-size:0.85rem; color:var(--light-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_escapeHtml(context)}</span>` : ''}
            </div>`;
        });

        $dayList.innerHTML = html;
    }

    // Public API
    var _initialized = false;
    function guardedInit() {
        if (_initialized) return;
        _initialized = true;
        init();
    }

    window.studentAttendance = {
        init: guardedInit,
        loadAttendance
    };

    // Auto-init: handles both dynamic loading (readyState complete) and static loading
    if (document.readyState !== 'loading') {
        guardedInit();
    } else {
        document.addEventListener('DOMContentLoaded', guardedInit);
    }

})();
