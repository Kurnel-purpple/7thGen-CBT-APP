/**
 * Report Card Document
 *
 * Renders a saved report card as the finished, branded document — the thing a
 * parent receives. One renderer, used by the printable page and by the admin's
 * preview, so what you preview is exactly what prints.
 *
 * Built on demand from the card's saved marks plus the current template. The
 * marks are frozen at publish; the letterhead is not, so correcting the school
 * address corrects every card at once.
 */

(function(global) {
    'use strict';

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function ordinal(n) {
        var s = ['th', 'st', 'nd', 'rd'];
        var v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function num(value) {
        var n = Number(value);
        if (!isFinite(n)) return 0;
        // Trim a trailing .0 so whole marks read as "36", not "36.0".
        return Math.round(n * 10) / 10;
    }

    /**
     * @param {Object} card    a saved report card
     * @param {Object} tpl     the resolved template (see reportCardTemplate.js)
     * @returns {string} HTML for the document body
     */
    function render(card, tpl) {
        card = card || {};
        tpl = tpl || {};

        var subjects = Array.isArray(card.subjects) ? card.subjects : [];
        var maxima = (global.dataService && global.dataService.reportCardMaxima)
            ? global.dataService.reportCardMaxima(subjects, tpl)
            : { ca: tpl.caMax || 40, exam: tpl.examMax || 60, total: (tpl.caMax || 40) + (tpl.examMax || 60) };

        // The legend is generated from the same bands that assign the grades,
        // so the key printed on the card always matches the column beside it.
        var legend = (global.dataService && global.dataService.gradingLegendText)
            ? global.dataService.gradingLegendText(tpl)
            : '';

        return '<div class="rcd-sheet" style="--rcd-accent:' + esc(tpl.accentColor || '#1A3C8C') + ';">' +
            letterhead(tpl) +
            '<h2 class="rcd-doc-title">' + esc(tpl.documentTitle || 'PROGRESS REPORT') + '</h2>' +
            identity(card, tpl) +
            (legend ? '<p class="rcd-legend">GRADE: ' + esc(legend) + '</p>' : '') +
            subjectTable(subjects, maxima, tpl) +
            summary(card) +
            (tpl.showAttendance !== false ? attendance(card) : '') +
            (tpl.showRemarks !== false ? remarks(card) : '') +
            (tpl.signatureLabel ? '<p class="rcd-signature">' + esc(tpl.signatureLabel) + '</p>' : '') +
        '</div>';
    }

    function letterhead(tpl) {
        var contactBits = [];
        if (tpl.phone) contactBits.push('TEL: ' + esc(tpl.phone));
        if (tpl.email) contactBits.push(esc(tpl.email));

        var lines = '';
        if (tpl.schoolTagline) lines += '<div class="rcd-tagline">' + esc(tpl.schoolTagline) + '</div>';
        if (tpl.address) lines += '<div class="rcd-address">' + esc(tpl.address) + '</div>';
        if (contactBits.length) lines += '<div class="rcd-contact">' + contactBits.join(' &middot; ') + '</div>';
        if (tpl.website) lines += '<div class="rcd-website">' + esc(tpl.website) + '</div>';

        // Crest on the sheet's left margin with the school name centred beside
        // it, then the school's details centred underneath.
        return '<header class="rcd-head">' +
            '<div class="rcd-head-brand">' +
                (tpl.logo ? '<img class="rcd-logo" src="' + esc(tpl.logo) + '" alt="">' : '') +
                (tpl.schoolName ? '<h1 class="rcd-school">' + esc(tpl.schoolName) + '</h1>' : '') +
                // Half the crest's width — splits the difference between
                // centring on the sheet and centring beside the crest.
                (tpl.logo ? '<span class="rcd-head-spacer" aria-hidden="true"></span>' : '') +
            '</div>' +
            '<div class="rcd-head-row">' +
                '<div class="rcd-head-lines">' + lines + '</div>' +
            '</div>' +
        '</header>';
    }

    function identity(card, tpl) {
        var position = (tpl.showPosition !== false && card.classPosition)
            ? ordinal(card.classPosition) + ' of ' + card.classSize
            : '';

        return '<div class="rcd-identity">' +
            '<div class="rcd-identity-fields">' +
                '<div><span class="rcd-label">Name:</span> <strong>' + esc(card.studentName) + '</strong></div>' +
                '<div><span class="rcd-label">Class:</span> <strong>' + esc(card.classLevel) + '</strong></div>' +
                (position ? '<div><span class="rcd-label">Position:</span> <strong>' + esc(position) + '</strong></div>' : '') +
            '</div>' +
            '<table class="rcd-session-table">' +
                '<thead><tr><th>SESSION</th><th>TERM</th></tr></thead>' +
                '<tbody><tr><td>' + esc(card.session || '—') + '</td><td>' + esc(card.term || '—') + '</td></tr></tbody>' +
            '</table>' +
        '</div>';
    }

    /**
     * The grade shown is re-derived from the stored percentage under the
     * school's current scale, falling back to whatever was stored when the
     * card was generated. That is what makes a corrected scale correct the
     * cards already in parents' hands, instead of leaving old letters behind
     * a new legend.
     */
    function gradeOf(subject, tpl) {
        var pct = Number(subject && subject.percentage);
        if (isFinite(pct) && global.dataService && global.dataService.gradeForPercentage) {
            return global.dataService.gradeForPercentage(pct, tpl).letter;
        }
        return subject && subject.grade || '';
    }

    function subjectTable(subjects, maxima, tpl) {
        if (!subjects.length) {
            return '<p class="rcd-empty">No exam results were recorded for this term.</p>';
        }
        var rows = subjects.map(function(s) {
            return '<tr>' +
                '<td class="rcd-subject">' + esc(s.name) + '</td>' +
                '<td>' + num(s.caScore) + '</td>' +
                '<td>' + num(s.examScore) + '</td>' +
                '<td class="rcd-total">' + num(s.score) + '</td>' +
                '<td class="rcd-grade">' + esc(gradeOf(s, tpl)) + '</td>' +
            '</tr>';
        }).join('');

        return '<table class="rcd-table">' +
            '<thead><tr>' +
                '<th class="rcd-subject">SUBJECT</th>' +
                '<th>CA ' + maxima.ca + '</th>' +
                '<th>EXAM ' + maxima.exam + '</th>' +
                '<th>TOTAL ' + maxima.total + '</th>' +
                '<th>GRADE</th>' +
            '</tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
        '</table>';
    }

    function summary(card) {
        var label = card.term ? 'PERCENTAGE (' + esc(card.term) + ')' : 'PERCENTAGE';
        return '<p class="rcd-percentage">' + label + ': <strong>' + num(card.averageScore) + '%</strong></p>';
    }

    function attendance(card) {
        var att = card.attendance || {};
        if (!att.totalDays) return '';
        return '<div class="rcd-attendance">' +
            '<span><span class="rcd-label">Days Present:</span> <strong>' + esc(att.present) + '</strong></span>' +
            '<span><span class="rcd-label">Days Absent:</span> <strong>' + esc(att.absent) + '</strong></span>' +
            '<span><span class="rcd-label">School Days:</span> <strong>' + esc(att.totalDays) + '</strong></span>' +
            '<span><span class="rcd-label">Attendance:</span> <strong>' + esc(att.attendanceRate) + '%</strong></span>' +
        '</div>';
    }

    function remarks(card) {
        var out = '';
        if (String(card.teacherRemarks || '').trim()) {
            out += '<p class="rcd-remark"><span class="rcd-label">TEACHER\'S COMMENT:</span> ' +
                esc(card.teacherRemarks) + '</p>';
        }
        if (String(card.principalRemarks || '').trim()) {
            out += '<p class="rcd-remark"><span class="rcd-label">HEAD OF SCHOOL\'S COMMENT:</span> ' +
                esc(card.principalRemarks) + '</p>';
        }
        return out;
    }

    // ================================================================
    // FITTING THE SHEET TO A PHONE
    // The card is a document with a fixed composition, so a narrow screen
    // scales the whole thing down rather than reflowing it — the reader gets
    // the same page a desktop shows and pinch-zooms into the part they want,
    // exactly as with a PDF. See the "Small screens" note in
    // report-card-document.css for why this is `zoom` and not a transform.
    // ================================================================

    var SHEET_WIDTH = 800; // .rcd-sheet's max-width, in px

    function fitSheet(sheet) {
        // Measure at natural size: width:100% + max-width:800px means an
        // unscaled sheet reports exactly the space its container can give it.
        sheet.style.zoom = '';
        sheet.style.width = '';
        sheet.style.maxWidth = '';

        var available = sheet.offsetWidth;
        // Hidden (display:none) or already wide enough — leave it alone.
        if (!available || available >= SHEET_WIDTH) return;

        // Lock to the full composition, then scale it back down to fit. zoom
        // is a layout scale, so the sheet still *occupies* `available` px and
        // nothing overflows or leaves a gap.
        sheet.style.width = SHEET_WIDTH + 'px';
        sheet.style.maxWidth = 'none';
        sheet.style.zoom = String(Math.round((available / SHEET_WIDTH) * 1e4) / 1e4);
    }

    function fitSheets(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var sheets = scope.querySelectorAll('.rcd-sheet');
        for (var i = 0; i < sheets.length; i++) fitSheet(sheets[i]);
    }

    // Sheets are injected long after load — the design preview re-renders on
    // every keystroke — so watch for them rather than asking each of the three
    // callers to remember to call fitSheets().
    var pending = null;
    function scheduleFit() {
        if (pending) return;
        pending = global.requestAnimationFrame
            ? global.requestAnimationFrame(function() { pending = null; fitSheets(); })
            : global.setTimeout(function() { pending = null; fitSheets(); }, 16);
    }

    function watch() {
        if (!global.document || !global.document.body) return;
        fitSheets();
        if (global.MutationObserver) {
            new global.MutationObserver(scheduleFit)
                .observe(global.document.body, { childList: true, subtree: true });
        }
        global.addEventListener('resize', scheduleFit);
        global.addEventListener('orientationchange', scheduleFit);
    }

    if (global.document && global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', watch);
    } else {
        watch();
    }

    global.reportCardDocument = {
        render: render,
        escapeHtml: esc,
        ordinal: ordinal,
        fitSheets: fitSheets
    };
})(window);
