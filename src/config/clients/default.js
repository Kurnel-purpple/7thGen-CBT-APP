/**
 * Default Client Configuration
 * Generic branding and settings for the CBT Exam Software
 */

export const clientConfig = {
    // Client Information
    client: {
        name: "CBT Exam Software",
        shortName: "Gen7 CBT",
        logo: null, // No custom logo
        favicon: null // No custom favicon
    },

    // Branding & Theme
    branding: {
        // Primary Colors - Professional Blue Theme
        primaryColor: "#2563eb",        // Blue - primary actions
        primaryHover: "#1d4ed8",        // Darker blue on hover

        // Secondary Colors
        secondaryColor: "#1e293b",      // Dark slate - headers, important text
        accentColor: "#dc2626",         // Red - accents, alerts

        // Status Colors
        successColor: "#16a34a",        // Green
        warningColor: "#ea580c",        // Orange
        errorColor: "#dc2626",          // Red

        // Text Colors
        textColor: "#1e293b",           // Dark slate for main text
        lightText: "#64748b",           // Slate for secondary text

        // Background Colors
        backgroundColor: "#f8fafc",     // Very light slate - main background
        cardBackground: "#ffffff",      // White cards
        borderColor: "#e2e8f0",         // Light slate for borders
        innerBackground: "#f1f5f9",     // Slightly darker slate for inner areas

        // Dark Mode Colors
        darkMode: {
            backgroundColor: "#0f172a",     // Very dark slate
            cardBackground: "#1e293b",      // Dark slate - cards
            innerBackground: "#334155",     // Lighter slate for inner areas
            textColor: "#f1f5f9",           // Light slate - main text
            lightText: "#94a3b8",           // Muted slate for secondary text
            borderColor: "#334155",         // Subtle dark border
            primaryColor: "#3b82f6",        // Bright blue
            secondaryColor: "#f1f5f9"       // Light slate for secondary elements
        },

        // Neumorphism Shadows
        neumorphism: {
            light: {
                background: "#f8fafc",
                shadowLight: "#ffffff",
                shadowDark: "#e2e8f0"
            },
            dark: {
                background: "#1e293b",
                shadowLight: "#334155",
                shadowDark: "#0f172a"
            }
        }
    },

    // Typography
    typography: {
        fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
        fontSize: "16px",
        borderRadius: "12px"
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
        text: "© 2026 Gen7 CBT Exam Software",
        showYear: true
    },

    // Page Titles
    pageTitles: {
        login: "CBT - Sign In",
        register: "CBT - Register",
        studentDashboard: "Student Portal",
        teacherDashboard: "Teacher Portal",
        exam: "Exam"
    }
};
