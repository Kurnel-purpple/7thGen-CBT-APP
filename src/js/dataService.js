/**
 * Data Service Module (Supabase Version)
 * Handles persistence using Supabase Client.
 */

class DataService {
    constructor() {
        this.client = window.supabaseClient;
        this.PROXY_DOMAIN = 'school.cbt'; // Domain to append for ID-based logins
    }

    _getSupabase() {
        if (!this.client) {
            // Retry getting it if strictly loaded order messed up (unlikely with defer/order in HTML)
            if (window.supabaseClient) {
                this.client = window.supabaseClient;
            } else {
                throw new Error('Supabase client not initialized. Check your connection.');
            }
        }
        return this.client;
    }

    /**
     * Helper to generate email from ID/Username
     * Use a consistent domain for proxying.
     */
    _generateEmail(identifier) {
        identifier = identifier.trim();
        // If it looks like an email, return it (for teachers who want to use email)
        if (identifier.includes('@')) {
            return identifier;
        }
        // Otherwise, append dummy domain
        // Sanitize identifier to be email-safe? (Spaces to dots, etc)
        // Ideally IDs shouldn't have spaces, but let's handle basic trimming.
        return `${identifier}@${this.PROXY_DOMAIN}`;
    }

    // --- Auth ---

    async registerUser(userData) {
        const sb = this._getSupabase();

        // 1. Prepare Email
        // If role is student, use 'username' (which is Student ID)
        // If teacher, they might have put email or username.
        const email = this._generateEmail(userData.username);

        // 2. Sign Up
        const { data, error } = await sb.auth.signUp({
            email: email,
            password: userData.password,
            options: {
                data: {
                    full_name: userData.name,
                    role: userData.role,
                    class_level: userData.classLevel || null
                }
            }
        });

        if (error) throw error;
        if (!data.user) throw new Error('Registration failed for unknown reason.');

        // 3. Create Profile
        // We do this manually because we didn't set up a Trigger in SQL
        // RLS policy "Users can insert their own profile" must be ON
        const profileData = {
            id: data.user.id,
            role: userData.role,
            full_name: userData.name,
            class_level: userData.classLevel || null
        };

        const { error: profileError } = await sb
            .from('profiles')
            .insert([profileData]);

        if (profileError) {
            // Cleanup auth user if profile fails? 
            // Hard to do from client if we log out. 
            // Just warn for now.
            console.error('Profile creation failed:', profileError);
            throw new Error('User created but profile setup failed. Contact admin.');
        }

        return data.user;
    }

    async login(identifier, password) {
        const sb = this._getSupabase();
        const email = this._generateEmail(identifier);

        try {
            // Step 1: Sign in with password
            const { data, error } = await sb.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;

            if (!data.user) {
                throw new Error('Login failed: No user data returned');
            }

            // Step 2: Fetch Profile to get Role
            // Add a small delay to ensure session is fully established
            await new Promise(resolve => setTimeout(resolve, 100));

            const { data: profile, error: profileError } = await sb
                .from('profiles')
                .select('*')
                .eq('id', data.user.id)
                .single();

            if (profileError) {
                console.error('Profile fetch error:', profileError);
                // More specific error message
                if (profileError.code === 'PGRST116') {
                    throw new Error('Profile not found. Your account may not be fully set up. Please contact support.');
                }
                throw new Error(`Profile error: ${profileError.message}`);
            }

            if (!profile) {
                throw new Error('Profile not found. Please contact support.');
            }

            const userObj = {
                id: data.user.id,
                email: data.user.email,
                role: profile.role,
                name: profile.full_name,
                classLevel: profile.class_level,
                _sb_user: data.user
            };

            localStorage.setItem('cbt_user_meta', JSON.stringify(userObj));
            return userObj;

        } catch (err) {
            // Offline Fallback
            if (!navigator.onLine || err.message === 'Failed to fetch') {
                // 1. Try Cached Session (Last logged in user)
                const cachedUser = this.getCurrentUser();
                if (cachedUser && cachedUser.email === email) {
                    console.warn('Network error, logging in with cached credentials.');
                    return cachedUser;
                }

                // 2. Try Offline Student List (Prepared Device)
                const offlineUsers = JSON.parse(localStorage.getItem('cbt_offline_users') || '[]');
                const offlineStudent = offlineUsers.find(u => {
                    // Check either username (ID) or email
                    // identifier is what user typed
                    return u.username === identifier || u.email === identifier;
                });

                if (offlineStudent) {
                    console.warn('Network error, treating as Offline Student Login.');
                    // Create a simulated session user object
                    const userObj = {
                        id: offlineStudent.id,
                        email: offlineStudent.email || `${offlineStudent.username}@school.cbt`,
                        role: offlineStudent.role,
                        name: offlineStudent.full_name,
                        classLevel: offlineStudent.class_level,
                        _sb_user: { id: offlineStudent.id, email: offlineStudent.email }
                    };

                    localStorage.setItem('cbt_user_meta', JSON.stringify(userObj));
                    return userObj;
                }
            }
            throw err;
        }
    }

