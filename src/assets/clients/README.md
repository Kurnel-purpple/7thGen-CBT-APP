# Client Assets

This folder contains client-specific assets like logos and favicons.

## Structure

```
clients/
├── greenwood/
│   ├── logo.png
│   └── favicon.png
├── sunrise/
│   ├── logo.png
│   └── favicon.png
└── [your-client]/
    ├── logo.png
    └── favicon.png
```

## Logo Guidelines

### Logo Image (logo.png)
- **Recommended size**: 200x60px (or similar aspect ratio)
- **Format**: PNG with transparent background
- **Max height**: 40-50px when displayed
- **File size**: Keep under 100KB for fast loading

### Favicon (favicon.png)
- **Recommended size**: 32x32px or 64x64px
- **Format**: PNG or ICO
- **File size**: Keep under 10KB

## Adding Your Client's Assets

1. Create a new folder: `clients/your-client-name/`
2. Add your logo: `logo.png`
3. Add your favicon: `favicon.png`
4. Update your client config to reference these files:
   ```javascript
   logo: "assets/clients/your-client-name/logo.png"
   favicon: "assets/clients/your-client-name/favicon.png"
   ```

## Notes

- Use descriptive folder names (lowercase, no spaces)
- Optimize images before uploading
- Test on both light and dark backgrounds
- Ensure logos are readable at small sizes
