# Client Configuration System

This configuration system allows you to customize the CBT Exam App for different clients without maintaining separate codebases.

## 📁 Structure

```
src/config/
├── index.js              # Main entry point
├── configLoader.js       # Configuration loader
├── themeApplier.js       # Theme application logic
├── default.js            # Default configuration
└── clients/              # Client-specific configs
    ├── client-a.js       # Example: Greenwood Academy
    └── client-b.js       # Example: Sunrise International
```

## 🚀 Quick Start

### 1. Create a New Client Configuration

Create a new file in `src/config/clients/` (e.g., `my-client.js`):

```javascript
export const clientConfig = {
  client: {
    name: "My School Name",
    shortName: "My School",
    logo: "assets/clients/my-school/logo.png",
    favicon: "assets/clients/my-school/favicon.png"
  },

  branding: {
    primaryColor: "#your-color",
    primaryHover: "#your-hover-color",
    // ... more colors
  },

  // ... other settings
};
```

### 2. Add Your Logo

Place your client's logo in:
- `src/assets/clients/my-school/logo.png`
- `src/assets/clients/my-school/favicon.png`

### 3. Activate the Configuration

You have three options:

#### Option A: URL Parameter (Recommended for Testing)
```
https://your-app.com/?client=my-client
```

#### Option B: Meta Tag (Recommended for Deployment)
Add to your HTML `<head>`:
```html
<meta name="client-id" content="my-client">
```

#### Option C: Programmatically
```javascript
import { setClient } from './config/index.js';
setClient('my-client');
```

## 🎨 Customization Options

### Client Information
- `name`: Full application name
- `shortName`: Abbreviated name for mobile
- `logo`: Path to logo image
- `favicon`: Path to favicon

### Branding Colors
- `primaryColor`: Main brand color
- `primaryHover`: Hover state for primary elements
- `secondaryColor`: Secondary brand color
- `accentColor`: Accent/highlight color
- `successColor`: Success state color
- `warningColor`: Warning state color
- `errorColor`: Error state color
- `textColor`: Main text color
- `lightText`: Secondary text color
- `backgroundColor`: Page background
- `cardBackground`: Card/panel background
- `borderColor`: Border color
- `innerBackground`: Inner container background

### Dark Mode
All colors can be customized for dark mode:
```javascript
darkMode: {
  backgroundColor: "#1a1a1a",
  cardBackground: "#2d2d2d",
  // ... etc
}
```

### Typography
- `fontFamily`: Font stack (supports Google Fonts)
- `fontSize`: Base font size
- `borderRadius`: Default border radius

### Features (Toggle On/Off)
- `offlineMode`: Enable PWA offline functionality
- `darkModeToggle`: Show dark mode toggle
- `timeExtensions`: Allow exam time extensions
- `bulkImport`: Enable bulk question import
- `richQuestions`: Enable image/matching questions

### Page Titles
Customize titles for each page:
- `login`: Login page title
- `register`: Registration page title
- `studentDashboard`: Student dashboard title
- `teacherDashboard`: Teacher dashboard title
- `exam`: Exam page title

### Footer
- `text`: Footer text
- `showYear`: Show current year

## 📝 Examples

### Example 1: Greenwood Academy (Green Theme)
See `src/config/clients/client-a.js`

### Example 2: Sunrise International (Orange Theme)
See `src/config/clients/client-b.js`

## 🔧 Integration

The configuration system is automatically initialized when you import it. To use in your code:

```javascript
import { getConfig, isFeatureEnabled } from './config/index.js';

// Get configuration
const config = getConfig();
console.log(config.client.name);

// Check if feature is enabled
if (isFeatureEnabled('timeExtensions')) {
  // Show time extension UI
}
```

## 🌐 Deployment

### For Each Client:

1. **Build with specific client**:
   - Add meta tag to `index.html`:
     ```html
     <meta name="client-id" content="client-a">
     ```
   - Deploy to client-specific URL

2. **Or use URL parameter**:
   - Deploy once
   - Share client-specific URLs:
     - `https://your-app.com/?client=client-a`
     - `https://your-app.com/?client=client-b`

3. **Or use subdomain routing**:
   - Configure your server to detect subdomain
   - Set client ID based on subdomain

## 🎯 Best Practices

1. **Always test with default config first**
2. **Use meaningful client IDs** (e.g., `greenwood`, `sunrise`)
3. **Keep logos in separate client folders**
4. **Document color choices** in comments
5. **Test both light and dark modes**
6. **Verify all page titles are updated**

## 🐛 Troubleshooting

### Configuration not loading?
- Check browser console for errors
- Verify client ID is correct
- Ensure client file exists in `src/config/clients/`

### Colors not applying?
- Check CSS variable names match
- Verify color format (use hex: `#rrggbb`)
- Clear browser cache

### Logo not showing?
- Verify logo path is correct
- Check image file exists
- Check browser console for 404 errors

## 📦 File Checklist for New Client

- [ ] Create `src/config/clients/your-client.js`
- [ ] Add logo: `src/assets/clients/your-client/logo.png`
- [ ] Add favicon: `src/assets/clients/your-client/favicon.png`
- [ ] Test with `?client=your-client`
- [ ] Verify all colors in light mode
- [ ] Verify all colors in dark mode
- [ ] Check all page titles
- [ ] Test on mobile
- [ ] Deploy!

---

**Need help?** Check the example configurations in `src/config/clients/` for reference.
