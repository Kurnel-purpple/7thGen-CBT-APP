const attendanceNav = [
    {
        label: 'Attendance',
        path: '/pages/attendance.html',
        roles: ['admin', 'teacher'],
        permissions: ['attendance.view_dashboard'],
        section: 'Academic Life'
    },
    {
        label: 'My Attendance',
        path: '/pages/student-attendance.html',
        roles: ['student'],
        permissions: ['attendance.view_own'],
        section: 'Academic Life'
    }
];

export default attendanceNav;
