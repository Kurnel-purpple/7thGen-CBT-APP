import { initConfig } from '../../config/index.js';
import { ensureModuleEnabled } from './moduleGuards.js';
import { renderModuleNavItems } from '../ui/sidebarBuilder.js';
import moduleLoader from './moduleLoader.js';
import { getBuiltinModuleManifests } from './builtinManifests.js';

export function loadScript(src, { type = 'classic' } = {}) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        if (type === 'module') {
            script.type = 'module';
        }
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.body.appendChild(script);
    });
}

export async function loadScripts(sources = [], options = {}) {
    for (const src of sources) {
        await loadScript(src, options);
    }
}

/**
 * Replace the module set with the tenant's paid-for modules, if we can
 * resolve them. Falls back silently to the static client config when:
 *   - the user isn't logged in
 *   - the user has no school_version
 *   - the tenant record doesn't exist yet
 *   - the tenants collection isn't on the server (older deploys)
 *
 * Super-admins bypass tenant gating and always see every known module.
 */
async function applyTenantOverride() {
    const ds = window.dataService;
    if (!ds || typeof ds.getCurrentUser !== 'function') return;

    const user = ds.getCurrentUser();
    if (!user) return;

    if (user.role === 'super_admin') {
        const everything = getBuiltinModuleManifests().map((m) => m.id);
        moduleLoader.setEnabledModules(everything);
        return;
    }

    const schoolVersion = user.schoolVersion;
    if (!schoolVersion || !ds.pb) return;

    try {
        const filter = ds.pb.filter('school_version = {:sv}', { sv: schoolVersion });
        const record = await ds.pb.collection('tenants').getFirstListItem(filter);
        const status = String(record?.status || '').toLowerCase();

        // Hard revoke when explicitly suspended; trial/active/expired keep
        // soft access (so admins can still see warnings instead of being
        // silently locked out by a stale plan_expires_at).
        if (status === 'suspended') {
            moduleLoader.setEnabledModules([]);
            return;
        }

        const modules = Array.isArray(record?.modules_enabled)
            ? record.modules_enabled.filter(Boolean).map(String)
            : [];
        moduleLoader.setEnabledModules(modules);
    } catch (error) {
        const status = error?.status ?? error?.statusCode;
        const msg = String(error?.message || '').toLowerCase();
        if (status === 404 || msg.includes('not found')) return;
        // Don't crash module pages just because the tenant lookup hiccupped.
        console.warn('[pageBootstrap] tenant override failed; using static config:', error?.message || error);
    }
}

export async function bootstrapModulePage({
    moduleId,
    moduleName,
    title,
    message,
    currentModuleId = null,
    renderNav = false,
    role = null,
    globalScripts = [],
    moduleScripts = [],
    moduleModuleScripts = []
} = {}) {
    await initConfig();

    // Load the platform scripts (dataService, auth, utils, academicEntities)
    // BEFORE we gate the module — we need dataService to resolve the tenant.
    await loadScripts(globalScripts);

    // Tenant override: replace the static modules.enabled list with what
    // the tenant has actually paid for.
    await applyTenantOverride();

    if (!ensureModuleEnabled(moduleId, {
        moduleName,
        title,
        message
    })) {
        return false;
    }

    if (renderNav) {
        // Auto-detect role from cached user meta if not explicitly provided
        let navRole = role;
        if (!navRole) {
            try {
                navRole = JSON.parse(localStorage.getItem('cbt_user_meta') || '{}').role || null;
            } catch (e) { /* ignore parse errors */ }
        }
        const navContainer = document.getElementById('module-nav-items');
        const navDivider = document.getElementById('module-nav-divider');
        if (navContainer) {
            const hasItems = renderModuleNavItems(navContainer, { currentModuleId, role: navRole });
            if (navDivider) {
                navDivider.style.display = hasItems ? '' : 'none';
            }
        }
    }

    await loadScripts(moduleScripts);
    await loadScripts(moduleModuleScripts, { type: 'module' });

    return true;
}

export default {
    bootstrapModulePage,
    loadScript,
    loadScripts
};
