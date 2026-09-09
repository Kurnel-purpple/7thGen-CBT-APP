/**
 * Student Report Card View Controller
 * Read-only view for students to see their published report cards.
 */

(function() {
    'use strict';

    var state = {
        reportCards: [],
        selectedCardId: null
    };

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function ordinalSuffix(n) {
        var s = ['th', 'st', 'nd', 'rd'];
        var v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    function renderCardList(cards) {
        var list = document.getElementById('src-card-list');
        if (!list) return;

        if (!cards || cards.length === 0) {
            list.innerHTML = '<div style="text-align:center; padding:40px 20px;">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="var(--light-text)" stroke-width="1.5" width="48" height="48" style="margin-bottom:12px;"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>' +
                '<p style="color:var(--light-text); font-size:0.95rem;">No report cards published yet.</p>' +
                '<p style="color:var(--light-text); font-size:0.82rem;">Your report cards will appear here when your teacher publishes them.</p>' +
            '</div>';
            return;
        }

        list.innerHTML = cards.map(function(card) {
            var position = card.classPosition ? ordinalSuffix(card.classPosition) + ' of ' + card.classSize : '';
            return '<button class="src-card-item' + (state.selectedCardId === card.id ? ' active' : '') + '" data-card-id="' + escapeHtml(card.id) + '">' +
                '<div class="src-card-term">' + escapeHtml(card.term) + (card.session ? ' ' + escapeHtml(card.session) : '') + '</div>' +
                '<div class="src-card-class">' + escapeHtml(card.classLevel) + '</div>' +
                '<div class="src-card-score">Avg: ' + card.averageScore + '%' + (position ? ' | ' + position : '') + '</div>' +
            '</button>';
        }).join('');

        list.querySelectorAll('[data-card-id]').forEach(function(btn) {
            btn.addEventListener('click', function() {
                showCardDetail(btn.getAttribute('data-card-id'));
            });
        });

        // Auto-select first card
        if (cards.length > 0 && !state.selectedCardId) {
            showCardDetail(cards[0].id);
        }
    }

    /**
     * Download the card as a real PDF file.
     *
     * "Download PDF" used to call window.print(), which opens the print dialog and
     * leaves the user to discover "Save as PDF" for themselves. html2pdf comes from a
     * CDN, so when it is unavailable — offline, or a filtered network — this falls
     * back to the print dialog and says why, since print-to-PDF still yields a file.
     */
    async function downloadPdf(btn) {
        var sheet = document.querySelector('#src-detail .rcd-sheet');
        if (!sheet) { window.print(); return; }

        if (typeof window.html2pdf === 'undefined') {
            await Utils.showAlert(
                'PDF Tool Unavailable',
                'The PDF generator could not be loaded — you may be offline.<br><br>' +
                'Opening the print dialog instead: choose <strong>Save as PDF</strong> as the destination.'
            );
            window.print();
            return;
        }

        var original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }

        var name = (document.title || 'Report Card').replace(/[^a-zA-Z0-9]+/g, '_');
        try {
            await window.html2pdf()
                .set({
                    margin: 0,
                    filename: name + '.pdf',
                    html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
                    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
                    pagebreak: { mode: ['css', 'legacy'] }
                })
                .from(sheet)
                .save();
        } catch (err) {
            console.error('[StudentReportCard] PDF generation failed:', err);
            await Utils.showAlert(
                'Could Not Create PDF',
                'Something went wrong generating the file. Opening the print dialog instead — ' +
                'choose <strong>Save as PDF</strong> as the destination.'
            );
            window.print();
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = original; }
        }
    }

    /**
     * Renders the finished document — the very same renderer the printable
     * page and the admin preview use. Parents read this page, so what they see
     * here is exactly the card they can hand over on paper, not a look-alike.
     */
    function showCardDetail(cardId) {
        var card = state.reportCards.find(function(c) { return String(c.id) === String(cardId); });
        if (!card) return;

        state.selectedCardId = cardId;

        // Highlight active card in list
        document.querySelectorAll('.src-card-item').forEach(function(el) {
            el.classList.toggle('active', el.getAttribute('data-card-id') === String(cardId));
        });

        var detail = document.getElementById('src-detail');
        if (!detail) return;

        var documentHtml = window.reportCardDocument
            ? window.reportCardDocument.render(card, window.dataService.getReportCardTemplateSync())
            : '<p style="color:var(--light-text);">This report card could not be displayed.</p>';

        detail.innerHTML =
            '<div class="src-doc-actions rcd-no-print">' +
                '<button type="button" class="src-doc-btn" id="src-download">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
                    'Download PDF' +
                '</button>' +
                '<button type="button" class="src-doc-btn src-doc-btn-ghost" id="src-fullpage">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/></svg>' +
                    'Open full page' +
                '</button>' +
            '</div>' +
            documentHtml;

        var download = document.getElementById('src-download');
        if (download) download.addEventListener('click', function() { downloadPdf(this); });

        var fullpage = document.getElementById('src-fullpage');
        if (fullpage) fullpage.addEventListener('click', function() {
            window.location.href = 'report-card-print.html?id=' + encodeURIComponent(cardId);
        });
    }

    async function init() {
        var user = window.dataService?.getCurrentUser?.();
        if (!user || user.role !== 'student') {
            window.location.href = '../index.html';
            return;
        }

        var nameEl = document.getElementById('user-name');
        var avatarEl = document.getElementById('sidebar-avatar');
        if (nameEl) nameEl.textContent = user.name || user.full_name || 'Student';
        if (avatarEl) avatarEl.textContent = (user.name || user.full_name || 'S').charAt(0).toUpperCase();

        try {
            // The letterhead comes from the school's saved design; fetched
            // alongside the cards so the first document painted is already
            // branded. It fails soft to defaults, so a settings outage still
            // shows a readable card.
            var loaded = await Promise.all([
                window.dataService.getReportCards({
                    studentId: user.userId || user.id,
                    status: 'published'
                }),
                window.dataService.loadReportCardTemplate
                    ? window.dataService.loadReportCardTemplate().catch(function() { return null; })
                    : Promise.resolve(null)
            ]);

            state.reportCards = loaded[0];
            renderCardList(state.reportCards);
        } catch (err) {
            console.error('[ReportCards] Failed to load student report cards:', err);
            var list = document.getElementById('src-card-list');
            if (list) list.innerHTML = '<p style="color:var(--light-text); padding:20px;">Failed to load report cards. Please try again later.</p>';
        }
    }

    window.studentReportCard = { init: init };
})();
