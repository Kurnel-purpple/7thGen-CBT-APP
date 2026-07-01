import configLoader from '../../config/configLoader.js';

const DEFAULT_ENABLED_MODULES = ['cbt'];
const DEFAULT_TENANCY = {
    mode: 'shared',
    backendKey: 'shared-main-1'
};

function cloneArray(value, fallback = []) {
    return Array.isArray(value) ? [...value] : [...fallback];
}

function cloneObject(value, fallback = {}) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...value }
        : { ...fallback };
}

export function normalizeClientRuntime(rawConfig = {}, options = {}) {
    const clientId = options.clientId || rawConfig.clientId || 'default';
    const enabledModules = cloneArray(
        rawConfig.modules?.enabled || rawConfig.enabledModules,
        DEFAULT_ENABLED_MODULES
    );
    const tenancy = {
        ...DEFAULT_TENANCY,
        ...cloneObject(rawConfig.tenancy)
    };
    const school = {
        schoolVersion: rawConfig.school?.schoolVersion || rawConfig.schoolVersion || null
    };

    return {
        clientId,
        branding: {
            client: cloneObject(rawConfig.client),
            branding: cloneObject(rawConfig.branding),
            typography: cloneObject(rawConfig.typography),
            footer: cloneObject(rawConfig.footer),
            pageTitles: cloneObject(rawConfig.pageTitles)
        },
        features: cloneObject(rawConfig.features),
        modules: {
            enabled: enabledModules,
            settings: cloneObject(rawConfig.modules?.settings || rawConfig.moduleSettings)
        },
        tenancy,
        school,
        rawConfig
    };
}

export async function buildClientRuntime(clientId = 'default') {
    const rawConfig = await configLoader.loadConfig(clientId);
    return normalizeClientRuntime(rawConfig, { clientId });
}

export default {
    buildClientRuntime,
    normalizeClientRuntime
};
