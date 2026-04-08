/**
 * Student Dashboard Controller
 */

const studentDashboard = {
    user: null,
    exams: [],
    results: [],
    currentFilter: 'All',
    _refreshInterval: null,
    _visibilityListenerAdded: false,
    _realtimeSubscribed: false,
    _realtimeRefreshTimer: null,

    init: async () => {
        console.log('🚀 Student Dashboard v3.0 Loaded');
        const user = dataService.getCurrentUser();
        if (!user || user.role !== 'student') {
            window.location.href = '../index.html';
            return;
        }
        studentDashboard.user = user;
        document.getElementById('user-name').textContent = user.name;

        // Set app subtitle from config (if available)
        const appSubtitle = document.getElementById('app-subtitle');
        if (appSubtitle && window.configLoader) {
            const config = window.configLoader.getConfig();
            if (config && config.client) {
                appSubtitle.textContent = config.client.name;
            }
        }

        // Mobile Name & Menu
        const mName = document.getElementById('mobile-user-name');
        if (mName) mName.textContent = user.name;

        // Mobile Theme Toggle
        const mThemeBtn = document.getElementById('mobile-theme-toggle');
        if (mThemeBtn) {
            const currentTheme = localStorage.getItem('theme') || 'light';
            mThemeBtn.innerHTML = currentTheme === 'dark' ? '☀️' : '🌙';
            mThemeBtn.onclick = () => {
                const curr = document.documentElement.getAttribute('data-theme');
                const next = curr === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('theme', next);
                mThemeBtn.innerHTML = next === 'dark' ? '☀️' : '🌙';

                // Update desktop toggle if it exists
                const dToggle = document.getElementById('theme-toggle');
                if (dToggle) dToggle.innerHTML = next === 'dark' ? '☀️' : '🌙';
            };
        }

        // Filters
        const onFilterChange = (e) => studentDashboard.setFilter(e.target.value);
        const dFilter = document.getElementById('desktop-subject-filter');
        const mFilter = document.getElementById('mobile-subject-filter');
        if (dFilter) dFilter.onchange = onFilterChange;
        if (mFilter) mFilter.onchange = onFilterChange;

        await studentDashboard.loadData();
        studentDashboard.setupConnectionMonitoring();
        studentDashboard.setupRealtimeExamSync();
    },

    setupConnectionMonitoring: () => {
        const updateStatus = () => {
            const isOnline = navigator.onLine;
            let el = document.getElementById('connection-status');
            if (!el) {
                el = document.createElement('div');
                el.id = 'connection-status';
                el.style.position = 'fixed';
                el.style.top = '10px';
                el.style.right = '120px';
                el.style.zIndex = '2000';
                el.style.padding = '5px 10px';
                el.style.borderRadius = '20px';
                el.style.fontSize = '0.8rem';
                el.style.fontWeight = 'bold';
                el.style.transition = 'opacity 0.3s ease';
                document.body.appendChild(el);
            }

            if (isOnline) {
                el.textContent = '● Online';
                el.style.backgroundColor = '#d4edda';
                el.style.color = '#155724';
                el.style.border = '1px solid #c3e6cb';
                el.style.opacity = '1';
                // fade out after 5s
                setTimeout(() => { if (el) el.style.opacity = '0'; }, 5000);
            } else {
                el.textContent = '● Offline';
                el.style.backgroundColor = '#f8d7da';
                el.style.color = '#721c24';
                el.style.border = '1px solid #f5c6cb';
                el.style.opacity = '1';
            }
        };

        // Online/Offline event listeners
        window.addEventListener('online', async () => {
            console.log('📶 Back online! Syncing data...');
            studentDashboard.teardownRealtimeExamSync();
            updateStatus();
            await studentDashboard.setupRealtimeExamSync();

            // Sync pending results
            await studentDashboard.syncResults();

            // Reload fresh data from server
            setTimeout(() => {
                studentDashboard.loadData();
            }, 1500);
        });

        window.addEventListener('offline', () => {
            console.log('📴 Gone offline');
            updateStatus();
            studentDashboard.teardownRealtimeExamSync();
            studentDashboard.showOfflineNotice('You are offline. Showing cached data.');
        });

        // Listen for service worker sync messages
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'SYNC_PENDING') {
                    console.log('📡 Received sync request from service worker');
                    studentDashboard.syncResults();
                }
            });
        }

        // Initial Check
        updateStatus();

        // Initial Sync Attempt
        if (navigator.onLine) {
            setTimeout(studentDashboard.syncResults, 2000);
        }
    },

    _queueRealtimeRefresh: (reason = 'exam_change') => {
        if (studentDashboard._realtimeRefreshTimer) {
            clearTimeout(studentDashboard._realtimeRefreshTimer);
        }

        studentDashboard._realtimeRefreshTimer = setTimeout(() => {
            studentDashboard._realtimeRefreshTimer = null;
            console.log(`[RealtimeRefresh] Reloading dashboard after ${reason}`);
            studentDashboard.loadData();
        }, 800);
    },

    teardownRealtimeExamSync: () => {
        studentDashboard._realtimeSubscribed = false;
        if (studentDashboard._realtimeRefreshTimer) {
            clearTimeout(studentDashboard._realtimeRefreshTimer);
            studentDashboard._realtimeRefreshTimer = null;
        }
        dataService.unsubscribeFromExams().catch(() => {});
    },

    setupRealtimeExamSync: async () => {
        if (studentDashboard._realtimeSubscribed) return;

        try {
            await dataService.unsubscribeFromExams().catch(() => {});
            await dataService.subscribeToExams((event) => {
                const exam = event.record || {};
                const userClass = (studentDashboard.user?.classLevel || '').trim();
                const targetClass = (exam.target_class || exam.targetClass || 'All').trim();
                const relevantToStudent = targetClass === 'All' || (userClass && targetClass === userClass);

                if (!relevantToStudent) return;

                console.log(
                    `[RealtimeRefresh] Exam ${event.action || 'update'} received for ${exam.id || 'unknown'}`
                );
                studentDashboard._queueRealtimeRefresh(`exam_${event.action || 'update'}`);
            });

            studentDashboard._realtimeSubscribed = true;
            window.addEventListener('beforeunload', () => {
                studentDashboard.teardownRealtimeExamSync();
            }, { once: true });
        } catch (error) {
            studentDashboard._realtimeSubscribed = false;
            console.warn('[RealtimeRefresh] Exam subscription unavailable, using polling/focus refresh only', error);
        }
    },

    syncResults: async () => {
        const { synced, pending } = await dataService.syncPendingResults();
        if (synced > 0) {
            const el = document.getElementById('connection-status');
            if (el) {
                el.textContent = `Syncing... (${synced} sent)`;
                el.style.backgroundColor = '#ffeeba';
                el.style.color = '#856404';
                el.style.opacity = '1';
                setTimeout(() => {
                    el.textContent = '● Synced';
                    el.style.backgroundColor = '#d4edda';
                    el.style.color = '#155724';
                    // Reload data to show updated results/history
                    studentDashboard.loadData();
                }, 1500);
            }
        }
    },

    // V2B+V2D: Check server version and determine if cache is stale
    // Checks BOTH class-specific AND _global feed keys to catch all mutations
    _checkVersionStale: async () => {
        const userClass = studentDashboard.user?.classLevel;
        const feedKeys = [];
        if (userClass) feedKeys.push(`student_exam_feed:${userClass}`);
        feedKeys.push('student_exam_feed:_global');

        let anyNull = true; // assume null until proven otherwise
        for (const feedKey of feedKeys) {
            const cacheKey = `dashboard_version_${feedKey}`;
            try {
                const serverVersion = await dataService.getDashboardVersion(feedKey);
                if (serverVersion === null) {
                    console.warn(`[VersionCheck] Version unavailable for ${feedKey}`);
                    continue; // try next key
                }
                anyNull = false;
                const cachedVersion = parseInt(localStorage.getItem(cacheKey) || '0', 10);
                if (serverVersion !== cachedVersion) {
                    console.log(`[VersionCheck] Version changed for ${feedKey}: ${cachedVersion} -> ${serverVersion}`);
                    localStorage.setItem(cacheKey, String(serverVersion));
                    return true; // stale — at least one key changed
                }
            } catch (e) {
                console.warn(`[VersionCheck] Check failed for ${feedKey}:`, e);
                continue;
            }
        }
        // If ALL version checks returned null (403/error), treat as stale to force refresh
        if (anyNull) {
            console.warn('[VersionCheck] All version checks unavailable, forcing refresh');
            return true;
        }
        return false; // all keys matched — fresh
    },

    loadData: async () => {
        const userId = studentDashboard.user.id;
        const userClass = (studentDashboard.user.classLevel || '').trim();
        const useIndexedDB = window.idb && window.idb.isIndexedDBAvailable();
        const examsCacheKey = `exams_list:${userClass || 'global'}`;
        const localStorageExamsCacheKey = `cbt_dashboard_exams_cache:${userClass || 'global'}`;

        let exams = [];
        let serverResults = [];
        let isUsingCache = false;

        // Force refresh if returning from exam submission
        let forceRefresh = false;
        if (sessionStorage.getItem('force_refresh_dashboard') === '1') {
            sessionStorage.removeItem('force_refresh_dashboard');
            forceRefresh = true;
        }

        // V2B+V2D: Check if dashboard version changed — if so, force refresh
        if (!forceRefresh && navigator.onLine) {
            try {
                forceRefresh = await studentDashboard._checkVersionStale();
                if (forceRefresh) console.log('[ExamRefresh] Version stale on initial load, forcing network fetch');
            } catch (e) {
                forceRefresh = true; // on error, force refresh to be safe
                console.warn('[ExamRefresh] Version check error, forcing refresh');
            }
        }

        // V2D: Sync trusted server time in parallel with data fetch (non-blocking)
        if (navigator.onLine) {
            dataService.syncServerTime().catch(() => {});
        }

        try {
            // Attempt to fetch from server with optimizations
            [exams, serverResults] = await Promise.all([
                dataService.getExamSummaries({
                    status: 'active',
                    studentDashboard: true,
                    ...(userClass && { targetClass: userClass }),
                    ...(forceRefresh && { forceRefresh: true })
                }),
                userId
                    ? dataService.getResultSummaries({
                        studentId: userId,
                        studentDashboard: true,
                        forceRefresh: true
                    })
                    : Promise.resolve([])
            ]);

            // SUCCESS! Cache the fresh data for offline fallback
            try {
                if (useIndexedDB) {
                    // Save summaries to dashboard cache only — NOT to entity stores (exams/results)
                    // Summaries have questions:null / answers:null and would pollute full-entity stores
                    await window.idb.saveDashboardCache(examsCacheKey, exams);
                    await window.idb.saveDashboardCache(`results_${userId}`, serverResults);
                    console.log('✅ Dashboard data cached to IndexedDB');
                } else {
                    // Fallback to localStorage
                    localStorage.setItem(localStorageExamsCacheKey, JSON.stringify({
                        data: exams,
                        timestamp: Date.now()
                    }));
                    localStorage.setItem(`cbt_dashboard_results_${userId}`, JSON.stringify({
                        data: serverResults,
                        timestamp: Date.now()
                    }));
                    console.log('✅ Dashboard data cached to localStorage');
                }
            } catch (cacheErr) {
                console.warn('Could not cache dashboard data:', cacheErr);
            }

        } catch (err) {
            console.warn('⚠️ Network issue loading data:', err.message);

            // FALLBACK: Try to use cached data
            try {
                if (useIndexedDB) {
                    // Try IndexedDB first
                    const cachedExams = await window.idb.getDashboardCache(examsCacheKey);
                    const cachedResults = await window.idb.getDashboardCache(`results_${userId}`);

                    if (cachedExams && cachedExams.data && Array.isArray(cachedExams.data) && cachedExams.data.length > 0) {
                        exams = cachedExams.data;
                        isUsingCache = true;
                        console.log(`📦 Loaded ${exams.length} exams from IndexedDB cache`);
                    } else {
                        // Try getting all exams from IndexedDB
                        const allExams = await window.idb.getAllExams();
                        if (allExams && allExams.length > 0) {
                            exams = allExams;
                            isUsingCache = true;
                            console.log(`📦 Loaded ${exams.length} exams from IndexedDB cache`);
                        }
                    }

                    if (cachedResults && cachedResults.data && Array.isArray(cachedResults.data) && cachedResults.data.length > 0) {
                        serverResults = cachedResults.data;
                        console.log(`📦 Loaded ${serverResults.length} results from IndexedDB`);
                    } else {
                        // Try getting results by student
                        const idbResults = await window.idb.getResultsByStudent(userId);
                        if (idbResults && idbResults.length > 0) {
                            serverResults = idbResults;
                            console.log(`📦 Loaded ${serverResults.length} results from IndexedDB`);
                        }
                    }
                } else {
                    // Fallback to localStorage
                    const cachedExams = JSON.parse(localStorage.getItem(localStorageExamsCacheKey) || 'null');
                    const cachedResults = JSON.parse(localStorage.getItem(`cbt_dashboard_results_${userId}`) || 'null');

                    if (cachedExams && cachedExams.data) {
                        exams = cachedExams.data;
                        isUsingCache = true;
                        console.log(`📦 Loaded ${exams.length} exams from localStorage`);
                    }

                    if (cachedResults && cachedResults.data) {
                        serverResults = cachedResults.data;
                        console.log(`📦 Loaded ${serverResults.length} results from localStorage`);
                    }
                }

                if (isUsingCache) {
                    studentDashboard.showOfflineNotice('Showing cached data. Some info may be outdated.');
                }
            } catch (cacheLoadErr) {
                console.error('Failed to load from cache:', cacheLoadErr);
            }

            // If still no data, show empty state with retry option
            if (exams.length === 0) {
                studentDashboard.showOfflineNotice('Unable to load exams. Check your network and try again.', true);
            }
        }

        // Merge with Pending Submissions (from IndexedDB or localStorage)
        let myPending = [];
        try {
            if (useIndexedDB) {
                const allPending = await window.idb.getPendingSubmissions();
                myPending = allPending.filter(p => p.student_id === userId || p.studentId === userId);
            } else {
                const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
                myPending = pending.filter(p => p.student_id === userId);
            }
        } catch (pendingErr) {
            console.warn('Could not load pending submissions:', pendingErr);
        }

        // Map pending to match result structure
        const mappedPending = myPending.map(p => ({
            id: p.localId || p._local_id || 'pending-' + Date.now(),
            examId: p.exam_id || p.examId,
            studentId: p.student_id || p.studentId,
            score: p.score,
            totalPoints: p.total_points || p.totalPoints,
            answers: p.answers,
            submittedAt: p.submitted_at || p.submittedAt,
            studentName: studentDashboard.user.name,
            passed: p.score >= (p.pass_score || p.passScore || 50),
            isPending: true
        }));

        // Combine results
        studentDashboard.results = [...mappedPending, ...serverResults];

        studentDashboard.exams = exams;
        studentDashboard.populateSubjectFilters();
        studentDashboard.renderAvailable();
        studentDashboard.renderResolved();

        studentDashboard.renderCompleted();

        // --- Background refresh function (reused for initial + periodic + visibility) ---
        const backgroundRefresh = async () => {
            if (!navigator.onLine) return;
            try {
                // V2B: Check version to decide force refresh vs normal fetch
                let forceNet = false;
                try {
                    forceNet = await studentDashboard._checkVersionStale();
                } catch (e) {
                    forceNet = true; // on error, force refresh to be safe
                }

                if (forceNet) {
                    console.log('[ExamRefresh] Version stale or unavailable, forcing network fetch');
                }

                // Always fetch — version check determines forceRefresh flag.
                // Even without forceRefresh, the 2-min IDB cache TTL ensures fresh data
                // within 2 minutes of any admin change.
                const [freshExams, freshResults] = await Promise.all([
                    dataService.getExamSummaries({
                        status: 'active',
                        studentDashboard: true,
                        ...(userClass && { targetClass: userClass }),
                        ...(forceNet && { forceRefresh: true })
                    }),
                    userId ? dataService.getResultSummaries({ studentId: userId, studentDashboard: true, forceRefresh: true }) : []
                ]);

                // Guard: Do NOT overwrite good data with an empty response
                if (studentDashboard.exams.length > 0 && freshExams.length === 0) {
                    console.warn('[ExamRefresh] Background refresh returned 0 exams — keeping cached data');
                    return;
                }

                // Detect schedule changes and log them
                for (const freshExam of freshExams) {
                    const oldExam = studentDashboard.exams.find(e => e.id === freshExam.id);
                    if (oldExam && oldExam.scheduledDate !== freshExam.scheduledDate) {
                        console.log(`[ScheduleUpdate] Schedule changed for exam ${freshExam.id}: "${oldExam.scheduledDate}" -> "${freshExam.scheduledDate}"`);
                    }
                }

                // Update dashboard cache with FRESH summaries only — NOT entity stores
                if (window.idb) {
                    if (freshExams.length > 0) {
                        await window.idb.saveDashboardCache(examsCacheKey, freshExams);
                    }
                    if (freshResults.length > 0) {
                        await window.idb.saveDashboardCache(`results_${userId}`, freshResults);
                    }
                }

                // Update UI with fresh data
                studentDashboard.results = [...mappedPending, ...freshResults];
                studentDashboard.exams = freshExams;

                studentDashboard.populateSubjectFilters();
                studentDashboard.renderAvailable();
                studentDashboard.renderResolved();
                studentDashboard.renderCompleted();
                console.log(`[ExamRefresh] Fetched fresh exams: ${freshExams.length}`);

            } catch (e) { console.warn('[ExamRefresh] Background refresh failed', e); }
        };

        // Periodic background refresh every 2 minutes (matches cache TTL)
        if (studentDashboard._refreshInterval) clearInterval(studentDashboard._refreshInterval);
        studentDashboard._refreshInterval = setInterval(backgroundRefresh, 2 * 60 * 1000);

        // V2B+V2D: Smart refresh on tab focus / visibility change (debounced 5s)
        if (!studentDashboard._visibilityListenerAdded) {
            studentDashboard._visibilityListenerAdded = true;
            let lastVisRefresh = 0;
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && navigator.onLine) {
                    const now = Date.now();
                    if (now - lastVisRefresh < 5000) return; // debounce 5s
                    lastVisRefresh = now;
                    if (!studentDashboard._realtimeSubscribed) {
                        studentDashboard.setupRealtimeExamSync().catch(() => {});
                    }
                    // V2D: Re-sync trusted time on visibility change
                    dataService.syncServerTime().catch(() => {});
                    backgroundRefresh();
                }
            });
        }
    },

    // Helper to format cache age
    _formatCacheAge: (timestamp) => {
        if (!timestamp) return 'unknown time ago';
        const age = Date.now() - timestamp;
        const minutes = Math.floor(age / 60000);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) return `${hours}h ago`;
        if (minutes > 0) return `${minutes}m ago`;
        return 'just now';
    },

    // Show offline/cache notice
    showOfflineNotice: (message, showRetry = false) => {
        // Remove any existing notice
        const existing = document.getElementById('offline-notice');
        if (existing) existing.remove();

        const notice = document.createElement('div');
        notice.id = 'offline-notice';
        notice.style.cssText = `
            position: fixed;
            top: 60px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #fff3cd, #ffe69c);
            color: #856404;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.15);
            z-index: 10000;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 12px;
            max-width: 90%;
            text-align: center;
            animation: slideDown 0.3s ease;
        `;

        let html = `<span>${message}</span>`;
        if (showRetry) {
            html += `<button onclick="studentDashboard.retryLoad()" style="
                background: #856404;
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.85rem;
            ">🔄 Retry</button>`;
        }
        html += `<button onclick="this.parentElement.remove()" style="
            background: none;
            border: none;
            font-size: 1.2rem;
            cursor: pointer;
            color: #856404;
            padding: 0 4px;
        ">×</button>`;

        notice.innerHTML = html;
        document.body.appendChild(notice);

        // Auto-hide after 8 seconds if no retry needed
        if (!showRetry) {
            setTimeout(() => {
                if (notice.parentElement) {
                    notice.style.opacity = '0';
                    notice.style.transform = 'translateX(-50%) translateY(-20px)';
                    notice.style.transition = 'all 0.3s ease';
                    setTimeout(() => notice.remove(), 300);
                }
            }, 8000);
        }
    },

    // Retry loading data
    retryLoad: async () => {
        const notice = document.getElementById('offline-notice');
        if (notice) {
            notice.innerHTML = `<span>🔄 Retrying...</span>`;
        }
        await studentDashboard.loadData();
    },

    // Explicit offline prefetch helper (final definition)
    preloadExamsForOffline: async (examId) => {
        if (!navigator.onLine) return;
        if (!window.idb || !window.idb.isIndexedDBAvailable()) return;

        const exam = studentDashboard.exams.find(e => e.id === examId);
        if (!exam) return;

        try {
            const cached = await window.idb.getExam(exam.id);
            if (cached && cached.questions && cached.questions.length > 0) {
                return;
            }

            const fullExam = await dataService.getExamById(exam.id, exam.updatedAt);
            if (fullExam && fullExam.questions) {
                await window.idb.saveExam(fullExam);
                console.log(`[OfflinePrefetch] Cached exam ${exam.id} for offline use`);
            }
        } catch (err) {
            console.warn(`Could not preload exam ${exam.id}:`, err.message);
        }
    },

    // Register background sync if supported
    registerBackgroundSync: async () => {
        if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
            console.warn('Background Sync not supported – using online event fallback');
            return false;
        }

        try {
            const reg = await navigator.serviceWorker.ready;
            await reg.sync.register('sync-pending-answers');
            console.log('📡 Background sync registered');
            return true;
        } catch (err) {
            console.warn('Sync registration failed:', err);
            return false;
        }
    },

    switchTab: (tab) => {
        // Map 'flagged' to internal 'resolved' section
        const sectionTab = tab === 'flagged' ? 'resolved' : tab;

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => {
            if (b.textContent.toLowerCase().includes(tab)) b.classList.add('active');
        });

        // Also update bottom nav active state
        document.querySelectorAll('.bottom-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.bottom-nav-item').forEach(b => {
            if (b.textContent.toLowerCase().includes(tab === 'available' ? 'exams' : tab)) b.classList.add('active');
        });

        // Hide all sections
        document.getElementById('available-exams-section').style.display = 'none';
        document.getElementById('resolved-exams-section').style.display = 'none';
        document.getElementById('completed-exams-section').style.display = 'none';

        const df = document.querySelector('.desktop-filter');

        if (tab === 'available') {
            document.getElementById('available-exams-section').style.display = 'block';
            if (df) df.style.visibility = 'visible';
        } else if (tab === 'flagged') {
            document.getElementById('resolved-exams-section').style.display = 'block';
            if (df) df.style.visibility = 'hidden';
        } else if (tab === 'completed') {
            document.getElementById('completed-exams-section').style.display = 'block';
            if (df) df.style.visibility = 'hidden';
        }
    },

    populateSubjectFilters: () => {
        const subjects = ['All', ...new Set(studentDashboard.exams.map(e => e.subject))];
        const opts = subjects.map(s => `<option value="${s}">${s === 'All' ? 'All Subjects' : s}</option>`).join('');

        const dFilter = document.getElementById('desktop-subject-filter');
        const mFilter = document.getElementById('mobile-subject-filter');
        if (dFilter) dFilter.innerHTML = opts;
        if (mFilter) mFilter.innerHTML = opts;
    },

    setFilter: (subject) => {
        studentDashboard.currentFilter = subject;

        // Sync UIs
        const dFilter = document.getElementById('desktop-subject-filter');
        const mFilter = document.getElementById('mobile-subject-filter');
        if (dFilter) dFilter.value = subject;
        if (mFilter) mFilter.value = subject;

        studentDashboard.renderAvailable();
    },

    renderAvailable: () => {
        const now = new Date();
        const grid = document.getElementById('available-grid');
        let html = '';

        // --- 1. Find Action Items (Unresolved Flags with active deadline) ---
        const actionItems = studentDashboard.results.filter(r => {
            if (!r.flags) return false;
            const flagEntries = Object.entries(r.flags).filter(([k, v]) => !k.startsWith('_'));

            // Check if any flag is resolved and active
            const hasActive = flagEntries.some(([k, f]) =>
                f && typeof f === 'object' && f.status === 'resolved' && new Date(f.deadline) > now
            );

            if (hasActive) {
                console.log(`🚩 Action Required found in result ${r.id} for exam ${r.examId}`, r.flags);
            }
            return hasActive;
        });

        // --- 2. Find Resolved Flags (All flags addressed, no active deadlines) ---
        const resolvedItems = studentDashboard.results.filter(r => {
            if (!r.flags) return false;
            const flagEntries = Object.entries(r.flags);
            // Ignore internal status flags like _status or _started_at
            const userFlags = flagEntries.filter(([k, v]) => !k.startsWith('_'));
            if (userFlags.length === 0) return false;

            // Check if there are any addressed flags (Accepted or Expired)
            const hasAnyAddressed = userFlags.some(([k, v]) =>
                v && typeof v === 'object' && (v.status === 'accepted' || (v.status === 'resolved' && new Date(v.deadline) <= now))
            );

            // Check if there are NO active/pending flags
            const hasNoActiveFlags = !userFlags.some(([k, v]) =>
                v && typeof v === 'object' && v.status === 'resolved' && new Date(v.deadline) > now
            );

            const isResolved = hasAnyAddressed && hasNoActiveFlags;
            if (isResolved) {
                console.log(`✅ Resolved item found: result ${r.id} (Exam: ${r.examId})`, r.flags);
            }
            return isResolved;
        });

        // --- Render Action Required Section ---
        if (actionItems.length > 0) {
            html += `<h3 style="width:100%; color: var(--accent-color); margin-bottom: 15px;">Action Required</h3>`;
            html += actionItems.map(result => {
                const exam = studentDashboard.exams.find(e => e.id === result.examId) || { title: 'Unknown Exam', subject: 'N/A' };
                const deadlines = Object.values(result.flags)
                    .filter(f => f && f.status === 'resolved' && !f._status)
                    .map(f => new Date(f.deadline));

                if (deadlines.length === 0) return ''; // Should not happen given filter

                const minDeadline = new Date(Math.min(...deadlines));
                const timeLeft = Math.round((minDeadline - now) / 60000);

                return `
                <div class="exam-list-item action-required" onclick="studentDashboard.reviewExam('${result.examId}', '${result.id}')">
                    <div class="exam-list-icon" style="background: var(--accent-color);">
                        <i class="fas fa-exclamation-triangle" style="color: white;"></i>
                    </div>
                    <div class="exam-list-info">
                        <div class="exam-list-title" style="font-size:1.05rem; font-weight:800; color:var(--text-color);">${exam.subject}</div>
                        <div class="exam-list-subtitle">${exam.title} · Action Required · ${timeLeft}m left</div>
                    </div>
                    <div class="exam-list-status">
                        <span class="status-dot" style="background: var(--accent-color);"></span>
                    </div>
                </div>
                `;
            }).join('');
            html += `<div style="width:100%; height: 2px; background: #eee; margin: 20px 0;"></div>`;
            html += `<h3 style="width:100%; margin-bottom: 15px;">Available Exams</h3>`;
        }

        // --- 2. Render Normal Available Exams ---
        // Only exclude exams with completed results — allow in-progress exams back so students can continue
        const completedExamIds = new Set(
            studentDashboard.results
                .filter(r => r.status !== 'in-progress')
                .map(r => String(r.examId))
        );
        const inProgressResults = studentDashboard.results.filter(r => r.status === 'in-progress');
        const userClass = studentDashboard.user.classLevel;

        const available = studentDashboard.exams.filter(e => {
            if (completedExamIds.has(String(e.id))) {
                return false;
            }
            if (e.status === 'draft' || e.status === 'archived') {

                return false;
            }

            const filter = studentDashboard.currentFilter || 'All';
            if (filter !== 'All' && e.subject !== filter) {
                console.log(`  ❌ Subject filter mismatch`);
                return false;
            }

            const targetClass = (e.targetClass || 'All').trim();
            const uClass = (userClass || '').trim();



            if (targetClass !== 'All') {
                if (!uClass) {

                    return false;
                }
                if (targetClass !== uClass) {

                    return false;
                }
            }

            return true;
        });

        // Update Badge (Available + Action Items, excluding resolved)
        const badge = document.getElementById('available-count');
        if (badge) badge.textContent = available.length + actionItems.length;

        if (available.length === 0 && actionItems.length === 0 && resolvedItems.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>No exams available at the moment.</p>
                </div>`;
            return;
        }

        // V2D: Sort using centralized resolver — available exams first, then scheduled by date
        available.sort((a, b) => {
            const aAvail = dataService.resolveExamAvailability(a);
            const bAvail = dataService.resolveExamAvailability(b);
            const aLocked = !aAvail.available && aAvail.scheduledAt;
            const bLocked = !bAvail.available && bAvail.scheduledAt;
            if (aLocked && !bLocked) return 1;
            if (!aLocked && bLocked) return -1;
            if (aLocked && bLocked) return aAvail.scheduledAt - bAvail.scheduledAt;
            return 0;
        });

        html += available.map(exam => {
            // V2D: Use centralized resolver — no raw Date comparisons
            const availability = dataService.resolveExamAvailability(exam);
            const isScheduled = !availability.available && (availability.reason === 'scheduled_future' || availability.reason === 'no_trusted_time_future_locked');
            const scheduledDate = availability.scheduledAt;
            const isInProgress = inProgressResults.some(r => String(r.examId) === String(exam.id));

            let scheduleInfo = '';
            let actionButton = '';
            let iconBg = 'var(--primary-color)';
            let iconLabel = 'A';

            if (isInProgress) {
                iconBg = '#f0ad4e';
                iconLabel = 'C';
            } else if (isScheduled) {
                iconBg = 'var(--light-text)';
                iconLabel = 'S';
            }

            if (isScheduled && !isInProgress) {
                const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                const formattedDate = scheduledDate ? scheduledDate.toLocaleDateString('en-US', options) : 'Scheduled';
                const verifyNote = availability.reason === 'no_trusted_time_future_locked'
                    ? ' <span style="font-size:0.65rem; opacity:0.7;">(verifying time...)</span>' : '';
                scheduleInfo = `<span style="color: var(--accent-color); display:inline-flex; align-items:center; gap:4px; font-size:0.72rem;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${formattedDate}${verifyNote}</span>`;
                actionButton = `<button class="btn" style="width: 100%; background: #EA4335; color: white; cursor: not-allowed; display:inline-flex; align-items:center; justify-content:center; gap:6px; opacity:0.85;" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg> Available ${formattedDate}</button>`;
            } else {
                actionButton = `<button class="btn" onclick="studentDashboard.startExam('${exam.id}')" style="width: 100%; background: ${isInProgress ? '#f0ad4e' : '#28a745'}; color: white;">${isInProgress ? 'Continue Exam' : 'Start Exam'}</button>`;
            }

            const qCount = exam.questionCount || 0;

            return `
            <div class="exam-list-item ${isScheduled && !isInProgress ? 'scheduled' : ''}" data-exam-id="${exam.id}" onclick="studentDashboard.selectExam('${exam.id}', 'available')">
                <div class="exam-list-icon">
                    <span style="width:36px;height:36px;border-radius:50%;background:${iconBg};color:#fff;display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;flex-shrink:0;">${iconLabel}</span>
                </div>
                <div class="exam-list-info" style="flex:1; min-width:0;">
                    <div class="exam-list-title" style="font-size:1.05rem; font-weight:800; color:var(--text-color);">${exam.subject}</div>
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div class="exam-list-subtitle" style="font-size:0.78rem; color:var(--light-text); font-weight:400;">${exam.title}${isInProgress ? ' · In Progress' : ''}</div>
                        <div style="font-size:0.72rem; color:var(--light-text); white-space:nowrap; margin-left:8px;">${qCount} Qs · ${exam.duration}m</div>
                    </div>
                    ${scheduleInfo ? '<div style="margin-top:2px;">' + scheduleInfo + '</div>' : ''}
                </div>
            </div>
        `}).join('');

        grid.innerHTML = html;
    },

    renderResolved: () => {
        const now = new Date();
        const grid = document.getElementById('resolved-grid');

        // Find Resolved Flags (All flags addressed, no active deadlines)
        const resolvedItems = studentDashboard.results.filter(r => {
            if (!r.flags) return false;
            const flagEntries = Object.entries(r.flags);
            // Ignore internal status flags
            const userFlags = flagEntries.filter(([k, v]) => !k.startsWith('_'));
            if (userFlags.length === 0) return false;

            // Check if there are any addressed flags (Accepted or Expired)
            const hasAnyAddressed = userFlags.some(([k, v]) =>
                v && typeof v === 'object' && (v.status === 'accepted' || (v.status === 'resolved' && new Date(v.deadline) <= now))
            );

            // Check if there are NO active/pending flags
            const hasNoActiveFlags = !userFlags.some(([k, v]) =>
                v && typeof v === 'object' && v.status === 'resolved' && new Date(v.deadline) > now
            );

            return hasAnyAddressed && hasNoActiveFlags;
        });

        // Update Badge
        const badge = document.getElementById('resolved-count');
        if (badge) badge.textContent = resolvedItems.length;

        // Update bottom nav badge
        const bottomBadge = document.getElementById('bottom-flagged-count');
        if (bottomBadge) {
            bottomBadge.textContent = resolvedItems.length;
            bottomBadge.classList.toggle('has-count', resolvedItems.length > 0);
        }

        if (resolvedItems.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>No resolved flags yet.</p>
                </div>`;
            return;
        }

        grid.innerHTML = resolvedItems.map(result => {
            const liveExam = studentDashboard.exams.find(e => e.id === result.examId);
            const exam = liveExam || {
                title: result.examTitle || 'Unknown Exam',
                subject: result.examSubject || 'N/A'
            };

            // Calculate points if not stored (for backward compatibility)
            const totalPoints = result.totalPoints || 100;
            const points = result.points !== undefined ? result.points : Math.round((result.score / 100) * totalPoints);

            return `
            <div class="exam-list-item resolved" data-result-id="${result.id}" onclick="window.location.href='results.html?id=${result.id}'">
                <div class="exam-list-icon" style="background: rgba(40, 167, 69, 0.15); color: var(--success-color);">
                    <i class="fas fa-check-circle"></i>
                </div>
                <div class="exam-list-info">
                    <div class="exam-list-title" style="font-size:1.05rem; font-weight:800; color:var(--text-color);">${exam.subject}</div>
                    <div class="exam-list-subtitle">${exam.title} · Resolved · ${points}/${totalPoints} pts</div>
                </div>
                <div class="exam-list-status">
                    <span class="status-dot" style="background: var(--success-color);"></span>
                </div>
            </div>
            `;
        }).join('');
    },

    renderCompleted: () => {
        const grid = document.getElementById('completed-grid');

        // Filter to only show completed results (exclude in-progress entries)
        const completedResults = studentDashboard.results.filter(r => {
            // Check if result has the _status flag set to 'completed'
            // or if it doesn't have _status at all (legacy results)
            if (r.flags && r.flags._status === 'in-progress') {
                return false; // Exclude in-progress results
            }
            return true; // Include completed results
        });

        // Update Badge
        const badge = document.getElementById('history-count');
        if (badge) badge.textContent = completedResults.length;

        // Update bottom nav badge
        const bottomBadge = document.getElementById('bottom-completed-count');
        if (bottomBadge) {
            bottomBadge.textContent = completedResults.length;
            bottomBadge.classList.toggle('has-count', completedResults.length > 0);
        }

        if (completedResults.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>You haven't completed any exams yet.</p>
                </div>`;
            return;
        }

        grid.innerHTML = completedResults.map(result => {
            const liveExam = studentDashboard.exams.find(e => e.id === result.examId);
            const exam = liveExam || {
                title: result.examTitle || 'Unknown Exam',
                subject: result.examSubject || 'N/A',
                duration: result.examDuration,
                hasTheory: result.examHasTheory,
                theoryCount: result.examTheoryCount
            };
            const isPass = result.score >= (result.passScore || 50);

            const totalPoints = result.totalPoints || 100;
            const points = result.points !== undefined ? result.points : Math.round((result.score / 100) * totalPoints);

            const hasTheoryQuestions = exam.hasTheory || false;
            const theoryScores = result.theoryScores || {};
            const gradedCount = Object.keys(theoryScores).length;
            const theoryTotal = exam.theoryCount || 0;
            const allTheoryGraded = theoryTotal > 0 && gradedCount >= theoryTotal;
            const pendingGrading = hasTheoryQuestions && !allTheoryGraded;

            const statusDotColor = isPass ? 'var(--success-color)' : 'var(--accent-color)';
            const theoryLabel = hasTheoryQuestions ? (pendingGrading ? ` · Theory ${gradedCount}/${theoryTotal}` : '') : '';

            return `
            <div class="exam-list-item completed" data-result-id="${result.id}" onclick="window.location.href='results.html?id=${result.id}'">
                <div class="exam-list-icon" style="color: ${statusDotColor};">
                    <i class="fas ${isPass ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                </div>
                <div class="exam-list-info">
                    <div class="exam-list-title" style="font-size:1.05rem; font-weight:800; color:var(--text-color);">${exam.subject}</div>
                    <div class="exam-list-subtitle">${exam.title} · ${points}/${totalPoints} pts${theoryLabel}</div>
                </div>
                <div class="exam-list-status">
                    <span class="status-dot" style="background: ${statusDotColor};" title="${isPass ? 'Passed' : 'Failed'}"></span>
                </div>
            </div>
            `;
        }).join('');
    },

    // Three-panel layout: select an exam to show in center + right panels

    selectExam: (examId, tab) => {
        const exam = studentDashboard.exams.find(e => e.id === examId);
        if (!exam) return;

        // Highlight selected row
        document.querySelectorAll('.exam-list-item').forEach(el => el.classList.remove('selected'));
        const selected = document.querySelector(`.exam-list-item[data-exam-id="${examId}"]`);
        if (selected) selected.classList.add('selected');

        // Populate center panel
        const centerContent = document.getElementById('panel-center-content');
        const centerEmpty = document.getElementById('panel-center-empty');
        if (centerEmpty) centerEmpty.style.display = 'none';
        if (centerContent) {
            centerContent.style.display = 'block';

            // V2D: Use centralized resolver
            const availability = dataService.resolveExamAvailability(exam);
            const isScheduled = !availability.available && (availability.reason === 'scheduled_future' || availability.reason === 'no_trusted_time_future_locked');
            const scheduledDate = availability.scheduledAt;
            const isInProgress = studentDashboard.results.some(r => r.examId === examId && r.status === 'in-progress');
            let ctaHtml = '';

            if (isScheduled && !isInProgress) {
                const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                const formattedDate = scheduledDate ? scheduledDate.toLocaleDateString('en-US', options) : 'Scheduled';
                const verifyNote = availability.reason === 'no_trusted_time_future_locked'
                    ? ' (verifying time...)' : '';
                ctaHtml = `<button class="btn btn-start-exam" disabled style="background: #EA4335; color: white; opacity: 0.85; cursor: not-allowed;">Available ${formattedDate}${verifyNote}</button>`;
            } else {
                ctaHtml = `<button class="btn btn-start-exam" onclick="studentDashboard.startExam('${exam.id}')" style="background: ${isInProgress ? '#f0ad4e' : '#28a745'}; color: white;">${isInProgress ? 'Continue Exam' : 'Start Exam'}</button>`;
            }

            // Past attempts for this exam
            const pastAttempts = studentDashboard.results.filter(r => r.examId === examId);
            let attemptsHtml = '';
            if (pastAttempts.length > 0) {
                attemptsHtml = `
                    <div style="margin-top: 24px;">
                        <h4 style="color: var(--text-secondary, var(--light-text)); font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">Past Attempts</h4>
                        ${pastAttempts.map(r => {
                            const tp = r.totalPoints || 100;
                            const pts = r.points !== undefined ? r.points : Math.round((r.score / 100) * tp);
                            const passed = r.score >= (r.passScore || 50);
                            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color);">
                                <span style="font-size: 0.9rem; color: var(--text-color);">${Utils.formatDate(r.submittedAt)}</span>
                                <span style="font-weight: 600; color: ${passed ? 'var(--success-color)' : 'var(--accent-color)'};">${pts}/${tp}</span>
                            </div>`;
                        }).join('')}
                    </div>
                `;
            }

            // Build instructions content for center panel
            let customInstructionsHtml = '';
            if (exam.instructions && exam.instructions.trim()) {
                customInstructionsHtml = `
                    <div style="margin-bottom: 20px;">
                        <h5 style="color: var(--secondary-color, var(--primary-color)); margin-bottom: 10px;">Specific Instructions:</h5>
                        <div style="background: var(--card-bg, #fff); padding: 12px; border-left: 3px solid var(--primary-color); border-radius: 4px; color: var(--text-color);">
                            ${exam.instructions}
                        </div>
                    </div>
                `;
            }

            centerContent.innerHTML = `
                <div class="exam-detail-header">
                    <h2 class="exam-detail-title" style="font-size:1.5rem; font-weight:800;">${exam.subject}</h2>
                    <span class="exam-detail-breadcrumb">${exam.title} · ${exam.targetClass || 'All Classes'}</span>
                </div>
                <div class="exam-detail-divider"></div>

                ${customInstructionsHtml}

                <h5 style="color: var(--secondary-color, var(--primary-color)); margin-bottom: 10px;">General Guidelines:</h5>
                <ul style="color: var(--text-color); line-height: 1.8; margin-bottom: 20px; padding-left: 20px;">
                    <li>Read each question carefully before answering</li>
                    <li>You can navigate between questions using the navigation buttons</li>
                    <li>Your progress is automatically saved as you answer</li>
                    <li>The timer will start immediately when you begin the exam</li>
                    <li>You can review and change your answers before submitting</li>
                </ul>

                <div style="background: rgba(255, 193, 7, 0.1); border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px; margin-bottom: 20px;">
                    <h5 style="color: #f57c00; margin-bottom: 10px; margin-top: 0;">Important:</h5>
                    <ul style="color: var(--text-color); line-height: 1.8; margin: 0; padding-left: 20px;">
                        <li><strong>Auto-Submission:</strong> The exam will automatically submit when time expires</li>
                        <li><strong>Incomplete Submissions:</strong> If you close the app or browser before completing, your score will be calculated based on the questions you've answered</li>
                        <li><strong>Internet Connection:</strong> Your answers are saved locally and will sync when you're back online</li>
                        <li><strong>One Attempt:</strong> Once you start, you cannot retake this exam</li>
                    </ul>
                </div>

                <h5 style="color: var(--secondary-color, var(--primary-color)); margin-bottom: 10px;">Submission Process:</h5>
                <ol style="color: var(--text-color); line-height: 1.8; margin-bottom: 20px; padding-left: 20px;">
                    <li>Answer all questions or as many as you can</li>
                    <li>Review your answers using the question navigation</li>
                    <li>Click the "Submit Exam" button when ready</li>
                    <li>Confirm your submission in the final dialog</li>
                    <li>View your results immediately after submission</li>
                </ol>

                <div style="text-align: center; padding: 15px; background: var(--inner-bg, #f5f5f5); border-radius: 8px; margin-bottom: 20px;">
                    <p style="font-size: 1.1rem; color: var(--primary-color); margin: 0;">
                        <strong>Good Luck!</strong> Take your time and do your best!
                    </p>
                </div>

                <div class="exam-detail-actions">
                    ${ctaHtml}
                </div>
                ${attemptsHtml}
            `;
        }

        // Populate right panel metadata
        const metaContent = document.getElementById('panel-meta-content');
        if (metaContent) {
            const qCount = exam.questionCount || 0;
            const pastAttempts = studentDashboard.results.filter(r => r.examId === examId);
            // V2D: Use centralized resolver for right-panel status
            const metaAvail = dataService.resolveExamAvailability(exam);
            const isScheduled = !metaAvail.available && (metaAvail.reason === 'scheduled_future' || metaAvail.reason === 'no_trusted_time_future_locked');
            const isInProgress = pastAttempts.some(r => r.status === 'in-progress');
            let statusLabel, statusColor;
            if (tab === 'flagged') {
                statusLabel = 'Flagged';
                statusColor = 'var(--accent-color)';
            } else if (isInProgress) {
                statusLabel = 'In Progress';
                statusColor = '#f0ad4e';
            } else if (tab === 'completed' || pastAttempts.some(r => r.status !== 'in-progress')) {
                const lastResult = pastAttempts.filter(r => r.status !== 'in-progress').pop();
                const passed = lastResult && lastResult.score >= (lastResult.passScore || 50);
                statusLabel = passed ? 'Passed' : 'Failed';
                statusColor = passed ? 'var(--success-color)' : 'var(--accent-color)';
            } else if (isScheduled) {
                statusLabel = 'Scheduled';
                statusColor = 'var(--light-text)';
            } else {
                statusLabel = 'Available';
                statusColor = 'var(--primary-color)';
            }

            metaContent.innerHTML = `
                <div class="meta-row">
                    <div class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
                    <div class="meta-label">Term</div>
                    <div class="meta-value">${exam.title || 'N/A'}</div>
                </div>
                <div class="meta-row">
                    <div class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg></div>
                    <div class="meta-label">Subject</div>
                    <div class="meta-value">${exam.subject}</div>
                </div>
                <div class="meta-row">
                    <div class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
                    <div class="meta-label">Duration</div>
                    <div class="meta-value">${exam.duration} minutes</div>
                </div>
                <div class="meta-row">
                    <div class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>
                    <div class="meta-label">Questions</div>
                    <div class="meta-value">${qCount}</div>
                </div>
                <div class="meta-row">
                    <div class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></svg></div>
                    <div class="meta-label">Pass Mark</div>
                    <div class="meta-value">${exam.passScore || 50}%</div>
                </div>
                <div class="meta-row">
                    <div class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></div>
                    <div class="meta-label">Status</div>
                    <div class="meta-value" style="color: ${statusColor}; font-weight: 600;">${statusLabel}</div>
                </div>
                <div class="meta-row">
                    <div class="meta-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
                    <div class="meta-label">Class</div>
                    <div class="meta-value">${exam.targetClass || 'All'}</div>
                </div>
            `;
        }

        // On mobile, slide to center panel
        if (window.innerWidth < 768) {
            studentDashboard.showPanel('center');
        }
    },

    // Mobile panel navigation
    showPanel: (panel) => {
        const panels = document.getElementById('student-panels');
        if (!panels) return;

        panels.setAttribute('data-active-panel', panel);
        panels.classList.remove('show-center', 'show-right');

        if (panel === 'center') {
            panels.classList.add('show-center');
        } else if (panel === 'right') {
            panels.classList.add('show-right');
        }
    },

    startExam: async (examId) => {
        const exam = studentDashboard.exams.find(e => e.id === examId);
        if (!exam) {
            await Utils.showAlert('Exam Not Found', 'This exam could not be found. It may have been removed or is no longer available.');
            return;
        }

        // V2D: Validate schedule using trusted server time BEFORE confirming
        const availability = dataService.resolveExamAvailability(exam);
        if (!availability.available) {
            if (availability.reason === 'no_trusted_time_future_locked') {
                await Utils.showAlert('Cannot Verify Time', 'Cannot verify exam start time right now. Please reconnect and try again.');
                return;
            }
            if (availability.reason === 'scheduled_future') {
                const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                const formattedDate = availability.scheduledAt.toLocaleDateString('en-US', options);
                await Utils.showAlert('Not Yet Available', `This exam is not yet available. It will be accessible on ${formattedDate}.`);
                return;
            }
            if (availability.reason === 'inactive') {
                await Utils.showAlert('Exam Unavailable', 'This exam is no longer available.');
                return;
            }
        }

        const confirmed = await Utils.showConfirm('Start Exam', `Are you sure you want to start <strong>${exam.subject} — ${exam.title}</strong>?<br><br>The timer will begin immediately once you proceed.`);
        if (confirmed) {
            // Show loading indicator
            const centerContent = document.getElementById('panel-center-content');
            let loader;
            if (centerContent) {
                loader = document.createElement('div');
                loader.id = 'exam-loading-indicator';
                loader.style.cssText = 'text-align:center;padding:20px;color:var(--primary-color);font-weight:600;';
                loader.textContent = 'Preparing exam...';
                centerContent.prepend(loader);
            }

            try {
                // V2D LAUNCH GUARD: Fetch latest exam metadata from server and re-validate schedule
                let serverUpdatedAt = exam.updatedAt;
                if (navigator.onLine) {
                    try {
                        const pb = dataService._getPB();
                        const base = pb.baseURL || pb.baseUrl;
                        const token = pb.authStore.token;
                        const fieldsParam = 'fields=' + encodeURIComponent('updated,scheduled_date,status');
                        const res = await fetch(`${base}/api/collections/exams/records/${examId}?${fieldsParam}`, {
                            headers: token ? { 'Authorization': token } : {}
                        });
                        const freshMeta = res.ok ? await res.json() : await pb.collection('exams').getOne(examId);
                        serverUpdatedAt = freshMeta.updated;

                        // Re-check availability with fresh server data
                        const freshExamForCheck = {
                            ...exam,
                            scheduledDate: freshMeta.scheduled_date || null,
                            status: freshMeta.status,
                            updatedAt: freshMeta.updated
                        };
                        const freshAvailability = dataService.resolveExamAvailability(freshExamForCheck);
                        if (!freshAvailability.available) {
                            if (loader) loader.remove();
                            console.log(`[LaunchGuard] Blocked stale launch for exam ${examId}: reason=${freshAvailability.reason}`);
                            if (freshAvailability.reason === 'scheduled_future') {
                                const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                                const fd = freshAvailability.scheduledAt.toLocaleDateString('en-US', opts);
                                await Utils.showAlert('Schedule Changed', `This exam has been scheduled and is not yet available. It will be accessible on ${fd}.`);
                            } else if (freshAvailability.reason === 'inactive') {
                                await Utils.showAlert('Exam Unavailable', 'This exam is no longer available.');
                            } else {
                                await Utils.showAlert('Cannot Start', 'This exam cannot be started right now. Please refresh and try again.');
                            }
                            // Update local exam data to reflect server state
                            const idx = studentDashboard.exams.findIndex(e => e.id === examId);
                            if (idx !== -1) {
                                studentDashboard.exams[idx] = freshExamForCheck;
                                studentDashboard.renderAvailable();
                            }
                            return;
                        }
                    } catch (e) {
                        console.warn('[LaunchGuard] Could not verify latest exam state:', e);
                        // Proceed with cached data — take-exam page has its own checks
                    }
                }


                // Fetch full exam with freshness check — will re-fetch if stale
                await dataService.getExamById(examId, serverUpdatedAt);
            } catch (e) {
                // Proceed anyway — take-exam page will fetch if needed
            }

            if (loader) loader.remove();
            window.location.href = `take-exam.html?id=${examId}`;
        }
    },

    reviewExam: (examId, resultId) => {
        window.location.href = `take-exam.html?id=${examId}&mode=resolve&resultId=${resultId}`;
    }
};

document.addEventListener('DOMContentLoaded', studentDashboard.init);
