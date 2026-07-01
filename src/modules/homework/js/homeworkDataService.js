/**
 * Homework Data Service
 * Extends window.dataService with homework-specific functionality.
 * Persists to PocketBase collections: homework_assignments, homework_submissions.
 * Must be loaded AFTER dataService.js
 */

(function (ds) {
    if (!ds) {
        console.error('[homeworkDataService] window.dataService not found — load dataService.js first');
        return;
    }

    const ASSIGNMENTS = 'homework_assignments';
    const SUBMISSIONS = 'homework_submissions';

    function normalizeClassKey(value) {
        return String(value || '').replace(/\s+/g, '').toLowerCase();
    }

    function isNotFound(error) {
        const status = error?.status ?? error?.statusCode;
        const message = String(error?.message || '').toLowerCase();
        return status === 404 || message.includes('404') || message.includes('not found');
    }

    function ownerId(user) {
        return user?.id || user?.user || null;
    }

    ds._mapHomeworkAssignment = function (record) {
        if (!record) return null;
        return {
            id: record.id,
            title: record.title || '',
            subject: record.subject || '',
            targetClass: record.target_class || '',
            dueDate: record.due_date || '',
            points: typeof record.points === 'number' ? record.points : Number(record.points || 0) || 0,
            instructions: record.instructions || '',
            status: record.status || 'published',
            createdBy: record.created_by || '',
            createdByName: record.created_by_name || '',
            schoolVersion: record.school_version || '',
            clientId: record.client_id || '',
            createdAt: record.created,
            updatedAt: record.updated
        };
    };

    ds._mapHomeworkSubmission = function (record) {
        if (!record) return null;
        return {
            id: record.id,
            assignmentId: record.assignment_id || '',
            studentId: record.student_id || '',
            studentName: record.student_name || '',
            classLevel: record.class_level || '',
            content: record.content || '',
            status: record.status || 'submitted',
            submittedAt: record.submitted_at || record.created || null,
            score: record.score ?? null,
            feedback: record.feedback || '',
            gradedBy: record.graded_by || '',
            gradedAt: record.graded_at || null,
            schoolVersion: record.school_version || '',
            clientId: record.client_id || '',
            createdAt: record.created,
            updatedAt: record.updated
        };
    };

    /**
     * Create a new homework assignment.
     */
    ds.createHomeworkAssignment = async function (payload = {}) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to create homework.');

        const title = String(payload.title || '').trim();
        const subject = String(payload.subject || '').trim();
        const targetClass = String(payload.targetClass || '').trim();
        const dueDate = payload.dueDate || '';

        if (!title || !subject || !targetClass || !dueDate) {
            throw new Error('Title, subject, class, and due date are required.');
        }

        const school = this.getSchoolContext();
        const data = {
            title,
            subject,
            target_class: targetClass,
            due_date: new Date(dueDate).toISOString(),
            points: Number(payload.points || 0) || 0,
            instructions: String(payload.instructions || '').trim(),
            status: payload.status || 'published',
            created_by: ownerId(user),
            created_by_name: user.name || user.username || 'Teacher',
            school_version: school.schoolVersion || '',
            client_id: school.clientId || ''
        };

        const created = await this.pb.collection(ASSIGNMENTS).create(data);
        return ds._mapHomeworkAssignment(created);
    };

    /**
     * Update an existing homework assignment.
     */
    ds.updateHomeworkAssignment = async function (assignmentId, payload = {}) {
        if (!assignmentId) throw new Error('Assignment id is required.');

        const data = {};
        if (payload.title !== undefined) data.title = String(payload.title).trim();
        if (payload.subject !== undefined) data.subject = String(payload.subject).trim();
        if (payload.targetClass !== undefined) data.target_class = String(payload.targetClass).trim();
        if (payload.dueDate !== undefined) data.due_date = payload.dueDate ? new Date(payload.dueDate).toISOString() : '';
        if (payload.points !== undefined) data.points = Number(payload.points || 0) || 0;
        if (payload.instructions !== undefined) data.instructions = String(payload.instructions || '').trim();
        if (payload.status !== undefined) data.status = payload.status;

        const updated = await this.pb.collection(ASSIGNMENTS).update(assignmentId, data);
        return ds._mapHomeworkAssignment(updated);
    };

    /**
     * Delete a homework assignment. Cascade-deletes its submissions on the server.
     */
    ds.deleteHomeworkAssignment = async function (assignmentId) {
        if (!assignmentId) throw new Error('Assignment id is required.');
        await this.pb.collection(ASSIGNMENTS).delete(assignmentId);
        return true;
    };

    /**
     * List assignments for the teacher dashboard.
     * - admins see every assignment in their school
     * - teachers see only the ones they created
     */
    ds.getTeacherHomeworkAssignments = async function () {
        const user = this.getCurrentUser();
        if (!user) return [];

        const school = this.getSchoolContext();
        const clauses = [];
        const params = {};

        if (user.role !== 'admin') {
            clauses.push('created_by = {:uid}');
            params.uid = ownerId(user);
        }
        if (school.schoolVersion) {
            clauses.push('(school_version = {:sv} || school_version = "")');
            params.sv = school.schoolVersion;
        }

        const filter = clauses.length ? this.pb.filter(clauses.join(' && '), params) : '';
        try {
            const records = await this.pb.collection(ASSIGNMENTS).getFullList({
                filter,
                sort: '-created'
            });
            return records.map(ds._mapHomeworkAssignment);
        } catch (error) {
            console.error('[Homework] getTeacherHomeworkAssignments error:', error);
            throw error;
        }
    };

    /**
     * List assignments visible to the currently signed-in student.
     * Matches by class (case/whitespace insensitive) or "All".
     */
    ds.getStudentHomeworkAssignments = async function () {
        const user = this.getCurrentUser();
        if (!user) return [];

        const school = this.getSchoolContext();
        const clauses = ['status = "published"'];
        const params = {};

        if (school.schoolVersion) {
            clauses.push('(school_version = {:sv} || school_version = "")');
            params.sv = school.schoolVersion;
        }

        const filter = this.pb.filter(clauses.join(' && '), params);
        try {
            const records = await this.pb.collection(ASSIGNMENTS).getFullList({
                filter,
                sort: 'due_date'
            });
            const studentClass = normalizeClassKey(user.classLevel || user.class_level);
            return records
                .map(ds._mapHomeworkAssignment)
                .filter((item) => {
                    const target = normalizeClassKey(item.targetClass);
                    return target === 'all' || target === studentClass;
                });
        } catch (error) {
            console.error('[Homework] getStudentHomeworkAssignments error:', error);
            throw error;
        }
    };

    /**
     * Find the current student's submission for a given assignment.
     */
    ds.getOwnHomeworkSubmission = async function (assignmentId) {
        const user = this.getCurrentUser();
        if (!user || !assignmentId) return null;

        try {
            const filter = this.pb.filter('assignment_id = {:aid} && student_id = {:sid}', {
                aid: assignmentId,
                sid: ownerId(user)
            });
            const record = await this.pb.collection(SUBMISSIONS).getFirstListItem(filter);
            return ds._mapHomeworkSubmission(record);
        } catch (error) {
            if (isNotFound(error)) return null;
            console.error('[Homework] getOwnHomeworkSubmission error:', error);
            throw error;
        }
    };

    /**
     * Map of assignmentId -> own submission for the signed-in student.
     */
    ds.getOwnHomeworkSubmissionMap = async function () {
        const user = this.getCurrentUser();
        if (!user) return {};

        try {
            const filter = this.pb.filter('student_id = {:sid}', { sid: ownerId(user) });
            const records = await this.pb.collection(SUBMISSIONS).getFullList({ filter });
            const map = {};
            records.forEach((record) => {
                const mapped = ds._mapHomeworkSubmission(record);
                if (mapped?.assignmentId) {
                    map[mapped.assignmentId] = mapped;
                }
            });
            return map;
        } catch (error) {
            console.error('[Homework] getOwnHomeworkSubmissionMap error:', error);
            throw error;
        }
    };

    /**
     * Submit (or re-submit) homework for the signed-in student.
     */
    ds.submitHomework = async function (assignmentId, payload = {}) {
        const user = this.getCurrentUser();
        if (!user) throw new Error('You need to be signed in to submit homework.');
        if (!assignmentId) throw new Error('Assignment id is required.');

        const content = String(payload.content || '').trim();
        if (!content) throw new Error('Submission cannot be empty.');

        const school = this.getSchoolContext();
        const submittedAt = new Date().toISOString();
        const data = {
            assignment_id: assignmentId,
            student_id: ownerId(user),
            student_name: user.name || user.username || 'Student',
            class_level: user.classLevel || user.class_level || '',
            content,
            status: 'submitted',
            submitted_at: submittedAt,
            school_version: school.schoolVersion || '',
            client_id: school.clientId || ''
        };

        let existing = null;
        try {
            const filter = this.pb.filter('assignment_id = {:aid} && student_id = {:sid}', {
                aid: assignmentId,
                sid: ownerId(user)
            });
            existing = await this.pb.collection(SUBMISSIONS).getFirstListItem(filter);
        } catch (error) {
            if (!isNotFound(error)) throw error;
        }

        let saved;
        if (existing) {
            saved = await this.pb.collection(SUBMISSIONS).update(existing.id, {
                content,
                status: 'submitted',
                submitted_at: submittedAt,
                class_level: data.class_level,
                student_name: data.student_name
            });
        } else {
            saved = await this.pb.collection(SUBMISSIONS).create(data);
        }
        return ds._mapHomeworkSubmission(saved);
    };

    /**
     * List submissions for a single assignment (teacher/admin view).
     */
    ds.getHomeworkSubmissionsForAssignment = async function (assignmentId) {
        if (!assignmentId) return [];
        try {
            const filter = this.pb.filter('assignment_id = {:aid}', { aid: assignmentId });
            const records = await this.pb.collection(SUBMISSIONS).getFullList({
                filter,
                sort: 'student_name'
            });
            return records.map(ds._mapHomeworkSubmission);
        } catch (error) {
            console.error('[Homework] getHomeworkSubmissionsForAssignment error:', error);
            throw error;
        }
    };

    /**
     * Aggregate submission summary for a list of assignments
     * (used to power the teacher dashboard stats and review queue).
     */
    ds.getHomeworkSubmissionSummary = async function (assignments = []) {
        if (!Array.isArray(assignments) || !assignments.length) return [];

        try {
            // PocketBase has no `IN` operator — chain ORs across the assignment ids.
            const orFilter = assignments.map((_, idx) => `assignment_id = {:aid${idx}}`).join(' || ');
            const params = {};
            assignments.forEach((a, idx) => { params[`aid${idx}`] = a.id; });

            const records = await this.pb.collection(SUBMISSIONS).getFullList({
                filter: this.pb.filter(orFilter, params),
                sort: '-created'
            });

            const byAssignment = new Map();
            records.forEach((record) => {
                const mapped = ds._mapHomeworkSubmission(record);
                if (!byAssignment.has(mapped.assignmentId)) {
                    byAssignment.set(mapped.assignmentId, []);
                }
                byAssignment.get(mapped.assignmentId).push(mapped);
            });

            return assignments.map((assignment) => {
                const list = byAssignment.get(assignment.id) || [];
                const graded = list.filter((s) => s.status === 'graded' || s.status === 'returned').length;
                return {
                    assignmentId: assignment.id,
                    submissionCount: list.length,
                    gradedCount: graded,
                    submissions: list
                };
            });
        } catch (error) {
            console.error('[Homework] getHomeworkSubmissionSummary error:', error);
            throw error;
        }
    };

    /**
     * Grade (or re-grade) a single submission.
     */
    ds.gradeHomeworkSubmission = async function (submissionId, { score = null, feedback = '', status = 'graded' } = {}) {
        if (!submissionId) throw new Error('Submission id is required.');
        const user = this.getCurrentUser();
        const data = {
            score: score === null || score === '' ? null : Number(score),
            feedback: String(feedback || '').trim(),
            status,
            graded_by: ownerId(user) || '',
            graded_at: new Date().toISOString()
        };
        const updated = await this.pb.collection(SUBMISSIONS).update(submissionId, data);
        return ds._mapHomeworkSubmission(updated);
    };

})(window.dataService);

