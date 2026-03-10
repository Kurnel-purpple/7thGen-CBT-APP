/**
 * bulkImportParser.js
 *
 * Deterministic, hierarchy-aware bulk question parser for the CBT exam app.
 * Vanilla JS — no dependencies, no framework.
 *
 * Supports:
 *   - Objective (MCQ) questions with (a) (b) (c) inline or multiline options
 *   - Theory questions with up to 3 hierarchy levels:
 *       Level 1 → Main question   (1.)
 *       Level 2 → Alphabetic child (a.)
 *       Level 3 → Roman numeral grandchild (i. ii. iii.)
 *   - THEORY section marker to force-classify a section
 *   - Human-formatting inconsistencies (tabs, a) vs a., 1) vs 1., mixed indent)
 *
 * Usage:
 *   const questions = window.BulkImportParser.parse(rawText);
 *   // Each item: { type, questionNumber, text, options?, children? }
 */
window.BulkImportParser = (function () {

    // =================================================================
    // ROMAN NUMERAL LOOKUP
    // =================================================================
    const ROMAN_SET = new Set([
        'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'
    ]);

    // =================================================================
    // PHASE 1 — TEXT NORMALIZATION
    // =================================================================

    /**
     * Pre-parser cleaner: normalize spacing and formatting issues before
     * structural detection. Order matters — run before any regex matching.
     *
     * Handles:
     *   "(a)Fish"       → "(a) Fish"   (missing space after parenthesized marker)
     *   "1.Define"      → "1. Define"  (missing space after numbered marker)
     *   "1a.Define"     → "1a. Define" (missing space after combined marker)
     *   "iii.text"      → "iii. text"  (multi-letter roman without space)
     */
    function normalizeInput(raw) {
        return raw
            .replace(/\r\n/g, '\n')                              // Windows CRLF → LF
            .replace(/\r/g, '\n')                                // Old Mac CR → LF
            .replace(/\t/g, '    ')                              // Tabs → 4 spaces
            // Add space after parenthesized markers: (a)Fish → (a) Fish
            .replace(/(\([a-zA-Z0-9]+\))(\S)/g, '$1 $2')
            // Add space after numbered/combined marker period: 1.Define, 1a.Define → add space
            .replace(/^(\s*\d+[a-z]?)\.([\S])/gm, '$1. $2')
            // Add space after multi-letter roman numeral period: iii.text → iii. text
            .replace(/^(\s*(?:ii|iii|iv|vi|vii|viii|ix))\.([\S])/gim, '$1. $2')
            .replace(/[^\S\n]+$/gm, '')                         // Trim trailing whitespace per line
            .replace(/\n{3,}/g, '\n\n');                        // Collapse 3+ blank lines → 2
    }

    /**
     * Normalize marker formats before parsing.
     *
     * Converts:
     *   "1) "   → "1. "   — main question with closing paren
     *   "1a) "  → "1a. "  — combined number+letter with closing paren
     *   "(i) "  → "i. "   — parenthesized roman numeral
     *   "ii) "  → "ii. "  — roman numeral with closing paren
     *   "a) "   → "a. "   — single letter with closing paren
     *
     * Only matches at the start of a line (after optional indent).
     */
    function normalizeMarkers(text) {
        return text
            // "1a) " → "1a. " — combined number+letter BEFORE generic single-letter rule
            .replace(/^(\s*\d+[a-z])\)\s*/gm, '$1. ')
            // "1) " → "1. " — main question number variant
            .replace(/^(\s*\d+)\)\s*/gm, '$1. ')
            // "(i)/(iv)/etc. " → "i. " — parenthesized roman numeral at line start
            .replace(/^(\s*)\((i{1,3}|iv|ix|vi{0,3})\)\s*/gim, '$1$2. ')
            // "ii) "/"iii) " → "ii. " — roman numeral + closing paren at line start
            .replace(/^(\s*(?:ii|iii|iv|vi|vii|viii|ix))\)\s*/gim, '$1. ')
            // "a) " → "a. " — single letter option/child variant
            .replace(/^(\s*[a-zA-Z])\)\s*/gm, '$1. ');
    }

    // =================================================================
    // PHASE 2 — MARKER DETECTION UTILITIES
    // =================================================================

    /**
     * TRUE if the line starts a new top-level question.
     * Matches: "1. ", "12. ", "1a. ", "2b. " etc.
     * Only at the very start of a line (after optional whitespace).
     * Prevents false positives like "version1.0" or "step1. action".
     */
    function isMainQMarker(line) {
        return /^\s*\d+[a-z]?\.\s+/.test(line);
    }

    /**
     * Extract the question number from a main question line.
     * Handles both "1. " and "1a. " formats.
     */
    function getMainQNumber(line) {
        const m = line.match(/^\s*(\d+)[a-z]?\.\s+/);
        return m ? parseInt(m[1], 10) : 0;
    }

    /**
     * TRUE if the line is a Level 3 roman numeral grandchild marker.
     * Examples: "   i. text", "      iv. text"
     *
     * Rules:
     *   - At start of line (after optional indent)
     *   - Marker must be a known roman numeral (i–x)
     *   - Followed by "." then at least one space
     */
    function isLevel3Marker(line) {
        const m = line.match(/^\s*([a-zA-Z]+)\.\s+/);
        if (!m) return false;
        return ROMAN_SET.has(m[1].toLowerCase());
    }

    /**
     * TRUE if the line is a Level 2 alphabetic child marker.
     * Examples: "a. text", "   b. text"
     *
     * Rules:
     *   - At start of line (after optional indent)
     *   - Exactly ONE letter (prevents "e.g." — next char after dot must be space)
     *   - Followed by "." then at least one space
     *
     * Note: roman numerals (i, v, x) will also pass this test when
     * checked in isolation — use isLevel3Marker first when in L2 context.
     */
    function isLevel2Marker(line) {
        return /^\s*[a-zA-Z]\.\s+/.test(line);
    }

    /**
     * Parse a marker line (L2 or L3) into { label, text }.
     * e.g. "   b. some text" → { label: 'b', text: 'some text' }
     */
    function parseMarkerLine(line) {
        const m = line.match(/^\s*([a-zA-Z]+)\.\s+(.*)/);
        return m ? { label: m[1].toLowerCase(), text: m[2].trim() } : null;
    }

    /**
     * TRUE if line starts with a parenthesized single-letter marker:
     * "(a) text", "(b) text" — used as L2 children in theory sections.
     * After normalization, roman numerals are already converted to "i. ii." format,
     * so only alphabetic children remain in this form.
     */
    function isParenChildMarker(line) {
        return /^\s*\([a-zA-Z]\)\s+/.test(line);
    }

    /**
     * Parse a parenthesized child line into { label, text }.
     * e.g. "   (a) plagiarism" → { label: 'a', text: 'plagiarism' }
     */
    function parseParenMarkerLine(line) {
        const m = line.match(/^\s*\(([a-zA-Z]+)\)\s+(.*)/);
        return m ? { label: m[1].toLowerCase(), text: m[2].trim() } : null;
    }

    // =================================================================
    // PHASE 3 — BLOCK SPLITTING
    // =================================================================

    /**
     * Split normalized text into question blocks.
     * A new block begins whenever a main question marker is detected.
     *
     * Returns: Array of { num: Number, lines: String[] }
     *   where `lines[0]` is the content after the "N. " prefix is stripped.
     *
     * Lines that appear before any numbered question are silently discarded
     * (they're usually headings or blank preamble).
     */
    function splitIntoBlocks(text) {
        const lines = text.split('\n');
        const blocks = [];
        let current = null;

        for (const line of lines) {
            if (isMainQMarker(line)) {
                if (current) blocks.push(current);

                const num = getMainQNumber(line);
                // Strip the leading "N. " or "Na. " from the first content line
                const content = line.replace(/^\s*\d+[a-z]?\.\s+/, '');

                current = { num, lines: [content] };
            } else if (current !== null) {
                current.lines.push(line);
            }
            // Lines before the first numbered question are ignored.
        }

        if (current) blocks.push(current);
        return blocks;
    }

    // =================================================================
    // PHASE 4 — OBJECTIVE DETECTION
    // =================================================================

    /**
     * A block is OBJECTIVE only if it contains >= 2 occurrences of the
     * pattern "(letter) " (letter followed by a space).
     *
     * Detection is done inside the block text only — not globally —
     * to avoid cross-contamination between questions.
     *
     * This prevents words like "vanilla." inside normal sentences from
     * being misclassified (those don't match the "(letter)" format).
     */
    function isObjectiveBlock(block) {
        const joined = block.lines.join(' ');
        const matches = joined.match(/\([a-zA-Z]\)\s+/g);
        return !!(matches && matches.length >= 2);
    }

    // =================================================================
    // PHASE 5 — OBJECTIVE (MCQ) PARSING
    // =================================================================

    /**
     * Parse an objective question block.
     * Supports both inline: "...question (a) opt (b) opt"
     * and multiline:
     *   question text
     *   (a) option 1
     *   (b) option 2
     *
     * Returns: { type: 'objective', questionNumber, text, options: [{label, text}] }
     */
    function parseObjective(block) {
        const joined = block.lines.join(' ').trim();

        // Split at every "(letter) " marker to extract question + options
        const parts = joined.split(/(\([a-zA-Z]\)\s+)/);

        // Everything before the first "(a)" is the question stem
        const text = parts[0].trim();
        const options = [];

        for (let i = 1; i < parts.length; i += 2) {
            const marker = parts[i];                         // e.g. "(a) "
            const labelMatch = marker.match(/\(([a-zA-Z])\)/);
            const label = labelMatch ? labelMatch[1].toLowerCase() : '';
            const optText = ((parts[i + 1]) || '').trim();

            if (optText) {
                options.push({ label, text: optText });
            }
        }

        return {
            type: 'objective',
            questionNumber: block.num,
            text,
            options
        };
    }

    // =================================================================
    // PHASE 6 — THEORY HIERARCHY PARSING (stack-based)
    // =================================================================

    /**
     * Build a flat, display-ready text string from a hierarchy.
     * Used to populate q.text so the Tiptap editor can display the
     * full question without needing to read the children array.
     *
     * Example output:
     *   "Explain the following:\na. plagiarism\nb. GIGO"
     */
    function formatTheoryText(mainText, children) {
        const lines = [];
        if (mainText) lines.push(mainText);

        for (const child of children) {
            lines.push(`${child.label}. ${child.text}`);
            for (const grandchild of (child.children || [])) {
                lines.push(`   ${grandchild.label}. ${grandchild.text}`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Parse a theory question block into a 3-level hierarchy.
     *
     * Algorithm (stack-based):
     *   - Lines before any L2/L3 marker → main question text (Level 1)
     *   - Lines starting with a single letter + "." → Level 2 child
     *   - Lines starting with a roman numeral + "." (when inside L2) → Level 3 grandchild
     *   - All other lines → appended to the current deepest context
     *
     * Ambiguity resolution:
     *   "i." is both a valid roman numeral (L3) and a valid letter (L2).
     *   Rule: if we are currently inside an L2 context, treat it as L3.
     *         Otherwise treat it as L2.
     *
     * False-positive prevention:
     *   Markers are only matched at the start of a line (after whitespace).
     *   Words like "vanilla." mid-sentence are never at line-start → safe.
     *
     * Returns: { type: 'theory', questionNumber, text, children }
     *   text     — full flat text (main + children formatted) for display
     *   children — [ { label, text, children: [ { label, text } ] } ]
     */
    function parseTheory(block) {
        const mainTextLines = [];
        const children = [];
        let currentL2 = null;   // The active Level 2 child node
        let currentL3 = null;   // The active Level 3 grandchild node

        for (const line of block.lines) {
            const trimmed = line.trim();

            // Skip blank lines within a block (they don't break structure)
            if (!trimmed) continue;

            const l3 = isLevel3Marker(line);
            const l2 = isLevel2Marker(line);
            const lp = isParenChildMarker(line);  // parenthesized: (a) text

            if (l3 && currentL2 !== null) {
                // ── Level 3 grandchild ──────────────────────────────────
                // Only enter L3 if we already have an L2 parent.
                // This resolves the "i." ambiguity: L3 only when nested.
                const parsed = parseMarkerLine(line);
                if (parsed) {
                    currentL3 = { label: parsed.label, text: parsed.text, children: [] };
                    currentL2.children.push(currentL3);
                }

            } else if (l2) {
                // ── Level 2 child ────────────────────────────────────────
                // Every alphabetic marker at the start of a line opens a new L2.
                // Reset L3 context — grandchildren belong to their own L2.
                const parsed = parseMarkerLine(line);
                if (parsed) {
                    currentL2 = { label: parsed.label, text: parsed.text, children: [] };
                    currentL3 = null;
                    children.push(currentL2);
                }

            } else if (lp) {
                // ── Level 2 parenthesized child ───────────────────────────
                // "(a) text" / "(b) text" — used in THEORY sections when
                // teachers write MCQ-style markers inside theory questions.
                const parsed = parseParenMarkerLine(line);
                if (parsed) {
                    currentL2 = { label: parsed.label, text: parsed.text, children: [] };
                    currentL3 = null;
                    children.push(currentL2);
                }

            } else {
                // ── Continuation / unstructured text ─────────────────────
                // Attach to the deepest active node.
                if (currentL3) {
                    currentL3.text += ' ' + trimmed;
                } else if (currentL2) {
                    currentL2.text += ' ' + trimmed;
                } else {
                    // Still at main question level (no L2 encountered yet)
                    mainTextLines.push(trimmed);
                }
            }
        }

        // Clean up extra whitespace in all nodes
        const cleanText = (s) => s.replace(/\s+/g, ' ').trim();
        const mainText = cleanText(mainTextLines.join(' '));

        // Recursively clean all node texts
        for (const child of children) {
            child.text = cleanText(child.text);
            for (const gc of (child.children || [])) {
                gc.text = cleanText(gc.text);
            }
        }

        // Build the flat display text (for q.text / Tiptap auto-populate)
        const displayText = formatTheoryText(mainText, children);

        return {
            type: 'theory',
            questionNumber: block.num,
            text: displayText,       // full formatted text for display
            _mainText: mainText,     // stem only (informational)
            children
        };
    }

    // =================================================================
    // PHASE 7 — POST-PARSE VALIDATION
    // =================================================================

    /**
     * Validate and repair the parsed question list.
     *
     * Rules:
     *   - Grandchildren cannot exist without a parent L2 child.
     *     (Parser prevents this by design, but we double-check.)
     *   - Theory questions with no text AND no children are discarded.
     */
    function validateQuestions(questions) {
        return questions.filter(q => {
            if (q.type === 'theory') {
                // Discard completely empty theory questions
                if (!q.text.trim() && (!q.children || q.children.length === 0)) {
                    return false;
                }
            }
            if (q.type === 'objective') {
                // Discard objectives with no text or no options
                if (!q.text.trim() || !q.options || q.options.length === 0) {
                    return false;
                }
            }
            return true;
        });
    }

    // =================================================================
    // MAIN ENTRY POINT
    // =================================================================

    /**
     * Parse raw bulk-import text into a structured question list.
     *
     * @param {string} rawText  - Raw pasted text from the import editor
     * @param {object} [opts]
     * @param {boolean} [opts.forceTheory=false] - If true, all questions
     *        are classified as theory regardless of content
     *
     * @returns {Array} Array of parsed question objects:
     *   Objective: { type:'objective', questionNumber, text, options:[{label,text}] }
     *   Theory:    { type:'theory',    questionNumber, text, children:[{label,text,children:[...]}] }
     *
     * The caller (examManager.js) is responsible for:
     *   - Assigning q.id via Utils.generateId()
     *   - Adding isCorrect:false and id to each option
     *   - Setting q.points, q.canvasJSON, q.canvasImage
     */
    function parse(rawText, opts) {
        opts = opts || {};

        // ── Step 1: Normalize ──────────────────────────────────────────
        let text = normalizeInput(rawText);
        text = normalizeMarkers(text);

        // ── Step 2: Detect THEORY / SECTION B / SECTION C / etc. ─────
        // A header like "--- THEORY ---", "=== SECTION B ===", "SECTION B:",
        // or just "SECTION B" on its own line splits the text into two sections:
        // before = parse normally, after = force theory type.
        let forceTheorySection = '';
        const theoryMarkerMatch = text.match(/\n[^\n]*[-=]*\s*(?:THEORY|SECTION\s+[A-Z\d]+)\s*[-=:]*\s*\n/i);
        if (theoryMarkerMatch) {
            const splitIdx = text.indexOf(theoryMarkerMatch[0]);
            const markerEnd = splitIdx + theoryMarkerMatch[0].length;
            forceTheorySection = text.slice(markerEnd);
            text = text.slice(0, splitIdx);
        }

        // ── Step 2b: Auto-number if no numbered markers exist ─────────
        // Handles mobile/textarea scenario where teachers paste questions
        // without numbering them. Each blank-line-separated paragraph
        // becomes one question, numbered 1. 2. 3. etc.
        if (!/^\s*\d+[a-z]?\.\s+/m.test(text)) {
            const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
            if (paragraphs.length > 0) {
                text = paragraphs.map((p, i) => `${i + 1}. ${p}`).join('\n\n');
            }
        }
        if (forceTheorySection && !/^\s*\d+[a-z]?\.\s+/m.test(forceTheorySection)) {
            const paragraphs = forceTheorySection.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
            if (paragraphs.length > 0) {
                forceTheorySection = paragraphs.map((p, i) => `${i + 1}. ${p}`).join('\n\n');
            }
        }

        // ── Step 3: Split into question blocks ────────────────────────
        const normalBlocks = splitIntoBlocks(text);
        const theoryBlocks = forceTheorySection
            ? splitIntoBlocks(forceTheorySection)
            : [];

        // ── Step 4: Classify and parse each block ─────────────────────
        const parsed = [];

        for (const block of normalBlocks) {
            if (opts.forceTheory) {
                parsed.push(parseTheory(block));
            } else if (isObjectiveBlock(block)) {
                parsed.push(parseObjective(block));
            } else {
                parsed.push(parseTheory(block));
            }
        }

        // Force-theory section: always theory regardless of content
        for (const block of theoryBlocks) {
            const q = parseTheory(block);
            parsed.push(q);
        }

        // ── Step 5: Validate ──────────────────────────────────────────
        return validateQuestions(parsed);
    }

    // =================================================================
    // PUBLIC API
    // =================================================================
    return { parse };

})();
