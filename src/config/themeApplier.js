/**
 * Theme Applier
 * Applies client configuration to the UI dynamically
 */

import configLoader from './configLoader.js';

class ThemeApplier {
    constructor() {
        this.config = null;
    }

    /**
     * Initialize and apply theme
     * @param {string} clientId - Client identifier
     */
    async init(clientId = null) {
        // Get client ID from localStorage, URL parameter, or environment
        const selectedClient = clientId || this.getClientId();

        // Load configuration
        this.config = await configLoader.loadConfig(selectedClient);

        // Apply all theme elements
        this.applyColors();
        this.applyBranding();
        this.applyTypography();
        this.applyPageTitles();
        this.applyFavicon();

        console.log('🎨 Theme applied successfully');
    }

    /**
     * Get client ID from various sources
     */
    getClientId() {
        // 1. Check URL parameter (?client=client-a)
        const urlParams = new URLSearchParams(window.location.search);
        const urlClient = urlParams.get('client');
        if (urlClient) {
            localStorage.setItem('clientId', urlClient);
            return urlClient;
        }

        // 2. Check localStorage
        const storedClient = localStorage.getItem('clientId');
        if (storedClient) {
            return storedClient;
        }

        // 3. Check meta tag
        const metaClient = document.querySelector('meta[name="client-id"]');
        if (metaClient) {
            return metaClient.content;
        }

        // 4. Default
        return 'default';
    }

    /**
     * Apply color scheme to CSS variables
     */
    applyColors() {
        const { branding } = this.config;
        this.injectThemeStyles(branding);
    }

    /**
     * Inject both light and dark mode styles
     */
    injectThemeStyles(branding) {
        let styleEl = document.getElementById('dynamic-theme-colors');

        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'dynamic-theme-colors';
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
      /* Light Mode Colors (Default) */
      :root {
        --primary-color: ${branding.primaryColor};
        --primary-hover: ${branding.primaryHover};
        --secondary-color: ${branding.secondaryColor};
        --accent-color: ${branding.accentColor};
        --success-color: ${branding.successColor};
        --warning-color: ${branding.warningColor};
        --text-color: ${branding.textColor};
        --light-text: ${branding.lightText};
        --background-color: ${branding.backgroundColor};
        --card-bg: ${branding.cardBackground};
        --border-color: ${branding.borderColor};
        --inner-bg: ${branding.innerBackground};
        
        /* Neumorphism Light */
        --neu-bg: ${branding.neumorphism.light.background};
        --neu-shadow-light: ${branding.neumorphism.light.shadowLight};
        --neu-shadow-dark: ${branding.neumorphism.light.shadowDark};
        --neu-shadow-inset-light: inset 5px 5px 10px ${branding.neumorphism.light.shadowDark}, inset -5px -5px 10px ${branding.neumorphism.light.shadowLight};
        --neu-shadow-out: 8px 8px 16px ${branding.neumorphism.light.shadowDark}, -8px -8px 16px ${branding.neumorphism.light.shadowLight};
      }

      /* Dark Mode Colors */
      [data-theme="dark"] {
        --background-color: ${branding.darkMode.backgroundColor};
        --card-bg: ${branding.darkMode.cardBackground};
        --inner-bg: ${branding.darkMode.innerBackground};
        --text-color: ${branding.darkMode.textColor};
        --light-text: ${branding.darkMode.lightText};
        --border-color: ${branding.darkMode.borderColor};
        --primary-color: ${branding.darkMode.primaryColor};
        --secondary-color: ${branding.darkMode.secondaryColor || branding.secondaryColor};
        
        /* Neumorphism Dark */
        --neu-bg: ${branding.neumorphism.dark.background};
        --neu-shadow-light: ${branding.neumorphism.dark.shadowLight};
        --neu-shadow-dark: ${branding.neumorphism.dark.shadowDark};
        --neu-shadow-inset-light: inset 5px 5px 10px ${branding.neumorphism.dark.shadowDark}, inset -5px -5px 10px ${branding.neumorphism.dark.shadowLight};
        --neu-shadow-out: 8px 8px 16px ${branding.neumorphism.dark.shadowDark}, -8px -8px 16px ${branding.neumorphism.dark.shadowLight};
      }
    `;
    }

    /**
     * Resolve asset path based on current page location
     */
    resolveAssetPath(assetPath) {
        if (!assetPath) return '';

        // If it's an absolute URL or data URL, return as-is
        if (assetPath.startsWith('http') || assetPath.startsWith('data:') || assetPath.startsWith('/')) {
            return assetPath;
        }

        // Check if we're in a subfolder (pages/)
        const isInSubfolder = window.location.pathname.includes('/pages/');

        // If in subfolder and path doesn't start with ../, add it
        if (isInSubfolder && !assetPath.startsWith('../')) {
            return '../' + assetPath;
        }

        return assetPath;
    }

    /**
     * Apply branding (logo, app name)
     */
    applyBranding() {
        const { client } = this.config;

        // Update all text elements with app name
        const logoElements = document.querySelectorAll('.logo h1, .logo-text, [data-brand="app-name"]');
        logoElements.forEach(el => {
            el.textContent = client.name;
        });

        // Resolve logo and favicon paths
        const logoPath = this.resolveAssetPath(client.logo);
        const faviconPath = this.resolveAssetPath(client.favicon);

        // Update existing logo images
        const logoImages = document.querySelectorAll('.logo img, [data-brand="logo"]');
        logoImages.forEach(img => {
            img.src = logoPath;
            img.alt = `${client.name} Logo`;
        });

        // Find all logo containers and ensure they have proper layout
        const logoContainers = document.querySelectorAll('.logo');
        logoContainers.forEach(logoContainer => {
            // Add flexbox layout for horizontal alignment
            logoContainer.style.display = 'flex';
            logoContainer.style.alignItems = 'center';
            logoContainer.style.gap = '12px';

            // Check if logo image already exists
            let logoImg = logoContainer.querySelector('img');

            // If no image exists and we have a custom logo, create it
            if (!logoImg && client.logo && client.logo !== 'assets/icon.png') {
                logoImg = document.createElement('img');
                logoImg.className = 'logo-image';
                logoImg.src = logoPath;
                logoImg.alt = `${client.name} Logo`;
                logoImg.style.height = '40px';
                logoImg.style.width = 'auto';
                logoImg.style.objectFit = 'contain';
                logoContainer.insertBefore(logoImg, logoContainer.firstChild);
            }

            // Update existing image if it exists
            if (logoImg && client.logo) {
                logoImg.src = logoPath;
                logoImg.alt = `${client.name} Logo`;
                logoImg.style.height = '40px';
                logoImg.style.width = 'auto';
                logoImg.style.objectFit = 'contain';
            }
        });

        // Update page title
        document.title = client.name;

        // Store resolved favicon path for applyFavicon to use
        this._resolvedFaviconPath = faviconPath;
    }

    /**
     * Apply typography settings
     */
    applyTypography() {
        const root = document.documentElement;
        const { typography } = this.config;

        root.style.setProperty('--font-family', typography.fontFamily);
        root.style.setProperty('--font-size-base', typography.fontSize);
        root.style.setProperty('--border-radius', typography.borderRadius);

        // Load custom fonts if needed
        if (typography.fontFamily.includes('Inter') && !this.isFontLoaded('Inter')) {
            this.loadGoogleFont('Inter:wght@400;500;600;700');
        }
        if (typography.fontFamily.includes('Poppins') && !this.isFontLoaded('Poppins')) {
            this.loadGoogleFont('Poppins:wght@400;500;600;700');
        }
    }

    /**
     * Load Google Font
     */
    loadGoogleFont(fontQuery) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `https://fonts.googleapis.com/css2?family=${fontQuery}&display=swap`;
        document.head.appendChild(link);
    }

