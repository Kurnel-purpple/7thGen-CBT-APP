/**
 * Attendance Sheets Data Service
 *
 * New grid-based attendance model:
 *   attendance_sheets      — teacher-owned sheets (kind: 'subject' or 'form')
 *   attendance_marks       — one record per cell (sheet × student × column)
 *   subject_registrations  — student-initiated enrollment into a subject
 *
 * Each collection has a localStorage fallback so missing PB collections do
 * not break the UI. Legacy `attendance` collection is untouched.
 *
 * Must be loaded AFTER dataService.js.
 */

(function(ds) {
    if (!ds) {
        console.error('[attendanceSheetsDataService] window.dataService not found — load dataService.js first');
        return;
    }

    var SHEETS = 'attendance_sheets';
    var MARKS = 'attendance_marks';
    var REGS = 'subject_registrations';

    var LS_SHEETS = 'attendance_sheets.local_store';
    var LS_MARKS = 'attendance_marks.local_store';
    var LS_REGS = 'subject_registrations.local_store';

    var _missing = { sheets: false, marks: false, regs: false };

    // ================================================================
    // INTERNAL HELPERS
    // ================================================================

    function isMissingCollection(err) {
        var status = err?.status ?? err?.statusCode;
        var msg = String(err?.message || '').toLowerCase();
        return status === 404 || msg.includes('404') || msg.includes('not found') || msg.includes('missing');
    }

    function markMissing(key) {
        if (!_missing[key]) {
            _missing[key] = true;
            console.warn('[AttendanceSheets] Collection for "' + key + '" not found on server — using localStorage.');
        }
    }

    function readLocal(key) {
        try { var raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : []; }
        catch (e) { return []; }
    }

    function writeLocal(key, items) {
        try { localStorage.setItem(key, JSON.stringify(items)); }
        catch (e) { console.error('[AttendanceSheets] Failed to write ' + key + ':', e); throw e; }
    }

    function localId(prefix) {
        return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    }

    function nowIso() { return new Date().toISOString(); }

    function schoolVersion() {
        var ctx = ds.getSchoolContext && ds.getSchoolContext();
        return (ctx && ctx.schoolVersion) || 'default';
    }

    // ================================================================
    // MAPPERS — DB record ↔ JS object
    // ================================================================

    function mapSheet(r) {
        if (!r) return null;
        return {
            id: r.id,
            kind: r.kind || 'subject',
            teacherId: r.teacher_id || '',
            teacherName: r.teacher_name || '',
            classLevel: r.class_level || '',
            subject: r.subject || '',
            term: r.term || '',
            session: r.session || '',
            schoolVersion: r.school_version || '',
            columns: Array.isArray(r.columns) ? r.columns : (safeParseArray(r.columns)),
            manualRoster: Array.isArray(r.manual_roster) ? r.manual_roster : (safeParseArray(r.manual_roster)),
            createdAt: r.created || r.createdAt || null,
            updatedAt: r.updated || r.updatedAt || null
        };
    }

    function serializeSheet(s) {
        return {
            kind: s.kind || 'subject',
            teacher_id: s.teacherId || '',
            teacher_name: s.teacherName || '',
            class_level: s.classLevel || '',
            subject: s.subject || '',
            term: s.term || '',
            session: s.session || '',
            school_version: s.schoolVersion || schoolVersion(),
            columns: s.columns || [],
            manual_roster: s.manualRoster || []
        };
    }

    function mapMark(r) {
        if (!r) return null;
        return {
            id: r.id,
            sheetId: r.sheet_id || '',
            studentId: r.student_id || '',
            columnKey: r.column_key || '',
            date: r.date || '',
            status: r.status || '',
            markedBy: r.marked_by || '',
            markedAt: r.marked_at || r.created || null
        };
    }

    function serializeMark(m) {
        return {
            sheet_id: m.sheetId || '',
            student_id: m.studentId || '',
            column_key: m.columnKey || '',
            date: m.date || '',
            status: m.status || '',
            marked_by: m.markedBy || '',
            marked_at: m.markedAt || nowIso()
        };
    }

    function mapReg(r) {
        if (!r) return null;
        return {
            id: r.id,
            studentId: r.student_id || '',
            studentName: r.student_name || '',
            classLevel: r.class_level || '',
            subject: r.subject || '',
            term: r.term || '',
            session: r.session || '',
            schoolVersion: r.school_version || '',
            createdAt: r.created || r.createdAt || null
        };
    }

    function serializeReg(r) {
        return {
            student_id: r.studentId || '',
            student_name: r.studentName || '',
            class_level: r.classLevel || '',
            subject: r.subject || '',
            term: r.term || '',
            session: r.session || '',
            school_version: r.schoolVersion || schoolVersion()
        };
    }

    function safeParseArray(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try { var parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
            catch (e) { return []; }
        }
        return [];
    }

    // ================================================================
    // COLUMN GENERATORS
    // ================================================================

    /**
     * Generate session columns for a subject sheet.
     * `sessions` is a list of `{ date, label? }` — produces `[{ key, label, date }]`.
     */
    ds.buildSubjectColumns = function(sessions) {
        var list = Array.isArray(sessions) ? sessions : [];
        return list.map(function(s, idx) {
            var date = s && s.date ? s.date : '';
            return {
                key: 's-' + (idx + 1),
                label: (s && s.label) || ('Session ' + (idx + 1)),
                date: date
            };
        });
    };

    /**
     * Generate school-day columns for a form-teacher sheet given a start/end range.
     * Skips Saturday + Sunday by default.
     */
    ds.buildFormColumns = function(startDate, endDate, options) {
        options = options || {};
        var skipWeekends = options.skipWeekends !== false;
        if (!startDate || !endDate) return [];
        var out = [];
        var d = new Date(startDate);
        var end = new Date(endDate);
        var safety = 0;
        while (d <= end && safety < 400) {
            var day = d.getDay();
            if (!skipWeekends || (day !== 0 && day !== 6)) {
                var iso = d.toISOString().slice(0, 10);
                out.push({ key: 'd-' + iso, label: iso, date: iso });
            }
            d.setDate(d.getDate() + 1);
            safety++;
        }
        return out;
    };

    // ================================================================
    // SHEETS — CRUD
    // ================================================================

    ds.createAttendanceSheet = async function(sheet) {
        var payload = serializeSheet(sheet);
        if (!_missing.sheets) {
            try {
                var created = await ds.pb.collection(SHEETS).create(payload);
                return mapSheet(created);
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('sheets');
            }
        }
        var all = readLocal(LS_SHEETS);
        var rec = { id: localId('sheet'), created: nowIso(), updated: nowIso() };
        for (var k in payload) rec[k] = payload[k];
        all.unshift(rec);
        writeLocal(LS_SHEETS, all);
        return mapSheet(rec);
    };

    ds.updateAttendanceSheet = async function(sheetId, patch) {
        if (!sheetId) throw new Error('sheetId required');
        var serialized = {};
        if (patch.columns !== undefined) serialized.columns = patch.columns;
        if (patch.manualRoster !== undefined) serialized.manual_roster = patch.manualRoster;
        if (patch.subject !== undefined) serialized.subject = patch.subject;
        if (patch.classLevel !== undefined) serialized.class_level = patch.classLevel;
        if (patch.term !== undefined) serialized.term = patch.term;
        if (patch.session !== undefined) serialized.session = patch.session;
        if (patch.kind !== undefined) serialized.kind = patch.kind;

        if (!_missing.sheets) {
            try {
                var updated = await ds.pb.collection(SHEETS).update(sheetId, serialized);
                return mapSheet(updated);
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('sheets');
            }
        }
        var all = readLocal(LS_SHEETS);
        var idx = all.findIndex(function(s) { return s.id === sheetId; });
        if (idx === -1) return null;
        for (var k in serialized) all[idx][k] = serialized[k];
        all[idx].updated = nowIso();
        writeLocal(LS_SHEETS, all);
        return mapSheet(all[idx]);
    };

    ds.deleteAttendanceSheet = async function(sheetId) {
        if (!sheetId) return false;
        if (!_missing.sheets) {
            try {
                await ds.pb.collection(SHEETS).delete(sheetId);
                // also clean up marks for this sheet — best effort
                try { await ds._deleteMarksForSheet(sheetId); } catch (e) { /* non-fatal */ }
                return true;
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('sheets');
            }
        }
        var all = readLocal(LS_SHEETS);
        var filtered = all.filter(function(s) { return s.id !== sheetId; });
        if (filtered.length === all.length) return false;
        writeLocal(LS_SHEETS, filtered);
        try { await ds._deleteMarksForSheet(sheetId); } catch (e) { /* non-fatal */ }
        return true;
    };

    ds.getAttendanceSheet = async function(sheetId) {
        if (!sheetId) return null;
        if (!_missing.sheets) {
            try {
                var rec = await ds.pb.collection(SHEETS).getOne(sheetId);
                return mapSheet(rec);
            } catch (err) {
                if (!isMissingCollection(err)) {
                    // 404 here is "sheet not found", not "collection missing" — handle both as null
                    var status = err?.status ?? err?.statusCode;
                    if (status === 404) return null;
                    throw err;
                }
                markMissing('sheets');
            }
        }
        var all = readLocal(LS_SHEETS);
        var found = all.find(function(s) { return s.id === sheetId; });
        return found ? mapSheet(found) : null;
    };

    ds.listAttendanceSheets = async function(filters) {
        filters = filters || {};
        var sv = filters.schoolVersion || schoolVersion();

        if (!_missing.sheets) {
            try {
                var clauses = ['school_version = {:sv}'];
                var params = { sv: sv };
                if (filters.kind)       { clauses.push('kind = {:kind}'); params.kind = filters.kind; }
                if (filters.teacherId)  { clauses.push('teacher_id = {:tid}'); params.tid = filters.teacherId; }
                if (filters.classLevel) { clauses.push('class_level = {:cl}'); params.cl = filters.classLevel; }
                if (filters.subject)    { clauses.push('subject = {:sub}'); params.sub = filters.subject; }
                if (filters.term)       { clauses.push('term = {:term}'); params.term = filters.term; }
                if (filters.session)    { clauses.push('session = {:sess}'); params.sess = filters.session; }
                var filter = ds.pb.filter(clauses.join(' && '), params);
                var records = await ds.pb.collection(SHEETS).getFullList({ filter: filter, sort: '-created' });
                return records.map(mapSheet);
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('sheets');
            }
        }

        return readLocal(LS_SHEETS)
            .map(mapSheet)
            .filter(function(s) { return !sv || s.schoolVersion === sv; })
            .filter(function(s) { return !filters.kind || s.kind === filters.kind; })
            .filter(function(s) { return !filters.teacherId || s.teacherId === filters.teacherId; })
            .filter(function(s) { return !filters.classLevel || s.classLevel === filters.classLevel; })
            .filter(function(s) { return !filters.subject || s.subject === filters.subject; })
            .filter(function(s) { return !filters.term || s.term === filters.term; })
            .filter(function(s) { return !filters.session || s.session === filters.session; })
            .sort(function(a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    };

    // ================================================================
    // ROSTER — derive from registrations + manual adds
    // ================================================================

    /**
     * Resolve the roster for a sheet. Combines:
     *   - subject sheet: subject_registrations matching (classLevel, subject, term, session)
     *   - form sheet: all students in the class
     *   - plus any manualRoster entries
     * Returns an array of { id, name, classLevel, source: 'registered' | 'class' | 'manual' }.
     */
    ds.getSheetRoster = async function(sheet) {
        if (!sheet) return [];
        var roster = [];
        var seen = new Set();

        function addStudent(student, source) {
            if (!student || !student.id) return;
            if (seen.has(student.id)) return;
            seen.add(student.id);
            roster.push({
                id: student.id,
                name: student.name || student.full_name || student.username || 'Unknown',
                classLevel: student.classLevel || student.class_level || sheet.classLevel,
                source: source
            });
        }

        if (sheet.kind === 'form') {
            // Form sheet: all students in the class
            try {
                var classStudents = await ds.getClassStudents(sheet.classLevel);
                classStudents.forEach(function(s) { addStudent(s, 'class'); });
            } catch (e) { console.warn('[AttendanceSheets] class roster fetch failed:', e); }
        } else {
            // Subject sheet: pull from subject_registrations
            var regs = await ds.listSubjectRegistrations({
                classLevel: sheet.classLevel,
                subject: sheet.subject,
                term: sheet.term,
                session: sheet.session
            });
            // Resolve student names via class roster lookup
            var classStudents = [];
            try { classStudents = await ds.getClassStudents(sheet.classLevel); }
            catch (e) { /* non-fatal */ }
            var nameById = {};
            classStudents.forEach(function(s) { nameById[s.id] = s.name; });
            regs.forEach(function(r) {
                addStudent({ id: r.studentId, name: r.studentName || nameById[r.studentId] || 'Unknown', classLevel: r.classLevel }, 'registered');
            });
        }

        // Manual additions (applied last so they don't overwrite registered/class entries)
        var manualIds = Array.isArray(sheet.manualRoster) ? sheet.manualRoster : [];
        if (manualIds.length) {
            var classStudents2 = [];
            try { classStudents2 = await ds.getClassStudents(sheet.classLevel); }
            catch (e) { /* non-fatal */ }
            var nameById2 = {};
            classStudents2.forEach(function(s) { nameById2[s.id] = s.name; });
            manualIds.forEach(function(sid) {
                if (!seen.has(sid)) addStudent({ id: sid, name: nameById2[sid] || 'Unknown', classLevel: sheet.classLevel }, 'manual');
            });
        }

        roster.sort(function(a, b) { return String(a.name).localeCompare(String(b.name)); });
        return roster;
    };

    ds.addStudentToSheetRoster = async function(sheetId, studentId) {
        var sheet = await ds.getAttendanceSheet(sheetId);
        if (!sheet) throw new Error('Sheet not found');
        var manual = Array.isArray(sheet.manualRoster) ? sheet.manualRoster.slice() : [];
        if (manual.indexOf(studentId) === -1) manual.push(studentId);
        return ds.updateAttendanceSheet(sheetId, { manualRoster: manual });
    };

    ds.removeStudentFromSheetRoster = async function(sheetId, studentId) {
        var sheet = await ds.getAttendanceSheet(sheetId);
        if (!sheet) throw new Error('Sheet not found');
        var manual = (sheet.manualRoster || []).filter(function(id) { return id !== studentId; });
        return ds.updateAttendanceSheet(sheetId, { manualRoster: manual });
    };

    // ================================================================
    // MARKS — upsert by (sheet, student, column)
    // ================================================================

    ds.markSheetCell = async function(cell) {
        if (!cell || !cell.sheetId || !cell.studentId || !cell.columnKey) {
            throw new Error('markSheetCell requires sheetId, studentId, columnKey');
        }
        var payload = serializeMark(cell);

        if (!_missing.marks) {
            try {
                // Upsert by (sheet_id, student_id, column_key)
                var existing = null;
                try {
                    var filter = ds.pb.filter('sheet_id = {:s} && student_id = {:st} && column_key = {:c}', {
                        s: cell.sheetId, st: cell.studentId, c: cell.columnKey
                    });
                    existing = await ds.pb.collection(MARKS).getFirstListItem(filter);
                } catch (e) {
                    if (!(e?.status === 404 || String(e?.message || '').toLowerCase().includes('not found'))) {
                        if (!isMissingCollection(e)) throw e;
                        markMissing('marks');
                    }
                }
                if (!_missing.marks) {
                    var saved = existing
                        ? await ds.pb.collection(MARKS).update(existing.id, payload)
                        : await ds.pb.collection(MARKS).create(payload);
                    return mapMark(saved);
                }
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('marks');
            }
        }

        // localStorage fallback
        var all = readLocal(LS_MARKS);
        var idx = all.findIndex(function(m) {
            return m.sheet_id === cell.sheetId && m.student_id === cell.studentId && m.column_key === cell.columnKey;
        });
        if (idx !== -1) {
            for (var k in payload) all[idx][k] = payload[k];
            all[idx].updated = nowIso();
        } else {
            var rec = { id: localId('mark'), created: nowIso(), updated: nowIso() };
            for (var k2 in payload) rec[k2] = payload[k2];
            all.push(rec);
        }
        writeLocal(LS_MARKS, all);
        return mapMark(idx !== -1 ? all[idx] : all[all.length - 1]);
    };

    ds.clearSheetCell = async function(sheetId, studentId, columnKey) {
        if (!_missing.marks) {
            try {
                var filter = ds.pb.filter('sheet_id = {:s} && student_id = {:st} && column_key = {:c}', {
                    s: sheetId, st: studentId, c: columnKey
                });
                var rec = null;
                try { rec = await ds.pb.collection(MARKS).getFirstListItem(filter); }
                catch (e) {
                    if (e?.status === 404) return true;
                    if (!isMissingCollection(e)) throw e;
                    markMissing('marks');
                }
                if (rec) await ds.pb.collection(MARKS).delete(rec.id);
                return true;
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('marks');
            }
        }
        var all = readLocal(LS_MARKS);
        var filtered = all.filter(function(m) {
            return !(m.sheet_id === sheetId && m.student_id === studentId && m.column_key === columnKey);
        });
        writeLocal(LS_MARKS, filtered);
        return true;
    };

    ds.getSheetMarks = async function(sheetId) {
        if (!sheetId) return [];
        if (!_missing.marks) {
            try {
                var filter = ds.pb.filter('sheet_id = {:s}', { s: sheetId });
                var records = await ds.pb.collection(MARKS).getFullList({ filter: filter });
                return records.map(mapMark);
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('marks');
            }
        }
        return readLocal(LS_MARKS).filter(function(m) { return m.sheet_id === sheetId; }).map(mapMark);
    };

    ds._deleteMarksForSheet = async function(sheetId) {
        if (!_missing.marks) {
            try {
                var filter = ds.pb.filter('sheet_id = {:s}', { s: sheetId });
                var recs = await ds.pb.collection(MARKS).getFullList({ filter: filter });
                for (var i = 0; i < recs.length; i++) {
                    try { await ds.pb.collection(MARKS).delete(recs[i].id); } catch (e) { /* best effort */ }
                }
                return recs.length;
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('marks');
            }
        }
        var all = readLocal(LS_MARKS);
        var remaining = all.filter(function(m) { return m.sheet_id !== sheetId; });
        writeLocal(LS_MARKS, remaining);
        return all.length - remaining.length;
    };

    // ================================================================
    // FORM SHEET AGGREGATION
    //
    // Denominator strategy (no schedule data required):
    //   For a given (student, date) on the form sheet, look at all subject
    //   sheets for the same (class_level, term, session). A subject sheet
    //   "met" on that date iff it has at least one mark on that date.
    //   numerator   = # of those sheets where THIS student was marked present
    //   denominator = # of those sheets that met that date (any student, any status)
    // ================================================================

    /**
     * Compute per-cell progress for a form teacher's sheet.
     * Returns { studentId: { dateIso: { marked: N, total: M, manual: bool } } }.
     * `marked` = subject sheets where student was marked present that day.
     * `total`  = subject sheets that recorded any marking that day.
     * `manual` = true if the form teacher has directly marked this cell present
     *            (manual marks are stored on the form sheet itself and override the ring).
     */
    ds.getFormSheetProgress = async function(formSheet) {
        if (!formSheet || formSheet.kind !== 'form') return {};

        // 1. Gather all subject sheets for the same class/term/session
        var subjectSheets = await ds.listAttendanceSheets({
            kind: 'subject',
            classLevel: formSheet.classLevel,
            term: formSheet.term,
            session: formSheet.session
        });

        // 2. Pull marks + roster for each subject sheet in parallel
        var marksBySheet = await Promise.all(subjectSheets.map(function(s) {
            return ds.getSheetMarks(s.id).catch(function() { return []; });
        }));
        var rostersBySheet = await Promise.all(subjectSheets.map(function(s) {
            return ds.getSheetRoster(s).catch(function() { return []; });
        }));

        // Today (local) — past columns with no mark are treated as absent
        var _today = (function() {
            var d = new Date();
            return d.getFullYear() + '-' +
                   String(d.getMonth() + 1).padStart(2, '0') + '-' +
                   String(d.getDate()).padStart(2, '0');
        })();

        // 3. For each subject sheet: count every past column against every roster
        //    student; auto-absent if no mark; present/PH/MTB count as marked.
        var progress = {}; // studentId -> date -> { marked, total }

        function bump(studentId, date, field) {
            if (!progress[studentId]) progress[studentId] = {};
            if (!progress[studentId][date]) progress[studentId][date] = { marked: 0, total: 0, manual: false };
            progress[studentId][date][field]++;
        }

        subjectSheets.forEach(function(sheet, i) {
            var marks = marksBySheet[i] || [];
            var roster = rostersBySheet[i] || [];

            // Index marks by (studentId, date) for quick lookup
            var marksByStudDate = {};
            marks.forEach(function(m) {
                if (!m.date || !m.studentId) return;
                marksByStudDate[m.studentId + '|' + m.date] = m;
            });

            var cols = Array.isArray(sheet.columns) ? sheet.columns : [];

            cols.forEach(function(col) {
                if (!col.date) return;
                var isPast = col.date < _today;

                roster.forEach(function(student) {
                    var mark = marksByStudDate[student.id + '|' + col.date];
                    var status = mark ? mark.status : null;

                    // Only count past columns OR columns that have any activity
                    // (prevents future empty columns from dragging the ring down)
                    if (!isPast && !mark) return;

                    bump(student.id, col.date, 'total');
                    if (status === 'present' || status === 'ph' || status === 'mtb') {
                        bump(student.id, col.date, 'marked');
                    }
                    // 'absent' and auto-absent (no mark on past date) → total only
                });
            });
        });

        // 4. Overlay manual marks from the form sheet itself
        var formMarks = await ds.getSheetMarks(formSheet.id);
        formMarks.forEach(function(m) {
            if (!m.date || !m.studentId) return;
            if (!progress[m.studentId]) progress[m.studentId] = {};
            if (!progress[m.studentId][m.date]) progress[m.studentId][m.date] = { marked: 0, total: 0, manual: false };
            if (m.status === 'present' || m.status === 'ph' || m.status === 'mtb') {
                progress[m.studentId][m.date].manual = true;
            } else if (m.status === 'cleared') {
                progress[m.studentId][m.date].manual = false;
            }
        });

        return progress;
    };

    // ================================================================
    // SUBJECT REGISTRATIONS — student-initiated enrollment
    // ================================================================

    ds.registerStudentForSubject = async function(reg) {
        if (!reg || !reg.studentId || !reg.subject || !reg.classLevel) {
            throw new Error('registerStudentForSubject requires studentId, subject, classLevel');
        }
        var payload = serializeReg(reg);

        if (!_missing.regs) {
            try {
                // Prevent duplicates
                var existing = null;
                try {
                    var filter = ds.pb.filter(
                        'student_id = {:st} && class_level = {:cl} && subject = {:sub} && term = {:t} && session = {:s}',
                        { st: reg.studentId, cl: reg.classLevel, sub: reg.subject, t: reg.term || '', s: reg.session || '' }
                    );
                    existing = await ds.pb.collection(REGS).getFirstListItem(filter);
                } catch (e) {
                    if (!(e?.status === 404)) {
                        if (!isMissingCollection(e)) throw e;
                        markMissing('regs');
                    }
                }
                if (existing) return mapReg(existing);
                if (!_missing.regs) {
                    var created = await ds.pb.collection(REGS).create(payload);
                    return mapReg(created);
                }
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('regs');
            }
        }

        var all = readLocal(LS_REGS);
        var dup = all.find(function(r) {
            return r.student_id === reg.studentId
                && r.class_level === reg.classLevel
                && r.subject === reg.subject
                && (r.term || '') === (reg.term || '')
                && (r.session || '') === (reg.session || '');
        });
        if (dup) return mapReg(dup);
        var rec = { id: localId('reg'), created: nowIso() };
        for (var k in payload) rec[k] = payload[k];
        all.unshift(rec);
        writeLocal(LS_REGS, all);
        return mapReg(rec);
    };

    ds.unregisterStudentFromSubject = async function(regId) {
        if (!regId) return false;
        if (!_missing.regs) {
            try {
                await ds.pb.collection(REGS).delete(regId);
                return true;
            } catch (err) {
                if (!isMissingCollection(err)) {
                    if (err?.status === 404) return false;
                    throw err;
                }
                markMissing('regs');
            }
        }
        var all = readLocal(LS_REGS);
        var filtered = all.filter(function(r) { return r.id !== regId; });
        if (filtered.length === all.length) return false;
        writeLocal(LS_REGS, filtered);
        return true;
    };

    ds.listSubjectRegistrations = async function(filters) {
        filters = filters || {};
        var sv = filters.schoolVersion || schoolVersion();

        if (!_missing.regs) {
            try {
                var clauses = ['school_version = {:sv}'];
                var params = { sv: sv };
                if (filters.studentId)  { clauses.push('student_id = {:st}'); params.st = filters.studentId; }
                if (filters.classLevel) { clauses.push('class_level = {:cl}'); params.cl = filters.classLevel; }
                if (filters.subject)    { clauses.push('subject = {:sub}'); params.sub = filters.subject; }
                if (filters.term)       { clauses.push('term = {:t}'); params.t = filters.term; }
                if (filters.session)    { clauses.push('session = {:s}'); params.s = filters.session; }
                var filter = ds.pb.filter(clauses.join(' && '), params);
                var records = await ds.pb.collection(REGS).getFullList({ filter: filter, sort: '-created' });
                return records.map(mapReg);
            } catch (err) {
                if (!isMissingCollection(err)) throw err;
                markMissing('regs');
            }
        }

        return readLocal(LS_REGS)
            .map(mapReg)
            .filter(function(r) { return !sv || r.schoolVersion === sv; })
            .filter(function(r) { return !filters.studentId || r.studentId === filters.studentId; })
            .filter(function(r) { return !filters.classLevel || r.classLevel === filters.classLevel; })
            .filter(function(r) { return !filters.subject || r.subject === filters.subject; })
            .filter(function(r) { return !filters.term || r.term === filters.term; })
            .filter(function(r) { return !filters.session || r.session === filters.session; });
    };

})(window.dataService);
