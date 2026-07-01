import homeworkRoutes from './routes.js';
import homeworkNav from './nav.js';
import homeworkPermissions from './permissions.js';
import homeworkService from './service.js';

const homeworkManifest = {
    id: 'homework',
    name: 'Homework',
    version: '1.0.0',
    routes: homeworkRoutes,
    nav: homeworkNav,
    permissions: homeworkPermissions,
    service: homeworkService
};

export default homeworkManifest;
