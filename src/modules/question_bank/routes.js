const questionBankRoutes = [
    {
        path: '/pages/question-bank.html',
        roles: ['admin', 'teacher'],
        permissions: ['question_bank.view']
    }
];

export default questionBankRoutes;