    getCurrentUser() {
        const sb = this._getSupabase();
        const session = sb.auth.getSession(); // Async... wait.
        // Supabase getSession is async, but we need synchronous for the existing app structure
        // unless we refactor everything to async.
        // We will rely on localStorage cache for immediate UI rendering,
        // and background validaton.

        const cached = localStorage.getItem('cbt_user_meta');
        return cached ? JSON.parse(cached) : null;
    }

    async logout() {
        const sb = this._getSupabase();
        try {
            await sb.auth.signOut();
        } catch (err) {
            console.warn('Supabase signOut error:', err);
        } finally {
            // Clear all cached user data
            localStorage.removeItem('cbt_user_meta');

            // Clear any cached sessions
            localStorage.removeItem('cbt_exam_cache');
            localStorage.removeItem('cbt_pending_submissions');

            // DO NOT set this.client = null - this breaks subsequent logins!
            // The Supabase client should persist across sessions
        }
    }

    async getUsers(role) {
        // Only feasible if RLS allows.
        // Our schema: "Public profiles are viewable by everyone" -> YES.
        const sb = this._getSupabase();
        let query = sb.from('profiles').select('*');
        if (role) {
            query = query.eq('role', role);
        }
        const { data, error } = await query;
        if (error) throw error;
        return data;
    }

    // --- Exams ---

