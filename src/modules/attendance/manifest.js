import attendanceRoutes from './routes.js';
import attendanceNav from './nav.js';
import attendancePermissions from './permissions.js';
import attendanceService from './service.js';

const attendanceManifest = {
    id: 'attendance',
    name: 'Attendance',
    version: '0.1.0',
    routes: attendanceRoutes,
    nav: attendanceNav,
    permissions: attendancePermissions,
    service: attendanceService
};

export default attendanceManifest;
