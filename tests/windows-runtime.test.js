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
