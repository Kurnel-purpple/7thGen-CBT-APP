const cbtRoutes = [
    {
        path: '/pages/create-exam.html',
        roles: ['admin', 'teacher'],
        permissions: ['cbt.create_exam']
    },
    {
        path: '/pages/teacher-dashboard.html',
        roles: ['admin', 'teacher'],
        permissions: ['cbt.view_teacher_dashboard']
    },
    {
        path: '/pages/student-dashboard.html',
        roles: ['student'],
        permissions: ['cbt.view_student_dashboard']
    },
    {
        path: '/pages/take-exam.html',
        roles: ['student'],
        permissions: ['cbt.take_exam']
    },
    {
        path: '/pages/exam-results.html',
        roles: ['admin', 'teacher', 'student'],
        permissions: ['cbt.view_results']
    }
];

export default cbtRoutes;
