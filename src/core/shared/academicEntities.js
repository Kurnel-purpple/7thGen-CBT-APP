(function(global) {
    'use strict';
    const LEVEL_LABELS = {
        secondary: 'Secondary',
        primary: 'Primary'
    };

    const CLASSES_BY_LEVEL = {
        secondary: [
            { value: 'JSS1', text: 'JSS 1' },
            { value: 'JSS2', text: 'JSS 2' },
            { value: 'JSS3', text: 'JSS 3' },
            { value: 'SS1', text: 'SS 1' },
            { value: 'SS2', text: 'SS 2' },
            { value: 'SS3', text: 'SS 3' }
        ],
        primary: [
            { value: 'Grade 4', text: 'Grade 4' },
            { value: 'Grade 5&6', text: 'Grade 5&6' }
        ]
    };

    const SUBJECTS_BY_LEVEL = {
        secondary: [
            'Maths', 'English (grammar)', 'English (comprehension)', 'English (composition)',
            'Civic education', 'Literature', 'Physics', 'Chemistry', 'Economics', 'Biology',
            'Further Mathematics', 'Yoruba', 'CRS', 'IRS', 'Agric Science', 'Food and Nutrition',
            'Geography', 'Government', 'Data Processing', 'Commerce', 'Marketing',
            'Financial Accounting', 'Basic Science', 'Basic Technology', 'Home Economics',
            'Business Studies', 'French', 'Culture and Creative Arts', 'History',
            'Social Studies', 'Music', 'Speech', 'ICT', 'PHE'
        ],
        primary: [
            'Mathematics', 'English Studies', 'Home Economics', 'Basic Science',
            'Agricultural Science', 'National Value', 'Verbal Reasoning', 'Quantitative Reasoning',
            'C.R.S', 'P.H.E', 'Computer Studies', 'History', 'French', 'Speech', 'C.C.A', 'Yoruba'
        ]
    };

    function cloneClassList(items, includeAll) {
        const list = Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
        if (includeAll) {
            return [{ value: 'All', text: 'All Classes' }, ...list];
        }
        return list;
    }

    function getClassesByLevel(options) {
        const includeAll = !!(options && options.includeAll);
        return Object.fromEntries(
            Object.entries(CLASSES_BY_LEVEL).map(([level, items]) => [level, cloneClassList(items, includeAll)])
        );
    }

    function getSubjectsByLevel() {
        return Object.fromEntries(
            Object.entries(SUBJECTS_BY_LEVEL).map(([level, items]) => [level, [...items]])
        );
    }

    function getAllClasses(options) {
        const includeAll = !!(options && options.includeAll);
        // Don't pass includeAll to getClassesByLevel — it would add "All Classes" per level
        const classesByLevel = getClassesByLevel();
        const flat = Object.values(classesByLevel).flat();
        if (includeAll) {
            flat.unshift({ value: 'All', text: 'All Classes' });
        }
        return flat;
    }

    function getCatalog(options) {
        return {
            levelLabels: { ...LEVEL_LABELS },
            classesByLevel: getClassesByLevel(options),
            subjectsByLevel: getSubjectsByLevel()
        };
    }

    // End-of-session promotion ladder: each class advances to the next at
    // the start of a new school session; the top class graduates.
    const PROMOTION_LADDER = ['Grade 4', 'Grade 5&6', 'JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'];
    const GRADUATED_CLASS = 'Graduated';

    // Compare class names ignoring spaces/case so "JSS 1", "jss1" and "JSS1"
    // all map to the same ladder rung.
    function _classKey(v) {
        return String(v || '').replace(/\s+/g, '').toUpperCase();
    }

    /**
     * The class a student moves to at the start of a new session.
     * @param {string} classValue current class (matched to PROMOTION_LADDER,
     *   tolerant of spacing/case)
     * @returns {string|null} next class, GRADUATED_CLASS for the top class,
     *   or null when the class isn't on the ladder (blank/unknown/graduated)
     */
    function getNextClass(classValue) {
        const key = _classKey(classValue);
        if (!key) return null;
        const i = PROMOTION_LADDER.findIndex((c) => _classKey(c) === key);
        if (i === -1) return null;
        if (i === PROMOTION_LADDER.length - 1) return GRADUATED_CLASS;
        return PROMOTION_LADDER[i + 1];
    }

    const api = {
        LEVEL_LABELS,
        PROMOTION_LADDER,
        GRADUATED_CLASS,
        getCatalog,
        getAllClasses,
        getClassesByLevel,
        getSubjectsByLevel,
        getNextClass
    };

    global.academicEntities = api;

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
