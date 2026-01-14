/**
 * Default Configuration
 * This is the base configuration for the CBT Exam App
 */

export const defaultConfig = {
    // Client Information
    client: {
        name: "CBT Exam Core",
        shortName: "CBT Core",
        logo: "assets/icon.png", // Path to logo image
        favicon: "assets/icon.png"
    },

    // Branding & Theme
    branding: {
        // Primary Colors
        primaryColor: "#4a90e2",
        primaryHover: "#357abd",

        // Secondary Colors
        secondaryColor: "#2c3e50",
        accentColor: "#e74c3c",

        // Status Colors
        successColor: "#2ecc71",
        warningColor: "#f1c40f",
        errorColor: "#e74c3c",

        // Text Colors
        textColor: "#333333",
        lightText: "#7f8c8d",

        // Background Colors
        backgroundColor: "#f5f7fa",
        cardBackground: "#ffffff",
        borderColor: "#e0e0e0",
        innerBackground: "#fafafa",

        // Dark Mode Colors (optional overrides)
        darkMode: {
            backgroundColor: "#1a1a1a",
            cardBackground: "#2d2d2d",
            innerBackground: "#222222",
            textColor: "#e0e0e0",
            lightText: "#a0a0a0",
            borderColor: "#404040",
            primaryColor: "#5d9cec",
            secondaryColor: "#ecf0f1"
        },

        // Neumorphism Shadows
        neumorphism: {
            light: {
                background: "#f5f7fa",
                shadowLight: "#ffffff",
                shadowDark: "#d1d9e6"
            },
            dark: {
                background: "#2d2d2d",
                shadowLight: "#3d3d3d",
                shadowDark: "#1e1e1e"
            }
        }
    },

    // Typography
    typography: {
        fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        fontSize: "16px",
        borderRadius: "25px"
    },

    // Features (can be toggled per client)
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
        login: "Welcome Back",
        register: "Create Account",
        studentDashboard: "Student Dashboard",
        teacherDashboard: "Teacher Dashboard",
        exam: "Exam"
    }
};
