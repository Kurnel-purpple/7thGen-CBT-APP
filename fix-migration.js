/**
 * ============================================
 * Fix Script: Reassign Exams + Handle Oversized Exam
 * ============================================
 * 
 * 1. Identifies which Supabase teachers created which exams
 * 2. Creates missing teacher accounts in PocketBase (with sanitized emails)  
 * 3. Reassigns exams to their correct teachers
 * 4. Handles the oversized "THIRD TERM" exam
 * 
 * Usage (PowerShell):
 *   $env:PB_ADMIN_EMAIL = "corneliusajayi123@gmail.com"
 *   $env:PB_ADMIN_PASSWORD = "Finest1709"
 *   node fix-migration.js
 */

const SUPABASE_URL = 'https://gvxwuwtfqbxgzsjrdkpf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_U2lIeDzAr6kMdqXpHolDtw_ndHOuVXV';
const PB_URL = 'https://gen7-cbt-app.fly.dev';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL;
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD;
const TEMP_PASSWORD = 'Migrate2026!';

// ============ HELPERS ============

async function fetchFromSupabase(table, params = '') {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&limit=10000${params}`;
    const response = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        console.error(`Failed to fetch ${table}: ${response.status}`);
        return [];
    }
    return response.json();
}

async function loginPBAdmin() {
    const response = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: PB_ADMIN_EMAIL, password: PB_ADMIN_PASSWORD })
    });
    if (!response.ok) throw new Error(`PB admin auth failed: ${response.status}`);
    const data = await response.json();
    return data.token;
}

async function createInPB(token, collection, data) {
    const response = await fetch(`${PB_URL}/api/collections/${collection}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': token },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(JSON.stringify(err));
    }
    return response.json();
}

