require('dotenv').config();
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, dialog, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray;
let updateDownloadInProgress = false;

// Light proctoring, desktop half. Non-null only while a student is sitting a
// strict-mode exam; see the EXAM LOCK section near the bottom of this file.
let examLock = null;
// Captured when they are first built, so the lock can swap them out and put the
// real ones back afterwards.
let normalMenu = null;
let normalTrayMenu = null;

function isExamLocked() {
    return !!examLock;
}

// Two instances sharing one userData profile corrupt Chromium's disk cache /
// quota database on Windows. Second launch focuses the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

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

        // Never over a live exam. The dialog steals focus, and the exam page reads
        // lost focus as the student switching away — an update prompt would hand
        // them a proctoring strike for something they did not do. The update is
        // not lost; it is found again on the next check or launch.
        if (isExamLocked()) {
            console.log('[AutoUpdater] Exam in progress — deferring the update prompt');
            return;
        }

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
                updateDownloadInProgress = true;
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
        updateDownloadInProgress = false;

        // Clear taskbar progress
        if (mainWindow) {
            mainWindow.setProgressBar(-1);
        }

        // Same reasoning as update-available, plus this one offers to restart the
        // app — which would destroy an attempt in progress. autoInstallOnAppQuit
        // is on, so the update still lands the next time the app is closed.
        if (isExamLocked()) {
            console.log('[AutoUpdater] Exam in progress — deferring the restart prompt');
            return;
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

        // Background checks fail silently (offline etc.), but a failed
        // user-initiated download must not disappear into the void.
        if (!updateDownloadInProgress) return;
        updateDownloadInProgress = false;

        if (mainWindow) {
            mainWindow.setProgressBar(-1);
        }

        dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Update Download Failed',
            message: 'The update could not be downloaded.',
            detail: `${error.message}\n\nYou can download the latest installer manually from the releases page.`,
            buttons: ['Open Releases Page', 'Close'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                require('electron').shell.openExternal('https://github.com/Kurnel-purpple/7thGen-CBT-APP/releases/latest');
            }
        });
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
    mainWindow.on('close', (e) => {
        // setClosable(false) already refuses the titlebar button, but Alt+F4 and
        // an app.quit() from elsewhere take different routes. This is the one
        // place all of them pass through.
        if (examLock) {
            if (examLock.mode === 'strict') {
                e.preventDefault();
                notifyBlockedAction('close');
                console.log('[ExamLock] close refused — exam in progress');
                return;
            }
            // Warn mode never traps anyone. The first attempt is intercepted so
            // the student gets the warning at the moment they click, which is the
            // whole point of warning them; a second attempt is theirs to make.
            if (!examLock.warnedClose) {
                examLock.warnedClose = true;
                e.preventDefault();
                notifyBlockedAction('close');
                console.log('[ExamLock] close warned (warn mode) — next attempt allowed');
                return;
            }
        }
        saveWindowState(mainWindow.getBounds());
    });

    // Minimising cannot be prevented, only undone: the event fires after the
    // window is already down, so we restore it immediately. On a desktop that
    // reads as the button simply not working, which is the closest thing to
    // interception a window manager will give us.
    mainWindow.on('minimize', () => {
        if (!examLock) return;

        if (examLock.mode === 'strict') {
            mainWindow.restore();
            notifyBlockedAction('minimize');
            return;
        }
        if (!examLock.warnedMinimize) {
            examLock.warnedMinimize = true;
            mainWindow.restore();
            notifyBlockedAction('minimize');
        }
    });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // --- Lock failsafes ---
    //
    // Built before the lock itself, because the failure this design cannot afford
    // is a student trapped in a window that has no exit. Every way the exam page
    // can stop existing has to end with the window unlocked.

    // The renderer died. Nothing is going to send exam:unlock now.
    mainWindow.webContents.on('render-process-gone', (event, details) => {
        console.log('[ExamLock] renderer gone (' + details.reason + ') — releasing');
        releaseExamLock('renderer-gone');
    });

    // Navigated away from the exam page — a submit that completed, or any other
    // route out. Covers the case where the unlock IPC never arrives.
    const releaseIfOffExamPage = (url) => {
        if (!isExamLocked()) return;
        if (String(url || '').indexOf('take-exam.html') === -1) {
            console.log('[ExamLock] no longer on the exam page — releasing');
            releaseExamLock('navigated-away');
        }
    };
    mainWindow.webContents.on('did-navigate', (e, url) => releaseIfOffExamPage(url));
    mainWindow.webContents.on('did-navigate-in-page', (e, url) => releaseIfOffExamPage(url));

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

    normalMenu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(normalMenu);
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

    normalTrayMenu = Menu.buildFromTemplate([
        { label: 'Show App', click: () => mainWindow.show() },
        { label: 'Check for Updates', click: () => autoUpdater.checkForUpdates() },
        { type: 'separator' },
        { label: 'Quit', role: 'quit' }
    ]);

    tray.setContextMenu(normalTrayMenu);
    tray.on('double-click', () => mainWindow.show());
}

