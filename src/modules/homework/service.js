const homeworkService = {
    moduleId: 'homework',
    getStatus() {
        return {
            moduleId: 'homework',
            ready: true,
            phase: 'live',
            note: 'Homework runs on PocketBase (homework_assignments, homework_submissions). Teachers create / edit / delete / grade; students submit and resubmit.'
        };
    }
};

export default homeworkService;