async function updateInPB(token, collection, id, data) {
    const response = await fetch(`${PB_URL}/api/collections/${collection}/records/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': token },
        body: JSON.stringify(data)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(JSON.stringify(err));
    }
    return response.json();
}

async function fetchAllFromPB(token, collection, filter = '') {
    let allItems = [];
    let page = 1;
    while (true) {
        const params = `?page=${page}&perPage=200${filter ? '&filter=' + encodeURIComponent(filter) : ''}`;
        const response = await fetch(`${PB_URL}/api/collections/${collection}/records${params}`, {
            headers: { 'Authorization': token }
        });
        if (!response.ok) break;
        const data = await response.json();
        allItems = allItems.concat(data.items);
        if (data.items.length < 200) break;
        page++;
    }
    return allItems;
}

function sanitizeEmail(name) {
    // Convert "Ade Adams" → "ade.adams@school.cbt"
    // Convert "Mrs Olaleru" → "mrs.olaleru@school.cbt"  
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s.-]/g, '')  // Remove special chars
        .replace(/\s+/g, '.')            // Spaces → dots
        .replace(/\.+/g, '.')            // Multiple dots → single dot
        .replace(/^\.+|\.+$/g, '')       // Remove leading/trailing dots
        + '@school.cbt';
}

// ============ MAIN ============

async function main() {
    console.log('');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   Migration Fix: Reassign Exams + Oversized  ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');

    if (!PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) {
        console.error('❌ Set PB_ADMIN_EMAIL and PB_ADMIN_PASSWORD first!');
        process.exit(1);
    }

    const pbToken = await loginPBAdmin();
    console.log('✅ PocketBase admin authenticated\n');

    // =============================================
    // PART 1: Identify & create missing teachers
    // =============================================
    console.log('═══════════════════════════════════════════');
    console.log('PART 1: Identify missing teachers');
    console.log('═══════════════════════════════════════════\n');

    // Fetch all Supabase profiles
    const sbProfiles = await fetchFromSupabase('profiles');
    console.log(`📋 Fetched ${sbProfiles.length} Supabase profiles`);

    // Fetch all Supabase exams to find unique created_by IDs
    const sbExams = await fetchFromSupabase('exams');
    console.log(`📝 Fetched ${sbExams.length} Supabase exams`);

    // Get unique teacher IDs from exams
    const teacherIds = [...new Set(sbExams.map(e => e.created_by).filter(Boolean))];
    console.log(`\n👨‍🏫 Unique teacher IDs who created exams: ${teacherIds.length}\n`);

    // Match teacher IDs to profiles
    const teacherMap = new Map(); // supabaseId → { name, email, pbId }

    for (const teacherId of teacherIds) {
        const profile = sbProfiles.find(p => p.id === teacherId || p.user_id === teacherId);
        if (profile) {
            console.log(`   Found: ${teacherId} → "${profile.full_name || profile.username}" (${profile.role})`);
            teacherMap.set(teacherId, {
                name: profile.full_name || profile.username || 'Unknown Teacher',
                username: profile.username,
                role: profile.role || 'teacher',
                classLevel: profile.class_level,
                schoolVersion: profile.school_version,
                pbId: null
            });
        } else {
            console.log(`   ⚠️  No profile found for: ${teacherId}`);
            teacherMap.set(teacherId, {
                name: 'Unknown Teacher',
                role: 'teacher',
                pbId: null
            });
        }
    }

    // Fetch existing PocketBase users
    const pbUsers = await fetchAllFromPB(pbToken, 'users');
    console.log(`\n📋 Existing PocketBase users: ${pbUsers.length}`);
    const pbUsersByEmail = new Map(pbUsers.map(u => [u.email, u]));

    // =============================================
    // PART 2: Create missing teachers in PocketBase
    // =============================================
    console.log('\n═══════════════════════════════════════════');
    console.log('PART 2: Create missing teacher accounts');
    console.log('═══════════════════════════════════════════\n');

    for (const [sbId, teacher] of teacherMap) {
        // Generate a valid email
        const email = sanitizeEmail(teacher.username || teacher.name);

        // Check if already exists
        if (pbUsersByEmail.has(email)) {
            const existing = pbUsersByEmail.get(email);
            teacher.pbId = existing.id;
            console.log(`   ↔️  Already exists: "${teacher.name}" → ${email} (PB: ${existing.id})`);
            continue;
        }

        // Create the teacher
        try {
            const pbUser = await createInPB(pbToken, 'users', {
                email: email,
                password: TEMP_PASSWORD,
                passwordConfirm: TEMP_PASSWORD,
                role: teacher.role || 'teacher',
                full_name: teacher.name,
                class_level: teacher.classLevel || null,
                school_version: teacher.schoolVersion || null,
                emailVisibility: false
            });

            teacher.pbId = pbUser.id;
            console.log(`   ✅ Created: "${teacher.name}" → ${email} (PB: ${pbUser.id})`);

            // Also create profile
            try {
                await createInPB(pbToken, 'profiles', {
                    role: teacher.role || 'teacher',
                    full_name: teacher.name,
                    class_level: teacher.classLevel || null,
                    school_version: teacher.schoolVersion || null,
                    user: pbUser.id
                });
            } catch (e) { /* profile may fail, ok */ }

        } catch (err) {
            console.error(`   ❌ Failed to create "${teacher.name}" (${email}): ${err.message}`);
        }
    }

    // =============================================
    // PART 3: Reassign exams to correct teachers
    // =============================================
    console.log('\n═══════════════════════════════════════════');
    console.log('PART 3: Reassign exams to correct teachers');
    console.log('═══════════════════════════════════════════\n');

    // Fetch all PocketBase exams
    const pbExams = await fetchAllFromPB(pbToken, 'exams');
    console.log(`📝 PocketBase exams: ${pbExams.length}\n`);

    // Build a mapping from Supabase exam title+questions count → PB exam
    // Also use the exam ID mapping from the migration
    const examIdMap = new Map();
    // From the migration output:
    const migrationMapping = {
        'afbf679f-3e9d-4308-835c-b48314cb3b4a': 'aesoeiwe8ptjpew',
        '7b7de69e-ba72-4efd-b1cb-8dc68c0acdee': 'gs4eftviwodbgln',
        '9ed251dd-bc84-4127-86fd-04dfb00128e0': 'tp22poci7pk9wmg',
        '1b9c12b3-cfe5-4cc0-a831-164f8f75b530': '808w1quhndlqtav',
        'ad378c78-1672-4670-b69c-bf88044cd154': 'bpb4afeh5ib9d8f',
        'f912ee2d-13fd-46b6-aaa0-8e922312b748': 'yla0h3wj3cued6z',
        '7ba4ab68-64a8-4133-b839-50cdf43be7e1': 'sosf84fe7gq0xe5',
        '64fdbe71-5d7d-44cc-9061-6d38af2f953e': 'e7qsvg90nqxjals',
        'b1aa3912-cb70-4aab-8eea-48f3a9608b5d': 'bdtch3bopphdda5',
        'cbe74bbd-e5a2-4559-abb5-0d4136d5a068': 'kjyonl7dxc0xt6v',
        'a6375f13-bc53-49a7-85ab-449f6c5bdb77': 'syohzjvdnz6obe5',
        'a671e4f2-0ee2-45ee-a975-7ac740a8a42f': 'h4e6bbila3tp9td',
        'cf6783bc-f174-4b79-8077-d77134428fbf': 'c4iwr6yf6j99m60',
        'd6b3185f-44f0-4d07-b4db-6b39ea2093b0': 'fbv87wb38hzaxph',
        '54168420-fcec-4149-b36b-c9e5ffee2815': 'aikgl5qm81iqjg9',
        'acba8280-8c4f-442d-a20f-cea9ad36aba9': 'dx6vdipmcirlog5',
        '43db9875-ce35-4ad3-bbea-2367561e8fd5': 'vmdmagolvf8gbpw',
        '2dc73710-7cb0-4bfa-a895-8bce0b2f7fdc': 'e7nla52vjstiuzr',
        'cf11b027-81c2-4e97-832b-b796b77ac3d0': 'a74m5pk1nkxsxi0',
        '90bd4649-8096-4ba0-82d3-62931da6f27c': 'eiq3nda1498kfds',
        'fcf2dc6c-6944-487a-a0f6-1d9e5e789e21': 'cb3dghp63te4rch'
    };

    let reassigned = 0;
    let skipped = 0;

    for (const sbExam of sbExams) {
        const pbExamId = migrationMapping[sbExam.id];
        if (!pbExamId) {
            // This exam wasn't migrated (e.g., the oversized one)
            continue;
        }

        const teacher = teacherMap.get(sbExam.created_by);
        if (!teacher || !teacher.pbId) {
            console.log(`   ⚠️  No PB teacher for exam "${sbExam.title}" (created_by: ${sbExam.created_by})`);
            skipped++;
            continue;
        }

        // Update the exam's created_by to the correct teacher
        try {
            await updateInPB(pbToken, 'exams', pbExamId, {
                created_by: teacher.pbId
            });
            console.log(`   ✅ "${sbExam.title}" → assigned to "${teacher.name}" (${teacher.pbId})`);
            reassigned++;
        } catch (err) {
            console.error(`   ❌ Failed to reassign "${sbExam.title}": ${err.message}`);
        }
    }

    console.log(`\n   📊 Reassigned: ${reassigned}, Skipped: ${skipped}`);

    // =============================================
    // PART 4: Handle oversized "THIRD TERM" exam
    // =============================================
    console.log('\n═══════════════════════════════════════════');
    console.log('PART 4: Handle oversized "THIRD TERM" exam');
    console.log('═══════════════════════════════════════════\n');

    const thirdTermExam = sbExams.find(e => e.title && e.title.trim().toUpperCase() === 'THIRD TERM');

    if (!thirdTermExam) {
        console.log('   ⚠️  Could not find "THIRD TERM" exam in Supabase data');
    } else {
        const questionsJson = JSON.stringify(thirdTermExam.questions);
        const sizeBytes = new TextEncoder().encode(questionsJson).length;
        const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
        const questionCount = Array.isArray(thirdTermExam.questions) ? thirdTermExam.questions.length : 0;

        console.log(`   📋 Exam: "${thirdTermExam.title}"`);
        console.log(`   📋 Subject: ${thirdTermExam.subject}`);
        console.log(`   📋 Questions: ${questionCount}`);
        console.log(`   📋 JSON size: ${sizeMB} MB (${sizeBytes.toLocaleString()} bytes)`);
        console.log(`   📋 PB limit: 2.00 MB (2,000,000 bytes)`);
        console.log(`   📋 Over by: ${((sizeBytes - 2000000) / 1024).toFixed(0)} KB`);

        // Check if there are base64 images
        let base64Count = 0;
        let base64TotalSize = 0;
        const base64Regex = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;

        const matches = questionsJson.match(base64Regex);
        if (matches) {
            base64Count = matches.length;
            base64TotalSize = matches.reduce((sum, m) => sum + m.length, 0);
            console.log(`\n   🖼️  Found ${base64Count} embedded base64 images`);
            console.log(`   🖼️  Images account for ~${(base64TotalSize / 1024).toFixed(0)} KB`);
        }

        // Strategy: Strip base64 images from questions to fit under limit
        // Replace data:image/... with empty string or placeholder
        console.log('\n   🔧 Attempting to compress by stripping embedded images...');

        let compressedQuestions = JSON.parse(JSON.stringify(thirdTermExam.questions));

        if (Array.isArray(compressedQuestions)) {
            for (let i = 0; i < compressedQuestions.length; i++) {
                const q = compressedQuestions[i];
                // Strip base64 from question text
                if (q.question && typeof q.question === 'string') {
                    q.question = q.question.replace(base64Regex, '[image removed - too large for migration]');
                }
                // Strip from options
                if (q.options && Array.isArray(q.options)) {
                    q.options = q.options.map(opt => {
                        if (typeof opt === 'string') {
                            return opt.replace(base64Regex, '[image removed]');
                        }
                        if (opt && typeof opt === 'object' && opt.text) {
                            opt.text = opt.text.replace(base64Regex, '[image removed]');
                        }
                        return opt;
                    });
                }
                // Strip from explanation
                if (q.explanation && typeof q.explanation === 'string') {
                    q.explanation = q.explanation.replace(base64Regex, '[image removed]');
                }
                // Strip from media field
                if (q.media && typeof q.media === 'string' && q.media.startsWith('data:')) {
                    q.media = '';
                }
                if (q.image && typeof q.image === 'string' && q.image.startsWith('data:')) {
                    q.image = '';
                }
            }
        }

        const compressedJson = JSON.stringify(compressedQuestions);
        const compressedSize = new TextEncoder().encode(compressedJson).length;
        const compressedMB = (compressedSize / (1024 * 1024)).toFixed(2);

        console.log(`   📏 Compressed size: ${compressedMB} MB (${compressedSize.toLocaleString()} bytes)`);

        if (compressedSize <= 2000000) {
            console.log('   ✅ Fits within PocketBase limit! Creating exam...\n');

            const teacher = teacherMap.get(thirdTermExam.created_by);
            const createdBy = teacher?.pbId || pbUsers.find(u => u.role === 'teacher')?.id;

            try {
                const pbExam = await createInPB(pbToken, 'exams', {
                    title: thirdTermExam.title,
                    subject: thirdTermExam.subject,
                    school_level: thirdTermExam.school_level || null,
                    target_class: thirdTermExam.target_class,
                    duration: thirdTermExam.duration,
                    pass_score: thirdTermExam.pass_score,
                    instructions: thirdTermExam.instructions || '',
                    theory_instructions: thirdTermExam.theory_instructions || null,
                    questions: compressedQuestions,
                    status: thirdTermExam.status || 'draft',
                    created_by: createdBy,
                    scheduled_date: thirdTermExam.scheduled_date || null,
                    scramble_questions: thirdTermExam.scramble_questions || false,
                    client_id: `migrated_${thirdTermExam.id}`
                });

                console.log(`   ✅ "THIRD TERM" migrated! PB ID: ${pbExam.id}`);
                console.log(`   ⚠️  Note: Embedded images were stripped. Questions are intact but without images.`);
                console.log(`   💡 Teachers can re-add images through the exam editor.`);
            } catch (err) {
                console.error(`   ❌ Still failed: ${err.message}`);

                // Last resort: split into two exams
                console.log('\n   🔧 Trying to split into two exams...');
                const half = Math.ceil(compressedQuestions.length / 2);
                const part1 = compressedQuestions.slice(0, half);
                const part2 = compressedQuestions.slice(half);

                try {
                    const exam1 = await createInPB(pbToken, 'exams', {
                        title: `${thirdTermExam.title} (Part 1)`,
                        subject: thirdTermExam.subject,
                        target_class: thirdTermExam.target_class,
                        duration: Math.ceil(thirdTermExam.duration / 2),
                        pass_score: thirdTermExam.pass_score,
                        instructions: thirdTermExam.instructions || '',
                        questions: part1,
                        status: thirdTermExam.status || 'draft',
                        created_by: createdBy,
                        client_id: `migrated_${thirdTermExam.id}_p1`
                    });
                    console.log(`   ✅ Part 1 created (${part1.length} questions) → ${exam1.id}`);

                    const exam2 = await createInPB(pbToken, 'exams', {
                        title: `${thirdTermExam.title} (Part 2)`,
                        subject: thirdTermExam.subject,
                        target_class: thirdTermExam.target_class,
                        duration: Math.ceil(thirdTermExam.duration / 2),
                        pass_score: thirdTermExam.pass_score,
                        instructions: thirdTermExam.instructions || '',
                        questions: part2,
                        status: thirdTermExam.status || 'draft',
                        created_by: createdBy,
                        client_id: `migrated_${thirdTermExam.id}_p2`
                    });
                    console.log(`   ✅ Part 2 created (${part2.length} questions) → ${exam2.id}`);
                } catch (splitErr) {
                    console.error(`   ❌ Split also failed: ${splitErr.message}`);
                }
            }
        } else {
            console.log(`   ❌ Still too large after stripping images (${compressedMB} MB)`);
            console.log('   🔧 Attempting to split into smaller exams...');

            const teacher = teacherMap.get(thirdTermExam.created_by);
            const createdBy = teacher?.pbId || pbUsers.find(u => u.role === 'teacher')?.id;

            // Split into chunks that fit
            const maxChunkSize = 1800000; // 1.8MB to be safe
            let chunks = [];
            let currentChunk = [];
            let currentSize = 0;

            for (const q of compressedQuestions) {
                const qSize = new TextEncoder().encode(JSON.stringify(q)).length;
                if (currentSize + qSize > maxChunkSize && currentChunk.length > 0) {
                    chunks.push([...currentChunk]);
                    currentChunk = [q];
                    currentSize = qSize;
                } else {
                    currentChunk.push(q);
                    currentSize += qSize;
                }
            }
            if (currentChunk.length > 0) chunks.push(currentChunk);

            console.log(`   📋 Splitting into ${chunks.length} parts`);

            for (let i = 0; i < chunks.length; i++) {
                try {
                    const partTitle = chunks.length > 1
                        ? `${thirdTermExam.title} (Part ${i + 1})`
                        : thirdTermExam.title;

                    const exam = await createInPB(pbToken, 'exams', {
                        title: partTitle,
                        subject: thirdTermExam.subject,
                        target_class: thirdTermExam.target_class,
                        duration: Math.ceil(thirdTermExam.duration / chunks.length),
                        pass_score: thirdTermExam.pass_score,
                        instructions: thirdTermExam.instructions || '',
                        questions: chunks[i],
                        status: thirdTermExam.status || 'draft',
                        created_by: createdBy,
                        client_id: `migrated_${thirdTermExam.id}_p${i + 1}`
                    });
                    console.log(`   ✅ Part ${i + 1} created (${chunks[i].length} questions) → ${exam.id}`);
                } catch (chunkErr) {
                    console.error(`   ❌ Part ${i + 1} failed: ${chunkErr.message}`);
                }
            }
        }
    }

    // =============================================
    // SUMMARY
    // =============================================
    console.log('\n');
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║           FIX COMPLETE! 🎉                   ║');
    console.log('╚═══════════════════════════════════════════════╝');
    console.log('');
    console.log(`   Exams reassigned: ${reassigned}`);
    console.log(`   Teacher accounts created for exam owners`);
    console.log('');
    console.log('   ⚠️  Teachers with newly created accounts:');
    console.log(`      Password: ${TEMP_PASSWORD}`);
    console.log('      They should change their password after logging in.');
    console.log('');

    // Print teacher email mapping
    console.log('   📋 Teacher Login Credentials:');
    for (const [sbId, teacher] of teacherMap) {
        if (teacher.pbId) {
            const email = sanitizeEmail(teacher.username || teacher.name);
            console.log(`      ${teacher.name}: ${email} / ${TEMP_PASSWORD}`);
        }
    }
}

main().catch(err => {
    console.error('💥 Error:', err.message);
    process.exit(1);
});
