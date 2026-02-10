/**
 * Student Dashboard Controller
 */

const studentDashboard = {
    user: null,
    exams: [],
    results: [],
    currentFilter: 'All',

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

        const btn = document.getElementById('mobile-menu-btn');
        const menu = document.getElementById('mobile-menu');
        if (btn) btn.onclick = () => menu.classList.toggle('show');

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
                el.textContent = '🟢 Online';
                el.style.backgroundColor = '#d4edda';
                el.style.color = '#155724';
                el.style.border = '1px solid #c3e6cb';
                el.style.opacity = '1';
                // fade out after 5s
                setTimeout(() => { if (el) el.style.opacity = '0'; }, 5000);
            } else {
                el.textContent = '🔴 Offline';
                el.style.backgroundColor = '#f8d7da';
                el.style.color = '#721c24';
                el.style.border = '1px solid #f5c6cb';
                el.style.opacity = '1';
            }
        };

        // Online/Offline event listeners
        window.addEventListener('online', async () => {
            console.log('📶 Back online! Syncing data...');
            updateStatus();

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
                    el.textContent = '🟢 Synced';
                    el.style.backgroundColor = '#d4edda';
                    el.style.color = '#155724';
                    // Reload data to show updated results/history
                    studentDashboard.loadData();
                }, 1500);
            }
        }
    },

