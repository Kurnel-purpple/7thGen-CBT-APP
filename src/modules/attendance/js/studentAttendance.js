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
            const records = await dataService.getAttendanceByStudent(_userId, startDate, endDate);
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
        let present = 0, absent = 0, late = 0, excused = 0;
        records.forEach(r => {
            if (r.status === 'present') present++;
            else if (r.status === 'absent') absent++;
            else if (r.status === 'late') late++;
            else if (r.status === 'excused') excused++;
        });

        const total = records.length;
        const attended = present + late; // late still counts as attended
        const rate = total > 0 ? Math.round((attended / total) * 100) : 0;

        const rateColor = rate >= 80 ? '#27ae60' : rate >= 60 ? '#f39c12' : '#e74c3c';

        if ($statRate) {
            $statRate.textContent = total > 0 ? rate + '%' : '--%';
            $statRate.style.color = rateColor;
        }
        if ($statPresent) $statPresent.textContent = present;
        if ($statAbsent) $statAbsent.textContent = absent;
        if ($statLate) $statLate.textContent = late;
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

        // Records come sorted by -date from the data service
        let html = '';
        records.forEach(r => {
            const status = r.status || 'unknown';
            const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
            html += `<div class="student-attendance-day">
                <span class="day-date">${_escapeHtml(_formatDate(r.date))}</span>
                <span class="day-status ${_escapeHtml(status)}">${_escapeHtml(statusLabel)}</span>
                ${r.note ? `<span style="flex:1; font-size:0.85rem; color:var(--light-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${_escapeHtml(r.note)}</span>` : ''}
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
