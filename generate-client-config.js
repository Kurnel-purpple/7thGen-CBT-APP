/**
 * Client Configuration Generator
 * Run this script to interactively create a new client configuration
 * 
 * Usage: node generate-client-config.js
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function generateClientConfig() {
    console.log('\n🎨 CBT Exam App - Client Configuration Generator\n');
    console.log('This wizard will help you create a new client configuration.\n');

    // Gather information
    const clientId = await question('Client ID (lowercase, use hyphens, e.g., "greenwood-academy"): ');
    const clientName = await question('Full Client Name (e.g., "Greenwood Academy"): ');
    const shortName = await question('Short Name (e.g., "Greenwood"): ');

    console.log('\n📐 Brand Colors (enter hex codes like #4a90e2):\n');
    const primaryColor = await question('Primary Color: ');
    const primaryHover = await question('Primary Hover (darker shade): ');
    const secondaryColor = await question('Secondary Color: ');
    const accentColor = await question('Accent Color: ');

    console.log('\n📝 Customization:\n');
    const footerText = await question('Footer Text (e.g., "© 2026 Greenwood Academy"): ');
    const loginTitle = await question('Login Page Title (e.g., "Welcome to Greenwood"): ');

    // Generate configuration
    const config = `/**
 * Client Configuration - ${clientName}
 * Generated on ${new Date().toISOString().split('T')[0]}
 */

export const clientConfig = {
  // Client Information
  client: {
    name: "${clientName}",
    shortName: "${shortName}",
    logo: "assets/clients/${clientId}/logo.png",
    favicon: "assets/clients/${clientId}/favicon.png"
  },

  // Branding & Theme
  branding: {
    // Primary Colors
    primaryColor: "${primaryColor}",
    primaryHover: "${primaryHover}",
    
    // Secondary Colors
    secondaryColor: "${secondaryColor}",
    accentColor: "${accentColor}",
    
    // Status Colors
    successColor: "#2ecc71",
    warningColor: "#f1c40f",
    errorColor: "#e74c3c",
    
    // Text Colors
    textColor: "#2c3e50",
    lightText: "#7f8c8d",
    
    // Background Colors
    backgroundColor: "#f5f7fa",
    cardBackground: "#ffffff",
    borderColor: "#e0e0e0",
    innerBackground: "#fafafa",
    
    // Dark Mode Colors
    darkMode: {
      backgroundColor: "#1a1a1a",
      cardBackground: "#2d2d2d",
      innerBackground: "#222222",
      textColor: "#e0e0e0",
      lightText: "#a0a0a0",
      borderColor: "#404040",
      primaryColor: "${primaryColor}"
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
    fontFamily: "'Segoe UI', 'Inter', sans-serif",
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
    text: "${footerText}",
    showYear: true
  },

  // Page Titles
  pageTitles: {
    login: "${loginTitle}",
    register: "Create Account",
    studentDashboard: "Student Dashboard",
    teacherDashboard: "Teacher Dashboard",
    exam: "Exam"
  }
};
`;

    // Save configuration file
    const configDir = path.join(__dirname, 'src', 'config', 'clients');
    const configPath = path.join(configDir, `${clientId}.js`);

    // Create directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configPath, config);

    // Create assets directory
    const assetsDir = path.join(__dirname, 'src', 'assets', 'clients', clientId);
    if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true });
    }

    // Create placeholder README
    const readmePath = path.join(assetsDir, 'README.md');
    const readmeContent = `# ${clientName} Assets

Add the following files to this directory:

1. **logo.png** - Client logo (recommended: 200x60px)
2. **favicon.png** - Favicon (recommended: 32x32px or 64x64px)

## Current Status
- [ ] Logo added
- [ ] Favicon added
- [ ] Tested in app

## Testing
To test this configuration, use:
\`\`\`
http://localhost/index.html?client=${clientId}
\`\`\`
`;

    fs.writeFileSync(readmePath, readmeContent);

    console.log('\n✅ Configuration created successfully!\n');
    console.log('📁 Files created:');
    console.log(`   - ${configPath}`);
    console.log(`   - ${assetsDir}/`);
    console.log('\n📝 Next steps:');
    console.log(`   1. Add logo.png to: ${assetsDir}/`);
    console.log(`   2. Add favicon.png to: ${assetsDir}/`);
    console.log(`   3. Test with: http://localhost/index.html?client=${clientId}`);
    console.log('\n🎉 Done!\n');

    rl.close();
}

// Run the generator
generateClientConfig().catch(err => {
    console.error('Error:', err);
    rl.close();
    process.exit(1);
});
