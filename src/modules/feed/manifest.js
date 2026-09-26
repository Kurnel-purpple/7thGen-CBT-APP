import feedRoutes from './routes.js';
import feedNav from './nav.js';
import feedPermissions from './permissions.js';
import feedService from './service.js';

const feedManifest = {
    id: 'feed',
    name: 'Feed',
    version: '1.0.0',
    routes: feedRoutes,
    nav: feedNav,
    permissions: feedPermissions,
    service: feedService
};

export default feedManifest;
