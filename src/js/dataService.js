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
            // Parse PocketBase validation errors into user-friendly messages
            const msg = (error.message || '').toLowerCase();
            const data = error.data || error.response?.data || {};

            // Check for specific field errors from PocketBase
            if (data.email?.code === 'validation_not_unique' || msg.includes('already exists') || msg.includes('not unique')) {
                throw new Error('This username is already taken. Please choose a different one.');
            } else if (data.password?.code === 'validation_length_out_of_range' || msg.includes('password')) {
                throw new Error('Password must be at least 8 characters long.');
            } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')) {
                throw new Error('Unable to connect to the server. Please check your internet connection and try again.');
            } else if (msg.includes('validation')) {
                throw new Error('Please check your details and try again. Make sure all fields are filled correctly.');
            } else {
                throw new Error(error.message || 'Registration failed. Please try again.');
            }
        }
    }

    async login(identifier, password) {
        const email = this._generateEmail(identifier);

        try {
            // Try authenticating with the raw identifier first (matches PocketBase username field)
            // Then fall back to email format for legacy accounts
            let authData;
            try {
                authData = await this.pb.collection('users').authWithPassword(identifier.trim(), password);
            } catch (firstErr) {
                try {
                    // If raw username failed, try as email format
                    authData = await this.pb.collection('users').authWithPassword(email, password);
                } catch (secondErr) {
                    // Both attempts failed — provide a helpful error message
                    const errMsg = (firstErr.message || secondErr.message || '').toLowerCase();
                    if (errMsg.includes('failed to authenticate') || errMsg.includes('invalid') || errMsg.includes('credentials')) {
                        throw new Error('Incorrect username or password. Please double-check your credentials and try again.');
                    } else if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('timeout')) {
                        throw new Error('Unable to connect to the server. Please check your internet connection and try again.');
                    } else {
                        throw new Error(secondErr.message || 'Login failed. Please try again.');
                    }
                }
            }

            if (!authData.record) {
                throw new Error('Login failed: No user data returned. Please try again.');
            }

            // Auth state is auto-saved by the onChange listener in constructor

            // Get user profile — create one if missing so admin portal can find this user
            let profile = null;
            try {
                profile = await this.pb.collection('profiles').getFirstListItem(`user="${authData.record.id}"`);

                // Sync school_version and class_level from users record if profile is missing them
                const syncFields = {};
                if (!profile.school_version && authData.record.school_version) {
                    syncFields.school_version = authData.record.school_version;
                }
                if (!profile.class_level && authData.record.class_level) {
                    syncFields.class_level = authData.record.class_level;
                }
                if (Object.keys(syncFields).length > 0) {
                    try {
                        await this.pb.collection('profiles').update(profile.id, syncFields);
                        Object.assign(profile, syncFields);
                        console.log('Synced fields to existing profile:', Object.keys(syncFields));
                    } catch (syncErr) {
                        console.warn('Failed to sync fields to profile:', syncErr.message);
                    }
                }
            } catch (profileErr) {
                // Profile doesn't exist — create it from user data
                console.warn('Profile not found, creating one:', profileErr.message);
                const profileData = {
                    user: authData.record.id,
                    role: authData.record.role || 'student',
                    full_name: authData.record.full_name,
                    class_level: authData.record.class_level || null,
                    school_version: authData.record.school_version || null
                };
                try {
                    profile = await this.pb.collection('profiles').create({ ...profileData, id: authData.record.id });
                    console.log('Created profile with fixed ID');
                } catch (createErr) {
                    try {
                        profile = await this.pb.collection('profiles').create(profileData);
                        console.log('Created profile with auto ID');
                    } catch (createErr2) {
                        console.warn('Profile creation failed:', createErr2.message);
                        // Fall back to local-only profile
                        profile = profileData;
                    }
                }
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
                throw new Error('You are not logged in. Please log in and try again.');
            }
            await this.pb.collection('users').update(this.pb.authStore.model.id, {
                oldPassword: oldPassword,
                password: newPassword,
                passwordConfirm: newPassword,
            });
            return true;
        } catch (error) {
            const msg = (error.message || '').toLowerCase();
            if (msg.includes('oldpassword') || msg.includes('old password') || msg.includes('must be')) {
                throw new Error('Your current password is incorrect. Please try again.');
            } else if (msg.includes('length') || msg.includes('too short')) {
                throw new Error('New password is too short. It must be at least 8 characters.');
            } else if (msg.includes('fetch') || msg.includes('network')) {
                throw new Error('Unable to connect to the server. Please check your internet connection.');
            } else {
                throw new Error(error.message || 'Failed to update password. Please try again.');
            }
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

            // 0. Get current state
            const cached = this.getCurrentUser();
            const userId = this.pb.authStore.model.id;
            const oldUsername = this.pb.authStore.model.username || cached?.username;

            // 1. Normalize input
            let normalizedUsername = newUsername.trim();
            if (normalizedUsername.includes('@')) {
                normalizedUsername = normalizedUsername.split('@')[0];
            }

            // Validate normalized username
            if (!normalizedUsername || normalizedUsername.length < 3) {
                throw new Error('Username must be at least 3 characters');
            }

            if (!/^[a-zA-Z0-9._-]+$/.test(normalizedUsername)) {
                throw new Error('Username can only contain letters, numbers, dots, underscores, and hyphens');
            }

            // 2. Skip if no changes
            if (normalizedUsername === oldUsername) {
                console.log('Username unchanged, skipping API call');
                return { username: oldUsername };
            }

            // 3. Pre-check: Verify the new username isn't taken by ANOTHER user
            try {
                const existingUser = await this.pb.collection('users').getFirstListItem(
                    `username="${normalizedUsername}" && id!="${userId}"`
                );
                if (existingUser) {
                    throw new Error(`The username "${normalizedUsername}" is already taken by another account.`);
                }
            } catch (checkErr) {
                // 404 = no conflict found, that's good - proceed
                if (checkErr.status !== 404 && checkErr.message.includes('already taken')) {
                    throw checkErr;
                }
            }

            // 4. Update ONLY the username field (not email)
            // This avoids PocketBase's oldPassword requirement for email changes.
            // Login will still work because PocketBase's authWithPassword matches
            // against both username and email fields.
            const updatedUser = await this.pb.collection('users').update(userId, {
                username: normalizedUsername
            });

            // 5. Sync Profile record
            try {
                const profileData = {
                    full_name: updatedUser.full_name || cached?.name || normalizedUsername,
                    role: updatedUser.role || cached?.role || 'teacher'
                };

                try {
                    await this.pb.collection('profiles').update(userId, profileData);
                } catch (e) {
                    try {
                        const profile = await this.pb.collection('profiles').getFirstListItem(`user="${userId}"`);
                        await this.pb.collection('profiles').update(profile.id, profileData);
                    } catch (findErr) {
                        await this.pb.collection('profiles').create({
                            ...profileData,
                            user: userId,
                            id: userId
                        });
                    }
                }
            } catch (profileErr) {
                console.warn('Profile sync during username change failed:', profileErr.message);
            }

            // 6. Migrate Legacy Exams (Data Healing)
            if (oldUsername) {
                try {
                    const legacyExams = await this.pb.collection('exams').getFullList({
                        filter: `created_by="${oldUsername}"`
                    });

                    for (const exam of legacyExams) {
                        await this.pb.collection('exams').update(exam.id, {
                            created_by: userId
                        });
                        console.log(`Migrated exam ${exam.id} to new stable ID`);
                    }
                } catch (migrationErr) {
                    console.error('Exam migration failed:', migrationErr);
                }
            }

            // 7. Update local metadata cache
            if (cached) {
                cached.username = updatedUser.username;
                localStorage.setItem('cbt_user_meta', JSON.stringify(cached));
            }

            return updatedUser;
        } catch (error) {
            console.error('Username update failed:', error);

            if (error.status === 400 && error.data?.data?.username) {
                throw new Error(`The username "${newUsername}" is already taken. Please choose a different one.`);
            }

            const msg = (error.message || '').toLowerCase();
            if (msg.includes('fetch') || msg.includes('network')) {
                throw new Error('Unable to connect to the server. Please check your internet connection.');
            }
            throw new Error(error.message || 'Failed to update username. Please try again.');
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

                // Try updating directly using userId as ID first (common pattern in this app)
                try {
                    await this.pb.collection('profiles').update(userId, profileData);
                    console.log('Updated profile by direct ID');
                } catch (updateErr) {
                    // If direct ID update fails, search for the profile by user field
                    try {
                        const profile = await this.pb.collection('profiles').getFirstListItem(`user="${userId}"`);
                        await this.pb.collection('profiles').update(profile.id, profileData);
                        console.log('Updated profile by search');
                    } catch (findErr) {
                        // Profile truly doesn't exist, CREATE it
                        if (!profileData.role) profileData.role = updatedUser.role || 'teacher';
                        if (!profileData.full_name) profileData.full_name = updatedUser.full_name;

                        try {
                            // Try creating with userId as the record ID to ensure 1:1 uniqueness
                            await this.pb.collection('profiles').create({ ...profileData, id: userId });
                            console.log('Created profile with fixed ID');
                        } catch (createErr) {
                            // Fallback to auto-generated ID if the above fails (e.g. ID format mismatch)
                            await this.pb.collection('profiles').create(profileData);
                            console.log('Created profile with auto ID');
                        }
                    }
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
            const msg = (error.message || '').toLowerCase();
            if (msg.includes('not authenticated') || msg.includes('not valid')) {
                throw new Error('Your session has expired. Please log in again.');
            } else if (msg.includes('fetch') || msg.includes('network')) {
                throw new Error('Unable to connect to the server. Please check your internet connection.');
            }
            throw new Error(error.message || 'Failed to update profile. Please try again.');
        }
    }



    async getUsers(filters = {}) {
        const { forceRefresh, ...cacheFilters } = filters;
        const cacheKey = `users_${JSON.stringify(cacheFilters)}`;

        // Try IDB cache first
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
            if (cacheFilters.role) {
                filterString = `role="${cacheFilters.role}"`;
            }
            if (cacheFilters.schoolVersion) {
                if (filterString) filterString += ' && ';
                filterString += `school_version="${cacheFilters.schoolVersion}"`;
            }

            const users = await this.pb.collection('profiles').getFullList({
                filter: filterString,
                sort: '-created'
            });

            // Deduplicate by User ID to ensure each physical user is only counted once
            const uniqueUsers = [];
            const seenUserIds = new Set();

            for (const user of users) {
                const userId = user.user || user.id;
                if (!seenUserIds.has(userId)) {
                    uniqueUsers.push(user);
                    seenUserIds.add(userId);
                }
            }

            // Cache the result
            if (window.idb) {
                try { await window.idb.saveDashboardCache(cacheKey, uniqueUsers); } catch (e) { }
            }

            return uniqueUsers;
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

            // Always exclude soft-deleted exams (those with _deleted flag in extensions)
            if (!filters.includeDeleted) {
                if (filterString) filterString += ' && ';
                filterString += 'extensions._deleted!=true';
            }

            if (filters.teacherId) {
                if (filterString) filterString += ' && ';

                // For better compatibility with migrated data:
                // Search by User ID (preferred), or try to match current username/email
                // as some legacy records might use them instead of the UUID.
                let teacherFilter = `created_by="${filters.teacherId}"`;

                const currentUser = this.getCurrentUser();
                if (currentUser && currentUser.id === filters.teacherId) {
                    teacherFilter = `(created_by="${filters.teacherId}" || created_by="${currentUser.username}" || created_by="${currentUser.email}")`;
                }

                filterString += teacherFilter;
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

            // 2. Save to IDB (only if we got data — never overwrite good cache with empty)
            if (window.idb && mappedData.length > 0) {
                await window.idb.saveDashboardCache(cacheKey, mappedData);
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
            console.error('createExam error:', error, 'data:', error.data);
            const parsed = this._parseExamError(error);
            if (parsed) {
                throw new Error(parsed);
            }
            throw new Error('Unable to save the exam. Please check all fields are filled in correctly and try again.');
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
            console.error('updateExam error:', error, 'data:', error.data);
            const parsed = this._parseExamError(error);
            if (parsed) {
                throw new Error(parsed);
            }
            throw new Error('Unable to update the exam. Please check all fields are filled in correctly and try again.');
        }
    }

    async deleteExam(id) {
        try {
            // Soft-delete: Mark exam as archived with _deleted flag in extensions.
            // We use 'archived' status (a valid PocketBase select value) and store
            // _deleted: true in extensions JSON field to distinguish from manual archival.
            // This preserves all student results for admin reporting and cumulative records.
            const existing = await this.pb.collection('exams').getOne(id);
            const extensions = existing.extensions || {};
            extensions._deleted = true;
            extensions._deletedAt = new Date().toISOString();

            await this.pb.collection('exams').update(id, {
                status: 'archived',
                extensions: extensions
            });

            // Remove from teacher's dashboard cache
            if (window.idb) {
                await window.idb.deleteExam(id);
                await this._updateDashboardCacheList({ id, createdBy: this.getCurrentUser()?.id }, 'delete');
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

    _parseExamError(error) {
        const msg = (error.message || '').toLowerCase();
        const fieldErrors = error.data?.data || error.response?.data?.data || {};
        const fieldLabels = {
            title: 'Exam Title',
            subject: 'Subject',
            target_class: 'Target Class',
            school_level: 'School Level',
            duration: 'Duration',
            pass_score: 'Passing Score',
            instructions: 'Instructions',
            questions: 'Questions',
            created_by: 'Creator',
            scheduled_date: 'Scheduled Date',
            status: 'Status'
        };

        // Check for field-level validation errors from PocketBase
        const missingFields = [];
        const invalidFields = [];
        for (const [field, err] of Object.entries(fieldErrors)) {
            const label = fieldLabels[field] || field;
            if (err.code === 'validation_required' || err.code === 'validation_not_blank') {
                missingFields.push(label);
            } else if (err.code) {
                invalidFields.push(label);
            }
        }

        if (missingFields.length > 0) {
            return `The following required fields are missing: ${missingFields.join(', ')}. Please fill them in and try again.`;
        }
        if (invalidFields.length > 0) {
            return `There's a problem with: ${invalidFields.join(', ')}. Please check these fields and try again.`;
        }

        // Network errors
        if (msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('failed to fetch')) {
            return 'NETWORK_ERROR';
        }
        // Auth errors
        if (msg.includes('not authenticated') || msg.includes('not valid') || msg.includes('token') || error.status === 401 || error.status === 403) {
            return 'AUTH_ERROR';
        }
        // Payload too large
        if (msg.includes('too large') || msg.includes('payload') || msg.includes('size') || error.status === 413) {
            return 'SIZE_ERROR';
        }

        // If PocketBase gave a message but no field details, use it
        if (error.data?.message && error.data.message !== error.message) {
            return error.data.message;
        }

        return null;
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

            // 2. Save to IDB (only if we got data — never overwrite good cache with empty)
            if (window.idb && mappedResults.length > 0) {
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

        // Get student name from expanded relation (check multiple possible fields)
        let studentName = 'Unknown';
        if (dbResult.expand && dbResult.expand.student_id) {
            const expanded = dbResult.expand.student_id;
            studentName = expanded.full_name || expanded.name || expanded.username || 'Unknown';
        }
        // Fallback: check if the flags contain student name (saved during submission)
        if (studentName === 'Unknown' && dbResult.flags && dbResult.flags._studentName) {
            studentName = dbResult.flags._studentName;
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
            status: status,
            theoryScores: (dbResult.flags && dbResult.flags._theoryScores) ? dbResult.flags._theoryScores : {}
        };
    }

    async updateResult(resultId, updates) {
        try {
            const data = {};
            if (updates.score !== undefined) data.score = updates.score;
            if (updates.totalPoints !== undefined) data.total_points = updates.totalPoints;
            if (updates.answers !== undefined) data.answers = updates.answers;
            if (updates.passScore !== undefined) data.pass_score = updates.passScore;
            if (updates.passed !== undefined) data.passed = updates.passed;

            // Handle theoryScores: store inside flags object
            if (updates.theoryScores !== undefined || updates.flags !== undefined) {
                // Fetch current flags to merge
                let currentFlags = {};
                try {
                    const existing = await this.pb.collection('results').getOne(resultId);
                    currentFlags = existing.flags || {};
                } catch (e) {
                    console.warn('Could not fetch current flags for merge:', e);
                }

                if (updates.flags !== undefined) {
                    currentFlags = { ...currentFlags, ...updates.flags };
                }
                if (updates.theoryScores !== undefined) {
                    currentFlags._theoryScores = updates.theoryScores;
                }
                data.flags = currentFlags;
            }

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

    // Delete a result record (used for granting retakes)
    async deleteResult(resultId) {
        try {
            await this.pb.collection('results').delete(resultId);
            return true;
        } catch (error) {
            console.error('Failed to delete result:', error);
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
        console.log('🔄 PASSWORD RESET: Starting for', username);
        try {
            const adminPb = new PocketBase(this.pb.baseUrl);
            const ADMIN_EMAIL = "corneliusajayi123@gmail.com";
            const ADMIN_PASS = "Finest1709";

            console.log('🔄 PASSWORD RESET: Authenticating admin...');
            await adminPb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASS);

            // 1. Find the user record
            console.log('🔄 PASSWORD RESET: Searching for user record...');
            let userRecord;
            try {
                userRecord = await adminPb.collection('users').getFirstListItem(
                    `username="${username}" || email="${username}@${this.PROXY_DOMAIN}" || full_name="${username}"`
                );
                console.log('✅ PASSWORD RESET: Found user', userRecord.id, userRecord.username);
            } catch (e) {
                console.error('❌ PASSWORD RESET: User search failed', e.message);
                adminPb.authStore.clear();
                throw new Error('User not found. Please check your Student ID / Username.');
            }

            // 2. Get the profile
            console.log('🔄 PASSWORD RESET: Fetching profile for user', userRecord.id);
            let profile;
            try {
                profile = await adminPb.collection('profiles').getFirstListItem(`user="${userRecord.id}"`);
                console.log('✅ PASSWORD RESET: Found profile', profile.id, 'School:', profile.school_version);
            } catch (e) {
                console.error('❌ PASSWORD RESET: Profile search failed', e.message);
                // We proceed anyway but school version might be missing
                profile = { school_version: '' };
            }

            // 3. Generate code
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();

            // 4. Find the admin(s)
            console.log('🔄 PASSWORD RESET: Locating administrators...');
            let admins = [];
            try {
                const schoolVersion = (profile.school_version || '').trim();
                if (schoolVersion) {
                    admins = await adminPb.collection('profiles').getFullList({
                        filter: `role="admin" && school_version="${schoolVersion}"`
                    });
                }

                if (admins.length === 0) {
                    console.log('⚠️ PASSWORD RESET: No direct school admin found, falling back to global...');
                    const globalAdmins = await adminPb.collection('profiles').getFullList({
                        filter: 'role="admin"',
                        perPage: 3
                    });
                    admins = globalAdmins;
                }
                console.log(`✅ PASSWORD RESET: Found ${admins.length} target admin(s)`);
            } catch (e) {
                console.warn('⚠️ PASSWORD RESET: Admin search error', e.message);
            }

            if (admins.length === 0) {
                throw new Error('No administrator found to receive the reset code.');
            }

            // 5. Send message(s)
            console.log('🔄 PASSWORD RESET: Creating notification messages...');
            for (const admin of admins) {
                try {
                    await adminPb.collection('messages').create({
                        from_id: userRecord.id,
                        to_id: admin.user || admin.id,
                        message: `🗝️ PASSWORD RESET REQUEST\nUser: ${username}\nReset Code: ${resetCode}\nSchool: ${profile.school_version || 'Unknown'}`,
                        school_version: profile.school_version || '',
                        read: false
                    });
                    console.log('✅ PASSWORD RESET: Message sent to admin', admin.id);
                } catch (msgErr) {
                    console.error('❌ PASSWORD RESET: Failed to send message to admin', admin.id, msgErr.message);
                }
            }

            // 6. Store locally
            const resetInfo = {
                username: username,
                code: resetCode,
                expires: Date.now() + (30 * 60 * 1000)
            };
            localStorage.setItem(`cbt_reset_${username}`, JSON.stringify(resetInfo));

            adminPb.authStore.clear();
            return { success: true };
        } catch (error) {
            console.error('❌ PASSWORD RESET: Final error', error);
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

    /**
     * Recover Username by full name + password verification
     * Looks up user by full_name, then verifies password by attempting auth.
     * Returns the username without maintaining the login session.
     */
    async recoverUsername(fullName, password) {
        console.log('🔄 USERNAME RECOVERY: Starting for', fullName);
        try {
            const adminPb = new PocketBase(this.pb.baseUrl);
            const ADMIN_EMAIL = "corneliusajayi123@gmail.com";
            const ADMIN_PASS = "Finest1709";

            console.log('🔄 USERNAME RECOVERY: Authenticating admin...');
            await adminPb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASS);

            // 1. Search for users by full_name (case-insensitive search)
            console.log('🔄 USERNAME RECOVERY: Searching for user by name...');
            let userRecord;
            try {
                // Try exact match first
                userRecord = await adminPb.collection('users').getFirstListItem(
                    `full_name="${fullName}"`
                );
            } catch (e) {
                // Try case-insensitive / partial match via profiles
                try {
                    const profile = await adminPb.collection('profiles').getFirstListItem(
                        `full_name~"${fullName}"`
                    );
                    if (profile && profile.user) {
                        userRecord = await adminPb.collection('users').getOne(profile.user);
                    }
                } catch (e2) {
                    adminPb.authStore.clear();
                    throw new Error('No account found with that name. Please check your full name and try again.');
                }
            }

            if (!userRecord) {
                adminPb.authStore.clear();
                throw new Error('No account found with that name. Please check your full name and try again.');
            }

            console.log('✅ USERNAME RECOVERY: Found user', userRecord.id, userRecord.username);

            // 2. Verify password by attempting authentication
            const verifyPb = new PocketBase(this.pb.baseUrl);
            try {
                // Try authenticating with the found user's email/username + provided password
                const authIdentifier = userRecord.email || userRecord.username;
                await verifyPb.collection('users').authWithPassword(authIdentifier, password);
                verifyPb.authStore.clear(); // Don't keep this session
            } catch (authErr) {
                // Also try with username directly
                try {
                    await verifyPb.collection('users').authWithPassword(userRecord.username, password);
                    verifyPb.authStore.clear();
                } catch (authErr2) {
                    adminPb.authStore.clear();
                    throw new Error('The password you entered does not match this account. Please check your password.');
                }
            }

            // 3. Password verified — return the username
            const recoveredUsername = userRecord.username || userRecord.email.split('@')[0];

            adminPb.authStore.clear();
            console.log('✅ USERNAME RECOVERY: Success! Username:', recoveredUsername);
            return { username: recoveredUsername };

        } catch (error) {
            console.error('❌ USERNAME RECOVERY: Error', error);
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
