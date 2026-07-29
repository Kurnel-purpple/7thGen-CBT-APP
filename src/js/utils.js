/**
 * Utility functions for CBT Exam App
 */

// Loader state per element: overlapping loader calls on the same element must
// share the true pre-loader snapshot, and only the last stop() restores it.
const _buttonLoaderStates = new WeakMap();
const _elementLoaderStates = new WeakMap();

const Utils = {
    /**
     * Canonical school terms — the single source of truth for every part of
     * the CBT module that filters, labels, or groups by term. Matches the
     * Term dropdown in the Create Exam form (the exam title holds the term).
     */
    CBT_TERMS: ['1st Term', '2nd Term', '3rd Term'],

    /**
     * Normalize free text (e.g. an exam title) to one of the canonical
     * CBT_TERMS. Returns '' when the value doesn't map to a known term.
     * @param {string} value
     * @returns {string} '1st Term' | '2nd Term' | '3rd Term' | ''
     */
    normalizeTerm: (value) => {
        const v = String(value || '').trim().toLowerCase();
        if (/^(1st|first)\b/.test(v) || v.startsWith('term 1') || v === '1') return '1st Term';
        if (/^(2nd|second)\b/.test(v) || v.startsWith('term 2') || v === '2') return '2nd Term';
        if (/^(3rd|third)\b/.test(v) || v.startsWith('term 3') || v === '3') return '3rd Term';
        return '';
    },

    /**
     * Optional term calendar override, populated at runtime from admin
     * settings (see DataService.loadTermCalendar / Utils.setTermCalendar).
     * When null, getCurrentTerm falls back to the built-in month-based rule.
     * Shape: { session?: string, terms: [{ term, start:'YYYY-MM-DD', end:'YYYY-MM-DD' }, ...] }
     */
    termCalendar: null,

    /**
     * Install (or clear) the admin-configured term calendar. Accepts the raw
     * settings object; keeps only well-formed term ranges. Pass null/undefined
     * to revert to the month-based default.
     * @param {Object|null} cal
     */
    setTermCalendar: (cal) => {
        if (!cal || !Array.isArray(cal.terms)) { Utils.termCalendar = null; return; }
        const terms = cal.terms
            .map((t) => ({
                term: Utils.normalizeTerm(t && t.term),
                start: t && t.start ? String(t.start).slice(0, 10) : '',
                end: t && t.end ? String(t.end).slice(0, 10) : ''
            }))
            .filter((t) => t.term && t.start && t.end);
        Utils.termCalendar = terms.length ? { session: cal.session || '', terms } : null;
    },

    /**
     * Month-based fallback mapping (no gaps — every month belongs to a term):
     *   Aug–Dec → 1st Term, Jan–Mar → 2nd Term, Apr–Jul → 3rd Term.
     * @param {number} month 1-12
     * @returns {string} canonical term
     */
    termForMonth: (month) => {
        if (month >= 8 && month <= 12) return '1st Term';
        if (month >= 1 && month <= 3) return '2nd Term';
        return '3rd Term';
    },

    /**
     * Determine the current school term for a given date (defaults to now).
     * Uses the admin-configured calendar when available — a date inside a
     * configured range returns that term; during holiday gaps it falls back to
     * the most recently started term. Without a calendar it uses the
     * month-based rule (termForMonth).
     * @param {Date|string} [date]
     * @returns {string} '1st Term' | '2nd Term' | '3rd Term'
     */
    getCurrentTerm: (date) => {
        const d = date ? new Date(date) : new Date();
        if (isNaN(d.getTime())) return Utils.termForMonth(new Date().getMonth() + 1);
        const cal = Utils.termCalendar;
        if (cal && Array.isArray(cal.terms) && cal.terms.length) {
            const ts = d.getTime();
            // Exact match: date inside a configured [start, end] range.
            for (const t of cal.terms) {
                const s = new Date(t.start + 'T00:00:00').getTime();
                const e = new Date(t.end + 'T23:59:59').getTime();
                if (ts >= s && ts <= e) return t.term;
            }
            // Holiday gap: fall back to the most recently started term.
            let best = null;
            let bestStart = -Infinity;
            for (const t of cal.terms) {
                const s = new Date(t.start + 'T00:00:00').getTime();
                if (s <= ts && s > bestStart) { bestStart = s; best = t; }
            }
            // Before the earliest configured start → holiday before 1st term,
            // i.e. the tail end of the previous session's last term.
            if (best) return best.term;
            return cal.terms
                .slice()
                .sort((a, b) => Utils.CBT_TERMS.indexOf(b.term) - Utils.CBT_TERMS.indexOf(a.term))[0].term;
        }
        return Utils.termForMonth(d.getMonth() + 1);
    },

    /**
     * Current academic session label, e.g. '2025/2026'. The school year
     * turns over with 1st Term: from August onward the session is
     * year/year+1; January–July it is year-1/year.
     * @param {Date|string} [date]
     * @returns {string}
     */
    getCurrentSession: (date) => {
        const d = date ? new Date(date) : new Date();
        const dd = isNaN(d.getTime()) ? new Date() : d;
        const y = dd.getFullYear();
        return (dd.getMonth() + 1) >= 8 ? y + '/' + (y + 1) : (y - 1) + '/' + y;
    },

    /**
     * Preselect the current term on a <select> whose options include it.
     * By default only fills when nothing meaningful is chosen (empty or a
     * non-term placeholder like "All Terms"), so it never overrides a value
     * the user picked. Pass { force:true } (or data-default-term="force") to
     * always snap to the current term.
     * @param {HTMLSelectElement} select
     * @param {{ force?: boolean, dispatch?: boolean }} [opts]
     */
    applyDefaultTerm: (select, opts) => {
        opts = opts || {};
        if (!select || !select.options) return;
        const term = Utils.getCurrentTerm();
        let match = null;
        for (const o of Array.from(select.options)) {
            if (Utils.normalizeTerm(o.value) === term) { match = o; break; }
        }
        if (!match) return;
        const force = opts.force || select.dataset.defaultTerm === 'force';
        if (!force && Utils.normalizeTerm(select.value)) return; // user/real term already set
        select.value = match.value;
        if (opts.dispatch) select.dispatchEvent(new Event('change', { bubbles: true }));
    },

    /**
     * The home dashboard for the signed-in user's role. Used as the fallback
     * destination for back navigation when there is no browser history.
     * @param {Object} [user]
     * @returns {string} filename (pages are all in /pages/)
     */
    getDashboardUrl: (user) => {
        const u = user || (window.dataService && dataService.getCurrentUser && dataService.getCurrentUser()) || {};
        // Must agree with where auth.js sends each role at login — a
        // super_admin landing on the admin dashboard is the wrong home.
        if (u.role === 'super_admin') return 'master-admin.html';
        if (u.role === 'admin') return 'admin-dashboard.html';
        if (u.role === 'teacher') return 'teacher-dashboard.html';
        return 'student-dashboard.html';
    },

    /**
     * The signed-in user's home, or null when the role is not one we know.
     * Callers that redirect on this must not guess: sending an unrecognised
     * account to the student dashboard would bounce it straight back out.
     */
    getKnownDashboardUrl: (user) => {
        const u = user || (window.dataService && dataService.getCurrentUser && dataService.getCurrentUser()) || {};
        const known = ['super_admin', 'admin', 'teacher', 'student'];
        return known.includes(u.role) ? Utils.getDashboardUrl(u) : null;
    },

    /**
     * Navigate to the previous page the user came from. Prefers real browser
     * history (so it returns to wherever they were — admin OR teacher portal),
     * and only falls back to the role's home dashboard when there is no history.
     * Never hard-codes a dashboard, which previously bounced admins to the
     * teacher dashboard and got them logged out by its role guard.
     */
    goBack: () => {
        if (window.history.length > 1) {
            window.history.back();
            return;
        }
        window.location.href = Utils.getDashboardUrl();
    },

    /**
     * Generate a unique ID
     * @returns {string} Unique ID
     */
    generateId: () => {
        return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
    },

    /**
     * Format date
     * @param {Date|string} date 
     * @returns {string} Formatted date string
     */
    formatDate: (date) => {
        return new Date(date).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Deep clone an object
     * @param {Object} obj 
     * @returns {Object} Cloned object
     */
    deepClone: (obj) => {
        return JSON.parse(JSON.stringify(obj));
    },

    /**
     * Shuffle array (Fisher-Yates) for randomizing questions/answers
     * @param {Array} array 
     * @returns {Array} Shuffled array
     */
    shuffleArray: (array) => {
        const newArray = [...array];
        for (let i = newArray.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
        }
        return newArray;
    },

    /**
     * Initialize Theme (Dark/Light)
     */
    initTheme: () => {
        const savedTheme = localStorage.getItem('theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);

        // Inject Toggle Button into Header (skip if sidebar already has one)
        const header = document.querySelector('.main-header');
        if (header && !document.getElementById('sidebar-theme-toggle')) {
            const toggleBtn = document.createElement('button');
            toggleBtn.id = 'theme-toggle';
            toggleBtn.title = 'Toggle Dark Mode';
            toggleBtn.innerHTML = savedTheme === 'dark' ? '☀️' : '🌙';

            toggleBtn.onclick = () => {
                const current = document.documentElement.getAttribute('data-theme');
                const next = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem('theme', next);
                toggleBtn.innerHTML = next === 'dark' ? '☀️' : '🌙';

                // Sync mobile toggle if it exists
                const mobileToggle = document.getElementById('mobile-theme-toggle');
                if (mobileToggle) mobileToggle.innerHTML = next === 'dark' ? '☀️' : '🌙';
            };

            const userMenu = header.querySelector('.user-menu');
            const mobileUserRow = header.querySelector('.mobile-user-row');

            if (mobileUserRow) {
                // For pages with mobile-user-row (like create-exam), append to mobile row
                toggleBtn.className = 'btn';
                toggleBtn.style.cssText = 'background: transparent; color: var(--text-color); font-size: 1.2rem; padding: 5px;';
                mobileUserRow.appendChild(toggleBtn);
            } else if (userMenu) {
                // Insert into topbar-actions as a proper icon button, before user-menu
                const topbarActions = userMenu.closest('.topbar-actions');
                if (topbarActions) {
                    toggleBtn.className = 'topbar-icon-btn';
                    toggleBtn.style.cssText = 'font-size: 1.2rem;';
                    topbarActions.insertBefore(toggleBtn, userMenu);
                } else {
                    toggleBtn.className = 'topbar-icon-btn';
                    toggleBtn.style.cssText = 'font-size: 1.2rem;';
                    userMenu.insertBefore(toggleBtn, userMenu.firstChild);
                }
            } else {
                toggleBtn.className = 'btn';
                toggleBtn.style.cssText = 'background: transparent; color: var(--text-color); margin-left: auto; font-size: 1.2rem; padding: 5px;';
                header.appendChild(toggleBtn);
            }
        }
    },

    /**
     * Make logo clickable - navigates to appropriate dashboard based on user role
     */
    makeLogoClickable: () => {
        const logo = document.querySelector('.logo');
        if (!logo) return;

        // Get current user from localStorage
        const user = dataService?.getCurrentUser();
        if (!user) return;

        // Determine dashboard URL based on user role
        const dashboardUrl = user.role === 'teacher'
            ? 'teacher-dashboard.html'
            : 'student-dashboard.html';

        // Make logo clickable
        logo.style.cursor = 'pointer';
        logo.style.transition = 'opacity 0.2s ease';

        // Add hover effect
        logo.addEventListener('mouseenter', () => {
            logo.style.opacity = '0.8';
        });

        logo.addEventListener('mouseleave', () => {
            logo.style.opacity = '1';
        });

        // Add click handler
        logo.addEventListener('click', () => {
            // Check if we're in a pages subdirectory
            const isInPagesDir = window.location.pathname.includes('/pages/');
            const targetUrl = isInPagesDir ? dashboardUrl : `pages/${dashboardUrl}`;
            window.location.href = targetUrl;
        });

        // Add title attribute for accessibility
        logo.setAttribute('title', `Go to ${user.role === 'teacher' ? 'Teacher' : 'Student'} Dashboard`);
    },

    /**
     * Show a custom alert modal
     * @param {string} title 
     * @param {string} message 
     * @returns {Promise}
     */
    showAlert: (title, message) => {
        Utils._ensureModalHtml();
        return new Promise((resolve) => {
            const modal = document.getElementById('utils-alert-modal');
            document.getElementById('utils-alert-title').innerHTML = title || 'Notice';
            document.getElementById('utils-alert-message').innerHTML = message;

            const okBtn = document.getElementById('utils-alert-ok-btn');
            okBtn.onclick = () => { Utils._closeModal(modal).then(resolve); };
            modal.classList.remove('closing');
            modal.style.display = 'flex';
        });
    },

    /**
     * Show a custom confirm modal
     * @param {string} title 
     * @param {string} message 
     * @returns {Promise<boolean>}
     */
    showConfirm: (title, message) => {
        Utils._ensureModalHtml();
        return new Promise((resolve) => {
            const modal = document.getElementById('utils-confirm-modal');
            document.getElementById('utils-confirm-title').innerHTML = title || 'Confirm';
            document.getElementById('utils-confirm-message').innerHTML = message;

            const yesBtn = document.getElementById('utils-confirm-yes-btn');
            const noBtn = document.getElementById('utils-confirm-no-btn');

            yesBtn.onclick = () => { Utils._closeModal(modal).then(() => resolve(true)); };
            noBtn.onclick = () => { Utils._closeModal(modal).then(() => resolve(false)); };
            modal.classList.remove('closing');
            modal.style.display = 'flex';
        });
    },

    /**
     * Show a toast notification
     * @param {string} message 
     * @param {string} type - 'info', 'success', 'warning', 'error'
     */
    showToast: (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `utils-toast utils-toast-${type}`;

        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };

        const colors = {
            info: 'var(--primary-color, #4a90c8)',
            success: '#27ae60',
            warning: '#f39c12',
            error: '#e74c3c'
        };

        toast.style.cssText = `
            position: fixed;
            bottom: 30px;
            left: 30px;
            background: white;
            color: #333;
            padding: 15px 25px;
            border-radius: 12px;
            z-index: 10000;
            font-weight: 600;
            box-shadow: 0 10px 30px rgba(0,0,0,0.15);
            display: flex;
            align-items: center;
            gap: 12px;
            min-width: 280px;
            border-left: 6px solid ${colors[type]};
            transform: translateX(-120%);
            transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
        `;

        toast.innerHTML = `
            <span style="font-size: 1.2rem;">${icons[type]}</span>
            <span style="flex: 1;">${message}</span>
        `;

        document.body.appendChild(toast);

        // Force reflow
        toast.offsetHeight;

        // Slide in
        toast.style.transform = 'translateX(0)';

        setTimeout(() => {
            toast.style.transform = 'translateX(-120%)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    },

    /**
     * Internal: hide a Utils dialog with its exit animation (slide-down on
     * mobile, fade on desktop), then resolve once it's off-screen.
     * @private
     */
    _closeModal: (modal) => {
        return new Promise((resolve) => {
            if (!modal) return resolve();
            modal.classList.add('closing');
            setTimeout(() => {
                modal.style.display = 'none';
                modal.classList.remove('closing');
                resolve();
            }, 270);
        });
    },

    /**
     * Internal: Ensure modal HTML exists in document
     * @private
     */
    _ensureModalHtml: () => {
        if (document.getElementById('utils-alert-modal')) return;

        const modalHtml = `
            <div id="utils-alert-modal" class="utils-modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
                <div class="utils-modal-card" style="background: white; width: 90%; max-width: 400px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.3); animation: utils-pop 0.3s ease-out;">
                    <div style="background: var(--primary-color, #4a90c8); color: white; padding: 20px; text-align: center;">
                        <h3 id="utils-alert-title" style="margin: 0; font-size: 1.2rem;">Notice</h3>
                    </div>
                    <div style="padding: 30px 24px; text-align: center; color: #333;">
                        <p id="utils-alert-message" style="margin: 0; line-height: 1.6; font-size: 1rem;"></p>
                    </div>
                    <div style="padding: 15px 24px 24px; display: flex; justify-content: center;">
                        <button id="utils-alert-ok-btn" style="background: var(--primary-color, #4a90c8); color: white; border: none; padding: 12px 40px; border-radius: 10px; font-weight: 600; cursor: pointer; transition: transform 0.2s;">OK</button>
                    </div>
                </div>
            </div>

            <div id="utils-confirm-modal" class="utils-modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
                <div class="utils-modal-card" style="background: white; width: 90%; max-width: 400px; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,0.3); animation: utils-pop 0.3s ease-out;">
                    <div style="background: var(--secondary-color, #1557B0); color: white; padding: 20px; text-align: center;">
                        <h3 id="utils-confirm-title" style="margin: 0; font-size: 1.2rem;">Confirm Action</h3>
                    </div>
                    <div style="padding: 30px 24px; text-align: center; color: #333;">
                        <p id="utils-confirm-message" style="margin: 0; line-height: 1.6; font-size: 1rem;"></p>
                    </div>
                    <div style="padding: 15px 24px 24px; display: flex; justify-content: center; gap: 12px;">
                        <button id="utils-confirm-no-btn" style="background: #95a5a6; color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: 600; cursor: pointer; flex: 1;">Cancel</button>
                        <button id="utils-confirm-yes-btn" style="background: var(--secondary-color, #1557B0); color: white; border: none; padding: 12px 30px; border-radius: 10px; font-weight: 600; cursor: pointer; flex: 1;">Confirm</button>
                    </div>
                </div>
            </div>

            <style>
                @keyframes utils-pop {
                    0% { transform: scale(0.9); opacity: 0; }
                    100% { transform: scale(1); opacity: 1; }
                }
                @keyframes utils-pop-out { to { transform: scale(0.94); opacity: 0; } }
                /* Desktop close: fade the card out */
                .utils-modal-overlay.closing { opacity: 0; transition: opacity 0.22s ease; }
                .utils-modal-overlay.closing .utils-modal-card { animation: utils-pop-out 0.2s ease-in forwards; }

                [data-theme="dark"] #utils-alert-modal > div,
                [data-theme="dark"] #utils-confirm-modal > div {
                    background: #2c3e50 !important;
                }
                [data-theme="dark"] #utils-alert-message,
                [data-theme="dark"] #utils-confirm-message {
                    color: #ecf0f1 !important;
                }

                /* Mobile: dialogs become a bottom sheet that slides up, and
                   slides back down when dismissed. */
                @keyframes utils-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
                @keyframes utils-sheet-down { from { transform: translateY(0); } to { transform: translateY(100%); } }
                @media (max-width: 768px) {
                    .utils-modal-overlay { align-items: flex-end !important; }
                    .utils-modal-card {
                        width: 100% !important;
                        max-width: 100% !important;
                        border-radius: 20px 20px 0 0 !important;
                        animation: utils-sheet-up 0.3s cubic-bezier(0.22, 1, 0.36, 1) !important;
                        padding-bottom: env(safe-area-inset-bottom, 0px);
                    }
                    .utils-modal-overlay.closing .utils-modal-card {
                        animation: utils-sheet-down 0.25s ease-in forwards !important;
                    }
                }
            </style>
        `;

        const div = document.createElement('div');
        div.innerHTML = modalHtml;
        document.body.appendChild(div);

        // Add hover effects
        const buttons = div.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.onmouseenter = () => btn.style.opacity = '0.9';
            btn.onmouseleave = () => btn.style.opacity = '1';
        });
    },

    /**
     * Show an inline spinner inside a button (or any element) while an async
     * action runs, so the user can see the app is working on their request.
     *
     * Usage:
     *   const stop = Utils.startButtonLoader(btn, 'Archiving...');
     *   try { await doWork(); } finally { stop(); }
     *
     * @param {HTMLElement} el - button/element that triggered the action
     * @param {string} [label] - optional text next to the spinner
     * @returns {Function} restore function — returns the element to its original state
     */
    startButtonLoader: (el, label = '') => {
        if (!el) return () => { };

        // Inject spinner CSS once
        if (!document.getElementById('utils-loader-style')) {
            const style = document.createElement('style');
            style.id = 'utils-loader-style';
            style.textContent = `
                @keyframes utils-spin { to { transform: rotate(360deg); } }
                .utils-btn-spinner {
                    display: inline-block;
                    width: 13px; height: 13px;
                    border: 2px solid currentColor;
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: utils-spin 0.7s linear infinite;
                    vertical-align: -2px;
                    flex-shrink: 0;
                }
            `;
            document.head.appendChild(style);
        }

        let state = _buttonLoaderStates.get(el);
        if (!state) {
            state = {
                count: 0,
                original: {
                    html: el.innerHTML,
                    disabled: el.disabled,
                    pointerEvents: el.style.pointerEvents,
                    opacity: el.style.opacity
                }
            };
            _buttonLoaderStates.set(el, state);
        }
        state.count++;

        el.innerHTML = `<span class="utils-btn-spinner"></span>${label ? ' ' + label : ''}`;
        el.disabled = true;
        el.style.pointerEvents = 'none';
        el.style.opacity = '0.75';

        let restored = false;
        return () => {
            if (restored) return;
            restored = true;
            state.count--;
            if (state.count > 0) return; // another loader still active on this element
            _buttonLoaderStates.delete(el);
            el.innerHTML = state.original.html;
            el.disabled = state.original.disabled;
            el.style.pointerEvents = state.original.pointerEvents;
            el.style.opacity = state.original.opacity;
        };
    },

    /**
     * Dim an element (e.g. a card) while work happens on it.
     * @returns {Function} restore function
     */
    startElementLoader: (el) => {
        if (!el) return () => { };
        let state = _elementLoaderStates.get(el);
        if (!state) {
            state = {
                count: 0,
                original: { opacity: el.style.opacity, pointerEvents: el.style.pointerEvents }
            };
            _elementLoaderStates.set(el, state);
        }
        state.count++;

        el.style.opacity = '0.5';
        el.style.pointerEvents = 'none';
        el.style.transition = 'opacity 0.2s ease';

        let restored = false;
        return () => {
            if (restored) return;
            restored = true;
            state.count--;
            if (state.count > 0) return; // another loader still active on this element
            _elementLoaderStates.delete(el);
            el.style.opacity = state.original.opacity;
            el.style.pointerEvents = state.original.pointerEvents;
        };
    }
};

// If using in Electron/Node environment as well as browser
// Export for Node/Electron
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Utils;
}

// Always attach to window if we are in a browser-like environment (including Electron renderer)
window.Utils = Utils;
window.Utils = Utils;

// ============================================================
// MOBILE SIDEBAR — one implementation for the whole app
//
// Every page used to define its own toggleSidebarMobile() inline. Two
// conventions drifted apart: some toggled .open on the sidebar and .visible on
// the overlay (what main.css actually implements), while seven pages toggled
// .mobile-open and .active — class names no stylesheet defines, so on those
// pages the hamburger silently did nothing.
//
// The handler below is delegated off document and runs in the CAPTURE phase,
// which means it fires before any inline onclick on the button and works on
// markup that did not exist when this script loaded. stopPropagation keeps the
// page's own (possibly broken) handler from running afterwards and undoing it.
// ============================================================

var SIDEBAR_TRIGGERS = '.topbar-hamburger, .hamburger-btn, .mobile-menu-btn, #mobile-menu-btn';

window.openSidebarMobile = function () {
    var sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;
    var overlay = document.getElementById('sidebar-overlay');
    var closeBtn = sidebar.querySelector('.sidebar-close-btn');

    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('visible');
    if (closeBtn) closeBtn.style.display = 'flex';
};

window.closeSidebarMobile = function () {
    var sidebar = document.getElementById('app-sidebar');
    if (!sidebar) return;
    var overlay = document.getElementById('sidebar-overlay');
    var closeBtn = sidebar.querySelector('.sidebar-close-btn');

    // Both conventions are cleared: a page whose own open ran first may have
    // left the legacy class behind, and one stale class keeps a drawer pinned.
    sidebar.classList.remove('open', 'mobile-open');
    if (overlay) overlay.classList.remove('visible', 'active');
    if (closeBtn) closeBtn.style.display = 'none';

    // teacher-dashboard swaps its hamburger glyph to ✕ while the drawer is up.
    var glyphBtn = document.getElementById('mobile-menu-btn');
    if (glyphBtn && glyphBtn.textContent.trim() === '✕') glyphBtn.textContent = '☰';
};

// The hamburger opens — it never closes. When the drawer is up it sits behind
// the scrim, so a toggle there could only ever fire from a stale state and
// would read as the button doing nothing.
window.toggleSidebarMobile = function () {
    window.openSidebarMobile();
};

document.addEventListener('click', function (ev) {
    if (!ev.target || !ev.target.closest) return;

    if (ev.target.closest(SIDEBAR_TRIGGERS)) {
        ev.preventDefault();
        ev.stopPropagation();
        window.openSidebarMobile();
        return;
    }

    // The scrim and the X are the ways out. Delegated for the same reason as
    // the hamburger: a page whose own close clears only the legacy classes
    // would leave a drawer opened by the canonical open stuck on screen.
    if (ev.target.closest('.sidebar-overlay, .sidebar-close-btn')) {
        ev.preventDefault();
        ev.stopPropagation();
        window.closeSidebarMobile();
    }
}, true);

// ---- Reusable mobile action-bar "More" overflow menu ----
// Any page can drop a .mobile-action-bar with a #mab-more-menu overflow popup;
// these globals toggle it and close it on outside tap. See main.css.
window.toggleMabMore = function (e) {
    if (e) e.stopPropagation();
    var menu = document.getElementById('mab-more-menu');
    if (menu) menu.classList.toggle('open');
};
window.closeMabMore = function () {
    var menu = document.getElementById('mab-more-menu');
    if (menu) menu.classList.remove('open');
};
document.addEventListener('click', function (ev) {
    var menu = document.getElementById('mab-more-menu');
    if (menu && menu.classList.contains('open') && !ev.target.closest('.mab-more-wrap')) {
        menu.classList.remove('open');
    }
});

// Install the cached admin-configured term calendar (if any) synchronously,
// BEFORE the DOMContentLoaded data-default-term sweep below runs — so the
// first paint already uses the school's configured dates rather than the
// month-based fallback. Refreshed from the server in the background below.
try {
    const cachedCal = JSON.parse(localStorage.getItem('cbt_term_calendar') || 'null');
    if (cachedCal) Utils.setTermCalendar(cachedCal);
} catch (_) { /* corrupt cache — month rule still applies */ }
document.addEventListener('DOMContentLoaded', () => {
    Utils.initTheme();
    // Wait a bit for dataService to be available
    setTimeout(() => {
        Utils.makeLogoClickable();
    }, 100);

    // Auto-fill any term <select> tagged with data-default-term to the
    // current school term (see Utils.getCurrentTerm). JS-populated term
    // dropdowns call Utils.applyDefaultTerm themselves after populating.
    document.querySelectorAll('select[data-default-term]').forEach((el) => {
        Utils.applyDefaultTerm(el);
    });

    // Background-refresh the admin-configured term calendar from the server
    // (app_settings collection). Waits for dataService to initialize; fails
    // soft when offline or when the collection isn't deployed yet.
    setTimeout(() => {
        window.dataService?.loadTermCalendar?.().catch(() => { /* fallback rule stays */ });
    }, 500);

    // Click empty sidebar area to toggle collapse
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) {
        sidebar.addEventListener('click', (e) => {
            // Only toggle if the click was on an empty area of the sidebar
            const tag = e.target.tagName.toLowerCase();
            const interactive = ['button', 'a', 'input', 'select', 'option', 'textarea', 'label', 'span', 'svg', 'path', 'line', 'circle', 'polyline', 'rect', 'img'];
            if (interactive.includes(tag)) return;
            // Also skip if clicking inside an interactive parent
            if (e.target.closest('button, a, input, select, .sidebar-nav-item, .sidebar-stat-item, .sidebar-profile-info, .sidebar-cta, .dropdown-item, .sidebar-expand-toggle')) return;
            // Toggle
            if (typeof window.toggleTabletSidebar === 'function') {
                window.toggleTabletSidebar();
            }
        });
    }
});

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Adjust path based on current location
        const swPath = window.location.pathname.includes('/pages/') ? '../sw.js' : 'sw.js';
        navigator.serviceWorker.register(swPath)
            .then(reg => console.log('[SW] Registered at scope:', reg.scope))
            .catch(err => console.log('[SW] Registration failed:', err));
    });
}
