/**
 * SEATOS Client Configuration
 * Customized branding and settings for SEATOS Schools
 */

export const clientConfig = {
    // Client Information
    client: {
        name: "SEATOS SCHOOLS",
        shortName: "SEATOS",
        logo: "assets/clients/seatos/logo.png",
        favicon: "assets/clients/seatos/favicon.png"
    },

    // Branding & Theme
    branding: {
        // Primary Colors - SEATOS Blue Theme
        primaryColor: "#1e88e5",
        primaryHover: "#1565c0",

        // Secondary Colors
        secondaryColor: "#0d47a1",
        accentColor: "#42a5f5",

        // Status Colors
        successColor: "#4caf50",
        warningColor: "#ff9800",
        errorColor: "#f44336",

        // Text Colors
        textColor: "#212121",
        lightText: "#757575",

        // Background Colors
        backgroundColor: "#f5f7fa",
        cardBackground: "#ffffff",
        borderColor: "#e0e0e0",
        innerBackground: "#fafafa",

        // Dark Mode Colors
        darkMode: {
            backgroundColor: "#0a1929",
            cardBackground: "#1e2a38",
            innerBackground: "#132030",
            textColor: "#e3f2fd",
            lightText: "#90caf9",
            borderColor: "#2d3e50",
            primaryColor: "#42a5f5",
            secondaryColor: "#90caf9"
        },

        // Neumorphism Shadows
        neumorphism: {
            light: {
                background: "#f5f7fa",
                shadowLight: "#ffffff",
                shadowDark: "#d1d9e6"
            },
            dark: {
                background: "#1e2a38",
                shadowLight: "#2d3e50",
                shadowDark: "#0a1929"
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
        text: "© 2026 SEATOS Schools - Excellence in Education",
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
