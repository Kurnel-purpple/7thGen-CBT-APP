/**
 * Proctor Watcher — light proctoring for the exam page.
 *
 * Loaded only by take-exam.html, and inert unless the exam itself asks for it
 * (exam.proctoring is "warn" or "strict"; anything else, including blank, is off).
 *
 *
 * WHAT THIS CAN AND CANNOT DO
 *
 * It cannot stop a student minimising, alt-tabbing or closing the page. No
 * browser API can: nothing fires *before* a minimise that a page is allowed to
 * cancel, and `visibilitychange` arrives after the window is already hidden.
 * So this detects and reacts; the deterrent is the warning the student was
 * shown before they started.
 *
 * The one action the browser does let a page interrupt is leaving the document
 * — close, reload, navigate away — via `beforeunload`. That gets the real
 * cancel-able prompt, and the two cases are handled differently on purpose:
 *
 *   LEAVING THE PAGE   the student is asked to confirm. Cancel and nothing at
 *                      all is recorded. Confirm and the attempt is submitted
 *                      immediately — they were shown a dialog and clicked
 *                      through it, which is a deliberate act, not a slip.
 *
 *   HIDING THE PAGE    there is nothing to confirm, so the grace period below
 *                      *is* the cancel window. Come back inside it and the
 *                      episode never happened. Stay away longer and it counts
 *                      as a strike: the first is a warning, the second submits.
 *
 *
 * GRACE PERIODS ARE PER PLATFORM, NOT PER SCREEN SIZE
 *
 * Android is far noisier than a desktop through no fault of the student — an
 * incoming call, a push banner, or the keyboard opening all background the app.
 * So the mobile window is much longer, and focus loss is ignored there
 * altogether. The check is the actual runtime (Capacitor / Electron / browser),
 * not the viewport: a small laptop window must not inherit phone rules.
 *
 *
 * WHY TIMESTAMPS RATHER THAN TIMERS
 *
 * Browsers throttle, and eventually freeze, timers in a hidden page, so a
 * setTimeout is not trustworthy for measuring how long someone was away. Every
 * decision here is made by comparing Date.now() on the way out and on the way
 * back. The timers are only an optimisation, so a strike that has clearly
 * already been earned can act while the page is still hidden instead of waiting
 * for a return that may never come.
 *
 * Strike counts are persisted, so reloading the page is not a way to wipe them.
 */

