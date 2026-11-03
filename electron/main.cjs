// Electron Main Process for Commander AI Studio
// Author: Edel Arencibia Baez (October 2, 2026)

const { app, BrowserWindow, ipcMain, shell, Menu, Tray, session, dialog, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* updater no disponible en el bundle */ }

// LSP Bridge
const {
  spawnTypeScriptLSP,
  shutdownLSP,
  notifyDidOpen,
  notifyDidChange,
  notifyDidClose,
  requestHover,
  requestDefinition,
  requestCompletion,
  requestRename,
  requestReferences,
  requestDocumentSymbols,
  requestWorkspaceSymbols,
} = require('./lspBridge.cjs');

let mainWindow = null;
let tray = null;
const SERVER_PORT = 3001;

async function startEmbeddedServer() {
  if (app.isPackaged || !process.env.ELECTRON_START_URL) {
    try {
      process.env.PORT = String(SERVER_PORT);
      process.env.NODE_ENV = 'production';
      const base = app.isPackaged
        ? (require('fs').existsSync(require('path').join(__dirname, 'server.cjs')) ? __dirname : (require('fs').existsSync(require('path').join(process.resourcesPath, 'server.cjs')) ? process.resourcesPath : __dirname))
        : __dirname;
      const fs = require('fs');
      const path = require('path');
      const logFile = 'C:\\temp\\electron-debug.log';
      fs.writeFileSync(logFile, 'isPackaged: ' + app.isPackaged + '\n__dirname: ' + __dirname + '\nbase: ' + base + '\nserver.cjs exists: ' + fs.existsSync(path.join(base, 'server.cjs')) + '\n');
      const cjsScript = path.join(base, 'server.cjs');
      const mjsScript = path.join(base, 'server.mjs');
      if (fs.existsSync(cjsScript)) {
        try {
          require(cjsScript);
          fs.appendFileSync(logFile, 'Server loaded OK\n');
        } catch (reqErr) {
          fs.appendFileSync(logFile, 'require error: ' + reqErr.message + '\n' + reqErr.stack + '\n');
        }
      } else if (fs.existsSync(mjsScript)) {
        await import(`file://${mjsScript.replace(/\\/g, '/')}`);
        fs.appendFileSync(logFile, 'Server loaded MJS OK\n');
      } else {
        fs.appendFileSync(logFile, 'No server.cjs or server.mjs found\n');
      }
    } catch (err) {
      const fs = require('fs');
      const logFile = 'C:\\temp\\electron-debug.log';
      fs.appendFileSync(logFile, 'ERROR: ' + err.message + '\n' + err.stack + '\n');
    }
  }
}


