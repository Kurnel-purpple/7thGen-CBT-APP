/**
 * Question Similarity
 *
 * Decides whether two question texts are "the same question" when they are not
 * character-for-character identical — different punctuation, spacing, casing,
 * or a reworded stem ("Which of the following is a mammal?" vs "Which of these
 * is a mammal?").
 *
 * Pure functions only: no DOM, no network, no PocketBase. The data service
 * owns fetching the candidate pool (scoped by subject/term/school); this file
 * only scores what it is handed. That split is what makes it unit-testable.
 *
 * Loaded as a plain script in the browser (window.QuestionSimilarity) and as a
 * CommonJS module under Node for the tests.
 */

(function(root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.QuestionSimilarity = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
    'use strict';

    // Filler that carries no distinguishing meaning in a question stem. Both
    // sides get the same treatment, so dropping these only removes noise.
    var STOP_WORDS = {
        a: 1, an: 1, the: 1, of: 1, is: 1, are: 1, was: 1, were: 1, to: 1, in: 1,
        on: 1, at: 1, for: 1, and: 1, or: 1, which: 1, what: 1, following: 1,
        these: 1, those: 1, this: 1, that: 1, it: 1, its: 1, as: 1, be: 1,
        been: 1, has: 1, have: 1, had: 1, do: 1, does: 1, did: 1, from: 1,
        by: 1, with: 1, one: 1, option: 1, options: 1, answer: 1, correct: 1,
        best: 1, choose: 1, select: 1, below: 1, above: 1, given: 1
    };

    /**
     * Words that invert what a question is asking. Deliberately NOT stop
     * words: "Which of the following is a mammal" and "...is NOT a mammal"
     * are opposite questions built from nearly identical text, and an exam
     * bank that silently merges them is worse than one with duplicates.
     */
    var NEGATION_WORDS = {
        not: 1, no: 1, never: 1, none: 1, nor: 1, neither: 1, except: 1,
        cannot: 1, without: 1, excluding: 1, exclude: 1, incorrect: 1,
        false: 1, wrong: 1, least: 1, unlike: 1
    };

    // Applied when one question is negated and the other is not.
    var NEGATION_PENALTY = 0.6;

    // Scores at or above this are treated as the same question outright.
    var IDENTICAL_THRESHOLD = 0.92;
    // Scores at or above this are surfaced to the user for a decision.
    // Set from measurement, not taste: "List three causes of erosion" vs
    // "...three effects of erosion" scores 0.75, and must not be flagged.
    var SIMILAR_THRESHOLD = 0.80;

    /**
     * Strip a question stem down to comparable text: no markup, no smart
     * punctuation, no case, no double spaces.
     */
    function normalizeText(value) {
        return String(value == null ? '' : value)
            .replace(/<[^>]*>/g, ' ')                 // strip any HTML markup
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .toLowerCase()
            .replace(/[‘’‚‛]/g, "'")   // curly → straight quotes
            .replace(/[“”„‟]/g, '"')
            .replace(/[‐-―]/g, '-')             // dashes → hyphen
            .replace(/[^a-z0-9\s]/g, ' ')                 // drop punctuation
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** Normalized text with filler words removed. */
    function tokenize(value) {
        var normalized = normalizeText(value);
        if (!normalized) return [];
        var tokens = normalized.split(' ').filter(function(t) {
            return t.length > 0 && !STOP_WORDS[t];
        });
        // A stem made entirely of stop words still has to compare as something
        return tokens.length > 0 ? tokens : normalized.split(' ');
    }

    function uniqueSet(list) {
        var set = Object.create(null);
        list.forEach(function(item) { set[item] = true; });
        return set;
    }

    /** Dice coefficient over two sets: 2·|A∩B| / (|A|+|B|). */
    function diceOfSets(setA, setB) {
        var keysA = Object.keys(setA);
        var keysB = Object.keys(setB);
        if (keysA.length === 0 && keysB.length === 0) return 1;
        if (keysA.length === 0 || keysB.length === 0) return 0;
        var overlap = 0;
        keysA.forEach(function(k) { if (setB[k]) overlap++; });
        return (2 * overlap) / (keysA.length + keysB.length);
    }

    /**
     * Character trigrams of an already-normalized string — catches typos and
     * small edits.
     *
     * Always fed the content string (stop words stripped), never the raw stem.
     * On raw text, two questions sharing a long boilerplate opener — "Which of
     * the following is correct about X" vs "...about Y" — score ~0.86 on shared
     * filler alone, which is a false duplicate.
     */
    function trigramsOf(normalized) {
        var padded = ' ' + normalized + ' ';
        var set = Object.create(null);
        for (var i = 0; i < padded.length - 2; i++) set[padded.slice(i, i + 3)] = true;
        return set;
    }

    /** Adjacent token pairs — keeps some word-order sensitivity. */
    function tokenBigrams(tokens) {
        var set = Object.create(null);
        if (tokens.length === 1) { set[tokens[0]] = true; return set; }
        for (var i = 0; i < tokens.length - 1; i++) set[tokens[i] + ' ' + tokens[i + 1]] = true;
        return set;
    }

    /**
     * How alike are two question stems, 0 (unrelated) to 1 (the same)?
     *
     * Three views of the *content* words are scored and the strongest wins:
     * word overlap catches reordering, word-pair overlap keeps some order
     * sensitivity, and character trigrams catch typos. Taking the max makes
     * the check eager — it would rather raise a pair the user dismisses than
     * let a duplicate through silently, which is the point of the feature.
     *
     * Every measure runs on the stop-word-stripped text. Scoring the raw stem
     * makes questions that differ only in the one word that matters — the
     * capital of Nigeria vs of Ghana — look like duplicates, because the
     * shared opener is most of the string.
     */
    function scoreText(a, b) {
        var normA = normalizeText(a);
        var normB = normalizeText(b);
        if (!normA && !normB) return 1;
        if (!normA || !normB) return 0;
        if (normA === normB) return 1;

        var tokensA = tokenize(a);
        var tokensB = tokenize(b);

        var wordScore = diceOfSets(uniqueSet(tokensA), uniqueSet(tokensB));
        var bigramScore = diceOfSets(tokenBigrams(tokensA), tokenBigrams(tokensB));
        var charScore = diceOfSets(trigramsOf(tokensA.join(' ')), trigramsOf(tokensB.join(' ')));

        var score = Math.max(wordScore, bigramScore, charScore);

        // Opposite polarity means opposite question, however alike the words.
        // Compared as a boolean, not word-by-word, so "is not correct" and
        // "is incorrect" still read as the same negated question.
        if (isNegated(tokensA) !== isNegated(tokensB)) score *= NEGATION_PENALTY;

        return score;
    }

    /** Does this stem ask for the exception rather than the rule? */
    function isNegated(tokens) {
        return tokens.some(function(token) { return !!NEGATION_WORDS[token]; });
    }

    /** Options compared as an unordered set of normalized labels. */
    function optionsSignature(question) {
        var options = (question && question.options) || [];
        if (!Array.isArray(options) || options.length === 0) return null;
        return options
            .map(function(opt) { return normalizeText(opt && (opt.text || opt.label || opt)); })
            .filter(function(t) { return t.length > 0; })
            .sort()
            .join('|');
    }

    /**
     * Compare two whole questions.
     * @returns {{score:number, level:string, sameType:boolean,
     *            sameOptions:boolean|null, sameAnswer:boolean|null}}
     */
    function compareQuestions(a, b) {
        var score = scoreText(a && a.text, b && b.text);
        var sigA = optionsSignature(a);
        var sigB = optionsSignature(b);

        var answerA = normalizeText((a && (a.answer || a.correctAnswer)) || '');
        var answerB = normalizeText((b && (b.answer || b.correctAnswer)) || '');

        return {
            score: score,
            level: score >= IDENTICAL_THRESHOLD ? 'identical'
                : score >= SIMILAR_THRESHOLD ? 'similar' : 'different',
            sameType: (a && a.type || 'mcq') === (b && b.type || 'mcq'),
            sameOptions: (sigA === null || sigB === null) ? null : sigA === sigB,
            sameAnswer: (!answerA && !answerB) ? null : answerA === answerB
        };
    }

    /** True when the pair is close enough to be worth showing the user. */
    function isMatch(a, b) {
        return compareQuestions(a, b).score >= SIMILAR_THRESHOLD;
    }

    /**
     * Score one question against a pool, strongest match first.
     * @param {Object} question
     * @param {Array}  pool
     * @param {Object} [opts] - { threshold, limit, excludeId }
     */
    function findMatches(question, pool, opts) {
        opts = opts || {};
        var threshold = typeof opts.threshold === 'number' ? opts.threshold : SIMILAR_THRESHOLD;
        var matches = [];

        (pool || []).forEach(function(candidate) {
            if (!candidate) return;
            if (opts.excludeId && candidate.id === opts.excludeId) return;
            var result = compareQuestions(question, candidate);
            if (result.score >= threshold) {
                matches.push({
                    question: candidate,
                    score: result.score,
                    level: result.level,
                    sameType: result.sameType,
                    sameOptions: result.sameOptions,
                    sameAnswer: result.sameAnswer
                });
            }
        });

        matches.sort(function(x, y) { return y.score - x.score; });
        return opts.limit ? matches.slice(0, opts.limit) : matches;
    }

    /**
     * Group a list of questions into clusters of near-duplicates.
     *
     * Union-find over every pair above the threshold, so A~B and B~C put all
     * three in one cluster even when A and C alone fall just short. Only
     * clusters of 2+ are returned; singletons are not duplicates.
     *
     * O(n²) comparisons — callers must scope the list first (by subject and
     * term) rather than handing over the entire bank.
     */
    function clusterDuplicates(questions, opts) {
        opts = opts || {};
        var threshold = typeof opts.threshold === 'number' ? opts.threshold : SIMILAR_THRESHOLD;
        var list = (questions || []).filter(Boolean);
        var parent = list.map(function(_, i) { return i; });

        function find(i) {
            while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
            return i;
        }
        function union(i, j) {
            var rootI = find(i), rootJ = find(j);
            if (rootI !== rootJ) parent[rootJ] = rootI;
        }

        var bestScore = Object.create(null);
        for (var i = 0; i < list.length; i++) {
            for (var j = i + 1; j < list.length; j++) {
                var score = scoreText(list[i].text, list[j].text);
                if (score >= threshold) {
                    union(i, j);
                    var key = find(i);
                    if (!bestScore[key] || score > bestScore[key]) bestScore[key] = score;
                }
            }
        }

        var groups = Object.create(null);
        list.forEach(function(question, index) {
            var root = find(index);
            (groups[root] = groups[root] || []).push(question);
        });

        return Object.keys(groups)
            .filter(function(root) { return groups[root].length > 1; })
            .map(function(root) {
                return {
                    questions: groups[root],
                    // Oldest first, so "keep the first, drop the rest" is the
                    // safe default — the original survives.
                    score: bestScore[root] || threshold
                };
            })
            .map(function(cluster) {
                cluster.questions.sort(function(a, b) {
                    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
                });
                return cluster;
            })
            .sort(function(a, b) { return b.questions.length - a.questions.length || b.score - a.score; });
    }

    return {
        IDENTICAL_THRESHOLD: IDENTICAL_THRESHOLD,
        SIMILAR_THRESHOLD: SIMILAR_THRESHOLD,
        normalizeText: normalizeText,
        tokenize: tokenize,
        scoreText: scoreText,
        compareQuestions: compareQuestions,
        isMatch: isMatch,
        findMatches: findMatches,
        clusterDuplicates: clusterDuplicates
    };
});
