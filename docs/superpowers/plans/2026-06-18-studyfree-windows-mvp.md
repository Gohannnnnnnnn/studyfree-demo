# StudyFree Windows MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing course learning platform into a Windows-ready free desktop MVP with a local server runtime, Electron shell, Windows scripts, and documentation.

**Architecture:** Keep the existing Node HTTP app as the product core. Add a small reusable Windows runtime that starts the local server on an available loopback port, then add an Electron shell that opens that local URL and stores user data outside the packaged app. Keep browser and desktop behavior shared.

**Tech Stack:** Node.js built-in HTTP/fs/net/path, node:test, Electron, @electron/packager, batch scripts, existing browser HTML/CSS/JavaScript.

---

## File Structure

- Create `src/windowsRuntime.js`: reusable startup helper for finding a local port, starting `createServer`, and closing it cleanly.
- Create `tests/windows-runtime.test.js`: runtime tests that verify the local app server starts, serves the browser shell, and rejects occupied ports by moving to another port.
- Create `desktop/main.js`: Electron main process that starts the local app server and opens a desktop window.
- Modify `package.json`: set desktop metadata, add `desktop` and `package:windows` scripts, add Electron dev dependencies after `npm.cmd install --save-dev electron @electron/packager`.
- Modify `tests/static.test.js`: static checks for the Electron shell, package scripts, Windows batch files, and README packaging instructions.
- Create `run_windows.bat`: development one-click Windows launcher.
- Create `build_windows.bat`: Windows packaging helper.
- Modify `README.md`: add Windows desktop run and packaging instructions.
- Modify `.gitignore`: ignore `release/`.

## Scope Notes

The first implementation should not add live video, IM, cloud disk, face verification, exam monitoring, AI translation, paid membership, ads, or any dependency on private Chaoxing/Xuexitong APIs. It only packages the already-working free course workflow into a Windows-friendly form.

## Task 1: Local Windows Runtime

**Files:**
- Create: `src/windowsRuntime.js`
- Create: `tests/windows-runtime.test.js`

- [ ] **Step 1: Write the failing runtime tests**

Create `tests/windows-runtime.test.js`:

```javascript
const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { startLocalAppServer } = require('../src/windowsRuntime');

const runtimes = [];

afterEach(async () => {
  while (runtimes.length) {
    const runtime = runtimes.pop();
    await runtime.close();
    fs.rmSync(runtime.testRoot, { recursive: true, force: true });
  }
});

async function reservePort() {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  return {
    port: blocker.address().port,
    close: () => new Promise((resolve) => blocker.close(resolve))
  };
}

test('starts the local app server and serves the browser shell', async () => {
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studyfree-runtime-'));
  const runtime = await startLocalAppServer({
    rootDir: path.join(__dirname, '..'),
    dataDir: path.join(testRoot, 'data'),
    uploadDir: path.join(testRoot, 'uploads'),
    tokenSecret: 'runtime-test-secret',
    host: '127.0.0.1',
    preferredPort: 0
  });
  runtime.testRoot = testRoot;
  runtimes.push(runtime);

  assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+$/);

  const response = await fetch(`${runtime.url}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /id="app"/);
});

