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

    function gradeColor(grade) {
        var colors = { A: '#2e7d32', B: '#388e3c', C: '#f57f17', D: '#ef6c00', E: '#d84315', F: '#c62828' };
        return colors[grade] || 'var(--text-secondary)';
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

    function showCardDetail(cardId) {
        var card = state.reportCards.find(function(c) { return c.id === cardId; });
        if (!card) return;

        state.selectedCardId = cardId;

        // Highlight active card in list
        document.querySelectorAll('.src-card-item').forEach(function(el) {
            el.classList.toggle('active', el.getAttribute('data-card-id') === cardId);
        });

        var detail = document.getElementById('src-detail');
        if (!detail) return;

        var position = card.classPosition ? ordinalSuffix(card.classPosition) + ' of ' + card.classSize : '—';
        var att = card.attendance || {};

        var subjects = Array.isArray(card.subjects) ? card.subjects : [];
        var subjectsHtml = '';
        if (subjects.length > 0) {
            subjectsHtml = '<table class="rc-detail-subjects">' +
                '<thead><tr><th>Subject</th><th style="text-align:center;">Score</th><th style="text-align:center;">%</th><th style="text-align:center;">Grade</th><th>Remark</th></tr></thead>' +
                '<tbody>' + subjects.map(function(s) {
                    return '<tr>' +
                        '<td>' + escapeHtml(s.name) + '</td>' +
                        '<td style="text-align:center;">' + s.score + ' / ' + s.totalPossible + '</td>' +
                        '<td style="text-align:center;">' + s.percentage + '%</td>' +
                        '<td style="text-align:center; font-weight:700; color:' + gradeColor(s.grade) + ';">' + escapeHtml(s.grade) + '</td>' +
                        '<td>' + escapeHtml(s.gradeLabel) + '</td>' +
                    '</tr>';
                }).join('') + '</tbody></table>';
        } else {
            subjectsHtml = '<p style="color:var(--light-text);">No exam results for this term.</p>';
        }

        var attendanceHtml = '';
        if (att.totalDays > 0) {
            attendanceHtml =
                '<div class="rc-att-row"><span>Present:</span><strong>' + att.present + ' days</strong></div>' +
                '<div class="rc-att-row"><span>Absent:</span><strong>' + att.absent + ' days</strong></div>' +
                '<div class="rc-att-row"><span>Late:</span><strong>' + att.late + ' days</strong></div>' +
                '<div class="rc-att-row"><span>Attendance Rate:</span><strong>' + att.attendanceRate + '%</strong></div>';
        } else {
            attendanceHtml = '<p style="color:var(--light-text);">No attendance data for this period.</p>';
        }

        detail.innerHTML =
            '<div class="src-detail-header">' +
                '<h2>' + escapeHtml(card.studentName) + '</h2>' +
                '<div class="src-detail-meta">' + escapeHtml(card.classLevel) + ' | ' + escapeHtml(card.term) +
                    (card.session ? ' | ' + escapeHtml(card.session) : '') + ' | Position: ' + position + '</div>' +
            '</div>' +

            '<div class="src-section">' +
                '<h4>Subjects</h4>' +
                subjectsHtml +
                '<div class="rc-detail-average">Average: ' + card.averageScore + '%</div>' +
            '</div>' +

            '<div class="src-section">' +
                '<h4>Attendance</h4>' +
                attendanceHtml +
            '</div>' +

            (card.teacherRemarks ? '<div class="src-section"><h4>Teacher\'s Remarks</h4><p class="src-remarks">' + escapeHtml(card.teacherRemarks) + '</p></div>' : '') +
            (card.principalRemarks ? '<div class="src-section"><h4>Principal\'s Remarks</h4><p class="src-remarks">' + escapeHtml(card.principalRemarks) + '</p></div>' : '');
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
            state.reportCards = await window.dataService.getReportCards({
                studentId: user.userId || user.id,
                status: 'published'
            });
            renderCardList(state.reportCards);
        } catch (err) {
            console.error('[ReportCards] Failed to load student report cards:', err);
            var list = document.getElementById('src-card-list');
            if (list) list.innerHTML = '<p style="color:var(--light-text); padding:20px;">Failed to load report cards. Please try again later.</p>';
        }
    }

    window.studentReportCard = { init: init };
})();