(function (root) {
    'use strict';

    var MODE_OFF = 'off';
    var MODE_WARN = 'warn';
    var MODE_STRICT = 'strict';

    var STRIKE_LIMIT = 2;

    // How long you may be away before it counts. See the header for why these
    // differ so much between platforms.
    var GRACE_HIDDEN_DESKTOP = 2000;
    var GRACE_HIDDEN_MOBILE = 15000;
    var GRACE_BLUR_DESKTOP = 5000;

    var MAX_EVENTS = 20;

    var ProctorWatcher = {
        mode: MODE_OFF,

        _active: false,
        _released: false,
        _config: null,
        _platform: 'web',
        _isMobile: false,

        _strikes: 0,
        _events: [],

        _hiddenAt: 0,
        _hiddenTimer: null,
        _episodeCounted: false,

        _blurTimer: null,

        _pending: null,
        _backHandle: null,
        _beaconSent: false,

        // ---------------------------------------------------------------
        // Lifecycle
        // ---------------------------------------------------------------

        /**
         * @param {Object} config
         *   mode                 'off' | 'warn' | 'strict'
         *   examId, userId       identify the attempt (used for the strike store)
         *   getRemainingSeconds  () => number, for the retake clock
         *   buildBeacon          () => object, a synchronously graded payload
         *   onWarn               (info) => void, first strike / every strike in warn mode
         *   onBreach             (info) => void, caller submits the exam
         *   onLeaveConfirmed     (info) => void, student confirmed leaving the page
         *   onNudge              (info) => void, soft prompt, no strike
         */
        start: function (config) {
            if (this._active) return;

            var mode = (config && config.mode) || MODE_OFF;
            if (mode !== MODE_WARN && mode !== MODE_STRICT) {
                this.mode = MODE_OFF;
                return;
            }

            this._config = config;
            this.mode = mode;
            this._active = true;
            this._released = false;
            this._beaconSent = false;

            this._detectPlatform();
            this._loadStrikes();
            this._bind();

            console.log('🛡️ Proctor Watcher: ' + mode + ' mode on ' + this._platform +
                ' (grace ' + this._graceHidden() + 'ms, strikes ' + this._strikes + '/' + STRIKE_LIMIT + ')');
        },

        /**
         * Stop watching. Called once the attempt is finished or is being left
         * legitimately — after this, nothing is recorded and no beacon fires.
         * Must run BEFORE the page navigates away on a normal submit, or the
         * unload handlers below would report that submit as a breach.
         */
        release: function () {
            if (!this._active) return;
            this._released = true;
            this._active = false;
            this._clearTimers();
            this._unbind();
            this.clearStrikes();
            console.log('🛡️ Proctor Watcher: released');
        },

        isActive: function () {
            return this._active && !this._released;
        },

        getStrikes: function () {
            return this._strikes;
        },

        getEvents: function () {
            return this._events.slice();
        },

        /**
         * Wipe the stored strikes for this attempt. Used when a teacher's retake
         * reopens the exam — the student starts the new attempt with a clean
         * sheet, otherwise a single stale strike would submit them instantly.
         */
        clearStrikes: function () {
            this._strikes = 0;
            this._events = [];
            try {
                localStorage.removeItem(this._storeKey());
            } catch (e) { /* best effort */ }
        },

        // ---------------------------------------------------------------
        // Platform + config
        // ---------------------------------------------------------------

        _detectPlatform: function () {
            var ua = navigator.userAgent || '';

            var isElectron = /Electron/i.test(ua) ||
                !!(root.process && root.process.versions && root.process.versions.electron);

            var isNative = !!(root.Capacitor &&
                typeof root.Capacitor.isNativePlatform === 'function' &&
                root.Capacitor.isNativePlatform());

            if (isElectron) {
                this._platform = 'electron';
                this._isMobile = false;
            } else if (isNative) {
                this._platform = (root.Capacitor.getPlatform && root.Capacitor.getPlatform()) || 'native';
                this._isMobile = true;
            } else {
                this._platform = 'web';
                // A browser on a phone gets the lenient treatment too — the same
                // interruptions apply. Touch capability alone is not enough
                // (touchscreen laptops exist), so pair it with a phone-ish UA.
                this._isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
            }
        },

        _graceHidden: function () {
            return this._isMobile ? GRACE_HIDDEN_MOBILE : GRACE_HIDDEN_DESKTOP;
        },

        _watchesFocus: function () {
            // Focus loss is a weak, noisy signal: OS notifications, the on-screen
            // keyboard and permission prompts all steal focus without the student
            // going anywhere. Only trusted on a real desktop browser.
            //
            // Electron is excluded despite being a desktop: the app's own native
            // dialogs — the updater, a print prompt, the supervisor override —
            // blur the page, and striking a student for an invigilator's key
            // press would be indefensible. Nothing is lost by it, because that is
            // the one platform where the window is genuinely locked, and
            // visibilitychange still catches any real hiding.
            return !this._isMobile && this._platform !== 'electron';
        },

        _storeKey: function () {
            var c = this._config || {};
            return 'cbt_proctor_' + (c.examId || 'x') + '_' + (c.userId || 'y');
        },

        _loadStrikes: function () {
            try {
                var raw = localStorage.getItem(this._storeKey());
                if (!raw) return;
                var saved = JSON.parse(raw);
                if (saved && typeof saved === 'object') {
                    this._strikes = Number(saved.strikes) || 0;
                    this._events = Array.isArray(saved.events) ? saved.events : [];
                }
            } catch (e) {
                // A corrupt store must not lock anyone out of an exam they are
                // sitting. Start the count fresh.
                this._strikes = 0;
                this._events = [];
            }
        },

        _saveStrikes: function () {
            try {
                localStorage.setItem(this._storeKey(), JSON.stringify({
                    strikes: this._strikes,
                    events: this._events.slice(-MAX_EVENTS)
                }));
            } catch (e) { /* best effort */ }
        },

        // ---------------------------------------------------------------
        // Event wiring
        // ---------------------------------------------------------------

        _bind: function () {
            var self = this;

            this._onVisibility = function () {
                if (document.hidden) self._onHidden();
                else self._onShown();
            };
            document.addEventListener('visibilitychange', this._onVisibility);

            if (this._watchesFocus()) {
                this._onBlur = function () { self._onFocusLost(); };
                this._onFocus = function () { self._onFocusBack(); };
                root.addEventListener('blur', this._onBlur);
                root.addEventListener('focus', this._onFocus);
            }

            // Both modes interrupt a close. Leaving the document is the ONE thing
            // a browser lets a page question before it happens, so it is the only
            // chance either mode gets to warn a student at the moment they act
            // rather than after the fact — worth taking even in warn mode, where
            // nothing is submitted and the student is free to confirm and go.
            this._onBeforeUnload = function (e) {
                if (!self.isActive()) return;
                e.preventDefault();
                // The wording is the browser's own and cannot be changed; the real
                // warning lives in the exam instructions and the on-page banner.
                e.returnValue = '';
                return '';
            };
            root.addEventListener('beforeunload', this._onBeforeUnload);

            this._onPageHide = function (e) {
                if (!self.isActive()) return;
                // persisted means the page went into the back/forward cache and
                // may well come back — on iOS this is an ordinary app switch,
                // which the visibility path already handles properly.
                if (e && e.persisted) return;
                self._reportLeaving('left_page');
            };
            root.addEventListener('pagehide', this._onPageHide);

            this._bindAndroidBack();
        },

        _unbind: function () {
            if (this._onVisibility) {
                document.removeEventListener('visibilitychange', this._onVisibility);
                this._onVisibility = null;
            }
            if (this._onBlur) {
                root.removeEventListener('blur', this._onBlur);
                this._onBlur = null;
            }
            if (this._onFocus) {
                root.removeEventListener('focus', this._onFocus);
                this._onFocus = null;
            }
            if (this._onBeforeUnload) {
                root.removeEventListener('beforeunload', this._onBeforeUnload);
                this._onBeforeUnload = null;
            }
            if (this._onPageHide) {
                root.removeEventListener('pagehide', this._onPageHide);
                this._onPageHide = null;
            }
            if (this._backHandle) {
                try {
                    if (typeof this._backHandle.remove === 'function') this._backHandle.remove();
                } catch (e) { /* best effort */ }
                this._backHandle = null;
            }
        },

        _clearTimers: function () {
            if (this._hiddenTimer) { clearTimeout(this._hiddenTimer); this._hiddenTimer = null; }
            if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
        },

        /**
         * The Android hardware/gesture back button does not reliably fire
         * `beforeunload` inside a Capacitor WebView, so it needs its own
         * listener — and gets a properly worded in-app confirm instead of the
         * browser's generic one. Registering a listener also suppresses
         * Capacitor's default "go back / exit app" behaviour, which is what
         * stops a stray swipe dropping the student out of the paper.
         */
        _bindAndroidBack: function () {
            var self = this;
            if (this._platform !== 'android') return;

            var App = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.App;
            if (!App || typeof App.addListener !== 'function') return;

            try {
                var handle = App.addListener('backButton', function () {
                    if (!self.isActive()) return;

                    if (self.mode !== MODE_STRICT) {
                        self._nudge('back_button');
                        return;
                    }

                    var ask = (root.Utils && Utils.showConfirm)
                        ? Utils.showConfirm(
                            'Leave the exam?',
                            'Leaving now will submit your exam automatically and you will not be able to return to it.\n\nAre you sure?')
                        : Promise.resolve(root.confirm('Leaving now will submit your exam automatically. Are you sure?'));

                    ask.then(function (ok) {
                        // Cancelled: nothing happened. No strike, nothing recorded.
                        if (!ok) return;
                        self._confirmedLeave('back_button');
                    });
                });

                // Older Capacitor returns the handle directly, newer a promise.
                if (handle && typeof handle.then === 'function') {
                    handle.then(function (h) { self._backHandle = h; });
                } else {
                    this._backHandle = handle;
                }
            } catch (e) {
                console.warn('[Proctor] Could not bind the back button:', e);
            }
        },

        // ---------------------------------------------------------------
        // Hiding the page
        // ---------------------------------------------------------------

        _onHidden: function () {
            if (!this.isActive()) return;

            this._hiddenAt = Date.now();
            this._episodeCounted = false;

            var self = this;
            var grace = this._graceHidden();

            // Best-effort only: a hidden page's timers are throttled and may be
            // frozen entirely. If this does fire it lets a second strike act
            // without waiting for a return that might never come. If it does
            // not, _onShown recomputes the same thing from the timestamps.
            this._hiddenTimer = setTimeout(function () {
                if (!self.isActive()) return;
                if (!document.hidden || self._episodeCounted) return;
                self._episodeCounted = true;
                self._registerAway('minimized', Date.now() - self._hiddenAt);
            }, grace + 250);
        },

        _onShown: function () {
            if (this._hiddenTimer) { clearTimeout(this._hiddenTimer); this._hiddenTimer = null; }
            if (!this.isActive()) return;

            var away = this._hiddenAt ? (Date.now() - this._hiddenAt) : 0;
            this._hiddenAt = 0;

            // Back inside the grace window — this is the "cancel". Nothing is
            // recorded, nothing is shown, the student just carries on.
            if (!this._episodeCounted && away > this._graceHidden()) {
                this._episodeCounted = true;
                this._registerAway('minimized', away);
            }

            this._flush();
        },

        _onFocusLost: function () {
            if (!this.isActive()) return;
            // Minimising fires both blur and visibilitychange. Visibility is the
            // stronger signal and owns that case; counting both would double-strike.
            if (document.hidden) return;

            var self = this;
            var since = Date.now();
            if (this._blurTimer) clearTimeout(this._blurTimer);
            this._blurTimer = setTimeout(function () {
                if (!self.isActive() || document.hidden) return;
                if (document.hasFocus && document.hasFocus()) return;
                self._registerAway('lost_focus', Date.now() - since);
            }, GRACE_BLUR_DESKTOP);
        },

        _onFocusBack: function () {
            if (this._blurTimer) { clearTimeout(this._blurTimer); this._blurTimer = null; }
            if (!this.isActive()) return;
            this._flush();
        },

        // ---------------------------------------------------------------
        // Strikes
        // ---------------------------------------------------------------

        _registerAway: function (reason, awayMs) {
            this._strikes += 1;
            this._events.push({
                type: reason,
                at: new Date().toISOString(),
                awayMs: Math.round(awayMs || 0),
                platform: this._platform
            });
            if (this._events.length > MAX_EVENTS) {
                this._events = this._events.slice(-MAX_EVENTS);
            }
            this._saveStrikes();

            console.log('🛡️ Proctor: strike ' + this._strikes + '/' + STRIKE_LIMIT +
                ' (' + reason + ', away ' + Math.round(awayMs / 1000) + 's)');

            // Warn mode observes and warns, but never submits and never locks.
            if (this.mode === MODE_WARN) {
                this._pending = { type: 'warn', reason: reason, strikes: this._strikes, awayMs: awayMs };
                if (!document.hidden) this._flush();
                return;
            }

            if (this._strikes >= STRIKE_LIMIT) {
                // Act now rather than queueing it. The submission is a normal
                // async call and works in a hidden page; deferring it until they
                // came back would mean an attempt abandoned mid-breach was never
                // finalised at all.
                this._pending = null;
                this._breach(reason, awayMs);
                return;
            }

            this._pending = { type: 'warn', reason: reason, strikes: this._strikes, awayMs: awayMs };
            if (!document.hidden) this._flush();
        },

        /** Deliver whatever was queued, now that the student can actually see it. */
        _flush: function () {
            var pending = this._pending;
            if (!pending) return;
            this._pending = null;

            if (pending.type === 'warn') {
                this._emit('onWarn', {
                    reason: pending.reason,
                    strikes: pending.strikes,
                    remaining: Math.max(0, STRIKE_LIMIT - pending.strikes),
                    awayMs: pending.awayMs,
                    mode: this.mode
                });
            }
        },

        _breach: function (reason, awayMs) {
            if (!this.isActive()) return;
            var info = {
                reason: reason,
                strikes: this._strikes,
                awayMs: awayMs || 0,
                events: this.getEvents(),
                remainingSeconds: this._remainingSeconds(),
                mode: this.mode
            };

            // Written before the submission is attempted, not after. The submit
            // may only reach the offline queue, and until that queue drains the
            // server still shows the attempt as open — so without a local marker
            // the student could simply reload and carry on. takeExam removes it
            // once the result is genuinely on the server.
            this._markLocalBreach(reason);
            // Stop watching first: the submit navigates and tears the page down,
            // and that must not be reported as a second breach.
            this._active = false;
            this._released = true;
            this._clearTimers();
            this._unbind();
            this._emit('onBreach', info);
        },

        _nudge: function (reason) {
            this._emit('onNudge', { reason: reason, mode: this.mode });
        },

        _emit: function (name, info) {
            var fn = this._config && this._config[name];
            if (typeof fn !== 'function') return;
            try {
                fn(info);
            } catch (e) {
                console.error('[Proctor] handler ' + name + ' failed:', e);
            }
        },

        _remainingSeconds: function () {
            var fn = this._config && this._config.getRemainingSeconds;
            if (typeof fn !== 'function') return null;
            try {
                var n = Number(fn());
                return Number.isFinite(n) ? n : null;
            } catch (e) {
                return null;
            }
        },

        // ---------------------------------------------------------------
        // Leaving the page
        // ---------------------------------------------------------------

        /**
         * The student confirmed an in-app "are you sure" (Android back). The page
         * is still alive here, so the normal submit path can run properly.
         */
        _confirmedLeave: function (reason) {
            this._emit('onLeaveConfirmed', { reason: reason, mode: this.mode });
            this._breach(reason, 0);
        },

        /**
         * The page is being destroyed right now. Nothing asynchronous will
         * survive this, so the whole attempt goes out in one beacon.
         */
        _reportLeaving: function (reason) {
            // Warn mode reports too, so "this has been recorded for your teacher"
            // is true of a close and not only of a switch. The payload carries the
            // mode and the server decides what it means: strict locks the attempt,
            // warn only writes the incident down.
            this._sendBeacon(reason);
        },

        _sendBeacon: function (reason) {
            if (this._beaconSent) return;
            this._beaconSent = true;

            try {
                var pb = root.dataService && root.dataService.pb;
                if (!pb || !pb.authStore || !pb.authStore.token) return;
                if (!navigator.sendBeacon) return;

                var payload = {};
                var build = this._config && this._config.buildBeacon;
                if (typeof build === 'function') {
                    try {
                        payload = build() || {};
                    } catch (e) {
                        // Grading failed. Still report the breach — a locked
                        // attempt a teacher can finalise beats a silent one.
                        console.error('[Proctor] could not grade for the beacon:', e);
                        payload = {};
                    }
                }

                payload.token = pb.authStore.token;
                payload.examId = (this._config && this._config.examId) || '';
                payload.mode = this.mode;
                payload.reason = reason;
                payload.strikes = Math.max(this._strikes, 1);
                payload.remainingSeconds = this._remainingSeconds();
                payload.events = this.getEvents().concat([{
                    type: reason,
                    at: new Date().toISOString(),
                    awayMs: 0,
                    platform: this._platform
                }]);

                var url = String(pb.baseUrl || '').replace(/\/$/, '') + '/api/cbt/proctor-breach';
                var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
                var queued = navigator.sendBeacon(url, blob);

                // The server write may not land — the device can be offline, or
                // the beacon can simply be dropped. Leave a local marker so THIS
                // device refuses to resume the attempt either way; takeExam syncs
                // it up on the next load. No-op in warn mode — see _markLocalBreach.
                this._markLocalBreach(reason);

                console.log('🛡️ Proctor: breach beacon ' + (queued ? 'queued' : 'refused'));
            } catch (e) {
                try { this._markLocalBreach(reason); } catch (e2) { /* best effort */ }
            }
        },

        /**
         * The offline half of the lockout. A breach recorded here survives a
         * failed beacon, so a student cannot get their attempt back simply by
         * pulling the network cable before closing the page.
         */
        _markLocalBreach: function (reason) {
            // Strict only, enforced here so no caller can get it wrong. A
            // warn-mode incident is recorded but never punished, and this marker
            // is what stops a device resuming an attempt — writing it would lock a
            // student out of an exam that by definition never locks anyone out.
            if (this.mode !== MODE_STRICT) return;

            var c = this._config || {};
            try {
                localStorage.setItem('cbt_proctor_breach_' + (c.examId || 'x') + '_' + (c.userId || 'y'),
                    JSON.stringify({
                        breached: true,
                        reason: reason,
                        at: new Date().toISOString(),
                        strikes: Math.max(this._strikes, 1),
                        remainingSeconds: this._remainingSeconds(),
                        events: this.getEvents(),
                        synced: false
                    }));
            } catch (e) { /* best effort */ }
        }
    };

    // ---------------------------------------------------------------
    // Local breach marker — read by takeExam before an attempt resumes
    // ---------------------------------------------------------------

    ProctorWatcher.readLocalBreach = function (examId, userId) {
        try {
            var raw = localStorage.getItem('cbt_proctor_breach_' + examId + '_' + userId);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return (parsed && parsed.breached) ? parsed : null;
        } catch (e) {
            return null;
        }
    };

    /**
     * Reset the strike count for an attempt without needing a running watcher.
     * Used when a teacher's retake reopens the exam: the student must start the
     * new attempt on zero, or one leftover strike would submit them the first
     * time they so much as switched windows.
     */
    ProctorWatcher.clearStrikesFor = function (examId, userId) {
        try {
            localStorage.removeItem('cbt_proctor_' + examId + '_' + userId);
        } catch (e) { /* best effort */ }
    };

    ProctorWatcher.clearLocalBreach = function (examId, userId) {
        try {
            localStorage.removeItem('cbt_proctor_breach_' + examId + '_' + userId);
        } catch (e) { /* best effort */ }
    };

    ProctorWatcher.markLocalBreachSynced = function (examId, userId) {
        try {
            var key = 'cbt_proctor_breach_' + examId + '_' + userId;
            var raw = localStorage.getItem(key);
            if (!raw) return;
            var parsed = JSON.parse(raw) || {};
            parsed.synced = true;
            localStorage.setItem(key, JSON.stringify(parsed));
        } catch (e) { /* best effort */ }
    };

    ProctorWatcher.STRIKE_LIMIT = STRIKE_LIMIT;
    ProctorWatcher.MODE_OFF = MODE_OFF;
    ProctorWatcher.MODE_WARN = MODE_WARN;
    ProctorWatcher.MODE_STRICT = MODE_STRICT;

    root.ProctorWatcher = ProctorWatcher;
})(typeof window !== 'undefined' ? window : this);
