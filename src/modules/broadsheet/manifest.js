import broadsheetRoutes from './routes.js';
import broadsheetNav from './nav.js';
import broadsheetPermissions from './permissions.js';
import broadsheetService from './service.js';

const broadsheetManifest = {
    id: 'broadsheet',
    name: 'Broadsheet',
    version: '0.1.0',
    routes: broadsheetRoutes,
    nav: broadsheetNav,
    permissions: broadsheetPermissions,
    service: broadsheetService
};

export default broadsheetManifest;
