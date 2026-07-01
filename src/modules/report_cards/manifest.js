import reportCardsRoutes from './routes.js';
import reportCardsNav from './nav.js';
import reportCardsPermissions from './permissions.js';
import reportCardsService from './service.js';

const reportCardsManifest = {
    id: 'report_cards',
    name: 'Report Cards',
    version: '0.1.0',
    routes: reportCardsRoutes,
    nav: reportCardsNav,
    permissions: reportCardsPermissions,
    service: reportCardsService
};

export default reportCardsManifest;
