/**
 * Report Card Template
 *
 * The school-specific dressing on a report card — letterhead, grading legend,
 * and the CA/Exam split — kept apart from the marks themselves.
 *
 * Stored as a single JSON blob in app_settings under "report_card_template",
 * so no schema migration is needed to add a field here. Everything is
 * optional: a school that never opens the editor still gets a clean,
 * correctly-scored document from DEFAULTS.
 *
 * Nothing here is baked into a published card. Cards are rendered on demand
 * from their saved marks plus whatever the template says today, which is why
 * fixing a typo in the school address fixes it on every card at once.
 */

(function(ds) {
    if (!ds) {
        console.error('[reportCardTemplate] window.dataService not found — load dataService.js first');
        return;
    }

    var SETTING_KEY = 'report_card_template';
    var CACHE_KEY = 'cbt_report_card_template';

    /**
     * CA is 40 and the exam 60 at practically every school here, so those are
     * the defaults rather than something an admin must discover and set. They
     * are still editable for the schools that differ.
     */
    var DEFAULTS = {
        // Letterhead
        schoolName: '',
        schoolTagline: '',
        address: '',
        phone: '',
        email: '',
        website: '',
        logo: '',              // data: URI, downscaled on upload
        documentTitle: 'PROGRESS REPORT',

        // Marks
        caMax: 40,
        examMax: 60,

        /**
         * The grading scale, and the only definition of one.
         *
         * It decides the letter a percentage earns AND prints as the legend on
         * the card, so the two can never disagree. Bands are stored as a
         * lower bound only, sorted high to low: each band runs from its `min`
         * up to just under the next one's, which makes a gap or an overlap
         * impossible to express. The last band must sit at 0.
         */
        gradingScale: [
            { min: 96, letter: 'A++', label: 'Outstanding' },
            { min: 91, letter: 'A+', label: 'Excellent' },
            { min: 80, letter: 'A', label: 'Very Good' },
            { min: 70, letter: 'B+', label: 'Good' },
            { min: 60, letter: 'B', label: 'Credit' },
            { min: 50, letter: 'C+', label: 'Pass' },
            { min: 0, letter: 'C', label: 'Weak' }
        ],

        // Sections
        showAttendance: true,
        showPosition: true,
        showRemarks: true,

        // Look
        accentColor: '#1A3C8C',

        // Signatures
        signatureLabel: ''
    };

    var cached = null;

    function coerceNumber(value, fallback) {
        var n = parseFloat(value);
        return isFinite(n) && n > 0 ? n : fallback;
    }

    /**
     * Put a stored scale into the shape the rest of the code can trust:
     * sorted high to low, no unusable rows, and a band reaching 0 so every
     * percentage lands somewhere. Returns the default scale if nothing
     * survives — a card with no grades at all is never the right answer.
     */
    function normalizeScale(scale) {
        var bands = (Array.isArray(scale) ? scale : [])
            .map(function(b) {
                return {
                    min: parseFloat(b && b.min),
                    letter: String(b && b.letter || '').trim(),
                    label: String(b && b.label || '').trim()
                };
            })
            .filter(function(b) {
                return isFinite(b.min) && b.min >= 0 && b.min <= 100 && b.letter !== '';
            })
            .sort(function(a, b) { return b.min - a.min; });

        // Drop duplicate lower bounds — the first (highest grade) wins.
        var seen = {};
        bands = bands.filter(function(b) {
            if (seen[b.min]) return false;
            seen[b.min] = true;
            return true;
        });

        if (!bands.length) return DEFAULTS.gradingScale.slice();

        // Guarantee full coverage: whatever the admin typed, 0 must be graded.
        var lowest = bands[bands.length - 1];
        if (lowest.min !== 0) lowest.min = 0;

        return bands;
    }

    /** The upper bound of a band, derived from the one above it. */
    function bandMax(bands, index) {
        return index === 0 ? 100 : Math.max(bands[index].min, bands[index - 1].min - 1);
    }

    ds.normalizeGradingScale = normalizeScale;

    /**
     * The grade a percentage earns under the given scale. This is the single
     * grading rule in the app — generation stores its answer, and the card
     * renderers ask again at display time so a corrected scale corrects the
     * cards.
     */
    ds.gradeForPercentage = function(percentage, template) {
        var tpl = template || ds.getReportCardTemplateSync();
        var bands = normalizeScale(tpl && tpl.gradingScale);
        var pct = Number(percentage);
        if (!isFinite(pct)) pct = 0;

        for (var i = 0; i < bands.length; i++) {
            if (pct >= bands[i].min) {
                return { letter: bands[i].letter, label: bands[i].label };
            }
        }
        var last = bands[bands.length - 1];
        return { letter: last.letter, label: last.label };
    };

    /**
     * The legend printed on the card, built from the same bands that do the
     * grading — which is the point: it cannot drift from reality.
     */
    ds.gradingLegendText = function(template) {
        var tpl = template || ds.getReportCardTemplateSync();
        var bands = normalizeScale(tpl && tpl.gradingScale);
        return bands.map(function(band, i) {
            return band.min + '-' + bandMax(bands, i) + '=' + band.letter;
        }).join('  ');
    };

    /** Bands with their derived upper bounds — for the settings editor. */
    ds.gradingScaleRows = function(template) {
        var tpl = template || ds.getReportCardTemplateSync();
        var bands = normalizeScale(tpl && tpl.gradingScale);
        return bands.map(function(band, i) {
            return { min: band.min, max: bandMax(bands, i), letter: band.letter, label: band.label };
        });
    };

    /**
     * Fill in every missing field so callers never have to null-check. Unknown
     * keys from a newer client are preserved rather than dropped.
     */
    function withDefaults(stored) {
        var out = {};
        Object.keys(DEFAULTS).forEach(function(k) { out[k] = DEFAULTS[k]; });
        if (stored && typeof stored === 'object') {
            Object.keys(stored).forEach(function(k) {
                var v = stored[k];
                if (v !== null && v !== undefined && v !== '') out[k] = v;
                else if (typeof v === 'boolean') out[k] = v;
            });
        }
        // Booleans need explicit handling — `false` is meaningful, not missing.
        ['showAttendance', 'showPosition', 'showRemarks'].forEach(function(k) {
            if (stored && typeof stored[k] === 'boolean') out[k] = stored[k];
        });
        out.caMax = coerceNumber(out.caMax, DEFAULTS.caMax);
        out.examMax = coerceNumber(out.examMax, DEFAULTS.examMax);
        out.gradingScale = normalizeScale(out.gradingScale);
        return out;
    }

    /**
     * Falls back to the client config's school name/logo when the admin has
     * not filled the letterhead in — better an approximately right header than
     * an empty one.
     */
    function withClientFallbacks(tpl) {
        var cfg = (window.CLIENT_CONFIG || window.clientConfig || {});
        var client = cfg.client || {};
        if (!tpl.schoolName) tpl.schoolName = client.name || '';
        return tpl;
    }

    /**
     * Synchronous read of the last known template. Renders can paint
     * immediately with this and refresh when load() resolves, so the document
     * never flashes an empty letterhead on a slow connection.
     */
    ds.getReportCardTemplateSync = function() {
        if (cached) return cached;
        try {
            var raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                cached = withClientFallbacks(withDefaults(JSON.parse(raw)));
                return cached;
            }
        } catch (e) { /* corrupt cache — fall through to defaults */ }
        return withClientFallbacks(withDefaults(null));
    };

    /**
     * Load from the server, updating the local copy. Fails soft: a network
     * error or a missing app_settings collection just leaves the cached (or
     * default) template in place, so report cards always render.
     */
    ds.loadReportCardTemplate = async function() {
        try {
            var value = await ds.getAppSetting(SETTING_KEY);
            if (value === undefined) return ds.getReportCardTemplateSync(); // unreachable/missing
            if (value === null) {
                // Explicitly cleared by an admin — drop back to defaults.
                try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* quota */ }
                cached = withClientFallbacks(withDefaults(null));
                return cached;
            }
            var parsed = typeof value === 'string' ? JSON.parse(value) : value;
            cached = withClientFallbacks(withDefaults(parsed));
            try { localStorage.setItem(CACHE_KEY, JSON.stringify(parsed)); } catch (e) { /* quota */ }
            return cached;
        } catch (e) {
            console.warn('[ReportCards] Template load failed, using last known:', e && e.message);
            return ds.getReportCardTemplateSync();
        }
    };

    ds.saveReportCardTemplate = async function(template) {
        var clean = withDefaults(template);
        await ds.saveAppSetting(SETTING_KEY, clean);
        cached = withClientFallbacks(clean);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch (e) { /* quota */ }
        return cached;
    };

    ds.reportCardTemplateDefaults = function() {
        return withDefaults(null);
    };

    /**
     * The maxima to print above the CA / Exam / Total columns.
     *
     * The template is the authority — a school that says CA is 40 gets "CA /
     * 40" even on subjects whose stored `_caTotal` is missing, which is the
     * common case for results marked before the CA field existed. Real stored
     * maxima only override it when every subject agrees AND they disagree with
     * the template, which means the exams really were built to a different
     * scale and printing the template's number would be a lie.
     *
     * @param {Array} subjects card.subjects
     * @param {Object} [template]
     * @returns {{ca: number, exam: number, total: number}}
     */
    ds.reportCardMaxima = function(subjects, template) {
        var tpl = template || ds.getReportCardTemplateSync();
        var list = Array.isArray(subjects) ? subjects : [];

        function agreed(pick) {
            if (!list.length) return null;
            var first = pick(list[0]);
            if (!isFinite(first) || first <= 0) return null;
            for (var i = 1; i < list.length; i++) {
                if (pick(list[i]) !== first) return null;
            }
            return first;
        }

        var storedCa = agreed(function(s) { return Number(s.caTotal); });
        var storedExam = agreed(function(s) { return Number(s.examTotal); });

        var ca = storedCa || tpl.caMax;
        var exam = storedExam || tpl.examMax;
        return { ca: ca, exam: exam, total: ca + exam };
    };
})(window.dataService);
