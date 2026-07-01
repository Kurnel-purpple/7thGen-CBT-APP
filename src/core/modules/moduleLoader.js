function cloneArray(value) {
    return Array.isArray(value) ? [...value] : [];
}

export class ModuleLoader {
    constructor() {
        this.manifests = new Map();
        this.enabledModules = new Set();
        this.services = new Map();
        this.routes = [];
        this.navItems = [];
        this.permissions = new Set();
        this.runtimeConfig = null;
    }

    loadEnabledModules({ runtimeConfig, manifests = [] } = {}) {
        this.runtimeConfig = runtimeConfig || this.runtimeConfig;
        this.enabledModules = new Set(runtimeConfig?.modules?.enabled || []);
        this.manifests.clear();
        this.services.clear();
        this.routes = [];
        this.navItems = [];
        this.permissions = new Set();

        manifests.forEach((manifest) => {
            this.registerManifest(manifest);
        });

        return this.getEnabledModules();
    }

    registerManifest(manifest) {
        this.validateManifest(manifest);
        this.manifests.set(manifest.id, manifest);

        if (!this.isModuleEnabled(manifest.id)) {
            return manifest;
        }

        cloneArray(manifest.permissions).forEach((permission) => {
            this.permissions.add(permission);
        });

        cloneArray(manifest.routes).forEach((route) => {
            this.routes.push({
                moduleId: manifest.id,
                ...route
            });
        });

        cloneArray(manifest.nav).forEach((navItem) => {
            this.navItems.push({
                moduleId: manifest.id,
                ...navItem
            });
        });

        if (manifest.service) {
            this.services.set(manifest.id, manifest.service);
        }

        return manifest;
    }

    validateManifest(manifest) {
        if (!manifest || typeof manifest !== 'object') {
            throw new Error('Module manifest must be an object.');
        }
        if (!manifest.id) {
            throw new Error('Module manifest must define an id.');
        }
    }

    isModuleEnabled(moduleId) {
        return this.enabledModules.has(moduleId);
    }

    getEnabledModules() {
        return [...this.enabledModules];
    }

    /**
     * Replace the active enabled-modules set at runtime, then rebuild
     * routes / nav / permissions from the manifests already registered.
     * Used by pageBootstrap to apply the tenant's paid-for module list
     * after the static client config has loaded.
     */
    setEnabledModules(moduleIds) {
        const ids = Array.isArray(moduleIds) ? moduleIds.filter(Boolean).map(String) : [];
        this.enabledModules = new Set(ids);
        this.routes = [];
        this.navItems = [];
        this.permissions = new Set();
        this.services = new Map();

        this.manifests.forEach((manifest) => {
            if (!this.isModuleEnabled(manifest.id)) return;

            cloneArray(manifest.permissions).forEach((permission) => {
                this.permissions.add(permission);
            });
            cloneArray(manifest.routes).forEach((route) => {
                this.routes.push({ moduleId: manifest.id, ...route });
            });
            cloneArray(manifest.nav).forEach((navItem) => {
                this.navItems.push({ moduleId: manifest.id, ...navItem });
            });
            if (manifest.service) {
                this.services.set(manifest.id, manifest.service);
            }
        });

        return this.getEnabledModules();
    }

    getModuleManifest(moduleId) {
        return this.manifests.get(moduleId) || null;
    }

    registerModuleService(moduleId, service) {
        if (!moduleId) {
            throw new Error('moduleId is required.');
        }
        this.services.set(moduleId, service);
        return service;
    }

    getModuleService(moduleId) {
        return this.services.get(moduleId) || null;
    }

    getRoutes() {
        return [...this.routes];
    }

    getNavItems({ role = null, canAccess = null } = {}) {
        return this.navItems.filter((item) => {
            if (role && Array.isArray(item.roles) && item.roles.length > 0 && !item.roles.includes(role)) {
                return false;
            }
            if (typeof canAccess === 'function' && Array.isArray(item.permissions) && item.permissions.length > 0) {
                return item.permissions.every((permission) => canAccess(permission));
            }
            return true;
        });
    }

    getPermissions() {
        return [...this.permissions];
    }

    getModuleSnapshot() {
        return {
            enabledModules: this.getEnabledModules(),
            manifests: [...this.manifests.values()].map((manifest) => ({
                id: manifest.id,
                name: manifest.name,
                enabled: this.isModuleEnabled(manifest.id),
                routeCount: cloneArray(manifest.routes).length,
                navCount: cloneArray(manifest.nav).length,
                permissionCount: cloneArray(manifest.permissions).length,
                hasService: !!manifest.service
            })),
            registeredRoutes: this.getRoutes(),
            registeredNav: [...this.navItems],
            registeredPermissions: this.getPermissions()
        };
    }
}

const moduleLoader = new ModuleLoader();

export default moduleLoader;
