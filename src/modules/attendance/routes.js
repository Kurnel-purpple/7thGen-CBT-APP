const attendanceRoutes = [
    {
        path: '/pages/attendance.html',
        roles: ['admin', 'teacher'],
        permissions: ['attendance.view_dashboard']
    },
    {
        path: '/pages/student-attendance.html',
        roles: ['student'],
        permissions: ['attendance.view_own']
    }
];

export default attendanceRoutes;
