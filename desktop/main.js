const path = require('node:path');
const { app, BrowserWindow, dialog, shell } = require('electron');
const { startLocalAppServer } = require('../src/windowsRuntime');

let runtime;
let mainWindow;

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'StudyFree',
    backgroundColor: '#f7f9fc',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
    shell.openExternal(nextUrl);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
  return mainWindow;
}

async function startDesktopApp() {
  const rootDir = app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
  const userDataDir = app.getPath('userData');

  runtime = await startLocalAppServer({
    rootDir,
    dataDir: path.join(userDataDir, 'data'),
    uploadDir: path.join(userDataDir, 'uploads'),
    host: '127.0.0.1'
  });

  createMainWindow(runtime.url);
}

async function stopRuntime() {
  if (!runtime) return;
  const current = runtime;
  runtime = null;
  await current.close();
}

app.whenReady().then(() => {
  startDesktopApp().catch((error) => {
    dialog.showErrorBox('StudyFree failed to start', error.stack || error.message);
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && runtime) {
    createMainWindow(runtime.url);
  }
});

app.on('window-all-closed', () => {
  stopRuntime().finally(() => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});

app.on('before-quit', () => {
  stopRuntime().catch(() => {});
});
