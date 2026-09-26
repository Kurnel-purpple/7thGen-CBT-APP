/**
 * Per-school branding — the school's own name, logo and colours.
 *
 * WHY THIS EXISTS
 * Branding used to live only in src/config/clients/<id>.js, a static file that
 * ships with the app. That works for one hand-tuned client (seatos) but means a
 * new school cannot change its own colours without a code edit and a redeploy.
 * This module moves the small, safe subset of those values into app_settings —
 * already per-school, already admin-writable — so a school admin can set them
 * from the dashboard, and the static config becomes the default they start from.
 *
 * WHAT A SCHOOL CAN SET, AND WHY SO LITTLE
 * themeApplier reads ~30 branding values. Asking an admin for 30 colours would
 * produce unreadable apps — dark text on dark backgrounds, failing contrast.
 * So a school sets five things (name, logo, primary, secondary, accent) and the
 * rest is DERIVED here. Backgrounds, card surfaces, borders and status colours
 * are deliberately NOT settable: they are what keeps the app legible.
 *
 * THE READABILITY GUARDRAIL
 * The app paints white text on --primary-color throughout. A school that picks a
 * pale yellow would get white-on-yellow buttons. Rather than refuse the colour,
 * `clampForWhiteText` darkens it just until it clears WCAG AA (4.5:1), so any
 * colour they choose stays usable. Their choice is respected as far as it can be.
 *
 * Loaded as a CLASSIC script (like imageUpload.js), not an ES module, so it can
 * sit in a page's `globalScripts` list and still be read by themeApplier.
 */
