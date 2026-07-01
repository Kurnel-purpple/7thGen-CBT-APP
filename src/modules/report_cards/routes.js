const reportCardsRoutes = [
    {
        path: '/pages/report-cards.html',
        roles: ['admin', 'teacher'],
        permissions: ['report_cards.view_dashboard']
    },
    {
        path: '/pages/student-report-card.html',
        roles: ['student'],
        permissions: ['report_cards.view_own']
    }
];

export default reportCardsRoutes;
