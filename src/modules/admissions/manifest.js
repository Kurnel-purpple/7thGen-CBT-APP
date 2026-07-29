import admissionsRoutes from './routes.js';
import admissionsNav from './nav.js';
import admissionsPermissions from './permissions.js';
import admissionsService from './service.js';

const admissionsManifest = {
    id: 'admissions',
    name: 'Admissions',
    version: '1.0.0',
    routes: admissionsRoutes,
    nav: admissionsNav,
    permissions: admissionsPermissions,
    service: admissionsService
};

export default admissionsManifest;
