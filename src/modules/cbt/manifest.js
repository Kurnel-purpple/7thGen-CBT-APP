import cbtRoutes from './routes.js';
import cbtNav from './nav.js';
import cbtPermissions from './permissions.js';
import cbtService from './service.js';

const cbtManifest = {
    id: 'cbt',
    name: 'CBT',
    version: '1.0.0',
    routes: cbtRoutes,
    nav: cbtNav,
    permissions: cbtPermissions,
    service: cbtService
};

export default cbtManifest;