(function (global) {
    'use strict';

    // app_settings key. One JSON blob per school, same pattern as
    // "report_card_template" and "term_calendar".
    const SETTING_KEY = 'school_theme';

    // Mirrors the DB value so the theme can be applied before first paint —
    // the DB read needs auth and a school context, neither of which exists
    // when the page starts painting. Same trick the dark-mode toggle uses.
    const CACHE_KEY = 'cbt_school_theme';

    // ---------------------------------------------------------------- colour

    function clamp(n, lo, hi) {
        return Math.min(hi, Math.max(lo, n));
    }

    function hexToRgb(hex) {
        let h = String(hex || '').trim().replace(/^#/, '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        if (h.length === 8) h = h.slice(0, 6);   // drop alpha, we don't use it
        if (!/^[0-9a-f]{6}$/i.test(h)) return null;
        return {
            r: parseInt(h.slice(0, 2), 16),
            g: parseInt(h.slice(2, 4), 16),
            b: parseInt(h.slice(4, 6), 16)
        };
    }

    function rgbToHex(rgb) {
        const to2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
        return '#' + to2(rgb.r) + to2(rgb.g) + to2(rgb.b);
    }

    /** Move a colour toward black (amount < 0) or white (amount > 0), 0..1. */
    function shift(hex, amount) {
        const rgb = hexToRgb(hex);
        if (!rgb) return hex;
        const target = amount > 0 ? 255 : 0;
        const t = Math.abs(amount);
        return rgbToHex({
            r: rgb.r + (target - rgb.r) * t,
            g: rgb.g + (target - rgb.g) * t,
            b: rgb.b + (target - rgb.b) * t
        });
    }

    const darken = (hex, amount) => shift(hex, -amount);
    const lighten = (hex, amount) => shift(hex, amount);

    /** WCAG relative luminance. */
    function luminance(hex) {
        const rgb = hexToRgb(hex);
        if (!rgb) return 0;
        const channel = (v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
    }

    /** WCAG contrast ratio between two colours, 1..21. */
    function contrast(a, b) {
        const la = luminance(a);
        const lb = luminance(b);
        return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }

    /**
     * Darken a colour just enough that white text on it clears WCAG AA (4.5:1).
     * A colour that already passes is returned untouched, so a school that picks
     * a sensible blue gets exactly the blue it picked.
     */
    function clampForWhiteText(hex, minRatio) {
        const target = minRatio || 4.5;
        if (!hexToRgb(hex)) return hex;
        let out = hex;
        // 2% steps: fine enough that the result still reads as their colour,
        // bounded so a pathological input cannot spin here.
        for (let i = 0; i < 50 && contrast(out, '#ffffff') < target; i++) {
            out = darken(out, 0.02);
        }
        return out;
    }

    // ----------------------------------------------------------- derivation

    /** The five fields a school actually sets. Anything else is ignored. */
    function normalize(theme) {
        const t = theme || {};
        const hex = (v) => (hexToRgb(v) ? String(v).trim() : '');
        return {
            schoolName: String(t.schoolName || '').trim().slice(0, 80),
            logoUrl: String(t.logoUrl || '').trim(),
            primaryColor: hex(t.primaryColor),
            secondaryColor: hex(t.secondaryColor),
            accentColor: hex(t.accentColor)
        };
    }

    function isEmpty(theme) {
        const t = normalize(theme);
        return !t.schoolName && !t.logoUrl && !t.primaryColor &&
            !t.secondaryColor && !t.accentColor;
    }

    /**
     * Merge a school's choices over the client config's branding and derive the
     * values the school never sees. Returns a full branding object of the same
     * shape themeApplier already expects, so nothing downstream has to change.
     *
     * Unset fields fall through to `base`, which is why a school that only
     * changes its primary colour keeps every other value from the config file.
     */
    function deriveBranding(theme, base) {
        const t = normalize(theme);
        const b = base || {};
        const out = JSON.parse(JSON.stringify(b));

        if (t.primaryColor) {
            const primary = clampForWhiteText(t.primaryColor);
            out.primaryColor = primary;
            out.primaryHover = darken(primary, 0.12);
            out.darkMode = out.darkMode || {};
            // Dark surfaces need a brighter brand colour to hold the same weight.
            out.darkMode.primaryColor = lighten(primary, 0.15);
        }

        if (t.secondaryColor) {
            out.secondaryColor = t.secondaryColor;
        }

        if (t.accentColor) {
            out.accentColor = t.accentColor;
        }

        // Backgrounds, card surfaces, borders, text and status colours are left
        // exactly as the config file set them — see the header note.
        return out;
    }

    // --------------------------------------------------------------- storage

    /**
     * Synchronous read of the last known theme, for use before the network is
     * available. Returns null when there is nothing cached or the entry is
     * unreadable — callers must render correctly without it.
     */
    function getCached() {
        try {
            const raw = global.localStorage && global.localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return isEmpty(parsed) ? null : normalize(parsed);
        } catch (err) {
            return null;
        }
    }

    function setCached(theme) {
        try {
            if (!global.localStorage) return;
            if (!theme || isEmpty(theme)) {
                global.localStorage.removeItem(CACHE_KEY);
                return;
            }
            global.localStorage.setItem(CACHE_KEY, JSON.stringify(normalize(theme)));
        } catch (err) {
            // Private mode, blocked storage, quota — the app still works, it
            // just repaints once after the network read instead of before.
        }
    }

    function clearCached() {
        try {
            if (global.localStorage) global.localStorage.removeItem(CACHE_KEY);
        } catch (err) { /* nothing to clean up */ }
    }

    /**
     * Read the school's theme from app_settings. Resolves to null when no theme
     * has been saved, the collection is missing, or the request failed — the
     * caller then keeps whatever the config file gave it.
     */
    async function load(dataService) {
        if (!dataService || typeof dataService.getAppSetting !== 'function') return null;
        try {
            const value = await dataService.getAppSetting(SETTING_KEY);
            if (value === undefined) return null;          // unreachable / absent
            if (value === null) { clearCached(); return null; }  // explicitly cleared
            const theme = normalize(value);
            if (isEmpty(theme)) { clearCached(); return null; }
            setCached(theme);
            return theme;
        } catch (err) {
            console.warn('schoolTheme.load failed:', err && err.message);
            return null;
        }
    }

    async function save(dataService, theme) {
        if (!dataService || typeof dataService.saveAppSetting !== 'function') {
            throw new Error('Settings are unavailable right now.');
        }
        const clean = normalize(theme);
        await dataService.saveAppSetting(SETTING_KEY, clean);
        setCached(clean);
        return clean;
    }

    global.schoolTheme = {
        SETTING_KEY,
        CACHE_KEY,
        normalize,
        isEmpty,
        deriveBranding,
        getCached,
        setCached,
        clearCached,
        load,
        save,
        // exposed for the live preview in the branding form, and for tests
        colors: { hexToRgb, rgbToHex, lighten, darken, contrast, clampForWhiteText }
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
