/**
 * Attendance Data Service
 * Extends window.dataService with attendance-specific functionality.
 * Must be loaded AFTER dataService.js
 */

(function(ds) {
    if (!ds) { console.error('[attendanceDataService] window.dataService not found — load dataService.js first'); return; }

    /**
     * Get all attendance records for a class on a specific date.
     * @param {string} classLevel - e.g. "JSS1", "SS2"
     * @param {string} date - ISO date "YYYY-MM-DD"
     * @returns {Promise<Array>}
     */
    ds.getAttendanceByClass = async function(classLevel, date) {
        try {
            const filter = this.pb.filter('class_level = {:classLevel} && date = {:date}', {
                classLevel,
                date
            });
            const records = await this.pb.collection('attendance').getFullList({
                filter,
                sort: 'student_name'
            });
            return records.map(r => ds._mapAttendance(r));
        } catch (error) {
            console.error('[Attendance] getAttendanceByClass error:', error);
            throw error;
        }
    };

    /**
     * Get attendance history for a single student in a date range.
     * @param {string} studentId
     * @param {string} startDate - "YYYY-MM-DD"
     * @param {string} endDate - "YYYY-MM-DD"
     * @returns {Promise<Array>}
     */
    ds.getAttendanceByStudent = async function(studentId, startDate, endDate) {
        try {
            const filter = this.pb.filter('student_id = {:studentId} && date >= {:startDate} && date <= {:endDate}', {
                studentId,
                startDate,
                endDate
            });
            const records = await this.pb.collection('attendance').getFullList({
                filter,
                sort: '-date'
            });
            return records.map(r => ds._mapAttendance(r));
        } catch (error) {
            console.error('[Attendance] getAttendanceByStudent error:', error);
            throw error;
        }
    };

    /**
     * Mark attendance for a single student on a date.
     * Creates a new record or updates an existing one (upsert by student_id + date).
     * @param {Object} record - { student_id, student_name, class_level, date, status, marked_by, note }
     * @returns {Promise<Object>} The saved attendance record
     */
    ds.markAttendance = async function(record) {
        try {
            // Check if record already exists for this student on this date
            let existing = null;
            try {
                const filter = this.pb.filter('student_id = {:studentId} && date = {:date}', {
                    studentId: record.student_id,
                    date: record.date
                });
                existing = await this.pb.collection('attendance').getFirstListItem(
                    filter
                );
            } catch (e) {
                const statusCode = e?.status ?? e?.statusCode;
                const message = String(e?.message || '').toLowerCase();
                const isNotFound = statusCode === 404 || message.includes('404') || message.includes('not found');
                if (!isNotFound) {
                    throw e;
                }
            }

            const data = {
                student_id: record.student_id,
                student_name: record.student_name,
                class_level: record.class_level,
                date: record.date,
                status: record.status,
                marked_by: record.marked_by,
                note: record.note || ''
            };

            let saved;
            if (existing) {
                saved = await this.pb.collection('attendance').update(existing.id, data);
            } else {
                saved = await this.pb.collection('attendance').create(data);
            }

            return ds._mapAttendance(saved);
        } catch (error) {
            console.error('[Attendance] markAttendance error:', error);
            throw error;
        }
    };

    /**
     * Mark attendance for multiple students at once.
     * @param {Array} records - Array of attendance record objects
     * @returns {Promise<{saved: number, failed: number, errors: Array}>}
     */
    ds.bulkMarkAttendance = async function(records) {
        let saved = 0;
        let failed = 0;
        const errors = [];

        for (const record of records) {
            try {
                await ds.markAttendance(record);
                saved++;
            } catch (error) {
                failed++;
                errors.push({ studentId: record.student_id, error: error.message });
            }
        }

        return { saved, failed, errors };
    };

    /**
     * Get attendance statistics for a class over a date range.
     * @param {string} classLevel
     * @param {string} startDate - "YYYY-MM-DD"
     * @param {string} endDate - "YYYY-MM-DD"
     * @returns {Promise<Object>} Stats by student
     */
    ds.getAttendanceStats = async function(classLevel, startDate, endDate) {
        try {
            const filter = this.pb.filter('class_level = {:classLevel} && date >= {:startDate} && date <= {:endDate}', {
                classLevel,
                startDate,
                endDate
            });
            const records = await this.pb.collection('attendance').getFullList({
                filter,
                sort: 'student_name,date'
            });

            // Group by student
            const byStudent = {};
            const allDates = new Set();

            records.forEach(r => {
                allDates.add(r.date);
                if (!byStudent[r.student_id]) {
                    byStudent[r.student_id] = {
                        studentId: r.student_id,
                        studentName: r.student_name,
                        present: 0,
                        absent: 0,
                        late: 0,
                        excused: 0,
                        records: []
                    };
                }
                const s = byStudent[r.student_id];
                if (r.status === 'present') s.present++;
                else if (r.status === 'absent') s.absent++;
                else if (r.status === 'late') s.late++;
                else if (r.status === 'excused') s.excused++;
                s.records.push(ds._mapAttendance(r));
            });

            // Calculate percentages
            const totalDays = allDates.size;
            Object.values(byStudent).forEach(s => {
                const attended = s.present + s.late; // late still counts as attended
                s.totalDays = totalDays;
                s.attendanceRate = totalDays > 0 ? Math.round((attended / totalDays) * 100) : 0;
            });

            return {
                classLevel,
                startDate,
                endDate,
                totalDays,
                students: Object.values(byStudent)
            };
        } catch (error) {
            console.error('[Attendance] getAttendanceStats error:', error);
            throw error;
        }
    };

    /**
     * Get students in a specific class (uses existing getUsers from core dataService).
     * @param {string} classLevel - e.g. "JSS1", "SS2"
     * @returns {Promise<Array<{id: string, name: string, classLevel: string}>>}
     */
    ds.getClassStudents = async function(classLevel) {
        try {
            const allStudents = await this.getUsers({ role: 'student' });
            const filtered = allStudents
                .filter(s => s.class_level === classLevel)
                .map(s => ({
                    id: s.user || s.id,
                    name: s.full_name || s.username || 'Unknown',
                    classLevel: s.class_level
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
            return filtered;
        } catch (error) {
            console.error('[Attendance] getClassStudents error:', error);
            throw error;
        }
    };

    /**
     * Map a PocketBase attendance record to a consistent JS object.
     */
    ds._mapAttendance = function(record) {
        if (!record) return null;
        return {
            id: record.id,
            studentId: record.student_id,
            studentName: record.student_name,
            classLevel: record.class_level,
            date: record.date,
            status: record.status,
            markedBy: record.marked_by,
            note: record.note || '',
            createdAt: record.created,
            updatedAt: record.updated
        };
    };

})(window.dataService);
