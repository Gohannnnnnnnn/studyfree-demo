const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createServer } = require('../src/server');

test('serves the browser app shell and static assets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'course-platform-static-'));
  const server = createServer({
    dataDir: path.join(root, 'data'),
    uploadDir: path.join(root, 'uploads'),
    tokenSecret: 'static-check'
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(`${baseUrl}/`);
    const app = await fetch(`${baseUrl}/app.js`);
    const css = await fetch(`${baseUrl}/styles.css`);
    const appText = await app.text();
    const cssText = await css.text();

    assert.equal(home.status, 200);
    assert.equal(app.status, 200);
    assert.equal(css.status, 200);
    assert.match(await home.text(), /id="app"/);
    assert.match(appText, /学生端/);
    assert.match(appText, /课堂签到/);
    assert.match(appText, /课程空间/);
    assert.match(appText, /所有课程/);
    assert.match(appText, /删除课程/);
    assert.match(appText, /deleteCourse/);
    assert.match(appText, /在线播放/);
    assert.match(appText, /data-video-progress/);
    assert.match(appText, /syncVideoProgress/);
    assert.match(appText, /quick-upload-form/);
    assert.match(appText, /batchUploadMaterials/);
    assert.match(appText, /inferContentTypeFromFile/);
    assert.match(appText, /multiple/);
    assert.match(appText, /10GB/);
    assert.match(appText, /视频观看/);
    assert.match(appText, /savedLoginFor/);
    assert.match(appText, /rememberCredentials/);
    assert.match(appText, /loadDashboard/);
    assert.match(appText, /继续学习/);
    assert.match(appText, /今日待办/);
    assert.match(appText, /最近公告/);
    assert.match(appText, /快速建课/);
    assert.match(appText, /待批改作业/);
    assert.match(appText, /学生学习进度/);
    assert.match(appText, /课程总览/);
    assert.match(appText, /数据概览/);
    assert.match(appText, /资料/);
    assert.match(appText, /courseToolGrid/);
    assert.match(appText, /data-course-tool/);
    assert.match(appText, /gradeOptions/);
    assert.match(appText, /一年级/);
    assert.match(appText, /二年级/);
    assert.match(appText, /三年级/);
    assert.match(appText, /当前账号年级/);
    assert.doesNotThrow(() => new Function(appText));
    assert.match(cssText, /\.login-layout/);
    assert.match(cssText, /\.course-space/);
    assert.match(cssText, /\.dashboard-grid/);
    assert.match(cssText, /\.workbench-list/);
    assert.match(cssText, /\.quick-upload-panel/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('defines Windows desktop shell and packaging scripts', () => {
  const rootDir = path.join(__dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const desktopMainPath = path.join(rootDir, 'desktop', 'main.js');

  assert.equal(packageJson.main, 'desktop/main.js');
  assert.equal(packageJson.productName, 'StudyFree');
  assert.match(packageJson.scripts.desktop, /electron \./);
  assert.match(packageJson.scripts['package:windows'], /electron-packager/);
  assert.match(packageJson.scripts['package:windows'], /--platform=win32/);
  assert.match(packageJson.scripts['package:windows'], /ELECTRON_MIRROR/);

  const desktopMain = fs.readFileSync(desktopMainPath, 'utf8');
  assert.match(desktopMain, /startLocalAppServer/);
  assert.match(desktopMain, /BrowserWindow/);
  assert.match(desktopMain, /app\.getPath\('userData'\)/);
  assert.match(desktopMain, /StudyFree/);
});

test('provides Windows launch and packaging scripts', () => {
  const rootDir = path.join(__dirname, '..');
  const runScript = fs.readFileSync(path.join(rootDir, 'run_windows.bat'), 'utf8');
  const buildScript = fs.readFileSync(path.join(rootDir, 'build_windows.bat'), 'utf8');
  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');

  assert.match(runScript, /npm\.cmd run desktop/);
  assert.match(runScript, /where node/);
  assert.match(runScript, /ELECTRON_MIRROR/);
  assert.match(runScript, /StudyFree/);
  assert.match(buildScript, /npm\.cmd install/);
  assert.match(buildScript, /npm\.cmd run package:windows/);
  assert.match(buildScript, /ELECTRON_MIRROR/);
  assert.match(buildScript, /release\\StudyFree-win32-x64\\StudyFree\.exe/);
  assert.match(gitignore, /release\//);
});

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
