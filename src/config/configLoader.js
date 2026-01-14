/**
 * Configuration Loader
 * Loads and applies client-specific configuration
 */

import { defaultConfig } from './default.js';

class ConfigLoader {
    constructor() {
        this.config = null;
        this.currentClient = null;
    }

    /**
     * Load configuration for a specific client
     * @param {string} clientId - Client identifier (e.g., 'client-a', 'client-b', or 'default')
     * @returns {Promise<Object>} - Loaded configuration
     */
    async loadConfig(clientId = 'default') {
        try {
            if (clientId === 'default') {
                this.config = defaultConfig;
                this.currentClient = 'default';
            } else {
                // Dynamically import client configuration
                const clientModule = await import(`./clients/${clientId}.js`);
                this.config = this.mergeConfigs(defaultConfig, clientModule.clientConfig);
                this.currentClient = clientId;
            }

            console.log(`✅ Configuration loaded for: ${this.config.client.name}`);
            return this.config;
        } catch (error) {
            console.warn(`⚠️ Failed to load config for '${clientId}', falling back to default`, error);
            this.config = defaultConfig;
            this.currentClient = 'default';
            return this.config;
        }
    }

    /**
     * Merge default config with client-specific config
     * Client config takes precedence
     */
    mergeConfigs(defaultCfg, clientCfg) {
        return {
            client: { ...defaultCfg.client, ...clientCfg.client },
            branding: {
                ...defaultCfg.branding,
                ...clientCfg.branding,
                darkMode: {
                    ...defaultCfg.branding.darkMode,
                    ...(clientCfg.branding?.darkMode || {})
                },
                neumorphism: {
                    light: {
                        ...defaultCfg.branding.neumorphism.light,
                        ...(clientCfg.branding?.neumorphism?.light || {})
                    },
                    dark: {
                        ...defaultCfg.branding.neumorphism.dark,
                        ...(clientCfg.branding?.neumorphism?.dark || {})
                    }
                }
            },
            typography: { ...defaultCfg.typography, ...clientCfg.typography },
            features: { ...defaultCfg.features, ...clientCfg.features },
            footer: { ...defaultCfg.footer, ...clientCfg.footer },
            pageTitles: { ...defaultCfg.pageTitles, ...clientCfg.pageTitles }
        };
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return this.config || defaultConfig;
    }

    /**
     * Get specific config value by path
     * @param {string} path - Dot-notation path (e.g., 'branding.primaryColor')
     */
    get(path) {
        const keys = path.split('.');
        let value = this.getConfig();

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return undefined;
            }
        }

        return value;
    }
}

// Create singleton instance
const configLoader = new ConfigLoader();

export default configLoader;
