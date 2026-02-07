/**
 * IndexedDB Service Module
 * Provides large-scale offline storage for CBT App
 * Replaces localStorage for questions, exams, answers, and progress
 */

const DB_NAME = 'cbtAppDB';
const DB_VERSION = 1;

let dbPromise = null;

/**
 * Open or create the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('[IndexedDB] Failed to open database:', request.error);
            reject(request.error);
        };

        request.onsuccess = () => {
            console.log('[IndexedDB] Database opened successfully');
            resolve(request.result);
        };

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            console.log('[IndexedDB] Upgrading database schema...');

            // Store for full exam objects (questions included)
            if (!db.objectStoreNames.contains('exams')) {
                const examStore = db.createObjectStore('exams', { keyPath: 'id' });
                examStore.createIndex('createdBy', 'createdBy', { unique: false });
                examStore.createIndex('status', 'status', { unique: false });
                examStore.createIndex('cachedAt', 'cachedAt', { unique: false });
            }

            // Store for exam results
            if (!db.objectStoreNames.contains('results')) {
                const resultStore = db.createObjectStore('results', { keyPath: 'id' });
                resultStore.createIndex('examId', 'examId', { unique: false });
                resultStore.createIndex('studentId', 'studentId', { unique: false });
            }

            // Store for pending answer submissions (offline queue)
            if (!db.objectStoreNames.contains('pendingAnswers')) {
                const pendingStore = db.createObjectStore('pendingAnswers', {
                    keyPath: 'localId',
                    autoIncrement: true
                });
                pendingStore.createIndex('examId', 'examId', { unique: false });
                pendingStore.createIndex('studentId', 'studentId', { unique: false });
                pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // Store for student progress (in-progress exams)
            if (!db.objectStoreNames.contains('studentProgress')) {
                const progressStore = db.createObjectStore('studentProgress', { keyPath: 'progressKey' });
                progressStore.createIndex('examId', 'examId', { unique: false });
                progressStore.createIndex('studentId', 'studentId', { unique: false });
            }

            // Store for dashboard cache (exams list, results list)
            if (!db.objectStoreNames.contains('dashboardCache')) {
                db.createObjectStore('dashboardCache', { keyPath: 'cacheKey' });
            }

            console.log('[IndexedDB] Schema upgrade complete');
        };
    });

    return dbPromise;
}

// ============================================
// EXAM OPERATIONS
// ============================================

/**
 * Save a single exam to IndexedDB
 * @param {Object} exam - Full exam object with questions
 */
async function saveExam(exam) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('exams', 'readwrite');
        const store = tx.objectStore('exams');

        // Add cache timestamp
        const examWithMeta = {
            ...exam,
            cachedAt: Date.now()
        };

        const request = store.put(examWithMeta);

        request.onsuccess = () => {
            console.log(`[IndexedDB] Exam ${exam.id} saved`);
            resolve(exam);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Save multiple exams at once
 * @param {Array} exams - Array of exam objects
 */
async function saveExams(exams) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('exams', 'readwrite');
        const store = tx.objectStore('exams');

        exams.forEach(exam => {
            store.put({
                ...exam,
                cachedAt: Date.now()
            });
        });

        tx.oncomplete = () => {
            console.log(`[IndexedDB] ${exams.length} exams saved`);
            resolve(exams);
        };
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get a single exam by ID
 * @param {string} examId 
 */
async function getExam(examId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('exams', 'readonly');
        const store = tx.objectStore('exams');
        const request = store.get(examId);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all cached exams
 */
async function getAllExams() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('exams', 'readonly');
        const store = tx.objectStore('exams');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Check if exam is cached
 * @param {string} examId 
 */
async function hasExamCached(examId) {
    const exam = await getExam(examId);
    return exam !== null;
}

/**
 * Delete a specific exam
 * @param {string} examId 
 */
async function deleteExam(examId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('exams', 'readwrite');
        const store = tx.objectStore('exams');
        const request = store.delete(examId);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Clear all cached exams
 */
async function clearExams() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('exams', 'readwrite');
        const store = tx.objectStore('exams');
        const request = store.clear();

        request.onsuccess = () => {
            console.log('[IndexedDB] All exams cleared');
            resolve(true);
        };
        request.onerror = () => reject(request.error);
    });
}

