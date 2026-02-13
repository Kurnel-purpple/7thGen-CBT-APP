/**
 * Data Service Module (PocketBase Version)
 * Handles persistence using PocketBase Client.
 */

class DataService {
    constructor() {
        // Initialize PocketBase client
        this.pb = new PocketBase('https://gen7-cbt-app.fly.dev'); // Production PocketBase on Fly.io
        this.pb.autoCancellation(false);

        // Restore auth state from localStorage
        const savedAuth = localStorage.getItem('pb_auth');
        if (savedAuth) {
            try {
                const authData = JSON.parse(savedAuth);
                if (authData.token) {
                    this.pb.authStore.save(authData.token, authData.model);
                    console.log('✅ Auth restored for:', authData.model?.email);
                }
            } catch (e) {
                console.warn('Failed to restore auth state:', e);
                localStorage.removeItem('pb_auth');
            }
        }

        // Auto-persist auth state whenever it changes
        this.pb.authStore.onChange((token, model) => {
            if (token) {
                localStorage.setItem('pb_auth', JSON.stringify({ token, model }));
            } else {
                localStorage.removeItem('pb_auth');
            }
        });

        this.PROXY_DOMAIN = 'school.cbt';
        this.queryCache = new Map();
        this.CACHE_TTL = 30000; // 30 seconds cache for dashboard queries
    }

    _getPB() {
        return this.pb;
    }

    /**
     * Helper to generate email from ID/Username
     */
    _generateEmail(identifier) {
        identifier = identifier.trim();
        if (identifier.includes('@')) {
            return identifier;
        }
        return `${identifier}@${this.PROXY_DOMAIN}`;
    }

    // --- Auth ---

    async registerUser(userData) {
        const email = this._generateEmail(userData.username);

        try {
            // Create user in PocketBase
            const user = await this.pb.collection('users').create({
                email: email,
                password: userData.password,
                passwordConfirm: userData.password,
                role: userData.role,
                full_name: userData.name,
                class_level: userData.classLevel || null,
                school_version: userData.schoolVersion || null,
                emailVisibility: false
            });

            // Also create/update profile record
            try {
                await this.pb.collection('profiles').create({
                    id: user.id,
                    role: userData.role,
                    full_name: userData.name,
                    class_level: userData.classLevel || null,
                    school_version: userData.schoolVersion || null,
                    user: user.id
                });
            } catch (profileErr) {
                console.warn('Profile creation note:', profileErr.message);
            }

            return user;
        } catch (error) {
            throw new Error(error.message || 'Registration failed');
        }
    }

    async login(identifier, password) {
        const email = this._generateEmail(identifier);

        try {
            // Authenticate with PocketBase
            const authData = await this.pb.collection('users').authWithPassword(email, password);

            if (!authData.record) {
                throw new Error('Login failed: No user data returned');
            }

            // Auth state is auto-saved by the onChange listener in constructor

            // Get user profile
            let profile = null;
            try {
                profile = await this.pb.collection('profiles').getFirstListItem(`user="${authData.record.id}"`);
            } catch (profileErr) {
                // Profile might not exist yet
                console.warn('Profile fetch failed:', profileErr.message);
                // Create profile from user data
                profile = {
                    role: authData.record.role || 'student',
                    full_name: authData.record.full_name,
                    class_level: authData.record.class_level,
                    school_version: authData.record.school_version
                };
            }

            const userObj = {
                id: authData.record.id,
                email: authData.record.email,
                username: authData.record.username,
                role: profile?.role || authData.record.role || 'student',
                name: profile?.full_name || authData.record.full_name,
                classLevel: profile?.class_level || authData.record.class_level,
                schoolVersion: profile?.school_version || authData.record.school_version,
                _pb_user: authData.record
            };

            localStorage.setItem('cbt_user_meta', JSON.stringify(userObj));
            return userObj;

        } catch (err) {
            // Offline Fallback
            if (!navigator.onLine || err.message === 'Failed to fetch') {
                const cachedUser = this.getCurrentUser();
                if (cachedUser && cachedUser.email === email) {
                    console.warn('Network error, logging in with cached credentials.');
                    return cachedUser;
                }

                const offlineUsers = JSON.parse(localStorage.getItem('cbt_offline_users') || '[]');
                const offlineStudent = offlineUsers.find(u => {
                    return u.username === identifier || u.email === identifier;
                });

                if (offlineStudent) {
                    console.warn('Network error, treating as Offline Student Login.');
                    const userObj = {
                        id: offlineStudent.id,
                        email: offlineStudent.email || `${offlineStudent.username}@school.cbt`,
                        role: offlineStudent.role,
                        name: offlineStudent.full_name,
                        classLevel: offlineStudent.class_level,
                        _pb_user: { id: offlineStudent.id, email: offlineStudent.email }
                    };

                    localStorage.setItem('cbt_user_meta', JSON.stringify(userObj));
                    return userObj;
                }
            }
            throw err;
        }
    }

