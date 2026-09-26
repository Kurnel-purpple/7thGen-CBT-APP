import feesRoutes from './routes.js';
import feesNav from './nav.js';
import feesPermissions from './permissions.js';
import feesService from './service.js';

const feesManifest = {
    id: 'fees',
    name: 'Fees',
    version: '1.0.0',
    routes: feesRoutes,
    nav: feesNav,
    permissions: feesPermissions,
    service: feesService
};

export default feesManifest;
