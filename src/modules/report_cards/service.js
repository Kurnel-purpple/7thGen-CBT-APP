const reportCardsService = {
    moduleId: 'report_cards',
    getStatus() {
        return {
            moduleId: 'report_cards',
            ready: true,
            phase: 'active',
            note: 'Report Cards module is live — teachers generate, students view.'
        };
    }
};

export default reportCardsService;
