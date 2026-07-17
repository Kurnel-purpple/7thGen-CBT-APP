/**
 * Broadsheet Dashboard Controller
 * Admin/teacher view: class-wide term broadsheet (CA | Exam | Total per
 * subject, grand total, percentage, position) and end-of-session broadsheet
 * (term totals summed across 1st–3rd term).
 */

(function() {
    'use strict';

    var state = {
        academic: null,
        currentView: 'term',
        termSheet: null,
        sessionSheet: null
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function ordinalSuffix(n) {
        var s = ['th', 'st', 'nd', 'rd'];
        var v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function fmt(n) {
        if (n === null || n === undefined) return '—';
        return String(n);
    }

    // ================================================================
    // VIEW SWITCHING
    // ================================================================

    function switchView(view) {
        state.currentView = view;
        document.querySelectorAll('.bs-view').forEach(function(el) {
            el.classList.toggle('active', el.id === 'bs-view-' + view);
        });
        document.querySelectorAll('[data-bs-nav]').forEach(function(el) {
            el.classList.toggle('active', el.getAttribute('data-bs-nav') === view);
        });
        var subtitle = document.getElementById('topbar-subtitle');
        if (subtitle) {
            var labels = { term: 'Term Broadsheet', session: 'Session Broadsheet' };
            subtitle.textContent = labels[view] || 'Broadsheet';
        }
    }

    // ================================================================
    // FORM SETUP
    // ================================================================

    function populateClassDropdowns(academic) {
        if (!academic) return;
        var allClasses = [];
        Object.values(academic.classesByLevel || {}).forEach(function(list) {
            list.forEach(function(c) { allClasses.push(c); });
        });
        var options = '<option value="">Select Class</option>' + allClasses.map(function(c) {
            return '<option value="' + escapeHtml(c.value) + '">' + escapeHtml(c.text) + '</option>';
        }).join('');

        ['bs-class', 'bs-session-class'].forEach(function(id) {
            var select = document.getElementById(id);
            if (select) select.innerHTML = options;
        });
    }

    // ================================================================
    // TERM BROADSHEET
    // ================================================================

    async function handleGenerateTerm(event) {
        event.preventDefault();

        var classLevel = document.getElementById('bs-class')?.value;
        var term = document.getElementById('bs-term')?.value;
        var session = document.getElementById('bs-session-input')?.value || '';

        if (!classLevel || !term) {
            alert('Please select a class and term.');
            return;
        }

        var btn = document.getElementById('bs-generate-btn');
        var statusEl = document.getElementById('bs-gen-status');
        if (btn) { btn.disabled = true; btn.textContent = 'Compiling...'; }
        if (statusEl) statusEl.textContent = 'Fetching results and compiling the broadsheet...';

        try {
            var sheet = await window.dataService.generateBroadsheetData({
                classLevel: classLevel,
                term: term,
                session: session
            });
            state.termSheet = sheet;

            if (sheet.students.length === 0) {
                if (statusEl) statusEl.textContent = 'No students found in ' + classLevel + '.';
                document.getElementById('bs-term-result').style.display = 'none';
                return;
            }

            if (statusEl) statusEl.textContent = '';
            renderTermSheet(sheet);
        } catch (err) {
            console.error('[Broadsheet] term generate failed:', err);
            if (statusEl) statusEl.textContent = 'Error: ' + (err.message || 'Could not compile broadsheet');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Compile Broadsheet'; }
        }
    }

    function renderTermSheet(sheet) {
        var wrap = document.getElementById('bs-term-result');
        var titleEl = document.getElementById('bs-term-title');
        var metaEl = document.getElementById('bs-term-meta');
        var container = document.getElementById('bs-term-table');
        if (!wrap || !container) return;

        wrap.style.display = '';
        if (titleEl) titleEl.textContent = sheet.classLevel + ' — ' + sheet.term + ' Broadsheet';
        if (metaEl) {
            metaEl.textContent = (sheet.session ? sheet.session + ' Session | ' : '') +
                sheet.classSize + ' student' + (sheet.classSize !== 1 ? 's' : '') + ' | ' +
                sheet.subjects.length + ' subject' + (sheet.subjects.length !== 1 ? 's' : '') +
                ' | Class average: ' + sheet.overallAverage + '%';
        }

        if (sheet.subjects.length === 0) {
            container.innerHTML = '<p style="color:var(--light-text); padding:20px 0;">No completed exam results match ' +
                escapeHtml(sheet.term) + ' for this class yet.</p>';
            return;
        }

        var html = '<div class="bs-table-scroll"><table class="bs-table">';

        // Header row 1: subject group headers
        html += '<thead><tr>' +
            '<th rowspan="2" class="bs-col-index">#</th>' +
            '<th rowspan="2" class="bs-col-student">Student</th>';
        sheet.subjects.forEach(function(name) {
            html += '<th colspan="3" class="bs-subject-group" title="' + escapeHtml(name) + '">' + escapeHtml(name) + '</th>';
        });
        html += '<th rowspan="2" class="bs-col-total">Total</th>' +
            '<th rowspan="2" class="bs-col-pct">%</th>' +
            '<th rowspan="2" class="bs-col-pos">Pos</th>' +
            '</tr>';

        // Header row 2: CA | Exam | Tot per subject
        html += '<tr>';
        sheet.subjects.forEach(function() {
            html += '<th class="bs-sub-col">CA</th><th class="bs-sub-col">Exam</th><th class="bs-sub-col bs-sub-tot">Tot</th>';
        });
        html += '</tr></thead><tbody>';

        sheet.students.forEach(function(row, index) {
            html += '<tr>' +
                '<td class="bs-col-index">' + (index + 1) + '</td>' +
                '<td class="bs-col-student" title="' + escapeHtml(row.studentName) + '">' + escapeHtml(row.studentName) + '</td>';
            sheet.subjects.forEach(function(name) {
                var cell = row.cells[name];
                if (!cell) {
                    html += '<td class="bs-cell bs-cell-empty">—</td><td class="bs-cell bs-cell-empty">—</td><td class="bs-cell bs-cell-empty bs-sub-tot">—</td>';
                } else {
                    html += '<td class="bs-cell">' + fmt(cell.ca) + '</td>' +
                        '<td class="bs-cell">' + fmt(cell.exam) + '</td>' +
                        '<td class="bs-cell bs-sub-tot" title="' + cell.total + ' / ' + cell.totalPossible + ' (' + cell.percentage + '%, ' + escapeHtml(cell.grade || '') + ')">' + fmt(cell.total) + '</td>';
                }
            });
            html += '<td class="bs-col-total" title="out of ' + row.grandPossible + '">' + row.grandTotal + '</td>' +
                '<td class="bs-col-pct">' + row.percentage + '%</td>' +
                '<td class="bs-col-pos">' + positionBadge(row.position) + '</td>' +
                '</tr>';
        });
        html += '</tbody>';

        // Footer: class average per subject
        html += '<tfoot><tr>' +
            '<td class="bs-col-index"></td>' +
            '<td class="bs-col-student">Class Average</td>';
        sheet.subjects.forEach(function(name) {
            var avg = sheet.subjectAverages[name];
            html += '<td colspan="3" class="bs-cell bs-avg-cell">' + (avg === null ? '—' : avg + '%') + '</td>';
        });
        html += '<td class="bs-col-total"></td>' +
            '<td class="bs-col-pct">' + sheet.overallAverage + '%</td>' +
            '<td class="bs-col-pos"></td>' +
            '</tr></tfoot>';

        html += '</table></div>';
        container.innerHTML = html;
    }

    // ================================================================
    // SESSION BROADSHEET
    // ================================================================

    async function handleGenerateSession(event) {
        event.preventDefault();

        var classLevel = document.getElementById('bs-session-class')?.value;
        var session = document.getElementById('bs-session-session')?.value || '';

        if (!classLevel) {
            alert('Please select a class.');
            return;
        }

        var btn = document.getElementById('bs-session-generate-btn');
        var statusEl = document.getElementById('bs-session-gen-status');
        if (btn) { btn.disabled = true; btn.textContent = 'Compiling...'; }
        if (statusEl) statusEl.textContent = 'Compiling all three terms — this may take a moment...';

        try {
            var sheet = await window.dataService.generateSessionBroadsheetData({
                classLevel: classLevel,
                session: session
            });
            state.sessionSheet = sheet;

            if (sheet.students.length === 0) {
                if (statusEl) statusEl.textContent = 'No students found in ' + classLevel + '.';
                document.getElementById('bs-session-result').style.display = 'none';
                return;
            }

            if (statusEl) statusEl.textContent = '';
            renderSessionSheet(sheet);
        } catch (err) {
            console.error('[Broadsheet] session generate failed:', err);
            if (statusEl) statusEl.textContent = 'Error: ' + (err.message || 'Could not compile session broadsheet');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Compile Session Broadsheet'; }
        }
    }

    function renderSessionSheet(sheet) {
        var wrap = document.getElementById('bs-session-result');
        var titleEl = document.getElementById('bs-session-title');
        var metaEl = document.getElementById('bs-session-meta');
        var container = document.getElementById('bs-session-table');
        if (!wrap || !container) return;

        wrap.style.display = '';
        if (titleEl) titleEl.textContent = sheet.classLevel + ' — Session Broadsheet';
        if (metaEl) {
            metaEl.textContent = (sheet.session ? sheet.session + ' Session | ' : '') +
                sheet.classSize + ' student' + (sheet.classSize !== 1 ? 's' : '') +
                ' | Class average: ' + sheet.overallAverage + '%';
        }

        var html = '<div class="bs-table-scroll"><table class="bs-table">';
        html += '<thead><tr>' +
            '<th rowspan="2" class="bs-col-index">#</th>' +
            '<th rowspan="2" class="bs-col-student">Student</th>';
        sheet.terms.forEach(function(term) {
            html += '<th colspan="2" class="bs-subject-group">' + escapeHtml(term) + '</th>';
        });
        html += '<th rowspan="2" class="bs-col-total">Session Total</th>' +
            '<th rowspan="2" class="bs-col-pct">%</th>' +
            '<th rowspan="2" class="bs-col-pos">Pos</th>' +
            '</tr><tr>';
        sheet.terms.forEach(function() {
            html += '<th class="bs-sub-col">Total</th><th class="bs-sub-col">%</th>';
        });
        html += '</tr></thead><tbody>';

        sheet.students.forEach(function(row, index) {
            html += '<tr>' +
                '<td class="bs-col-index">' + (index + 1) + '</td>' +
                '<td class="bs-col-student" title="' + escapeHtml(row.studentName) + '">' + escapeHtml(row.studentName) + '</td>';
            sheet.terms.forEach(function(term) {
                var t = row.terms[term];
                if (!t || t.subjectCount === 0) {
                    html += '<td class="bs-cell bs-cell-empty">—</td><td class="bs-cell bs-cell-empty">—</td>';
                } else {
                    html += '<td class="bs-cell bs-sub-tot" title="out of ' + t.possible + '">' + t.total + '</td>' +
                        '<td class="bs-cell">' + t.percentage + '%</td>';
                }
            });
            html += '<td class="bs-col-total" title="out of ' + row.sessionPossible + '">' + row.sessionTotal + '</td>' +
                '<td class="bs-col-pct">' + row.percentage + '%</td>' +
                '<td class="bs-col-pos">' + positionBadge(row.position) + '</td>' +
                '</tr>';
        });
        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    function positionBadge(position) {
        if (!position) return '—';
        var cls = position <= 3 ? ' bs-pos-top' + position : '';
        return '<span class="bs-pos-badge' + cls + '">' + ordinalSuffix(position) + '</span>';
    }

    // ================================================================
    // EXPORT — Excel
    // ================================================================

    function exportTermSheet() {
        var sheet = state.termSheet;
        if (!sheet || sheet.students.length === 0) {
            alert('Compile a broadsheet first.');
            return;
        }
        if (typeof XLSX === 'undefined') {
            alert('Excel export library not loaded. Please check your connection and refresh.');
            return;
        }

        var title = sheet.classLevel + ' — ' + sheet.term + ' Broadsheet' + (sheet.session ? ' (' + sheet.session + ')' : '');
        var header1 = ['#', 'Student'];
        var header2 = ['', ''];
        sheet.subjects.forEach(function(name) {
            header1.push(name, '', '');
            header2.push('CA', 'Exam', 'Total');
        });
        header1.push('Total', '%', 'Position');
        header2.push('', '', '');

        var rows = sheet.students.map(function(row, index) {
            var r = [index + 1, row.studentName];
            sheet.subjects.forEach(function(name) {
                var cell = row.cells[name];
                if (!cell) r.push('', '', '');
                else r.push(cell.ca, cell.exam, cell.total);
            });
            r.push(row.grandTotal, row.percentage, ordinalSuffix(row.position));
            return r;
        });

        // Class average footer
        var avgRow = ['', 'Class Average'];
        sheet.subjects.forEach(function(name) {
            var avg = sheet.subjectAverages[name];
            avgRow.push(avg === null ? '' : avg + '%', '', '');
        });
        avgRow.push('', sheet.overallAverage + '%', '');

        var aoa = [[title], [], header1, header2].concat(rows, [[], avgRow]);
        var ws = XLSX.utils.aoa_to_sheet(aoa);

        // Merges: title across full width, subject groups across 3 columns,
        // and the fixed columns down both header rows
        var totalCols = header1.length;
        var merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }];
        [0, 1, totalCols - 3, totalCols - 2, totalCols - 1].forEach(function(c) {
            merges.push({ s: { r: 2, c: c }, e: { r: 3, c: c } });
        });
        sheet.subjects.forEach(function(name, i) {
            var c = 2 + i * 3;
            merges.push({ s: { r: 2, c: c }, e: { r: 2, c: c + 2 } });
        });
        ws['!merges'] = merges;

        var cols = [{ wch: 4 }, { wch: 24 }];
        sheet.subjects.forEach(function() { cols.push({ wch: 6 }, { wch: 6 }, { wch: 6 }); });
        cols.push({ wch: 8 }, { wch: 7 }, { wch: 9 });
        ws['!cols'] = cols;

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Broadsheet');
        var fileName = (sheet.classLevel + '_' + sheet.term + '_Broadsheet').replace(/[^a-zA-Z0-9_-]+/g, '_') + '.xlsx';
        XLSX.writeFile(wb, fileName);
    }

    function exportSessionSheet() {
        var sheet = state.sessionSheet;
        if (!sheet || sheet.students.length === 0) {
            alert('Compile a session broadsheet first.');
            return;
        }
        if (typeof XLSX === 'undefined') {
            alert('Excel export library not loaded. Please check your connection and refresh.');
            return;
        }

        var title = sheet.classLevel + ' — Session Broadsheet' + (sheet.session ? ' (' + sheet.session + ')' : '');
        var header1 = ['#', 'Student'];
        var header2 = ['', ''];
        sheet.terms.forEach(function(term) {
            header1.push(term, '');
            header2.push('Total', '%');
        });
        header1.push('Session Total', '%', 'Position');
        header2.push('', '', '');

        var rows = sheet.students.map(function(row, index) {
            var r = [index + 1, row.studentName];
            sheet.terms.forEach(function(term) {
                var t = row.terms[term];
                if (!t || t.subjectCount === 0) r.push('', '');
                else r.push(t.total, t.percentage);
            });
            r.push(row.sessionTotal, row.percentage, ordinalSuffix(row.position));
            return r;
        });

        var aoa = [[title], [], header1, header2].concat(rows);
        var ws = XLSX.utils.aoa_to_sheet(aoa);

        var totalCols = header1.length;
        var merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }];
        [0, 1, totalCols - 3, totalCols - 2, totalCols - 1].forEach(function(c) {
            merges.push({ s: { r: 2, c: c }, e: { r: 3, c: c } });
        });
        sheet.terms.forEach(function(term, i) {
            var c = 2 + i * 2;
            merges.push({ s: { r: 2, c: c }, e: { r: 2, c: c + 1 } });
        });
        ws['!merges'] = merges;

        var cols = [{ wch: 4 }, { wch: 24 }];
        sheet.terms.forEach(function() { cols.push({ wch: 8 }, { wch: 7 }); });
        cols.push({ wch: 12 }, { wch: 7 }, { wch: 9 });
        ws['!cols'] = cols;

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Session Broadsheet');
        var fileName = (sheet.classLevel + '_Session_Broadsheet').replace(/[^a-zA-Z0-9_-]+/g, '_') + '.xlsx';
        XLSX.writeFile(wb, fileName);
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

        var isAdmin = user.role === 'admin';
        var nameEl = document.getElementById('user-name');
        var avatarEl = document.getElementById('sidebar-avatar');
        var roleEl = document.querySelector('.sidebar-profile-role');
        if (nameEl) nameEl.textContent = user.name || user.full_name || 'User';
        if (avatarEl) avatarEl.textContent = (user.name || user.full_name || 'U').charAt(0).toUpperCase();
        if (roleEl) roleEl.textContent = isAdmin ? 'Admin' : 'Teacher';

        // Load academic entities for the class dropdowns
        try {
            state.academic = await window.dataService.getAcademicEntities({ includeAllClasses: false });
        } catch (err) {
            console.error('[Broadsheet] Failed to load academic entities:', err);
        }
        populateClassDropdowns(state.academic);

        // View switching
        document.querySelectorAll('[data-bs-nav]').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.preventDefault();
                switchView(el.getAttribute('data-bs-nav'));
                if (typeof window.closeSidebarMobile === 'function') window.closeSidebarMobile();
            });
        });

        // Forms
        document.getElementById('bs-generate-form')?.addEventListener('submit', handleGenerateTerm);
        document.getElementById('bs-session-generate-form')?.addEventListener('submit', handleGenerateSession);

        // Export / print actions
        document.getElementById('bs-term-export-btn')?.addEventListener('click', exportTermSheet);
        document.getElementById('bs-session-export-btn')?.addEventListener('click', exportSessionSheet);
        document.getElementById('bs-term-print-btn')?.addEventListener('click', function() { window.print(); });
        document.getElementById('bs-session-print-btn')?.addEventListener('click', function() { window.print(); });
    }

    window.broadsheetDashboard = { init: init };
})();
