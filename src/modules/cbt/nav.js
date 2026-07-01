const cbtNav = [
    {
        label: 'Exams',
        path: '/pages/teacher-dashboard.html',
        roles: ['admin', 'teacher'],
        permissions: ['cbt.view_teacher_dashboard'],
        section: 'Assessment'
    },
    {
        label: 'My Exams',
        path: '/pages/student-dashboard.html',
        roles: ['student'],
        permissions: ['cbt.view_student_dashboard'],
        section: 'Assessment'
    }
];

export default cbtNav;
