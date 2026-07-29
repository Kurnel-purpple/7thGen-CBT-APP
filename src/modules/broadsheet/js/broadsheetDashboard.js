/**
 * Broadsheet Dashboard Controller
 * Admin/teacher view: class-wide term broadsheet — CA | Exam | Total per
 * subject, grand total, percentage, position. On the 3rd term the sheet also
 * carries a Session Performance block on the right: each term's total, the
 * section total, the section average, and the session percentage/position.
 */

(function() {
    'use strict';

    var state = {
        academic: null,
        termSheet: null
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

    // Show/hide the Export & Print items in the mobile bottom nav in step with
    // the result table. Safe to set inline display: the bar is hidden on desktop.
    function setMabResultActions(ids, visible) {
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = visible ? '' : 'none';
        });
    }

    // ================================================================
    // VIEW SWITCHING
    // ================================================================

    function switchView(view) {
        document.querySelectorAll('.bs-view').forEach(function(el) {
            el.classList.toggle('active', el.id === 'bs-view-' + view);
        });
        document.querySelectorAll('[data-bs-nav]').forEach(function(el) {
            el.classList.toggle('active', el.getAttribute('data-bs-nav') === view);
        });
        var subtitle = document.getElementById('topbar-subtitle');
        if (subtitle) subtitle.textContent = 'Broadsheet';
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

        var select = document.getElementById('bs-class');
        if (select) select.innerHTML = options;
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
        if (statusEl) {
            // 3rd term pulls the other two terms in as well for the session block
            statusEl.textContent = term === '3rd Term'
                ? 'Compiling 3rd term and the full session performance — this may take a moment...'
                : 'Fetching results and compiling the broadsheet...';
        }

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
                setMabResultActions(['bs-mab-term-export', 'bs-mab-term-print'], false);
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
        setMabResultActions(['bs-mab-term-export', 'bs-mab-term-print'], true);
        if (titleEl) titleEl.textContent = sheet.classLevel + ' — ' + sheet.term + ' Broadsheet';
        if (metaEl) {
            metaEl.textContent = (sheet.session ? sheet.session + ' Session | ' : '') +
                sheet.classSize + ' student' + (sheet.classSize !== 1 ? 's' : '') + ' | ' +
                sheet.subjects.length + ' subject' + (sheet.subjects.length !== 1 ? 's' : '') +
                ' | Class average: ' + sheet.overallAverage + '%' +
                (sheet.hasSession ? ' | Session average: ' + sheet.sessionOverallAverage + '%' : '');
        }

        if (sheet.subjects.length === 0) {
            container.innerHTML = '<p style="color:var(--light-text); padding:20px 0;">No completed exam results match ' +
                escapeHtml(sheet.term) + ' for this class yet.</p>';
            return;
        }

        // On the 3rd term the sheet carries a session-performance block on the
        // right: each term's total, the section total, average, % and position.
        var withSession = !!sheet.hasSession;
        var sessionTerms = withSession ? sheet.sessionTerms : [];

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
            '<th rowspan="2" class="bs-col-pos">Pos</th>';
        if (withSession) {
            html += '<th colspan="' + (sessionTerms.length + 4) + '" class="bs-session-group">Session Performance</th>';
        }
        html += '</tr>';

        // Header row 2: CA | Exam | Tot per subject, then the session columns
        html += '<tr>';
        sheet.subjects.forEach(function() {
            html += '<th class="bs-sub-col">CA</th><th class="bs-sub-col">Exam</th><th class="bs-sub-col bs-sub-tot">Tot</th>';
        });
        if (withSession) {
            sessionTerms.forEach(function(term, i) {
                html += '<th class="bs-sub-col bs-session-col' + (i === 0 ? ' bs-session-first' : '') + '">' +
                    escapeHtml(term) + ' Total</th>';
            });
            html += '<th class="bs-sub-col bs-session-col">Section Total</th>' +
                '<th class="bs-sub-col bs-session-col">Average</th>' +
                '<th class="bs-sub-col bs-session-col">%</th>' +
                '<th class="bs-sub-col bs-session-col">Pos</th>';
        }
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
                '<td class="bs-col-pos">' + positionBadge(row.position) + '</td>';
            if (withSession) html += sessionCells(row.session, sessionTerms);
            html += '</tr>';
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
            '<td class="bs-col-pos"></td>';
        if (withSession) {
            sessionTerms.forEach(function(term, i) {
                var avg = sheet.sessionTermAverages ? sheet.sessionTermAverages[term] : null;
                html += '<td class="bs-cell bs-avg-cell bs-session-col' + (i === 0 ? ' bs-session-first' : '') + '">' +
                    (avg === null || avg === undefined ? '—' : avg + '%') + '</td>';
            });
            html += '<td class="bs-cell bs-session-col"></td>' +
                '<td class="bs-cell bs-session-col"></td>' +
                '<td class="bs-col-pct bs-session-col">' + sheet.sessionOverallAverage + '%</td>' +
                '<td class="bs-cell bs-session-col"></td>';
        }
        html += '</tr></tfoot>';

        html += '</table></div>';
        container.innerHTML = html;
    }

    /**
     * The session-performance cells appended to a 3rd term row: one total per
     * term, then the section total, average (÷ terms sat), % and position.
     */
    function sessionCells(session, terms) {
        if (!session) return '';
        var out = '';
        terms.forEach(function(term, i) {
            var t = session.terms[term];
            var first = i === 0 ? ' bs-session-first' : '';
            if (!t || t.subjectCount === 0) {
                out += '<td class="bs-cell bs-cell-empty bs-sub-tot bs-session-col' + first +
                    '" title="No results for this term">—</td>';
            } else {
                out += '<td class="bs-cell bs-sub-tot bs-session-col' + first + '" title="' + t.total + ' / ' +
                    t.possible + ' (' + t.percentage + '%)">' + t.total + '</td>';
            }
        });
        var divisorNote = session.sectionTotal + ' ÷ ' + session.termsSat +
            ' term' + (session.termsSat !== 1 ? 's' : '');
        out += '<td class="bs-col-total bs-session-col" title="out of ' + session.sectionPossible + '">' +
            session.sectionTotal + '</td>' +
            '<td class="bs-col-avg bs-session-col" title="' + divisorNote + '">' + session.average + '</td>' +
            '<td class="bs-col-pct bs-session-col" title="Mean of ' + session.termsSat + ' term percentage' +
            (session.termsSat !== 1 ? 's' : '') + '">' + session.percentage + '%</td>' +
            '<td class="bs-col-pos bs-session-col">' + positionBadge(session.position) + '</td>';
        return out;
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

        var withSession = !!sheet.hasSession;
        var sessionTerms = withSession ? sheet.sessionTerms : [];
        // Term totals + Section Total, Average, %, Position
        var sessionColCount = sessionTerms.length + 4;

        var title = sheet.classLevel + ' — ' + sheet.term + ' Broadsheet' + (sheet.session ? ' (' + sheet.session + ')' : '');
        var header1 = ['#', 'Student'];
        var header2 = ['', ''];
        sheet.subjects.forEach(function(name) {
            header1.push(name, '', '');
            header2.push('CA', 'Exam', 'Total');
        });
        header1.push('Total', '%', 'Position');
        header2.push('', '', '');
        if (withSession) {
            header1.push('Session Performance');
            sessionTerms.forEach(function(term) { header2.push(term + ' Total'); });
            header2.push('Section Total', 'Average', '%', 'Position');
            // Pad header1 out under the merged group label
            for (var p = 1; p < sessionColCount; p++) header1.push('');
        }

        var rows = sheet.students.map(function(row, index) {
            var r = [index + 1, row.studentName];
            sheet.subjects.forEach(function(name) {
                var cell = row.cells[name];
                if (!cell) r.push('', '', '');
                else r.push(cell.ca, cell.exam, cell.total);
            });
            r.push(row.grandTotal, row.percentage, ordinalSuffix(row.position));
            if (withSession && row.session) {
                sessionTerms.forEach(function(term) {
                    var t = row.session.terms[term];
                    r.push(!t || t.subjectCount === 0 ? '' : t.total);
                });
                r.push(row.session.sectionTotal, row.session.average, row.session.percentage,
                    ordinalSuffix(row.session.position));
            }
            return r;
        });

        // Class average footer
        var avgRow = ['', 'Class Average'];
        sheet.subjects.forEach(function(name) {
            var avg = sheet.subjectAverages[name];
            avgRow.push(avg === null ? '' : avg + '%', '', '');
        });
        avgRow.push('', sheet.overallAverage + '%', '');
        if (withSession) {
            sessionTerms.forEach(function(term) {
                var avg = sheet.sessionTermAverages ? sheet.sessionTermAverages[term] : null;
                avgRow.push(avg === null || avg === undefined ? '' : avg + '%');
            });
            avgRow.push('', '', sheet.sessionOverallAverage + '%', '');
        }

        var aoa = [[title], [], header1, header2].concat(rows, [[], avgRow]);
        var ws = XLSX.utils.aoa_to_sheet(aoa);

        // Merges: title across full width, subject groups across 3 columns, the
        // session block across its own, and the fixed columns down both rows
        var totalCols = header1.length;
        var termColStart = 2 + sheet.subjects.length * 3;
        var merges = [{ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } }];
        [0, 1, termColStart, termColStart + 1, termColStart + 2].forEach(function(c) {
            merges.push({ s: { r: 2, c: c }, e: { r: 3, c: c } });
        });
        sheet.subjects.forEach(function(name, i) {
            var c = 2 + i * 3;
            merges.push({ s: { r: 2, c: c }, e: { r: 2, c: c + 2 } });
        });
        if (withSession) {
            var sessionColStart = termColStart + 3;
            merges.push({ s: { r: 2, c: sessionColStart }, e: { r: 2, c: sessionColStart + sessionColCount - 1 } });
        }
        ws['!merges'] = merges;

        var cols = [{ wch: 4 }, { wch: 24 }];
        sheet.subjects.forEach(function() { cols.push({ wch: 6 }, { wch: 6 }, { wch: 6 }); });
        cols.push({ wch: 8 }, { wch: 7 }, { wch: 9 });
        if (withSession) {
            sessionTerms.forEach(function() { cols.push({ wch: 13 }); });
            cols.push({ wch: 13 }, { wch: 10 }, { wch: 7 }, { wch: 9 });
        }
        ws['!cols'] = cols;

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Broadsheet');
        var fileName = (sheet.classLevel + '_' + sheet.term + '_Broadsheet').replace(/[^a-zA-Z0-9_-]+/g, '_') + '.xlsx';
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

        // Export / print actions
        document.getElementById('bs-term-export-btn')?.addEventListener('click', exportTermSheet);
        document.getElementById('bs-term-print-btn')?.addEventListener('click', function() { window.print(); });
    }

    window.broadsheetDashboard = { init: init };
})();
