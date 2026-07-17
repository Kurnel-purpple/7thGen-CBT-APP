const broadsheetService = {
    moduleId: 'broadsheet',
    getStatus() {
        return {
            moduleId: 'broadsheet',
            ready: true,
            phase: 'active',
            note: 'Broadsheet module is live — class-wide term and session performance sheets.'
        };
    }
};

export default broadsheetService;
