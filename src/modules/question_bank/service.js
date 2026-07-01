const SAMPLE_QUESTIONS = [
    {
        type: 'mcq',
        text: 'Which organ pumps blood around the human body?',
        subject: 'Biology',
        term: 'Circulatory System',
        difficulty: 'easy',
        tags: ['anatomy', 'organs'],
        options: [
            { id: 'a', text: 'Liver' },
            { id: 'b', text: 'Heart' },
            { id: 'c', text: 'Kidney' },
            { id: 'd', text: 'Lung' }
        ],
        answer: 'b',
        explanation: 'The heart is a muscular organ that pumps blood through the circulatory system.',
        points: 1
    },
    {
        type: 'mcq',
        text: 'Water boils at what temperature under normal atmospheric pressure?',
        subject: 'Chemistry',
        term: 'States of Matter',
        difficulty: 'easy',
        tags: ['boiling point', 'water'],
        options: [
            { id: 'a', text: '50 C' },
            { id: 'b', text: '75 C' },
            { id: 'c', text: '100 C' },
            { id: 'd', text: '150 C' }
        ],
        answer: 'c',
        explanation: 'At standard atmospheric pressure (1 atm), water boils at 100 degrees Celsius.',
        points: 1
    }
];

const questionBankService = {
    moduleId: 'question_bank',
    getStatus() {
        return {
            moduleId: 'question_bank',
            ready: true,
            phase: 'scaffolded',
            note: 'Question Bank scaffold is live and can seed CBT exam drafts through the public CBT service.'
        };
    },
    getSampleQuestions() {
        return SAMPLE_QUESTIONS.map((question, index) => ({
            id: `sample-qb-${index + 1}`,
            ...question,
            options: Array.isArray(question.options) ? question.options.map((option) => ({ ...option })) : [],
            tags: Array.isArray(question.tags) ? [...question.tags] : []
        }));
    },
    seedExamFromQuestions(seed = {}) {
        const cbtService = window.__moduleLoader?.getModuleService('cbt');
        if (!cbtService?.openExamBuilder) {
            throw new Error('CBT service is unavailable. Enable CBT before seeding an exam.');
        }

        return cbtService.openExamBuilder({
            title: seed.title || 'Seeded Exam Draft',
            subject: seed.subject || '',
            schoolLevel: seed.schoolLevel || '',
            targetClass: seed.targetClass || 'All',
            instructions: seed.instructions || 'Draft generated from Question Bank.',
            sourceModule: 'question_bank',
            sourceContext: seed.sourceContext || 'sample_bank',
            questions: Array.isArray(seed.questions) ? seed.questions : this.getSampleQuestions()
        });
    }
};

export default questionBankService;