    getCurrentUser() {
        const cached = localStorage.getItem('cbt_user_meta');
        return cached ? JSON.parse(cached) : null;
    }

    async logout() {
        try {
            this.pb.authStore.clear();
        } catch (err) {
            console.warn('PocketBase logout error:', err);
        } finally {
            localStorage.removeItem('cbt_user_meta');
            localStorage.removeItem('pb_auth');
            localStorage.removeItem('cbt_exam_cache');
            localStorage.removeItem('cbt_pending_submissions');
        }
    }

    async updatePassword(oldPassword, newPassword) {
        try {
            if (!this.pb.authStore.isValid) {
                throw new Error('Not authenticated');
            }
            await this.pb.collection('users').update(this.pb.authStore.model.id, {
                oldPassword: oldPassword,
                password: newPassword,
                passwordConfirm: newPassword,
            });
            return true;
        } catch (error) {
            throw new Error(error.message || 'Failed to update password');
        }
    }

    /**
     * Get current username (prefers explicit username field, falls back to email extraction)
     */
    getUsername() {
        const user = this.getCurrentUser();
        if (!user) return '';
        if (user.username) return user.username;
        if (user.email) {
            return user.email.replace(`@${this.PROXY_DOMAIN}`, '');
        }
        return '';
    }

    /**
     * Update username (updates both username and email field for login consistency)
     */
    async updateUsername(newUsername) {
        try {
            if (!this.pb.authStore.isValid) {
                throw new Error('Not authenticated');
            }

            // Validate username
            if (!newUsername || newUsername.length < 3) {
                throw new Error('Username must be at least 3 characters');
            }

            if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
                throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
            }

            // Update both username and email (for login consistency)
            const newEmail = `${newUsername}@${this.PROXY_DOMAIN}`;
            const updatedUser = await this.pb.collection('users').update(this.pb.authStore.model.id, {
                username: newUsername,
                email: newEmail
            });

            // Update local metadata cache
            const cached = this.getCurrentUser();
            if (cached) {
                cached.username = updatedUser.username;
                cached.email = updatedUser.email;
                localStorage.setItem('cbt_user_meta', JSON.stringify(cached));
            }

            return updatedUser;
        } catch (error) {
            if (error.status === 400 && error.data?.data?.username) {
                throw new Error('This username is already taken. Please choose another.');
            }
            if (error.status === 400 && error.data?.data?.email) {
                throw new Error('This username variant is already taken.');
            }
            throw new Error(error.message || 'Failed to update username');
        }
    }

    async getUsers(role) {
        try {
            let filter = '';
            if (role) {
                filter = `role="${role}"`;
            }

            const users = await this.pb.collection('profiles').getFullList({
                filter: filter
            });

            return users;
        } catch (error) {
            throw error;
        }
    }

    // --- Exams ---

    async getExams(filters = {}) {
        const cacheKey = `exams_${JSON.stringify(filters)}`;

        // Check cache for dashboard queries
        if (filters.studentDashboard && this.queryCache.has(cacheKey)) {
            const cached = this.queryCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.CACHE_TTL) {
                console.log('📋 Serving exams from cache');
                return cached.data;
            }
        }

        try {
            let filterString = '';

            if (filters.status) {
                filterString += `status="${filters.status}"`;
            }

            if (filters.teacherId) {
                if (filterString) filterString += ' && ';
                filterString += `created_by="${filters.teacherId}"`;
            }

            if (filters.targetClass) {
                if (filterString) filterString += ' && ';
                filterString += `(target_class="${filters.targetClass}" || target_class="All")`;
            }

            const options = {
                filter: filterString,
                sort: '-created'
            };

            if (filters.studentDashboard) {
                options.perPage = 50;
            }

            const exams = await this.pb.collection('exams').getFullList(options);

            const mappedData = exams.map(e => this._mapExam(e));

            // Cache dashboard queries
            if (filters.studentDashboard) {
                this.queryCache.set(cacheKey, {
                    data: mappedData,
                    timestamp: Date.now()
                });
            }

            return mappedData;
        } catch (error) {
            throw error;
        }
    }

    async getExamById(id) {
        try {
            const exam = await this.pb.collection('exams').getOne(id);
            const mappedExam = this._mapExam(exam);

            // Cache the exam
            const cache = JSON.parse(localStorage.getItem('cbt_exam_cache') || '{}');
            cache[id] = mappedExam;
            localStorage.setItem('cbt_exam_cache', JSON.stringify(cache));

            return mappedExam;
        } catch (err) {
            if (!navigator.onLine || err.message === 'Failed to fetch') {
                const cache = JSON.parse(localStorage.getItem('cbt_exam_cache') || '{}');
                if (cache[id]) {
                    console.warn(`Serving exam ${id} from cache.`);
                    return cache[id];
                }
            }
            return null;
        }
    }

    async createExam(examData) {
        const clientGeneratedId = examData._clientId || `exam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Check for existing exam
        try {
            const existing = await this.pb.collection('exams').getFirstListItem(`client_id="${clientGeneratedId}"`);
            if (existing) {
                console.log('Exam already exists (duplicate prevented), returning existing:', existing.id);
                return await this.getExamById(existing.id);
            }
        } catch (checkErr) {
            // No existing exam found, continue
        }

        try {
            const data = {
                title: examData.title,
                school_level: examData.schoolLevel || null,
                subject: examData.subject,
                target_class: examData.targetClass,
                duration: examData.duration,
                pass_score: examData.passScore,
                instructions: examData.instructions,
                theory_instructions: examData.theoryInstructions || null,
                questions: examData.questions,
                status: examData.status || 'draft',
                created_by: examData.createdBy,
                scheduled_date: examData.scheduledDate || null,
                scramble_questions: examData.scrambleQuestions || false,
                client_id: clientGeneratedId
            };

            const created = await this.pb.collection('exams').create(data);
            return this._mapExam(created);
        } catch (error) {
            throw error;
        }
    }

    async updateExam(id, updates) {
        try {
            const data = {};
            if (updates.title) data.title = updates.title;
            if (updates.subject) data.subject = updates.subject;
            if (updates.targetClass) data.target_class = updates.targetClass;
            if (updates.duration) data.duration = updates.duration;
            if (updates.passScore) data.pass_score = updates.passScore;
            if (updates.instructions) data.instructions = updates.instructions;
            if (updates.questions) data.questions = updates.questions;
            if (updates.status) data.status = updates.status;
            if (updates.extensions !== undefined) data.extensions = updates.extensions;
            if (updates.globalExtension !== undefined) data.global_extension = updates.globalExtension;
            if (updates.scheduledDate !== undefined) data.scheduled_date = updates.scheduledDate;
            if (updates.scrambleQuestions !== undefined) data.scramble_questions = updates.scrambleQuestions;

            const updated = await this.pb.collection('exams').update(id, data);
            return this._mapExam(updated);
        } catch (error) {
            throw error;
        }
    }

    async deleteExam(id) {
        try {
            await this.pb.collection('exams').delete(id);
            return true;
        } catch (error) {
            throw error;
        }
    }

    _mapExam(dbExam) {
        if (!dbExam) return null;
        return {
            id: dbExam.id,
            title: dbExam.title,
            subject: dbExam.subject,
            targetClass: dbExam.target_class,
            duration: dbExam.duration,
            passScore: dbExam.pass_score,
            instructions: dbExam.instructions,
            questions: dbExam.questions,
            status: dbExam.status,
            createdBy: dbExam.created_by,
            createdAt: dbExam.created,
            updatedAt: dbExam.updated,
            extensions: dbExam.extensions || {},
            globalExtension: dbExam.global_extension || null,
            scheduledDate: dbExam.scheduled_date || null,
            scrambleQuestions: dbExam.scramble_questions || false
        };
    }

    // --- Results ---

    async saveResult(resultData) {
        const data = {
            exam_id: resultData.examId,
            student_id: resultData.studentId,
            score: resultData.score,
            total_points: resultData.totalPoints,
            answers: resultData.answers,
            flags: { ...resultData.flags, _status: 'completed' },
            submitted_at: new Date().toISOString()
        };

        try {
            // Try to find existing result first
            try {
                const existing = await this.pb.collection('results').getFirstListItem(
                    `exam_id="${resultData.examId}" && student_id="${resultData.studentId}"`
                );
                // Update existing
                const updated = await this.pb.collection('results').update(existing.id, data);
                return this._mapResult(updated);
            } catch (notFoundErr) {
                // Create new
                const created = await this.pb.collection('results').create(data);
                return this._mapResult(created);
            }
        } catch (err) {
            if (!navigator.onLine || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
                data._local_id = Date.now();
                pending.push(data);
                localStorage.setItem('cbt_pending_submissions', JSON.stringify(pending));
                throw new Error('Saved Offline');
            }
            throw err;
        }
    }

    async startExamSession(examId, studentId) {
        try {
            // Check if exists
            try {
                const existing = await this.pb.collection('results').getFirstListItem(
                    `exam_id="${examId}" && student_id="${studentId}"`
                );
                return; // Already exists
            } catch (notFoundErr) {
                // Create new session marker
                await this.pb.collection('results').create({
                    exam_id: examId,
                    student_id: studentId,
                    flags: { _status: 'in-progress', _started_at: new Date().toISOString() },
                    score: 0,
                    total_points: 0,
                    answers: {}
                });
            }
        } catch (error) {
            console.error('Failed to start session', error);
        }
    }

    async getResults(filters = {}) {
        try {
            let filterString = '';

            if (filters.studentId) {
                filterString += `student_id="${filters.studentId}"`;
            }

            if (filters.examId) {
                if (filterString) filterString += ' && ';
                filterString += `exam_id="${filters.examId}"`;
            }

            const options = {
                filter: filterString,
                sort: '-submitted_at',  // This is a custom field, not PocketBase's built-in
                expand: 'student_id' // Get student info
            };

            if (filters.studentDashboard) {
                options.perPage = 100;
            }

            const results = await this.pb.collection('results').getFullList(options);
            return results.map(r => this._mapResult(r));
        } catch (error) {
            throw error;
        }
    }

    _mapResult(dbResult) {
        if (!dbResult) return null;

        let status = 'completed';
        if (dbResult.flags && dbResult.flags._status) {
            status = dbResult.flags._status;
        }

        // Get student name from expanded relation
        let studentName = 'Unknown';
        if (dbResult.expand && dbResult.expand.student_id) {
            studentName = dbResult.expand.student_id.full_name;
        }

        return {
            id: dbResult.id,
            examId: dbResult.exam_id,
            studentId: dbResult.student_id,
            score: dbResult.score,
            totalPoints: (dbResult.flags && dbResult.flags._real_total_points) ?
                parseFloat(dbResult.flags._real_total_points) : dbResult.total_points,
            passScore: dbResult.pass_score,
            passed: dbResult.passed,
            answers: dbResult.answers,
            submittedAt: dbResult.submitted_at,
            studentName: studentName,
            flags: dbResult.flags || {},
            status: status
        };
    }

    async updateResult(resultId, updates) {
        try {
            const data = {};
            if (updates.flags !== undefined) data.flags = updates.flags;
            if (updates.score !== undefined) data.score = updates.score;
            if (updates.totalPoints !== undefined) data.total_points = updates.totalPoints;
            if (updates.answers !== undefined) data.answers = updates.answers;
            if (updates.passScore !== undefined) data.pass_score = updates.passScore;
            if (updates.passed !== undefined) data.passed = updates.passed;

            const updated = await this.pb.collection('results').update(resultId, data);
            return this._mapResult(updated);
        } catch (error) {
            // If no data returned (auth issue), return success indicator
            if (error.status === 403) {
                return { id: resultId, ...updates };
            }
            throw error;
        }
    }

    // --- Offline Prep ---

    async prepareOfflineData(teacherId) {
        if (!navigator.onLine) throw new Error('Must be online to prepare device.');

        try {
            // Fetch students
            const students = await this.pb.collection('profiles').getFullList({
                filter: 'role="student"'
            });

            // Fetch active exams
            const exams = await this.pb.collection('exams').getFullList({
                filter: 'status!="draft"'
            });

            // Cache students
            const offlineUsers = students.map(s => ({
                id: s.id,
                username: s.username || s.full_name,
                full_name: s.full_name,
                role: 'student',
                class_level: s.class_level,
                email: s.email
            }));

            localStorage.setItem('cbt_offline_users', JSON.stringify(offlineUsers));

            // Cache exams
            const examCache = {};
            exams.forEach(e => {
                examCache[e.id] = this._mapExam(e);
            });
            localStorage.setItem('cbt_exam_cache', JSON.stringify(examCache));

            return { students: offlineUsers.length, exams: exams.length };
        } catch (error) {
            throw error;
        }
    }

    async syncPendingResults() {
        if (!navigator.onLine) return { synced: 0, pending: 0 };

        const useIndexedDB = window.idb && window.idb.isIndexedDBAvailable();
        let pending = [];

        // Get pending submissions
        if (useIndexedDB) {
            try {
                pending = await window.idb.getPendingSubmissions();
            } catch (err) {
                console.warn('Could not read from IndexedDB, trying localStorage:', err);
                pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
            }
        } else {
            pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
        }

        if (pending.length === 0) return { synced: 0, pending: 0 };

        console.log(`📤 Syncing ${pending.length} pending submissions...`);
        const failed = [];
        let syncedCount = 0;

        for (const submission of pending) {
            try {
                const { _local_id, localId, timestamp, synced, cachedAt, ...cleanPayload } = submission;

                const data = {
                    exam_id: cleanPayload.exam_id || cleanPayload.examId,
                    student_id: cleanPayload.student_id || cleanPayload.studentId,
                    score: cleanPayload.score,
                    total_points: cleanPayload.total_points || cleanPayload.totalPoints,
                    pass_score: cleanPayload.pass_score || cleanPayload.passScore,
                    answers: cleanPayload.answers,
                    flags: cleanPayload.flags || {},
                    submitted_at: cleanPayload.submitted_at || cleanPayload.submittedAt || new Date().toISOString()
                };

                try {
                    // Check if already exists
                    const existing = await this.pb.collection('results').getFirstListItem(
                        `exam_id="${data.exam_id}" && student_id="${data.student_id}"`
                    );
                    // Update existing
                    await this.pb.collection('results').update(existing.id, data);
                    syncedCount++;
                } catch (notFoundErr) {
                    // Create new
                    await this.pb.collection('results').create(data);
                    syncedCount++;
                }

                // Remove from IndexedDB if using it
                if (useIndexedDB && submission.localId) {
                    try {
                        await window.idb.removePendingSubmission(submission.localId);
                    } catch (e) {
                        console.warn('Could not remove synced submission from IndexedDB:', e);
                    }
                }
            } catch (err) {
                console.error('Failed to sync submission:', submission, err);
                failed.push(submission);
            }
        }

        // Update storage with failed submissions only
        localStorage.setItem('cbt_pending_submissions', JSON.stringify(failed));

        console.log(`✅ Sync complete: ${syncedCount} sent, ${failed.length} pending`);
        return { synced: syncedCount, pending: failed.length };
    }

    // --- Messaging ---

    async sendMessage(messageData) {
        try {
            const data = {
                from_id: messageData.fromId,
                to_id: messageData.toId,
                message: messageData.message,
                school_version: messageData.schoolVersion,
                read: false
            };

            const created = await this.pb.collection('messages').create(data);
            return created;
        } catch (error) {
            throw error;
        }
    }

    async getMessages(filters = {}) {
        try {
            let filterString = '';

            if (filters.toId) {
                filterString += `to_id="${filters.toId}"`;
            }
            if (filters.fromId) {
                if (filterString) filterString += ' && ';
                filterString += `from_id="${filters.fromId}"`;
            }
            if (filters.schoolVersion) {
                if (filterString) filterString += ' && ';
                filterString += `school_version="${filters.schoolVersion}"`;
            }

            const messages = await this.pb.collection('messages').getFullList({
                filter: filterString,
                sort: '-created',
                expand: 'from_id,to_id'
            });

            return messages;
        } catch (error) {
            console.error('getMessages error:', error);
            throw error;
        }
    }

    async markMessageAsRead(messageId) {
        try {
            await this.pb.collection('messages').update(messageId, { read: true });
            return true;
        } catch (error) {
            throw error;
        }
    }

    async deleteMessage(messageId) {
        try {
            await this.pb.collection('messages').delete(messageId);
            return true;
        } catch (error) {
            throw error;
        }
    }
}

// Global instance
window.dataService = new DataService();
export default window.dataService;
