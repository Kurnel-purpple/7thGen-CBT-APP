import backendRegistry from './backendRegistry.js';

const DEFAULT_TENANCY = {
    mode: 'shared',
    backendKey: 'shared-main-1'
};

export function resolveBackend(runtimeConfig = {}) {
    const tenancy = {
        ...DEFAULT_TENANCY,
        ...(runtimeConfig.tenancy || {})
    };

    const resolved = backendRegistry[tenancy.backendKey];
    if (!resolved) {
        throw new Error(`Unknown backend key: ${tenancy.backendKey}`);
    }

    return {
        mode: tenancy.mode,
        backendKey: tenancy.backendKey,
        provider: resolved.provider,
        baseUrl: resolved.baseUrl,
        storageBaseUrl: resolved.storageBaseUrl || resolved.baseUrl,
        authStrategy: resolved.authStrategy || 'default'
    };
}

export default {
    resolveBackend
};
