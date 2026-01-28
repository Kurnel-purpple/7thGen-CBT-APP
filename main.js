require('dotenv').config();
const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;

// Persistence Helpers
const userDataPath = app.getPath('userData');
const statePath = path.join(userDataPath, 'window-state.json');

function loadWindowState() {
    try {
        if (fs.existsSync(statePath)) {
            const data = fs.readFileSync(statePath, 'utf8');
            // Check if file is not empty
            if (data && data.trim().length > 0) {
                return JSON.parse(data);
            }
        }
    } catch (e) {
        console.error('Failed to load window state', e);
        // Delete corrupted state file
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
                    label: 'About CBT Exam',
                    click: async () => {
                        const { dialog } = require('electron');
                        await dialog.showMessageBox(mainWindow, {
                            type: 'info',
                            title: 'About',
                            message: 'CBT Exam App v1.0.0',
                            detail: 'A secure, offline-capable exam platform.',
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

function createTray() {
    const iconPath = path.join(__dirname, 'src/assets/icon.png');
    // Ensure icon exists before creating tray to avoid errors, 
    // though in dev we might just have it generated.
    if (!fs.existsSync(iconPath)) return;

    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    tray = new Tray(icon);
    tray.setToolTip('CBT Exam App');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        { label: 'Quit', role: 'quit' }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow.show());
}

app.whenReady().then(() => {
    createWindow();
    createTray();

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
