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
                profileId: profile?.id,
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

    /**
     * Update user profile fields (updates both users and profiles collections)
     */
    async updateProfile(updates) {
        try {
            if (!this.pb.authStore.isValid) {
                throw new Error('Not authenticated');
            }

            const userId = this.pb.authStore.model.id;

            // 1. Update users collection (central identity)
            const userData = {};
            if (updates.schoolVersion !== undefined) userData.school_version = updates.schoolVersion;
            if (updates.full_name !== undefined) userData.full_name = updates.full_name;
            if (updates.role !== undefined) userData.role = updates.role;
            if (updates.class_level !== undefined) userData.class_level = updates.class_level;

            const updatedUser = await this.pb.collection('users').update(userId, userData);

            // 2. Update/Create profiles collection (used for admin/teacher lists)
            try {
                // Prepare profile data
                const profileData = {
                    user: userId
                };
                if (updates.schoolVersion !== undefined) profileData.school_version = updates.schoolVersion;
                if (updates.full_name !== undefined) profileData.full_name = updates.full_name;
                if (updates.role !== undefined) profileData.role = updates.role;
                if (updates.class_level !== undefined) profileData.class_level = updates.class_level;

                // Check if profile exists
                try {
                    const profile = await this.pb.collection('profiles').getFirstListItem(`user="${userId}"`);
                    await this.pb.collection('profiles').update(profile.id, profileData);
                } catch (findErr) {
                    // Profile doesn't exist, CREATE it
                    // Ensure role and full_name are included if missing from updates
                    if (!profileData.role) profileData.role = updatedUser.role || 'teacher';
                    if (!profileData.full_name) profileData.full_name = updatedUser.full_name;

                    await this.pb.collection('profiles').create(profileData);
                    console.log('Created missing profile for user:', userId);
                }
            } catch (profileErr) {
                console.error('Profile sync failed:', profileErr.message);
                // We don't throw here to ensure the user update is still considered successful
            }

            // 3. Update local metadata cache
            const cached = this.getCurrentUser();
            if (cached) {
                if (updates.schoolVersion !== undefined) cached.schoolVersion = updates.schoolVersion;
                if (updates.full_name !== undefined) cached.name = updates.full_name;
                localStorage.setItem('cbt_user_meta', JSON.stringify(cached));
            }

            return updatedUser;
        } catch (error) {
            console.error('updateProfile error:', error);
            throw new Error(error.message || 'Failed to update profile');
        }
    }



    async getUsers(filters = {}) {
        try {
            let filterString = '';
            if (filters.role) {
                filterString = `role="${filters.role}"`;
            }
            if (filters.schoolVersion) {
                if (filterString) filterString += ' && ';
                filterString += `school_version="${filters.schoolVersion}"`;
            }

            const users = await this.pb.collection('profiles').getFullList({
                filter: filterString
            });

            return users;
        } catch (error) {
            console.error('getUsers error:', error);
            throw error;
        }
    }

    /**
     * Subscribe to profile updates
     */
    async subscribeToProfiles(callback) {
        try {
            return await this.pb.collection('profiles').subscribe('*', (e) => {
                callback(e);
            });
        } catch (error) {
            console.error('Subscription error:', error);
            throw error;
        }
    }

    /**
     * Unsubscribe from profile updates
     */
    async unsubscribeFromProfiles() {
        try {
            await this.pb.collection('profiles').unsubscribe('*');
        } catch (error) {
            console.error('Unsubscribe error:', error);
        }
    }


    // --- Exams ---

    // --- Exams ---

    async getExams(filters = {}) {
        // Exclude forceRefresh from cache key so we update the same cache entry
        const { forceRefresh, ...cacheFilters } = filters;
        const cacheKey = `exams_${JSON.stringify(cacheFilters)}`;

        // 1. Try IDB Cache first
        if (window.idb && !forceRefresh) {
            try {
                const cached = await window.idb.getDashboardCache(cacheKey);
                // If we have cache, return it immediately! 
                // We rely on manual updates (create/edit) to keep it fresh, 
                // or the user can manually refresh if they suspect desync.
                if (cached && cached.data && cached.data.length > 0) {
                    console.log('📦 Serving exams from IDB cache');

                    // Optional: Trigger background refresh if cache is too old (e.g. > 1 hour)
                    // But for now, we prioritize speed as requested.
                    return cached.data;
                }
            } catch (e) {
                console.warn('IDB Cache read error:', e);
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

            // 2. Save to IDB
            if (window.idb) {
                // Save the list for this specific query
                await window.idb.saveDashboardCache(cacheKey, mappedData);
                // Save individual exams to the object store for getExamById
                await window.idb.saveExams(mappedData);
            }

            return mappedData;
        } catch (error) {
            // Fallback to cache even if empty/old on network error
            if (window.idb) {
                try {
                    const cached = await window.idb.getDashboardCache(cacheKey);
                    if (cached) return cached.data;
                } catch (e) { /* ignore */ }
            }
            throw error;
        }
    }

    async getExamById(id) {
        // 1. Try IDB first
        if (window.idb) {
            try {
                const cachedExam = await window.idb.getExam(id);
                if (cachedExam) {
                    console.log(`📦 Serving exam ${id} from IDB`);
                    return cachedExam;
                }
            } catch (e) { console.warn(e); }
        }

        try {
            const exam = await this.pb.collection('exams').getOne(id);
            const mappedExam = this._mapExam(exam);

            // 2. Save to IDB
            if (window.idb) {
                await window.idb.saveExam(mappedExam);
            }

            return mappedExam;
        } catch (err) {
            throw err;
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
            const mappedExam = this._mapExam(created);

            // 3. Update Cache Manually
            if (window.idb) {
                await window.idb.saveExam(mappedExam);
                // Smart Update: Add to teacher's dashboard list
                await this._updateDashboardCacheList(mappedExam, 'add');
            }

            return mappedExam;
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
            const mappedExam = this._mapExam(updated);

            // Update Cache Manually
            if (window.idb) {
                await window.idb.saveExam(mappedExam);
                await this._updateDashboardCacheList(mappedExam, 'update');
            }

            return mappedExam;
        } catch (error) {
            throw error;
        }
    }

    async deleteExam(id) {
        try {
            await this.pb.collection('exams').delete(id);

            // Remove from Cache
            if (window.idb) {
                await window.idb.deleteExam(id);
                await this._updateDashboardCacheList({ id, createdBy: this.getCurrentUser()?.id }, 'delete'); // Need createdBy to find key? Or just try common keys
            }

            return true;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Helper to manually update dashboard lists in cache
     * This avoids needing to re-fetch the whole list
     */
    async _updateDashboardCacheList(exam, action) {
        if (!window.idb) return;

        // Construct potential keys. 
        // The Teacher Dashboard usually queries by { teacherId: ... }
        // The Student Dashboard queries by { studentDashboard: true, targetClass: ... }

        // 1. Teacher Cache Update
        if (exam.createdBy) {
            const teacherKey = `exams_${JSON.stringify({ teacherId: exam.createdBy })}`;
            await this._performCacheListUpdate(teacherKey, exam, action);
        }

        // 2. Student Dashboard Cache Update (if exam is active/published)
        if (exam.targetClass) {
            // We might have multiple keys depending on how filters are combined.
            // This is a "best effort" update.
            const studentKey = `exams_${JSON.stringify({ studentDashboard: true, targetClass: exam.targetClass })}`;
            // Also "All" classes
            const studentKeyAll = `exams_${JSON.stringify({ studentDashboard: true, targetClass: 'All' })}`;

            await this._performCacheListUpdate(studentKey, exam, action, true); // true = prevent adding drafts to student view
            await this._performCacheListUpdate(studentKeyAll, exam, action, true);
        }
    }

    async _performCacheListUpdate(key, exam, action, isStudentView = false) {
        try {
            const cached = await window.idb.getDashboardCache(key);
            if (cached && cached.data) {
                let list = cached.data;
                const index = list.findIndex(e => e.id === exam.id);

                if (action === 'add') {
                    if (isStudentView && exam.status !== 'active') return; // Don't add drafts to student
                    if (index === -1) {
                        list.unshift(exam); // Add to top
                    }
                } else if (action === 'update') {
                    if (index !== -1) {
                        if (isStudentView && exam.status !== 'active') {
                            list.splice(index, 1); // Remove if no longer active
                        } else {
                            list[index] = exam; // Update
                        }
                    } else if (isStudentView && exam.status === 'active') {
                        list.unshift(exam); // Add if now active
                    }
                } else if (action === 'delete') {
                    if (index !== -1) list.splice(index, 1);
                }

                await window.idb.saveDashboardCache(key, list);
                console.log(`🔄 Smart-updated cache for ${key}`);
            }
        } catch (e) {
            console.warn('Cache manual update failed', e);
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
            let result;
            try {
                const existing = await this.pb.collection('results').getFirstListItem(
                    `exam_id="${resultData.examId}" && student_id="${resultData.studentId}"`
                );
                // Update existing
                const updated = await this.pb.collection('results').update(existing.id, data);
                result = this._mapResult(updated);
            } catch (notFoundErr) {
                // Create new
                const created = await this.pb.collection('results').create(data);
                result = this._mapResult(created);
            }

            // Update IDB Results Cache
            if (window.idb) {
                await window.idb.saveResults([result]);
            }
            return result;

        } catch (err) {
            if (!navigator.onLine || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
                data._local_id = Date.now();
                pending.push(data);
                localStorage.setItem('cbt_pending_submissions', JSON.stringify(pending));

                // Also save to IDB Pending
                if (window.idb) {
                    await window.idb.queuePendingSubmission(data);
                }

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
        // Exclude forceRefresh from cache key
        const { forceRefresh, ...cacheFilters } = filters;
        const cacheKey = `results_${JSON.stringify(cacheFilters)}`;

        // 1. Try IDB Cache
        if (window.idb && !forceRefresh) {
            try {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached && cached.data && cached.data.length > 0) {
                    return cached.data;
                }
            } catch (e) { }
        }

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
                sort: '-submitted_at',
                expand: 'student_id'
            };

            if (filters.studentDashboard) {
                options.perPage = 100;
            }

            const results = await this.pb.collection('results').getFullList(options);
            const mappedResults = results.map(r => this._mapResult(r));

            // 2. Save to IDB
            if (window.idb) {
                await window.idb.saveDashboardCache(cacheKey, mappedResults);
                await window.idb.saveResults(mappedResults);
            }

            return mappedResults;
        } catch (error) {
            // Fallback
            if (window.idb) {
                const cached = await window.idb.getDashboardCache(cacheKey);
                if (cached) return cached.data;
            }
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
            if (filters.toId) {
                if (filterString) filterString += ' && ';
                filterString += `to_id="${filters.toId}"`;
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

    /**
     * Subscribe to messages
     */
    async subscribeToMessages(callback) {
        try {
            return await this.pb.collection('messages').subscribe('*', (e) => {
                callback(e);
            });
        } catch (error) {
            console.error('Message subscription error:', error);
            throw error;
        }
    }

    /**
     * Unsubscribe from messages
     */
    async unsubscribeFromMessages() {
        try {
            await this.pb.collection('messages').unsubscribe('*');
        } catch (error) {
            console.error('Message unsubscribe error:', error);
        }
    }

    /**

     * Step 1: Request a reset code
     * Generates a 6-digit code and sends it to the school admin
     */
    async requestPasswordReset(username) {
        try {
            // Use admin identity to bypass permission restrictions on profile search
            const ADMIN_EMAIL = "corneliusajayi123@gmail.com";
            const ADMIN_PASS = "Finest1709";
            const adminPb = new PocketBase(this.pb.baseUrl);
            await adminPb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASS);

            // 1. Find the user record
            // We search across users collection first since it's the source of truth for username/email
            let userRecord;
            try {
                userRecord = await adminPb.collection('users').getFirstListItem(
                    `username="${username}" || email="${username}@${this.PROXY_DOMAIN}" || full_name="${username}"`
                );
            } catch (e) {
                adminPb.authStore.clear();
                throw new Error('User not found. Please check your Student ID / Username.');
            }

            // 2. Get the profile to send message properly
            const profile = await adminPb.collection('profiles').getFirstListItem(`user="${userRecord.id}"`);

            // 3. Generate 6-digit code
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();

            // 4. Find the admin for this school version
            const schoolVersion = profile.school_version;
            const admins = await adminPb.collection('profiles').getFullList({
                filter: `role="admin" && school_version="${schoolVersion}"`
            });

            if (admins.length === 0) {
                const globalAdmins = await adminPb.collection('profiles').getFullList({
                    filter: 'role="admin"',
                    perPage: 1
                });
                if (globalAdmins.length > 0) admins.push(globalAdmins[0]);
            }

            // 5. Send message(s) to admin(s)
            // Note: We use the adminPb to bypass authentication for sending the "System" message
            for (const admin of admins) {
                await adminPb.collection('messages').create({
                    from_id: userRecord.id,
                    to_id: admin.user || admin.id,
                    message: `🗝️ PASSWORD RESET REQUEST\nUser: ${username}\nReset Code: ${resetCode}\nSchool: ${schoolVersion}`,
                    school_version: schoolVersion,
                    read: false
                });
            }

            // 6. Store code locally for verification
            const resetInfo = {
                username: username,
                code: resetCode,
                expires: Date.now() + (30 * 60 * 1000)
            };
            localStorage.setItem(`cbt_reset_${username}`, JSON.stringify(resetInfo));

            adminPb.authStore.clear();
            return { success: true, schoolVersion };
        } catch (error) {
            console.error('Request reset error:', error);
            throw error;
        }
    }

    /**
     * Step 2: Verify code and update password
     */
    async verifyAndResetPassword(username, enteredCode, newPassword) {
        try {
            const stored = localStorage.getItem(`cbt_reset_${username}`);
            if (!stored) throw new Error('No active reset request found.');

            const resetInfo = JSON.parse(stored);
            if (Date.now() > resetInfo.expires) throw new Error('Reset code has expired.');
            if (resetInfo.code !== enteredCode) throw new Error('Invalid reset code.');

            // Perform update using system admin
            const ADMIN_EMAIL = "corneliusajayi123@gmail.com";
            const ADMIN_PASS = "Finest1709";

            const adminPb = new PocketBase(this.pb.baseUrl);
            await adminPb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASS);

            // Find the user record ID safely
            const user = await adminPb.collection('users').getFirstListItem(
                `username="${username}" || email="${username}@${this.PROXY_DOMAIN}" || full_name="${username}"`
            );

            // Update the password
            await adminPb.collection('users').update(user.id, {
                password: newPassword,
                passwordConfirm: newPassword
            });


            localStorage.removeItem(`cbt_reset_${username}`);
            adminPb.authStore.clear();
            return true;
        } catch (error) {
            console.error('Verify reset error:', error);
            throw error;
        }
    }
}


// Global instance
window.dataService = new DataService();

/**
 * Helper to update local IndexedDB cache based on actions
 * This ensures the dashboard doesn't need to refetch data
 */
DataService.prototype._updateLocalCache = async function (type, action, item) {
    try {
        const db = await this.getDB();
        const tx = db.transaction('store', 'readwrite');
        const store = tx.objectStore('store');

        // Find all cached items that might need updating
        const request = store.openCursor();

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                const { cacheKey, data: rawData } = cursor.value;

                // Only handle list-type caches for now
                if (cacheKey.includes('?')) {
                    const isWrapped = rawData && rawData.data;
                    let data = isWrapped ? rawData.data : rawData;

                    if (!Array.isArray(data)) {
                        cursor.continue();
                        return;
                    }

                    let shouldUpdate = false;

                    if (type === 'exam') {
                        if (action === 'update' || action === 'create') {
                            const index = data.findIndex(e => e.id === item.id);
                            if (index !== -1) {
                                data[index] = { ...data[index], ...item };
                                shouldUpdate = true;
                            } else if (action === 'create') {
                                data.unshift(item);
                                shouldUpdate = true;
                            }
                        } else if (action === 'delete') {
                            const index = data.findIndex(e => e.id === item);
                            if (index !== -1) {
                                data.splice(index, 1);
                                shouldUpdate = true;
                            }
                        }
                    } else if (type === 'result') {
                        if (action === 'create' || action === 'update') {
                            const index = data.findIndex(e => e.id === item.id);
                            if (index !== -1) {
                                data[index] = { ...data[index], ...item };
                                shouldUpdate = true;
                            } else {
                                // Add if matches but wasn't in list (e.g. status changed to completed)
                                data.unshift(item);
                                shouldUpdate = true;
                            }
                        }
                    }

                    if (shouldUpdate) {
                        // Re-wrap if needed
                        let finalData = isWrapped ? { ...rawData, data: data } : data;

                        cursor.update({
                            cacheKey: cacheKey,
                            data: finalData,
                            cachedAt: Date.now()
                        });
                        console.log(`✅ Cache updated for ${cacheKey}`);
                    }
                }

                cursor.continue();
            }
        };
    } catch (err) {
        console.warn('Failed to update local cache:', err);
    }
};
