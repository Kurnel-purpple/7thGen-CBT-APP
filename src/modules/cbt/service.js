const DRAFT_SESSION_KEY = 'cbt.pendingExamDraft';

function cloneQuestion(question = {}) {
    const type = question.type || 'mcq';
    let options = Array.isArray(question.options) ? question.options.map((option) => ({ ...option })) : [];
    const answer = question.answer ?? null;

    // Convert QB-style answer field into isCorrect on options for MCQ/image_mcq types
    if (answer && (type === 'mcq' || type === 'image_mcq') && options.length > 0) {
        const hasIsCorrect = options.some((o) => o.isCorrect);
        if (!hasIsCorrect) {
            options = options.map((o) => ({
                ...o,
                isCorrect: o.id === answer
            }));
        }
    }

    // Convert QB-style answer for true_false into correctAnswer
    let correctAnswer = question.correctAnswer ?? null;
    if (type === 'true_false' && answer && !correctAnswer) {
        correctAnswer = answer;
    }
    // Convert QB-style answer for fill_blank into correctAnswer
    if (type === 'fill_blank' && answer && !correctAnswer) {
        correctAnswer = answer;
    }

    return {
        id: question.id || `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        text: question.text || '',
        options,
        answer,
        correctAnswer,
        points: question.points ?? '',
        children: Array.isArray(question.children) ? question.children.map((child) => ({ ...child })) : [],
        pairs: Array.isArray(question.pairs) ? question.pairs.map((p) => ({ ...p })) : [],
        subQuestions: Array.isArray(question.subQuestions) ? question.subQuestions.map((sq) => ({ ...sq })) : [],
        topInstruction: question.topInstruction || '',
        image: question.image || null,
        mediaAttachments: Array.isArray(question.mediaAttachments) ? question.mediaAttachments.map((item) => ({ ...item })) : []
    };
}

function sanitizeDraftPayload(seed = {}) {
    return {
        title: seed.title || '',
        subject: seed.subject || '',
        schoolLevel: seed.schoolLevel || '',
        targetClass: seed.targetClass || 'All',
        instructions: seed.instructions || '',
        theoryInstructions: seed.theoryInstructions || '',
        scheduledDate: seed.scheduledDate || '',
        duration: seed.duration || '',
        passScore: seed.passScore || '',
        scrambleQuestions: !!seed.scrambleQuestions,
        sourceModule: seed.sourceModule || null,
        sourceContext: seed.sourceContext || null,
        questions: Array.isArray(seed.questions) ? seed.questions.map(cloneQuestion) : []
    };
}

const cbtService = {
    moduleId: 'cbt',
    draftSessionKey: DRAFT_SESSION_KEY,
    getStatus() {
        return {
            moduleId: 'cbt',
            ready: true,
            phase: 'extracted',
            note: 'CBT now exposes a public exam-draft surface for future modules such as Question Bank.'
        };
    },
    buildExamDraft(seed = {}) {
        return sanitizeDraftPayload(seed);
    },
    savePendingExamDraft(seed = {}) {
        const payload = sanitizeDraftPayload(seed);
        sessionStorage.setItem(DRAFT_SESSION_KEY, JSON.stringify(payload));
        return payload;
    },
    consumePendingExamDraft() {
        const raw = sessionStorage.getItem(DRAFT_SESSION_KEY);
        if (!raw) {
            return null;
        }

        sessionStorage.removeItem(DRAFT_SESSION_KEY);

        try {
            return sanitizeDraftPayload(JSON.parse(raw));
        } catch (error) {
            console.warn('[CBT Service] Failed to parse pending exam draft:', error);
            return null;
        }
    },
    openExamBuilder(seed = {}, options = {}) {
        this.savePendingExamDraft(seed);
        if (options.navigate !== false) {
            window.location.href = options.path || 'create-exam.html';
        }
    }
};

export default cbtService;
