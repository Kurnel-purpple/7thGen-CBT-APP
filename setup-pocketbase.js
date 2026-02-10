/**
 * PocketBase Automated Setup Script
 * Run this after creating admin account at http://127.0.0.1:8090/_/
 * 
 * Usage: node setup-pocketbase.js
 * Or: Open in browser console after logging into admin UI
 */

const POCKETBASE_URL = 'http://127.0.0.1:8090';

// Collection schemas
const collections = [
    {
        name: 'profiles',
        type: 'base',
        schema: [
            {
                system: false,
                id: 'user_relation',
                name: 'user',
                type: 'relation',
                required: true,
                options: {
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true
                }
            },
            {
                system: false,
                id: 'role_field',
                name: 'role',
                type: 'select',
                required: true,
                options: {
                    values: ['student', 'teacher', 'admin'],
                    maxSelect: 1
                }
            },
            {
                system: false,
                id: 'full_name_field',
                name: 'full_name',
                type: 'text',
                required: true
            },
            {
                system: false,
                id: 'class_level_field',
                name: 'class_level',
                type: 'text',
                required: false
            },
            {
                system: false,
                id: 'school_version_field',
                name: 'school_version',
                type: 'text',
                required: false
            }
        ],
        indexes: ['CREATE INDEX idx_role ON profiles (role)'],
        listRule: '@request.auth.id != ""',
        viewRule: '@request.auth.id != ""',
        createRule: '@request.auth.id != ""',
        updateRule: '@request.auth.id = user',
        deleteRule: '@request.auth.id = user'
    },
    {
        name: 'exams',
        type: 'base',
        schema: [
            {
                system: false,
                id: 'title_field',
                name: 'title',
                type: 'text',
                required: true
            },
            {
                system: false,
                id: 'subject_field',
                name: 'subject',
                type: 'text',
                required: true
            },
            {
                system: false,
                id: 'target_class_field',
                name: 'target_class',
                type: 'text',
                required: true
            },
            {
                system: false,
                id: 'duration_field',
                name: 'duration',
                type: 'number',
                required: true
            },
            {
                system: false,
                id: 'pass_score_field',
                name: 'pass_score',
                type: 'number',
                required: true
            },
            {
                system: false,
                id: 'instructions_field',
                name: 'instructions',
                type: 'editor',
                required: false
            },
            {
                system: false,
                id: 'theory_instructions_field',
                name: 'theory_instructions',
                type: 'editor',
                required: false
            },
            {
                system: false,
                id: 'questions_field',
                name: 'questions',
                type: 'json',
                required: false
            },
            {
                system: false,
                id: 'status_field',
                name: 'status',
                type: 'select',
                required: true,
                options: {
                    values: ['draft', 'active', 'archived'],
                    maxSelect: 1
                }
            },
            {
                system: false,
                id: 'created_by_field',
                name: 'created_by',
                type: 'relation',
                required: true,
                options: {
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false
                }
            },
            {
                system: false,
                id: 'scheduled_date_field',
                name: 'scheduled_date',
                type: 'date',
                required: false
            },
            {
                system: false,
                id: 'scramble_questions_field',
                name: 'scramble_questions',
                type: 'bool',
                required: false
            },
            {
                system: false,
                id: 'client_id_field',
                name: 'client_id',
                type: 'text',
                required: false
            },
            {
                system: false,
                id: 'school_level_field',
                name: 'school_level',
                type: 'text',
                required: false
            },
            {
                system: false,
                id: 'extensions_field',
                name: 'extensions',
                type: 'json',
                required: false
            },
            {
                system: false,
                id: 'global_extension_field',
                name: 'global_extension',
                type: 'number',
                required: false
            }
        ],
        indexes: [
            'CREATE INDEX idx_status ON exams (status)',
            'CREATE INDEX idx_target_class ON exams (target_class)',
            'CREATE INDEX idx_created_by ON exams (created_by)'
        ],
        listRule: '@request.auth.id != "" && (status = "active" || created_by = @request.auth.id)',
        viewRule: '@request.auth.id != "" && (status = "active" || created_by = @request.auth.id)',
        createRule: '@request.auth.id != "" && @request.auth.role = "teacher"',
        updateRule: '@request.auth.id = created_by || @request.auth.role = "admin"',
        deleteRule: '@request.auth.id = created_by || @request.auth.role = "admin"'
    },
    {
        name: 'results',
        type: 'base',
        schema: [
            {
                system: false,
                id: 'exam_id_field',
                name: 'exam_id',
                type: 'relation',
                required: true,
                options: {
                    collectionId: '', // Will be updated after exam collection is created
                    cascadeDelete: false
                }
            },
            {
                system: false,
                id: 'student_id_field',
                name: 'student_id',
                type: 'relation',
                required: true,
                options: {
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false
                }
            },
            {
                system: false,
                id: 'score_field',
                name: 'score',
                type: 'number',
                required: false
            },
            {
                system: false,
                id: 'total_points_field',
                name: 'total_points',
                type: 'number',
                required: false
            },
            {
                system: false,
                id: 'answers_field',
                name: 'answers',
                type: 'json',
                required: false
            },
            {
                system: false,
                id: 'flags_field',
                name: 'flags',
                type: 'json',
                required: false
            },
            {
                system: false,
                id: 'submitted_at_field',
                name: 'submitted_at',
                type: 'date',
                required: false
            },
            {
                system: false,
                id: 'pass_score_field',
                name: 'pass_score',
                type: 'number',
                required: false
            },
            {
                system: false,
                id: 'passed_field',
                name: 'passed',
                type: 'bool',
                required: false
            }
        ],
        indexes: [
            'CREATE INDEX idx_exam_student ON results (exam_id, student_id)',
            'CREATE INDEX idx_student_id ON results (student_id)'
        ],
        listRule: '@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"',
        viewRule: '@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"',
        createRule: '@request.auth.id = student_id',
        updateRule: '@request.auth.id = student_id || @request.auth.role = "teacher" || @request.auth.role = "admin"',
        deleteRule: '@request.auth.role = "admin"'
    },
    {
        name: 'messages',
        type: 'base',
        schema: [
            {
                system: false,
                id: 'from_id_field',
                name: 'from_id',
                type: 'relation',
                required: true,
                options: {
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false
                }
            },
            {
                system: false,
                id: 'to_id_field',
                name: 'to_id',
                type: 'relation',
                required: true,
                options: {
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: false
                }
            },
            {
                system: false,
                id: 'message_field',
                name: 'message',
                type: 'text',
                required: true
            },
            {
                system: false,
                id: 'school_version_field',
                name: 'school_version',
                type: 'text',
                required: false
            },
            {
                system: false,
                id: 'read_field',
                name: 'read',
                type: 'bool',
                required: false
            }
        ],
        indexes: [
            'CREATE INDEX idx_from_id ON messages (from_id)',
            'CREATE INDEX idx_to_id ON messages (to_id)'
        ],
        listRule: '@request.auth.id = from_id || @request.auth.id = to_id',
        viewRule: '@request.auth.id = from_id || @request.auth.id = to_id',
        createRule: '@request.auth.id = from_id',
        updateRule: '@request.auth.id = from_id || @request.auth.id = to_id',
        deleteRule: '@request.auth.id = from_id || @request.auth.id = to_id'
    }
];