    /**
     * Check if font is loaded
     */
    isFontLoaded(fontName) {
        return document.fonts.check(`12px ${fontName}`);
    }

    /**
     * Apply page-specific titles
     */
    applyPageTitles() {
        const { pageTitles } = this.config;

        // Update auth header if on login page
        const authHeader = document.querySelector('.auth-header h2');
        if (authHeader && window.location.pathname.includes('index.html') || window.location.pathname === '/') {
            authHeader.textContent = pageTitles.login;
        }
        if (authHeader && window.location.pathname.includes('register.html')) {
            authHeader.textContent = pageTitles.register;
        }

        // Update dashboard titles
        const dashboardTitle = document.querySelector('.dashboard-header h1, [data-brand="page-title"]');
        if (dashboardTitle) {
            if (window.location.pathname.includes('student-dashboard')) {
                dashboardTitle.textContent = pageTitles.studentDashboard;
            } else if (window.location.pathname.includes('teacher-dashboard')) {
                dashboardTitle.textContent = pageTitles.teacherDashboard;
            }
        }
    }

    /**
     * Apply favicon
     */
    applyFavicon() {
        // Use the resolved path from applyBranding, or resolve it here
        const faviconPath = this._resolvedFaviconPath || this.resolveAssetPath(this.config.client.favicon);

        let favicon = document.querySelector('link[rel="icon"]');
        if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
        }

        favicon.href = faviconPath;
    }

    /**
     * Apply footer text
     */
    applyFooter() {
        const { footer } = this.config;
        const footerEl = document.querySelector('.main-footer p');

        if (footerEl) {
            footerEl.textContent = footer.text;
        }
    }

    /**
     * Get current config
     */
    getConfig() {
        return this.config || configLoader.getConfig();
    }

    /**
     * Check if feature is enabled
     */
    isFeatureEnabled(featureName) {
        return this.config?.features?.[featureName] ?? true;
    }
}

// Create singleton instance
const themeApplier = new ThemeApplier();

export default themeApplier;
