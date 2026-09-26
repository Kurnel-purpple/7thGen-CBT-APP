/**
 * Exam Kiosk — the desktop half of light proctoring.
 *
 * A thin renderer-side wrapper over the EXAM LOCK section of main.js. On the web
 * and on Android every method here is a no-op, so takeExam can call them
 * unconditionally and stay free of platform branches.
 *
 * Only strict-mode exams lock. The page's own watcher (proctorWatcher.js) runs
 * either way and remains the thing that decides what a breach costs — the kiosk
 * just makes the easy escapes stop working.
 *
 *
 * THE HEARTBEAT IS NOT OPTIONAL
 *
 * A locked window is one whose close and minimise buttons genuinely do nothing.
 * If this page dies without unlocking, the student is sealed in. So main.js
 * releases the lock on its own if the beats stop for 90 seconds, and this sends
 * one every 30. Two can be missed to a slow machine before anything happens;
 * a page that has actually died never sends a third.
 *
 * That watchdog is the reason the lock is safe to apply at all, and it is why
 * the interval below must keep running for as long as the lock is held.
 */

(function (root) {
    'use strict';

    var HEARTBEAT_MS = 30 * 1000;

    var ipc = null;
    try {
        // nodeIntegration is on and contextIsolation off in this app's
        // BrowserWindow, so the renderer can reach ipcRenderer directly. Anywhere
        // that is not Electron, this throws and the module stays inert.
        if (typeof require === 'function') {
            ipc = require('electron').ipcRenderer;
        }
    } catch (e) {
        ipc = null;
    }

    var ExamKiosk = {
        _locked: false,
        _beat: null,
        _onBlocked: null,
        _onPageHide: null,

        isAvailable: function () {
            return !!ipc;
        },

        isLocked: function () {
            return this._locked;
        },

        /**
         * @param {Object} opts
         *   examId
         *   durationSeconds  the full exam clock; main.js uses it only to size
         *                    its hard-timeout failsafe
         *   mode             'strict' locks the window down; 'warn' leaves it
         *                    alone but intercepts the first minimise and the
         *                    first close so the student is warned on the click
         *   onBlockedAction  (action) => void, fired when main.js stops one of
         *                    those. 'minimize' | 'close'
         * @returns {Promise<boolean>} whether the window actually locked
         */
        lock: function (opts) {
            var self = this;
            if (!ipc) return Promise.resolve(false);
            if (this._locked) return Promise.resolve(true);

            // Registered before the lock request, so an interception that happens
            // immediately cannot arrive before anything is listening for it.
            if (opts && typeof opts.onBlockedAction === 'function') {
                this._onBlocked = function (event, action) {
                    try {
                        opts.onBlockedAction(action);
                    } catch (e) {
                        console.error('[ExamKiosk] blocked-action handler failed:', e);
                    }
                };
                ipc.on('exam:blocked-action', this._onBlocked);
            }

            return ipc.invoke('exam:lock', {
                examId: (opts && opts.examId) || '',
                durationSeconds: (opts && opts.durationSeconds) || 0,
                mode: (opts && opts.mode) || 'strict'
            }).then(function (res) {
                if (!res || !res.locked) {
                    console.warn('[ExamKiosk] the window did not lock:', res && res.reason);
                    return false;
                }

                self._locked = true;
                self._startHeartbeat();

                // Last-ditch release. If the page is torn down some way that never
                // reaches takeExam's submit path, this still fires — ipcRenderer.send
                // is synchronous, so it survives an unload where a fetch would not.
                self._onPageHide = function () { self.release(); };
                root.addEventListener('pagehide', self._onPageHide);

                console.log('🖥️ Exam Kiosk: window locked');
                return true;
            }).catch(function (err) {
                console.error('[ExamKiosk] lock failed:', err);
                return false;
            });
        },

        release: function () {
            if (!ipc) return;
            this._stopHeartbeat();

            if (this._onBlocked) {
                try { ipc.removeListener('exam:blocked-action', this._onBlocked); } catch (e) { /* best effort */ }
                this._onBlocked = null;
            }

            if (this._onPageHide) {
                try { root.removeEventListener('pagehide', this._onPageHide); } catch (e) { /* best effort */ }
                this._onPageHide = null;
            }

            // Sent even when this page never locked: another page in the same
            // window may have, and an unlock nobody needed is harmless while a
            // lock nobody clears is not.
            try {
                ipc.send('exam:unlock');
            } catch (e) {
                console.warn('[ExamKiosk] unlock message failed:', e);
            }

            if (this._locked) console.log('🖥️ Exam Kiosk: window released');
            this._locked = false;
        },

        _startHeartbeat: function () {
            var self = this;
            this._stopHeartbeat();
            this._beat = setInterval(function () {
                if (!self._locked || !ipc) return;
                try { ipc.send('exam:heartbeat'); } catch (e) { /* watchdog will handle it */ }
            }, HEARTBEAT_MS);
        },

        _stopHeartbeat: function () {
            if (this._beat) {
                clearInterval(this._beat);
                this._beat = null;
            }
        }
    };

    root.ExamKiosk = ExamKiosk;
})(typeof window !== 'undefined' ? window : this);
