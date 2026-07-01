const attendanceService = {
    moduleId: 'attendance',
    getStatus() {
        return {
            moduleId: 'attendance',
            ready: true,
            phase: 'active',
            note: 'Attendance module is live — teachers mark, students view.'
        };
    }
};

export default attendanceService;