// ============================================
// RESULTS OPERATIONS
// ============================================

/**
 * Save results to IndexedDB
 * @param {Array} results 
 */
async function saveResults(results) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('results', 'readwrite');
        const store = tx.objectStore('results');

        results.forEach(result => {
            store.put({
                ...result,
                cachedAt: Date.now()
            });
        });

        tx.oncomplete = () => resolve(results);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Get all results for a student
 * @param {string} studentId 
 */
async function getResultsByStudent(studentId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('results', 'readonly');
        const store = tx.objectStore('results');
        const index = store.index('studentId');
        const request = index.getAll(studentId);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

// ============================================
// PENDING ANSWERS QUEUE (Offline Submissions)
// ============================================

/**
 * Queue an answer/submission for later sync
 * @param {Object} submission - { examId, studentId, answers, score, ... }
 */
async function queuePendingSubmission(submission) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingAnswers', 'readwrite');
        const store = tx.objectStore('pendingAnswers');

        const item = {
            ...submission,
            timestamp: Date.now(),
            synced: false
        };

        const request = store.add(item);

        request.onsuccess = () => {
            console.log('[IndexedDB] Submission queued for sync');
            resolve(request.result); // returns the auto-generated key
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get all pending submissions
 */
async function getPendingSubmissions() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingAnswers', 'readonly');
        const store = tx.objectStore('pendingAnswers');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Remove a submission from the queue (after successful sync)
 * @param {number} localId - The auto-generated local ID
 */
async function removePendingSubmission(localId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingAnswers', 'readwrite');
        const store = tx.objectStore('pendingAnswers');
        const request = store.delete(localId);

        request.onsuccess = () => {
            console.log(`[IndexedDB] Pending submission ${localId} removed`);
            resolve(true);
        };
        request.onerror = () => reject(request.error);
    });
}

/**
 * Clear all pending submissions
 */
async function clearPendingSubmissions() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pendingAnswers', 'readwrite');
        const store = tx.objectStore('pendingAnswers');
        const request = store.clear();

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

// ============================================
// STUDENT PROGRESS (In-progress exam state)
// ============================================

/**
 * Save student progress during exam
 * @param {string} examId 
 * @param {string} studentId 
 * @param {Object} progressData - { answers, flagged, currentQuestion, ... }
 */
