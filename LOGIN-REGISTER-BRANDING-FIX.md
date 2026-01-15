# Testing Client Branding on Login/Register Pages

## What We Fixed

Added the `logo-text` class to the `<h1>` tags in:
- ✅ `src/index.html` (login page)
- ✅ `src/pages/register.html` (register page)

## How It Works

The `themeApplier.js` looks for elements with the class `.logo-text` and updates their text content with the client name from the configuration.

**Before:**
```html
<h1>Gen7 CBT</h1>  <!-- Static text, never changes -->
```

**After:**
```html
<h1 class="logo-text">Gen7 CBT</h1>  <!-- Will be replaced with client name -->
```

## What You Should See

### On SEATOS Branch (Local or Deployed):
- **Login page header**: "SEATOS SCHOOLS" (not "Gen7 CBT")
- **Register page header**: "SEATOS SCHOOLS" (not "Gen7 CBT")
- **All other pages**: "SEATOS SCHOOLS"

### On Main Branch (Default):
- **All pages**: "Gen7 CBT" (or whatever is in `default.js`)

## How to Test Locally

1. **Open the login page** in Live Server
2. **Open browser console** (F12)
3. **Look for these logs**:
   ```
   🔍 Detecting client ID...
   ✅ Client ID from meta tag: seatos
   ✅ Configuration loaded for: SEATOS SCHOOLS
   🎨 Theme applied successfully
   ```
4. **Check the header** - should say "SEATOS SCHOOLS"
5. **Navigate to register page** - should also say "SEATOS SCHOOLS"

## Technical Details

The `applyBranding()` function in `themeApplier.js` (line 164) does this:

```javascript
const logoElements = document.querySelectorAll('.logo-text, [data-brand="app-name"]');
logoElements.forEach(el => {
    el.textContent = client.name;  // "SEATOS SCHOOLS"
});
```

This runs automatically when the page loads, after the configuration is initialized.

## Next Steps

1. **Test locally** to confirm it works
2. **Commit the changes**:
   ```bash
   git add src/index.html src/pages/register.html
   git commit -m "Fix: Add logo-text class to enable client branding on login/register pages"
   git push origin seatos
   ```
3. **Wait for Netlify to deploy**
4. **Verify on deployed site**

---

**Status**: ✅ Fixed and ready to test!