test('uses another available port when the preferred port is occupied', async () => {
  const blocker = await reservePort();
  const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studyfree-runtime-'));

  try {
    const runtime = await startLocalAppServer({
      rootDir: path.join(__dirname, '..'),
      dataDir: path.join(testRoot, 'data'),
      uploadDir: path.join(testRoot, 'uploads'),
      tokenSecret: 'runtime-port-secret',
      host: '127.0.0.1',
      preferredPort: blocker.port
    });
    runtime.testRoot = testRoot;
    runtimes.push(runtime);

    assert.notEqual(runtime.port, blocker.port);
    assert.match(runtime.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  } finally {
    await blocker.close();
  }
});
```

- [ ] **Step 2: Run the runtime tests to verify RED**

Run:

```powershell
npm.cmd test -- tests/windows-runtime.test.js
```

Expected: FAIL with `Cannot find module '../src/windowsRuntime'`.

- [ ] **Step 3: Implement the runtime helper**

Create `src/windowsRuntime.js`:

```javascript
const { createServer } = require('./server');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 20;

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    function onError(error) {
      cleanup();
      reject(error);
    }

    function onListening() {
      cleanup();
      resolve();
    }

    function cleanup() {
      server.off('error', onError);
      server.off('listening', onListening);
    }

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function startLocalAppServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const preferredPort = Number.isInteger(options.preferredPort)
    ? options.preferredPort
    : Number(process.env.PORT || DEFAULT_PORT);
  const attempts = preferredPort === 0 ? 1 : MAX_PORT_ATTEMPTS;

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = preferredPort === 0 ? 0 : preferredPort + attempt;
    const server = createServer({
      rootDir: options.rootDir,
      dataDir: options.dataDir,
      uploadDir: options.uploadDir,
      tokenSecret: options.tokenSecret
    });

    try {
      await listen(server, port, host);
      const actualPort = server.address().port;
      return {
        server,
        host,
        port: actualPort,
        url: `http://${host}:${actualPort}`,
        close: () => closeServer(server)
      };
    } catch (error) {
      lastError = error;
      await closeServer(server).catch(() => {});
      if (error.code !== 'EADDRINUSE' || preferredPort === 0) {
        throw error;
      }
    }
  }

  throw Object.assign(new Error(`No available local port found near ${preferredPort}.`), {
    cause: lastError
  });
}

