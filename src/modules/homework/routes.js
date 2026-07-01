const homeworkRoutes = [
    {
        path: '/pages/homework.html',
        roles: ['admin', 'teacher'],
        permissions: ['homework.view_dashboard']
    },
    {
        path: '/pages/student-homework.html',
        roles: ['student'],
        permissions: ['homework.view_own']
    }
];

export default homeworkRoutes;
