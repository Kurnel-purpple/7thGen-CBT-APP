/**
 * ============================================
 * Supabase → PocketBase Migration Script
 * ============================================
 * 
 * Migrates ALL data from Supabase to PocketBase:
 *   - Users/Profiles
 *   - Exams  
 *   - Results
 *   - Messages
 * 
 * Usage (PowerShell):
 *   $env:PB_ADMIN_EMAIL = "your_admin_email"
 *   $env:PB_ADMIN_PASSWORD = "your_admin_password"
 *   node migrate-to-pocketbase.js
 */

// ============ CONFIGURATION ============
const SUPABASE_URL = 'https://gvxwuwtfqbxgzsjrdkpf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U2lIeDzAr6kMdqXpHolDtw_ndHOuVXV';
const PB_URL = 'https://gen7-cbt-app.fly.dev';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;

// Temporary password for migrated users (they should change after first login)
const TEMP_PASSWORD = 'Migrate2026!';

// ============ STATE ============
const userIdMap = new Map();   // Supabase UUID → PocketBase ID
const examIdMap = new Map();   // Supabase UUID → PocketBase ID
const stats = { users: 0, exams: 0, results: 0, messages: 0, skipped: 0, errors: [] };

// ============ SUPABASE HELPERS ============

async function fetchFromSupabase(table, extraParams = '') {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=10000${extraParams}`;
    try {
        const response = await fetch(url, {
            headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`   ⚠️  Failed to fetch "${table}": ${response.status} ${response.statusText}`);
            console.error(`   Response: ${errText.substring(0, 200)}`);
            return [];
        }

        const data = await response.json();
        return Array.isArray(data) ? data : [];
    } catch (err) {
        console.error(`   ⚠️  Network error fetching "${table}": ${err.message}`);
        return [];
    }
}

// ============ POCKETBASE HELPERS ============

async function loginPBAdmin() {
    const response = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            identity: PB_ADMIN_EMAIL,
            password: PB_ADMIN_PASSWORD
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`PocketBase admin auth failed: ${response.status} - ${err}`);
    }

    const data = await response.json();
    return data.token;
}

async function createInPB(token, collection, data) {
    const response = await fetch(`${PB_URL}/api/collections/${collection}/records`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': token
        },
        body: JSON.stringify(data)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(`Create in "${collection}" failed: ${JSON.stringify(err)}`);
    }

    return response.json();
}

async function fetchFromPB(token, collection, filter = '') {
    const params = filter ? `?filter=${encodeURIComponent(filter)}&perPage=500` : '?perPage=500';
    const response = await fetch(`${PB_URL}/api/collections/${collection}/records${params}`, {
        headers: { 'Authorization': token }
    });

    if (!response.ok) return { items: [] };
    const data = await response.json();
    return data;
}

// ============ MIGRATION FUNCTIONS ============

async function migrateUsers(token, profiles) {
    console.log('\n👥 STEP 1: Migrating Users/Profiles...');
    console.log('─'.repeat(50));

    // First, fetch existing PB users to avoid duplicates
    const existingPB = await fetchFromPB(token, 'users');
    const existingEmails = new Set(existingPB.items.map(u => u.email));

    // Also map existing PB users by email for ID mapping
    for (const pbUser of existingPB.items) {
        // Try to find matching Supabase user by email
        const matching = profiles.find(p => {
            const email = p.email || `${p.username || p.id}@school.cbt`;
            return email === pbUser.email;
        });
        if (matching) {
            userIdMap.set(matching.id || matching.user_id, pbUser.id);
            console.log(`   ↔️  Mapped existing: ${pbUser.email} → ${pbUser.id}`);
        }
    }

    for (const profile of profiles) {
        try {
            const email = profile.email || `${profile.username || profile.full_name || profile.id}@school.cbt`;

            // Skip if already exists
            if (existingEmails.has(email)) {
                console.log(`   ⏭️  Skipping (already exists): ${email}`);
                stats.skipped++;
                continue;
            }

            // Create user in PocketBase
            const pbUser = await createInPB(token, 'users', {
                email: email,
                password: TEMP_PASSWORD,
                passwordConfirm: TEMP_PASSWORD,
                role: profile.role || 'student',
                full_name: profile.full_name || profile.name || 'Unknown',
                class_level: profile.class_level || null,
                school_version: profile.school_version || null,
                emailVisibility: false
            });

            // Store ID mapping
            const supabaseId = profile.id || profile.user_id;
            userIdMap.set(supabaseId, pbUser.id);

            // Create profile record too
            try {
                await createInPB(token, 'profiles', {
                    role: profile.role || 'student',
                    full_name: profile.full_name || profile.name || 'Unknown',
                    class_level: profile.class_level || null,
                    school_version: profile.school_version || null,
                    user: pbUser.id
                });
            } catch (profileErr) {
                // Profile creation might fail if collection requires unique user, that's ok
            }

            console.log(`   ✅ ${email} (${profile.role || 'student'}) → PB ID: ${pbUser.id}`);
            stats.users++;

        } catch (err) {
            const errMsg = `User "${profile.full_name || profile.email || profile.id}": ${err.message}`;
            console.error(`   ❌ ${errMsg}`);
            stats.errors.push(errMsg);
        }
    }

    console.log(`\n   📊 Users migrated: ${stats.users}, Skipped: ${stats.skipped}`);
}

async function migrateExams(token, exams) {
    console.log('\n📝 STEP 2: Migrating Exams...');
    console.log('─'.repeat(50));

    for (const exam of exams) {
        try {
            // Map the created_by field to PocketBase user ID
            let createdBy = exam.created_by;
            if (createdBy && userIdMap.has(createdBy)) {
                createdBy = userIdMap.get(createdBy);
            } else if (createdBy) {
                console.warn(`   ⚠️  No PB user found for created_by: ${createdBy}`);
                // Try to use the first available teacher
                const teachers = await fetchFromPB(token, 'users', 'role="teacher"');
                if (teachers.items.length > 0) {
                    createdBy = teachers.items[0].id;
                    console.log(`   ↔️  Assigned to teacher: ${teachers.items[0].email}`);
                }
            }

            const pbExam = await createInPB(token, 'exams', {
                title: exam.title,
                subject: exam.subject,
                school_level: exam.school_level || null,
                target_class: exam.target_class,
                duration: exam.duration,
                pass_score: exam.pass_score,
                instructions: exam.instructions || '',
                theory_instructions: exam.theory_instructions || null,
                questions: exam.questions || [],
                status: exam.status || 'draft',
                created_by: createdBy,
                scheduled_date: exam.scheduled_date || null,
                scramble_questions: exam.scramble_questions || false,
                client_id: exam.client_id || `migrated_${exam.id}`,
                extensions: exam.extensions || {},
                global_extension: exam.global_extension || null
            });

            // Store ID mapping
            examIdMap.set(exam.id, pbExam.id);

            const qCount = Array.isArray(exam.questions) ? exam.questions.length : 0;
            console.log(`   ✅ "${exam.title}" (${qCount} questions, ${exam.status}) → PB ID: ${pbExam.id}`);
            stats.exams++;

        } catch (err) {
            const errMsg = `Exam "${exam.title || exam.id}": ${err.message}`;
            console.error(`   ❌ ${errMsg}`);
            stats.errors.push(errMsg);
        }
    }

    console.log(`\n   📊 Exams migrated: ${stats.exams}`);
}

async function migrateResults(token, results) {
    console.log('\n📊 STEP 3: Migrating Results...');
    console.log('─'.repeat(50));

    if (results.length === 0) {
        console.log('   No results to migrate.');
        return;
    }

    for (const result of results) {
        try {
            // Map IDs
            let examId = result.exam_id;
            let studentId = result.student_id;

            if (examId && examIdMap.has(examId)) {
                examId = examIdMap.get(examId);
            } else if (examId) {
                console.warn(`   ⚠️  No PB exam found for exam_id: ${examId}, skipping result`);
                stats.skipped++;
                continue;
            }

            if (studentId && userIdMap.has(studentId)) {
                studentId = userIdMap.get(studentId);
            } else if (studentId) {
                console.warn(`   ⚠️  No PB user found for student_id: ${studentId}, skipping result`);
                stats.skipped++;
                continue;
            }

            await createInPB(token, 'results', {
                exam_id: examId,
                student_id: studentId,
                score: result.score || 0,
                total_points: result.total_points || 0,
                answers: result.answers || {},
                flags: result.flags || {},
                submitted_at: result.submitted_at || result.created_at || new Date().toISOString()
            });

            console.log(`   ✅ Result: student=${studentId}, exam=${examId}, score=${result.score}`);
            stats.results++;

        } catch (err) {
            const errMsg = `Result (exam: ${result.exam_id}): ${err.message}`;
            console.error(`   ❌ ${errMsg}`);
            stats.errors.push(errMsg);
        }
    }

    console.log(`\n   📊 Results migrated: ${stats.results}`);
}

async function migrateMessages(token, messages) {
    console.log('\n💬 STEP 4: Migrating Messages...');
    console.log('─'.repeat(50));

    if (messages.length === 0) {
        console.log('   No messages to migrate.');
        return;
    }

    for (const msg of messages) {
        try {
            // Map IDs
            let fromId = msg.from_id;
            let toId = msg.to_id;

            if (fromId && userIdMap.has(fromId)) {
                fromId = userIdMap.get(fromId);
            }
            if (toId && userIdMap.has(toId)) {
                toId = userIdMap.get(toId);
            }

            if (!fromId || !toId) {
                console.warn(`   ⚠️  Skipping message (unmapped user IDs)`);
                stats.skipped++;
                continue;
            }

            await createInPB(token, 'messages', {
                from_id: fromId,
                to_id: toId,
                message: msg.message || msg.content || '',
                school_version: msg.school_version || null,
                read: msg.read || false
            });

            console.log(`   ✅ Message: ${fromId} → ${toId}`);
            stats.messages++;

        } catch (err) {
            const errMsg = `Message: ${err.message}`;
            console.error(`   ❌ ${errMsg}`);
            stats.errors.push(errMsg);
        }
    }

    console.log(`\n   📊 Messages migrated: ${stats.messages}`);
}

// ============ MAIN ============

async function main() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   Supabase → PocketBase Migration Tool       ║');
    console.log('║   Transferring ALL data to the new backend   ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');

    // Validate config
    if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
        console.error('❌ Missing PocketBase admin credentials!\n');
        console.error('Please set them before running:\n');
        console.error('  PowerShell:');
        console.error('    $env:PB_ADMIN_EMAIL = "your_admin_email"');
        console.error('    $env:PB_ADMIN_PASSWORD = "your_admin_password"');
        console.error('    node migrate-to-pocketbase.js\n');
        process.exit(1);
    }

    try {
        // 1. Authenticate with PocketBase Admin
        console.log('🔐 Authenticating with PocketBase admin...');
        const pbToken = await loginPBAdmin();
        console.log('   ✅ Admin authenticated successfully\n');

        // 2. Fetch ALL data from Supabase
        console.log('📥 Fetching data from Supabase...');
        console.log(`   URL: ${SUPABASE_URL}`);

        const profiles = await fetchFromSupabase('profiles');
        console.log(`   📋 Profiles: ${profiles.length} records`);

        const exams = await fetchFromSupabase('exams');
        console.log(`   📝 Exams: ${exams.length} records`);

        const results = await fetchFromSupabase('results');
        console.log(`   📊 Results: ${results.length} records`);

        const messages = await fetchFromSupabase('messages');
        console.log(`   💬 Messages: ${messages.length} records`);

        const totalRecords = profiles.length + exams.length + results.length + messages.length;
        if (totalRecords === 0) {
            console.log('\n⚠️  No data found in Supabase! Check your API key and table names.');
            console.log('   Trying alternative table names...\n');

            // Try alternative table names
            const users = await fetchFromSupabase('users');
            if (users.length > 0) {
                console.log(`   Found ${users.length} records in "users" table instead of "profiles"`);
                profiles.push(...users);
            }
        }

        // 3. Run migrations in order
        await migrateUsers(pbToken, profiles);
        await migrateExams(pbToken, exams);
        await migrateResults(pbToken, results);
        await migrateMessages(pbToken, messages);

        // 4. Print summary
        console.log('\n');
        console.log('╔═══════════════════════════════════════════════╗');
        console.log('║           MIGRATION COMPLETE! 🎉             ║');
        console.log('╚═══════════════════════════════════════════════╝');
        console.log('');
        console.log(`   👥 Users migrated:    ${stats.users}`);
        console.log(`   📝 Exams migrated:    ${stats.exams}`);
        console.log(`   📊 Results migrated:  ${stats.results}`);
        console.log(`   💬 Messages migrated: ${stats.messages}`);
        console.log(`   ⏭️  Skipped:           ${stats.skipped}`);

        if (stats.errors.length > 0) {
            console.log(`\n   ⚠️  Errors (${stats.errors.length}):`);
            stats.errors.forEach((e, i) => console.log(`      ${i + 1}. ${e}`));
        }

        if (stats.users > 0) {
            console.log('\n   ⚠️  IMPORTANT:');
            console.log(`   All migrated users have temporary password: ${TEMP_PASSWORD}`);
            console.log('   Teachers and students should change their passwords after logging in.');
            console.log('   Or you can update passwords in the PocketBase admin panel:');
            console.log(`   ${PB_URL}/_/`);
        }

        // Print ID mapping for reference
        if (userIdMap.size > 0) {
            console.log('\n   📋 User ID Mapping (Supabase → PocketBase):');
            for (const [sbId, pbId] of userIdMap) {
                console.log(`      ${sbId} → ${pbId}`);
            }
        }

        if (examIdMap.size > 0) {
            console.log('\n   📋 Exam ID Mapping (Supabase → PocketBase):');
            for (const [sbId, pbId] of examIdMap) {
                console.log(`      ${sbId} → ${pbId}`);
            }
        }

    } catch (err) {
        console.error(`\n💥 Migration failed: ${err.message}`);
        console.error(err.stack);
        process.exit(1);
    }
}

main();
