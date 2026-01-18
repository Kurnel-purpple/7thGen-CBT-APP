const CACHE_NAME = 'cbt-exam-v5';
const ASSETS = [
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
    './js/utils.js',
    './js/dataService.js',
    './js/auth.js',
    './js/studentDashboard.js',
    './manifest.json'
];

// Install Event
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Install');
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Service Worker] Caching all: app shell and content');
            // Check protocol scheme before caching
            if (location.protocol === 'http:' || location.protocol === 'https:') {
                return cache.addAll(ASSETS);
            } else {
                console.warn('[Service Worker] Skipping cache.addAll due to unsupported scheme (likely file://)');
                return Promise.resolve();
            }
        })
    );
});

// Activate Event (Cleanup old caches)
self.addEventListener('activate', (e) => {
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
    return self.clients.claim();
});

// Fetch Event - Network First Strategy
self.addEventListener('fetch', (e) => {
    // 0. Ignore non-http/https requests (file:// etc)
    if (!e.request.url.startsWith('http')) {
        return;
    }

    // 1. API Requests: Network Only (Supabase)
    if (e.request.url.includes('supabase.co')) {
        if (e.request.method === 'GET') {
            // Force network and disallow cache to prevent stale data
            try {
                const newReq = new Request(e.request, { cache: 'no-store' });
                e.respondWith(fetch(newReq));
            } catch (err) {
                // Fallback
                e.respondWith(fetch(e.request));
            }
        } else {
            e.respondWith(fetch(e.request));
        }
        return;
    }

    // 2. App Shell & Assets: Network First, Fallback to Cache
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
                console.log('[Service Worker] Network failed, serving offline cache: ' + e.request.url);
                return caches.match(e.request);
            })
    );
});
