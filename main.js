require('dotenv').config();
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray;

// ============================================
// AUTO-UPDATER CONFIGURATION
// ============================================

// Configure auto-updater
autoUpdater.autoDownload = false; // Don't auto-download, let user choose
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
    // Check for updates on startup (after a delay to not slow down launch)
    setTimeout(() => {
        if (app.isPackaged) {
            console.log('[AutoUpdater] Checking for updates...');
            autoUpdater.checkForUpdates().catch(err => {
                console.log('[AutoUpdater] Update check failed:', err.message);
            });
        } else {
            console.log('[AutoUpdater] Skipping update check in dev mode');
        }
    }, 5000);

    // Update available
    autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdater] Update available:', info.version);

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Available',
            message: `A new version (v${info.version}) is available!`,
            detail: `Current version: v${app.getVersion()}\n\nWould you like to download and install the update?`,
            buttons: ['Download Update', 'Later'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                // User wants to download
                autoUpdater.downloadUpdate();

                // Show progress notification
                if (mainWindow && mainWindow.webContents) {
                    mainWindow.webContents.send('update-downloading', info.version);
                }
            }
        });
    });

    // No update available
    autoUpdater.on('update-not-available', () => {
        console.log('[AutoUpdater] App is up to date');
    });

    // Download progress
    autoUpdater.on('download-progress', (progress) => {
        const percent = Math.round(progress.percent);
        console.log(`[AutoUpdater] Download progress: ${percent}%`);

        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('update-progress', percent);
        }

        // Update taskbar progress on Windows
        if (mainWindow) {
            mainWindow.setProgressBar(progress.percent / 100);
        }
    });

    // Update downloaded
    autoUpdater.on('update-downloaded', (info) => {
        console.log('[AutoUpdater] Update downloaded:', info.version);

        // Clear taskbar progress
        if (mainWindow) {
            mainWindow.setProgressBar(-1);
        }

        dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'Update Ready',
            message: 'Update downloaded successfully!',
            detail: `Version ${info.version} has been downloaded.\n\nThe app will restart to install the update.`,
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall();
            }
        });
    });

    // Error handling
    autoUpdater.on('error', (error) => {
        console.error('[AutoUpdater] Error:', error.message);

        // Only show error dialog if it's a real error (not just offline)
        if (!error.message.includes('net::ERR_INTERNET_DISCONNECTED') &&
            !error.message.includes('net::ERR_NETWORK_CHANGED')) {
            // Silently fail - don't bother user
        }
    });
}

// IPC handler for manual update check
ipcMain.handle('check-for-updates', async () => {
    if (!app.isPackaged) {
        return { available: false, message: 'Updates disabled in dev mode' };
    }

    try {
        const result = await autoUpdater.checkForUpdates();
        return {
            available: result.updateInfo.version !== app.getVersion(),
            version: result.updateInfo.version,
            currentVersion: app.getVersion()
        };
    } catch (error) {
        return { available: false, error: error.message };
    }
});

// IPC handler to get app version
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

// ============================================
// WINDOW STATE PERSISTENCE
// ============================================

const userDataPath = app.getPath('userData');
const statePath = path.join(userDataPath, 'window-state.json');

function loadWindowState() {
    try {
        if (fs.existsSync(statePath)) {
            const data = fs.readFileSync(statePath, 'utf8');
            if (data && data.trim().length > 0) {
                return JSON.parse(data);
            }
        }
    } catch (e) {
        console.error('Failed to load window state', e);
        try {
            if (fs.existsSync(statePath)) {
                fs.unlinkSync(statePath);
                console.log('Deleted corrupted window state file');
            }
        } catch (deleteError) {
            console.error('Failed to delete corrupted state file', deleteError);
        }
    }
    return { width: 1200, height: 800 };
}

function saveWindowState(bounds) {
    try {
        fs.writeFileSync(statePath, JSON.stringify(bounds));
    } catch (e) {
        console.error('Failed to save window state', e);
    }
}

// ============================================
// WINDOW CREATION
// ============================================

function createWindow() {
    const state = loadWindowState();

    mainWindow = new BrowserWindow({
        width: state.width,
        height: state.height,
        x: state.x,
        y: state.y,
        minWidth: 360,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        },
        backgroundColor: '#f5f7fa',
        show: false,
        icon: path.join(__dirname, 'src/assets/icon.png')
    });

    mainWindow.loadFile('src/index.html');

    // Save state on close
    mainWindow.on('close', () => {
        saveWindowState(mainWindow.getBounds());
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Build Native Menu
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                { role: 'quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Check for Updates',
                    click: async () => {
                        if (!app.isPackaged) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'info',
                                title: 'Development Mode',
                                message: 'Updates are disabled in development mode.',
                                buttons: ['OK']
                            });
                            return;
                        }

                        try {
                            const result = await autoUpdater.checkForUpdates();
                            if (result.updateInfo.version === app.getVersion()) {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'info',
                                    title: 'No Updates',
                                    message: 'You are running the latest version!',
                                    detail: `Current version: v${app.getVersion()}`,
                                    buttons: ['OK']
                                });
                            }
                        } catch (error) {
                            dialog.showMessageBox(mainWindow, {
                                type: 'error',
                                title: 'Update Check Failed',
                                message: 'Could not check for updates.',
                                detail: 'Please check your internet connection.',
                                buttons: ['OK']
                            });
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'About Gen7 CBT Exam',
                    click: async () => {
                        await dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About',
                            message: `Gen7 CBT Exam v${app.getVersion()}`,
                            detail: 'A secure, offline-capable exam platform.\n\n© 2026 Gen7 CBT\ncorneliusajayi123@gmail.com',
                            buttons: ['OK']
                        });
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

// ============================================
// SYSTEM TRAY
// ============================================

function createTray() {
    const iconPath = path.join(__dirname, 'src/assets/icon.png');
    if (!fs.existsSync(iconPath)) return;

    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('Gen7 CBT Exam App');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates() },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow.show());
}

// ============================================
// APP LIFECYCLE
// ============================================

app.whenReady().then(() => {
    createWindow();
    createTray();
    setupAutoUpdater();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle certificate errors for development
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
});