/**
 * Thin compatibility shim — the previous build attached a `homeworkDataService`
 * global. Keep it as a forwarding object so any leftover callers still work,
 * but every call routes through the canonical methods on window.dataService.
 */
(function (global) {
    'use strict';
    const ds = global.dataService;
    if (!ds) return;

    global.homeworkDataService = {
        getCurrentUser: () => ds.getCurrentUser?.() || null,
        getSchoolContext: () => ds.getSchoolContext?.() || { schoolVersion: null, userId: null, role: null, clientId: null },
        async getAcademicEntities(options = {}) {
            if (ds.getAcademicEntities) return ds.getAcademicEntities(options);
            return {
                classesByLevel: global.academicEntities?.getClassesByLevel?.({ includeAll: !!options.includeAllClasses }) || {},
                subjectsByLevel: global.academicEntities?.getSubjectsByLevel?.() || {},
                students: []
            };
        },
        createAssignment: (payload) => ds.createHomeworkAssignment(payload),
        updateAssignment: (id, payload) => ds.updateHomeworkAssignment(id, payload),
        deleteAssignment: (id) => ds.deleteHomeworkAssignment(id),
        getTeacherAssignments: () => ds.getTeacherHomeworkAssignments(),
        getStudentAssignments: () => ds.getStudentHomeworkAssignments(),
        getOwnSubmission: (assignmentId) => ds.getOwnHomeworkSubmission(assignmentId),
        getAssignmentSubmissionMap: () => ds.getOwnHomeworkSubmissionMap(),
        submitAssignment: (assignmentId, payload) => ds.submitHomework(assignmentId, payload),
        getSubmissionsForAssignment: (assignmentId) => ds.getHomeworkSubmissionsForAssignment(assignmentId),
        getSubmissionSummary: (assignments) => ds.getHomeworkSubmissionSummary(assignments),
        gradeSubmission: (submissionId, payload) => ds.gradeHomeworkSubmission(submissionId, payload)
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