// Additional fields for users collection
const userFields = [
    {
        system: false,
        id: 'role_field',
        name: 'role',
        type: 'select',
        required: true,
        options: {
            values: ['student', 'teacher', 'admin'],
            maxSelect: 1
        }
    },
    {
        system: false,
        id: 'full_name_field',
        name: 'full_name',
        type: 'text',
        required: true
    },
    {
        system: false,
        id: 'class_level_field',
        name: 'class_level',
        type: 'text',
        required: false
    },
    {
        system: false,
        id: 'school_version_field',
        name: 'school_version',
        type: 'text',
        required: false
    }
];

async function setupPocketBase() {
    console.log('🏗️  PocketBase Automated Setup');
    console.log('================================\n');
    
    // Check if PocketBase is running
    try {
        const health = await fetch(`${POCKETBASE_URL}/api/health`);
        if (!health.ok) {
            throw new Error('PocketBase is not running');
        }
        console.log('✅ PocketBase is running');
    } catch (err) {
        console.error('❌ PocketBase is not running. Please start it first:');
        console.error('   ./pocketbase.exe serve --http=0.0.0.0:8090');
        return;
    }

    // Get admin token
    console.log('\n🔐 Admin Authentication Required');
    console.log('Please log in at http://127.0.0.1:8090/_/ first and create an admin account.');
    console.log('Then get your admin token from the browser console after logging in.');
    console.log('\nTo get your token:');
    console.log('1. Open http://127.0.0.1:8090/_/ in your browser');
    console.log('2. Create admin account if not done');
    console.log('3. Open browser console (F12)');
    console.log('4. Run: pb.authStore.token');
    console.log('5. Copy the token and paste it below:\n');
    
    // For Node.js execution, we'd use readline
    // For browser execution, we'd use prompt
    const token = typeof window !== 'undefined' 
        ? prompt('Enter your admin token:')
        : await askForToken();
    
    if (!token) {
        console.error('❌ No token provided');
        return;
    }

    const headers = {
        'Authorization': token,
        'Content-Type': 'application/json'
    };

    try {
        // Step 1: Update users collection with custom fields
        console.log('\n📋 Step 1: Updating users collection...');
        await updateUsersCollection(headers);
        console.log('✅ Users collection updated');

        // Step 2: Create profiles collection
        console.log('\n📋 Step 2: Creating profiles collection...');
        const profilesCollection = await createCollection(collections[0], headers);
        console.log('✅ Profiles collection created');

        // Step 3: Create exams collection
        console.log('\n📋 Step 3: Creating exams collection...');
        const examsCollection = await createCollection(collections[1], headers);
        console.log('✅ Exams collection created');

        // Step 4: Create results collection (update exam relation)
        console.log('\n📋 Step 4: Creating results collection...');
        const resultsCollection = collections[2];
        resultsCollection.schema[0].options.collectionId = examsCollection.id;
        await createCollection(resultsCollection, headers);
        console.log('✅ Results collection created');

        // Step 5: Create messages collection
        console.log('\n📋 Step 5: Creating messages collection...');
        await createCollection(collections[3], headers);
        console.log('✅ Messages collection created');

        console.log('\n🎉 Setup Complete!');
        console.log('====================');
        console.log('All collections have been created with proper schema and rules.');
        console.log('\nNext steps:');
        console.log('1. Create test users in the admin UI');
        console.log('2. Test the application at http://127.0.0.1:8090');
        
    } catch (err) {
        console.error('❌ Setup failed:', err.message);
        if (err.message.includes('already exists')) {
            console.log('\n💡 Tip: Collections may already exist. Delete them first if you want to recreate.');
        }
    }
}

