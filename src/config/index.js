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

        // Brand the logged-out screens. Fire-and-forget: the page renders with
        // the config file's branding and repaints if the school's own comes
        // back, which is the same shape as the cached-then-authoritative pass
        // used after login.
        applyPublicBrand(backendConfig?.baseUrl);

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
 * Brand the login and registration screens from the hostname alone.
 *
 * Everywhere inside the app, a school's branding comes from app_settings —
 * which needs an authenticated caller and a school context. Logged-out screens
 * have neither, so a student arriving at their school's domain to register saw
 * the generic branding and no confirmation they were in the right place.
 *
 * /api/cbt/brand resolves hostname -> name/logo/colours without auth (see
 * pb_hooks/public_brand.pb.js, which returns only those fields — never the
 * tenant's plan, status or contact details).
 *
 * Deliberately best-effort and never awaited by callers: branding is cosmetic,
 * and the login form must not wait on it or break when it fails. Skipped once a
 * session exists, because refreshSchoolTheme() is then the better source.
 */
export async function applyPublicBrand(baseUrl) {
    try {
        if (!baseUrl || typeof fetch !== 'function') return false;

        // Already signed in — the authenticated path has the full theme.
        if (window.dataService?.getCurrentUser?.()) return false;

        const host = window.location.hostname;
        // Nothing to resolve on a dev host; skip the round trip entirely.
        if (!host || host === 'localhost' || host === '127.0.0.1') return false;

        const res = await fetch(
            `${String(baseUrl).replace(/\/$/, '')}/api/cbt/brand?host=${encodeURIComponent(host)}`,
            { headers: { Accept: 'application/json' } }
        );
        if (!res.ok) return false;

        const brand = await res.json();
        if (!brand || !brand.found) return false;

        const theme = {
            schoolName: brand.name || '',
            // The hook returns a path so it stays host-agnostic; make it absolute.
            logoUrl: brand.logoUrl
                ? `${String(baseUrl).replace(/\/$/, '')}${brand.logoUrl}`
                : '',
            primaryColor: brand.primaryColor || '',
            secondaryColor: brand.secondaryColor || '',
            accentColor: brand.accentColor || ''
        };

        if (window.schoolTheme?.isEmpty(theme)) return false;

        // Cache it so the next visit paints before first contact with the API.
        window.schoolTheme?.setCached(theme);

        if (!themeApplier.mergeSchoolTheme(theme)) return false;
        themeApplier.applyColors();
        themeApplier.applyBranding();
        themeApplier.applyFavicon();
        window.__appConfig = themeApplier.getConfig();
        return true;
    } catch (error) {
        console.warn('applyPublicBrand failed:', error?.message || error);
        return false;
    }
}

/**
 * Pull the school's saved branding from app_settings and repaint.
 *
 * Separate from initConfig because it needs an authenticated caller with a
 * school context — initConfig runs before anyone has logged in. Safe to call
 * more than once; it no-ops when the school has no saved theme.
 */
export async function refreshSchoolTheme(dataService) {
    const ds = dataService || window.dataService;
    if (!ds) return false;
    try {
        return await themeApplier.refreshSchoolTheme(ds);
    } catch (error) {
        // Branding is cosmetic — never let it break a page load.
        console.warn('refreshSchoolTheme failed:', error?.message || error);
        return false;
    }
}

export function resetSchoolTheme() {
    themeApplier.resetSchoolTheme();
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
