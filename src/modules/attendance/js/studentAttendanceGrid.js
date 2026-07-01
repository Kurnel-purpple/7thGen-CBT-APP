/**
 * Student Attendance Grid (read-only)
 * Shows the student's own row across every subject sheet they're registered for
 * plus the form-teacher sheet for their class. Cells reflect marks — not clickable.
 * Depends on attendanceSheetsDataService.
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

    var state = {
        user: null,
        classLevel: '',
        _initialized: false
    };

    async function init() {
        if (state._initialized) return;
        state._initialized = true;

        var user = window.dataService?.getCurrentUser?.();
        if (!user || user.role !== 'student') return;
        state.user = user;
        state.classLevel = user.classLevel || user.class_level || '';

        await refresh();
    }

    async function refresh() {
        var wrap = document.getElementById('student-grid-wrap');
        if (!wrap) return;

        if (!state.classLevel) {
            wrap.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Your class is not set.</p></div>';
            return;
        }

        wrap.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Loading your attendance grid…</p></div>';

        try {
            var ds = window.dataService;

            // 1. Get the student's registrations → subject sheets they belong to
            var regs = await ds.listSubjectRegistrations({
                studentId: state.user.id,
                classLevel: state.classLevel
            });

            // 2. Get all sheets for their class
            var allSheets = await ds.listAttendanceSheets({ classLevel: state.classLevel });

            // Filter: form sheets for this class + subject sheets where student is registered OR on manualRoster
            var regKeys = new Set();
            regs.forEach(function(r) {
                regKeys.add((r.subject || '') + '|' + (r.term || '') + '|' + (r.session || ''));
            });

            var myId = state.user.id;
            var mySheets = allSheets.filter(function(s) {
                if (s.kind === 'form') return true;
                var k = (s.subject || '') + '|' + (s.term || '') + '|' + (s.session || '');
                if (regKeys.has(k)) return true;
                if (Array.isArray(s.manualRoster) && s.manualRoster.indexOf(myId) !== -1) return true;
                return false;
            });

            if (!mySheets.length) {
                wrap.innerHTML =
                    '<div class="attendance-empty">' +
                        '<div class="attendance-empty-icon">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>' +
                        '</div>' +
                        '<p style="font-weight:700; color:var(--text-color);">No attendance sheets yet</p>' +
                        '<p style="font-size:0.88rem;">Register for subjects on the <strong>My Subjects</strong> tab to start tracking your attendance.</p>' +
                    '</div>';
                return;
            }

            // 3. Pull marks for each sheet in parallel (only this student's marks needed,
            //    but the service returns all — we filter client-side)
            var markSets = await Promise.all(mySheets.map(function(s) {
                return ds.getSheetMarks(s.id).catch(function() { return []; });
            }));

            // For form sheets we also want the aggregated progress ring
            var progressForms = {};
            await Promise.all(mySheets.map(async function(s) {
                if (s.kind !== 'form') return;
                try {
                    progressForms[s.id] = await ds.getFormSheetProgress(s);
                } catch (e) { /* non-fatal */ }
            }));

            // 4. Render
            var html = '';
            mySheets.forEach(function(sheet, i) {
                var myMarks = {};
                (markSets[i] || []).forEach(function(m) {
                    if (m.studentId !== myId) return;
                    if (!m.columnKey) return;
                    myMarks[m.columnKey] = m;
                });
                html += renderSheetStrip(sheet, myMarks, progressForms[sheet.id] || null);
            });
            wrap.innerHTML = html;
        } catch (e) {
            console.error('[StudentGrid] refresh failed:', e);
            wrap.innerHTML = '<div class="attendance-empty"><p style="color:#e74c3c; font-weight:700;">Failed to load attendance grid.</p></div>';
        }
    }

    function renderSheetStrip(sheet, myMarks, progress) {
        var cols = Array.isArray(sheet.columns) ? sheet.columns : [];
        var kindLabel = sheet.kind === 'form'
            ? '<span class="sheet-badge sheet-badge-form">Form Register</span>'
            : '<span class="sheet-badge sheet-badge-subject">Subject</span>';
        var title = sheet.kind === 'form'
            ? 'Daily Register'
            : (sheet.subject || 'Subject');

        // Summary
        var totalCols = cols.length;
        var presentCount = 0;
        cols.forEach(function(c) {
            if (sheet.kind === 'form') {
                var p = progress && progress[state.user.id] && progress[state.user.id][c.date];
                var manual = !!(p && p.manual);
                var ringFull = p && p.total > 0 && p.marked >= p.total;
                if (manual || ringFull) presentCount++;
            } else {
                var m = myMarks[c.key];
                // PH and MTB count as marked attendance
                if (m && (m.status === 'present' || m.status === 'ph' || m.status === 'mtb')) presentCount++;
            }
        });
        var pct = totalCols ? Math.round((presentCount / totalCols) * 100) : 0;

        var header =
            '<div class="stud-strip-head">' +
                '<div class="stud-strip-title-wrap">' +
                    kindLabel +
                    '<div class="stud-strip-title">' + escapeHtml(title) + '</div>' +
                    '<div class="stud-strip-meta">' +
                        (sheet.term ? escapeHtml(sheet.term) + ' · ' : '') +
                        (sheet.teacherName ? escapeHtml(sheet.teacherName) : '') +
                    '</div>' +
                '</div>' +
                '<div class="stud-strip-summary">' +
                    '<div class="stud-strip-pct" style="color:' + (pct >= 75 ? '#1a9a5b' : pct >= 50 ? '#f39c12' : '#e74c3c') + ';">' + pct + '%</div>' +
                    '<div class="stud-strip-count">' + presentCount + '/' + totalCols + '</div>' +
                '</div>' +
            '</div>';

        if (!cols.length) {
            return '<div class="stud-strip">' + header + '<div class="attendance-empty" style="padding:12px 0;"><p style="color:var(--light-text); font-size:0.85rem;">No columns.</p></div></div>';
        }

        var body = '<div class="stud-strip-scroll"><table class="mark-grid stud-strip-grid"><thead><tr>';
        cols.forEach(function(c) {
            body += '<th class="mg-col-head" title="' + escapeHtml(c.date || '') + '">' +
                        '<div class="mg-col-head-label">' + escapeHtml(c.label || c.key) + '</div>' +
                        (c.date ? '<div class="mg-col-head-date">' + escapeHtml(shortDate(c.date)) + '</div>' : '') +
                    '</th>';
        });
        body += '</tr></thead><tbody><tr>';
        cols.forEach(function(c) {
            body += renderStudentCell(sheet, c, myMarks, progress);
        });
        body += '</tr></tbody></table></div>';

        return '<div class="stud-strip">' + header + body + '</div>';
    }

    function renderStudentCell(sheet, col, myMarks, progress) {
        if (sheet.kind === 'form') {
            var p = progress && progress[state.user.id] && progress[state.user.id][col.date];
            var marked = p ? p.marked : 0;
            var total = p ? p.total : 0;
            var manual = !!(p && p.manual);
            var fullyPresent = manual || (total > 0 && marked >= total);
            if (fullyPresent) {
                return '<td class="mg-cell mg-cell-subject mg-cell-present" title="Present' + (manual ? ' (manual)' : '') + '"><span class="mg-check">&#10003;</span></td>';
            }
            if (total > 0) {
                return '<td class="mg-cell mg-cell-form" title="' + marked + '/' + total + ' subject sheets marked present">' +
                           '<span class="mg-ring" style="background: conic-gradient(var(--primary-color, #1A73E8) ' +
                               Math.round((marked / total) * 100) + '%, #e0e0e0 ' +
                               Math.round((marked / total) * 100) + '%);">' +
                               '<span class="mg-ring-inner">' + marked + '/' + total + '</span>' +
                           '</span>' +
                       '</td>';
            }
            return '<td class="mg-cell mg-cell-empty" title="No record"></td>';
        }

        var m = myMarks[col.key];
        if (m && m.status === 'present') {
            return '<td class="mg-cell mg-cell-subject mg-cell-present" title="Present"><span class="mg-check">&#10003;</span></td>';
        }
        if (m && m.status === 'ph') {
            return '<td class="mg-cell mg-cell-subject mg-cell-ph" title="Public holiday"><span class="mg-status-label">PH</span></td>';
        }
        if (m && m.status === 'mtb') {
            return '<td class="mg-cell mg-cell-subject mg-cell-mtb" title="Mid-term break"><span class="mg-status-label">MTB</span></td>';
        }
        if (m && m.status === 'absent') {
            return '<td class="mg-cell mg-cell-subject mg-cell-absent" title="Absent"><span class="mg-status-label">A</span></td>';
        }
        // Auto-absent: past date with no mark
        if (col.date && col.date < _todayLocalIso()) {
            return '<td class="mg-cell mg-cell-subject mg-cell-absent mg-cell-auto-absent" title="Absent (no mark recorded)"><span class="mg-status-label">A</span></td>';
        }
        return '<td class="mg-cell mg-cell-empty" title="Not yet"></td>';
    }

    function _todayLocalIso() {
        var d = new Date();
        return d.getFullYear() + '-' +
               String(d.getMonth() + 1).padStart(2, '0') + '-' +
               String(d.getDate()).padStart(2, '0');
    }

    function shortDate(iso) {
        if (!iso) return '';
        var parts = iso.split('-');
        if (parts.length !== 3) return iso;
        return parts[2] + '/' + parts[1];
    }

    window.studentAttendanceGrid = {
        init: init,
        refresh: refresh
    };

    if (document.readyState !== 'loading') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
