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
                el.style.top = '10px'; // Below header? No, header is fixed usually?
                el.style.right = '120px'; // Left of logout/menu
                el.style.zIndex = '2000';
                el.style.padding = '5px 10px';
                el.style.borderRadius = '20px';
                el.style.fontSize = '0.8rem';
                el.style.fontWeight = 'bold';
                document.body.appendChild(el);
            }

            if (isOnline) {
                el.textContent = '🟢 Online';
                el.style.backgroundColor = '#d4edda';
                el.style.color = '#155724';
                el.style.border = '1px solid #c3e6cb';
                // fade out after 5s?
                setTimeout(() => { if (el) el.style.opacity = '0'; }, 5000);
                el.style.opacity = '1';
            } else {
                el.textContent = '🔴 Offline';
                el.style.backgroundColor = '#f8d7da';
                el.style.color = '#721c24';
                el.style.border = '1px solid #f5c6cb';
                el.style.opacity = '1';
            }
        };

        window.addEventListener('online', () => {
            updateStatus();
            studentDashboard.syncResults();
        });
        window.addEventListener('offline', updateStatus);

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
        try {
            const [exams, serverResults] = await Promise.all([
                dataService.getExams(),
                studentDashboard.user.id
                    ? dataService.getResults({ studentId: studentDashboard.user.id })
                    : Promise.resolve([])
            ]);

            // Merge with Pending Submissions (Local)
            const pending = JSON.parse(localStorage.getItem('cbt_pending_submissions') || '[]');
            // Filter pending to only this user's submissions (in case of shared device)
            // Pending items have: student_id, exam_id, etc.
            const myPending = pending.filter(p => p.student_id === studentDashboard.user.id);

            // Map pending to match result structure
            const mappedPending = myPending.map(p => ({
                id: p._local_id || 'pending-' + Date.now(), // Temp ID
                examId: p.exam_id,
                studentId: p.student_id,
                score: p.score,
                totalPoints: p.total_points,
                answers: p.answers,
                submittedAt: p.submitted_at,
                studentName: studentDashboard.user.name,
                passed: p.score >= (p.pass_score || 50), // Approximation
                isPending: true
            }));

            // Combine, avoiding duplicates if sync happened partly? 
            // Ideally serverResults checks ID. Pending has no server ID.
            // Just concat. If it shows twice, better than not showing.
            studentDashboard.results = [...mappedPending, ...serverResults];

            studentDashboard.exams = exams;
            studentDashboard.populateSubjectFilters();
            studentDashboard.renderAvailable();
            studentDashboard.renderResolved();
            studentDashboard.renderCompleted();
        } catch (err) {
            console.error('Data load error', err);
            alert('Failed to load exams.');
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
                    <span class="exam-subject" style="background: var(--secondary-color); color: white;">${exam.targetClass || 'All'}</span>
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
        window.location.href = `take-exam.html?id=${examId}`;
    },

    reviewExam: (examId, resultId) => {
        window.location.href = `take-exam.html?id=${examId}&mode=resolve&resultId=${resultId}`;
    }
};

document.addEventListener('DOMContentLoaded', studentDashboard.init);
