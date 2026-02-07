# Build Resources

This folder contains resources needed for building the Electron app installer.

## Required Files

### Windows Build
- `icon.ico` - Windows icon file (256x256, 128x128, 64x64, 48x48, 32x32, 16x16 sizes embedded)

## How to Create icon.ico

### Option 1: Online Converter
1. Go to https://icoconvert.com/ or https://convertio.co/png-ico/
2. Upload `src/assets/icon.png`
3. Select all sizes (16, 32, 48, 64, 128, 256)
4. Download the .ico file
5. Save as `build/icon.ico`

### Option 2: Using ImageMagick (if installed)
```bash
magick convert src/assets/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

### Option 3: Copy PNG (fallback)
If you don't create an .ico, the build will still work but may not have all icon sizes.
Just copy the PNG:
```bash
copy src\assets\icon.png build\icon.ico
```

## Building the App

### First time setup
```bash
npm install
```

### Build Windows installer
```bash
npm run build
```

### Build portable .exe (no install needed)
```bash
npm run build:portable
```

### Release with auto-update
```bash
npm run release
```

## Output
Built files will be in the `dist/` folder:
- `Gen7 CBT Exam Setup x.x.x.exe` - Windows installer
- `latest.yml` - Auto-update manifest
