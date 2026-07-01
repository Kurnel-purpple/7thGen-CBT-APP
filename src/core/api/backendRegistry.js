const backendRegistry = {
    'shared-main-1': {
        provider: 'pocketbase',
        baseUrl: 'https://gen7-cbt-app.fly.dev',
        storageBaseUrl: 'https://gen7-cbt-app.fly.dev',
        authStrategy: 'pocketbase_auth'
    }
};

export function getBackendRegistry() {
    return { ...backendRegistry };
}

export function registerBackend(key, config) {
    if (!key) {
        throw new Error('Backend key is required.');
    }
    backendRegistry[key] = {
        ...config
    };
    return backendRegistry[key];
}

export default backendRegistry;
