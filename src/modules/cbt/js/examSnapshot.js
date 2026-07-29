/**
 * Exam Builder Snapshot
 *
 * Parks the whole in-progress exam — form fields, questions, uploaded media —
 * so the builder can navigate away to a full page (the Question Bank picker)
 * and come back with nothing lost.
 *
 * IndexedDB first, sessionStorage as a fallback. Media is stored as base64
 * data URLs, and an exam with a handful of diagrams will blow through
 * sessionStorage's ~5MB ceiling, so the larger store has to be the primary one.
 *
 * The snapshot is consume-once: reading it clears it, so a stale draft can
 * never silently reappear over a fresh exam.
 */

(function(root) {
    'use strict';

    var KEY = 'examBuilderSnapshot';
    var SESSION_KEY = 'cbt.examBuilderSnapshot';

    // A snapshot older than this is treated as abandoned rather than restored
    // over whatever the teacher is doing now.
    var MAX_AGE_MS = 30 * 60 * 1000;

    function hasIdb() {
        return !!(root.idb && typeof root.idb.saveDashboardCache === 'function'
            && typeof root.idb.getDashboardCache === 'function');
    }

    /**
     * @param {Object} snapshot
     * @returns {Promise<boolean>} whether it was stored
     */
    async function save(snapshot) {
        var payload = Object.assign({}, snapshot, { savedAt: Date.now() });

        if (hasIdb()) {
            try {
                await root.idb.saveDashboardCache(KEY, payload);
                return true;
            } catch (err) {
                console.warn('[examSnapshot] IndexedDB save failed, falling back to sessionStorage:', err);
            }
        }

        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
            return true;
        } catch (err) {
            // Almost always the quota: a media-heavy exam does not fit.
            console.error('[examSnapshot] Could not park the exam draft:', err);
            return false;
        }
    }

    /**
     * Read and clear the snapshot.
     * @returns {Promise<Object|null>} null when absent or too old
     */
    async function consume() {
        var payload = null;

        if (hasIdb()) {
            try {
                var row = await root.idb.getDashboardCache(KEY);
                if (row && row.data) payload = row.data;
            } catch (err) {
                console.warn('[examSnapshot] IndexedDB read failed:', err);
            }
        }

        if (!payload) {
            try {
                var raw = sessionStorage.getItem(SESSION_KEY);
                if (raw) payload = JSON.parse(raw);
            } catch (err) {
                console.warn('[examSnapshot] sessionStorage read failed:', err);
            }
        }

        await clear();

        if (!payload) return null;
        if (payload.savedAt && (Date.now() - payload.savedAt) > MAX_AGE_MS) {
            console.warn('[examSnapshot] Ignoring a stale exam snapshot.');
            return null;
        }
        return payload;
    }

    /**
     * Read without clearing — for the picker page, which needs the exam's
     * subject and existing questions but must leave the snapshot in place for
     * the builder to restore from.
     */
    async function peek() {
        if (hasIdb()) {
            try {
                var row = await root.idb.getDashboardCache(KEY);
                if (row && row.data) return row.data;
            } catch (err) {
                console.warn('[examSnapshot] IndexedDB peek failed:', err);
            }
        }
        try {
            var raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (err) {
            return null;
        }
    }

    async function clear() {
        if (hasIdb()) {
            try {
                await root.idb.saveDashboardCache(KEY, null);
            } catch (err) {
                console.warn('[examSnapshot] IndexedDB clear failed:', err);
            }
        }
        try {
            sessionStorage.removeItem(SESSION_KEY);
        } catch (err) { /* nothing useful to do */ }
    }

    root.ExamSnapshot = { save: save, consume: consume, peek: peek, clear: clear, MAX_AGE_MS: MAX_AGE_MS };
})(typeof window !== 'undefined' ? window : this);