module.exports = {
  startLocalAppServer
};
```

- [ ] **Step 4: Run the runtime tests to verify GREEN**

Run:

```powershell
npm.cmd test -- tests/windows-runtime.test.js
```

Expected: PASS for both runtime tests.

- [ ] **Step 5: Run all tests**

Run:

```powershell
npm.cmd test
```

Expected: all existing and new tests pass.

- [ ] **Step 6: Commit or record no-git state**

If this directory is a git repository:

```powershell
git add src/windowsRuntime.js tests/windows-runtime.test.js
git commit -m "feat: add local Windows app runtime"
```

If `git status` reports this is not a git repository, record that in the final handoff instead of committing.

## Task 2: Electron Desktop Shell

**Files:**
- Create: `desktop/main.js`
- Modify: `package.json`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Add failing static checks for desktop packaging**

Append this test to `tests/static.test.js`:

```javascript
test('defines Windows desktop shell and packaging scripts', () => {
  const rootDir = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const desktopMainPath = path.join(rootDir, 'desktop', 'main.js');

  assert.equal(packageJson.main, 'desktop/main.js');
  assert.equal(packageJson.productName, 'StudyFree');
  assert.match(packageJson.scripts.desktop, /electron \./);
  assert.match(packageJson.scripts['package:windows'], /electron-packager/);
  assert.match(packageJson.scripts['package:windows'], /--platform=win32/);

  const desktopMain = fs.readFileSync(desktopMainPath, 'utf8');
  assert.match(desktopMain, /startLocalAppServer/);
  assert.match(desktopMain, /BrowserWindow/);
  assert.match(desktopMain, /app\.getPath\('userData'\)/);
  assert.match(desktopMain, /StudyFree/);
});
```

- [ ] **Step 2: Run static tests to verify RED**

Run:

```powershell
npm.cmd test -- tests/static.test.js
```

Expected: FAIL because `package.json` does not yet point to `desktop/main.js` and `desktop/main.js` is missing.

- [ ] **Step 3: Add Electron development dependencies**

Run:

```powershell
npm.cmd install --save-dev electron @electron/packager
```

Expected: `package.json` gains `devDependencies`, and `package-lock.json` is created or updated.

- [ ] **Step 4: Update package metadata and scripts**

Modify `package.json` to this shape, preserving installed dependency versions in `devDependencies`:

```json
{
  "name": "course-learning-platform",
  "version": "0.1.0",
  "private": true,
  "productName": "StudyFree",
  "description": "Free Windows-ready course learning platform for teachers and students.",
  "main": "desktop/main.js",
  "scripts": {
    "start": "node src/server.js",
    "desktop": "electron .",
    "package:windows": "electron-packager . StudyFree --platform=win32 --arch=x64 --out=release --overwrite --asar --prune=true --ignore=\"^/(data|uploads|release|tests|docs|server\\\\.log|server\\\\.err\\\\.log)$\"",
    "test": "node --test tests/*.test.js"
  },
  "engines": {
    "node": ">=20"
  },
  "devDependencies": {
  }
}
```

Keep the actual `devDependencies` entries generated by npm, for example:

```json
"devDependencies": {
  "@electron/packager": "...",
  "electron": "..."
}
```

- [ ] **Step 5: Implement the Electron main process**

Create `desktop/main.js`:

```javascript
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
    dialog.showErrorBox('StudyFree 启动失败', error.stack || error.message);
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
```

- [ ] **Step 6: Run static tests to verify GREEN**

Run:

```powershell
npm.cmd test -- tests/static.test.js
```

Expected: PASS.

- [ ] **Step 7: Run all tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 8: Commit or record no-git state**

If this directory is a git repository:

```powershell
git add package.json package-lock.json desktop/main.js tests/static.test.js
git commit -m "feat: add StudyFree desktop shell"
```

If not, record that no commit was possible.

## Task 3: Windows Run And Build Scripts

**Files:**
- Create: `run_windows.bat`
- Create: `build_windows.bat`
- Modify: `.gitignore`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Add failing static checks for Windows scripts**

Append this test to `tests/static.test.js`:

```javascript
test('provides Windows launch and packaging scripts', () => {
  const rootDir = path.join(__dirname, '..');
  const runScript = fs.readFileSync(path.join(rootDir, 'run_windows.bat'), 'utf8');
  const buildScript = fs.readFileSync(path.join(rootDir, 'build_windows.bat'), 'utf8');
  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');

  assert.match(runScript, /npm\.cmd run desktop/);
  assert.match(runScript, /where node/);
  assert.match(runScript, /StudyFree/);
  assert.match(buildScript, /npm\.cmd install/);
  assert.match(buildScript, /npm\.cmd run package:windows/);
  assert.match(buildScript, /release\\StudyFree-win32-x64\\StudyFree\.exe/);
  assert.match(gitignore, /release\//);
});
```

- [ ] **Step 2: Run static tests to verify RED**

Run:

```powershell
npm.cmd test -- tests/static.test.js
```

Expected: FAIL because `run_windows.bat` and `build_windows.bat` do not exist.

- [ ] **Step 3: Create the Windows launch script**

Create `run_windows.bat`:

```bat
@echo off
setlocal
cd /d "%~dp0"

echo [StudyFree] Starting free Windows learning app...

where node >nul 2>nul
if errorlevel 1 (
  echo [StudyFree] Node.js 20 or newer is required for this development launcher.
  echo [StudyFree] If you want a no-Node version, run build_windows.bat on a development computer and use the packaged release folder.
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo [StudyFree] Installing desktop dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo [StudyFree] Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm.cmd run desktop
if errorlevel 1 (
  echo [StudyFree] Desktop app exited with an error.
  pause
  exit /b 1
)
```

- [ ] **Step 4: Create the Windows packaging script**

Create `build_windows.bat`:

```bat
@echo off
setlocal
cd /d "%~dp0"

echo [StudyFree] Preparing Windows package...

where node >nul 2>nul
if errorlevel 1 (
  echo [StudyFree] Node.js 20 or newer is required to build the package.
  pause
  exit /b 1
)

call npm.cmd install
if errorlevel 1 (
  echo [StudyFree] Dependency installation failed.
  pause
  exit /b 1
)

call npm.cmd test
if errorlevel 1 (
  echo [StudyFree] Tests failed. Package was not created.
  pause
  exit /b 1
)

call npm.cmd run package:windows
if errorlevel 1 (
  echo [StudyFree] Packaging failed.
  pause
  exit /b 1
)

echo [StudyFree] Package ready:
echo release\StudyFree-win32-x64\StudyFree.exe
pause
```

- [ ] **Step 5: Ignore packaged output**

Add this line to `.gitignore`:

```gitignore
release/
```

- [ ] **Step 6: Run static tests to verify GREEN**

Run:

```powershell
npm.cmd test -- tests/static.test.js
```

Expected: PASS.

- [ ] **Step 7: Run all tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 8: Commit or record no-git state**

If this directory is a git repository:

```powershell
git add run_windows.bat build_windows.bat .gitignore tests/static.test.js
git commit -m "feat: add Windows launch scripts"
```

If not, record that no commit was possible.

## Task 4: README Windows Instructions

**Files:**
- Modify: `README.md`
- Modify: `tests/static.test.js`

- [ ] **Step 1: Add failing README checks**

Append this test to `tests/static.test.js`:

```javascript
test('documents Windows desktop usage and packaging', () => {
  const rootDir = path.join(__dirname, '..');
  const readme = fs.readFileSync(path.join(rootDir, 'README.md'), 'utf8');

  assert.match(readme, /StudyFree/);
  assert.match(readme, /run_windows\.bat/);
  assert.match(readme, /build_windows\.bat/);
  assert.match(readme, /release\\StudyFree-win32-x64\\StudyFree\.exe/);
  assert.match(readme, /不会破解会员/);
  assert.match(readme, /不会使用学习通私有接口/);
});
```

- [ ] **Step 2: Run static tests to verify RED**

Run:

```powershell
npm.cmd test -- tests/static.test.js
```

Expected: FAIL because the README does not yet mention `StudyFree`, `run_windows.bat`, and `build_windows.bat`.

- [ ] **Step 3: Update README**

Add these sections near the top of `README.md` after the introduction:

```markdown
## StudyFree Windows 免费版定位

StudyFree 是一个独立实现的免费课程学习平台，目标是覆盖课程、资料、作业、测验、签到、讨论、公告和学习进度这些核心教学流程。

它不会破解会员，不会绕过登录或付费限制，不会复制学习通代码、品牌、素材，也不会使用学习通私有接口。学习通只作为功能类别参考，本项目使用自己的代码、界面和本地数据。

## Windows 桌面运行

开发电脑已安装 Node.js 20 或更新版本时，可以双击：

```text
run_windows.bat
```

脚本会安装依赖并启动 StudyFree 桌面窗口。数据保存在当前 Windows 用户的应用数据目录中，上传资料也保存在本机。

## Windows 打包

在开发电脑上双击：

```text
build_windows.bat
```

脚本会先安装依赖、运行测试，然后生成可分发目录：

```text
release\StudyFree-win32-x64\StudyFree.exe
```

把整个 `release\StudyFree-win32-x64` 文件夹复制到其他 Windows 电脑即可运行。
```

- [ ] **Step 4: Run static tests to verify GREEN**

Run:

```powershell
npm.cmd test -- tests/static.test.js
```

Expected: PASS.

- [ ] **Step 5: Run all tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 6: Commit or record no-git state**

If this directory is a git repository:

```powershell
git add README.md tests/static.test.js
git commit -m "docs: add StudyFree Windows instructions"
```

If not, record that no commit was possible.

## Task 5: Desktop Smoke Verification

**Files:**
- No source edits unless verification exposes a defect.

- [ ] **Step 1: Run all automated tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Start the desktop app in development mode**

Run:

```powershell
npm.cmd run desktop
```

Expected: Electron opens a StudyFree window and loads the local app.

- [ ] **Step 3: Stop the desktop app cleanly**

Close the Electron window.

Expected: the local HTTP server closes with the window and no stuck Node/Electron process is needed for normal use.

- [ ] **Step 4: Build the Windows package**

Run:

```powershell
npm.cmd run package:windows
```

Expected: `release\StudyFree-win32-x64\StudyFree.exe` exists.

- [ ] **Step 5: Smoke the packaged app**

Run:

```powershell
.\release\StudyFree-win32-x64\StudyFree.exe
```

Expected: packaged StudyFree opens, shows the login/register screen, and uses local user data outside the asar package.

- [ ] **Step 6: Final no-git note**

If `git status` is unavailable because the directory is not a git repository, include this in the handoff:

```text
The project directory is not a git repository, so changes were not committed.
```

## Self-Review

Spec coverage:

- Windows run script: Task 3.
- Packaged desktop build: Tasks 2, 3, and 5.
- Shared web app behavior: Task 1 starts existing `createServer`; Task 2 opens the same app in Electron.
- Local data and uploads: Task 2 passes `app.getPath('userData')` data and upload folders into the runtime.
- No proprietary copying or bypass behavior: Scope notes and README Task 4 document the boundary; no task reads or uses the original app's code.
- Verification: Task 5 covers tests, desktop startup, package build, and packaged smoke.

Placeholder scan:

- No placeholder tokens or undefined task references are intentionally present.

Type consistency:

- `startLocalAppServer(options)` is defined in Task 1 and imported by `desktop/main.js` in Task 2.
- Runtime return fields are consistently `server`, `host`, `port`, `url`, and `close`.
- Package script names are consistently `desktop` and `package:windows`.
