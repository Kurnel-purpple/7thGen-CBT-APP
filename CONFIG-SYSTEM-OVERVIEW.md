# 🎨 Client Configuration System - Overview

## What Was Created

A complete configuration system that allows you to customize the CBT Exam App for different clients **without creating separate repositories or codebases**.

---

## 📁 File Structure

```
testingAG/
├── src/
│   ├── config/
│   │   ├── index.js                    # Main entry point
│   │   ├── configLoader.js             # Loads configurations
│   │   ├── themeApplier.js             # Applies themes to UI
│   │   ├── default.js                  # Default configuration
│   │   ├── client-switcher.html        # Visual testing tool
│   │   ├── README.md                   # Documentation
│   │   └── clients/
│   │       ├── client-a.js             # Example: Greenwood Academy
│   │       └── client-b.js             # Example: Sunrise International
│   │
│   └── assets/
│       └── clients/
│           ├── greenwood/              # Greenwood assets folder
│           ├── sunrise/                # Sunrise assets folder
│           └── README.md               # Asset guidelines
│
├── SETUP-GUIDE.md                      # Quick setup guide
└── generate-client-config.js           # CLI generator tool
```

---

## 🚀 How It Works

### 1. **Configuration Files**
Each client has a configuration file that defines:
- Brand name and logo
- Color scheme (light & dark mode)
- Typography preferences
- Feature toggles
- Custom page titles
- Footer text

### 2. **Dynamic Theme Application**
When the app loads:
1. Detects which client to load (from URL, localStorage, or meta tag)
2. Loads the client's configuration
3. Dynamically applies:
   - CSS color variables
   - Logo and branding
   - Typography
   - Page titles
   - Custom fonts (if needed)

### 3. **No Code Duplication**
- ✅ Single codebase for all clients
- ✅ Easy to maintain and update
- ✅ Updates benefit all clients
- ✅ No merge conflicts between versions

---

## 🎯 What You Can Customize

### Visual Branding
- ✅ App name and logo
- ✅ Favicon
- ✅ Primary brand colors
- ✅ Secondary and accent colors
- ✅ Dark mode colors
- ✅ Typography and fonts
- ✅ Border radius and spacing

### Content
- ✅ Page titles (login, register, dashboards)
- ✅ Footer text
- ✅ Welcome messages

### Features
- ✅ Toggle offline mode
- ✅ Toggle dark mode
- ✅ Enable/disable time extensions
- ✅ Enable/disable bulk import
- ✅ Enable/disable rich questions

---

## 🔧 Three Ways to Use

### Method 1: URL Parameter (Best for Testing)
```
https://your-app.com/?client=greenwood-academy
```
- Quick switching between clients
- Great for demos
- No code changes needed

### Method 2: Meta Tag (Best for Deployment)
Add to HTML `<head>`:
```html
<meta name="client-id" content="greenwood-academy">
```
- Permanent configuration
- Deploy to client-specific domain
- Clean URLs

### Method 3: Programmatic (Advanced)
```javascript
import { setClient } from './config/index.js';
setClient('greenwood-academy');
```
- Dynamic switching
- User selection
- Multi-tenant apps

---

## 📝 Creating a New Client

### Quick Method (5 minutes)
1. Run: `node generate-client-config.js`
2. Answer the prompts
3. Add logo and favicon
4. Test with `?client=your-client`

### Manual Method (10 minutes)
1. Copy `src/config/clients/client-a.js`
2. Rename to `your-client.js`
3. Update all values
4. Create `assets/clients/your-client/` folder
5. Add logo.png and favicon.png
6. Test!

---

## 🎨 Example Clients Included

### 1. Default (CBT Exam Core)
- **Theme**: Professional Blue
- **Colors**: Blue (#4a90e2), Dark Blue (#2c3e50)
- **Use**: Original/fallback configuration

### 2. Greenwood Academy
- **Theme**: Nature Green
- **Colors**: Green (#2ecc71), Teal (#16a085)
- **Use**: Schools with eco/nature branding

### 3. Sunrise International
- **Theme**: Warm Orange
- **Colors**: Orange (#ff6b35), Navy (#004e89)
- **Use**: Schools with energetic/warm branding

---

## 🛠️ Tools Provided

### 1. Client Switcher (`client-switcher.html`)
- Visual interface to switch between clients
- Preview color schemes
- One-click activation
- **Location**: `src/config/client-switcher.html`

### 2. Config Generator (`generate-client-config.js`)
- Interactive CLI wizard
- Auto-generates configuration files
- Creates asset folders
- **Usage**: `node generate-client-config.js`

### 3. Documentation
- **SETUP-GUIDE.md**: Step-by-step setup instructions
- **src/config/README.md**: Detailed technical docs
- **src/assets/clients/README.md**: Asset guidelines

---

## 🚀 Deployment Strategies

### Single Client
```
1. Set meta tag in index.html
2. Deploy to client's domain
3. Done!
```

### Multiple Clients (Shared Hosting)
```
1. Deploy once
2. Share URLs with ?client= parameter
3. Each client gets custom URL
```

### Multiple Clients (Subdomains)
```
1. Set up subdomain routing
2. Map subdomain → client ID
3. greenwood.app.com → client=greenwood
4. sunrise.app.com → client=sunrise
```

---

## ✅ Benefits

### For You (Developer)
- ✅ **Single codebase** to maintain
- ✅ **Easy updates** - fix once, benefits all clients
- ✅ **No merge conflicts** between client versions
- ✅ **Faster deployment** - no separate builds
- ✅ **Scalable** - add unlimited clients

### For Clients
- ✅ **Custom branding** - looks like their own app
- ✅ **Professional appearance** - matches their brand
- ✅ **Fast updates** - benefit from improvements
- ✅ **Reliable** - tested across all clients

---

## 🎯 Next Steps

1. **Test the system**:
   - Open `src/config/client-switcher.html`
   - Try switching between configurations
   - See the colors and branding change

2. **Create your first client**:
   - Run `node generate-client-config.js`
   - Follow the prompts
   - Add your logo
   - Test it!

3. **Deploy**:
   - Choose your deployment method
   - Set the client ID
   - Deploy to production

---

## 📞 Support

- **Setup Guide**: `SETUP-GUIDE.md`
- **Technical Docs**: `src/config/README.md`
- **Examples**: Check `client-a.js` and `client-b.js`
- **Testing**: Use `client-switcher.html`

---

## 🎉 You're Ready!

You now have a professional, scalable system for creating customized versions of your CBT Exam App without maintaining multiple codebases!

**Happy customizing! 🚀**
