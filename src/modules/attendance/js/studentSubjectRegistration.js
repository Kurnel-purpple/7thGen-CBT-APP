/**
 * Student Subject Registration Controller
 * Shows available subject sheets for the student's class and lets them
 * register/unregister for each one. Registration auto-populates the
 * teacher's subject-period attendance sheet roster.
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
        sheets: [],          // subject-kind sheets for user's class
        registrations: [],   // student's existing regs
        regIndex: {},        // key = classLevel|subject|term|session -> reg record
        _initialized: false
    };

    function regKey(reg) {
        return (reg.classLevel || '') + '|' + (reg.subject || '') + '|' + (reg.term || '') + '|' + (reg.session || '');
    }

    function sheetKey(s) {
        return (s.classLevel || '') + '|' + (s.subject || '') + '|' + (s.term || '') + '|' + (s.session || '');
    }

    async function init() {
        if (state._initialized) return;
        state._initialized = true;

        var user = window.dataService?.getCurrentUser?.();
        if (!user || user.role !== 'student') return;
        state.user = user;
        state.classLevel = user.classLevel || user.class_level || '';

        bindEvents();
        await refresh();
    }

    function bindEvents() {
        var refreshBtn = document.getElementById('subjects-refresh-btn');
        if (refreshBtn) refreshBtn.addEventListener('click', refresh);
    }

    async function refresh() {
        var list = document.getElementById('subjects-list');
        if (!list) return;
        if (!state.classLevel) {
            list.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Your class is not set. Ask an admin to set your class level.</p></div>';
            return;
        }

        list.innerHTML = '<div class="attendance-empty"><p style="color:var(--light-text);">Loading subjects…</p></div>';
        try {
            var ds = window.dataService;
            var results = await Promise.all([
                ds.listAttendanceSheets({ kind: 'subject', classLevel: state.classLevel }),
                ds.listSubjectRegistrations({ studentId: state.user.id, classLevel: state.classLevel })
            ]);
            state.sheets = results[0] || [];
            state.registrations = results[1] || [];

            state.regIndex = {};
            state.registrations.forEach(function(r) { state.regIndex[regKey(r)] = r; });

            render();
        } catch (e) {
            console.error('[StudentSubjects] refresh failed:', e);
            list.innerHTML = '<div class="attendance-empty"><p style="color:#e74c3c; font-weight:700;">Failed to load subjects.</p></div>';
        }
    }

    function render() {
        var list = document.getElementById('subjects-list');
        if (!list) return;

        // Deduplicate by subject/term/session — if multiple teachers create sheets
        // for the same subject, show one row but tag registration against each
        var grouped = {};
        state.sheets.forEach(function(s) {
            var k = sheetKey(s);
            if (!grouped[k]) grouped[k] = { key: k, subject: s.subject, term: s.term, session: s.session, classLevel: s.classLevel, teachers: [] };
            grouped[k].teachers.push(s.teacherName || 'Teacher');
        });

        var rows = Object.values(grouped).sort(function(a, b) {
            return String(a.subject).localeCompare(String(b.subject));
        });

        if (!rows.length) {
            list.innerHTML =
                '<div class="attendance-empty">' +
                    '<div class="attendance-empty-icon">' +
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48"><path d="M12 20l9-5-9-5-9 5 9 5z"/><path d="M12 12L3 7l9-5 9 5-9 5z"/></svg>' +
                    '</div>' +
                    '<p style="font-weight:700; color:var(--text-color);">No subjects available yet</p>' +
                    '<p style="font-size:0.88rem;">Your teachers haven\'t created any subject sheets for your class. Check back later.</p>' +
                '</div>';
            return;
        }

        var html = '<div class="subject-reg-list">';
        rows.forEach(function(row) {
            var k = row.key;
            var reg = state.regIndex[k];
            var registered = !!reg;
            html +=
                '<div class="subject-reg-row">' +
                    '<div class="subject-reg-info">' +
                        '<div class="subject-reg-title">' + escapeHtml(row.subject || '—') + '</div>' +
                        '<div class="subject-reg-meta">' +
                            (row.term ? escapeHtml(row.term) : '') +
                            (row.session ? ' · ' + escapeHtml(row.session) : '') +
                            (row.teachers.length ? ' · ' + escapeHtml(Array.from(new Set(row.teachers)).join(', ')) : '') +
                        '</div>' +
                    '</div>' +
                    (registered
                        ? '<button class="btn subject-reg-btn subject-reg-btn-registered" data-unregister="' + escapeHtml(reg.id) + '">' +
                              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>' +
                              ' Registered' +
                          '</button>'
                        : '<button class="btn subject-reg-btn subject-reg-btn-register" data-register="' + escapeHtml(k) + '">' +
                              'Register' +
                          '</button>') +
                '</div>';
        });
        html += '</div>';

        list.innerHTML = html;

        list.querySelectorAll('[data-register]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                doRegister(btn.getAttribute('data-register'), btn);
            });
        });
        list.querySelectorAll('[data-unregister]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                doUnregister(btn.getAttribute('data-unregister'), btn);
            });
        });
    }

    async function doRegister(key, btn) {
        var parts = key.split('|');
        var payload = {
            studentId: state.user.id,
            studentName: state.user.full_name || state.user.username || state.user.name || '',
            classLevel: parts[0],
            subject: parts[1],
            term: parts[2],
            session: parts[3]
        };
        if (btn) { btn.disabled = true; btn.textContent = 'Registering…'; }
        try {
            var reg = await window.dataService.registerStudentForSubject(payload);
            if (reg) {
                state.registrations.push(reg);
                state.regIndex[regKey(reg)] = reg;
            }
            render();
        } catch (e) {
            console.error('[StudentSubjects] register failed:', e);
            alert('Could not register: ' + (e.message || 'unknown error'));
            if (btn) { btn.disabled = false; btn.textContent = 'Register'; }
        }
    }

    async function doUnregister(regId, btn) {
        if (!confirm('Unregister from this subject? You will be removed from the attendance roster.')) return;
        if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }
        try {
            await window.dataService.unregisterStudentFromSubject(regId);
            state.registrations = state.registrations.filter(function(r) { return r.id !== regId; });
            state.regIndex = {};
            state.registrations.forEach(function(r) { state.regIndex[regKey(r)] = r; });
            render();
        } catch (e) {
            console.error('[StudentSubjects] unregister failed:', e);
            alert('Could not unregister: ' + (e.message || 'unknown error'));
            if (btn) { btn.disabled = false; }
            render();
        }
    }

    window.studentSubjectRegistration = {
        init: init,
        refresh: refresh
    };

    if (document.readyState !== 'loading') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

})();
