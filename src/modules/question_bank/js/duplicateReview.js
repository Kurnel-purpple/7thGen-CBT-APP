/**
 * Duplicate Review Modal
 *
 * Shows the teacher every incoming question that looks like one already in the
 * Question Bank, side by side, and lets them decide per pair: keep the bank
 * copy, keep both, or let the incoming one replace the bank copy.
 *
 * Follows the bottom-sheet-on-mobile / centred-card-on-desktop pattern the
 * rest of the app uses (see Utils._ensureModalHtml).
 *
 * Usage:
 *   const decisions = await DuplicateReview.open(conflicts, { title, subtitle });
 *   // decisions === null  -> user cancelled, import nothing
 *   // otherwise { [index]: { action: 'skip'|'add'|'replace', replaceId } }
 */

(function(root) {
    'use strict';

    var STYLE_ID = 'dup-review-styles';
    var MODAL_ID = 'dup-review-modal';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function truncate(value, max) {
        var text = String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return text.length > max ? text.slice(0, max - 1) + '…' : text;
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '.dup-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10002;',
            '  display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);}',
            '.dup-card{background:var(--card-bg,#fff);color:var(--text-color,#202124);width:92%;max-width:720px;',
            '  max-height:88vh;border-radius:16px;overflow:hidden;display:flex;flex-direction:column;',
            '  box-shadow:0 20px 50px rgba(0,0,0,0.3);animation:utils-pop 0.3s ease-out;}',
            '.dup-head{padding:18px 22px;border-bottom:1px solid var(--border-color,#e0e0e0);}',
            '.dup-head h3{margin:0 0 4px;font-size:1.1rem;font-family:var(--font-heading,inherit);font-weight:700;}',
            '.dup-head p{margin:0;font-size:0.85rem;color:var(--light-text,#5F6368);line-height:1.5;}',
            // Also one row, always — same reasoning as .dup-choices
            '.dup-bulk{display:flex;flex-wrap:nowrap;gap:clamp(6px,2vw,10px);padding:12px 22px;',
            '  border-bottom:1px solid var(--border-color,#e0e0e0);}',
            '.dup-bulk button{font:inherit;font-size:clamp(0.54rem,2.2vw,0.78rem);font-weight:700;',
            '  white-space:nowrap;flex:0 1 auto;padding:6px clamp(6px,2vw,12px);border-radius:50px;',
            '  border:1.5px solid var(--border-color,#e0e0e0);background:transparent;color:var(--text-color,#202124);cursor:pointer;}',
            '.dup-bulk button:hover{border-color:var(--primary-color,#1A73E8);color:var(--primary-color,#1A73E8);}',
            '.dup-body{overflow-y:auto;padding:6px 22px 12px;flex:1;}',
            '.dup-item{padding:16px 0;border-bottom:1px solid var(--border-color,#e0e0e0);}',
            '.dup-item:last-child{border-bottom:none;}',
            '.dup-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}',
            '.dup-side{background:var(--inner-bg,#f4f6f8);border-radius:10px;padding:10px 12px;min-width:0;}',
            '.dup-side.is-new{border-left:3px solid var(--primary-color,#1A73E8);}',
            '.dup-side.is-old{border-left:3px solid #F9AB00;}',
            '.dup-tag{display:block;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.06em;',
            '  font-weight:800;color:var(--light-text,#5F6368);margin-bottom:5px;}',
            '.dup-text{font-size:0.84rem;line-height:1.45;word-break:break-word;}',
            '.dup-meta{margin-top:6px;font-size:0.7rem;color:var(--light-text,#5F6368);}',
            '.dup-score{display:inline-block;padding:2px 8px;border-radius:50px;font-size:0.68rem;font-weight:800;',
            '  background:rgba(249,171,0,0.16);color:#9a6a00;margin-bottom:10px;}',
            '.dup-score.is-identical{background:rgba(234,67,53,0.14);color:#c5221f;}',
            // One row, always. The three labels run to ~40 characters, so the
            // type and gaps scale with the viewport instead of being allowed
            // to wrap onto a second line.
            '.dup-choices{display:flex;flex-wrap:nowrap;align-items:center;gap:clamp(8px,2.5vw,20px);}',
            // Choices read as underlined links, not pills. The radio is
            // visually hidden but still focusable, and drives the styling via
            // `input:checked + span` — a plain sibling selector, so the
            // selected state can never go invisible the way it would if
            // `:has()` were unsupported.
            '.dup-choices label{display:inline-flex;align-items:center;cursor:pointer;min-height:34px;}',
            '.dup-choices input{position:absolute;width:1px;height:1px;opacity:0;margin:0;}',
            '.dup-choices span{font-size:clamp(0.55rem,2.35vw,0.8rem);font-weight:700;white-space:nowrap;color:#5B9BF0;',
            '  padding:3px 1px 5px;border-bottom:2px solid transparent;',
            '  transition:color .15s ease,border-color .15s ease;}',
            '.dup-choices label:hover span{border-bottom-color:rgba(91,155,240,0.5);}',
            '.dup-choices input:checked + span{color:var(--primary-dark,#1557B0);border-bottom-color:currentColor;}',
            '.dup-choices input:focus-visible + span{outline:2px solid var(--primary-color,#1A73E8);outline-offset:3px;}',
            '.dup-choices label.is-danger span{color:#EE8175;}',
            '.dup-choices label.is-danger:hover span{border-bottom-color:rgba(238,129,117,0.55);}',
            '.dup-choices label.is-danger input:checked + span{color:#c5221f;border-bottom-color:currentColor;}',
            '.dup-foot{padding:14px 22px;border-top:1px solid var(--border-color,#e0e0e0);',
            '  display:flex;gap:10px;justify-content:flex-end;align-items:center;}',
            // The summary is the only thing that gives way: it truncates so the
            // buttons keep their natural width instead of being squeezed into
            // fat two-line blocks.
            '.dup-foot .dup-summary{margin-right:auto;min-width:0;flex:1 1 auto;',
            '  font-size:0.78rem;color:var(--light-text,#5F6368);',
            '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
            '.dup-foot button{font:inherit;font-size:0.85rem;font-weight:700;padding:10px 22px;',
            '  border-radius:50px;cursor:pointer;border:none;white-space:nowrap;flex:0 0 auto;}',
            '.dup-cancel{background:transparent;border:1.5px solid var(--border-color,#e0e0e0)!important;color:var(--text-color,#202124);}',
            '.dup-apply{background:var(--primary-color,#1A73E8);color:#fff;}',
            '@media (max-width:768px){',
            '  .dup-overlay{align-items:flex-end;}',
            '  .dup-card{width:100%;max-width:none;max-height:92vh;border-radius:16px 16px 0 0;}',
            '  .dup-pair{grid-template-columns:1fr;}',
            // Narrower gutters give the single-row rows the width they need
            '  .dup-body{padding:6px 14px 12px;}',
            '  .dup-bulk{padding:10px 14px;}',
            '  .dup-choices label{min-height:44px;}',
            // On a narrow card the summary is what shrinks — it truncates,
            // while the buttons keep their natural width. They are never
            // stretched to fill either: an equal-width split would clip the
            // longer label, since these must not wrap.
            '  .dup-foot{padding:12px 16px;gap:8px;}',
            '  .dup-foot .dup-summary{font-size:0.72rem;}',
            '  .dup-foot button{padding:12px 16px;min-height:44px;}',
            '}'
        ].join('');
        document.head.appendChild(style);
    }

    function matchSummary(match) {
        var bits = [];
        if (match.question.term) bits.push(escapeHtml(match.question.term));
        if (match.question.subject) bits.push(escapeHtml(match.question.subject));
        if (match.isFromSameExam) bits.push('earlier in this same exam');
        else if (match.sameOptions === true) bits.push('same options');
        else if (match.sameOptions === false) bits.push('different options');
        return bits.join(' · ');
    }

    function renderItem(conflict, position) {
        var best = conflict.matches[0];
        var pct = Math.round(best.score * 100);
        var isIdentical = best.level === 'identical';
        var extra = conflict.matches.length > 1
            ? '<div class="dup-meta">+ ' + (conflict.matches.length - 1) + ' other close match'
              + (conflict.matches.length > 2 ? 'es' : '') + ' in the bank</div>'
            : '';

        // 'replace' is meaningless against a match that is not yet saved
        var canReplace = !best.isFromSameExam && !!best.question.id;

        return ''
            + '<div class="dup-item" data-dup-index="' + conflict.index + '">'
            + '  <span class="dup-score' + (isIdentical ? ' is-identical' : '') + '">'
            +      (isIdentical ? 'Looks identical' : 'Looks similar') + ' · ' + pct + '% match</span>'
            + '  <div class="dup-pair">'
            + '    <div class="dup-side is-new">'
            + '      <span class="dup-tag">Incoming · question ' + (position + 1) + '</span>'
            + '      <div class="dup-text">' + escapeHtml(truncate(conflict.question.text, 320)) + '</div>'
            + '    </div>'
            + '    <div class="dup-side is-old">'
            + '      <span class="dup-tag">Already in the bank</span>'
            + '      <div class="dup-text">' + escapeHtml(truncate(best.question.text, 320)) + '</div>'
            + '      <div class="dup-meta">' + matchSummary(best) + '</div>'
            +        extra
            + '    </div>'
            + '  </div>'
            + '  <div class="dup-choices">'
            + '    <label><input type="radio" name="dup-' + conflict.index + '" value="skip" checked>'
            + '<span>Keep bank copy</span></label>'
            + '    <label><input type="radio" name="dup-' + conflict.index + '" value="add">'
            + '<span>Keep both</span></label>'
            + (canReplace
                ? '    <label class="is-danger"><input type="radio" name="dup-' + conflict.index
                  + '" value="replace" data-replace-id="' + escapeHtml(best.question.id) + '">'
                  + '<span>Replace bank copy</span></label>'
                : '')
            + '  </div>'
            + '</div>';
    }

    /**
     * @param {Array}  conflicts - from ds.analyzeExamQuestionsForBank().conflicts
     * @param {Object} [opts] - { title, subtitle, cleanCount }
     * @returns {Promise<Object|null>} decisions, or null if cancelled
     */
    function open(conflicts, opts) {
        opts = opts || {};
        ensureStyles();

        var existing = document.getElementById(MODAL_ID);
        if (existing) existing.remove();

        var cleanCount = opts.cleanCount || 0;
        var overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.className = 'dup-overlay';
        overlay.innerHTML = ''
            + '<div class="dup-card" role="dialog" aria-modal="true" aria-labelledby="dup-review-title">'
            + '  <div class="dup-head">'
            + '    <h3 id="dup-review-title">' + escapeHtml(opts.title || 'Possible duplicates found') + '</h3>'
            + '    <p>' + escapeHtml(opts.subtitle || '') + '</p>'
            + '  </div>'
            + '  <div class="dup-bulk">'
            + '    <button type="button" data-dup-all="skip">Keep bank copy for all</button>'
            + '    <button type="button" data-dup-all="add">Keep both for all</button>'
            + '  </div>'
            + '  <div class="dup-body">'
            +      conflicts.map(renderItem).join('')
            + '  </div>'
            + '  <div class="dup-foot">'
            + '    <span class="dup-summary">'
            +        (cleanCount > 0
                        ? escapeHtml(cleanCount + ' other question' + (cleanCount === 1 ? '' : 's') + ' will be added')
                        : 'No other questions to add')
            + '    </span>'
            + '    <button type="button" class="dup-cancel">Cancel import</button>'
            + '    <button type="button" class="dup-apply">Apply</button>'
            + '  </div>'
            + '</div>';

        document.body.appendChild(overlay);

        return new Promise(function(resolve) {
            function cleanup() {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
            }
            function onKey(event) {
                if (event.key === 'Escape') { cleanup(); resolve(null); }
            }
            document.addEventListener('keydown', onKey);

            overlay.querySelectorAll('[data-dup-all]').forEach(function(button) {
                button.addEventListener('click', function() {
                    var value = button.getAttribute('data-dup-all');
                    overlay.querySelectorAll('.dup-choices input[value="' + value + '"]').forEach(function(input) {
                        input.checked = true;
                    });
                });
            });

            overlay.querySelector('.dup-cancel').addEventListener('click', function() {
                cleanup();
                resolve(null);
            });

            overlay.querySelector('.dup-apply').addEventListener('click', function() {
                var decisions = {};
                overlay.querySelectorAll('.dup-item').forEach(function(item) {
                    var index = Number(item.getAttribute('data-dup-index'));
                    var checked = item.querySelector('input[type="radio"]:checked');
                    if (!checked) return;
                    decisions[index] = {
                        action: checked.value,
                        replaceId: checked.getAttribute('data-replace-id') || null
                    };
                });
                cleanup();
                resolve(decisions);
            });

            // Click the scrim to dismiss, same as cancelling
            overlay.addEventListener('click', function(event) {
                if (event.target === overlay) { cleanup(); resolve(null); }
            });
        });
    }

    // ================================================================
    // CLUSTER REVIEW — duplicates already sitting in the bank
    // ================================================================

    function renderCluster(cluster, clusterIndex) {
        var scopeBits = [];
        if (cluster.subject) scopeBits.push(escapeHtml(cluster.subject));
        if (cluster.term) scopeBits.push(escapeHtml(cluster.term));

        var rows = cluster.questions.map(function(question, i) {
            // The oldest copy is pre-selected to keep; the rest are ticked for
            // deletion, which is what "remove the duplicates" almost always means.
            var isOriginal = i === 0;
            return ''
                + '<label class="dup-row' + (isOriginal ? ' is-original' : '') + '">'
                + '  <input type="checkbox" data-cluster="' + clusterIndex + '"'
                +        ' value="' + escapeHtml(question.id) + '"' + (isOriginal ? '' : ' checked') + '>'
                + '  <span class="dup-row-body">'
                + '    <span class="dup-text">' + escapeHtml(truncate(question.text, 240)) + '</span>'
                + '    <span class="dup-meta">' + (isOriginal ? 'Oldest copy · ' : '')
                +        escapeHtml(question.createdAt ? new Date(question.createdAt).toLocaleDateString() : 'no date')
                +        (question.source === 'exam_import' ? ' · from an exam' : '')
                + '    </span>'
                + '  </span>'
                + '</label>';
        }).join('');

        return ''
            + '<div class="dup-item">'
            + '  <span class="dup-score">' + cluster.questions.length + ' copies · '
            +      Math.round(cluster.score * 100) + '% match'
            +      (scopeBits.length ? ' · ' + scopeBits.join(' · ') : '') + '</span>'
            + '  <div class="dup-rows">' + rows + '</div>'
            + '</div>';
    }

    function ensureClusterStyles() {
        if (document.getElementById(STYLE_ID + '-cluster')) return;
        var style = document.createElement('style');
        style.id = STYLE_ID + '-cluster';
        style.textContent = [
            '.dup-rows{display:flex;flex-direction:column;gap:8px;}',
            '.dup-row{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;',
            '  background:var(--inner-bg,#f4f6f8);cursor:pointer;min-height:44px;}',
            '.dup-row.is-original{border-left:3px solid var(--primary-color,#1A73E8);}',
            '.dup-row input{margin-top:2px;flex-shrink:0;width:18px;height:18px;cursor:pointer;}',
            '.dup-row-body{display:flex;flex-direction:column;gap:3px;min-width:0;}',
            '.dup-row:has(input:checked){background:rgba(234,67,53,0.09);}'
        ].join('');
        document.head.appendChild(style);
    }

    /**
     * Review duplicate groups already in the bank and pick which copies to
     * delete. Ticked rows are the ones that go.
     *
     * @param {Array} clusters - from ds.findDuplicateClusters()
     * @returns {Promise<Array<string>|null>} ids to delete, or null if cancelled
     */
    function openClusters(clusters, opts) {
        opts = opts || {};
        ensureStyles();
        ensureClusterStyles();

        var existing = document.getElementById(MODAL_ID);
        if (existing) existing.remove();

        var totalExtra = clusters.reduce(function(sum, c) { return sum + c.questions.length - 1; }, 0);

        var overlay = document.createElement('div');
        overlay.id = MODAL_ID;
        overlay.className = 'dup-overlay';
        overlay.innerHTML = ''
            + '<div class="dup-card" role="dialog" aria-modal="true" aria-labelledby="dup-cluster-title">'
            + '  <div class="dup-head">'
            + '    <h3 id="dup-cluster-title">Duplicates in your Question Bank</h3>'
            + '    <p>' + clusters.length + ' group' + (clusters.length === 1 ? '' : 's')
            +      ' of near-identical questions, ' + totalExtra + ' extra cop'
            +      (totalExtra === 1 ? 'y' : 'ies') + ' in total. Ticked questions will be deleted — '
            +      'the oldest copy in each group is kept by default.</p>'
            + '  </div>'
            + '  <div class="dup-bulk">'
            + '    <button type="button" data-cluster-all="check">Tick all duplicates</button>'
            + '    <button type="button" data-cluster-all="uncheck">Untick everything</button>'
            + '  </div>'
            + '  <div class="dup-body">' + clusters.map(renderCluster).join('') + '</div>'
            + '  <div class="dup-foot">'
            + '    <span class="dup-summary"><strong class="dup-del-count">0</strong> selected for deletion</span>'
            + '    <button type="button" class="dup-cancel">Cancel</button>'
            + '    <button type="button" class="dup-apply">Delete selected</button>'
            + '  </div>'
            + '</div>';

        document.body.appendChild(overlay);

        var countEl = overlay.querySelector('.dup-del-count');
        function refreshCount() {
            countEl.textContent = String(overlay.querySelectorAll('.dup-row input:checked').length);
        }
        refreshCount();

        return new Promise(function(resolve) {
            function cleanup() {
                document.removeEventListener('keydown', onKey);
                overlay.remove();
            }
            function onKey(event) {
                if (event.key === 'Escape') { cleanup(); resolve(null); }
            }
            document.addEventListener('keydown', onKey);

            overlay.addEventListener('change', refreshCount);

            overlay.querySelectorAll('[data-cluster-all]').forEach(function(button) {
                button.addEventListener('click', function() {
                    var check = button.getAttribute('data-cluster-all') === 'check';
                    overlay.querySelectorAll('.dup-row').forEach(function(row) {
                        var input = row.querySelector('input');
                        // "Tick all duplicates" must never tick the copy being kept
                        input.checked = check ? !row.classList.contains('is-original') : false;
                    });
                    refreshCount();
                });
            });

            overlay.querySelector('.dup-cancel').addEventListener('click', function() {
                cleanup(); resolve(null);
            });

            overlay.querySelector('.dup-apply').addEventListener('click', function() {
                var ids = Array.prototype.map.call(
                    overlay.querySelectorAll('.dup-row input:checked'),
                    function(input) { return input.value; }
                );
                cleanup();
                resolve(ids);
            });

            overlay.addEventListener('click', function(event) {
                if (event.target === overlay) { cleanup(); resolve(null); }
            });
        });
    }

    root.DuplicateReview = { open: open, openClusters: openClusters };
})(typeof window !== 'undefined' ? window : this);
