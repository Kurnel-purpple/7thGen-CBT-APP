/**
 * Theme Applier
 * Applies client configuration to the UI dynamically
 */

import configLoader from './configLoader.js';
// Side-effect import: defines window.schoolTheme. Imported rather than relied on
// from a page's script tags so the contrast helpers below are available even on
// pages that don't load it themselves (login, register).
import '../core/shared/schoolTheme.js';

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

        // Keep an untouched copy of the file's branding. A school's saved theme
        // is merged OVER this, never into the already-merged result, so clearing
        // one colour in the form restores the config's value instead of leaving
        // the previous override behind.
        this._baseBranding = JSON.parse(JSON.stringify(this.config.branding || {}));
        this._baseClient = JSON.parse(JSON.stringify(this.config.client || {}));

        // Apply the last known school theme synchronously, before first paint.
        // The authoritative copy comes from app_settings, but that read needs
        // auth and a school context, neither of which exists yet.
        this.applyCachedSchoolTheme();

        // Apply all theme elements
        this.applyColors();
        this.applyBranding();
        this.applyTypography();
        this.applyPageTitles();
        this.applyFavicon();

        console.log('🎨 Theme applied successfully');
        window.__appConfig = this.config;
    }

    /**
     * Merge a school's saved theme over the config file's branding.
     * Always merges over `_baseBranding`, never over the live config — see init().
     */
    mergeSchoolTheme(theme) {
        const st = (typeof window !== 'undefined') && window.schoolTheme;
        if (!st || !theme || st.isEmpty(theme)) return false;

        this.config.branding = st.deriveBranding(theme, this._baseBranding);

        const client = Object.assign({}, this._baseClient);
        if (theme.schoolName) {
            client.name = theme.schoolName;
            client.shortName = theme.schoolName;
        }
        if (theme.logoUrl) {
            client.logo = theme.logoUrl;
        }
        this.config.client = client;
        return true;
    }

    /**
     * Pre-paint pass. Silently does nothing when schoolTheme.js isn't loaded on
     * this page or nothing is cached yet — the config file's branding stands.
     */
    applyCachedSchoolTheme() {
        const st = (typeof window !== 'undefined') && window.schoolTheme;
        if (!st) return false;
        return this.mergeSchoolTheme(st.getCached());
    }

    /**
     * Authoritative pass, once the user is signed in and a school is known.
     * Call after login and after the branding form saves. Repaints only when a
     * theme actually came back, so a school with no saved theme costs one read.
     */
    async refreshSchoolTheme(dataService) {
        const st = (typeof window !== 'undefined') && window.schoolTheme;
        if (!st || !this.config) return false;

        const theme = await st.load(dataService);
        if (!theme) return false;
        if (!this.mergeSchoolTheme(theme)) return false;

        this.applyColors();
        this.applyBranding();
        this.applyFavicon();
        window.__appConfig = this.config;
        return true;
    }

    /**
     * Drop a saved theme and repaint from the config file alone. Used by the
     * "Reset to default" action in the branding form.
     */
    resetSchoolTheme() {
        const st = (typeof window !== 'undefined') && window.schoolTheme;
        if (st) st.clearCached();
        if (!this.config || !this._baseBranding) return;

        this.config.branding = JSON.parse(JSON.stringify(this._baseBranding));
        this.config.client = JSON.parse(JSON.stringify(this._baseClient));
        this.applyColors();
        this.applyBranding();
        this.applyFavicon();
        window.__appConfig = this.config;
    }

    /**
     * Domain-to-client mapping for automatic detection
     */
    domainClientMap = {
        'seatoscbt.com': 'seatos',
        'www.seatoscbt.com': 'seatos',
        'seatos-cbt-app.netlify.app': 'seatos',
        // Add more domain mappings here as needed
    };

    /**
     * Get client ID from various sources
     * Priority: 1. Domain, 2. URL param, 3. Meta tag (client builds), 4. localStorage, 5. Default
     *
     * The meta tag must beat localStorage: client builds (Electron/APK) bake their
     * identity into the meta tag at release time, and a stale clientId left in
     * localStorage by a previously-run default build would otherwise override it
     * forever (Electron app data survives uninstall/reinstall).
     */
    getClientId() {
        console.log('🔍 Detecting client ID...');

        // 1. Check domain mapping (HIGHEST PRIORITY)
        const hostname = window.location.hostname.toLowerCase();
        const domainClient = this.domainClientMap[hostname];
        if (domainClient) {
            console.log(`✅ Client ID from domain (${hostname}): ${domainClient}`);
            localStorage.setItem('clientId', domainClient); // Update localStorage to match
            return domainClient;
        }

        // 2. Check URL parameter (?client=client-a)
        const urlParams = new URLSearchParams(window.location.search);
        const urlClient = urlParams.get('client');
        if (urlClient) {
            console.log(`✅ Client ID from URL: ${urlClient}`);
            localStorage.setItem('clientId', urlClient);
            return urlClient;
        }

        // 3. Check meta tag — authoritative for client builds. A 'default' meta
        // falls through so localStorage (e.g. client-switcher) still works there.
        const metaClient = document.querySelector('meta[name="client-id"]');
        const metaClientId = metaClient ? metaClient.content.trim() : '';
        if (metaClientId && metaClientId !== 'default') {
            console.log(`✅ Client ID from meta tag: ${metaClientId}`);
            localStorage.setItem('clientId', metaClientId); // Update localStorage to match
            return metaClientId;
        }

        // 4. Check localStorage
        const storedClient = localStorage.getItem('clientId');
        if (storedClient) {
            console.log(`✅ Client ID from localStorage: ${storedClient}`);
            return storedClient;
        }

        // 5. Default (also the meta tag's value when it says 'default')
        if (metaClientId === 'default') {
            console.log('✅ Client ID from meta tag: default');
            return 'default';
        }
        console.log('⚠️ No client ID found, using default');
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
     * The sidebar's background for each mode.
     *
     * --sidebar-bg used to be hardcoded in main.css (#1A56C4 light, #111827 dark),
     * so the sidebar never followed the theme — not for a school's saved branding
     * and not for the client configs either. It now derives from the palette:
     *
     *   light -> primaryColor     (the brand colour, as a full-height panel)
     *   dark  -> secondaryColor   (the BASE one, e.g. #2c3e50 / #001524)
     *
     * Dark mode deliberately does NOT use darkMode.secondaryColor: that value is
     * near-white (#ecf0f1, #e8dcc8) because it colours text on dark surfaces, and
     * using it here would paint a white sidebar under white nav labels.
     *
     * Both are passed through the same white-text contrast clamp the branding form
     * uses, because the sidebar renders white labels and icons on this colour. A
     * palette that already passes is returned untouched.
     */
    sidebarColors(branding) {
        const st = (typeof window !== 'undefined') && window.schoolTheme;
        const clamp = (hex, fallback) => {
            if (!hex) return fallback;
            if (!st || !st.colors) return hex;
            // 4.6:1 rather than 4.5 — the sidebar also carries semi-transparent
            // white labels (rgba(255,255,255,.75)) for inactive items, so a hair
            // of extra headroom keeps those legible too.
            return st.colors.clampForWhiteText(hex, 4.6);
        };

        return {
            light: clamp(branding.primaryColor, '#1A56C4'),
            dark: clamp(branding.secondaryColor, '#111827')
        };
    }

    /**
     * The CLAUDE.md token names, derived from the same palette.
     *
     * main.css carries two parallel systems: the legacy one (--primary-color,
     * --text-color, --background-color, --border-color) and the newer one from
     * the design guidelines (--primary, --text-primary, --bg, --border). Only the
     * legacy names were ever injected here, so anything written against the newer
     * names — the fees and feed modules, and every module written after them —
     * stayed pinned to main.css's static values and never followed the theme.
     *
     * Emitting both keeps the old markup working and fixes the new modules.
     *
     * Note --accent is NOT branding.accentColor: in the guidelines it is the white
     * card/content surface (#FFFFFF light, #1A1D27 dark). accentColor keeps its own
     * legacy name, --accent-color.
     */
    modernTokens(branding) {
        const st = (typeof window !== 'undefined') && window.schoolTheme;
        const c = st && st.colors;
        const primary = branding.primaryColor;
        const dmPrimary = branding.darkMode?.primaryColor || primary;

        const rgba = (hex, alpha) => {
            const parsed = c && c.hexToRgb(hex);
            if (!parsed) return `rgba(26,115,232,${alpha})`;
            return `rgba(${parsed.r},${parsed.g},${parsed.b},${alpha})`;
        };

        return {
            light: {
                primary,
                primaryDark: branding.primaryHover,
                // Soft tint behind hovers and selected rows (#E8F0FE for #1A73E8).
                primaryLight: c ? c.lighten(primary, 0.90) : '#E8F0FE',
                shadowHover: `0 6px 20px ${rgba(primary, 0.18)}`
            },
            dark: {
                primary: dmPrimary,
                primaryDark: primary,
                // Muted blue tint for dark hovers (#1E2D4A-ish), never the light one.
                primaryLight: c ? c.darken(dmPrimary, 0.68) : '#1E2D4A',
                // One step brighter than surface-2 — the hover/selected layer.
                surface3: c ? c.lighten(branding.darkMode?.innerBackground || '#22263A', 0.045) : '#2C3150',
                shadowHover: `0 6px 24px ${rgba(dmPrimary, 0.2)}`
            }
        };
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

        const sidebar = this.sidebarColors(branding);
        const modern = this.modernTokens(branding);

        styleEl.textContent = `
      /* Light Mode Colors (Default) */
      :root {
        --sidebar-bg: ${sidebar.light};

        /* Design-guideline token names — see modernTokens() */
        --primary: ${modern.light.primary};
        --primary-dark: ${modern.light.primaryDark};
        --primary-light: ${modern.light.primaryLight};
        --text-primary: ${branding.textColor};
        --text-secondary: ${branding.lightText};
        --bg: ${branding.backgroundColor};
        --border: ${branding.borderColor};
        --accent: ${branding.cardBackground};
        --shadow-hover: ${modern.light.shadowHover};

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
        --sidebar-bg: ${sidebar.dark};

        /* Design-guideline token names — see modernTokens() */
        --primary: ${modern.dark.primary};
        --primary-dark: ${modern.dark.primaryDark};
        --primary-light: ${modern.dark.primaryLight};
        --text-primary: ${branding.darkMode.textColor};
        --text-secondary: ${branding.darkMode.lightText};
        --bg: ${branding.darkMode.backgroundColor};
        --border: ${branding.darkMode.borderColor};
        --accent: ${branding.darkMode.cardBackground};
        --dm-surface: ${branding.darkMode.cardBackground};
        --dm-surface-2: ${branding.darkMode.innerBackground};
        --dm-surface-3: ${modern.dark.surface3};
        --shadow-hover: ${modern.dark.shadowHover};

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

        // Update app name elements (but NOT user-name which is the h1 in dashboards)
        const logoElements = document.querySelectorAll('.logo-text, [data-brand="app-name"], .sidebar-brand-text, .auth-brand');
        logoElements.forEach(el => {
            el.textContent = client.name;
        });

        // Update subtitle elements specifically (for new header design)
        const subtitleElements = document.querySelectorAll('#app-subtitle .desktop-text, #app-subtitle');
        subtitleElements.forEach(el => {
            // Only update if it doesn't have children (is a text node container)
            if (el.children.length === 0 || el.id === 'app-subtitle') {
                const textNode = el.querySelector('.desktop-text') || el;
                if (textNode && !textNode.querySelector('.desktop-text')) {
                    textNode.textContent = client.name;
                }
            }
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

        // Inject logo into sidebar brand area if it exists
        const sidebarBrands = document.querySelectorAll('.sidebar-brand');
        sidebarBrands.forEach(brand => {
            let logoImg = brand.querySelector('img.sidebar-brand-logo');
            if (!logoImg && client.logo) {
                logoImg = document.createElement('img');
                logoImg.className = 'sidebar-brand-logo';
                logoImg.src = logoPath;
                logoImg.alt = `${client.name} Logo`;
                // Insert before the text container
                const textContainer = brand.querySelector('div');
                if (textContainer) {
                    textContainer.insertBefore(logoImg, textContainer.firstChild);
                }
            } else if (logoImg) {
                logoImg.src = logoPath;
                logoImg.alt = `${client.name} Logo`;
            }
        });

        // Inject logo into auth brand area if it exists
        const authBrands = document.querySelectorAll('.auth-brand');
        authBrands.forEach(brand => {
            let logoImg = brand.querySelector('img.auth-brand-logo');
            if (!logoImg && client.logo) {
                logoImg = document.createElement('img');
                logoImg.className = 'auth-brand-logo';
                logoImg.src = logoPath;
                logoImg.alt = `${client.name} Logo`;
                logoImg.style.height = '28px';
                logoImg.style.width = 'auto';
                logoImg.style.objectFit = 'contain';
                logoImg.style.marginRight = '8px';
                logoImg.style.verticalAlign = 'middle';
                brand.insertBefore(logoImg, brand.firstChild);
            } else if (logoImg) {
                logoImg.src = logoPath;
                logoImg.alt = `${client.name} Logo`;
            }
        });

        // Find all logo containers and add logo image if needed
        const logoContainers = document.querySelectorAll('.logo');
        logoContainers.forEach(logoContainer => {
            // Don't override inline styles - CSS handles layout now

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

        // --font-heading had the same problem --primary did: main.css pinned it to
        // a literal and nothing ever overrode it, so the fees and feed modules —
        // the only ones that use it — ignored the client's typography entirely.
        // Falls back to fontFamily when a config doesn't name a heading face.
        root.style.setProperty('--font-heading', typography.headingFontFamily || typography.fontFamily);

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
