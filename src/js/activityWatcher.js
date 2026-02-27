/**
 * Activity Watcher Module
 * Monitors student inactivity and auto-logs them out after 3-5 minutes.
 * Only activates for student role accounts.
 */

const ActivityWatcher = {
    INACTIVITY_TIMEOUT: 4 * 60 * 1000, // 4 minutes (middle ground between 3-5)
    WARNING_BEFORE: 60 * 1000,          // Show warning 1 minute before logout
    _timer: null,
    _warningTimer: null,
    _warningOverlay: null,
    _countdownInterval: null,
    _active: false,
    _paused: false,

    /**
     * Initialize the activity watcher. Only activates for students.
     */
    init() {
        // Only activate for students
        if (!window.dataService) return;
        const user = window.dataService.getCurrentUser();
        if (!user || user.role !== 'student') return;

        this._active = true;
        this._bindEvents();
        this._resetTimer();
        console.log('👁️ Activity Watcher: Initialized (4 min timeout for students)');
    },

    /**
     * Bind all user activity events
     */
    _bindEvents() {
        const events = [
            'mousemove', 'mousedown', 'keydown', 'keypress',
            'touchstart', 'touchmove', 'scroll', 'click', 'wheel'
        ];

        this._activityHandler = () => this._onActivity();
        events.forEach(event => {
            document.addEventListener(event, this._activityHandler, { passive: true });
        });

        // Also track visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                // Tab is hidden — don't reset timer (inactivity continues)
            } else {
                // Tab is visible again — check if we should still be logged in
                this._onActivity();
            }
        });
    },

    /**
     * Called on any user activity
     */
    _onActivity() {
        if (!this._active || this._paused) return;

        // Dismiss warning if showing
        if (this._warningOverlay) {
            this._dismissWarning();
        }

        this._resetTimer();
    },

    /**
     * Reset the inactivity timer
     */
    _resetTimer() {
        if (this._timer) clearTimeout(this._timer);
        if (this._warningTimer) clearTimeout(this._warningTimer);

        // Set warning timer (fires 1 minute before logout)
        this._warningTimer = setTimeout(() => {
            this._showWarning();
        }, this.INACTIVITY_TIMEOUT - this.WARNING_BEFORE);

        // Set logout timer
        this._timer = setTimeout(() => {
            this._performLogout();
        }, this.INACTIVITY_TIMEOUT);
    },

    /**
     * Show inactivity warning overlay
     */
    _showWarning() {
        if (this._warningOverlay) return; // Already showing

        const overlay = document.createElement('div');
        overlay.id = 'inactivity-warning-overlay';
        overlay.innerHTML = `
            <div class="inactivity-warning-card">
                <div class="inactivity-icon">⏰</div>
                <h3 class="inactivity-title">Are you still there?</h3>
                <p class="inactivity-message">
                    You'll be logged out in <span id="inactivity-countdown">60</span> seconds due to inactivity.
                </p>
                <div class="inactivity-progress-bar">
                    <div class="inactivity-progress-fill" id="inactivity-progress"></div>
                </div>
                <button class="inactivity-btn" id="inactivity-stay-btn">
                    ✋ I'm Still Here
                </button>
            </div>
        `;

        document.body.appendChild(overlay);
        this._warningOverlay = overlay;

        // Add click handler for "I'm still here" button
        document.getElementById('inactivity-stay-btn').addEventListener('click', () => {
            this._onActivity();
        });

        // Start countdown
        let secondsLeft = 60;
        const countdownEl = document.getElementById('inactivity-countdown');
        const progressEl = document.getElementById('inactivity-progress');

        this._countdownInterval = setInterval(() => {
            secondsLeft--;
            if (countdownEl) countdownEl.textContent = secondsLeft;
            if (progressEl) {
                progressEl.style.width = `${(secondsLeft / 60) * 100}%`;
            }
            if (secondsLeft <= 0) {
                clearInterval(this._countdownInterval);
            }
        }, 1000);
    },

    /**
     * Dismiss the warning overlay
     */
    _dismissWarning() {
        if (this._warningOverlay) {
            this._warningOverlay.remove();
            this._warningOverlay = null;
        }
        if (this._countdownInterval) {
            clearInterval(this._countdownInterval);
            this._countdownInterval = null;
        }
    },

    /**
     * Perform the auto-logout
     */
    _performLogout() {
        this._dismissWarning();
        this._active = false;
        console.log('👁️ Activity Watcher: Auto-logging out student due to inactivity');

        // Show a quick notification before redirecting
        if (window.Utils && window.Utils.showToast) {
            Utils.showToast('Logged out due to inactivity', 'info');
        }

        // Logout after a brief delay
        setTimeout(() => {
            if (window.auth && window.auth.logout) {
                auth.logout();
            } else if (window.dataService) {
                dataService.logout();
                if (window.location.pathname.includes('/pages/')) {
                    window.location.href = '../index.html';
                } else {
                    window.location.href = 'index.html';
                }
            }
        }, 500);
    },

    /**
     * Pause the watcher (e.g. during an exam where a separate timer manages things)
     */
    pause() {
        this._paused = true;
        if (this._timer) clearTimeout(this._timer);
        if (this._warningTimer) clearTimeout(this._warningTimer);
        this._dismissWarning();
    },

    /**
     * Resume the watcher
     */
    resume() {
        this._paused = false;
        this._resetTimer();
    },

    /**
     * Completely destroy the watcher
     */
    destroy() {
        this._active = false;
        if (this._timer) clearTimeout(this._timer);
        if (this._warningTimer) clearTimeout(this._warningTimer);
        this._dismissWarning();

        if (this._activityHandler) {
            const events = [
                'mousemove', 'mousedown', 'keydown', 'keypress',
                'touchstart', 'touchmove', 'scroll', 'click', 'wheel'
            ];
            events.forEach(event => {
                document.removeEventListener(event, this._activityHandler);
            });
        }
    }
};

// Expose globally
window.ActivityWatcher = ActivityWatcher;

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to let dataService initialize
    setTimeout(() => {
        ActivityWatcher.init();
    }, 1000);
});