async function updateUsersCollection(headers) {
    // Get current users collection
    const response = await fetch(`${POCKETBASE_URL}/api/collections/users`, {
        headers
    });
    
    if (!response.ok) {
        throw new Error('Failed to fetch users collection');
    }
    
    const usersCollection = await response.json();
    
    // Add custom fields
    usersCollection.schema = usersCollection.schema || [];
    
    for (const field of userFields) {
        // Check if field already exists
        const exists = usersCollection.schema.some(f => f.name === field.name);
        if (!exists) {
            usersCollection.schema.push(field);
        }
    }
    
    // Update collection
    const updateResponse = await fetch(`${POCKETBASE_URL}/api/collections/users`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
            schema: usersCollection.schema
        })
    });
    
    if (!updateResponse.ok) {
        const error = await updateResponse.json();
        throw new Error(`Failed to update users collection: ${error.message}`);
    }
}

async function createCollection(collectionData, headers) {
    // Check if collection already exists
    const checkResponse = await fetch(`${POCKETBASE_URL}/api/collections/${collectionData.name}`, {
        headers
    });
    
    if (checkResponse.ok) {
        console.log(`   Collection '${collectionData.name}' already exists, skipping...`);
        return await checkResponse.json();
    }
    
    // Create collection
    const response = await fetch(`${POCKETBASE_URL}/api/collections`, {
        method: 'POST',
        headers,
        body: JSON.stringify(collectionData)
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Failed to create ${collectionData.name}: ${error.message}`);
    }
    
    return await response.json();
}

// Node.js helper function
async function askForToken() {
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question('Enter your admin token: ', (token) => {
            rl.close();
            resolve(token.trim());
        });
    });
}

// Run setup
if (typeof window !== 'undefined') {
    // Browser environment
    window.setupPocketBase = setupPocketBase;
    console.log('Setup function loaded. Run: setupPocketBase()');
} else {
    // Node.js environment
    setupPocketBase();
}

module.exports = { setupPocketBase };