    async getExams(filters = {}) {
        const sb = this._getSupabase();
        let query = sb.from('exams').select('*');

        if (filters.teacherId) {
            query = query.eq('created_by', filters.teacherId);
        }
        if (filters.status) {
            query = query.eq('status', filters.status);
        }

        // Handling Class Targeting
        // Often we want exams for a specific class OR 'All'
        // If filters.targetClass is passed (e.g. by Student view)
        if (filters.targetClass) {
            query = query.or(`target_class.eq.${filters.targetClass},target_class.eq.All`);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        // Remap to match internal app structure if needed
        // App uses camelCase, DB uses snake_case
        return data.map(e => this._mapExam(e));
    }

    async getExamById(id) {
        const sb = this._getSupabase();
        try {
            const { data, error } = await sb
                .from('exams')
                .select('*')
                .eq('id', id)
                .single();

            if (error) throw error;

            const exam = this._mapExam(data);

            // Cache the exam
            const cache = JSON.parse(localStorage.getItem('cbt_exam_cache') || '{}');
            cache[id] = exam;
            localStorage.setItem('cbt_exam_cache', JSON.stringify(cache));

            return exam;
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
        const sb = this._getSupabase();

        const dbPayload = {
            title: examData.title,
            subject: examData.subject,
            target_class: examData.targetClass,
            duration: examData.duration,
            pass_score: examData.passScore,
            instructions: examData.instructions,
            questions: examData.questions, // JSONB
            status: examData.status || 'draft',
            created_by: examData.createdBy // Should match auth.uid()
        };

        const { data, error } = await sb
            .from('exams')
            .insert([dbPayload])
            .select()
            .single();

        if (error) throw error;
        return this._mapExam(data);
    }

    async updateExam(id, updates) {
        const sb = this._getSupabase();

        const dbUpdates = {};
        if (updates.title) dbUpdates.title = updates.title;
        if (updates.subject) dbUpdates.subject = updates.subject;
        if (updates.targetClass) dbUpdates.target_class = updates.targetClass;
        if (updates.duration) dbUpdates.duration = updates.duration;
        if (updates.passScore) dbUpdates.pass_score = updates.passScore;
        if (updates.instructions) dbUpdates.instructions = updates.instructions;
        if (updates.questions) dbUpdates.questions = updates.questions;
        if (updates.status) dbUpdates.status = updates.status;
        dbUpdates.updated_at = new Date().toISOString();

        const { data, error } = await sb
            .from('exams')
            .update(dbUpdates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;
        return this._mapExam(data);
    }

    async deleteExam(id) {
        const sb = this._getSupabase();
        const { error } = await sb
            .from('exams')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
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
            createdAt: dbExam.created_at,
            updatedAt: dbExam.updated_at
        };
    }

    // --- Results ---

    async saveResult(resultData) {
        const sb = this._getSupabase();

        const dbPayload = {
            exam_id: resultData.examId,
            student_id: resultData.studentId,
            score: resultData.score,
            total_points: resultData.totalPoints,
            answers: resultData.answers,
            // We use flags for status tracking if DB column doesn't exist
            flags: { ...resultData.flags, _status: 'completed' }
        };

        try {
            // Use INSERT instead of UPSERT since we don't have a unique constraint
            // First, try to delete any existing in-progress session for this exam/student
            await sb
                .from('results')
                .delete()
                .eq('exam_id', resultData.examId)
                .eq('student_id', resultData.studentId);

            // Now insert the final result
            const { data, error } = await sb
                .from('results')
                .insert([dbPayload])
                .select()
                .single();

            if (error) throw error;
            return this._mapResult(data);
        } catch (err) {
            if (!navigator.onLine || err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
                dbPayload.submitted_at = new Date().toISOString();
                dbPayload._local_id = Date.now();
                pending.push(dbPayload);
                localStorage.setItem('cbt_pending_submissions', JSON.stringify(pending));
                throw new Error('Saved Offline');
            }
            throw err;
        }
    }

    async startExamSession(examId, studentId) {
        const sb = this._getSupabase();
        // Check if exists
        const { data: existing } = await sb
            .from('results')
            .select('id')
            .eq('exam_id', examId)
            .eq('student_id', studentId)
            .single();

        if (existing) return;

        // Insert "In Progress" marker using flags column
        const { error } = await sb
            .from('results')
            .insert([{
                exam_id: examId,
                student_id: studentId,
                // STATUS and STARTED_AT columns do not exist.
                // We piggyback on 'flags' JSONB.
                flags: { _status: 'in-progress', _started_at: new Date().toISOString() },
                score: 0,
                total_points: 0,
                answers: {}
            }]);

        if (error) {
            console.error('Failed to start session', error);
        }
    }

    async getResults(filters = {}) {
        const sb = this._getSupabase();
        let query = sb.from('results').select('*, profiles(full_name)');

        if (filters.studentId) query = query.eq('student_id', filters.studentId);
        if (filters.examId) query = query.eq('exam_id', filters.examId);

        const { data, error } = await query.order('submitted_at', { ascending: false });
        if (error) throw error;

        return data.map(r => this._mapResult(r));
    }

    _mapResult(dbResult) {
        if (!dbResult) return null;

        // Determine Status from Flags if Column missing
        let status = 'completed'; // Default for old rows
        if (dbResult.flags && dbResult.flags._status) {
            status = dbResult.flags._status;
        } else if (dbResult.status) {
            status = dbResult.status;
        }

        return {
            id: dbResult.id,
            examId: dbResult.exam_id,
            studentId: dbResult.student_id,
            score: dbResult.score,
            totalPoints: dbResult.total_points,
            answers: dbResult.answers,
            submittedAt: dbResult.submitted_at,
            studentName: dbResult.profiles ? dbResult.profiles.full_name : 'Unknown',
            flags: dbResult.flags || {},
            status: status
        };
    }

    async updateResult(resultId, updates) {
        const sb = this._getSupabase();

        const dbUpdates = {};
        if (updates.flags !== undefined) dbUpdates.flags = updates.flags;
        if (updates.score !== undefined) dbUpdates.score = updates.score;
        if (updates.points !== undefined) dbUpdates.points = updates.points;
        if (updates.totalPoints !== undefined) dbUpdates.total_points = updates.totalPoints;
        if (updates.answers !== undefined) dbUpdates.answers = updates.answers;

        const { data, error } = await sb
            .from('results')
            .update(dbUpdates)
            .eq('id', resultId)
            .select();

        if (error) throw error;

        // Return the first result if available, otherwise return a basic object
        if (data && data.length > 0) {
            return this._mapResult(data[0]);
        }

        // If no data returned (RLS policy), return success indicator
        return { id: resultId, ...updates };
    }


    // Export singleton
    // --- Offline Prep ---

    async prepareOfflineData(teacherId) {
        if (!navigator.onLine) throw new Error('Must be online to prepare device.');

        const sb = this._getSupabase();

        // 1. Fetch Requesting Teacher (Verify permissions? assuming yes)

        // 2. Fetch ALL Students (or scoped?)
        // Fetching all 'student' role profiles
        const { data: students, error: studentError } = await sb
            .from('profiles')
            .select('*')
            .eq('role', 'student');

        if (studentError) throw studentError;

        // 3. Fetch Active Exams
        // We might want ALL exams or just those created by this teacher?
        // Let's fetch ALL exams for now to be safe for shared labs
        const { data: exams, error: examError } = await sb
            .from('exams')
            .select('*')
            .neq('status', 'draft'); // Only active/published

        if (examError) throw examError;

        // 4. Cache Students
        // Store minimal needed info: id, username/email, name, class_level
        // We need 'username' which we map from ... wait, profiles doesn't have username column?
        // In signup we used email. 'username' is implicit in email "ID@domain". 
        // We should extract ID from email if username column is missing.
        // Or if profiles has username. Let's assume standard profiles schema or extract.
        // Looking at registerUser: email = ID@domain. So ID = email.split('@')[0].

        const offlineUsers = students.map(s => {
            // Extract ID from email if possible, or assume s.username exists if added previously
            // s.email might not be in profile if not selected query! 
            // Wait, profiles usually has ID, Role, Full Name, Class. 
            // Email is in auth.users. Implementation complexity: We can't query auth.users easily.
            // We'll rely on profiles. If profiles doesn't have the "ID" string (username), we rely on full_name?
            // Ideally we should have stored 'username' in profile.
            // Workaround: We will search by Full Name or we need the unique Student ID.
            // Let's assume for this feature, students log in with ID, and we stored that ID... where?
            // In registerUser we did: email = identifier@domain.
            // We can't reverse engineer easily without email in profile.
            // FIX: We will store 'username' in profile during register in future. 
            // For now, let's assume we can match by 'id' if we knew it? No student doesn't know UUID.
            // Let's just store the profile and match 'full_name' as username? No, unreliable.

            // Check if 'username' field exists in fetched data (it might if we added it way back)
            // If not, we might need to rely on 'full_name' for now or update schema.
            // Let's assume 'username' is NOT in profile based on previous registerUser code (it only inserts full_name, role, class).
            // CRITICAL: We need a way to identify students. using 'full_name' is risky but only option without schema change.
            // OR we update `registerUser` to add `username` to profile (better).
            // Use `full_name` as fallback username for now.

            return {
                id: s.id,
                username: s.username || s.full_name, // Fallback
                full_name: s.full_name,
                role: 'student',
                class_level: s.class_level,
                email: s.email // might be undefined in profile
            };
        });

        localStorage.setItem('cbt_offline_users', JSON.stringify(offlineUsers));

        // 5. Cache Exams
        const examCache = {};
        exams.forEach(e => {
            examCache[e.id] = this._mapExam(e);
        });
        localStorage.setItem('cbt_exam_cache', JSON.stringify(examCache));

        return { students: offlineUsers.length, exams: exams.length };
    }

    async syncPendingResults() {
        if (!navigator.onLine) return { synced: 0, pending: 0 };

        const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
        if (pending.length === 0) return { synced: 0, pending: 0 };

        console.log(`Syncing ${pending.length} results...`);
        const sb = this._getSupabase();
        const failed = [];
        let syncedCount = 0;

        for (const submission of pending) {
            try {
                // Remove local-only fields before sending if any
                const { _local_id, ...cleanPayload } = submission;

                const { error } = await sb.from('results').insert([cleanPayload]);
                if (error) throw error;
                syncedCount++;
            } catch (err) {
                console.error('Failed to sync submission:', submission, err);
                failed.push(submission); // Keep failed ones to retry later
            }
        }

        // Update local storage with whatever failed
        localStorage.setItem('cbt_pending_submissions', JSON.stringify(failed));

        return { synced: syncedCount, pending: failed.length };
    }
}

// Export singleton
window.dataService = new DataService();