// ============================================
// EXAM LOCK (light proctoring — desktop)
// ============================================
//
// The web half of light proctoring (src/modules/cbt/js/proctorWatcher.js) can
// only DETECT a student leaving an exam, because no browser is allowed to stop
// them. Here we own the window, so a strict-mode exam can genuinely refuse to be
// minimised or closed.
//
// It is still not absolute — nothing in userland stops Win+D, Ctrl+Alt+Del or
// pulling the plug — and it does not need to be. Escaping the kiosk does not
// escape proctoring: the page's own watcher stays armed throughout, so a student
// who gets out lands right back in the ordinary strike rules.
//
//
// EVERY RELEASE PATH IS BUILT BEFORE THE LOCK IS APPLIED
//
// The failure this cannot afford is a student sealed inside a window with no way
// out — a hung renderer would otherwise leave a teacher power-cycling a machine
// mid-exam. So the lock is released by all of:
//
//   1. the exam page asking, on submit                 (exam:unlock)
//   2. the exam page going quiet for 90 seconds        (heartbeat watchdog)
//   3. the renderer crashing                           (render-process-gone)
//   4. the page navigating off take-exam.html          (did-navigate)
//   5. a hard timer, the exam's own duration plus 30m  (belt and braces)
//   6. an invigilator pressing Ctrl+Shift+Alt+U        (manual override)
//
// 2 through 5 need nothing from the renderer at all.

const LOCK_BUFFER_MS = 30 * 60 * 1000;      // grace on top of the exam duration
const LOCK_MAX_MS = 8 * 60 * 60 * 1000;     // no lock outlives a school day
const HEARTBEAT_TIMEOUT_MS = 90 * 1000;     // three missed 30s beats
const OVERRIDE_ACCELERATOR = 'CommandOrControl+Shift+Alt+U';

/**
 * Tell the exam page that the student just tried something we stopped, so it can
 * warn them then and there rather than after the fact.
 *
 * This is the part the web cannot do. In a browser nothing fires before a
 * minimise — `visibilitychange` arrives once the window is already down, so the
 * warning can only be shown when they come back. Here we own the window, so the
 * warning lands on the click.
 */
function notifyBlockedAction(action) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        mainWindow.webContents.send('exam:blocked-action', action);
    } catch (e) {
        console.error('[ExamLock] could not notify the page:', e);
    }
}

function releaseExamLock(reason) {
    if (!examLock) return;

    const lock = examLock;
    // Cleared first: the close handler and the watchdog both consult it, and they
    // must see an unlocked app while we put the window back.
    examLock = null;

    if (lock.hardTimer) clearTimeout(lock.hardTimer);
    if (lock.watchdog) clearInterval(lock.watchdog);

    try {
        globalShortcut.unregister(OVERRIDE_ACCELERATOR);
    } catch (e) { /* never block the release */ }

    if (mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.setKiosk(false);
            mainWindow.setAlwaysOnTop(false);
            mainWindow.setClosable(true);
            mainWindow.setMinimizable(true);
        } catch (e) {
            console.error('[ExamLock] could not restore the window:', e);
        }
    }

    try {
        if (normalMenu) Menu.setApplicationMenu(normalMenu);
        if (tray && normalTrayMenu) tray.setContextMenu(normalTrayMenu);
    } catch (e) { /* never block the release */ }

    console.log('[ExamLock] released (' + reason + ') after ' +
        Math.round((Date.now() - lock.startedAt) / 1000) + 's');
}

