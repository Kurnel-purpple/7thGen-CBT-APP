/**
 * Configuration System Initialization
 * Import this at the top of your main app files
 */

import themeApplier from './themeApplier.js';
import configLoader from './configLoader.js';
import { normalizeClientRuntime } from '../core/config/clientRuntime.js';
import { resolveBackend } from '../core/api/backendResolver.js';
import moduleLoader from '../core/modules/moduleLoader.js';
import { getBuiltinModuleManifests } from '../core/modules/builtinManifests.js';

/**
 * Initialize the configuration system
 * Call this as early as possible in your app
 */
export async function initConfig(clientId = null) {
    try {
        const selectedClient = clientId || themeApplier.getClientId();
        await themeApplier.init(selectedClient);

        const config = themeApplier.getConfig();
        const runtime = normalizeClientRuntime(config, { clientId: selectedClient });
        const backendConfig = resolveBackend(runtime);

        moduleLoader.loadEnabledModules({
            runtimeConfig: runtime,
            manifests: getBuiltinModuleManifests()
        });

        window.configLoader = configLoader;
        window.__clientRuntime = runtime;
        window.__backendConfig = backendConfig;
        window.__moduleLoader = moduleLoader;

        return config;
    } catch (error) {
        console.error('Failed to initialize configuration:', error);
        return null;
    }
}

/**
 * Get current configuration
 */
export function getConfig() {
    return themeApplier.getConfig();
}

export function getClientRuntime() {
    return window.__clientRuntime || null;
}

export function getBackendConfig() {
    return window.__backendConfig || null;
}

export function getEnabledModules() {
    return window.__moduleLoader?.getEnabledModules() || [];
}

export function getModuleManifest(moduleId) {
    return window.__moduleLoader?.getModuleManifest(moduleId) || null;
}

export function getModuleService(moduleId) {
    return window.__moduleLoader?.getModuleService(moduleId) || null;
}

export function getModuleSnapshot() {
    return window.__moduleLoader?.getModuleSnapshot() || null;
}

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(featureName) {
    return themeApplier.isFeatureEnabled(featureName);
}

export function isModuleEnabled(moduleId) {
    return !!window.__moduleLoader?.isModuleEnabled(moduleId);
}

/**
 * Set client ID and reload theme
 */
export async function setClient(clientId) {
    localStorage.setItem('clientId', clientId);
    await themeApplier.init(clientId);
    window.location.reload();
}

// Auto-initialize on import
initConfig();