loadData: async () => {
        const userId = studentDashboard.user.id;
        const useIndexedDB = window.idb && window.idb.isIndexedDBAvailable();

        let exams = [];
        let serverResults = [];
        let isUsingCache = false;

try {
            // Attempt to fetch from server with optimizations
            [exams, serverResults] = await Promise.all([
                dataService.getExams({ 
                    status: 'active',
                    studentDashboard: true // Use optimized query
                }),
                userId
                    ? dataService.getResults({ 
                        studentId: userId,
                        studentDashboard: true // Use optimized query
                    })
                    : Promise.resolve([])
            ]);

            // SUCCESS! Cache the fresh data for offline fallback
            try {
                if (useIndexedDB) {
                    // Use IndexedDB for larger storage capacity
                    await window.idb.saveExams(exams);
                    await window.idb.saveDashboardCache('exams_list', {
                        data: exams,
                        timestamp: Date.now()
                    });
                    await window.idb.saveDashboardCache(`results_${userId}`, {
                        data: serverResults,
                        timestamp: Date.now()
                    });
                    // Also save results to IndexedDB
                    if (serverResults.length > 0) {
                        await window.idb.saveResults(serverResults);
                    }
                    console.log('✅ Dashboard data cached to IndexedDB');
                } else {
                    // Fallback to localStorage
                    localStorage.setItem('cbt_dashboard_exams_cache', JSON.stringify({
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
                    const cachedExams = await window.idb.getDashboardCache('exams_list');
                    const cachedResults = await window.idb.getDashboardCache(`results_${userId}`);

                    if (cachedExams && cachedExams.data && cachedExams.data.data) {
                        exams = cachedExams.data.data;
                        isUsingCache = true;
                        console.log(`📦 Loaded ${exams.length} exams from IndexedDB (saved ${window.idb.formatCacheAge(cachedExams.data.timestamp)})`);
                    } else {
                        // Try getting all exams from IndexedDB
                        const allExams = await window.idb.getAllExams();
                        if (allExams && allExams.length > 0) {
                            exams = allExams;
                            isUsingCache = true;
                            console.log(`📦 Loaded ${exams.length} exams from IndexedDB cache`);
                        }
                    }

                    if (cachedResults && cachedResults.data && cachedResults.data.data) {
                        serverResults = cachedResults.data.data;
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
                    const cachedExams = JSON.parse(localStorage.getItem('cbt_dashboard_exams_cache') || 'null');
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

        // Trigger preload of ready exams for offline use
        studentDashboard.preloadExamsForOffline();
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

        let html = `<span>⚠️ ${message}</span>`;
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

    // Preload exams for offline use (opportunistic)
    preloadExamsForOffline: async () => {
        if (!navigator.onLine) return;
        if (!window.idb || !window.idb.isIndexedDBAvailable()) return;

        // Only preload available exams that haven't been taken
        const availableExams = studentDashboard.exams.filter(exam => {
            const taken = studentDashboard.results.some(r =>
                r.examId === exam.id && !r.isPending
            );
            return !taken && exam.status === 'active';
        });

        let preloadedCount = 0;

        for (const exam of availableExams) {
            try {
                // Check if already cached with full questions
                const cached = await window.idb.getExam(exam.id);
                if (cached && cached.questions && cached.questions.length > 0) {
                    continue; // Already cached
                }

                // Fetch full exam with questions
                const fullExam = await dataService.getExamById(exam.id);
                if (fullExam && fullExam.questions) {
                    await window.idb.saveExam(fullExam);
                    preloadedCount++;
                    console.log(`📥 Preloaded exam: ${exam.title}`);
                }
            } catch (err) {
                console.warn(`Could not preload exam ${exam.id}:`, err.message);
            }
        }

        if (preloadedCount > 0) {
            console.log(`✅ Preloaded ${preloadedCount} exams for offline use`);
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
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-btn').forEach(b => {
            if (b.textContent.toLowerCase().includes(tab)) b.classList.add('active');
        });

        // Hide all sections
        document.getElementById('available-exams-section').style.display = 'none';
        document.getElementById('resolved-exams-section').style.display = 'none';
        document.getElementById('completed-exams-section').style.display = 'none';

        const df = document.querySelector('.desktop-filter');

        if (tab === 'available') {
            document.getElementById('available-exams-section').style.display = 'block';
            if (df) df.style.visibility = 'visible';
        } else if (tab === 'resolved') {
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
            html += `<h3 style="width:100%; color: var(--accent-color); margin-bottom: 15px;">⚠️ Action Required</h3>`;
            html += actionItems.map(result => {
                const exam = studentDashboard.exams.find(e => e.id === result.examId) || { title: 'Unknown Exam', subject: 'N/A' };
                const deadlines = Object.values(result.flags)
                    .filter(f => f && f.status === 'resolved' && !f._status)
                    .map(f => new Date(f.deadline));

                if (deadlines.length === 0) return ''; // Should not happen given filter

                const minDeadline = new Date(Math.min(...deadlines));
                const timeLeft = Math.round((minDeadline - now) / 60000);

                return `
                <div class="exam-card" style="border: 2px solid var(--accent-color);">
                    <div class="exam-card-header" style="background-color: #fff0f0;">
                         <span class="exam-subject" style="color:red;">Action Required</span>
                         <span class="exam-subject" style="background: red; color: white;">${timeLeft}m LEFT</span>
                    </div>
                    <div class="exam-card-body">
                        <h4 class="exam-title">${exam.title}</h4>
                        <p style="font-size: 0.9rem; color: #666;">
                            Teacher has resolved your flagged questions. Please review and update your answers.
                        </p>
                    </div>
                    <div class="exam-card-footer">
                        <button class="btn btn-primary" onclick="studentDashboard.reviewExam('${result.examId}', '${result.id}')" style="width: 100%; background-color: var(--accent-color); border-color: var(--accent-color);">Review & Update</button>
                    </div>
                </div>
                `;
            }).join('');
            html += `<div style="width:100%; height: 2px; background: #eee; margin: 20px 0;"></div>`;
            html += `<h3 style="width:100%; margin-bottom: 15px;">Available Exams</h3>`;
        }

        // --- 2. Render Normal Available Exams ---
        const takenExamIds = new Set(studentDashboard.results.map(r => String(r.examId)));
        const userClass = studentDashboard.user.classLevel;



        const available = studentDashboard.exams.filter(e => {


            if (takenExamIds.has(String(e.id))) {

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

        html += available.map(exam => {
            // Check if exam is scheduled for future
            const isScheduled = exam.scheduledDate && new Date(exam.scheduledDate) > now;
            const scheduledDate = exam.scheduledDate ? new Date(exam.scheduledDate) : null;

            let scheduleInfo = '';
            let actionButton = '';

            if (isScheduled) {
                // Format scheduled date nicely
                const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                const formattedDate = scheduledDate.toLocaleDateString('en-US', options);
                scheduleInfo = `<span style="color: var(--accent-color);">📅 ${formattedDate}</span>`;
                actionButton = `<button class="btn" style="width: 100%; background: var(--light-text); color: white; cursor: not-allowed;" disabled>🔒 Available ${formattedDate}</button>`;
            } else {
                actionButton = `<button class="btn btn-primary" onclick="studentDashboard.startExam('${exam.id}')" style="width: 100%;">Start Exam</button>`;
            }

            return `
            <div class="exam-card" ${isScheduled ? 'style="opacity: 0.8;"' : ''}>
                <div class="exam-card-header">
                    <span class="exam-subject">${exam.subject}</span>
                    <span class="exam-subject exam-class-badge">${exam.targetClass || 'All'}</span>
                    ${isScheduled
                    ? '<span class="exam-subject" style="background: var(--accent-color); color: white;">Scheduled</span>'
                    : '<span class="exam-subject" style="background: var(--success-color); color: white;">Available</span>'}
                </div>
                <div class="exam-card-body">
                    <h4 class="exam-title">${exam.title}</h4>
                    <div class="exam-meta">
                        <span>⏱ ${exam.duration} mins</span>
                        <span>📝 ${exam.questions ? exam.questions.length : 0} Qs</span>
                        ${scheduleInfo}
                    </div>
                </div>
                <div class="exam-card-footer">
                    ${actionButton}
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

        if (resolvedItems.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>No resolved flags yet.</p>
                </div>`;
            return;
        }

        grid.innerHTML = resolvedItems.map(result => {
            const exam = studentDashboard.exams.find(e => e.id === result.examId) || { title: 'Unknown Exam', subject: 'N/A' };

            // Calculate points if not stored (for backward compatibility)
            const totalPoints = result.totalPoints || 100;
            const points = result.points !== undefined ? result.points : Math.round((result.score / 100) * totalPoints);

            return `
            <div class="exam-card" style="border: 2px solid #28a745; opacity: 0.9;">
                <div class="exam-card-header" style="background-color: #d4edda;">
                     <span class="exam-subject" style="color: #28a745;">Resolved</span>
                     <span class="exam-subject" style="background: #28a745; color: white;">Score: ${points}/${totalPoints}</span>
                </div>
                <div class="exam-card-body">
                    <h4 class="exam-title">${exam.title}</h4>
                    <p style="font-size: 0.9rem; color: #155724;">
                        You successfully updated your answers for the flagged questions.
                    </p>
                </div>
                <div class="exam-card-footer">
                    <button class="btn" onclick="window.location.href='results.html?id=${result.id}'" style="width: 100%; background-color: #28a745; color: white; border-color: #28a745;">👁️ View Details</button>
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

        if (completedResults.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>You haven't completed any exams yet.</p>
                </div>`;
            return;
        }

        grid.innerHTML = completedResults.map(result => {
            const exam = studentDashboard.exams.find(e => e.id === result.examId) || { title: 'Unknown Exam', subject: 'N/A' };
            const isPass = result.score >= (result.passScore || 50); // Fallback

            // Calculate points if not stored (for backward compatibility)
            const totalPoints = result.totalPoints || 100;
            const points = result.points !== undefined ? result.points : Math.round((result.score / 100) * totalPoints);

            return `
            <div class="exam-card" style="opacity: 0.8;">
                <div class="exam-card-header">
                     <span class="exam-subject">${exam.subject}</span>
                     ${isPass
                    ? '<span style="color: var(--success-color); font-weight: bold;">PASSED</span>'
                    : '<span style="color: var(--accent-color); font-weight: bold;">FAILED</span>'}
                </div>
                <div class="exam-card-body">
                    <h4 class="exam-title">${exam.title}</h4>
                    <div class="exam-meta">
                        <span>Score: ${points}/${totalPoints} Points</span>
                        <span>${Utils.formatDate(result.submittedAt)}</span>
                    </div>
                </div>
                <div class="exam-card-footer">
                    <button class="btn" onclick="window.location.href='results.html?id=${result.id}'" style="width: 100%;">👁️ View Details</button>
                </div>
            </div>
            `;
        }).join('');
    },

    startExam: (examId) => {
        // Find the exam data
        const exam = studentDashboard.exams.find(e => e.id === examId);
        if (!exam) {
            alert('Exam not found');
            return;
        }

        // Store exam ID for later use
        studentDashboard.pendingExamId = examId;

        // Populate modal with exam data
        document.getElementById('modal-exam-title').textContent = exam.title;
        document.getElementById('modal-exam-duration').textContent = `${exam.duration} minutes`;
        document.getElementById('modal-exam-questions').textContent = exam.questions ? exam.questions.length : 0;
        document.getElementById('modal-exam-subject').textContent = exam.subject || 'General';
        document.getElementById('modal-exam-pass-score').textContent = `${exam.passScore || 50}%`;

        // Show custom instructions if available
        const customInstructionsDiv = document.getElementById('modal-custom-instructions');
        const instructionsText = document.getElementById('modal-instructions-text');

        if (exam.instructions && exam.instructions.trim()) {
            instructionsText.textContent = exam.instructions;
            customInstructionsDiv.style.display = 'block';
        } else {
            customInstructionsDiv.style.display = 'none';
        }

        // Show the modal
        document.getElementById('exam-instructions-modal').style.display = 'flex';
    },

    closeInstructionsModal: () => {
        document.getElementById('exam-instructions-modal').style.display = 'none';
        studentDashboard.pendingExamId = null;
    },

    confirmStartExam: () => {
        if (studentDashboard.pendingExamId) {
            window.location.href = `take-exam.html?id=${studentDashboard.pendingExamId}`;
        }
    },

    reviewExam: (examId, resultId) => {
        window.location.href = `take-exam.html?id=${examId}&mode=resolve&resultId=${resultId}`;
    }
};

document.addEventListener('DOMContentLoaded', studentDashboard.init);
