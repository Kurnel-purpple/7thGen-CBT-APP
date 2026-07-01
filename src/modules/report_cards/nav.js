const reportCardsNav = [
    {
        label: 'Report Cards',
        path: '/pages/report-cards.html',
        roles: ['admin', 'teacher'],
        permissions: ['report_cards.view_dashboard'],
        section: 'Academic Life'
    },
    {
        label: 'My Report Card',
        path: '/pages/student-report-card.html',
        roles: ['student'],
        permissions: ['report_cards.view_own'],
        section: 'Academic Life'
    }
];

export default reportCardsNav;