function createWindow() {
  const iconPath = app.isPackaged
    ? (fs.existsSync(path.join(process.resourcesPath, 'icon.ico')) ? path.join(process.resourcesPath, 'icon.ico') : path.join(process.resourcesPath, 'icon.png'))
    : (fs.existsSync(path.join(__dirname, '../build/icon.ico')) ? path.join(__dirname, '../build/icon.ico') : path.join(__dirname, '../build/icon.png'));

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    title: 'Commander AI Studio',
    backgroundColor: '#000080', // Norton Commander DOS Blue
    frame: false, // Frameless retro style: uses application in-app titlebar and control buttons
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const base = app.isPackaged
    ? (fs.existsSync(path.join(__dirname, 'server.cjs')) ? __dirname : (fs.existsSync(path.join(process.resourcesPath, 'server.cjs')) ? process.resourcesPath : __dirname))
    : __dirname;
  const hasEmbeddedServer = fs.existsSync(path.join(base, 'server.cjs')) || fs.existsSync(path.join(base, 'server.mjs'));

  let loadAttempts = 0;
  const maxAttempts = 25;

  function loadApp() {
    const targetUrl = process.env.ELECTRON_START_URL ||
      (!app.isPackaged && process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : null);

    if (targetUrl) {
      console.log('[Electron] Intentando cargar URL de desarrollo:', targetUrl);
      mainWindow.loadURL(targetUrl);
    } else if (hasEmbeddedServer) {
      console.log('[Electron] Cargando servidor embebido en puerto:', SERVER_PORT);
      mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
    } else {
      console.log('[Electron] Cargando dist/index.html directo');
      mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
  }

  // Si la carga falla porque el servidor aún está iniciando, reintentar automáticamente
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[Electron] Carga pendiente (${errorCode}: ${errorDescription}) en ${validatedURL}`);
    if (loadAttempts < maxAttempts && (validatedURL.startsWith('http://localhost') || validatedURL.startsWith('http://127.0.0.1'))) {
      loadAttempts++;
      console.log(`[Electron] Reintentando conectar con el servidor (${loadAttempts}/${maxAttempts}) en 800ms...`);
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          loadApp();
        }
      }, 800);
    } else {
      const distIndexPath = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(distIndexPath)) {
        console.log('[Electron] Fallback activado: cargando ../dist/index.html');
        mainWindow.loadFile(distIndexPath);
      }
    }
  });

  // DevTools solo en dev (nunca en empaquetado)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (app.isPackaged) return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  loadApp();

  // Open external links solo https en browser OS
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'https:') shell.openExternal(url, { activate: true });
    } catch { /* bloquea */ }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Auto-updater configuration
if (app.isPackaged && autoUpdater) {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for update...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdater] Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-available', { version: info.version, releaseNotes: info.releaseNotes });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdater] Update not available:', info.version);
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-download-progress', { percent: progressObj.percent });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdater] Update downloaded:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', { version: info.version, releaseNotes: info.releaseNotes });
    }
  });
}

// IPC Handlers for Native Titlebar controls (Minimize, Maximize, Close)
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window:close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window:isMaximized', () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle('app:getInfo', () => {
  return {
    name: 'Commander AI Studio',
    version: '2.5.0',
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  };
});

// Auto-updater IPC handlers
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged || !autoUpdater) return { success: false, message: 'No disponible en desarrollo' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:download', async () => {
  if (!app.isPackaged || !autoUpdater) return { success: false, message: 'No disponible en desarrollo' };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('update:install', async () => {
  if (!app.isPackaged || !autoUpdater) return { success: false, message: 'No disponible en desarrollo' };
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

ipcMain.handle('update:getStatus', () => {
  if (!app.isPackaged) return { status: 'development' };
  return {
    status: 'idle',
    // Estado real se comunica via eventos
  };
});

// ==================== LSP IPC Handlers ====================

// Initialize LSP for a project
ipcMain.handle('lsp:initialize', async (event, projectRoot) => {
  const wcId = event.sender.id;
  try {
    await spawnTypeScriptLSP(wcId, projectRoot);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Shutdown LSP
ipcMain.handle('lsp:shutdown', async (event) => {
  const wcId = event.sender.id;
  shutdownLSP(wcId);
  return { success: true };
});

// Document sync notifications
ipcMain.handle('lsp:didOpen', async (event, { filePath, languageId, version, text }) => {
  const wcId = event.sender.id;
  notifyDidOpen(wcId, filePath, languageId, version, text);
  return { success: true };
});

ipcMain.handle('lsp:didChange', async (event, { filePath, version, changes }) => {
  const wcId = event.sender.id;
  notifyDidChange(wcId, filePath, version, changes);
  return { success: true };
});

ipcMain.handle('lsp:didClose', async (event, { filePath }) => {
  const wcId = event.sender.id;
  notifyDidClose(wcId, filePath);
  return { success: true };
});

// LSP Requests
ipcMain.handle('lsp:hover', async (event, { filePath, line, character }) => {
  const wcId = event.sender.id;
  try {
    const result = await requestHover(wcId, filePath, line, character);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lsp:definition', async (event, { filePath, line, character }) => {
  const wcId = event.sender.id;
  try {
    const result = await requestDefinition(wcId, filePath, line, character);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lsp:completion', async (event, { filePath, line, character, triggerKind }) => {
  const wcId = event.sender.id;
  try {
    const result = await requestCompletion(wcId, filePath, line, character, triggerKind);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lsp:rename', async (event, { filePath, line, character, newName }) => {
  const wcId = event.sender.id;
  try {
    const result = await requestRename(wcId, filePath, line, character, newName);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lsp:references', async (event, { filePath, line, character, includeDeclaration }) => {
  const wcId = event.sender.id;
  try {
    const result = await requestReferences(wcId, filePath, line, character, includeDeclaration);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lsp:documentSymbols', async (event, { filePath }) => {
  const wcId = event.sender.id;
  try {
    const result = await requestDocumentSymbols(wcId, filePath);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('lsp:workspaceSymbols', async (event, { query }) => {
  const wcId = event.sender.id;
  try {
    const result = await requestWorkspaceSymbols(wcId, query);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Handle window close to shutdown LSP
ipcMain.on('lsp:windowClosed', (event) => {
  const wcId = event.sender.id;
  shutdownLSP(wcId);
});

// App Lifecycle
app.whenReady().then(async () => {
  // Permisos mínimos: solo media, resto denegado
  try {
    const allowed = new Set(['media']);
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(allowed.has(permission));
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
      return allowed.has(permission);
    });
  } catch (e) {
    console.warn('[Electron] Error configuring session permissions:', e);
  }

  await startEmbeddedServer();
  createWindow();

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
