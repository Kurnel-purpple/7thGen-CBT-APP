
const PB_URL = 'https://gen7-cbt-app.fly.dev';
// Use the credentials from fix-migration.js if available, or ask user?
// I see them in fix-migration.js:
// $env:PB_ADMIN_EMAIL = "corneliusajayi123@gmail.com"
// $env:PB_ADMIN_PASSWORD = "Finest1709"

const email = 'corneliusajayi123@gmail.com';
const password = 'Finest1709';

async function probe() {
    console.log('Authenticating...');
    const authRes = await fetch(`${PB_URL}/api/admins/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: email, password: password })
    });

    if (!authRes.ok) {
        throw new Error('Auth failed');
    }

    const token = (await authRes.json()).token;
    console.log('Authenticated.');

    // 1. Get a valid User and Profile
    const usersRes = await fetch(`${PB_URL}/api/collections/users/records?perPage=1`, {
        headers: { Authorization: token }
    });
    const users = (await usersRes.json()).items;
    const user = users[0];

    const profilesRes = await fetch(`${PB_URL}/api/collections/profiles/records?perPage=1`, {
        headers: { Authorization: token }
    });
    const profiles = (await profilesRes.json()).items;
    const profile = profiles[0];

    console.log('--- RELATION PROBE ---');
    console.log('User ID:', user.id);
    console.log('Profile ID:', profile.id);

    async function testCreate(name, from, to) {
        process.stdout.write(`Testing ${name}... `);
        const res = await fetch(`${PB_URL}/api/collections/messages/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token },
            body: JSON.stringify({
                from_id: from,
                to_id: to,
                message: 'Probe',
                read: false,
                school_version: 'test'
            })
        });

        if (res.ok) {
            console.log('✅ SUCCESS');
            const d = await res.json();
            await fetch(`${PB_URL}/api/collections/messages/records/${d.id}`, {
                method: 'DELETE',
                headers: { Authorization: token }
            });
        } else {
            const err = await res.json();
            console.log('❌ FAILED (400)');
            if (err.data) {
                Object.keys(err.data).forEach(k => {
                    console.log(`   [${k}]: ${err.data[k].message}`);
                });
            }
        }
    }

    await testCreate('User -> User', user.id, user.id);
    await testCreate('Profile -> Profile', profile.id, profile.id);
}

probe();