function lockForExam(opts) {
    if (!mainWindow || mainWindow.isDestroyed()) return { locked: false, reason: 'no-window' };
    // Already locked for this attempt — a reload of the exam page re-requests it.
    if (examLock) {
        examLock.lastBeat = Date.now();
        return { locked: true, reason: 'already-locked' };
    }

    const durationSeconds = Number(opts && opts.durationSeconds) || 0;
    const hardMs = Math.min(Math.max(durationSeconds * 1000, 0) + LOCK_BUFFER_MS, LOCK_MAX_MS);
    const mode = (opts && opts.mode) === 'warn' ? 'warn' : 'strict';

    examLock = {
        examId: String((opts && opts.examId) || ''),
        mode: mode,
        startedAt: Date.now(),
        lastBeat: Date.now(),
        // Warn mode intercepts each of these exactly once, so the student is
        // warned at the click without ever being trapped.
        warnedClose: false,
        warnedMinimize: false,
        hardTimer: null,
        watchdog: null
    };

    // 5. The hard stop. Runs even if every other signal fails.
    examLock.hardTimer = setTimeout(() => releaseExamLock('hard-timeout'), hardMs);

    // 2. The watchdog. A frozen or silently dead page stops beating, and the
    //    window frees itself without anyone having to reboot the machine.
    examLock.watchdog = setInterval(() => {
        if (!examLock) return;
        if (Date.now() - examLock.lastBeat > HEARTBEAT_TIMEOUT_MS) {
            releaseExamLock('heartbeat-lost');
        }
    }, 15000);

    // Warn mode stops here. It watches the window's minimise and close events —
    // registered once in createWindow, and inert whenever examLock is null — but
    // it deliberately does NOT go kiosk, take the menu away or make the window
    // unclosable. Its whole job is to tell the student what they are doing at the
    // moment they do it, then get out of the way.
    if (mode === 'warn') {
        console.log('[ExamLock] warn mode armed for exam ' + examLock.examId +
            ' (no kiosk; one interception each for minimise and close)');
        return { locked: true, reason: 'warn-armed' };
    }

    // 6. The invigilator's way out. Deliberately a plain confirmation rather than
    //    a password: a student who finds the combination gains nothing worth
    //    having, because leaving the kiosk drops them back under the page's own
    //    strike rules, which are still running.
    try {
        globalShortcut.register(OVERRIDE_ACCELERATOR, () => {
            if (!examLock) return;
            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                title: 'Supervisor Override',
                message: 'Unlock this computer during an exam?',
                detail: 'The exam stays open and continues to be monitored. Use this only if the machine needs attention.',
                buttons: ['Unlock', 'Cancel'],
                defaultId: 1,
                cancelId: 1
            }).then((r) => {
                if (r.response === 0) releaseExamLock('supervisor-override');
            });
        });
    } catch (e) {
        console.error('[ExamLock] could not register the override shortcut:', e);
    }

    // --- and only now, the lock itself ---
    try {
        mainWindow.setClosable(false);
        mainWindow.setMinimizable(false);
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        mainWindow.setKiosk(true);
        mainWindow.show();
        mainWindow.focus();
    } catch (e) {
        console.error('[ExamLock] could not apply the lock:', e);
        releaseExamLock('lock-failed');
        return { locked: false, reason: 'lock-failed' };
    }

    // Strip the menu down. This is what removes the Ctrl+R / Ctrl+Shift+I /
    // Ctrl+Q accelerators — they are attached to the menu roles, so taking the
    // roles away takes the shortcuts with them.
    try {
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { label: 'Exam in progress', submenu: [{ label: 'This computer is locked for an exam.', enabled: false }] }
        ]));
        if (tray) {
            tray.setContextMenu(Menu.buildFromTemplate([
                { label: 'Exam in progress', enabled: false }
            ]));
        }
    } catch (e) { /* the window lock is what matters */ }

    console.log('[ExamLock] locked for exam ' + examLock.examId +
        ' (hard release in ' + Math.round(hardMs / 60000) + ' min)');
    return { locked: true, reason: 'locked' };
}

// A hung renderer must not hold the window hostage.
app.on('web-contents-created', (e, contents) => {
    contents.on('unresponsive', () => {
        if (isExamLocked()) {
            console.log('[ExamLock] renderer unresponsive — releasing');
            releaseExamLock('unresponsive');
        }
    });
});

ipcMain.handle('exam:lock', (event, opts) => lockForExam(opts || {}));

ipcMain.on('exam:unlock', () => releaseExamLock('page-request'));

ipcMain.on('exam:heartbeat', () => {
    if (examLock) examLock.lastBeat = Date.now();
});

ipcMain.handle('exam:lock-status', () => ({
    locked: isExamLocked(),
    examId: examLock ? examLock.examId : null
}));

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

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

// Handle certificate errors for development
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    event.preventDefault();
    callback(true);
});
