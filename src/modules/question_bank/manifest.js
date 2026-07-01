import questionBankRoutes from './routes.js';
import questionBankNav from './nav.js';
import questionBankPermissions from './permissions.js';
import questionBankService from './service.js';

const questionBankManifest = {
    id: 'question_bank',
    name: 'Question Bank',
    version: '0.1.0',
    routes: questionBankRoutes,
    nav: questionBankNav,
    permissions: questionBankPermissions,
    service: questionBankService
};

export default questionBankManifest;
