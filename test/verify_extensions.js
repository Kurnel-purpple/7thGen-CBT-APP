
// Mock Environment
const localStorageData = {};
global.localStorage = {
    getItem: (key) => localStorageData[key] || null,
    setItem: (key, val) => localStorageData[key] = val,
    removeItem: (key) => delete localStorageData[key]
};
global.window = { Utils: { generateId: () => 'id_' + Math.random() } };

class DataService {
    constructor() {
        this.KEYS = { USERS: 'cbt_users', EXAMS: 'cbt_exams' };
    }
    _get(key) { return JSON.parse(localStorage.getItem(key) || '[]'); }
    _save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }

    async updateExam(id, updates) {
        const exams = this._get(this.KEYS.EXAMS);
        const index = exams.findIndex(e => e.id === id);
        if (index !== -1) {
            exams[index] = { ...exams[index], ...updates };
            this._save(this.KEYS.EXAMS, exams);
        }
    }
}
const dataService = new DataService();

// Setup Data
localStorage.setItem('cbt_exams', JSON.stringify([
    { id: 'exam1', duration: 60, title: 'Math' }
]));

// Helper to simulate logic in takeExam.js
function calculateDuration(exam, userId) {
    let duration = exam.duration;
    let multiplier = 1;

    if (exam.globalExtension && exam.globalExtension.multiplier) {
        multiplier = Math.max(multiplier, exam.globalExtension.multiplier);
    }

    if (exam.extensions && exam.extensions[userId]) {
        multiplier = Math.max(multiplier, exam.extensions[userId].multiplier);
    }

    return Math.round(duration * multiplier);
}

// Test Logic
async function testExtension() {
    console.log('--- Testing Extensions ---');

    console.log('1. Testing Specific Extension...');
    await dataService.updateExam('exam1', {
        extensions: { 'student1': { multiplier: 1.5 } }
    });

    let exams = JSON.parse(localStorage.getItem('cbt_exams'));
    let exam = exams.find(e => e.id === 'exam1');

    let dur = calculateDuration(exam, 'student1');
    if (dur === 90) console.log('PASS: Specific Extension (60 * 1.5 = 90)');
    else console.error(`FAIL: Specific Extension. Expected 90, got ${dur}`);

    console.log('2. Testing Global Extension...');
    await dataService.updateExam('exam1', {
        globalExtension: { multiplier: 1.25 }
    });
    exams = JSON.parse(localStorage.getItem('cbt_exams'));
    exam = exams.find(e => e.id === 'exam1');

    // Student 2 has no specific extension, should get global
    dur = calculateDuration(exam, 'student2');
    if (dur === 75) console.log('PASS: Global Extension (60 * 1.25 = 75)');
    else console.error(`FAIL: Global Extension. Expected 75, got ${dur}`);

    console.log('3. Testing Global + Specific (Max Wins)...');
    // Student 1 has 1.5, Global is 1.25. 1.5 should win.
    dur = calculateDuration(exam, 'student1');
    if (dur === 90) console.log('PASS: Max Wins (1.5 > 1.25)');
    else console.error(`FAIL: Max Wins. Expected 90, got ${dur}`);

    console.log('4. Testing Global + Specific (Global Wins)...');
    // Update Global to 2.0
    await dataService.updateExam('exam1', {
        globalExtension: { multiplier: 2.0 }
    });
    exams = JSON.parse(localStorage.getItem('cbt_exams'));
    exam = exams.find(e => e.id === 'exam1');

    // Student 1 has 1.5, Global is 2.0. 2.0 should win.
    dur = calculateDuration(exam, 'student1');
    if (dur === 120) console.log('PASS: Max Wins (2.0 > 1.5)');
    else console.error(`FAIL: Max Wins (Global). Expected 120, got ${dur}`);
}

testExtension();
