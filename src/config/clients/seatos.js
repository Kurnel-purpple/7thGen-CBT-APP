/**
 * SEATOS Client Configuration
 * Customized branding and settings for SEATOS Schools
 */

export const clientConfig = {
    // Client Information
    client: {
        name: "SEATOS SCHOOLS",
        shortName: "SEATOS",
        logo: "assets/clients/seatos/drop.png",
        favicon: "assets/clients/seatos/favicon.png"
    },

    // Branding & Theme
    branding: {
        // Primary Colors - SEATOS Navy & Skyblue Theme
        primaryColor: "#4a90c8",        // Darker skyblue - primary actions (sign in button)
        primaryHover: "#3a7ab0",        // Even darker skyblue on hover

        // Secondary Colors
        secondaryColor: "#001524",      // Dark navy - headers, important text
        accentColor: "#dc143c",         // Crimson red - accents, alerts

        // Status Colors
        successColor: "#4caf50",        // Green
        warningColor: "#ff9800",        // Orange
        errorColor: "#dc143c",          // Red (matching accent)

        // Text Colors
        textColor: "#001524",           // Dark navy for main text
        lightText: "#445566",           // Muted navy for secondary text

        // Background Colors
        backgroundColor: "#faf8f5",     // Very light cream - main background (subtle)
        cardBackground: "#ffffff",      // White cards for contrast
        borderColor: "#e8e4df",         // Light warm gray for borders
        innerBackground: "#f5f2ed",     // Slightly darker cream for inner areas

        // Dark Mode Colors
        darkMode: {
            backgroundColor: "#0a0a0a",     // Very dark gray - main background (subtle, not pure black)
            cardBackground: "#0f1419",      // Slightly lighter dark - cards (subtle contrast)
            innerBackground: "#141a20",     // Even lighter dark for inner areas
            textColor: "#e8dcc8",           // Soft wheat - main text (easier on eyes)
            lightText: "#a89b87",           // Muted wheat for secondary text
            borderColor: "#1f2830",         // Subtle dark border
            primaryColor: "#4a90c8",        // Darker skyblue - keep consistent with light mode
            secondaryColor: "#e8dcc8"       // Soft wheat for secondary elements
        },

        // Neumorphism Shadows
        neumorphism: {
            light: {
                background: "#faf8f5",      // Cream background
                shadowLight: "#ffffff",     // White highlight
                shadowDark: "#e8e4df"       // Light warm gray shadow
            },
            dark: {
                background: "#0f1419",      // Card background
                shadowLight: "#1a2128",     // Slightly lighter shadow
                shadowDark: "#050608"       // Very dark shadow
            }
        }
    },

    // Typography
    typography: {
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        fontSize: "16px",
        borderRadius: "25px"
    },

    // Features
    features: {
        offlineMode: true,
        darkModeToggle: true,
        timeExtensions: true,
        bulkImport: true,
        richQuestions: true
    },

    // Footer Information
    footer: {
        text: "© 2026 corneliusajayi123@gmail.com",
        showYear: true
    },

    // Page Titles
    pageTitles: {
        login: "SEATOS - Sign In",
        register: "SEATOS - Register",
        studentDashboard: "SEATOS Student Portal",
        teacherDashboard: "SEATOS Teacher Portal",
        exam: "SEATOS Exam"
    }
};
