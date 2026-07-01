const homeworkNav = [
    {
        label: 'Homework',
        path: '/pages/homework.html',
        roles: ['admin', 'teacher'],
        permissions: ['homework.view_dashboard'],
        section: 'Academic Life'
    },
    {
        label: 'My Homework',
        path: '/pages/student-homework.html',
        roles: ['student'],
        permissions: ['homework.view_own'],
        section: 'Academic Life'
    }
];

export default homeworkNav;
