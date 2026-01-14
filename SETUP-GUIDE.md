# 🚀 Quick Setup Guide - Client Configuration System

This guide will help you create a customized version of the CBT Exam App for a new client in under 10 minutes.

## ✅ Prerequisites

- Your client's logo (PNG, ~200x60px)
- Your client's favicon (PNG, 32x32px or 64x64px)
- Client's preferred brand colors (hex codes)
- Client's school/organization name

---

## 📋 Step-by-Step Setup

### Step 1: Create Client Configuration File

1. Navigate to `src/config/clients/`
2. Create a new file: `your-client-name.js` (use lowercase, hyphens for spaces)
3. Copy this template:

```javascript
export const clientConfig = {
  client: {
    name: "Your School Name",
    shortName: "Short Name",
    logo: "assets/clients/your-client-name/logo.png",
    favicon: "assets/clients/your-client-name/favicon.png"
  },

  branding: {
    primaryColor: "#4a90e2",      // Main brand color
    primaryHover: "#357abd",       // Darker shade for hover
    secondaryColor: "#2c3e50",     // Secondary color
    accentColor: "#e74c3c",        // Accent/highlight color
    
    successColor: "#2ecc71",       // Green for success
    warningColor: "#f1c40f",       // Yellow for warnings
    errorColor: "#e74c3c",         // Red for errors
    
    textColor: "#333333",          // Main text
    lightText: "#7f8c8d",          // Secondary text
    
    backgroundColor: "#f5f7fa",    // Page background
    cardBackground: "#ffffff",     // Card/panel background
    borderColor: "#e0e0e0",        // Borders
    innerBackground: "#fafafa",    // Inner containers
    
    // Dark mode (optional - customize if needed)
    darkMode: {
      backgroundColor: "#1a1a1a",
      cardBackground: "#2d2d2d",
      innerBackground: "#222222",
      textColor: "#e0e0e0",
      lightText: "#a0a0a0",
      borderColor: "#404040",
      primaryColor: "#5d9cec"
    }
  },

  typography: {
    fontFamily: "'Segoe UI', sans-serif",
    fontSize: "16px",
    borderRadius: "25px"
  },

  features: {
    offlineMode: true,
    darkModeToggle: true,
    timeExtensions: true,
    bulkImport: true,
    richQuestions: true
  },

  footer: {
    text: "© 2026 Your School Name. All rights reserved.",
    showYear: true
  },

  pageTitles: {
    login: "Welcome to Your School",
    register: "Join Your School",
    studentDashboard: "My Exams",
    teacherDashboard: "Exam Management",
    exam: "Assessment"
  }
};
```

### Step 2: Add Client Assets

1. Create folder: `src/assets/clients/your-client-name/`
2. Add your logo: `logo.png`
3. Add your favicon: `favicon.png`

### Step 3: Test Your Configuration

**Option A: Using the Client Switcher (Recommended)**
1. Open: `src/config/client-switcher.html` in your browser
2. Add your client to the list (edit the HTML)
3. Select and apply

**Option B: Using URL Parameter**
1. Open your app: `http://localhost/index.html?client=your-client-name`
2. The configuration will auto-apply

**Option C: Set as Default**
1. Add to `index.html` in the `<head>`:
   ```html
   <meta name="client-id" content="your-client-name">
   ```

### Step 4: Verify Everything Works

Check these items:
- [ ] Logo appears in header
- [ ] App name is correct
- [ ] Colors match brand (check buttons, links, backgrounds)
- [ ] Dark mode colors look good
- [ ] Page titles are customized
- [ ] Footer text is correct
- [ ] Favicon shows in browser tab

---

## 🎨 Color Selection Tips

### Finding Your Brand Colors

1. **Primary Color**: Your client's main brand color (usually from their logo)
2. **Primary Hover**: 10-15% darker than primary
3. **Secondary Color**: Complementary or contrasting color
4. **Accent Color**: For highlights and call-to-actions

### Tools to Help

- **Color Picker**: Use browser DevTools or [coolors.co](https://coolors.co)
- **Shade Generator**: [maketintsandshades.com](https://maketintsandshades.com)
- **Contrast Checker**: [webaim.org/resources/contrastchecker](https://webaim.org/resources/contrastchecker/)

### Example Color Schemes

**Professional Blue**
```javascript
primaryColor: "#2563eb"
primaryHover: "#1d4ed8"
secondaryColor: "#64748b"
accentColor: "#f59e0b"
```

**Nature Green**
```javascript
primaryColor: "#10b981"
primaryHover: "#059669"
secondaryColor: "#14532d"
accentColor: "#fbbf24"
```

**Warm Orange**
```javascript
primaryColor: "#f97316"
primaryHover: "#ea580c"
secondaryColor: "#0c4a6e"
accentColor: "#fbbf24"
```

---

## 🚀 Deployment

### For Single Client Deployment

1. Add meta tag to `index.html`:
   ```html
   <meta name="client-id" content="your-client-name">
   ```

2. Deploy to client's domain:
   - `https://yourschool.com`

### For Multi-Client Deployment

**Option 1: URL Parameters**
- Deploy once
- Share different URLs:
  - `https://app.com/?client=school-a`
  - `https://app.com/?client=school-b`

**Option 2: Subdomains**
- Set up subdomain routing
- `school-a.app.com` → loads `client=school-a`
- `school-b.app.com` → loads `client=school-b`

---

## 🐛 Troubleshooting

### Logo Not Showing
- ✅ Check file path is correct
- ✅ Verify image file exists
- ✅ Check browser console for 404 errors
- ✅ Try absolute path: `/assets/clients/...`

### Colors Not Applying
- ✅ Clear browser cache (Ctrl+Shift+R)
- ✅ Check hex color format: `#rrggbb`
- ✅ Verify client ID matches filename
- ✅ Check browser console for errors

### Configuration Not Loading
- ✅ Check client ID spelling
- ✅ Verify file is in `src/config/clients/`
- ✅ Check file exports `clientConfig`
- ✅ Look for JavaScript errors in console

---

## 📞 Need Help?

1. Check the main README: `src/config/README.md`
2. Review example configs: `client-a.js` and `client-b.js`
3. Test with client switcher: `client-switcher.html`

---

## ✨ You're Done!

Your customized CBT Exam App is ready to deploy! 🎉

Remember to:
- Test on both desktop and mobile
- Check both light and dark modes
- Verify all pages (login, register, dashboards)
- Get client approval before final deployment
