---
description: How to create a GitHub release for the desktop app
---

# Creating a GitHub Release for Gen7 CBT Desktop App

This guide walks you through creating a GitHub release so that the download button on your web app works correctly.

## Prerequisites

- Your code must be pushed to GitHub (✅ Already done!)
- You need a built `.exe` file from electron-builder
- You need a GitHub account with access to the repository

## Step 1: Build the Electron Application

First, ensure all dependencies are installed and build the Windows installer:

```bash
# Install dependencies (if not already done)
npm install

# Build the Windows installer
npm run build
```

This will create files in the `dist/` folder, including:
- `Gen7 CBT Exam Setup x.x.x.exe` - The installer for users
- `Gen7 CBT Exam x.x.x.exe` - The portable version (if configured)

**Expected output location**: `c:\Users\USER\Documents\testingAG\dist\`

## Step 2: Navigate to GitHub Releases Page

1. Open your browser and go to: https://github.com/Kurnel-purpple/7thGen-CBT-APP
2. Click on the **"Releases"** link on the right sidebar (or go directly to: https://github.com/Kurnel-purpple/7thGen-CBT-APP/releases)
3. Click the **"Draft a new release"** button (or **"Create a new release"**)

## Step 3: Create the Release

### 3.1 Choose a Tag
- Click **"Choose a tag"** dropdown
- Type a new tag name, for example: `v1.0.0` (follow semantic versioning)
- Click **"Create new tag: v1.0.0 on publish"**

### 3.2 Set Release Title
- In the **"Release title"** field, enter something descriptive like:
  - `Gen7-CBT-Desktop-App-v1.0.0`
  - or `Initial Desktop Release`

### 3.3 Write Release Description
Add a description of what's included. Example:

```markdown
## Gen7 CBT Exam - Desktop Application

### Features
✅ Full offline functionality with IndexedDB storage
✅ Automatic background sync when online
✅ Native Windows desktop experience
✅ Exam taking and creation capabilities
✅ Student and teacher dashboards

### Installation
1. Download the installer below
2. Run the `.exe` file
3. Follow the installation wizard
4. Launch "Gen7 CBT Exam" from your Start Menu or Desktop

### System Requirements
- Windows 7 or later (64-bit or 32-bit)
- 200 MB free disk space
- Internet connection for initial setup and sync

### What's New in v1.0.0
- Initial desktop application release
- IndexedDB integration for robust offline storage
- Background sync API for reliable data submission
- Electron-based native Windows application
```

### 3.4 Upload the Installer File

1. Scroll down to the **"Attach binaries"** section
2. Click the area or drag and drop your file
3. Upload the file from: `c:\Users\USER\Documents\testingAG\dist\Gen7 CBT Exam Setup 1.0.0.exe`
   - The exact filename will depend on your version number in package.json

**Important**: Make sure to upload the **Setup.exe** file (the installer), not just the portable .exe

### 3.5 Set as Latest Release
- ✅ Check the box **"Set as the latest release"**
- This ensures the `/releases/latest` URL points to this release

### 3.6 Publish the Release
- Click the green **"Publish release"** button

## Step 4: Verify the Download Link

After publishing, your download button should work! The URL in your code points to:
```
https://github.com/Kurnel-purpple/7thGen-CBT-APP/releases/latest
```

This will automatically redirect users to the latest release page where they can download the installer.

### Testing the Download
1. Open your web app: https://seatos-cbt-app.netlify.app (or your local version)
2. Wait 2 seconds for the download banner to appear
3. Click **"⬇️ Download for Windows"**
4. Verify it takes you to the GitHub release page
5. Verify the installer file is available for download

## Step 5: Future Updates

When you want to release a new version:

1. Update the version in `package.json`:
   ```json
   "version": "1.1.0"
   ```

2. Commit and push the changes
   ```bash
   git add package.json
   git commit -m "Bump version to 1.1.0"
   git push origin seatos
   ```

3. Build the new version:
   ```bash
   npm run build
   ```

4. Create a new release on GitHub with the new tag (e.g., `v1.1.0`)

5. Upload the new installer file

6. The `/releases/latest` URL will automatically point to the newest release!

## Troubleshooting

### Build fails
- Make sure all dependencies are installed: `npm install`
- Check that `src/assets/icon.ico` exists
- Verify Node.js and npm are up to date

### Release page shows wrong file
- Make sure you uploaded the **Setup.exe** file, not the unpacked .exe
- The Setup file includes the installer wizard

### Download button doesn't appear
- The banner only shows in web browsers, not in the Electron app
- It won't show if dismissed in the last 7 days (check localStorage)
- Make sure you're not running in Electron (check DevTools console)

## Quick Reference

- **Repository**: https://github.com/Kurnel-purpple/7thGen-CBT-APP
- **Releases Page**: https://github.com/Kurnel-purpple/7thGen-CBT-APP/releases
- **Latest Release URL**: https://github.com/Kurnel-purpple/7thGen-CBT-APP/releases/latest
- **Build Output**: `dist/` folder
- **Version Location**: `package.json` → `version` field