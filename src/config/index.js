/**
 * Configuration System Initialization
 * Import this at the top of your main app files
 */

import themeApplier from './themeApplier.js';

/**
 * Initialize the configuration system
 * Call this as early as possible in your app
 */
export async function initConfig(clientId = null) {
    try {
        await themeApplier.init(clientId);
        return themeApplier.getConfig();
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

/**
 * Check if a feature is enabled
 */
export function isFeatureEnabled(featureName) {
    return themeApplier.isFeatureEnabled(featureName);
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