async function saveProgress(examId, studentId, progressData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('studentProgress', 'readwrite');
        const store = tx.objectStore('studentProgress');

        const item = {
            progressKey: `${examId}_${studentId}`,
            examId,
            studentId,
            ...progressData,
            savedAt: Date.now()
        };

        const request = store.put(item);

        request.onsuccess = () => resolve(item);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Load student progress for an exam
 * @param {string} examId 
 * @param {string} studentId 
 */
async function loadProgress(examId, studentId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('studentProgress', 'readonly');
        const store = tx.objectStore('studentProgress');
        const request = store.get(`${examId}_${studentId}`);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Delete student progress after submission
 * @param {string} examId 
 * @param {string} studentId 
 */
async function deleteProgress(examId, studentId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('studentProgress', 'readwrite');
        const store = tx.objectStore('studentProgress');
        const request = store.delete(`${examId}_${studentId}`);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

// ============================================
// DASHBOARD CACHE
// ============================================

/**
 * Save dashboard cache (exams list, results list)
 * @param {string} cacheKey - e.g., 'exams_list' or 'results_studentId'
 * @param {*} data 
 */
async function saveDashboardCache(cacheKey, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('dashboardCache', 'readwrite');
        const store = tx.objectStore('dashboardCache');

        const item = {
            cacheKey,
            data,
            cachedAt: Date.now()
        };

        const request = store.put(item);

        request.onsuccess = () => resolve(item);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Get dashboard cache
 * @param {string} cacheKey 
 */
async function getDashboardCache(cacheKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('dashboardCache', 'readonly');
        const store = tx.objectStore('dashboardCache');
        const request = store.get(cacheKey);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get storage usage estimate
 */
async function getStorageEstimate() {
    if ('storage' in navigator && 'estimate' in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        return {
            usage: estimate.usage,
            quota: estimate.quota,
            usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(2)
        };
    }
    return null;
}

/**
 * Request persistent storage (prevents browser from clearing data)
 */
async function requestPersistentStorage() {
    if ('storage' in navigator && 'persist' in navigator.storage) {
        const isPersisted = await navigator.storage.persist();
        console.log(`[IndexedDB] Persistent storage: ${isPersisted ? 'granted' : 'denied'}`);
        return isPersisted;
    }
    return false;
}

/**
 * Check if IndexedDB is available
 */
function isIndexedDBAvailable() {
    return 'indexedDB' in window;
}

/**
 * Format cache age for display
 * @param {number} timestamp 
 */
function formatCacheAge(timestamp) {
    if (!timestamp) return 'unknown';
    const age = Date.now() - timestamp;
    const minutes = Math.floor(age / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
}

// ============================================
// MIGRATION FROM LOCALSTORAGE
// ============================================

/**
 * Migrate existing localStorage data to IndexedDB
 * Call once during app init, then remove localStorage keys
 */
async function migrateFromLocalStorage() {
    console.log('[IndexedDB] Checking for localStorage migration...');

    try {
        // Migrate exam cache
        const examCache = localStorage.getItem('cbt_exam_cache');
        if (examCache) {
            const exams = JSON.parse(examCache);
            if (typeof exams === 'object') {
                const examArray = Object.values(exams);
                if (examArray.length > 0) {
                    await saveExams(examArray);
                    localStorage.removeItem('cbt_exam_cache');
                    console.log(`[IndexedDB] Migrated ${examArray.length} exams from localStorage`);
                }
            }
        }

        // Migrate dashboard exams cache
        const dashboardExams = localStorage.getItem('cbt_dashboard_exams_cache');
        if (dashboardExams) {
            const parsed = JSON.parse(dashboardExams);
            if (parsed && parsed.data) {
                await saveDashboardCache('exams_list', parsed);
                localStorage.removeItem('cbt_dashboard_exams_cache');
                console.log('[IndexedDB] Migrated dashboard exams cache');
            }
        }

        // Migrate pending submissions
        const pending = localStorage.getItem('cbt_pending_submissions');
        if (pending) {
            const submissions = JSON.parse(pending);
            if (Array.isArray(submissions) && submissions.length > 0) {
                for (const sub of submissions) {
                    await queuePendingSubmission(sub);
                }
                localStorage.removeItem('cbt_pending_submissions');
                console.log(`[IndexedDB] Migrated ${submissions.length} pending submissions`);
            }
        }

        console.log('[IndexedDB] Migration complete');
    } catch (err) {
        console.error('[IndexedDB] Migration error:', err);
    }
}

// Export all functions to global scope
window.idb = {
    // Core
    openDB,
    isIndexedDBAvailable,

    // Exams
    saveExam,
    saveExams,
    getExam,
    getAllExams,
    hasExamCached,
    deleteExam,
    clearExams,

    // Results
    saveResults,
    getResultsByStudent,

    // Pending queue
    queuePendingSubmission,
    getPendingSubmissions,
    removePendingSubmission,
    clearPendingSubmissions,

    // Progress
    saveProgress,
    loadProgress,
    deleteProgress,

    // Dashboard cache
    saveDashboardCache,
    getDashboardCache,

    // Utilities
    getStorageEstimate,
    requestPersistentStorage,
    formatCacheAge,
    migrateFromLocalStorage
};

// Initialize DB on load
(async () => {
    if (isIndexedDBAvailable()) {
        try {
            await openDB();
            await migrateFromLocalStorage();
            await requestPersistentStorage();
            console.log('[IndexedDB] Ready');
        } catch (err) {
            console.error('[IndexedDB] Initialization failed:', err);
        }
    } else {
        console.warn('[IndexedDB] Not available, falling back to localStorage');
    }
})();
