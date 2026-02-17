const CACHE_NAME = 'cbt-exam-v16';
const ASSETS = [

    './',
    './index.html',
    './pages/student-dashboard.html',
    './pages/teacher-dashboard.html',
    './pages/create-exam.html',
    './pages/take-exam.html',
    './pages/results.html',
    './pages/register.html',
    './css/main.css',
    './css/auth.css',
    './css/dashboard.css',
    './css/exam.css',
    './js/idb.js',
    './js/utils.js',
    './js/dataService.js',
    './js/auth.js',
    './js/studentDashboard.js',
    './js/takeExam.js',
    './js/teacherDashboard.js',
    './js/examManager.js',
    './js/timer.js',
    './manifest.json'
];

// Install Event - Pre-cache static assets
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Install v14');
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching all: app shell and content');
            // Check protocol scheme before caching
            if (location.protocol === 'http:' || location.protocol === 'https:') {
                return cache.addAll(ASSETS).catch(err => {
                    console.warn('[SW] Some assets failed to cache:', err);
                    // Don't fail installation if some assets are missing
                    return Promise.resolve();
                });
            } else {
                console.warn('[Service Worker] Skipping cache.addAll due to unsupported scheme (likely file://)');
                return Promise.resolve();
            }
        })
    );
    // Activate immediately
    self.skipWaiting();
});

// Activate Event (Cleanup old caches + claim clients immediately)
self.addEventListener('activate', (e) => {
    console.log('[Service Worker] Activate v13');
    e.waitUntil(
        caches.keys().then((keyList) => {
            return Promise.all(keyList.map((key) => {
                if (key !== CACHE_NAME) {
                    console.log('[Service Worker] Removing old cache', key);
                    return caches.delete(key);
                }
            }));
        })
    );
    // Take control of all clients immediately
    return self.clients.claim();
});

// Fetch Event - Smart caching strategy
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // 0. Ignore non-http/https requests (file:// etc)
    if (!e.request.url.startsWith('http')) {
        return;
    }

    // 1. Handle PocketBase API requests specially
    if (e.request.url.includes('gen7-cbt-app.fly.dev') || e.request.url.includes('/api/')) {
        // BYPASS Service Worker for Realtime (SSE) and Files
        if (e.request.url.includes('/api/realtime') || e.request.url.includes('/api/files')) {
            return;
        }

        // For GET requests (fetching data), try network first then return error response

        if (e.request.method === 'GET') {
            e.respondWith(
                fetch(e.request)
                    .then(response => {
                        // Clone response for caching read-only API data
                        if (response.ok) {
                            const responseClone = response.clone();
                            caches.open(CACHE_NAME + '-api').then(cache => {
                                cache.put(e.request, responseClone);
                            });
                        }
                        return response;
                    })
                    .catch(async () => {
                        console.log('[SW] PocketBase GET failed, checking API cache:', e.request.url);
                        // Try API cache
                        const cachedResponse = await caches.match(e.request);
                        if (cachedResponse) {
                            console.log('[SW] Serving PocketBase response from cache');
                            return cachedResponse;
                        }
                        // Return offline JSON response
                        return new Response(JSON.stringify({
                            error: { message: 'Offline - no cached data available' },
                            data: null,
                            _offline: true
                        }), {
                            status: 503,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    })
            );
            return;
        }

        // For POST/PUT/DELETE (mutations), let them fail naturally
        // The app handles offline queueing in dataService
        return;
    }

    // 2. Handle CDN resources (PocketBase SDK, fonts, etc.)
    if (e.request.url.includes('unpkg.com') ||
        e.request.url.includes('fonts.googleapis.com') ||
        e.request.url.includes('fonts.gstatic.com')) {
        e.respondWith(
            caches.match(e.request).then(cached => {
                if (cached) return cached;
                return fetch(e.request).then(response => {
                    if (response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(e.request, responseClone);
                        });
                    }
                    return response;
                }).catch(() => {
                    console.warn('[SW] CDN resource unavailable offline:', e.request.url);
                    return new Response('', { status: 503 });
                });
            })
        );
        return;
    }

    // 3. App Shell & Assets: Network First, Fallback to Cache
    // This allows updates to be seen immediately if online.
    e.respondWith(
        fetch(e.request)
            .then((response) => {
                // Check if valid response
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }

                // Clone and cache updated version
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(e.request, responseToCache);
                });
                return response;
            })
            .catch(() => {
                // Network failed, use cache
                console.log('[Service Worker] Network failed, serving offline cache:', e.request.url);
                return caches.match(e.request).then(cachedResponse => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // If requesting HTML and not cached, serve index.html (SPA fallback)
                    if (e.request.destination === 'document') {
                        return caches.match('./index.html');
                    }
                    return new Response('Offline - resource not available', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain' }
                    });
                });
            })
    );
});

// Background Sync Registration
self.addEventListener('sync', (e) => {
    console.log('[SW] Background sync triggered:', e.tag);
    if (e.tag === 'sync-results' || e.tag === 'sync-pending-answers') {
        e.waitUntil(syncPendingAnswers());
    }
});

// IndexedDB access from service worker
const DB_NAME = 'cbtAppDB';
const DB_VERSION = 1;

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getPendingFromIDB() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('pendingAnswers', 'readonly');
            const store = tx.objectStore('pendingAnswers');
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.warn('[SW] Could not access IndexedDB:', err);
        return [];
    }
}

async function removePendingFromIDB(localId) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('pendingAnswers', 'readwrite');
            const store = tx.objectStore('pendingAnswers');
            const request = store.delete(localId);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.warn('[SW] Could not remove from IndexedDB:', err);
        return false;
    }
}

// Sync pending answers when back online
async function syncPendingAnswers() {
    console.log('[SW] Starting background sync of pending answers...');

    // Get pending from IndexedDB
    const pending = await getPendingFromIDB();

    if (pending.length === 0) {
        console.log('[SW] No pending submissions to sync');
        // Notify clients anyway in case they have localStorage items
        await notifyClientsToSync();
        return;
    }

    console.log(`[SW] Found ${pending.length} pending submissions`);

    // For now, notify clients to handle sync (they have Supabase credentials)
    // TODO: In future, could sync directly from SW if we pass auth tokens
    await notifyClientsToSync();
}

async function notifyClientsToSync() {
    const clients = await self.clients.matchAll({ type: 'window' });
    console.log(`[SW] Notifying ${clients.length} clients to sync`);
    clients.forEach(client => {
        client.postMessage({ type: 'SYNC_PENDING' });
    });
}

// Handle messages from main thread
self.addEventListener('message', (e) => {
    if (e.data === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (e.data === 'CHECK_UPDATE') {
        // Force update check
        self.registration.update();
    }
    if (e.data === 'TRIGGER_SYNC') {
        // Manual sync trigger
        syncPendingAnswers();
    }
});
